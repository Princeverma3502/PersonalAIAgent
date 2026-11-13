package com.prince.personalaiagent

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
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

private const val SPEECH_RECOGNIZER_TAG = "VoiceInput"

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
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            Log.w(SPEECH_RECOGNIZER_TAG, "No speech-recognition service is available")
            isListening = false
            errorMessage = "Speech recognition is unavailable on this device."
            return
        }

        val speechRecognizer = recognizer
        if (speechRecognizer == null) {
            Log.w(
                SPEECH_RECOGNIZER_TAG,
                "Speech-recognition service became available after control initialization"
            )
            isListening = false
            errorMessage = "Speech recognition is unavailable on this device."
            return
        }

        errorMessage = null
        isListening = true
        try {
            speechRecognizer.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    Log.d(SPEECH_RECOGNIZER_TAG, "onReadyForSpeech")
                }

                override fun onBeginningOfSpeech() {
                    Log.d(SPEECH_RECOGNIZER_TAG, "onBeginningOfSpeech")
                }

                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit

                override fun onEndOfSpeech() {
                    Log.d(SPEECH_RECOGNIZER_TAG, "onEndOfSpeech")
                }

                override fun onError(error: Int) {
                    isListening = false
                    val message = speechErrorMessage(error)
                    Log.w(
                        SPEECH_RECOGNIZER_TAG,
                        "onError code=$error message=$message"
                    )
                    errorMessage = message
                }

                override fun onResults(results: Bundle?) {
                    isListening = false
                    val candidates = results?.getStringArrayList(
                        SpeechRecognizer.RESULTS_RECOGNITION
                    )
                    val recognizedText = firstRecognizedSpeechResult(candidates)
                    Log.i(
                        SPEECH_RECOGNIZER_TAG,
                        "onResults candidateCount=${candidates?.size ?: 0}, " +
                            "hasUsableText=${recognizedText != null}"
                    )

                    if (recognizedText.isNullOrEmpty()) {
                        errorMessage = "No usable speech transcription was returned. Please try again."
                    } else {
                        errorMessage = null
                        latestOnTextRecognized(recognizedText)
                    }
                }

                override fun onPartialResults(partialResults: Bundle?) {
                    val count = partialResults
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.size ?: 0
                    Log.d(SPEECH_RECOGNIZER_TAG, "onPartialResults candidateCount=$count")
                }

                override fun onEvent(eventType: Int, params: Bundle?) {
                    Log.d(SPEECH_RECOGNIZER_TAG, "onEvent type=$eventType")
                }
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
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            }
            Log.d(
                SPEECH_RECOGNIZER_TAG,
                "Starting recognition language=${Locale.getDefault().toLanguageTag()} " +
                    "model=${RecognizerIntent.LANGUAGE_MODEL_FREE_FORM}"
            )
            speechRecognizer.startListening(intent)
        } catch (exception: SecurityException) {
            isListening = false
            Log.e(SPEECH_RECOGNIZER_TAG, "Missing permission while starting recognition", exception)
            errorMessage = "Microphone permission is required for voice input."
        } catch (exception: IllegalStateException) {
            isListening = false
            Log.e(SPEECH_RECOGNIZER_TAG, "Speech recognizer could not start", exception)
            errorMessage = "Speech recognition could not start. Please try again."
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

internal fun firstRecognizedSpeechResult(results: List<String>?): String? =
    results?.firstOrNull { it.isNotBlank() }?.trim()

internal fun speechErrorMessage(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_AUDIO ->
        "There was a microphone audio error. Please try again."
    SpeechRecognizer.ERROR_CLIENT ->
        "Speech recognition stopped or encountered a client error. Please try again."
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
        "Microphone permission is required for voice input."
    SpeechRecognizer.ERROR_NETWORK ->
        "Speech recognition could not reach its network service. Check your connection."
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
        "The speech-recognition network request timed out. Please try again."
    SpeechRecognizer.ERROR_NO_MATCH ->
        "Speech was not understood. Speak clearly and try again."
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
        "No speech was detected. Please try again."
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY ->
        "Speech recognition is busy. Please try again shortly."
    SpeechRecognizer.ERROR_SERVER ->
        "The speech-recognition service failed. Please try again."
    else ->
        "Speech recognition failed. You can still type your message."
}
