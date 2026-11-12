
const {
    createTask,
    getTasks,
    cancelTask
} = require("../scheduler/taskScheduler");

const TOOL_REGISTRY = Object.freeze({
    get_current_time: {
        name: "get_current_time",
        description: "Returns the current date and time.",
        parametersJsonSchema: {
            type: "object",
            properties: {},
            additionalProperties: false
        },
        validateArgs: args =>
            Object.keys(args).length === 0,
        handler: async () => ({
            success: true,
            timestamp: new Date().toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        })
    },

    create_scheduled_task: {
        name: "create_scheduled_task",
        description: "Schedules a one-time task for a specified future date and time. The runAt value must be an ISO 8601 timestamp with a timezone offset.",
        parametersJsonSchema: {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    description: "Short task title."
                },
                description: {
                    type: "string",
                    description: "What should happen when the task becomes due."
                },
                runAt: {
                    type: "string",
                    description: "Future ISO 8601 date-time including timezone offset."
                }
            },
            required: ["title", "description", "runAt"],
            additionalProperties: false
        },
        validateArgs: args =>
            Object.keys(args).length === 3 &&
            typeof args.title === "string" &&
            typeof args.description === "string" &&
            typeof args.runAt === "string",
        handler: async args => ({
            success: true,
            task: await createTask(args)
        })
    },

    list_scheduled_tasks: {
        name: "list_scheduled_tasks",
        description: "Lists all scheduled tasks and their statuses.",
        parametersJsonSchema: {
            type: "object",
            properties: {},
            additionalProperties: false
        },
        validateArgs: args =>
            Object.keys(args).length === 0,
        handler: async () => ({
            success: true,
            tasks: await getTasks()
        })
    },

    cancel_scheduled_task: {
        name: "cancel_scheduled_task",
        description: "Cancels a pending scheduled task using its task ID.",
        parametersJsonSchema: {
            type: "object",
            properties: {
                taskId: {
                    type: "string",
                    description: "ID of the task to cancel."
                }
            },
            required: ["taskId"],
            additionalProperties: false
        },
        validateArgs: args =>
            Object.keys(args).length === 1 &&
            typeof args.taskId === "string" &&
            args.taskId.trim().length > 0,
        handler: async args => cancelTask(args.taskId)
    }
});

function getToolDeclaration() {
    return {
        functionDeclarations: Object.values(TOOL_REGISTRY).map(
            ({ name, description, parametersJsonSchema }) => ({
                name,
                description,
                parametersJsonSchema
            })
        )
    };
}

function validateToolName(name) {
    if (typeof name !== "string") return null;
    return TOOL_REGISTRY[name] || null;
}

module.exports = {
    TOOL_REGISTRY,
    getToolDeclaration,
    validateToolName
};
