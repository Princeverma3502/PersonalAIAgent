const assert = require("node:assert/strict");
const { test } = require("node:test");

let taskHandlers = {};
const schedulerPath = require.resolve("../src/scheduler/taskScheduler");
require(schedulerPath);
require.cache[schedulerPath].exports = {
    createTask: (...args) => taskHandlers.createTask(...args),
    getTasks: (...args) => taskHandlers.getTasks(...args),
    cancelTask: (...args) => taskHandlers.cancelTask(...args)
};

const { runAgentTurn } = require("../src/agent/agentService");
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

async function runAgent(ai, modelList = ["test-model"]) {
    return runAgentTurn({
        ai,
        message: "Please cancel my task.",
        modelList
    });
}

test("agent tool and provider error handling", async t => {
    taskHandlers = {
        createTask: async () => {
            throw new Error("Task execution time must be in the future.");
        },
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
