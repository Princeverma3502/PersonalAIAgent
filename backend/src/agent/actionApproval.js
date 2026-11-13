const crypto = require("node:crypto");
const { validateWebUrl } = require("./browserService");

const APPROVAL_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING_APPROVALS = 500;
const pendingApprovals = new Map();
const EMAIL_FIELDS = ["to", "subject", "body"];
const EMAIL_ADDRESS_PATTERN =
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const APPROVAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function normalizeEmailPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Email approval requires a recipient, subject, and body.");
    }

    const to = typeof payload.to === "string" ? payload.to.trim() : "";
    const subject =
        typeof payload.subject === "string" ? payload.subject.trim() : "";
    const body = typeof payload.body === "string" ? payload.body.trim() : "";
    if (!EMAIL_ADDRESS_PATTERN.test(to) || to.length > 254) {
        throw new Error("A valid email recipient is required.");
    }
    if (
        !subject ||
        subject.length > 200 ||
        /[\x00-\x1F\x7F]/.test(subject)
    ) {
        throw new Error("A valid email subject is required.");
    }
    if (!body || body.length > 10000) {
        throw new Error("A valid email body is required.");
    }

    return { to, subject, body };
}

function tokenDigest(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function removeExpiredApprovals(now) {
    for (const [digest, approval] of pendingApprovals) {
        if (approval.expiresAt <= now) pendingApprovals.delete(digest);
    }
}

function createPendingEmailApproval(payload, now = Date.now()) {
    const approvedPayload = normalizeEmailPayload(payload);
    removeExpiredApprovals(now);

    if (pendingApprovals.size >= MAX_PENDING_APPROVALS) {
        throw new Error("Too many pending email approvals. Try again shortly.");
    }

    const approvalToken = crypto.randomBytes(32).toString("base64url");
    const expiresAt = now + APPROVAL_TTL_MS;
    pendingApprovals.set(tokenDigest(approvalToken), {
        type: "send_email",
        payload: Object.freeze({ ...approvedPayload }),
        expiresAt
    });

    return {
        type: "send_email",
        payload: { ...approvedPayload },
        approvalToken,
        expiresAt: new Date(expiresAt).toISOString()
    };
}

function normalizeWebNavigationPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Web navigation approval requires a URL.");
    }

    const url = validateWebUrl(payload.url).href;
    const searchTerm = payload.searchTerm === undefined
        ? undefined
        : typeof payload.searchTerm === "string" &&
            payload.searchTerm.trim().length <= 100
            ? payload.searchTerm.trim()
            : null;

    if (searchTerm === null) {
        throw new Error("A valid webpage search term is required.");
    }

    return {
        url,
        ...(searchTerm ? { searchTerm } : {})
    };
}

function createPendingWebNavigationApproval(payload, now = Date.now()) {
    const approvedPayload = normalizeWebNavigationPayload(payload);
    removeExpiredApprovals(now);

    if (pendingApprovals.size >= MAX_PENDING_APPROVALS) {
        throw new Error("Too many pending approvals. Try again shortly.");
    }

    const approvalToken = crypto.randomBytes(32).toString("base64url");
    const expiresAt = now + APPROVAL_TTL_MS;
    pendingApprovals.set(tokenDigest(approvalToken), {
        type: "read_public_webpage",
        payload: Object.freeze({ ...approvedPayload }),
        expiresAt
    });

    return {
        type: "read_public_webpage",
        payload: { ...approvedPayload },
        approvalToken,
        expiresAt: new Date(expiresAt).toISOString()
    };
}

function validateEmailApprovalResponse(action) {
    if (
        !action ||
        typeof action !== "object" ||
        action.type !== "send_email" ||
        typeof action.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(action.expiresAt))
    ) {
        return false;
    }

    try {
        normalizeEmailPayload(action.payload);
        return true;
    } catch {
        return false;
    }
}

function validateWebNavigationApprovalResponse(action) {
    if (
        !action ||
        typeof action !== "object" ||
        action.type !== "read_public_webpage" ||
        typeof action.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(action.expiresAt))
    ) {
        return false;
    }

    try {
        normalizeWebNavigationPayload(action.payload);
        return true;
    } catch {
        return false;
    }
}

function sameEmailPayload(left, right) {
    try {
        const normalizedLeft = normalizeEmailPayload(left);
        const normalizedRight = normalizeEmailPayload(right);
        return EMAIL_FIELDS.every(
            field => normalizedLeft[field] === normalizedRight[field]
        );
    } catch {
        return false;
    }
}

function response(statusCode, body) {
    return { statusCode, body };
}

async function getActionApprovalResponse(
    requestBody,
    { sendEmail, navigateWebPage, now = Date.now() } = {}
) {
    const body =
        requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
            ? requestBody
            : {};

    if (typeof body.type !== "string" || !body.type) {
        return response(400, {
            success: false,
            sent: false,
            message: "An action type is required."
        });
    }

    if (body.type === "read_public_webpage") {
        const token = body.approvalToken;
        if (
            typeof token !== "string" ||
            !APPROVAL_TOKEN_PATTERN.test(token)
        ) {
            return response(401, {
                success: false,
                navigated: false,
                message: "A valid webpage approval token is required."
            });
        }

        const digest = tokenDigest(token);
        const pending = pendingApprovals.get(digest);
        if (!pending) {
            return response(401, {
                success: false,
                navigated: false,
                message: "The webpage approval is invalid, expired, or already used."
            });
        }
        if (pending.expiresAt <= now) {
            pendingApprovals.delete(digest);
            return response(410, {
                success: false,
                navigated: false,
                message: "The webpage approval has expired. Prepare the navigation again."
            });
        }
        if (pending.type !== body.type) {
            return response(409, {
                success: false,
                navigated: false,
                message: "The approval token does not match this action."
            });
        }
        if (Object.keys(body).some(key => !["type", "approvalToken"].includes(key))) {
            return response(400, {
                success: false,
                navigated: false,
                message: "Unexpected approval request fields."
            });
        }
        if (typeof navigateWebPage !== "function") {
            return response(503, {
                success: false,
                navigated: false,
                message: "Web navigation is unavailable."
            });
        }

        pendingApprovals.delete(digest);
        try {
            const result = await navigateWebPage({ ...pending.payload });
            return response(200, {
                success: true,
                navigated: true,
                ...result,
                message: "The approved webpage was retrieved."
            });
        } catch (error) {
            return response(502, {
                success: false,
                navigated: false,
                outcome: "failed",
                message: error?.message || "The approved webpage could not be retrieved."
            });
        }
    }

    if (body.type !== "send_email") {
        if (
            typeof body.approvalToken === "string" &&
            APPROVAL_TOKEN_PATTERN.test(body.approvalToken) &&
            pendingApprovals.has(tokenDigest(body.approvalToken))
        ) {
            return response(409, {
                success: false,
                sent: false,
                message: "The approval token does not match this action."
            });
        }
        if (["submit_form", "click_element", "browser_action"].includes(body.type)) {
            return response(501, {
                success: false,
                message: `${body.type} is not implemented.`
            });
        }
        return response(400, {
            success: false,
            message: "Unsupported approval action."
        });
    }

    const token = body.approvalToken;
    if (
        typeof token !== "string" ||
        !APPROVAL_TOKEN_PATTERN.test(token)
    ) {
        return response(401, {
            success: false,
            sent: false,
            message: "A valid email approval token is required."
        });
    }

    const digest = tokenDigest(token);
    const pending = pendingApprovals.get(digest);
    if (!pending) {
        return response(401, {
            success: false,
            sent: false,
            message: "The email approval is invalid, expired, or already used."
        });
    }
    if (pending.expiresAt <= now) {
        pendingApprovals.delete(digest);
        return response(410, {
            success: false,
            sent: false,
            message: "The email approval has expired. Prepare the email again."
        });
    }
    if (pending.type !== body.type) {
        return response(409, {
            success: false,
            sent: false,
            message: "The approval token does not match this action."
        });
    }

    const allowedKeys = new Set(["type", "approvalToken", "payload"]);
    if (Object.keys(body).some(key => !allowedKeys.has(key))) {
        return response(400, {
            success: false,
            sent: false,
            message: "Unexpected approval request fields."
        });
    }
    if (
        body.payload !== undefined &&
        !sameEmailPayload(body.payload, pending.payload)
    ) {
        return response(409, {
            success: false,
            sent: false,
            message: "The approved email content does not match the pending action."
        });
    }
    if (typeof sendEmail !== "function") {
        return response(503, {
            success: false,
            sent: false,
            message: "Email sending is unavailable."
        });
    }

    pendingApprovals.delete(digest);

    try {
        await sendEmail({ ...pending.payload });
        return response(200, {
            success: true,
            sent: true,
            message: "Email sent successfully."
        });
    } catch (error) {
        const outcome = error && error.sendOutcome === "failed"
            ? "failed"
            : "unknown";
        const message = error && typeof error.message === "string"
            ? error.message
            : "Gmail could not confirm whether the email was sent.";

        return response(502, {
            success: false,
            sent: outcome === "failed" ? false : null,
            outcome,
            message
        });
    }
}

module.exports = {
    APPROVAL_TTL_MS,
    createPendingEmailApproval,
    createPendingWebNavigationApproval,
    getActionApprovalResponse,
    validateEmailApprovalResponse,
    validateWebNavigationApprovalResponse
};
