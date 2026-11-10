
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing from .env");
}

const ai = new GoogleGenAI({ apiKey });
const AI_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-2.5-flash-lite"
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

app.get("/health", (req, res) => {
    res.json({
        status: "success",
        message: "Personal AI Agent backend is running"
    });
});


app.post("/api/chat", async (req, res) => {
    const { message } = req.body;

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
                model: model,
                contents: message.trim()
            });

            console.log(`Success using model: ${model}`);

            return res.json({
                success: true,
                reply: response.text,
                model: model
            });

        } catch (error) {
            lastError = error;

            let status = error.status;

            // Some SDK errors contain the HTTP status inside JSON text.
            if (!status && error.message) {
                try {
                    status = JSON.parse(error.message)?.error?.code;
                } catch (_) {
                    status = undefined;
                }
            }

            console.error(`Model ${model} failed. Status: ${status}`);
            console.error("Reason:", error.message);

            // Try another model for temporary service or quota errors.
            if (![429, 500, 502, 503, 504].includes(Number(status))) {
                break;
            }

            console.log("Switching to the next available model...");
        }
    }

    console.error("All configured Gemini models failed:", lastError?.message);

    return res.status(502).json({
        success: false,
        error: "All available AI models are currently busy or unavailable. Please try again shortly."
    });
});


app.listen(PORT, () => {
    console.log(`Personal AI Agent backend running on port ${PORT}`);
});
