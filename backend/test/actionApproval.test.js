const assert = require("node:assert/strict");
const { test } = require("node:test");

const gmailService = require("../src/gmail/gmailService");
const { getActionApprovalResponse } =
    require("../src/agent/actionApproval");
const { validateToolName } = require("../src/agent/tools");

test("send_email is disabled and never calls the Gmail send API", async () => {
    const tool = validateToolName("send_email");
    assert.ok(tool, "send_email should return an explicit unsupported result");
    assert.equal(typeof gmailService.sendEmailViaGmail, "undefined");
    assert.equal(
        tool.validateArgs({
            to: "user@example.com",
            subject: "Hello",
            body: "Body text"
        }),
        true
    );

    const result = await tool.handler({
        to: "user@example.com",
        subject: "Hello",
        body: "Body text"
    });

    assert.equal(result.success, false);
    assert.equal(result.sent, false);
    assert.match(result.message, /disabled.*secure approval/i);
});

test("draft_email remains separate from sending and never calls Gmail send", async () => {
    const draftTool = validateToolName("draft_email");
    assert.ok(draftTool);
    const result = await draftTool.handler({
        to: "user@example.com",
        subject: "Hello",
        body: "Body text"
    });

    assert.equal(result.success, true);
    assert.match(result.message, /not been sent/i);
    assert.deepEqual(result.draft, {
        to: "user@example.com",
        subject: "Hello",
        body: "Body text"
    });
    assert.equal(typeof gmailService.sendEmailViaGmail, "undefined");
});

test("missing, empty, and arbitrary tokens never approve email sending", () => {
    const payloads = [
        {},
        { confirmationToken: "" },
        { confirmationToken: "client-generated-token" },
        {
            to: "user@example.com",
            subject: "Hello",
            body: "Body text",
            confirmationToken: "client-generated-token"
        }
    ];

    for (const payload of payloads) {
        const response = getActionApprovalResponse({
            type: "send_email",
            payload
        });

        assert.equal(response.statusCode, 501);
        assert.equal(response.body.success, false);
        assert.match(response.body.message, /disabled/i);
    }
});

test("mismatched action arguments cannot be approved or sent", () => {
    const response = getActionApprovalResponse({
        type: "send_email",
        payload: {
            to: "different@example.com",
            subject: "Changed after confirmation",
            body: "Changed message body",
            confirmationToken: "unbound-token"
        }
    });

    assert.equal(response.statusCode, 501);
    assert.equal(response.body.success, false);
    assert.match(response.body.message, /disabled/i);
});

test("a model-requested but unapproved send action is unsupported", () => {
    const response = getActionApprovalResponse({
        type: "send_email",
        payload: {
            to: "user@example.com",
            subject: "Hello",
            body: "Body text"
        }
    });

    assert.equal(response.statusCode, 501);
    assert.equal(response.body.success, false);
    assert.match(response.body.message, /server-verified approval/i);
});

test("form submission and browser actions are explicitly unsupported", () => {
    for (const type of ["form_submit", "browser_action"]) {
        const response = getActionApprovalResponse({
            type,
            payload: { confirmationToken: "unused" }
        });

        assert.equal(response.statusCode, 501);
        assert.equal(response.body.success, false);
        assert.match(response.body.message, /not implemented/i);
    }

    const browserTool = validateToolName("perform_browser_action");
    assert.ok(browserTool);
    const result = browserTool.handler();
    return result.then(browserResult => {
        assert.equal(browserResult.success, false);
        assert.match(browserResult.message, /not configured|not implemented/i);
    });
});
