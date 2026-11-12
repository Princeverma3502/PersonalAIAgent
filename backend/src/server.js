
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { GoogleGenAI } = require("@google/genai");
const { runAgentTurn } = require("./agent/agentService");
const {
    getUserFriendlyGeminiError,
    safeProviderError
} = require("./agent/geminiError");
const {
    initializeScheduler,
    getPendingReminders,
    acknowledgeReminder
} = require("./scheduler/taskScheduler");

const app = express();
const PORT = process.env.PORT || 3000;

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

const AI_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite"
];

app.use(helmet());

app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || "http://localhost:3000"
}));

app.use(express.json({ limit: "20kb" }));

app.use("/api", rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false
}));

// Health check
app.get("/health", (req, res) => {
    const configured = Boolean(ai);

    res.status(configured ? 200 : 503).json({
        status: configured ? "success" : "degraded",
        message: configured
            ? "Personal AI Agent backend is running"
            : "Backend is running, but GEMINI_API_KEY is not configured."
    });
});

// Basic AI chat endpoint
app.post("/api/chat", async (req, res) => {
    const { message } = req.body || {};

    if (!ai) {
        return res.status(503).json({
            success: false,
            error: "AI service credentials are not configured on the backend."
        });
    }

    if (
        typeof message !== "string" ||
        !message.trim() ||
        message.length > 4000
    ) {
        return res.status(400).json({
            success: false,
            error: "Please provide a valid message (maximum 4000 characters)."
        });
    }

    let lastError;

    for (const model of AI_MODELS) {
        try {
            console.log(`Trying AI model: ${model}`);

            const response = await ai.models.generateContent({
                model,
                contents: message.trim()
            });

            console.log(`Success using model: ${model}`);

            return res.json({
                success: true,
                reply: response.text,
                model
            });

        } catch (error) {
            lastError = error;
            const details = safeProviderError(error);

            console.error(`Gemini chat model ${model} failed:`, JSON.stringify({
                category: details.category,
                code: details.code,
                message: details.message,
                retryInfo: details.retryInfo
            }));

            if (![
                "model_not_found",
                "quota_exhausted",
                "rate_limited",
                "temporary_overload"
            ].includes(details.category)) {
                break;
            }

            if (details.category === "temporary_overload") {
                await new Promise(resolve => setTimeout(
                    resolve,
                    Math.min(Math.max(details.retryDelayMs || 300, 250), 1200)
                ));
            }
        }
    }

    console.error(
        "All configured Gemini models failed:",
        lastError?.message || "Unknown error"
    );

    return res.status(502).json({
        success: false,
        error: getUserFriendlyGeminiError(lastError)
    });
});

// Personal AI Agent endpoint
app.post("/api/agent", async (req, res) => {
    if (!ai) {
        return res.status(503).json({
            success: false,
            reply: "AI service credentials are not configured on the backend.",
            status: "failed",
            toolCall: null,
            toolCalls: []
        });
    }

    const { message, memories, timeZone } = req.body || {};

    // Validate and sanitize memories before using them.
    const safeMemories = Array.isArray(memories)
        ? memories
            .filter(memory => typeof memory === "string")
            .map(memory => memory.trim())
            .filter(Boolean)
            .slice(0, 10)
            .map(memory => memory.slice(0, 500))
        : [];

    if (
        typeof message !== "string" ||
        !message.trim() ||
        message.length > 4000
    ) {
        return res.status(400).json({
            success: false,
            reply: "Please provide a valid message (maximum 4000 characters).",
            status: "failed",
            toolCall: null,
            toolCalls: []
        });
    }

    let safeTimeZone;
    if (timeZone !== undefined) {
        if (
            typeof timeZone !== "string" ||
            !timeZone.trim() ||
            timeZone.length > 100
        ) {
            return res.status(400).json({
                success: false,
                reply: "Please provide a valid IANA timezone.",
                status: "failed",
                toolCall: null,
                toolCalls: []
            });
        }

        try {
            new Intl.DateTimeFormat("en-US", {
                timeZone: timeZone.trim()
            }).format(new Date());
            safeTimeZone = timeZone.trim();
        } catch {
            return res.status(400).json({
                success: false,
                reply: "Please provide a valid IANA timezone.",
                status: "failed",
                toolCall: null,
                toolCalls: []
            });
        }
    }

    try {
        console.log("[AGENT] Starting agent execution.");

        const result = await runAgentTurn({
            ai,
            message,
            memories: safeMemories,
            timeZone: safeTimeZone,
            modelList: AI_MODELS
        });

        console.log(
            "[AGENT] Execution finished. Status:",
            result.status
        );

        return res.status(result.success ? 200 : 502).json(result);

    } catch (error) {
        console.error("[AGENT] Endpoint error:", JSON.stringify(
            safeProviderError(error)
        ));

        return res.status(502).json({
            success: false,
            reply: "The AI service is currently unavailable. Please try again shortly.",
            status: "failed",
            toolCall: null,
            toolCalls: []
        });
    }
});

app.get("/api/reminders", async (req, res, next) => {
    try {
        return res.json({
            success: true,
            reminders: await getPendingReminders()
        });
    } catch (error) {
        return next(error);
    }
});

app.post("/api/reminders/:taskId/ack", async (req, res, next) => {
    try {
        const result = await acknowledgeReminder(req.params.taskId);
        return res.status(result.success ? 200 : 404).json(result);
    } catch (error) {
        return next(error);
    }
});

app.use((error, req, res, next) => {
    if (error?.type === "entity.too.large") {
        return res.status(413).json({
            success: false,
            error: "Request body must be 20 KB or smaller."
        });
    }

    if (error instanceof SyntaxError && error.status === 400) {
        return res.status(400).json({
            success: false,
            error: "Request body must contain valid JSON."
        });
    }

    console.error("[HTTP] Request failed:", error?.name || "UnknownError");
    return res.status(500).json({
        success: false,
        error: "The server could not process this request."
    });
});

// Initialize scheduler and start server.
initializeScheduler()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Personal AI Agent backend running on port ${PORT}`);
            console.log("Task scheduler initialized successfully.");
        });
    })
    .catch(error => {
        console.error("Failed to initialize task scheduler:", error);
        process.exit(1);
    });
