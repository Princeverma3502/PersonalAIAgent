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
});
