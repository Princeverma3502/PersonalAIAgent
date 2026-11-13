const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const gmailService = require("../src/gmail/gmailService");
const { getToolDeclaration, validateToolName } =
    require("../src/agent/tools");

const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const BOTH_SCOPES = `${READ_SCOPE} ${SEND_SCOPE}`;

function makeFakeGoogleApi(options = {}) {
    const calls = {
        authorizationOptions: [],
        list: [],
        get: [],
        send: []
    };
    const api = {
        auth: {
            OAuth2: class {
                constructor(clientId, clientSecret, redirectUri) {
                    this.clientId = clientId;
                    this.clientSecret = clientSecret;
                    this.redirectUri = redirectUri;
                    this.credentials = null;
                }

                generateAuthUrl(options) {
                    calls.authorizationOptions.push(options);
                    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${this.clientId}&redirect_uri=${encodeURIComponent(this.redirectUri)}&scope=${encodeURIComponent(options.scope.join(" "))}`;
                }

                getToken(code) {
                    return Promise.resolve({
                        tokens: options.issuedTokens || {
                            access_token: `token-for-${code}`,
                            refresh_token: "refresh-token",
                            scope: READ_SCOPE
                        }
                    });
                }

                setCredentials(tokens) {
                    this.credentials = tokens;
                }
            }
        },
        gmail: () => ({
            users: {
                messages: {
                    list: async args => {
                        calls.list.push(args);
                        if (options.listError) throw options.listError;
                        return {
                            data: options.listData || { messages: [] }
                        };
                    },
                    get: async args => {
                        calls.get.push(args);
                        if (options.getError) throw options.getError;
                        return {
                            data: options.messageData?.[args.id] || {
                                id: args.id,
                                snippet: "",
                                payload: { headers: [] }
                            }
                        };
                    },
                    send: async args => {
                        calls.send.push(args);
                        if (options.sendError) throw options.sendError;
                        return { data: options.sendData || { id: "sent-message" } };
                    }
                }
            }
        })
    };
    api.calls = calls;
    return api;
}

function restoreEnvSnapshot(snapshot) {
    for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
}

async function withGmailService(options, callback) {
    const tokenPath = path.join(
        os.tmpdir(),
        `gmail-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
    );
    const api = makeFakeGoogleApi(options);
    const service = gmailService.createGmailService({
        googleApi: api,
        tokenFilePath: tokenPath
    });
    const envSnapshot = {
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI
    };

    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    process.env.GOOGLE_REDIRECT_URI =
        "http://localhost:3000/api/gmail/callback";

    try {
        if (options.tokens) await service.saveStoredTokens(options.tokens);
        await callback(service, api);
    } finally {
        restoreEnvSnapshot(envSnapshot);
        await fs.rm(tokenPath, { force: true });
    }
}

test("gmail status reports unconfigured state before OAuth setup", async () => {
    const tokenPath = path.join(
        os.tmpdir(),
        `gmail-unconfigured-${process.pid}-${Date.now()}.json`
    );
    const service = gmailService.createGmailService({
        tokenFilePath: tokenPath
    });
    const original = {
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI
    };

    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;

    try {
        const status = await service.gmailStatus();
        assert.equal(status.configured, false);
        assert.equal(status.connected, false);
        assert.equal(status.searchAvailable, false);
        assert.equal(status.sendAvailable, false);
        assert.throws(() => service.buildAuthorizationUrl(), /not configured/i);
    } finally {
        restoreEnvSnapshot(original);
        await fs.rm(tokenPath, { force: true });
    }
});

test("Gmail authorization requests readonly and send access with fresh consent", async () => {
    await withGmailService({}, async (service, api) => {
        const url = service.buildAuthorizationUrl();
        const scopes = api.calls.authorizationOptions[0].scope;

        assert.ok(url.includes(encodeURIComponent(READ_SCOPE)));
        assert.ok(url.includes(encodeURIComponent(SEND_SCOPE)));
        assert.equal(api.calls.authorizationOptions[0].prompt, "consent");
        assert.equal(api.calls.authorizationOptions[0].include_granted_scopes, false);
        assert.deepEqual(scopes, [READ_SCOPE, SEND_SCOPE]);
    });
});

test("Gmail reauthorization replaces tokens and preserves an existing refresh token", async () => {
    await withGmailService({
        tokens: {
            access_token: "old-access-token",
            refresh_token: "old-refresh-token",
            scope: SEND_SCOPE
        },
        issuedTokens: {
            access_token: "new-access-token",
            scope: BOTH_SCOPES
        }
    }, async service => {
        await service.exchangeCodeForTokens("authorization-code");
        const savedTokens = await service.readStoredTokens();

        assert.equal(savedTokens.access_token, "new-access-token");
        assert.equal(savedTokens.refresh_token, "old-refresh-token");
        assert.equal(savedTokens.scope, BOTH_SCOPES);
        assert.deepEqual(await service.gmailStatus(), {
            configured: true,
            connected: true,
            searchAvailable: true,
            sendAvailable: true
        });
    });
});

test("Gmail reauthorization does not assume missing scope metadata grants inbox access", async () => {
    await withGmailService({
        issuedTokens: {
            access_token: "new-access-token",
            refresh_token: "new-refresh-token"
        }
    }, async service => {
        await service.exchangeCodeForTokens("authorization-code");
        assert.equal((await service.gmailStatus()).searchAvailable, false);
        await assert.rejects(
            service.searchEmails(),
            /Reauthorize.*Gmail read access/i
        );
    });
});

test("Gmail search returns matching messages using metadata only", async () => {
    await withGmailService({
        tokens: {
            access_token: "demo-access-token",
            refresh_token: "demo-refresh-token",
            scope: READ_SCOPE
        },
        listData: {
            messages: [{ id: "message-1" }, { id: "message-2" }]
        },
        messageData: {
            "message-1": {
                id: "message-1",
                snippet: "Preview of the recent message",
                payload: {
                    headers: [
                        { name: "From", value: "sender@example.com" },
                        { name: "Subject", value: "Example subject" },
                        { name: "Date", value: "Fri, 13 Nov 2026 10:00:00 +0000" }
                    ]
                }
            },
            "message-2": {
                id: "message-2",
                snippet: "Another preview",
                payload: {
                    headers: [
                        { name: "from", value: "second@example.com" },
                        { name: "subject", value: "Another subject" }
                    ]
                }
            }
        }
    }, async (service, api) => {
        const result = await service.searchEmails({
            query: "from:sender@example.com subject:Example after:2026/01/01 is:unread"
        });

        assert.deepEqual(result, {
            success: true,
            emails: [
                {
                    id: "message-1",
                    from: "sender@example.com",
                    subject: "Example subject",
                    date: "Fri, 13 Nov 2026 10:00:00 +0000",
                    snippet: "Preview of the recent message"
                },
                {
                    id: "message-2",
                    from: "second@example.com",
                    subject: "Another subject",
                    date: "",
                    snippet: "Another preview"
                }
            ],
            resultCount: 2
        });
        assert.deepEqual(api.calls.list[0], {
            userId: "me",
            labelIds: ["INBOX"],
            q: "from:sender@example.com subject:Example after:2026/01/01 is:unread",
            maxResults: 5
        });
        assert.deepEqual(api.calls.get[0], {
            userId: "me",
            id: "message-1",
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
            fields: "id,snippet,payload(headers)"
        });
    });
});

test("Gmail search returns empty results and defaults to five inbox messages", async () => {
    await withGmailService({
        tokens: {
            access_token: "demo-access-token",
            scope: READ_SCOPE
        },
        listData: { messages: [] }
    }, async (service, api) => {
        const result = await service.searchEmails();

        assert.deepEqual(result, {
            success: true,
            emails: [],
            resultCount: 0
        });
        assert.equal(api.calls.list[0].maxResults, 5);
        assert.deepEqual(api.calls.list[0].labelIds, ["INBOX"]);
    });
});

test("Gmail search caps results at twenty", async () => {
    await withGmailService({
        tokens: {
            access_token: "demo-access-token",
            scope: READ_SCOPE
        }
    }, async (service, api) => {
        await service.searchEmails({ maxResults: 100 });
        assert.equal(api.calls.list[0].maxResults, 20);
    });
});

test("Gmail search gives an actionable error when no account is connected", async () => {
    await withGmailService({}, async service => {
        await assert.rejects(
            service.searchEmails(),
            /Gmail is not connected.*api\/gmail\/auth/i
        );
    });
});

test("Gmail search requires readonly scope and sanitizes API errors", async t => {
    await t.test("requires a token that explicitly grants readonly access", async () => {
        await withGmailService({
            tokens: {
                access_token: "send-only-token",
                scope: SEND_SCOPE
            }
        }, async service => {
            await assert.rejects(
                service.searchEmails(),
                /Gmail inbox permission is missing.*reauthorize/i
            );
        });
    });

    await t.test("does not return raw Google API errors", async () => {
        const sensitiveError = new Error(
            "private email body leaked with secret-token-123"
        );
        sensitiveError.code = 500;
        await withGmailService({
            tokens: {
                access_token: "demo-access-token",
                scope: READ_SCOPE
            },
            listError: sensitiveError
        }, async service => {
            await assert.rejects(service.searchEmails(), error => {
                assert.match(error.message, /Gmail API request was unsuccessful/);
                assert.doesNotMatch(error.message, /private email|secret-token/i);
                return true;
            });
        });
    });

    await t.test("reports insufficient-scope API responses with reauthorization steps", async () => {
        const scopeError = new Error("Insufficient Permission");
        scopeError.code = 403;
        await withGmailService({
            tokens: {
                access_token: "demo-access-token",
                scope: READ_SCOPE
            },
            listError: scopeError
        }, async service => {
            await assert.rejects(
                service.searchEmails(),
                /Reauthorize.*Gmail read access/i
            );
        });
    });
});

test("Gmail search safely handles missing headers and snippets", async () => {
    await withGmailService({
        tokens: {
            access_token: "demo-access-token",
            scope: READ_SCOPE
        },
        listData: { messages: [{ id: "message-without-headers" }] },
        messageData: {
            "message-without-headers": {
                id: "message-without-headers",
                payload: {}
            }
        }
    }, async service => {
        const result = await service.searchEmails();
        assert.deepEqual(result.emails[0], {
            id: "message-without-headers",
            from: "",
            subject: "",
            date: "",
            snippet: ""
        });
    });
});

test("search_gmail is registered with a bounded read-only declaration", () => {
    const tool = validateToolName("search_gmail");
    const declaration = getToolDeclaration().functionDeclarations.find(
        item => item.name === "search_gmail"
    );
    assert.ok(tool);
    assert.ok(declaration);
    assert.match(declaration.description, /read-only/i);
    assert.equal(tool.validateArgs({}), true);
    assert.equal(tool.validateArgs({ query: "is:unread", maxResults: 20 }), true);
    assert.equal(tool.validateArgs({ query: "test", maxResults: 21 }), false);
    assert.equal(tool.validateArgs({ maxResults: 1.5 }), false);
    assert.equal(tool.validateArgs({ query: "x".repeat(501) }), false);
    assert.equal(tool.validateArgs({ arbitraryMethod: "delete" }), false);
});

test("send_email is registered but only prepares a server-side pending approval", async () => {
    const tool = validateToolName("send_email");
    const searchTool = validateToolName("search_gmail");
    const originalStatus = gmailService.gmailStatus;
    assert.ok(tool);
    assert.ok(searchTool);

    gmailService.gmailStatus = async () => ({
        configured: true,
        connected: true,
        searchAvailable: true,
        sendAvailable: true
    });

    try {
        const result = await tool.handler({
            to: "friend@example.com",
            subject: "Status update",
            body: "The project is shipping successfully."
        });

        assert.equal(result.success, true);
        assert.equal(result.requiresApproval, true);
        assert.equal(result.pendingAction.type, "send_email");
        assert.equal(result.pendingAction.payload.to, "friend@example.com");
        assert.equal(typeof result.approvalToken, "string");
        assert.equal(typeof gmailService.sendEmailViaGmail, "function");
    } finally {
        gmailService.gmailStatus = originalStatus;
    }
});

test("Gmail send requires the send scope and submits only the encoded approved message", async t => {
    await t.test("refuses a readonly-only grant without calling Gmail", async () => {
        await withGmailService({
            tokens: {
                access_token: "readonly-token",
                scope: READ_SCOPE
            }
        }, async service => {
            await assert.rejects(
                service.sendEmailViaGmail({
                    to: "friend@example.com",
                    subject: "Hello",
                    body: "Message"
                }),
                /Gmail send permission is missing/i
            );
        });
    });

    await t.test("sends a MIME message with the granted scope", async () => {
        await withGmailService({
            tokens: {
                access_token: "send-token",
                scope: BOTH_SCOPES
            }
        }, async (service, api) => {
            const result = await service.sendEmailViaGmail({
                to: "friend@example.com",
                subject: "Hello",
                body: "Message"
            });
            const raw = Buffer.from(
                api.calls.send[0].requestBody.raw,
                "base64url"
            ).toString("utf8");

            assert.deepEqual(result, { success: true });
            assert.equal(api.calls.send.length, 1);
            assert.equal(api.calls.send[0].userId, "me");
            assert.match(raw, /To: friend@example\.com/);
            assert.match(raw, /Subject: Hello/);
            assert.match(raw, /TWVzc2FnZQ==/);
            assert.equal(api.calls.send[0].fields, "id");
        });
    });

    await t.test("sanitizes Gmail errors without exposing content or credentials", async () => {
        const privateError = new Error(
            "private message body and secret-token-123"
        );
        privateError.code = 500;
        await withGmailService({
            tokens: {
                access_token: "send-token",
                scope: BOTH_SCOPES
            },
            sendError: privateError
        }, async service => {
            await assert.rejects(
                service.sendEmailViaGmail({
                    to: "friend@example.com",
                    subject: "Hello",
                    body: "Private message"
                }),
                error => {
                    assert.equal(error.sendOutcome, "unknown");
                    assert.match(error.message, /could not confirm/i);
                    assert.doesNotMatch(error.message, /private message|secret-token/i);
                    return true;
                }
            );
        });
    });
});
