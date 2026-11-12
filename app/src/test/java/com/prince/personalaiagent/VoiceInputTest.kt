package com.prince.personalaiagent

import android.speech.SpeechRecognizer
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceInputTest {
    @Test
    fun silenceAndPermissionErrorsHaveHelpfulMessages() {
        assertTrue(
            speechErrorMessage(SpeechRecognizer.ERROR_NO_MATCH)
                .contains("No speech")
        )
        assertTrue(
            speechErrorMessage(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS)
                .contains("permission")
        )
    }
}
