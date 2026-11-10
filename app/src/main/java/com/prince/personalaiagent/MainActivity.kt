
package com.prince.personalaiagent

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.prince.personalaiagent.ui.theme.PersonalAIAgentTheme
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class ChatMessage(
    val text: String,
    val isUser: Boolean
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            PersonalAIAgentTheme {
                AgentScreen()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentScreen() {

    var input by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }

    val messages = remember {
        mutableStateListOf(
            ChatMessage(
                "Hello! I'm your Personal AI Agent. How can I help you today?",
                false
            )
        )
    }

    val listState = rememberLazyListState()

    LaunchedEffect(messages.size, isLoading) {
        val lastIndex = if (isLoading) {
            messages.size
        } else {
            messages.lastIndex
        }

        if (lastIndex >= 0) {
            listState.animateScrollToItem(lastIndex)
        }
    }

    fun sendMessage() {
        val userMessage = input.trim()

        if (userMessage.isBlank() || isLoading) return

        messages.add(ChatMessage(userMessage, true))
        input = ""
        isLoading = true

        // Run the network request on a background thread.
        Thread {
            var result: String

            try {
                val url = URL("http://10.0.2.2:3000/api/chat")
                val connection = url.openConnection() as HttpURLConnection

                connection.requestMethod = "POST"
                connection.connectTimeout = 15000
                connection.readTimeout = 60000
                connection.doOutput = true
                connection.setRequestProperty(
                    "Content-Type",
                    "application/json"
                )

                val requestBody = JSONObject()
                    .put("message", userMessage)
                    .toString()

                connection.outputStream.use { output ->
                    output.write(requestBody.toByteArray(Charsets.UTF_8))
                }

                val responseCode = connection.responseCode

                val responseStream = if (responseCode in 200..299) {
                    connection.inputStream
                } else {
                    connection.errorStream
                }

                val responseText = responseStream
                    ?.bufferedReader()
                    ?.use { it.readText() }
                    ?: ""

                val json = JSONObject(responseText)

                result = if (responseCode in 200..299) {
                    json.optString(
                        "reply",
                        "The AI returned an empty response."
                    )
                } else {
                    json.optString(
                        "error",
                        "Server error. Please try again."
                    )
                }

                connection.disconnect()

            } catch (e: Exception) {
                result = "Connection error: ${e.message ?: "Please try again."}"
            }

            // Update Compose state on the main UI thread.
            android.os.Handler(
                android.os.Looper.getMainLooper()
            ).post {
                messages.add(ChatMessage(result, false))
                isLoading = false
            }

        }.start()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text("Personal AI Agent")
                }
            )
        }
    ) { padding ->

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
        ) {

            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {

                items(messages) { message ->

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = if (message.isUser) {
                            Arrangement.End
                        } else {
                            Arrangement.Start
                        }
                    ) {

                        Surface(
                            color = if (message.isUser) {
                                MaterialTheme.colorScheme.primaryContainer
                            } else {
                                MaterialTheme.colorScheme.secondaryContainer
                            },
                            shape = RoundedCornerShape(16.dp)
                        ) {

                            Text(
                                text = message.text,
                                modifier = Modifier.padding(14.dp)
                            )
                        }
                    }
                }

                if (isLoading) {
                    item {
                        Text(
                            text = "Thinking...",
                            color = MaterialTheme.colorScheme.secondary
                        )
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {

                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it },
                    modifier = Modifier.weight(1f),
                    placeholder = {
                        Text("Ask me anything...")
                    },
                    maxLines = 3
                )

                IconButton(
                    onClick = { sendMessage() },
                    enabled = input.isNotBlank() && !isLoading
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Send,
                        contentDescription = "Send"
                    )
                }

                IconButton(
                    onClick = {
                        // Voice input will be implemented next.
                    }
                ) {
                    Text("🎙")
                }
            }
        }
    }
}
