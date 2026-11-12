package com.prince.personalaiagent

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import java.util.Locale

@Composable
fun VoiceInputControl(
    onTextRecognized: (String) -> Unit
) {
    val context = LocalContext.current
    val latestOnTextRecognized by rememberUpdatedState(onTextRecognized)
    var isListening by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val recognizer = remember(context) {
        if (SpeechRecognizer.isRecognitionAvailable(context)) {
            SpeechRecognizer.createSpeechRecognizer(context)
        } else {
            null
        }
    }

    DisposableEffect(recognizer) {
        onDispose {
            recognizer?.cancel()
            recognizer?.destroy()
        }
    }

    fun startListening() {
        val speechRecognizer = recognizer
        if (speechRecognizer == null) {
            errorMessage = "Speech recognition is unavailable on this device."
            return
        }

        errorMessage = null
        isListening = true
        try {
            speechRecognizer.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) = Unit
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() = Unit

                override fun onError(error: Int) {
                    isListening = false
                    errorMessage = speechErrorMessage(error)
                }

                override fun onResults(results: Bundle?) {
                    isListening = false
                    val recognizedText = results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
                        ?.trim()

                    if (recognizedText.isNullOrEmpty()) {
                        errorMessage = "No speech was recognized. Please try again."
                    } else {
                        latestOnTextRecognized(recognizedText)
                    }
                }

                override fun onPartialResults(partialResults: Bundle?) = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                )
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE,
                    Locale.getDefault().toLanguageTag()
                )
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            }
            speechRecognizer.startListening(intent)
        } catch (_: RuntimeException) {
            isListening = false
            errorMessage = "Could not start speech recognition. Please try again."
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            startListening()
        } else {
            errorMessage = "Microphone permission was denied. You can still type your message."
        }
    }

    Column {
        TextButton(
            onClick = {
                if (isListening) {
                    recognizer?.cancel()
                    isListening = false
                } else if (recognizer == null) {
                    errorMessage = "Speech recognition is unavailable on this device."
                } else if (
                    ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.RECORD_AUDIO
                    ) == PackageManager.PERMISSION_GRANTED
                ) {
                    startListening()
                } else {
                    permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
            }
        ) {
            Text(if (isListening) "Stop listening" else "Speak")
        }

        if (isListening) {
            Text(
                text = "Listening…",
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.labelSmall
            )
        }

        errorMessage?.let { message ->
            Text(
                text = message,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.labelSmall
            )
        }
    }
}

internal fun speechErrorMessage(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_AUDIO ->
        "There was a microphone audio error. Please try again."
    SpeechRecognizer.ERROR_CLIENT ->
        "Speech recognition was cancelled."
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
        "Microphone permission is required for voice input."
    SpeechRecognizer.ERROR_NETWORK,
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
        "Speech recognition could not reach its service."
    SpeechRecognizer.ERROR_NO_MATCH,
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
        "No speech was detected. Please try again."
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY ->
        "Speech recognition is busy. Please try again shortly."
    SpeechRecognizer.ERROR_SERVER ->
        "The speech-recognition service failed. Please try again."
    else ->
        "Speech recognition failed. You can still type your message."
}
