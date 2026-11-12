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
    schedulerModule.paths = Module._nodeModulePaths(path.dirname(modulePath));
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
});
