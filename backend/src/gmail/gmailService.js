const fs = require("fs/promises");
const path = require("path");
const { google } = require("googleapis");

const DEFAULT_TOKEN_PATH = path.join(__dirname, "../../data/gmail-tokens.json");
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const MAX_SEARCH_RESULTS = 20;

function hasScope(tokens, requiredScope) {
    if (typeof tokens?.scope !== "string") return false;
    return tokens.scope.split(/\s+/).includes(requiredScope);
}

function getSafeSearchError(error) {
    const status = error?.code || error?.response?.status;
    const message = typeof error?.message === "string"
        ? error.message
        : "";

    if (
        status === 401 ||
        status === 403 ||
        /insufficient.*scope|insufficient authentication scopes/i.test(message)
    ) {
        return new Error(
            "Gmail inbox access is missing or expired. Reauthorize at http://localhost:3000/api/gmail/auth and grant Gmail read access."
        );
    }

    return new Error(
        "Gmail inbox search failed because the Gmail API request was unsuccessful. Check your connection and try again."
    );
}

function createGmailService(options = {}) {
    let googleApi = options.googleApi || google;
    let tokenPath = options.tokenFilePath || DEFAULT_TOKEN_PATH;

    function getOAuthClient() {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        const redirectUri = process.env.GOOGLE_REDIRECT_URI;

        if (!clientId || !clientSecret || !redirectUri) {
            return null;
        }

        return new googleApi.auth.OAuth2(
            clientId,
            clientSecret,
            redirectUri
        );
    }

    async function readStoredTokens() {
        try {
            const content = await fs.readFile(tokenPath, "utf8");
            const parsed = JSON.parse(content);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (error) {
            if (error && error.code === "ENOENT") {
                return null;
            }
            throw error;
        }
    }

    async function saveStoredTokens(tokens) {
        await fs.mkdir(path.dirname(tokenPath), { recursive: true });
        await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2), "utf8");
    }

    async function getAuthenticatedClient() {
        const oauth2Client = getOAuthClient();
        if (!oauth2Client) {
            return null;
        }

        const storedTokens = await readStoredTokens();
        if (storedTokens) {
            oauth2Client.setCredentials(storedTokens);
        }

        return oauth2Client;
    }

    function buildAuthorizationUrl() {
        const oauth2Client = getOAuthClient();
        if (!oauth2Client) {
            throw new Error(
                "Gmail OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI."
            );
        }

        return oauth2Client.generateAuthUrl({
            access_type: "offline",
            prompt: "consent",
            include_granted_scopes: false,
            scope: [GMAIL_READONLY_SCOPE]
        });
    }

    async function exchangeCodeForTokens(code) {
        const oauth2Client = getOAuthClient();
        if (!oauth2Client) {
            throw new Error(
                "Gmail OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI."
            );
        }

        if (typeof code !== "string" || !code.trim()) {
            throw new Error("A Google OAuth authorization code is required.");
        }

        const { tokens } = await oauth2Client.getToken(code.trim());
        const previousTokens = await readStoredTokens();
        const replacementTokens = {
            ...tokens,
            scope: typeof tokens.scope === "string" ? tokens.scope : ""
        };

        if (!replacementTokens.refresh_token && previousTokens?.refresh_token) {
            replacementTokens.refresh_token = previousTokens.refresh_token;
        }

        await saveStoredTokens(replacementTokens);
        return replacementTokens;
    }

    async function gmailStatus() {
        const storedTokens = await readStoredTokens();
        const connected = Boolean(storedTokens);
        return {
            configured: Boolean(getOAuthClient()),
            connected,
            searchAvailable: connected &&
                hasScope(storedTokens, GMAIL_READONLY_SCOPE)
        };
    }

    async function searchEmails({ query = "", maxResults = 5 } = {}) {
        if (
            typeof query !== "string" ||
            query.length > 500 ||
            !Number.isInteger(maxResults) ||
            maxResults < 1
        ) {
            throw new Error(
                "Provide a Gmail search query up to 500 characters and a positive integer result limit."
            );
        }

        const resultLimit = Math.min(maxResults, MAX_SEARCH_RESULTS);
        const storedTokens = await readStoredTokens();

        if (!storedTokens) {
            throw new Error(
                "Gmail is not connected. Open http://localhost:3000/api/gmail/auth and authorize your account."
            );
        }

        if (!hasScope(storedTokens, GMAIL_READONLY_SCOPE)) {
            throw new Error(
                "Gmail inbox permission is missing. Reauthorize at http://localhost:3000/api/gmail/auth and grant Gmail read access."
            );
        }

        const oauth2Client = await getAuthenticatedClient();
        if (!oauth2Client) {
            throw new Error(
                "Gmail OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI."
            );
        }

        try {
            const gmail = googleApi.gmail({
                version: "v1",
                auth: oauth2Client
            });
            const listResponse = await gmail.users.messages.list({
                userId: "me",
                labelIds: ["INBOX"],
                ...(query.trim() ? { q: query.trim() } : {}),
                maxResults: resultLimit
            });
            const messageIds = (listResponse.data.messages || [])
                .map(message => message?.id)
                .filter(id => typeof id === "string" && id.length > 0)
                .slice(0, resultLimit);

            const emails = await Promise.all(messageIds.map(async id => {
                const response = await gmail.users.messages.get({
                    userId: "me",
                    id,
                    format: "metadata",
                    metadataHeaders: ["From", "Subject", "Date"],
                    fields: "id,snippet,payload(headers)"
                });
                const message = response.data || {};
                const headers = message.payload?.headers || [];
                const getHeader = name => {
                    const header = headers.find(item =>
                        typeof item?.name === "string" &&
                        item.name.toLowerCase() === name.toLowerCase()
                    );
                    return typeof header?.value === "string"
                        ? header.value
                        : "";
                };

                return {
                    id: typeof message.id === "string" ? message.id : id,
                    from: getHeader("From"),
                    subject: getHeader("Subject"),
                    date: getHeader("Date"),
                    snippet: typeof message.snippet === "string"
                        ? message.snippet
                        : ""
                };
            }));

            return {
                success: true,
                emails,
                resultCount: emails.length
            };
        } catch (error) {
            throw getSafeSearchError(error);
        }
    }

    return {
        getOAuthClient,
        readStoredTokens,
        saveStoredTokens,
        getAuthenticatedClient,
        buildAuthorizationUrl,
        exchangeCodeForTokens,
        gmailStatus,
        searchEmails,
        setGoogleApi(nextGoogleApi) {
            googleApi = nextGoogleApi || google;
            return googleApi;
        },
        setTokenFilePath(nextTokenPath) {
            tokenPath = nextTokenPath || DEFAULT_TOKEN_PATH;
            return tokenPath;
        },
        getTokenFilePath() {
            return tokenPath;
        }
    };
}

const gmailService = createGmailService();

module.exports = gmailService;
module.exports.createGmailService = createGmailService;
