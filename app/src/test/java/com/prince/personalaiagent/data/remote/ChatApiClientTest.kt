package com.prince.personalaiagent.data.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException

class ChatApiClientTest {

    @Test
    fun nonSuccessfulHttpResponseThrowsTheServerError() {
        try {
            requireSuccessfulSensitiveActionResponse(
                responseCode = 501,
                success = false,
                message = "Email sending is disabled."
            )
            fail("Expected non-2xx response to throw.")
        } catch (error: IOException) {
            assertEquals("Email sending is disabled.", error.message)
        }
    }

    @Test
    fun successfulHttpResponseStillRequiresExplicitServerSuccess() {
        try {
            requireSuccessfulSensitiveActionResponse(
                responseCode = 200,
                success = false,
                message = "Action was not approved."
            )
            fail("Expected a success=false response to throw.")
        } catch (error: IOException) {
            assertEquals("Action was not approved.", error.message)
        }
    }

    @Test
    fun confirmedSuccessfulResponseReturnsItsMessage() {
        assertEquals(
            "Action completed.",
            requireSuccessfulSensitiveActionResponse(
                responseCode = 200,
                success = true,
                message = "Action completed."
            )
        )
    }
}
