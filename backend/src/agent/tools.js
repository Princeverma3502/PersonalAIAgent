
const {
    createTask,
    getTasks,
    cancelTask
} = require("../scheduler/taskScheduler");

function isValidEmailDraft(args) {
    const recipient = args.to;
    const subject = args.subject;
    const body = args.body;

    return (
        Object.keys(args).length === 3 &&
        typeof recipient === "string" &&
        recipient.length <= 254 &&
        /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient.trim()) &&
        typeof subject === "string" &&
        subject.trim().length > 0 &&
        subject.trim().length <= 200 &&
        !/[\r\n]/.test(subject) &&
        typeof body === "string" &&
        body.trim().length > 0 &&
        body.length <= 10000
    );
}

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
        description: "Schedules a one-time in-app reminder for a specified future date and time. The runAt value must be an ISO 8601 timestamp with a timezone offset.",
        parametersJsonSchema: {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    description: "Short task title."
                },
                description: {
                    type: "string",
                    description: "Reminder message to display in the Android app when due."
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
    },

    draft_email: {
        name: "draft_email",
        description: "Prepares an email draft for the user to review. This tool never sends email.",
        parametersJsonSchema: {
            type: "object",
            properties: {
                to: {
                    type: "string",
                    description: "Recipient email address."
                },
                subject: {
                    type: "string",
                    description: "Email subject, up to 200 characters."
                },
                body: {
                    type: "string",
                    description: "Complete email message, up to 10000 characters."
                }
            },
            required: ["to", "subject", "body"],
            additionalProperties: false
        },
        validateArgs: isValidEmailDraft,
        handler: async args => ({
            success: true,
            message: "Draft prepared for review. It has not been sent.",
            draft: {
                to: args.to.trim(),
                subject: args.subject.trim(),
                body: args.body.trim()
            }
        })
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
