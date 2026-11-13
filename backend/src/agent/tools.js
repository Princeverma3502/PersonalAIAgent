
const {
    createTask,
    createRecurringTask,
    getTasks,
    cancelTask
} = require("../scheduler/taskScheduler");
const {
    readPublicPage,
    readLinkedPublicPages,
    validateWebUrl
} = require("./browserService");
const gmailService = require("../gmail/gmailService");
const { createPendingEmailApproval } = require("./actionApproval");
const EMAIL_ADDRESS_PATTERN =
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

function isValidEmailDraft(args) {
    const recipient = args.to;
    const subject = args.subject;
    const body = args.body;

    return (
        Object.keys(args).length === 3 &&
        typeof recipient === "string" &&
        recipient.length <= 254 &&
        EMAIL_ADDRESS_PATTERN.test(recipient.trim()) &&
        typeof subject === "string" &&
        subject.trim().length > 0 &&
        subject.trim().length <= 200 &&
        !/[\r\n]/.test(subject) &&
        typeof body === "string" &&
        body.trim().length > 0 &&
        body.length <= 10000
    );
}

function isValidWebPageRequest(args) {
    const keys = Object.keys(args);
    if (
        keys.length < 1 ||
        keys.length > 2 ||
        !keys.every(key => ["url", "searchTerm"].includes(key)) ||
        typeof args.url !== "string"
    ) {
        return false;
    }

    if (
        Object.prototype.hasOwnProperty.call(args, "searchTerm") &&
        (
            typeof args.searchTerm !== "string" ||
            args.searchTerm.length > 100 ||
            args.searchTerm.trim().length === 0 ||
            args.searchTerm.trim().length > 100
        )
    ) {
        return false;
    }

    try {
        validateWebUrl(args.url);
        return true;
    } catch {
        return false;
    }
}

function isValidWebPageBatch(args) {
    if (
        Object.keys(args).length !== 1 ||
        !Array.isArray(args.urls) ||
        args.urls.length < 1 ||
        args.urls.length > 3
    ) {
        return false;
    }

    const normalizedUrls = [];
    for (const url of args.urls) {
        if (!isValidWebPageRequest({ url })) return false;
        normalizedUrls.push(validateWebUrl(url).href);
    }

    return new Set(normalizedUrls).size === normalizedUrls.length;
}

function isValidGmailSearch(args) {
    const keys = Object.keys(args);
    return (
        keys.every(key => ["query", "maxResults"].includes(key)) &&
        (args.query === undefined ||
            (typeof args.query === "string" && args.query.length <= 500)) &&
        (args.maxResults === undefined ||
            (Number.isInteger(args.maxResults) &&
                args.maxResults >= 1 &&
                args.maxResults <= 20))
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

    create_recurring_task: {
        name: "create_recurring_task",
        description: "Creates a recurring in-app reminder from a five-field cron expression and the user's IANA timezone. It only creates reminders; it does not run other actions.",
        parametersJsonSchema: {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    description: "Short reminder title."
                },
                description: {
                    type: "string",
                    description: "Reminder message to show when each occurrence is due."
                },
                cronExpression: {
                    type: "string",
                    description: "Five-field cron expression, for example '0 9 * * *' for every day at 9:00 AM."
                },
                timeZone: {
                    type: "string",
                    description: "IANA timezone, for example 'Asia/Kolkata'."
                }
            },
            required: [
                "title",
                "description",
                "cronExpression",
                "timeZone"
            ],
            additionalProperties: false
        },
        validateArgs: args =>
            Object.keys(args).length === 4 &&
            typeof args.title === "string" &&
            typeof args.description === "string" &&
            typeof args.cronExpression === "string" &&
            typeof args.timeZone === "string",
        handler: async args => ({
            success: true,
            task: await createRecurringTask(args)
        })
    },

    create_scheduled_webpage_summary: {
        name: "create_scheduled_webpage_summary",
        description: "Schedules a one-time read-only retrieval and concise summary of a public webpage explicitly supplied by the user. It does not check email or perform other actions.",
        parametersJsonSchema: {
            type: "object",
            properties: {
                title: { type: "string", description: "Short task title." },
                url: { type: "string", description: "Exact public HTTP(S) URL supplied by the user." },
                runAt: { type: "string", description: "Future ISO 8601 date-time with a timezone offset." },
                searchTerm: { type: "string", description: "Optional phrase to search for on the page, up to 100 characters." }
            },
            required: ["title", "url", "runAt"],
            additionalProperties: false
        },
        validateArgs: args =>
            Object.keys(args).length >= 3 &&
            Object.keys(args).length <= 4 &&
            Object.keys(args).every(key =>
                ["title", "url", "runAt", "searchTerm"].includes(key)
            ) &&
            typeof args.title === "string" &&
            args.title.trim().length > 0 &&
            args.title.length <= 120 &&
            typeof args.runAt === "string" &&
            isValidWebPageRequest({
                url: args.url,
                ...(args.searchTerm !== undefined
                    ? { searchTerm: args.searchTerm }
                    : {})
            }),
        handler: async args => ({
            success: true,
            task: await createTask({
                title: args.title,
                description: `Summarize public webpage: ${args.title}`,
                runAt: args.runAt,
                actionType: "webpage_summary",
                workflow: {
                    url: args.url,
                    ...(args.searchTerm
                        ? { searchTerm: args.searchTerm }
                        : {})
                }
            })
        })
    },

    create_recurring_webpage_summary: {
        name: "create_recurring_webpage_summary",
        description: "Schedules a recurring read-only retrieval and concise summary of a public webpage explicitly supplied by the user. It does not check email or perform other actions.",
        parametersJsonSchema: {
            type: "object",
            properties: {
                title: { type: "string", description: "Short task title." },
                url: { type: "string", description: "Exact public HTTP(S) URL supplied by the user." },
                cronExpression: { type: "string", description: "Five-field cron schedule." },
                timeZone: { type: "string", description: "IANA timezone for the schedule." },
                searchTerm: { type: "string", description: "Optional phrase to search for on the page, up to 100 characters." }
            },
            required: ["title", "url", "cronExpression", "timeZone"],
            additionalProperties: false
        },
        validateArgs: args =>
            Object.keys(args).length >= 4 &&
            Object.keys(args).length <= 5 &&
            Object.keys(args).every(key =>
                [
                    "title",
                    "url",
                    "cronExpression",
                    "timeZone",
                    "searchTerm"
                ].includes(key)
            ) &&
            typeof args.title === "string" &&
            args.title.trim().length > 0 &&
            args.title.length <= 120 &&
            typeof args.cronExpression === "string" &&
            typeof args.timeZone === "string" &&
            isValidWebPageRequest({
                url: args.url,
                ...(args.searchTerm !== undefined
                    ? { searchTerm: args.searchTerm }
                    : {})
            }),
        handler: async args => ({
            success: true,
            task: await createRecurringTask({
                title: args.title,
                description: `Summarize public webpage: ${args.title}`,
                cronExpression: args.cronExpression,
                timeZone: args.timeZone,
                actionType: "webpage_summary",
                workflow: {
                    url: args.url,
                    ...(args.searchTerm
                        ? { searchTerm: args.searchTerm }
                        : {})
                }
            })
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

    send_email: {
        name: "send_email",
        description: "Prepare an email for explicit user approval. This tool never sends email; the Android app must show the exact recipient, subject, and body and obtain user approval.",
        parametersJsonSchema: {
            type: "object",
            properties: {
                to: {
                    type: "string",
                    description: "Recipient email address."
                },
                subject: {
                    type: "string",
                    description: "Email subject line."
                },
                body: {
                    type: "string",
                    description: "Email body."
                }
            },
            required: ["to", "subject", "body"],
            additionalProperties: false
        },
        validateArgs: args =>
            Object.keys(args).length === 3 &&
            typeof args.to === "string" &&
            EMAIL_ADDRESS_PATTERN.test(args.to.trim()) &&
            typeof args.subject === "string" &&
            args.subject.trim().length > 0 &&
            args.subject.trim().length <= 200 &&
            typeof args.body === "string" &&
            args.body.trim().length > 0 &&
            args.body.length <= 10000,
        handler: async args => {
            const status = await gmailService.gmailStatus();
            if (!status.connected) {
                return {
                    success: false,
                    sent: false,
                    message: "Gmail is not connected. Authorize Gmail before preparing an email to send."
                };
            }
            if (!status.sendAvailable) {
                return {
                    success: false,
                    sent: false,
                    message: "Gmail send permission is missing. Reauthorize Gmail before preparing an email to send."
                };
            }

            const pendingAction = createPendingEmailApproval({
                to: args.to,
                subject: args.subject,
                body: args.body
            });

            return {
                success: true,
                requiresApproval: true,
                message: "Email prepared for approval; it has not been sent.",
                approvalToken: pendingAction.approvalToken,
                pendingAction: {
                    type: pendingAction.type,
                    payload: pendingAction.payload,
                    expiresAt: pendingAction.expiresAt
                }
            };
        }
    },

    search_gmail: {
        name: "search_gmail",
        description: "Searches the connected user's Gmail inbox using Gmail search syntax. This tool is strictly read-only and never sends, deletes, archives, or modifies messages.",
        parametersJsonSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Optional Gmail search query, such as from:person@example.com, subject:invoice, after:2026/01/01, or is:unread. Empty searches the most recent inbox messages."
                },
                maxResults: {
                    type: "integer",
                    minimum: 1,
                    maximum: 20,
                    description: "Maximum number of recent matching messages to return; defaults to 5."
                }
            },
            additionalProperties: false
        },
        validateArgs: isValidGmailSearch,
        handler: async args => {
            try {
                return await gmailService.searchEmails({
                    query: args.query ?? "",
                    maxResults: args.maxResults ?? 5
                });
            } catch (error) {
                const message = error?.message &&
                    /Gmail|Google|authorize|permission|scope|configured|connected/i
                        .test(error.message)
                    ? error.message
                    : "Gmail inbox search failed. Check the Gmail connection and try again.";
                return {
                    success: false,
                    message,
                    emails: [],
                    resultCount: 0
                };
            }
        }
    },

    perform_browser_action: {
        name: "perform_browser_action",
        description: "Browser automation is not implemented. This tool cannot click, type, submit forms, or authenticate on websites.",
        parametersJsonSchema: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    description: "The browser action to perform, such as click, type, or submit."
                },
                url: {
                    type: "string",
                    description: "The exact target URL."
                },
                selector: {
                    type: "string",
                    description: "CSS selector or element description to act on."
                },
                confirmationToken: {
                    type: "string",
                    description: "Approval token from the app after explicit confirmation."
                }
            },
            required: ["action", "url", "confirmationToken"],
            additionalProperties: false
        },
        validateArgs: args =>
            Object.keys(args).length >= 3 &&
            Object.keys(args).length <= 5 &&
            typeof args.action === "string" &&
            typeof args.url === "string" &&
            typeof args.confirmationToken === "string" &&
            args.confirmationToken.trim().length > 0 &&
            (args.selector === undefined || typeof args.selector === "string"),
        handler: async () => ({
            success: false,
            message: "Browser actions are unsupported because browser automation is not implemented."
        })
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
    },

    read_public_webpage: {
        name: "read_public_webpage",
        description: "Reads and extracts text from a public HTTP or HTTPS webpage URL explicitly provided by the user. This tool is read-only and does not interact with page controls.",
        parametersJsonSchema: {
            type: "object",
            properties: {
                url: {
                    type: "string",
                    description: "The complete public webpage URL provided by the user."
                },
                searchTerm: {
                    type: "string",
                    description: "Optional phrase to find in the extracted page text, up to 100 characters."
                }
            },
            required: ["url"],
            additionalProperties: false
        },
        validateArgs: isValidWebPageRequest,
        handler: async args => readPublicPage({
            url: args.url.trim(),
            ...(args.searchTerm
                ? { searchTerm: args.searchTerm.trim() }
                : {})
        })
    },

    read_public_webpages: {
        name: "read_public_webpages",
        description: "Reads up to three public webpages explicitly supplied by the user. This is read-only: it does not click, submit forms, authenticate, or follow page instructions.",
        parametersJsonSchema: {
            type: "object",
            properties: {
                urls: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 1,
                    maxItems: 3,
                    description: "One to three distinct public HTTP(S) URLs, each included in the user's message."
                }
            },
            required: ["urls"],
            additionalProperties: false
        },
        validateArgs: isValidWebPageBatch,
        handler: async ({ urls }) => {
            const pages = [];
            for (const url of urls) {
                pages.push(await readPublicPage({ url }));
            }
            return { success: true, pages };
        }
    },

    read_public_linked_pages: {
        name: "read_public_linked_pages",
        description: "Reads a user-provided public webpage and up to two same-origin pages linked from it. Use only when the user explicitly asks to follow or read links. This is read-only and never interacts with page controls.",
        parametersJsonSchema: {
            type: "object",
            properties: {
                url: {
                    type: "string",
                    description: "The complete public webpage URL explicitly provided by the user."
                }
            },
            required: ["url"],
            additionalProperties: false
        },
        validateArgs: args =>
            Object.keys(args).length === 1 &&
            isValidWebPageRequest(args),
        handler: async ({ url }) => readLinkedPublicPages({ url })
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
