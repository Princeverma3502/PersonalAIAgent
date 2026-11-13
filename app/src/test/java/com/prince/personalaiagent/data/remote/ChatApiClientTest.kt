package com.prince.personalaiagent.data.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatApiClientTest {

    @Test
    fun nonSuccessfulHttpResponseCannotBeReportedAsSent() {
        val result = resolveSensitiveActionResponse(
            responseCode = 501,
            success = false,
            sent = false,
            outcome = "failed",
            message = "Email sending is unavailable."
        )

        assertFalse(result.success)
        assertEquals(false, result.sent)
        assertEquals("failed", result.outcome)
        assertEquals("Email sending is unavailable.", result.message)
    }

    @Test
    fun successfulHttpResponseRequiresExplicitSentConfirmation() {
        val result = resolveSensitiveActionResponse(
            responseCode = 200,
            success = true,
            sent = false,
            outcome = "failed",
            message = "Email was not sent."
        )

        assertFalse(result.success)
        assertEquals(false, result.sent)
    }

    @Test
    fun onlyAConfirmedServerSendIsReportedAsSuccessful() {
        val result = resolveSensitiveActionResponse(
            responseCode = 200,
            success = true,
            sent = true,
            outcome = "sent",
            message = "Email sent successfully."
        )

        assertTrue(result.success)
        assertEquals(true, result.sent)
        assertEquals("sent", result.outcome)
        assertEquals("Email sent successfully.", result.message)
    }

    @Test
    fun unknownDeliveryOutcomeIsNotReportedAsFailureOrSuccess() {
        val result = resolveSensitiveActionResponse(
            responseCode = 502,
            success = false,
            sent = null,
            outcome = "unknown",
            message = "Gmail could not confirm whether the email was sent."
        )

        assertFalse(result.success)
        assertEquals(null, result.sent)
        assertEquals("unknown", result.outcome)
    }
}
