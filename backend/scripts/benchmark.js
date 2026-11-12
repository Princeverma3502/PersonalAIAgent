const { runPerformanceBenchmark } = require("../src/diagnostics/performanceBenchmark");

async function main() {
    const configuredIterations = process.env.BENCHMARK_ITERATIONS;
    const iterations = configuredIterations === undefined
        ? 20
        : Number(configuredIterations);
    const report = await runPerformanceBenchmark({ iterations });
    console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
    console.error("Performance benchmark failed:", error.message);
    process.exitCode = 1;
});
