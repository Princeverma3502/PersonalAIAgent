const UNSUPPORTED_ACTIONS = Object.freeze({
    send_email: "Email sending is disabled until a server-verified approval flow is implemented.",
    form_submit: "Form submission is not supported because browser automation is not implemented.",
    browser_action: "Browser actions are not supported because browser automation is not implemented."
});

function getActionApprovalResponse(requestBody) {
    const body = requestBody &&
        typeof requestBody === "object" &&
        !Array.isArray(requestBody)
        ? requestBody
        : {};
    const type = typeof body.type === "string" ? body.type.trim() : "";

    if (!type) {
        return {
            statusCode: 400,
            body: {
                success: false,
                message: "Action type is required."
            }
        };
    }

    const message = UNSUPPORTED_ACTIONS[type];
    if (!message) {
        return {
            statusCode: 400,
            body: {
                success: false,
                message: "Unsupported sensitive action type."
            }
        };
    }

    return {
        statusCode: 501,
        body: {
            success: false,
            message
        }
    };
}

module.exports = {
    getActionApprovalResponse
};
