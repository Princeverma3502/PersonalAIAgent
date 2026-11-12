function parseProviderError(error) {
    let payload = {};

    if (typeof error?.message === "string") {
        try {
            payload = JSON.parse(error.message);
        } catch (_) {
            payload = {};
        }
    }

    const providerError = payload.error || payload;
    const details = Array.isArray(providerError.details)
        ? providerError.details
        : [];
    const retryInfo = details.find(detail =>
        String(detail["@type"] || "").endsWith(".RetryInfo")
    );
    const retryAfterHeader =
        error?.headers?.["retry-after"] ??
        error?.response?.headers?.get?.("retry-after");
    const retryValue = retryInfo?.retryDelay ?? retryAfterHeader;

    return {
        code: error?.status ??
            error?.code ??
            providerError.code ??
            providerError.status ??
            "unknown",
        message: providerError.message ||
            (typeof error?.message === "string"
                ? error.message
                : "Unknown provider error"),
        retryInfo: retryValue ?? "not provided",
        retryDelayMs: parseRetryDelay(retryValue)
    };
}

function parseRetryDelay(value) {
    if (typeof value !== "string") return null;

    const match = value.match(/^(\d+(?:\.\d+)?)(ms|s)$/i);
    if (!match) return null;

    return Number(match[1]) * (match[2].toLowerCase() === "s" ? 1000 : 1);
}

function classifyGeminiError(error) {
    const details = parseProviderError(error);
    const numericCode = Number(details.code);
    const message = String(details.message).toLowerCase();
    const status = String(details.code).toUpperCase();

    let category = "provider_error";

    if (
        [401, 403].includes(numericCode) ||
        /invalid api key|api key not valid|unauthenticated|permission denied/.test(message) ||
        status === "UNAUTHENTICATED"
    ) {
        category = "invalid_api_key";
    } else if (
        numericCode === 404 ||
        /model.{0,30}(not found|does not exist|not supported)/.test(message)
    ) {
        category = "model_not_found";
    } else if (
        numericCode === 429 &&
        /quota|resource_exhausted|daily limit|billing/.test(
            `${message} ${status}`
        )
    ) {
        category = "quota_exhausted";
    } else if (
        status === "RESOURCE_EXHAUSTED" ||
        /quota|resource_exhausted|daily limit|billing/.test(message)
    ) {
        category = "quota_exhausted";
    } else if (
        numericCode === 429 ||
        /rate.?limit|too many requests/.test(message)
    ) {
        category = "rate_limited";
    } else if (
        [500, 502, 503, 504].includes(numericCode) ||
        /overloaded|temporarily unavailable|internal error/.test(message) ||
        [
            "APIConnectionTimeoutError",
            "APIUserAbortError",
            "RequestTimeoutError",
            "TimeoutError",
            "AbortError"
        ].includes(error?.name)
    ) {
        category = "temporary_overload";
    }

    return { ...details, category };
}

function safeProviderError(error) {
    const details = classifyGeminiError(error);
    const message = String(details.message)
        .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
        .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]");

    return { ...details, message };
}

function getUserFriendlyGeminiError(error) {
    const { category } = classifyGeminiError(error);

    switch (category) {
        case "invalid_api_key":
            return "The AI service credentials are invalid or unauthorized. Please contact the app administrator.";
        case "model_not_found":
            return "None of the configured AI models is currently available. Please check the backend model configuration.";
        case "quota_exhausted":
            return "The AI service quota is exhausted. Please try again later.";
        case "rate_limited":
            return "The AI service is receiving too many requests. Please wait a moment and try again.";
        case "temporary_overload":
            return "The AI service is temporarily overloaded. Please try again shortly.";
        default:
            return "The AI service could not process this request. Please try again later.";
    }
}

module.exports = {
    classifyGeminiError,
    getUserFriendlyGeminiError,
    safeProviderError
};
