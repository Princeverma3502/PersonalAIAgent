const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
    createPendingEmailApproval,
    createPendingWebNavigationApproval,
    getActionApprovalResponse
} = require("../src/agent/actionApproval");

const email = {
    to: "user@example.com",
    subject: "Hello",
    body: "Body text"
};

function createSender() {
    const calls = [];
    return {
        calls,
        sendEmail: async payload => {
            calls.push(payload);
        }
    };
}

test("missing and invalid approval tokens never send email", async () => {
    const sender = createSender();
    const bodies = [
        { type: "send_email" },
        { type: "send_email", approvalToken: "" },
        { type: "send_email", approvalToken: "client-generated-token" }
    ];

    for (const body of bodies) {
        const result = await getActionApprovalResponse(body, sender);
        assert.equal(result.statusCode, 401);
        assert.equal(result.body.success, false);
        assert.equal(result.body.sent, false);
    }

    assert.deepEqual(sender.calls, []);
});

test("an unapproved model-requested action cannot send email", async () => {
    const sender = createSender();
    const result = await getActionApprovalResponse({
        type: "send_email",
        payload: email
    }, sender);

    assert.equal(result.statusCode, 401);
    assert.equal(result.body.success, false);
    assert.deepEqual(sender.calls, []);
});

test("mismatched email content is rejected without consuming the approval", async () => {
    const sender = createSender();
    const pending = createPendingEmailApproval(email);
    const mismatch = await getActionApprovalResponse({
        type: "send_email",
        approvalToken: pending.approvalToken,
        payload: { ...email, body: "Changed after approval" }
    }, sender);

    assert.equal(mismatch.statusCode, 409);
    assert.deepEqual(sender.calls, []);

    const approved = await getActionApprovalResponse({
        type: "send_email",
        approvalToken: pending.approvalToken
    }, sender);

    assert.equal(approved.statusCode, 200);
    assert.deepEqual(sender.calls, [email]);
});

test("approval is bound to the send_email action type", async () => {
    const sender = createSender();
    const pending = createPendingEmailApproval(email);
    const result = await getActionApprovalResponse({
        type: "submit_form",
        approvalToken: pending.approvalToken
    }, sender);

    assert.equal(result.statusCode, 409);
    assert.equal(result.body.success, false);
    assert.deepEqual(sender.calls, []);
});

test("expired approval tokens cannot send email", async () => {
    const sender = createSender();
    const pending = createPendingEmailApproval(email);
    const result = await getActionApprovalResponse({
        type: "send_email",
        approvalToken: pending.approvalToken
    }, {
        ...sender,
        now: Date.parse(pending.expiresAt) + 1
    });

    assert.equal(result.statusCode, 410);
    assert.equal(result.body.sent, false);
    assert.deepEqual(sender.calls, []);
});

test("successful approval sends only the server-stored payload and cannot replay", async () => {
    const sender = createSender();
    const pending = createPendingEmailApproval(email);
    const first = await getActionApprovalResponse({
        type: "send_email",
        approvalToken: pending.approvalToken
    }, sender);
    const replay = await getActionApprovalResponse({
        type: "send_email",
        approvalToken: pending.approvalToken
    }, sender);

    assert.equal(first.statusCode, 200);
    assert.equal(first.body.success, true);
    assert.equal(first.body.sent, true);
    assert.equal(replay.statusCode, 401);
    assert.equal(replay.body.success, false);
    assert.deepEqual(sender.calls, [email]);
});

test("send failure consumes approval and reports an unknown delivery outcome", async () => {
    const pending = createPendingEmailApproval(email);
    const result = await getActionApprovalResponse({
        type: "send_email",
        approvalToken: pending.approvalToken
    }, {
        sendEmail: async () => {
            throw new Error("Gmail could not confirm whether the email was sent.");
        }
    });

    assert.equal(result.statusCode, 502);
    assert.equal(result.body.success, false);
    assert.equal(result.body.sent, null);
    assert.equal(result.body.outcome, "unknown");
});

test("form submission and browser actions remain unsupported", async () => {
    for (const type of ["submit_form", "click_element", "browser_action"]) {
        const result = await getActionApprovalResponse({ type });
        assert.equal(result.statusCode, 501);
        assert.equal(result.body.success, false);
        assert.match(result.body.message, /not implemented/i);
    }
});

test("approved webpage navigation uses the stored URL once and rejects replay", async () => {
    const pending = createPendingWebNavigationApproval({
        url: "https://example.com/docs",
        searchTerm: "agent"
    });
    const calls = [];
    const first = await getActionApprovalResponse({
        type: "read_public_webpage",
        approvalToken: pending.approvalToken
    }, {
        navigateWebPage: async payload => {
            calls.push(payload);
            return {
                page: {
                    url: payload.url,
                    title: "Docs",
                    text: "Safe extracted text.",
                    links: []
                },
                summary: "A concise summary."
            };
        }
    });
    const replay = await getActionApprovalResponse({
        type: "read_public_webpage",
        approvalToken: pending.approvalToken
    }, {
        navigateWebPage: async () => {
            throw new Error("Replay must not navigate.");
        }
    });

    assert.equal(first.statusCode, 200);
    assert.equal(first.body.success, true);
    assert.equal(first.body.navigated, true);
    assert.equal(first.body.summary, "A concise summary.");
    assert.deepEqual(calls, [{
        url: "https://example.com/docs",
        searchTerm: "agent"
    }]);
    assert.equal(replay.statusCode, 401);
    assert.deepEqual(calls.length, 1);
});

test("expired webpage approval never invokes navigation", async () => {
    const pending = createPendingWebNavigationApproval({
        url: "https://example.com/"
    });
    let calls = 0;
    const result = await getActionApprovalResponse({
        type: "read_public_webpage",
        approvalToken: pending.approvalToken
    }, {
        now: Date.parse(pending.expiresAt) + 1,
        navigateWebPage: async () => {
            calls += 1;
        }
    });

    assert.equal(result.statusCode, 410);
    assert.equal(result.body.navigated, false);
    assert.equal(calls, 0);
});
