const fs = require("node:fs/promises");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { runAgentTurn } = require("../agent/agentService");

const MiB = 1024 * 1024;

function summarizeSamples(samples) {
    if (!Array.isArray(samples) || samples.length === 0) {
        throw new Error("At least one performance sample is required.");
    }

    const sorted = [...samples].sort((left, right) => left - right);
    const percentile = rank =>
        sorted[Math.max(0, Math.ceil(rank * sorted.length) - 1)];

    return {
        sampleCount: sorted.length,
        mean: Number(
            (sorted.reduce((total, sample) => total + sample, 0) /
                sorted.length).toFixed(2)
        ),
        p50: Number(percentile(0.5).toFixed(2)),
        p95: Number(percentile(0.95).toFixed(2))
    };
}

async function loadIsolatedScheduler(temporaryDirectory) {
    const modulePath = path.join(
        temporaryDirectory,
        "src",
        "scheduler",
        "taskScheduler.js"
    );
    await fs.mkdir(path.dirname(modulePath), { recursive: true });

    const sourcePath = require.resolve("../scheduler/taskScheduler");
    const source = await fs.readFile(sourcePath, "utf8");
    const schedulerModule = new Module(modulePath, module);
    schedulerModule.filename = modulePath;
    schedulerModule.paths = [
        ...Module._nodeModulePaths(path.dirname(modulePath)),
        path.resolve(__dirname, "../../node_modules")
    ];
    schedulerModule._compile(source, modulePath);
    return schedulerModule.exports;
}

async function runPerformanceBenchmark({ iterations = 20 } = {}) {
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) {
        throw new Error("Benchmark iterations must be an integer from 1 to 100.");
    }

    const memoryBefore = process.memoryUsage();
    const responseSamples = [];
    const taskSamples = [];
    const ai = {
        models: {
            generateContent: async () => ({
                text: "Synthetic benchmark response."
            })
        }
    };

    for (let index = 0; index < iterations; index++) {
        const startedAt = performance.now();
        await runAgentTurn({
            ai,
            message: `Synthetic benchmark request ${index + 1}`,
            modelList: ["mock-model"]
        });
        responseSamples.push(performance.now() - startedAt);
    }

    const temporaryDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), "personal-agent-performance-")
    );

    try {
        const scheduler = await loadIsolatedScheduler(temporaryDirectory);
        scheduler.setWebpageSummaryExecutor(async () =>
            "Synthetic scheduled webpage summary."
        );

        for (let index = 0; index < iterations; index++) {
            const task = await scheduler.createTask({
                title: `Benchmark task ${index + 1}`,
                description: "Synthetic scheduled workflow benchmark.",
                runAt: new Date(Date.now() + 60_000).toISOString(),
                actionType: "webpage_summary",
                workflow: { url: "https://example.com/benchmark" }
            });
            task.runAt = new Date(Date.now() - 1).toISOString();

            const startedAt = performance.now();
            const executed = await scheduler.executeDueTasks();
            taskSamples.push(performance.now() - startedAt);

            if (executed.length !== 1 || task.status !== "completed") {
                throw new Error("Synthetic scheduled workflow did not complete.");
            }
        }
    } finally {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }

    const memoryAfter = process.memoryUsage();
    return {
        benchmark: "mock-only; no external API or network requests",
        runtime: {
            node: process.version,
            platform: `${process.platform}-${process.arch}`,
            iterations
        },
        agentResponseLatencyMs: summarizeSamples(responseSamples),
        scheduledWorkflowExecutionLatencyMs: summarizeSamples(taskSamples),
        backendMemoryMiB: {
            rssBefore: Number((memoryBefore.rss / MiB).toFixed(2)),
            rssAfter: Number((memoryAfter.rss / MiB).toFixed(2)),
            rssDelta: Number(
                ((memoryAfter.rss - memoryBefore.rss) / MiB).toFixed(2)
            ),
            heapUsedBefore: Number((memoryBefore.heapUsed / MiB).toFixed(2)),
            heapUsedAfter: Number((memoryAfter.heapUsed / MiB).toFixed(2)),
            heapUsedDelta: Number(
                ((memoryAfter.heapUsed - memoryBefore.heapUsed) / MiB).toFixed(2)
            )
        }
    };
}

module.exports = {
    runPerformanceBenchmark,
    summarizeSamples
};
