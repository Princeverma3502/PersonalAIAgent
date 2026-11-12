const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
    extractPageContent,
    findSearchMatches,
    isPublicIpAddress,
    readPublicPage,
    validateWebUrl
} = require("../src/agent/browserService");
const {
    getToolDeclaration,
    validateToolName
} = require("../src/agent/tools");

test("public webpage retrieval safety and content handling", async t => {
    await t.test("allows public addresses and blocks private or special ranges", () => {
        assert.equal(isPublicIpAddress("8.8.8.8"), true);
        assert.equal(isPublicIpAddress("2001:4860:4860::8888"), true);
        assert.equal(isPublicIpAddress("127.0.0.1"), false);
        assert.equal(isPublicIpAddress("169.254.169.254"), false);
        assert.equal(isPublicIpAddress("::1"), false);
        assert.equal(isPublicIpAddress("::ffff:192.168.1.1"), false);
        assert.equal(isPublicIpAddress("2001:db8::1"), false);
    });

    await t.test("rejects unsafe schemes, credentials, private hosts, and ports", () => {
        for (const url of [
            "file:///etc/passwd",
            "http://localhost/",
            "http://127.0.0.1/",
            "http://169.254.169.254/latest/meta-data/",
            "https://user:password@example.com/",
            "https://example.com:8443/",
            "https://service.internal/"
        ]) {
            assert.throws(() => validateWebUrl(url));
        }
    });

    await t.test("extracts readable text and removes scripts and hidden markup", () => {
        const url = validateWebUrl("https://example.com/news");
        const page = extractPageContent(
            "<html><head><title>News &amp; Updates</title>" +
                "<script>secret()</script></head>" +
                "<body><h1>Welcome</h1><p>Read &lt;this&gt;.</p>" +
                "<style>.hidden{}</style></body></html>",
            "text/html",
            url
        );

        assert.equal(page.title, "News & Updates");
        assert.match(page.text, /Welcome/);
        assert.match(page.text, /Read <this>\./);
        assert.doesNotMatch(page.text, /secret|hidden/);
    });

    await t.test("finds a bounded number of case-insensitive text matches", () => {
        const text = Array(8).fill("Agent tools help.").join(" ");
        const matches = findSearchMatches(text, "AGENT");

        assert.equal(matches.length, 5);
        assert.ok(matches.every(match => /Agent/i.test(match)));
    });

    await t.test("revalidates every redirect before requesting its destination", async () => {
        let fetchCount = 0;
        const adapters = {
            resolveAddress: async () => ({
                address: "93.184.216.34",
                family: 4
            }),
            fetchPage: async () => {
                fetchCount += 1;
                return {
                    redirectLocation: "http://127.0.0.1/private"
                };
            }
        };

        await assert.rejects(
            readPublicPage({ url: "https://public.example/start" }, adapters),
            /Only public HTTP or HTTPS/
        );
        assert.equal(fetchCount, 1);
    });

    await t.test("follows safe redirects and returns extracted search matches", async () => {
        const resolvedHosts = [];
        const adapters = {
            resolveAddress: async hostname => {
                resolvedHosts.push(hostname);
                return { address: "93.184.216.34", family: 4 };
            },
            fetchPage: async url => url.hostname === "start.example"
                ? { redirectLocation: "https://content.example/article" }
                : {
                    contentType: "text/html",
                    body: "<html><head><title>Agent Notes</title></head>" +
                        "<body><p>The agent remembers this important detail.</p></body></html>"
                }
        };

        const result = await readPublicPage({
            url: "https://start.example/article",
            searchTerm: "important detail"
        }, adapters);

        assert.deepEqual(resolvedHosts, ["start.example", "content.example"]);
        assert.equal(result.success, true);
        assert.equal(result.title, "Agent Notes");
        assert.equal(result.url, "https://content.example/article");
        assert.equal(result.matches.length, 1);
        assert.match(result.matches[0], /important detail/);
    });

    await t.test("registers the read-only browser tool with a URL argument", () => {
        const tool = validateToolName("read_public_webpage");
        const declarations = getToolDeclaration().functionDeclarations;

        assert.ok(tool);
        assert.equal(
            tool.validateArgs({ url: "https://example.com/" }),
            true
        );
        assert.equal(
            tool.validateArgs({
                url: "https://example.com/",
                searchTerm: "agent"
            }),
            true
        );
        assert.equal(
            tool.validateArgs({ url: "http://127.0.0.1/" }),
            false
        );
        assert.ok(declarations.some(item =>
            item.name === "read_public_webpage"
        ));
    });
});
