const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

async function compileScheduler(temporaryDirectory) {
    const modulePath = path.join(
        temporaryDirectory,
        "src",
        "scheduler",
        "taskScheduler.js"
    );

    await fs.mkdir(path.dirname(modulePath), { recursive: true });
    const source = await fs.readFile(
        path.join(__dirname, "../src/scheduler/taskScheduler.js"),
        "utf8"
    );

    const schedulerModule = new Module(modulePath, module);
    schedulerModule.filename = modulePath;
    schedulerModule.paths = [
        ...Module._nodeModulePaths(path.dirname(modulePath)),
        path.join(__dirname, "../node_modules")
    ];
    schedulerModule._compile(source, modulePath);

    return schedulerModule.exports;
}

async function loadIsolatedScheduler(t) {
    const temporaryDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), "personal-agent-scheduler-")
    );

    t.after(async () => {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
    });

    return {
        directory: temporaryDirectory,
        scheduler: await compileScheduler(temporaryDirectory)
    };
}

test("scheduler persists, cancels, and completes tasks once", async t => {
    await t.test("creates, lists, and cancels pending tasks", async t => {
        const { directory, scheduler } = await loadIsolatedScheduler(t);
        const task = await scheduler.createTask({
            title: "Test task",
            description: "Test scheduler persistence and cancellation.",
            runAt: new Date(Date.now() + 60_000).toISOString()
        });

        assert.equal((await scheduler.getTasks())[0].status, "pending");
        assert.deepEqual(await scheduler.cancelTask("unknown-task"), {
            success: false,
            message: "Pending task not found."
        });
        assert.equal((await scheduler.cancelTask(task.id)).success, true);
        assert.equal((await scheduler.getTasks())[0].status, "cancelled");
        assert.equal((await scheduler.cancelTask(task.id)).success, false);

        const restartedScheduler = await compileScheduler(directory);
        assert.equal(
            (await restartedScheduler.getTasks())[0].status,
            "cancelled"
        );
    });

    await t.test("requires a timezone and marks due tasks completed once", async t => {
        const { directory, scheduler } = await loadIsolatedScheduler(t);

        await assert.rejects(
            scheduler.createTask({
                title: " ",
                description: "Valid description",
                runAt: new Date(Date.now() + 60_000).toISOString()
            }),
            /title/
        );
        await assert.rejects(
            scheduler.createTask({
                title: "Valid title",
                description: " ",
                runAt: new Date(Date.now() + 60_000).toISOString()
            }),
            /description/
        );
        await assert.rejects(
            scheduler.createTask({
                title: "No timezone",
                description: "This must be rejected.",
                runAt: "2099-01-01T12:00:00"
            }),
            /timezone/
        );
        await assert.rejects(
            scheduler.createTask({
                title: "Past task",
                description: "This must be rejected.",
                runAt: new Date(Date.now() - 60_000).toISOString()
            }),
            /future/
        );

        const task = await scheduler.createTask({
            title: "Due test",
            description: "This test runs only in its temporary storage.",
            runAt: new Date(Date.now() + 250).toISOString()
        });

        await new Promise(resolve => setTimeout(resolve, 300));
        const dueTasks = await scheduler.executeDueTasks();

        assert.deepEqual(dueTasks.map(dueTask => dueTask.id), [task.id]);
        assert.deepEqual(dueTasks[0].result, {
            type: "reminder",
            taskId: task.id,
            title: "Due test",
            message: "This test runs only in its temporary storage."
        });
        assert.equal((await scheduler.getPendingReminders()).length, 1);
        assert.ok(Number.isInteger(dueTasks[0].executionDelayMs));
        assert.ok(dueTasks[0].executionDelayMs >= 0);
        assert.equal(
            (await scheduler.getPendingReminders())[0].executionDelayMs,
            dueTasks[0].executionDelayMs
        );
        assert.equal(
            (await scheduler.acknowledgeReminder(task.id)).success,
            true
        );
        assert.equal((await scheduler.getPendingReminders()).length, 0);
        assert.equal((await scheduler.executeDueTasks()).length, 0);
        assert.equal((await scheduler.getTasks())[0].status, "completed");

        const persisted = JSON.parse(await fs.readFile(
            path.join(directory, "data", "scheduled-tasks.json"),
            "utf8"
        ));
        assert.equal(persisted[0].status, "completed");
        assert.equal(persisted[0].reminderAcknowledgedAt !== null, true);
    });

    await t.test("retries unsupported actions and stops after the limit", async t => {
        const { scheduler } = await loadIsolatedScheduler(t);
        const task = await scheduler.createTask({
            title: "Unsupported action test",
            description: "This action must not run.",
            runAt: new Date(Date.now() + 60_000).toISOString()
        });
        const storedTask = (await scheduler.getTasks())[0];
        storedTask.actionType = "shell";
        storedTask.runAt = new Date(Date.now() - 1000).toISOString();

        await scheduler.executeDueTasks();
        assert.equal(storedTask.status, "pending");
        assert.equal(storedTask.executionAttempts, 1);
        assert.match(storedTask.lastError, /failed/);

        storedTask.nextAttemptAt = null;
        await scheduler.executeDueTasks();
        storedTask.nextAttemptAt = null;
        await scheduler.executeDueTasks();

        assert.equal(storedTask.status, "failed");
        assert.equal(storedTask.executionAttempts, 3);
        assert.equal(storedTask.result, null);
    });

    await t.test("creates timezone-aware recurring reminders and validates cron frequency", async t => {
        const { directory, scheduler } = await loadIsolatedScheduler(t);

        await assert.rejects(
            scheduler.createRecurringTask({
                title: "Invalid cron",
                description: "This must be rejected.",
                cronExpression: "every day",
                timeZone: "Asia/Kolkata"
            }),
            /five-field cron expression/
        );
        await assert.rejects(
            scheduler.createRecurringTask({
                title: "Invalid timezone",
                description: "This must be rejected.",
                cronExpression: "0 9 * * *",
                timeZone: "Not/A_Timezone"
            }),
            /valid IANA timezone/
        );
        await assert.rejects(
            scheduler.createRecurringTask({
                title: "Too frequent",
                description: "This must be rejected.",
                cronExpression: "* * * * *",
                timeZone: "UTC"
            }),
            /at least five minutes/
        );

        const task = await scheduler.createRecurringTask({
            title: "Morning reminder",
            description: "Review today's plan.",
            cronExpression: "0 9 * * *",
            timeZone: "Asia/Kolkata"
        });
        const persistedScheduler = await compileScheduler(directory);
        const persistedTask = (await persistedScheduler.getTasks()).find(
            item => item.id === task.id
        );

        assert.equal(task.status, "pending");
        assert.deepEqual(task.recurrence, {
            cronExpression: "0 9 * * *",
            timeZone: "Asia/Kolkata"
        });
        assert.ok(new Date(task.runAt).getTime() > Date.now());
        assert.equal(
            new Intl.DateTimeFormat("en-US", {
                timeZone: "Asia/Kolkata",
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23"
            }).format(new Date(task.runAt)),
            "09:00"
        );
        assert.equal(persistedTask.recurrence.timeZone, "Asia/Kolkata");
    });

    await t.test("executes recurring reminders, advances schedule, and acknowledges each occurrence", async t => {
        const { directory, scheduler } = await loadIsolatedScheduler(t);
        const task = await scheduler.createRecurringTask({
            title: "Recurring test",
            description: "This test runs only in temporary storage.",
            cronExpression: "*/5 * * * *",
            timeZone: "UTC"
        });
        task.runAt = new Date(Date.now() - 1000).toISOString();

        const executed = await scheduler.executeDueTasks();
        const reminders = await scheduler.getPendingReminders();

        assert.equal(executed.length, 1);
        assert.equal(task.status, "pending");
        assert.ok(new Date(task.runAt).getTime() > Date.now());
        assert.equal(reminders.length, 1);
        assert.equal(reminders[0].scheduledTaskId, task.id);
        assert.equal(reminders[0].message, task.description);
        assert.ok(Number.isInteger(reminders[0].executionDelayMs));
        assert.ok(reminders[0].executionDelayMs >= 0);
        const restartedScheduler = await compileScheduler(directory);
        assert.equal(
            (await restartedScheduler.getPendingReminders())[0].taskId,
            reminders[0].taskId
        );
        assert.equal(
            (await scheduler.acknowledgeReminder(reminders[0].taskId)).success,
            true
        );
        assert.equal((await scheduler.getPendingReminders()).length, 0);
        assert.equal((await scheduler.cancelTask(task.id)).success, true);
    });
});

test("scheduled webpage workflows run, recur, and deliver summaries", async t => {
    const { scheduler } = await loadIsolatedScheduler(t);
    const workflow = {
        url: "https://example.com/news",
        searchTerm: "release"
    };

    await assert.rejects(
        scheduler.createTask({
            title: "Invalid workflow",
            description: "Summarize a webpage.",
            runAt: new Date(Date.now() + 60_000).toISOString(),
            actionType: "webpage_summary",
            workflow: { url: "javascript:alert(1)" }
        }),
        /valid HTTP\(S\) URL/
    );

    const oneTimeTask = await scheduler.createTask({
        title: "One-time webpage summary",
        description: "Summarize the public page.",
        runAt: new Date(Date.now() + 60_000).toISOString(),
        actionType: "webpage_summary",
        workflow
    });
    const recurringTask = await scheduler.createRecurringTask({
        title: "Recurring webpage summary",
        description: "Summarize the public page.",
        cronExpression: "*/5 * * * *",
        timeZone: "UTC",
        actionType: "webpage_summary",
        workflow
    });

    const executedWorkflows = [];
    scheduler.setWebpageSummaryExecutor(async scheduledWorkflow => {
        executedWorkflows.push(scheduledWorkflow);
        return "The page announces a new release.";
    });
    oneTimeTask.runAt = new Date(Date.now() - 1000).toISOString();
    recurringTask.runAt = new Date(Date.now() - 1000).toISOString();

    const executed = await scheduler.executeDueTasks();
    const reminders = await scheduler.getPendingReminders();

    assert.equal(executed.length, 2);
    assert.equal(oneTimeTask.status, "completed");
    assert.equal(oneTimeTask.result.type, "webpage_summary");
    assert.equal(
        oneTimeTask.result.message,
        "The page announces a new release.\n\nSource: https://example.com/news"
    );
    assert.equal(oneTimeTask.result.sourceUrl, workflow.url);
    assert.equal(recurringTask.status, "pending");
    assert.equal(reminders.length, 2);
    assert.ok(reminders.every(reminder =>
        reminder.message ===
            "The page announces a new release.\n\nSource: https://example.com/news" &&
        reminder.sourceUrl === workflow.url
    ));
    assert.equal(executedWorkflows.length, 2);

    for (const reminder of reminders) {
        assert.equal(
            (await scheduler.acknowledgeReminder(reminder.taskId)).success,
            true
        );
    }
    assert.equal((await scheduler.getPendingReminders()).length, 0);
});
