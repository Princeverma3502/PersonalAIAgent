const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
    runPerformanceBenchmark,
    summarizeSamples
} = require("../src/diagnostics/performanceBenchmark");

test("summarizes latency samples with nearest-rank percentiles", () => {
    assert.deepEqual(summarizeSamples([4, 1, 3, 2]), {
        sampleCount: 4,
        mean: 2.5,
        p50: 2,
        p95: 4
    });
    assert.throws(() => summarizeSamples([]), /At least one/);
});

test("runs a bounded mock benchmark without external services", async () => {
    const report = await runPerformanceBenchmark({ iterations: 2 });

    assert.match(report.benchmark, /mock-only/);
    assert.equal(report.runtime.iterations, 2);
    assert.equal(report.agentResponseLatencyMs.sampleCount, 2);
    assert.equal(report.scheduledWorkflowExecutionLatencyMs.sampleCount, 2);
    assert.ok(Number.isFinite(report.backendMemoryMiB.heapUsedDelta));
});

test("rejects benchmark iteration counts outside the supported bound", async () => {
    await assert.rejects(
        runPerformanceBenchmark({ iterations: 101 }),
        /integer from 1 to 100/
    );
});
