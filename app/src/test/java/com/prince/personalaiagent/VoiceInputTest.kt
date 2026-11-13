package com.prince.personalaiagent

import android.speech.SpeechRecognizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceInputTest {
    @Test
    fun recognizedSpeechUsesFirstNonBlankCandidateAndTrimsIt() {
        assertEquals(
            "Remember my meeting",
            firstRecognizedSpeechResult(
                listOf("  ", "  Remember my meeting  ", "Another result")
            )
        )
    }

    @Test
    fun missingOrBlankRecognitionResultsAreRejected() {
        assertTrue(firstRecognizedSpeechResult(null) == null)
        assertTrue(firstRecognizedSpeechResult(listOf("", "  ")) == null)
    }

    @Test
    fun silenceAndPermissionErrorsHaveHelpfulMessages() {
        assertTrue(
            speechErrorMessage(SpeechRecognizer.ERROR_NO_MATCH)
                .contains("not understood")
        )
        assertTrue(
            speechErrorMessage(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS)
                .contains("permission")
        )
    }

    @Test
    fun networkErrorsExplainConnectivityAndTimeoutSeparately() {
        assertTrue(
            speechErrorMessage(SpeechRecognizer.ERROR_NETWORK)
                .contains("connection")
        )
        assertTrue(
            speechErrorMessage(SpeechRecognizer.ERROR_NETWORK_TIMEOUT)
                .contains("timed out")
        )
    }

    @Test
    fun speechTimeoutAndClientErrorsAreNotReportedAsSuccessfulRecognition() {
        assertTrue(
            speechErrorMessage(SpeechRecognizer.ERROR_SPEECH_TIMEOUT)
                .contains("No speech")
        )
        assertTrue(
            speechErrorMessage(SpeechRecognizer.ERROR_CLIENT)
                .contains("client error")
        )
    }

    @Test
    fun everyRecognitionErrorHasAnActionableMessage() {
        val errors = listOf(
            SpeechRecognizer.ERROR_NETWORK,
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
            SpeechRecognizer.ERROR_NO_MATCH,
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS,
            SpeechRecognizer.ERROR_CLIENT
        )

        errors.forEach { error ->
            assertTrue(
                "Expected an actionable message for error code $error",
                speechErrorMessage(error).isNotBlank()
            )
        }
    }
}
