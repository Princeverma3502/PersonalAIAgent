
const { FunctionCallingConfigMode } = require("@google/genai");
const { getToolDeclaration, validateToolName } = require("./tools");

const GENERATE_CONTENT_TIMEOUT_MS = 15000;

async function executeRegisteredTool(functionCall) {
    if (!functionCall || typeof functionCall.name !== "string") {
        return {
            status: "failed",
            error: "Invalid tool call request."
        };
    }

    const tool = validateToolName(functionCall.name);

    if (!tool) {
        return {
            status: "failed",
            error: `Unknown tool: ${functionCall.name}`
        };
    }

    const args = functionCall.args || {};

    if (
        typeof args !== "object" ||
        Array.isArray(args) ||
        Object.keys(args).length > 0
    ) {
        return {
            status: "failed",
            error: `Tool ${functionCall.name} does not accept arguments.`
        };
    }

    try {
        const result = await tool.handler();

        return {
            status: "success",
            toolName: functionCall.name,
            result
        };
    } catch (error) {
        console.error(
            `Tool execution failed for ${functionCall.name}:`,
            error.message
        );

        return {
            status: "failed",
            toolName: functionCall.name,
            error: "Tool execution failed."
        };
    }
}

async function runAgentTurn({ ai, message, modelList }) {
    const trimmedMessage =
        typeof message === "string" ? message.trim() : "";

    if (!trimmedMessage || trimmedMessage.length > 4000) {
        return {
            success: false,
            reply: "Please provide a valid message (maximum 4000 characters).",
            status: "failed",
            toolCall: null
        };
    }

    let lastError;

    for (const model of modelList) {
        try {
            const abortController = new AbortController();
            const timeoutHandle = setTimeout(
                () => abortController.abort(),
                GENERATE_CONTENT_TIMEOUT_MS
            );
            let initialResponse;

            try {
                initialResponse = await ai.models.generateContent({
                    model,
                    contents: trimmedMessage,
                    config: {
                        abortSignal: abortController.signal,
                        tools: [getToolDeclaration()],
                        toolConfig: {
                            functionCallingConfig: {
                                mode: FunctionCallingConfigMode.AUTO
                            }
                        },
                        httpOptions: {
                            retryOptions: {
                                attempts: 1
                            }
                        }
                    },
                });
            } finally {
                clearTimeout(timeoutHandle);
            }

            const functionCalls = Array.isArray(initialResponse.functionCalls)
                ? initialResponse.functionCalls
                : [];

            // Gemini answered without using a tool.
            if (functionCalls.length === 0) {
                return {
                    success: true,
                    reply: initialResponse.text || "",
                    status: "no_tool_used",
                    toolCall: null
                };
            }

            // Execute only the first requested tool.
            const functionCall = functionCalls[0];


            const functionResult =
                await executeRegisteredTool(functionCall);

            if (functionResult.status !== "success") {
                return {
                    success: false,
                    reply: "The requested tool could not be completed.",
                    status: "failed",
                    toolCall: {
                        name: functionCall.name || "unknown_tool",
                        status: "failed",
                        result: null,
                        error:
                            functionResult.error || "Tool execution failed."
                    }
                };
            }

            // Return the tool result directly.
            // No second Gemini API request is made.
            const result = functionResult.result;

            return {
                success: true,
                reply: `The current time is ${result.timestamp} (${result.timezone}).`,
                status: "completed",
                toolCall: {
                    name: functionCall.name,
                    status: "success",
                    result
                }
            };

        } catch (error) {
            lastError = error;

            if (
                [
                    "APIConnectionTimeoutError",
                    "APIUserAbortError",
                    "RequestTimeoutError",
                    "TimeoutError",
                    "AbortError"
                ].includes(error?.name)
            ) {
                console.error(
                    `Gemini model ${model} timed out after ${GENERATE_CONTENT_TIMEOUT_MS} ms; falling back to the next model.`
                );
                continue;
            }

            let status = Number(error?.status);

            if (!status && error?.message) {
                try {
                    status = Number(
                        JSON.parse(error.message)?.error?.code
                    );
                } catch (_) {
                    status = undefined;
                }
            }

            if (![429, 500, 502, 503, 504].includes(status)) {
                console.error(
                    "Gemini agent request failed:",
                    error?.message || "Unknown error"
                );
                break;
            }

            console.error(
                `Model ${model} failed for agent request. Status: ${status}; falling back to the next model.`
            );
        }
    }

    console.error(
        "All configured Gemini models failed for agent request:",
        lastError?.message || "Unknown error"
    );

    return {
        success: false,
        reply: "The AI service is currently unavailable. Please try again shortly.",
        status: "failed",
        toolCall: null
    };
}

module.exports = {
    runAgentTurn
};
