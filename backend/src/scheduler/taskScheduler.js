
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { CronExpressionParser } = require("cron-parser");

const DATA_DIRECTORY = path.join(__dirname, "../../data");
const TASKS_FILE = path.join(DATA_DIRECTORY, "scheduled-tasks.json");
const MIN_RECURRENCE_INTERVAL_MS = 5 * 60 * 1000;
const MAX_PENDING_RECURRING_REMINDERS = 20;

let tasks = [];
let initialized = false;
let executionTimer = null;
let webpageSummaryExecutor = null;
let gmailCheckExecutor = null;

function setWebpageSummaryExecutor(executor) {
    if (typeof executor !== "function") {
        throw new Error("Scheduled webpage workflow executor must be a function.");
    }

    webpageSummaryExecutor = executor;
}

function setGmailCheckExecutor(executor) {
    if (typeof executor !== "function") {
        throw new Error("Scheduled Gmail check executor must be a function.");
    }

    gmailCheckExecutor = executor;
}

function validateScheduledAction(actionType, workflow) {
    if (actionType === undefined || actionType === "reminder") {
        if (workflow !== undefined) {
            throw new Error("Reminder tasks cannot include a workflow.");
        }
        return { actionType: "reminder" };
    }

    if (actionType === "gmail_check") {
        if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
            throw new Error("Scheduled Gmail checks require workflow settings.");
        }
        if (
            workflow.query !== undefined &&
            (typeof workflow.query !== "string" || workflow.query.length > 500)
        ) {
            throw new Error("Gmail check queries must be at most 500 characters.");
        }
        if (
            workflow.maxResults !== undefined &&
            (!Number.isInteger(workflow.maxResults) ||
                workflow.maxResults < 1 || workflow.maxResults > 20)
        ) {
            throw new Error("Gmail checks require 1 to 20 results.");
        }
        if (
            workflow.seenMessageIds !== undefined &&
            (!Array.isArray(workflow.seenMessageIds) ||
                !workflow.seenMessageIds.every(id =>
                    typeof id === "string" && id.length > 0 && id.length <= 200
                ))
        ) {
            throw new Error("Gmail check history is invalid.");
        }

        return {
            actionType,
            workflow: {
                query: (workflow.query || "").trim(),
                maxResults: workflow.maxResults || 5,
                seenMessageIds: (workflow.seenMessageIds || []).slice(-100)
            }
        };
    }

    if (actionType !== "webpage_summary") {
        throw new Error("Unsupported scheduled action.");
    }

    if (
        !workflow ||
        typeof workflow !== "object" ||
        Array.isArray(workflow) ||
        typeof workflow.url !== "string" ||
        workflow.url.length > 2048
    ) {
        throw new Error("Scheduled webpage workflow requires a URL.");
    }

    let url;
    try {
        url = new URL(workflow.url);
    } catch {
        throw new Error("Scheduled webpage workflow requires a valid HTTP(S) URL.");
    }

    if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password ||
        (url.port && !(
            (url.protocol === "http:" && url.port === "80") ||
            (url.protocol === "https:" && url.port === "443")
        ))
    ) {
        throw new Error("Scheduled webpage workflow requires a valid HTTP(S) URL.");
    }

    if (
        workflow.searchTerm !== undefined &&
        (
            typeof workflow.searchTerm !== "string" ||
            !workflow.searchTerm.trim() ||
            workflow.searchTerm.trim().length > 100
        )
    ) {
        throw new Error("Workflow search terms must contain 1 to 100 characters.");
    }

    return {
        actionType,
        workflow: {
            url: url.href,
            ...(workflow.searchTerm
                ? { searchTerm: workflow.searchTerm.trim() }
                : {})
        }
    };
}

function validateTaskContent(title, description) {
    if (
        typeof title !== "string" ||
        !title.trim() ||
        title.length > 120
    ) {
        throw new Error("Task title must contain 1 to 120 characters.");
    }

    if (
        typeof description !== "string" ||
        !description.trim() ||
        description.length > 1000
    ) {
        throw new Error("Task description must contain 1 to 1000 characters.");
    }

    return {
        title: title.trim(),
        description: description.trim()
    };
}

function getNextCronRun(cronExpression, timeZone, currentDate = new Date()) {
    if (
        typeof cronExpression !== "string" ||
        cronExpression.trim().length > 100 ||
        cronExpression.trim().split(/\s+/).length !== 5
    ) {
        throw new Error("Recurring schedule must use a five-field cron expression.");
    }

    if (
        typeof timeZone !== "string" ||
        !timeZone.trim() ||
        timeZone.trim().length > 100
    ) {
        throw new Error("Recurring schedule requires a valid IANA timezone.");
    }

    const normalizedExpression = cronExpression.trim();
    const normalizedTimeZone = timeZone.trim();

    try {
        new Intl.DateTimeFormat("en-US", {
            timeZone: normalizedTimeZone
        }).format(currentDate);
    } catch {
        throw new Error("Recurring schedule requires a valid IANA timezone.");
    }

    try {
        const expression = CronExpressionParser.parse(normalizedExpression, {
            currentDate,
            tz: normalizedTimeZone
        });
        const nextRun = expression.next().toDate();
        const followingRun = expression.next().toDate();

        if (
            followingRun.getTime() - nextRun.getTime() <
            MIN_RECURRENCE_INTERVAL_MS
        ) {
            throw new Error(
                "Recurring reminders must be at least five minutes apart."
            );
        }

        return nextRun;
    } catch (error) {
        if (error.message.includes("at least five minutes")) throw error;
        throw new Error("Recurring schedule must be a valid five-field cron expression.");
    }
}

async function saveTasks() {
    await fs.mkdir(DATA_DIRECTORY, { recursive: true });

    const temporaryFile = `${TASKS_FILE}.tmp`;

    await fs.writeFile(
        temporaryFile,
        JSON.stringify(tasks, null, 2),
        "utf8"
    );

    await fs.rename(temporaryFile, TASKS_FILE);
}

async function initializeScheduler() {
    if (initialized) return;

    await fs.mkdir(DATA_DIRECTORY, { recursive: true });

    try {
        const content = await fs.readFile(TASKS_FILE, "utf8");
        const parsed = JSON.parse(content);

        tasks = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }

        tasks = [];
        await saveTasks();
    }

    let recoveredTasks = false;
    for (const task of tasks) {
        if (task.status === "executing") {
            task.status = "pending";
            task.nextAttemptAt = null;
            recoveredTasks = true;
        }
    }

    if (recoveredTasks) {
        await saveTasks();
    }

    initialized = true;
    startScheduler();
}

function startScheduler() {
    if (executionTimer) return;

    executionTimer = setInterval(async () => {
        try {
            await executeDueTasks();
        } catch (error) {
            console.error("Scheduler error:", error.message);
        }
    }, 5000);

    executionTimer.unref();
}

async function createTask({
    title,
    description,
    runAt,
    actionType,
    workflow
}) {
    await initializeScheduler();

    const taskContent = validateTaskContent(title, description);
    const scheduledAction = validateScheduledAction(actionType, workflow);

    if (
        typeof runAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(runAt)
    ) {
        throw new Error("Task execution time must be an ISO 8601 date-time with a timezone.");
    }

    const executionTime = new Date(runAt);

    if (Number.isNaN(executionTime.getTime())) {
        throw new Error("Invalid task execution date.");
    }

    if (executionTime.getTime() <= Date.now()) {
        throw new Error("Task execution time must be in the future.");
    }

    const task = {
        id: crypto.randomUUID(),
        ...taskContent,
        ...scheduledAction,
        runAt: executionTime.toISOString(),
        status: "pending",
        createdAt: new Date().toISOString(),
        executedAt: null,
        executionAttempts: 0,
        executionDelayMs: null,
        nextAttemptAt: null,
        result: null,
        lastError: null,
        reminderAcknowledgedAt: null
    };

    tasks.push(task);
    await saveTasks();

    return task;
}

async function createRecurringTask({
    title,
    description,
    cronExpression,
    timeZone,
    actionType,
    workflow
}) {
    await initializeScheduler();

    const taskContent = validateTaskContent(title, description);
    const scheduledAction = validateScheduledAction(actionType, workflow);
    const normalizedExpression =
        typeof cronExpression === "string" ? cronExpression.trim() : "";
    const normalizedTimeZone =
        typeof timeZone === "string" ? timeZone.trim() : "";
    const nextRun = getNextCronRun(
        normalizedExpression,
        normalizedTimeZone
    );

    const task = {
        id: crypto.randomUUID(),
        ...taskContent,
        ...scheduledAction,
        recurrence: {
            cronExpression: normalizedExpression,
            timeZone: normalizedTimeZone
        },
        runAt: nextRun.toISOString(),
        status: "pending",
        createdAt: new Date().toISOString(),
        executedAt: null,
        executionAttempts: 0,
        executionDelayMs: null,
        nextAttemptAt: null,
        result: null,
        lastError: null,
        pendingReminders: [],
        missedReminderCount: 0
    };

    tasks.push(task);
    await saveTasks();

    return task;
}

async function getTasks() {
    await initializeScheduler();
    return tasks;
}

async function cancelTask(taskId) {
    await initializeScheduler();

    const task = tasks.find(
        item => item.id === taskId && item.status === "pending"
    );

    if (!task) {
        return {
            success: false,
            message: "Pending task not found."
        };
    }

    task.status = "cancelled";
    await saveTasks();

    return {
        success: true,
        message: "Task cancelled.",
        task
    };
}

async function executeScheduledAction(task) {
    const actionType = task.actionType || "reminder";

    if (actionType === "webpage_summary") {
        if (!webpageSummaryExecutor) {
            throw new Error("Scheduled webpage workflow executor is unavailable.");
        }

        const message = await webpageSummaryExecutor(task.workflow);
        if (typeof message !== "string" || !message.trim()) {
            throw new Error("Scheduled webpage workflow returned an empty summary.");
        }

        const source = `Source: ${task.workflow.url}`;
        const summary = message.trim().slice(
            0,
            Math.max(0, 2500 - source.length - 2)
        );

        return {
            type: "webpage_summary",
            taskId: task.id,
            title: task.title,
            message: `${summary}\n\n${source}`,
            sourceUrl: task.workflow.url
        };
    }

    if (actionType === "gmail_check") {
        if (!gmailCheckExecutor) {
            throw new Error("Scheduled Gmail check executor is unavailable.");
        }

        const check = await gmailCheckExecutor(task.workflow);
        if (
            !check || typeof check !== "object" ||
            !Array.isArray(check.seenMessageIds)
        ) {
            throw new Error("Scheduled Gmail check returned an invalid result.");
        }
        if (!check.suppressNotification &&
            (typeof check.message !== "string" || !check.message.trim())) {
            throw new Error("Scheduled Gmail check returned an empty summary.");
        }

        task.workflow.seenMessageIds = check.seenMessageIds.slice(-100);
        return {
            type: "gmail_check",
            taskId: task.id,
            title: task.title,
            message: typeof check.message === "string"
                ? check.message.trim().slice(0, 2500)
                : "",
            suppressNotification: check.suppressNotification === true
        };
    }

    if (actionType !== "reminder") throw new Error("Unsupported scheduled action.");

    return {
        type: "reminder",
        taskId: task.id,
        title: task.title,
        message: task.description
    };
}

async function getPendingReminders() {
    await initializeScheduler();

    const reminders = [];

    for (const task of tasks) {
        if (task.recurrence) {
            for (const reminder of task.pendingReminders || []) {
                reminders.push({
                    taskId: reminder.id,
                    scheduledTaskId: task.id,
                    title: reminder.title,
                    message: reminder.message,
                    executedAt: reminder.executedAt,
                    executionDelayMs: reminder.executionDelayMs,
                    sourceUrl: reminder.sourceUrl
                });
            }
        } else if (
            task.status === "completed" &&
            ["reminder", "webpage_summary", "gmail_check"].includes(task.result?.type) &&
            !task.reminderAcknowledgedAt
        ) {
            reminders.push({
                taskId: task.id,
                title: task.result.title,
                message: task.result.message,
                executedAt: task.executedAt,
                executionDelayMs: task.executionDelayMs,
                sourceUrl: task.result.sourceUrl
            });
        }
    }

    return reminders;
}

async function acknowledgeReminder(taskId) {
    await initializeScheduler();

    const recurringTask = tasks.find(task =>
        Array.isArray(task.pendingReminders) &&
        task.pendingReminders.some(reminder => reminder.id === taskId)
    );

    if (recurringTask) {
        recurringTask.pendingReminders =
            recurringTask.pendingReminders.filter(
                reminder => reminder.id !== taskId
            );
        await saveTasks();
        return { success: true };
    }

    const task = tasks.find(item =>
        item.id === taskId &&
        item.status === "completed" &&
        ["reminder", "webpage_summary", "gmail_check"].includes(item.result?.type) &&
        !item.reminderAcknowledgedAt
    );

    if (!task) {
        return {
            success: false,
            message: "Pending reminder not found."
        };
    }

    task.reminderAcknowledgedAt = new Date().toISOString();
    await saveTasks();

    return { success: true };
}

async function executeDueTasks() {
    await initializeScheduler();

    const now = Date.now();

    const dueTasks = tasks.filter(task =>
        task.status === "pending" &&
        new Date(task.runAt).getTime() <= now &&
        (!task.nextAttemptAt || new Date(task.nextAttemptAt).getTime() <= now)
    );

    const executedTasks = [];

    for (const task of dueTasks) {
        const previousAttempts = task.executionAttempts || 0;
        task.status = "executing";
        task.executionAttempts = previousAttempts + 1;
        task.lastError = null;

        try {
            await saveTasks();
        } catch (error) {
            task.status = "pending";
            task.executionAttempts = previousAttempts;
            throw error;
        }

        try {
            task.result = await executeScheduledAction(task);
            const executedAt = new Date();
            task.executedAt = executedAt.toISOString();
            task.executionDelayMs = Math.max(
                0,
                executedAt.getTime() - new Date(task.runAt).getTime()
            );
            task.nextAttemptAt = null;
            if (task.recurrence) {
                const pendingReminders = Array.isArray(task.pendingReminders)
                    ? task.pendingReminders
                    : [];
                if (!task.result.suppressNotification) {
                    pendingReminders.push({
                        id: crypto.randomUUID(),
                        title: task.result.title,
                        message: task.result.message,
                        executedAt: task.executedAt,
                        scheduledFor: task.runAt,
                        executionDelayMs: task.executionDelayMs,
                        sourceUrl: task.result.sourceUrl
                    });
                }
                if (
                    pendingReminders.length >
                    MAX_PENDING_RECURRING_REMINDERS
                ) {
                    pendingReminders.shift();
                    task.missedReminderCount =
                        (task.missedReminderCount || 0) + 1;
                }
                task.pendingReminders = pendingReminders;
                task.runAt = getNextCronRun(
                    task.recurrence.cronExpression,
                    task.recurrence.timeZone,
                    new Date()
                ).toISOString();
                task.executionAttempts = 0;
                task.status = "pending";
            } else {
                task.status = "completed";
            }
            await saveTasks();
            executedTasks.push(task);
        } catch (error) {
            const failedAttempt = task.executionAttempts;
            task.result = null;
            task.executedAt = null;
            task.executionDelayMs = null;
            task.lastError = "Scheduled task execution failed.";

            if (task.executionAttempts < 3) {
                task.status = "pending";
                const retryDelayMs = Math.min(
                    5000 * (2 ** (task.executionAttempts - 1)),
                    60_000
                );
                task.nextAttemptAt = new Date(
                    Date.now() + retryDelayMs
                ).toISOString();
            } else if (task.recurrence && task.actionType === "gmail_check") {
                task.status = "pending";
                task.executionAttempts = 0;
                task.nextAttemptAt = null;
                task.runAt = getNextCronRun(
                    task.recurrence.cronExpression,
                    task.recurrence.timeZone,
                    new Date()
                ).toISOString();
            } else {
                task.status = "failed";
                task.nextAttemptAt = null;
            }

            await saveTasks();
            console.error(
                `Scheduled task ${task.id} failed on attempt ${failedAttempt}.`
            );
        }
    }

    if (executedTasks.length > 0) {
        console.log(
            `Scheduled ${executedTasks.length} task result(s) for in-app delivery.`
        );
    }

    return executedTasks;
}

module.exports = {
    initializeScheduler,
    setWebpageSummaryExecutor,
    setGmailCheckExecutor,
    createTask,
    createRecurringTask,
    getTasks,
    cancelTask,
    executeDueTasks,
    getPendingReminders,
    acknowledgeReminder
};
