const assert = require("node:assert/strict");
const { test } = require("node:test");

let taskHandlers = {};
const schedulerPath = require.resolve("../src/scheduler/taskScheduler");
require(schedulerPath);
require.cache[schedulerPath].exports = {
    createTask: (...args) => taskHandlers.createTask(...args),
    createRecurringTask: (...args) =>
        taskHandlers.createRecurringTask(...args),
    getTasks: (...args) => taskHandlers.getTasks(...args),
    cancelTask: (...args) => taskHandlers.cancelTask(...args)
};

const { runAgentTurn } = require("../src/agent/agentService");
const { TOOL_REGISTRY } = require("../src/agent/tools");
const gmailService = require("../src/gmail/gmailService");
const {
    classifyGeminiError,
    safeProviderError
} = require("../src/agent/geminiError");

function functionCallResponse(calls) {
    return {
        functionCalls: calls,
        candidates: [{
            content: {
                role: "model",
                parts: calls.map(functionCall => ({ functionCall }))
            }
        }]
    };
}

function createMockAi(responses, onRequest = () => {}) {
    return {
        models: {
            generateContent: async request => {
                onRequest(request);
                const response = responses.shift();
                if (response instanceof Error) throw response;
                return response;
            }
        }
    };
}

async function runAgent(
    ai,
    modelList = ["test-model"],
    message = "Please cancel my task."
) {
    return runAgentTurn({
        ai,
        message,
        modelList
    });
}

test("agent tool and provider error handling", async t => {
    taskHandlers = {
        createTask: async () => {
            throw new Error("Task execution time must be in the future.");
        },
        createRecurringTask: async args => ({
            id: "recurring-task",
            title: args.title,
            runAt: "2099-01-01T03:30:00.000Z",
            recurrence: {
                cronExpression: args.cronExpression,
                timeZone: args.timeZone
            }
        }),
        getTasks: async () => [],
        cancelTask: async taskId => taskId === "valid"
            ? { success: true, message: "Task cancelled." }
            : { success: false, message: "Pending task not found." }
    };

    await t.test("reports handler failure and sends its error to Gemini", async () => {
        let followUpContents;
        const ai = createMockAi([
            functionCallResponse([{
                name: "cancel_scheduled_task",
                args: { taskId: "missing" }
            }]),
            { text: "The task was cancelled." }
        ], request => {
            followUpContents = request.contents;
        });

        const result = await runAgent(ai);

        const functionResponse = followUpContents.at(-1)
            .parts[0].functionResponse.response;

        assert.equal(functionResponse.success, false);
        assert.equal(functionResponse.error, "Pending task not found.");
        assert.equal(result.success, false);
        assert.equal(result.toolCalls[0].status, "failed");
        assert.match(result.reply, /Pending task not found/);
        assert.doesNotMatch(result.reply, /The task was cancelled/);
    });

    await t.test("records thrown handler errors as failed tool calls", async () => {
        const ai = createMockAi([
            functionCallResponse([{
                name: "create_scheduled_task",
                args: {
                    title: "Test",
                    description: "Test",
                    runAt: "not-a-date"
                }
            }]),
            { text: "Created." }
        ]);

        const result = await runAgent(ai);

        assert.equal(result.success, false);
        assert.equal(result.toolCalls[0].status, "failed");
        assert.match(result.toolCalls[0].error, /future/);
        assert.match(result.reply, /future/);
    });

    await t.test("a corrected successful retry clears the unresolved failure", async () => {
        const ai = createMockAi([
            functionCallResponse([{
                name: "cancel_scheduled_task",
                args: { taskId: "missing" }
            }]),
            functionCallResponse([{
                name: "cancel_scheduled_task",
                args: { taskId: "valid" }
            }]),
            { text: "The task was cancelled." }
        ]);

        const result = await runAgent(ai);

        assert.equal(result.success, true);
        assert.deepEqual(
            result.toolCalls.map(call => call.status),
            ["failed", "success"]
        );
        assert.equal(result.toolCalls.length, 2);
    });

    await t.test("preserves every call in a multi-tool response", async () => {
        const ai = createMockAi([
            functionCallResponse([
                {
                    name: "cancel_scheduled_task",
                    args: { taskId: "missing" }
                },
                {
                    name: "list_scheduled_tasks",
                    args: {}
                }
            ]),
            { text: "I checked your tasks." }
        ]);

        const result = await runAgent(ai);

        assert.equal(result.toolCalls.length, 2);
        assert.deepEqual(
            result.toolCalls.map(call => call.status),
            ["failed", "success"]
        );
        assert.equal(result.success, false);
    });

    await t.test("does not let a same-round success hide another operation's failure", async () => {
        const ai = createMockAi([
            functionCallResponse([
                {
                    name: "cancel_scheduled_task",
                    args: { taskId: "missing" }
                },
                {
                    name: "cancel_scheduled_task",
                    args: { taskId: "valid" }
                }
            ]),
            { text: "Both tasks were cancelled." }
        ]);

        const result = await runAgent(ai);

        assert.deepEqual(
            result.toolCalls.map(call => call.status),
            ["failed", "success"]
        );
        assert.equal(result.success, false);
        assert.match(result.reply, /Pending task not found/);
        assert.doesNotMatch(result.reply, /Both tasks were cancelled/);
    });

    await t.test("does not resolve multiple failures with one unrelated success", async () => {
        const ai = createMockAi([
            functionCallResponse([
                {
                    name: "cancel_scheduled_task",
                    args: { taskId: "missing-one" }
                },
                {
                    name: "cancel_scheduled_task",
                    args: { taskId: "missing-two" }
                }
            ]),
            functionCallResponse([{
                name: "cancel_scheduled_task",
                args: { taskId: "valid" }
            }]),
            { text: "The requested tasks were cancelled." }
        ]);

        const result = await runAgent(ai);

        assert.deepEqual(
            result.toolCalls.map(call => call.status),
            ["failed", "failed", "success"]
        );
        assert.equal(result.success, false);
        assert.equal((result.reply.match(/Pending task not found/g) || []).length, 2);
    });

    await t.test("shows a validated email draft verbatim and makes clear it was not sent", async () => {
        const draft = {
            to: "person@example.com",
            subject: "Project update",
            body: "Hello,\n\nHere is the update."
        };
        const ai = createMockAi([
            functionCallResponse([{
                name: "draft_email",
                args: draft
            }]),
            { text: "The email was sent successfully." }
        ]);

        const result = await runAgent(ai);

        assert.equal(result.success, true);
        assert.equal(result.toolCalls[0].status, "success");
        assert.deepEqual(result.toolCalls[0].result.draft, draft);
        assert.match(result.reply, /Email draft prepared — NOT SENT\./);
        assert.match(result.reply, /To: person@example\.com/);
        assert.match(result.reply, /Subject: Project update/);
        assert.match(result.reply, /Hello,\n\nHere is the update\./);
        assert.doesNotMatch(result.reply, /email was sent successfully/i);
    });

    await t.test("rejects malformed email recipients without preparing a draft", async () => {
        let followUpContents;
        const ai = createMockAi([
            functionCallResponse([{
                name: "draft_email",
                args: {
                    to: "not-an-email",
                    subject: "Project update",
                    body: "Hello."
                }
            }]),
            { text: "The draft is ready." }
        ], request => {
            followUpContents = request.contents;
        });

        const result = await runAgent(ai);

        const functionResponse = followUpContents.at(-1)
            .parts[0].functionResponse.response;
        assert.equal(functionResponse.success, false);
        assert.match(functionResponse.error, /Invalid arguments/);
        assert.equal(result.success, false);
        assert.equal(result.toolCalls[0].status, "failed");
        assert.match(result.reply, /Invalid arguments/);
    });

    await t.test("does not browse a URL the user did not explicitly provide", async () => {
        let followUpContents;
        const ai = createMockAi([
            functionCallResponse([{
                name: "read_public_webpage",
                args: { url: "https://example.com/" }
            }]),
            { text: "The page says it is available." }
        ], request => {
            followUpContents = request.contents;
        });

        const result = await runAgent(
            ai,
            ["test-model"],
            "Please read the latest news."
        );

        const functionResponse = followUpContents.at(-1)
            .parts[0].functionResponse.response;
        assert.equal(functionResponse.success, false);
        assert.match(functionResponse.error, /exact public webpage URL/);
        assert.equal(result.success, false);
        assert.equal(result.toolCalls[0].status, "failed");
        assert.match(result.reply, /exact public webpage URL/);
    });

    await t.test("reads a bounded batch of explicitly provided webpages without another tool round", async () => {
        const originalHandler =
            TOOL_REGISTRY.read_public_webpages.handler;
        TOOL_REGISTRY.read_public_webpages.handler = async ({ urls }) => ({
            success: true,
            pages: urls.map((url, index) => ({
                success: true,
                url,
                title: `Page ${index + 1}`,
                text: `Content ${index + 1}.`
            }))
        });

        try {
            let requestCount = 0;
            const ai = createMockAi([
                functionCallResponse([{
                    name: "read_public_webpages",
                    args: {
                        urls: [
                            "https://example.com/",
                            "https://example.org/about"
                        ]
                    }
                }]),
                functionCallResponse([{
                    name: "cancel_scheduled_task",
                    args: { taskId: "valid" }
                }])
            ], () => {
                requestCount += 1;
            });

            const result = await runAgent(
                ai,
                ["test-model"],
                "Compare https://example.com/ with https://example.org/about"
            );

            assert.equal(requestCount, 1);
            assert.equal(result.success, true);
            assert.equal(result.toolCalls.length, 1);
            assert.equal(result.toolCalls[0].name, "read_public_webpages");
            assert.match(result.reply, /Read-only webpage 1: Page 1/);
            assert.match(result.reply, /URL: https:\/\/example\.com\//);
            assert.match(result.reply, /Content 1\./);
            assert.match(result.reply, /Read-only webpage 2: Page 2/);
            assert.match(result.reply, /URL: https:\/\/example\.org\/about/);
            assert.match(result.reply, /Content 2\./);
        } finally {
            TOOL_REGISTRY.read_public_webpages.handler = originalHandler;
        }
    });

    await t.test("rejects a webpage batch containing any URL not supplied by the user", async () => {
        const ai = createMockAi([
            functionCallResponse([{
                name: "read_public_webpages",
                args: {
                    urls: [
                        "https://example.com/",
                        "https://example.org/"
                    ]
                }
            }]),
            { text: "Both pages were read." }
        ]);

        const result = await runAgent(
            ai,
            ["test-model"],
            "Read https://example.com/"
        );

        assert.equal(result.success, false);
        assert.equal(result.toolCalls[0].status, "failed");
        assert.match(result.reply, /provide every exact public webpage URL/);
    });

    await t.test("enforces distinct safe webpage URLs and a three-page maximum", () => {
        const validate = TOOL_REGISTRY.read_public_webpages.validateArgs;

        assert.equal(validate({ urls: ["https://example.com/"] }), true);
        assert.equal(validate({
            urls: [
                "https://example.com/",
                "https://example.org/",
                "https://example.net/"
            ]
        }), true);
        assert.equal(validate({
            urls: [
                "https://example.com/",
                "https://example.org/",
                "https://example.net/",
                "https://example.edu/"
            ]
        }), false);
        assert.equal(validate({
            urls: ["https://example.com/", "https://example.com/"]
        }), false);
        assert.equal(validate({ urls: ["http://127.0.0.1/"] }), false);
    });

    await t.test("reads linked pages only from an explicitly provided seed and without a follow-up round", async () => {
        const originalHandler =
            TOOL_REGISTRY.read_public_linked_pages.handler;
        TOOL_REGISTRY.read_public_linked_pages.handler = async ({ url }) => ({
            success: true,
            pages: [
                {
                    url,
                    title: "Starting page",
                    text: "Starting content."
                },
                {
                    url: "https://example.com/related",
                    title: "Related page",
                    text: "Related content."
                }
            ]
        });

        try {
            let requestCount = 0;
            const ai = createMockAi([
                functionCallResponse([{
                    name: "read_public_linked_pages",
                    args: { url: "https://example.com/" }
                }]),
                functionCallResponse([{
                    name: "cancel_scheduled_task",
                    args: { taskId: "valid" }
                }])
            ], () => {
                requestCount += 1;
            });

            const result = await runAgent(
                ai,
                ["test-model"],
                "Follow links from https://example.com/ and summarize the related page."
            );

            assert.equal(requestCount, 1);
            assert.equal(result.success, true);
            assert.equal(result.toolCalls[0].name, "read_public_linked_pages");
            assert.match(result.reply, /Starting content/);
            assert.match(result.reply, /Related content/);
        } finally {
            TOOL_REGISTRY.read_public_linked_pages.handler = originalHandler;
        }
    });

    await t.test("rejects linked-page reads when the seed URL was not supplied", async () => {
        const ai = createMockAi([
            functionCallResponse([{
                name: "read_public_linked_pages",
                args: { url: "https://example.com/" }
            }]),
            { text: "I followed the page links." }
        ]);

        const result = await runAgent(
            ai,
            ["test-model"],
            "Follow links from the article you find."
        );

        assert.equal(result.success, false);
        assert.equal(result.toolCalls[0].status, "failed");
        assert.match(result.reply, /exact public webpage URL/);
    });

    await t.test("does not follow links unless the user explicitly asks", async () => {
        for (const message of [
            "Read https://example.com/",
            "Read https://example.com/ but do not follow links."
        ]) {
            const result = await runAgent(
                createMockAi([
                    functionCallResponse([{
                        name: "read_public_linked_pages",
                        args: { url: "https://example.com/" }
                    }]),
                    { text: "I read the links from the page." }
                ]),
                ["test-model"],
                message
            );

            assert.equal(result.success, false);
            assert.equal(result.toolCalls[0].status, "failed");
            assert.match(
                result.reply,
                /explicitly ask me to follow or read links/
            );
        }
    });

    await t.test("does not give webpage content another tool-execution round", async () => {
        const originalHandler =
            TOOL_REGISTRY.read_public_webpage.handler;
        TOOL_REGISTRY.read_public_webpage.handler = async () => ({
            success: true,
            url: "https://example.com/",
            title: "Example page",
            text: "Page content."
        });

        try {
            let requestCount = 0;
            const ai = createMockAi([
                functionCallResponse([{
                    name: "read_public_webpage",
                    args: { url: "https://example.com/" }
                }]),
                functionCallResponse([{
                    name: "cancel_scheduled_task",
                    args: { taskId: "valid" }
                }])
            ], () => {
                requestCount += 1;
            });

            const result = await runAgent(
                ai,
                ["test-model"],
                "Read https://example.com/"
            );

            assert.equal(requestCount, 1);
            assert.equal(result.toolCalls.length, 1);
            assert.equal(result.toolCalls[0].name, "read_public_webpage");
            assert.match(result.reply, /Page content\./);
        } finally {
            TOOL_REGISTRY.read_public_webpage.handler = originalHandler;
        }
    });

    await t.test("uses the Android timezone for recurring reminder tools", async () => {
        let initialPrompt;
        const ai = createMockAi([
            functionCallResponse([{
                name: "create_recurring_task",
                args: {
                    title: "Morning reminder",
                    description: "Review today's plan.",
                    cronExpression: "0 9 * * *",
                    timeZone: "Asia/Kolkata"
                }
            }]),
            { text: "The reminder is scheduled." }
        ], request => {
            initialPrompt = request.contents[0].parts[0].text;
        });

        const result = await runAgentTurn({
            ai,
            message: "Remind me every morning at 9.",
            timeZone: "Asia/Kolkata",
            modelList: ["test-model"]
        });

        assert.match(initialPrompt, /user's IANA timezone is Asia\/Kolkata/);
        assert.equal(result.success, true);
        assert.equal(result.toolCalls[0].name, "create_recurring_task");
        assert.equal(
            result.toolCalls[0].result.task.recurrence.timeZone,
            "Asia/Kolkata"
        );
        assert.match(result.reply, /only displays a reminder/);
        assert.doesNotMatch(result.reply, /The reminder is scheduled/);
    });

    await t.test("requires a user-provided URL when scheduling webpage summaries", async () => {
        const previousCreateTask = taskHandlers.createTask;
        let createTaskCalls = 0;
        taskHandlers.createTask = async args => {
            createTaskCalls += 1;
            return {
                id: "scheduled-workflow",
                ...args,
                status: "pending"
            };
        };

        try {
            const call = {
                name: "create_scheduled_webpage_summary",
                args: {
                    title: "Daily release summary",
                    url: "https://example.com/news",
                    runAt: "2099-01-01T09:00:00Z"
                }
            };
            const rejected = await runAgentTurn({
                ai: createMockAi([
                    functionCallResponse([call]),
                    { text: "Scheduled." }
                ]),
                message: "Schedule a daily summary of the news page.",
                modelList: ["test-model"]
            });

            assert.equal(rejected.success, false);
            assert.equal(rejected.toolCalls[0].status, "failed");
            assert.equal(createTaskCalls, 0);

            const accepted = await runAgentTurn({
                ai: createMockAi([
                    functionCallResponse([call]),
                    { text: "Scheduled." }
                ]),
                message: "Schedule a daily summary of https://example.com/news",
                modelList: ["test-model"]
            });

            assert.equal(accepted.success, true);
            assert.equal(createTaskCalls, 1);
            assert.equal(
                accepted.toolCalls[0].result.task.workflow.url,
                "https://example.com/news"
            );
            assert.match(accepted.reply, /read-only public webpage summary workflow/);
        } finally {
            taskHandlers.createTask = previousCreateTask;
        }
    });

    await t.test("falls through models in order and classifies quota errors", async () => {
        const attemptedModels = [];
        const quotaError = Object.assign(new Error(JSON.stringify({
            error: {
                code: 429,
                status: "RESOURCE_EXHAUSTED",
                message: "Quota exceeded",
                details: [{
                    "@type": "type.googleapis.com/google.rpc.RetryInfo",
                    retryDelay: "2s"
                }]
            }
        })), { status: 429 });
        const ai = createMockAi([
            quotaError,
            { text: "Ready." }
        ], request => {
            attemptedModels.push(request.model);
        });

        const result = await runAgent(
            ai,
            ["gemini-first", "gemini-second", "gemini-third"]
        );

        assert.deepEqual(attemptedModels, ["gemini-first", "gemini-second"]);
        assert.equal(result.success, true);
        assert.equal(classifyGeminiError(quotaError).category, "quota_exhausted");
        assert.equal(classifyGeminiError(quotaError).retryDelayMs, 2000);
    });

    await t.test("redacts API keys from provider diagnostics", () => {
        const error = new Error("Invalid key AIza123456789012345678901234567890");
        const details = safeProviderError(error);

        assert.doesNotMatch(details.message, /AIza/);
        assert.match(details.message, /\[REDACTED\]/);
    });

    await t.test("distinguishes provider failure categories", () => {
        assert.equal(
            classifyGeminiError({ status: 401, message: "Unauthorized" }).category,
            "invalid_api_key"
        );
        assert.equal(
            classifyGeminiError({ status: 404, message: "Model not found" }).category,
            "model_not_found"
        );
        assert.equal(
            classifyGeminiError({ status: 429, message: "Rate limit exceeded" }).category,
            "rate_limited"
        );
        assert.equal(
            classifyGeminiError({ status: 503, message: "Service unavailable" }).category,
            "temporary_overload"
        );
    });

    await t.test("invokes Gmail search and returns its structured result to Gemini", async () => {
        const previousSearchEmails = gmailService.searchEmails;
        const requests = [];
        gmailService.searchEmails = async args => ({
            success: true,
            emails: [{
                id: "message-1",
                from: "sender@example.com",
                subject: "Invoice",
                date: "Fri, 13 Nov 2026 10:00:00 +0000",
                snippet: "Your invoice is ready."
            }],
            resultCount: 1,
            query: args.query
        });

        try {
            const ai = createMockAi([
                functionCallResponse([{
                    name: "search_gmail",
                    args: { query: "from:sender@example.com", maxResults: 5 }
                }]),
                { text: "I found one recent invoice email." }
            ], request => requests.push(request));

            const result = await runAgent(
                ai,
                ["test-model"],
                "Search my Gmail for messages from sender@example.com"
            );
            const functionResponse = requests[1].contents.at(-1)
                .parts[0].functionResponse.response;

            assert.equal(result.success, true);
            assert.equal(result.toolCalls[0].name, "search_gmail");
            assert.equal(functionResponse.success, true);
            assert.equal(functionResponse.result.resultCount, 1);
            assert.equal(functionResponse.result.emails[0].subject, "Invoice");
            assert.ok(requests[0].config.tools[0].functionDeclarations.some(
                declaration => declaration.name === "search_gmail"
            ));
        } finally {
            gmailService.searchEmails = previousSearchEmails;
        }
    });

    await t.test("does not claim Gmail was searched when the search tool was skipped", async () => {
        const ai = createMockAi([
            { text: "I searched your Gmail and found three emails." }
        ]);
        const result = await runAgent(
            ai,
            ["test-model"],
            "Check my Gmail inbox for unread mail"
        );

        assert.equal(result.success, false);
        assert.equal(result.status, "failed");
        assert.match(result.reply, /search tool was not run/i);
        assert.equal(result.toolCalls.length, 0);
    });

    await t.test("does not claim success when Gmail search fails", async () => {
        const previousSearchEmails = gmailService.searchEmails;
        gmailService.searchEmails = async () => {
            throw new Error(
                "Gmail inbox permission is missing. Reauthorize to grant Gmail read access."
            );
        };

        try {
            const ai = createMockAi([
                functionCallResponse([{
                    name: "search_gmail",
                    args: { query: "is:unread" }
                }]),
                { text: "I searched your Gmail and found no unread messages." }
            ]);
            const result = await runAgent(
                ai,
                ["test-model"],
                "Search Gmail for unread messages"
            );

            assert.equal(result.success, false);
            assert.equal(result.status, "failed");
            assert.match(result.reply, /permission is missing/i);
            assert.doesNotMatch(result.reply, /found no unread messages/i);
        } finally {
            gmailService.searchEmails = previousSearchEmails;
        }
    });

    await t.test("blocks email sending during a Gmail inbox search request", async () => {
        const ai = createMockAi([
            functionCallResponse([{
                name: "send_email",
                args: {
                    to: "recipient@example.com",
                    subject: "Hello",
                    body: "Message body"
                }
            }]),
            { text: "I sent an email." }
        ]);
        const result = await runAgent(
            ai,
            ["test-model"],
            "Search my Gmail for unread messages"
        );

        assert.equal(result.success, false);
        assert.match(result.reply, /not allowed as part of a read-only/i);
    });

    await t.test("returns pending email approval to the app without sending or exposing its token to Gemini", async () => {
        const previousStatus = gmailService.gmailStatus;
        const previousSend = gmailService.sendEmailViaGmail;
        const requests = [];
        let sendCalls = 0;
        gmailService.gmailStatus = async () => ({
            configured: true,
            connected: true,
            searchAvailable: true,
            sendAvailable: true
        });
        gmailService.sendEmailViaGmail = async () => {
            sendCalls += 1;
            throw new Error("The agent must not send directly.");
        };

        try {
            const ai = createMockAi([
                functionCallResponse([{
                    name: "send_email",
                    args: {
                        to: "recipient@example.com",
                        subject: "Hello",
                        body: "Message body"
                    }
                }]),
                { text: "I sent an email." }
            ], request => requests.push(request));
            const result = await runAgent(
                ai,
                ["test-model"],
                "Send an email to recipient@example.com"
            );

            assert.equal(result.success, true);
            assert.equal(result.status, "pending_approval");
            assert.equal(result.pendingAction.type, "send_email");
            assert.deepEqual(result.pendingAction.payload, {
                to: "recipient@example.com",
                subject: "Hello",
                body: "Message body"
            });
            assert.equal(typeof result.pendingAction.approvalToken, "string");
            assert.equal(result.toolCalls[0].status, "pending_approval");
            assert.doesNotMatch(
                JSON.stringify(result.toolCalls),
                new RegExp(result.pendingAction.approvalToken)
            );
            assert.equal(requests.length, 1);
            assert.doesNotMatch(
                JSON.stringify(requests),
                new RegExp(result.pendingAction.approvalToken)
            );
            assert.equal(sendCalls, 0);
        } finally {
            gmailService.gmailStatus = previousStatus;
            gmailService.sendEmailViaGmail = previousSend;
        }
    });

    await t.test("preserves compose approval after overload fallback selects draft_email", async () => {
        const previousStatus = gmailService.gmailStatus;
        const previousSend = gmailService.sendEmailViaGmail;
        const attemptedModels = [];
        let sendCalls = 0;
        gmailService.gmailStatus = async () => ({
            configured: true,
            connected: true,
            searchAvailable: true,
            sendAvailable: true
        });
        gmailService.sendEmailViaGmail = async () => {
            sendCalls += 1;
            throw new Error("The agent must not send directly.");
        };

        const aborted = Object.assign(
            new Error("operation aborted"),
            { name: "APIUserAbortError" }
        );
        const overloaded = Object.assign(
            new Error("Service temporarily unavailable"),
            { status: 503 }
        );

        try {
            const ai = createMockAi([
                overloaded,
                aborted,
                functionCallResponse([{
                    name: "draft_email",
                    args: {
                        to: "user@example.com",
                        subject: "AURVIZ Email Test",
                        body: "This email was sent through my Personal AI Agent."
                    }
                }])
            ], request => attemptedModels.push(request.model));

            const result = await runAgent(
                ai,
                ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"],
                "Compose an email to my own Gmail address with subject AURVIZ Email Test and body This email was sent through my Personal AI Agent. Show me the approval dialog before sending."
            );

            assert.deepEqual(attemptedModels, [
                "gemini-3.8-flash",
                "gemini-3.6-flash",
                "gemini-3.5-flash-lite"
            ]);
            assert.equal(result.success, true);
            assert.equal(result.status, "pending_approval");
            assert.equal(result.pendingAction.type, "send_email");
            assert.deepEqual(result.pendingAction.payload, {
                to: "user@example.com",
                subject: "AURVIZ Email Test",
                body: "This email was sent through my Personal AI Agent."
            });
            assert.equal(typeof result.pendingAction.approvalToken, "string");
            assert.equal(result.toolCalls[0].name, "send_email");
            assert.equal(result.toolCalls[0].status, "pending_approval");
            assert.equal(sendCalls, 0);
        } finally {
            gmailService.gmailStatus = previousStatus;
            gmailService.sendEmailViaGmail = previousSend;
        }
    });

    await t.test("instructs Gemini not to claim persistent memory was written", async () => {
        const requests = [];
        const ai = createMockAi([
            { text: "I do not have a persistent memory-writing tool." }
        ], request => requests.push(request));
        const result = await runAgent(
            ai,
            ["test-model"],
            "Remember that I prefer tea."
        );

        const prompt = requests[0].contents[0].parts[0].text;
        assert.match(prompt, /no tool to write to the Android memory database/i);
        assert.match(prompt, /Never claim that a memory was saved/i);
        assert.equal(result.toolCalls.length, 0);
    });

});
