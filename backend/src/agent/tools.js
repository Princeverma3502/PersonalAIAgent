const TOOL_REGISTRY = Object.freeze({
    get_current_time: {
        name: "get_current_time",
        description: "Returns the backend's current date and time in ISO 8601 format, including timezone information.",
        parametersJsonSchema: {
            type: "object",
            properties: {},
            additionalProperties: false
        },
        handler: () => {
            const timestamp = new Date();

            return {
                success: true,
                timestamp: timestamp.toISOString(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
            };
        }
    }
});

function getToolDeclaration() {
    return {
        functionDeclarations: Object.values(TOOL_REGISTRY).map(({ name, description, parametersJsonSchema }) => ({
            name,
            description,
            parametersJsonSchema
        }))
    };
}

function validateToolName(name) {
    if (typeof name !== "string") {
        return null;
    }

    return TOOL_REGISTRY[name] || null;
}

module.exports = {
    TOOL_REGISTRY,
    getToolDeclaration,
    validateToolName
};
