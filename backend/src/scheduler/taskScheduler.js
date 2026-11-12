
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const DATA_DIRECTORY = path.join(__dirname, "../../data");
const TASKS_FILE = path.join(DATA_DIRECTORY, "scheduled-tasks.json");

let tasks = [];
let initialized = false;
let executionTimer = null;

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

async function createTask({ title, description, runAt }) {
    await initializeScheduler();

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
        title: title.trim(),
        description: description.trim(),
        actionType: "reminder",
        runAt: executionTime.toISOString(),
        status: "pending",
        createdAt: new Date().toISOString(),
        executedAt: null,
        executionAttempts: 0,
        nextAttemptAt: null,
        result: null,
        lastError: null,
        reminderAcknowledgedAt: null
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

function executeScheduledAction(task) {
    const actionType = task.actionType || "reminder";

    if (actionType !== "reminder") {
        throw new Error("Unsupported scheduled action.");
    }

    return {
        type: "reminder",
        taskId: task.id,
        title: task.title,
        message: task.description
    };
}

async function getPendingReminders() {
    await initializeScheduler();

    return tasks
        .filter(task =>
            task.status === "completed" &&
            (task.actionType || "reminder") === "reminder" &&
            task.result?.type === "reminder" &&
            !task.reminderAcknowledgedAt
        )
        .map(task => ({
            taskId: task.id,
            title: task.result.title,
            message: task.result.message,
            executedAt: task.executedAt
        }));
}

async function acknowledgeReminder(taskId) {
    await initializeScheduler();

    const task = tasks.find(item =>
        item.id === taskId &&
        item.status === "completed" &&
        item.result?.type === "reminder" &&
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

    const completedTasks = [];

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
            task.result = executeScheduledAction(task);
            task.executedAt = new Date().toISOString();
            task.nextAttemptAt = null;
            task.status = "completed";
            await saveTasks();
            completedTasks.push(task);
        } catch (error) {
            task.result = null;
            task.executedAt = null;
            task.lastError = "Scheduled reminder execution failed.";

            if (task.executionAttempts < 3) {
                task.status = "pending";
                const retryDelayMs = Math.min(
                    5000 * (2 ** (task.executionAttempts - 1)),
                    60_000
                );
                task.nextAttemptAt = new Date(
                    Date.now() + retryDelayMs
                ).toISOString();
            } else {
                task.status = "failed";
                task.nextAttemptAt = null;
            }

            await saveTasks();
            console.error(
                `Scheduled reminder ${task.id} failed on attempt ${task.executionAttempts}.`
            );
        }
    }

    if (completedTasks.length > 0) {
        console.log(
            `Scheduled ${completedTasks.length} reminder(s) for in-app delivery.`
        );
    }

    return completedTasks;
}

module.exports = {
    initializeScheduler,
    createTask,
    getTasks,
    cancelTask,
    executeDueTasks,
    getPendingReminders,
    acknowledgeReminder
};
