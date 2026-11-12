const dns = require("node:dns/promises");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

const MAX_URL_LENGTH = 2048;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_PAGE_TEXT_LENGTH = 6000;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 7000;
const DNS_TIMEOUT_MS = 2500;
const SEARCH_MATCH_LIMIT = 5;

const BLOCKED_IPV4_RANGES = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4]
].map(([base, prefix]) => ({
    base: ipv4ToNumber(base),
    prefix
}));

function ipv4ToNumber(address) {
    return address.split(".")
        .reduce((value, part) => value * 256 + Number(part), 0);
}

function isInIpv4Range(address, { base, prefix }) {
    const blockSize = 2 ** (32 - prefix);
    return Math.floor(address / blockSize) === Math.floor(base / blockSize);
}

function expandIpv6(address) {
    let normalized = address.toLowerCase();

    if (normalized.includes(".")) {
        const lastColon = normalized.lastIndexOf(":");
        const ipv4 = normalized.slice(lastColon + 1);
        if (net.isIP(ipv4) !== 4) return null;

        const value = ipv4ToNumber(ipv4);
        const high = ((value >>> 16) & 0xffff).toString(16);
        const low = (value & 0xffff).toString(16);
        normalized = `${normalized.slice(0, lastColon)}:${high}:${low}`;
    }

    const halves = normalized.split("::");
    if (halves.length > 2) return null;

    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves.length === 2 && halves[1]
        ? halves[1].split(":")
        : [];
    const missingSegments = 8 - left.length - right.length;

    if (
        (halves.length === 1 && missingSegments !== 0) ||
        (halves.length === 2 && missingSegments < 1)
    ) {
        return null;
    }

    const segments = [
        ...left,
        ...Array(missingSegments).fill("0"),
        ...right
    ].map(segment => Number.parseInt(segment, 16));

    return segments.length === 8 &&
        segments.every(segment =>
            Number.isInteger(segment) &&
            segment >= 0 &&
            segment <= 0xffff
        )
        ? segments
        : null;
}

function isPublicIpAddress(address) {
    const family = net.isIP(address);

    if (family === 4) {
        const value = ipv4ToNumber(address);
        return !BLOCKED_IPV4_RANGES.some(range =>
            isInIpv4Range(value, range)
        );
    }

    if (family !== 6) return false;

    const segments = expandIpv6(address);
    if (!segments) return false;

    const isIpv4Mapped =
        segments.slice(0, 5).every(segment => segment === 0) &&
        segments[5] === 0xffff;

    if (isIpv4Mapped) {
        const mappedIpv4 = [
            segments[6] >> 8,
            segments[6] & 0xff,
            segments[7] >> 8,
            segments[7] & 0xff
        ].join(".");
        return isPublicIpAddress(mappedIpv4);
    }

    const isGlobalUnicast = segments[0] >= 0x2000 &&
        segments[0] <= 0x3fff;
    const isDocumentation = segments[0] === 0x2001 &&
        segments[1] === 0x0db8;
    const isTeredo = segments[0] === 0x2001 &&
        segments[1] === 0;
    const isBenchmark = segments[0] === 0x2001 &&
        segments[1] === 2;
    const isOrchid = segments[0] === 0x2001 &&
        (segments[1] & 0xfff0) === 0x0010;
    const isSixToFour = segments[0] === 0x2002;

    return isGlobalUnicast &&
        !isDocumentation &&
        !isTeredo &&
        !isBenchmark &&
        !isOrchid &&
        !isSixToFour;
}

function validateWebUrl(value) {
    if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > MAX_URL_LENGTH
    ) {
        throw new Error("Provide a valid public webpage URL.");
    }

    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error("Provide a valid public webpage URL.");
    }

    const hostname = url.hostname
        .replace(/^\[|\]$/g, "")
        .replace(/\.$/, "")
        .toLowerCase();
    const portIsAllowed = !url.port ||
        (url.protocol === "http:" && url.port === "80") ||
        (url.protocol === "https:" && url.port === "443");
    const isSingleLabelHostname = net.isIP(hostname) === 0 &&
        !hostname.includes(".");

    if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        !portIsAllowed ||
        !hostname ||
        isSingleLabelHostname ||
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        hostname.endsWith(".internal") ||
        hostname.endsWith(".test") ||
        hostname.endsWith(".invalid") ||
        (net.isIP(hostname) && !isPublicIpAddress(hostname))
    ) {
        throw new Error("Only public HTTP or HTTPS webpages can be opened.");
    }

    url.hash = "";
    return url;
}

async function resolvePublicAddress(hostname) {
    if (net.isIP(hostname)) {
        if (!isPublicIpAddress(hostname)) {
            throw new Error("The webpage host is not a public address.");
        }
        return { address: hostname, family: net.isIP(hostname) };
    }

    let timeoutHandle;
    let addresses;
    try {
        addresses = await Promise.race([
            dns.lookup(hostname, { all: true, verbatim: true }),
            new Promise((_, reject) => {
                timeoutHandle = setTimeout(
                    () => reject(new Error("DNS lookup timed out.")),
                    DNS_TIMEOUT_MS
                );
            })
        ]);
    } catch {
        throw new Error("The public webpage host could not be resolved safely.");
    } finally {
        clearTimeout(timeoutHandle);
    }

    if (
        addresses.length === 0 ||
        addresses.some(result => !isPublicIpAddress(result.address))
    ) {
        throw new Error("The webpage host resolves to a non-public address.");
    }

    const { address, family } = addresses[0];
    return { address, family };
}

function requestPage(url, resolvedAddress) {
    const protocol = url.protocol === "https:" ? https : http;
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const requestPath = `${url.pathname}${url.search}`;

    return new Promise((resolve, reject) => {
        const request = protocol.request({
            protocol: url.protocol,
            hostname,
            port: url.port || undefined,
            path: requestPath,
            method: "GET",
            agent: false,
            maxHeaderSize: 16 * 1024,
            headers: {
                Accept: "text/html, application/xhtml+xml, text/plain",
                "Accept-Encoding": "identity",
                "User-Agent": "PersonalAIAgent-ReadOnly/1.0"
            },
            lookup: (requestedHost, options, callback) => {
                if (options.all) {
                    callback(null, [resolvedAddress]);
                } else {
                    callback(
                        null,
                        resolvedAddress.address,
                        resolvedAddress.family
                    );
                }
            }
        }, response => {
            const statusCode = response.statusCode || 0;
            const location = response.headers.location;
            response.on("error", reject);

            if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
                response.resume();
                resolve({ statusCode, redirectLocation: location });
                return;
            }

            if (statusCode < 200 || statusCode >= 300) {
                response.resume();
                reject(new Error(`The webpage returned HTTP ${statusCode}.`));
                return;
            }

            const contentType = String(response.headers["content-type"] || "")
                .split(";")[0]
                .trim()
                .toLowerCase();
            const contentEncoding = String(
                response.headers["content-encoding"] || "identity"
            ).toLowerCase();
            const allowedContentTypes = new Set([
                "text/html",
                "application/xhtml+xml",
                "text/plain"
            ]);

            if (!allowedContentTypes.has(contentType)) {
                response.resume();
                reject(new Error("The webpage did not return readable text."));
                return;
            }

            if (contentEncoding !== "identity") {
                response.resume();
                reject(new Error("Compressed webpage responses are not supported."));
                return;
            }

            const contentLength = Number(response.headers["content-length"]);
            if (
                Number.isFinite(contentLength) &&
                contentLength > MAX_RESPONSE_BYTES
            ) {
                response.resume();
                reject(new Error("The webpage is larger than the allowed limit."));
                return;
            }

            const chunks = [];
            let totalBytes = 0;

            response.on("data", chunk => {
                totalBytes += chunk.length;
                if (totalBytes > MAX_RESPONSE_BYTES) {
                    request.destroy(
                        new Error("The webpage is larger than the allowed limit.")
                    );
                    return;
                }
                chunks.push(chunk);
            });

            response.on("end", () => {
                resolve({
                    statusCode,
                    contentType,
                    body: Buffer.concat(chunks).toString("utf8")
                });
            });
            response.on("error", reject);
        });

        const timeoutHandle = setTimeout(
            () => request.destroy(new Error("The webpage request timed out.")),
            REQUEST_TIMEOUT_MS
        );
        request.on("close", () => clearTimeout(timeoutHandle));
        request.on("error", reject);
        request.end();
    });
}

function decodeHtmlEntities(value) {
    const namedEntities = {
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        nbsp: " ",
        quot: "\""
    };

    return value.replace(
        /&(#(?:x[0-9a-f]+|\d+)|amp|apos|gt|lt|nbsp|quot);/gi,
        (entity, name) => {
            if (name[0] !== "#") {
                return namedEntities[name.toLowerCase()];
            }

            const isHex = name[1].toLowerCase() === "x";
            const codePoint = Number.parseInt(name.slice(isHex ? 2 : 1), isHex ? 16 : 10);
            if (
                !Number.isInteger(codePoint) ||
                codePoint <= 0 ||
                codePoint > 0x10ffff ||
                (codePoint >= 0xd800 && codePoint <= 0xdfff)
            ) {
                return entity;
            }

            return String.fromCodePoint(codePoint);
        }
    );
}

function extractPageContent(content, contentType, url) {
    const isHtml = contentType !== "text/plain";
    let title = url.hostname.replace(/^\[|\]$/g, "");
    let text = content;

    if (isHtml) {
        const titleMatch = content.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
        if (titleMatch) {
            title = decodeHtmlEntities(
                titleMatch[1].replace(/<[^>]*>/g, " ")
            ).replace(/\s+/g, " ").trim();
        }

        text = content
            .replace(/<!--[\s\S]*?-->/g, " ")
            .replace(/<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
            .replace(/<(br|hr)\b[^>]*>/gi, "\n")
            .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|blockquote|pre|main|ul|ol|table|td|th)\s*>/gi, "\n")
            .replace(/<[^>]*>/g, " ");
        text = decodeHtmlEntities(text);
    }

    text = text
        .replace(/\r/g, "")
        .replace(/[ \t\f\v]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    return {
        title: title || url.hostname.replace(/^\[|\]$/g, ""),
        text: text.slice(0, MAX_PAGE_TEXT_LENGTH)
    };
}

function findSearchMatches(text, searchTerm) {
    if (!searchTerm) return [];

    const normalizedText = text.toLowerCase();
    const normalizedTerm = searchTerm.toLowerCase();
    const matches = [];
    let offset = 0;

    while (
        matches.length < SEARCH_MATCH_LIMIT &&
        offset < normalizedText.length
    ) {
        const index = normalizedText.indexOf(normalizedTerm, offset);
        if (index < 0) break;

        const start = Math.max(0, index - 100);
        const end = Math.min(text.length, index + searchTerm.length + 140);
        matches.push(text.slice(start, end).replace(/\s+/g, " ").trim());
        offset = index + normalizedTerm.length;
    }

    return matches;
}

async function readPublicPage(
    { url: rawUrl, searchTerm },
    adapters = {}
) {
    const resolveAddress = adapters.resolveAddress || resolvePublicAddress;
    const fetchPage = adapters.fetchPage || requestPage;
    let currentUrl = validateWebUrl(rawUrl);

    for (let redirectCount = 0; ; redirectCount++) {
        const hostname = currentUrl.hostname
            .replace(/^\[|\]$/g, "")
            .replace(/\.$/, "")
            .toLowerCase();
        const resolvedAddress = await resolveAddress(hostname);
        const response = await fetchPage(currentUrl, resolvedAddress);

        if (response.redirectLocation) {
            if (redirectCount >= MAX_REDIRECTS) {
                throw new Error("The webpage exceeded the redirect limit.");
            }
            currentUrl = validateWebUrl(
                new URL(response.redirectLocation, currentUrl).href
            );
            continue;
        }

        const extracted = extractPageContent(
            response.body,
            response.contentType,
            currentUrl
        );
        const result = {
            success: true,
            url: currentUrl.href,
            title: extracted.title,
            text: extracted.text,
            message: "Retrieved public webpage content in read-only mode."
        };

        if (searchTerm) {
            result.searchTerm = searchTerm;
            result.matches = findSearchMatches(extracted.text, searchTerm);
        }

        return result;
    }
}

module.exports = {
    extractPageContent,
    findSearchMatches,
    isPublicIpAddress,
    readPublicPage,
    validateWebUrl
};
