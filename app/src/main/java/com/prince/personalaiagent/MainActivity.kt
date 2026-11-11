package com.prince.personalaiagent

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.prince.personalaiagent.data.remote.AgentApiException
import com.prince.personalaiagent.data.remote.AgentResponse
import com.prince.personalaiagent.data.remote.ChatApiClient
import com.prince.personalaiagent.ui.theme.PersonalAIAgentTheme
import dev.jeziellago.compose.markdowntext.MarkdownText
import kotlinx.coroutines.flow.first

data class ChatMessage(
    val id: Int,
    val text: String,
    val isUser: Boolean,
    val toolName: String? = null,
    val toolStatus: String? = null
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
                id = 0,
                text = "Hello! I'm your Personal AI Agent. How can I help you today?",
                isUser = false
            )
        )
    }

    val listState = rememberLazyListState()

    fun sendMessage() {

        val userMessage = input.trim()

        if (userMessage.isBlank() || isLoading) return

        val userId = (messages.maxOfOrNull { it.id } ?: 0) + 1

        messages.add(
            ChatMessage(
                id = userId,
                text = userMessage,
                isUser = true
            )
        )

        input = ""
        isLoading = true

        Thread {
            val result = try {
                ChatApiClient().sendMessage(userMessage)
            } catch (e: AgentApiException) {
                AgentResponse(
                    reply = "Connection error: ${e.message ?: "Please try again."}",
                    status = e.response.status,
                    toolName = e.response.toolName
                )
            } catch (e: Exception) {
                AgentResponse(
                    reply = "Connection error: ${e.message ?: "Please try again."}",
                    status = "unknown",
                    toolName = null
                )
            }

            Handler(Looper.getMainLooper()).post {

                messages.add(
                    ChatMessage(
                        id = userId + 1,
                        text = result.reply,
                        isUser = false,
                        toolName = result.toolName,
                        toolStatus = result.status
                    )
                )

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
                .padding(12.dp)
        ) {

            ChatMessageList(
                messages = messages,
                isLoading = isLoading,
                listState = listState,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            )

            Spacer(modifier = Modifier.height(8.dp))

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
                        // Voice input will be implemented later.
                    }
                ) {
                    Text("🎙️")
                }
            }
        }
    }
}

@Composable
internal fun ChatMessageList(
    messages: List<ChatMessage>,
    isLoading: Boolean,
    listState: LazyListState,
    modifier: Modifier = Modifier
) {
    LaunchedEffect(messages.size, isLoading) {
        val lastIndex = if (isLoading) messages.size else messages.lastIndex
        if (lastIndex >= 0) {
            snapshotFlow { listState.layoutInfo.totalItemsCount }
                .first { itemCount -> itemCount > lastIndex }
            listState.animateScrollToItem(lastIndex)
        }
    }

    LazyColumn(
        state = listState,
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(vertical = 8.dp)
    ) {
        items(
            items = messages,
            key = { message -> message.id }
        ) { message ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = if (message.isUser) {
                    Arrangement.End
                } else {
                    Arrangement.Start
                }
            ) {
                Surface(
                    modifier = Modifier.fillMaxWidth(0.90f),
                    color = if (message.isUser) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        MaterialTheme.colorScheme.secondaryContainer
                    },
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column {
                        MarkdownText(
                            markdown = message.text,
                            modifier = Modifier.padding(14.dp),
                            style = MaterialTheme.typography.bodyLarge,
                            wrapMultilineTextWidth = true
                        )
                        message.toolName?.let { toolName ->
                            val executionResult = when (message.toolStatus) {
                                "success" -> "succeeded"
                                "failed" -> "failed"
                                else -> "status unavailable"
                            }
                            Text(
                                text = "Tool: $toolName - $executionResult",
                                modifier = Modifier.padding(
                                    start = 14.dp,
                                    end = 14.dp,
                                    bottom = 12.dp
                                ),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.secondary
                            )
                        }
                    }
                }
            }
        }

        if (isLoading) {
            item(key = "loading") {
                Text(
                    text = "Thinking...",
                    color = MaterialTheme.colorScheme.secondary,
                    modifier = Modifier.padding(8.dp)
                )
            }
        }
    }
}
