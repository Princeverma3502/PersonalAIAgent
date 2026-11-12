
package com.prince.personalaiagent

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Debug
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.prince.personalaiagent.data.local.MemoryDatabase
import com.prince.personalaiagent.data.local.MemoryRelevanceRanker
import com.prince.personalaiagent.data.local.MemoryRepository
import com.prince.personalaiagent.data.remote.AgentApiException
import com.prince.personalaiagent.data.remote.AgentResponse
import com.prince.personalaiagent.data.remote.ChatApiClient
import com.prince.personalaiagent.data.remote.EmailDraft
import com.prince.personalaiagent.ui.theme.PersonalAIAgentTheme
import dev.jeziellago.compose.markdowntext.MarkdownText
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class ChatMessage(
    val id: Int,
    val text: String,
    val isUser: Boolean,
    val toolName: String? = null,
    val toolStatus: String? = null,
    val emailDrafts: List<EmailDraft> = emptyList(),
    val browserUrl: String? = null,
    val schedulerDelayMs: Long? = null,
    val requestDurationMs: Long? = null,
    val processPssKb: Int? = null
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ReminderWorkScheduler.enqueue(this)

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

    val context = LocalContext.current
    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {}

    val memoryRepository = remember {
        MemoryRepository(
            MemoryDatabase.getDatabase(context).memoryDao()
        )
    }

    val coroutineScope = rememberCoroutineScope()

    var showMemoryScreen by remember {
        mutableStateOf(false)
    }
    var showBrowserScreen by remember {
        mutableStateOf(false)
    }
    var browserStartUrl by remember {
        mutableStateOf<String?>(null)
    }

    var input by remember {
        mutableStateOf("")
    }

    var isLoading by remember {
        mutableStateOf(false)
    }

    var pendingDeletionKeyword by remember {
        mutableStateOf<String?>(null)
    }

    var pendingDeleteAll by remember {
        mutableStateOf(false)
    }

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
    val apiClient = remember { ChatApiClient() }
    val displayedReminderIds = remember { mutableSetOf<String>() }
    var reminderServiceUnavailable by remember {
        mutableStateOf(false)
    }

    LaunchedEffect(Unit) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(
                Manifest.permission.POST_NOTIFICATIONS
            )
        }
    }

    LaunchedEffect(apiClient) {
        while (isActive) {
            try {
                val reminders = withContext(Dispatchers.IO) {
                    apiClient.getPendingReminders()
                }
                reminderServiceUnavailable = false

                reminders.forEach { reminder ->
                    if (displayedReminderIds.add(reminder.taskId)) {
                        val nextId = (messages.maxOfOrNull { it.id } ?: 0) + 1
                        messages.add(
                            ChatMessage(
                                id = nextId,
                                text = "**Reminder: ${reminder.title}**\n\n${reminder.message}",
                                isUser = false,
                                toolName = "scheduled_reminder",
                                toolStatus = "success",
                                schedulerDelayMs = reminder.executionDelayMs
                            )
                        )
                    }

                    withContext(Dispatchers.IO) {
                        apiClient.acknowledgeReminder(reminder.taskId)
                    }
                }
            } catch (_: Exception) {
                reminderServiceUnavailable = true
            }

            delay(30_000)
        }
    }

    fun sendMessage() {

        val userMessage = input.trim()

        if (userMessage.isBlank() || isLoading) return

        val keywordToConfirm = pendingDeletionKeyword
        val deleteAllToConfirm = pendingDeleteAll

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

        coroutineScope.launch {

            val result = withContext(Dispatchers.IO) {

                try {

                    val command = userMessage.lowercase().trim()

                    // MEMORY-SAVING PHRASES
                    val memoryPrefixes = listOf(
                        "remember that ",
                        "remember this: ",
                        "remember this ",
                        "remember my ",
                        "remember i am ",
                        "remember i'm ",
                        "remember ",
                        "memorize that ",
                        "memorise that ",
                        "memorize this: ",
                        "memorise this: ",
                        "memorize this ",
                        "memorise this ",
                        "memorize it: ",
                        "memorise it: ",
                        "memorize it ",
                        "memorise it ",
                        "memorize ",
                        "memorise ",
                        "save this information: ",
                        "save this information ",
                        "save this: ",
                        "save this ",
                        "save that ",
                        "keep in mind that ",
                        "keep in mind ",
                        "don't forget that ",
                        "dont forget that ",
                        "do not forget that "
                    )

                    val matchedMemoryPrefix = memoryPrefixes.firstOrNull {
                        command.startsWith(it)
                    }

                    when {

                        // CANCEL A PENDING DELETION
                        (command == "cancel" || command == "no") &&
                                (keywordToConfirm != null || deleteAllToConfirm) -> {

                            AgentResponse(
                                reply = "Deletion cancelled. Your saved memories are safe.",
                                status = "success",
                                toolName = "cancel_deletion"
                            )
                        }

                        // CONFIRM DELETION OF SPECIFIC MEMORIES
                        (command == "confirm" || command == "yes") &&
                                keywordToConfirm != null -> {

                            val memories =
                                memoryRepository.searchMemories(keywordToConfirm)

                            memories.forEach { memory ->
                                memoryRepository.deleteMemory(memory)
                            }

                            AgentResponse(
                                reply = if (memories.isEmpty()) {
                                    "No matching memories were found. Nothing was deleted."
                                } else {
                                    "Deleted ${memories.size} matching saved memory/memories."
                                },
                                status = "success",
                                toolName = "delete_memory"
                            )
                        }

                        // CONFIRM DELETION OF ALL MEMORIES
                        (command == "confirm" || command == "yes") &&
                                deleteAllToConfirm -> {

                            memoryRepository.deleteAllMemories()

                            AgentResponse(
                                reply = "All saved memories have been deleted.",
                                status = "success",
                                toolName = "delete_all_memories"
                            )
                        }

                        // SAVE MEMORY
                        matchedMemoryPrefix != null -> {

                            val memoryContent = userMessage
                                .drop(matchedMemoryPrefix.length)
                                .trim()
                                .trimEnd('.', '!', '?', ',')

                            if (memoryContent.isBlank()) {

                                AgentResponse(
                                    reply = "Please tell me what you want me to remember. For example: Remember that my favourite language is Java.",
                                    status = "success",
                                    toolName = "save_memory"
                                )

                            } else {

                                memoryRepository.saveMemory(memoryContent)

                                AgentResponse(
                                    reply = "I've saved this in your memories:\n\n**$memoryContent**",
                                    status = "success",
                                    toolName = "save_memory"
                                )
                            }
                        }

                        // REQUEST TO DELETE ALL MEMORIES
                        command == "forget all memories" ||
                                command == "delete all memories" -> {

                            AgentResponse(
                                reply = "Are you sure you want to delete ALL saved memories? Type CONFIRM to proceed or CANCEL to keep them.",
                                status = "success",
                                toolName = "pending_delete_all"
                            )
                        }

                        // SHOW ALL MEMORIES
                        command == "show my memories" ||
                                command == "show memories" ||
                                command == "list my memories" ||
                                command == "what do you remember?" ||
                                command == "what do you remember" -> {

                            val memories = memoryRepository
                                .getAllMemories()
                                .first()

                            val reply = if (memories.isEmpty()) {
                                "I don't have any saved memories yet."
                            } else {
                                buildString {
                                    append("**Here is what I remember:**\n\n")

                                    memories.forEachIndexed { index, memory ->
                                        append("${index + 1}. ${memory.content}\n\n")
                                    }
                                }
                            }

                            AgentResponse(
                                reply = reply,
                                status = "success",
                                toolName = "get_memories"
                            )
                        }

                        // SEARCH MEMORIES
                        command.startsWith("what do you remember about ") -> {

                            val keyword = command
                                .substringAfter("about ")
                                .trim()
                                .trimEnd('?', '.', '!', ',')

                            val memories = if (keyword.isBlank()) {
                                emptyList()
                            } else {
                                memoryRepository.searchMemories(keyword)
                            }

                            val reply = if (memories.isEmpty()) {
                                "I couldn't find any saved memories about **$keyword**."
                            } else {
                                buildString {
                                    append("**Memories about $keyword:**\n\n")

                                    memories.forEachIndexed { index, memory ->
                                        append("${index + 1}. ${memory.content}\n\n")
                                    }
                                }
                            }

                            AgentResponse(
                                reply = reply,
                                status = "success",
                                toolName = "search_memories"
                            )
                        }

                        // REQUEST TO DELETE SPECIFIC MEMORIES
                        command.startsWith("forget ") ||
                                command.startsWith("delete memory ") -> {

                            val keyword = when {
                                command.startsWith("forget ") ->
                                    command.removePrefix("forget ")

                                command.startsWith("delete memory ") ->
                                    command.removePrefix("delete memory ")

                                else -> ""
                            }

                            val cleanedKeyword = keyword
                                .trim()
                                .removePrefix("my ")
                                .removeSuffix(" memory")
                                .trim()
                                .trimEnd('.', '?', '!', ',')

                            val memories = if (cleanedKeyword.isBlank()) {
                                emptyList()
                            } else {
                                memoryRepository.searchMemories(cleanedKeyword)
                            }

                            if (memories.isEmpty()) {

                                AgentResponse(
                                    reply = "I couldn't find a saved memory matching **$cleanedKeyword**.",
                                    status = "success",
                                    toolName = "delete_memory"
                                )

                            } else {

                                AgentResponse(
                                    reply = "I found ${memories.size} matching memory/memories. Type CONFIRM to delete them or CANCEL to keep them.",
                                    status = "success",
                                    toolName = "pending_delete_memory"
                                )
                            }
                        }

                        // NORMAL AI CHAT
                        else -> {

                            val savedMemories = memoryRepository
                                .getAllMemories()
                                .first()
                                .let { memories ->
                                    MemoryRelevanceRanker.selectRelevant(
                                        userMessage,
                                        memories
                                    )
                                }
                                .map { memory -> memory.content }

                            apiClient.sendMessage(
                                message = userMessage,
                                memories = savedMemories
                            )
                        }
                    }

                } catch (e: AgentApiException) {

                    AgentResponse(
                        reply = "Connection error: ${e.message ?: "Please try again."}",
                        status = e.response.status,
                        toolName = e.response.toolName
                    )

                } catch (e: Exception) {

                    AgentResponse(
                        reply = "Error: ${e.message ?: "Please try again."}",
                        status = "failed",
                        toolName = "memory_or_agent"
                    )
                }
            }

            // UPDATE PENDING DELETION STATE
            when (result.toolName) {

                "pending_delete_memory" -> {

                    val command = userMessage.lowercase().trim()

                    val keyword = when {
                        command.startsWith("forget ") ->
                            command.removePrefix("forget ")

                        command.startsWith("delete memory ") ->
                            command.removePrefix("delete memory ")

                        else -> ""
                    }
                        .trim()
                        .removePrefix("my ")
                        .removeSuffix(" memory")
                        .trim()
                        .trimEnd('.', '?', '!', ',')

                    pendingDeletionKeyword = keyword
                    pendingDeleteAll = false
                }

                "pending_delete_all" -> {
                    pendingDeletionKeyword = null
                    pendingDeleteAll = true
                }

                "delete_memory",
                "delete_all_memories",
                "cancel_deletion" -> {
                    pendingDeletionKeyword = null
                    pendingDeleteAll = false
                }
            }

            messages.add(
                ChatMessage(
                    id = userId + 1,
                    text = result.reply,
                    isUser = false,
                    toolName = result.toolName,
                    toolStatus = result.status,
                    emailDrafts = result.emailDrafts,
                    browserUrl = result.browserUrl,
                    requestDurationMs = result.requestDurationMs,
                    processPssKb = result.requestDurationMs?.let {
                        currentProcessPssKb()
                    }
                )
            )

            isLoading = false
        }
    }

    if (showMemoryScreen) {

        MemoryScreen(
            memoryRepository = memoryRepository,
            onBack = {
                showMemoryScreen = false
            }
        )

    } else if (showBrowserScreen) {
        BrowserScreen(
            initialUrl = browserStartUrl,
            onBack = {
                showBrowserScreen = false
                browserStartUrl = null
            }
        )
    } else {

        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Text("Personal AI Agent")
                    },
                    actions = {
                        TextButton(
                            onClick = {
                                showMemoryScreen = true
                            }
                        ) {
                            Text("Memories")
                        }
                        TextButton(
                            onClick = {
                                browserStartUrl = null
                                showBrowserScreen = true
                            }
                        ) {
                            Text("Browse")
                        }
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
                    onOpenBrowser = { url ->
                        browserStartUrl = url
                        showBrowserScreen = true
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                )

                Spacer(modifier = Modifier.height(8.dp))

                if (reminderServiceUnavailable) {
                    Text(
                        text = "Could not check scheduled reminders. Will retry while chat is open.",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.labelSmall
                    )
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

                    VoiceInputControl(
                        onTextRecognized = { recognizedText ->
                            input = recognizedText
                        }
                    )
                }
            }
        }
    }
}

private fun currentProcessPssKb(): Int {
    val memoryInfo = Debug.MemoryInfo()
    Debug.getMemoryInfo(memoryInfo)
    return memoryInfo.totalPss
}

@Composable
internal fun ChatMessageList(
    messages: List<ChatMessage>,
    isLoading: Boolean,
    listState: LazyListState,
    onOpenBrowser: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var emailLaunchErrorMessageId by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(messages.size, isLoading) {

        val lastIndex = if (isLoading) {
            messages.size
        } else {
            messages.lastIndex
        }

        if (lastIndex >= 0) {

            snapshotFlow {
                listState.layoutInfo.totalItemsCount
            }.first { itemCount ->
                itemCount > lastIndex
            }

            listState.animateScrollToItem(
                index = lastIndex,
                scrollOffset = Int.MAX_VALUE
            )
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

                        message.emailDrafts.forEachIndexed { index, draft ->
                            TextButton(
                                onClick = {
                                    emailLaunchErrorMessageId = null
                                    val emailIntent = Intent(Intent.ACTION_SENDTO).apply {
                                        data = Uri.parse(
                                            "mailto:${Uri.encode(draft.to, "@")}"
                                        )
                                        putExtra(Intent.EXTRA_EMAIL, arrayOf(draft.to))
                                        putExtra(Intent.EXTRA_SUBJECT, draft.subject)
                                        putExtra(Intent.EXTRA_TEXT, draft.body)
                                    }

                                    if (emailIntent.resolveActivity(context.packageManager) == null) {
                                        emailLaunchErrorMessageId = message.id
                                    } else {
                                        try {
                                            context.startActivity(
                                                Intent.createChooser(
                                                    emailIntent,
                                                    "Review email draft"
                                                )
                                            )
                                        } catch (_: ActivityNotFoundException) {
                                            emailLaunchErrorMessageId = message.id
                                        }
                                    }
                                },
                                modifier = Modifier.padding(horizontal = 8.dp)
                            ) {
                                Text(
                                    if (message.emailDrafts.size == 1) {
                                        "Review in email app — not sent"
                                    } else {
                                        "Review email draft ${index + 1} — not sent"
                                    }
                                )
                            }
                        }

                        message.browserUrl?.let { url ->
                            TextButton(
                                onClick = { onOpenBrowser(url) },
                                modifier = Modifier.padding(horizontal = 8.dp)
                            ) {
                                Text("Open page in browser")
                            }
                        }

                        message.requestDurationMs?.let { durationMs ->
                            Text(
                                text = "Agent request: ${durationMs} ms" +
                                    (message.processPssKb?.let { " · App PSS: $it KB" } ?: ""),
                                modifier = Modifier.padding(
                                    start = 14.dp,
                                    end = 14.dp,
                                    bottom = 8.dp
                                ),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.secondary
                            )
                        }

                        message.schedulerDelayMs?.let { delayMs ->
                            Text(
                                text = "Scheduler delay: $delayMs ms",
                                modifier = Modifier.padding(
                                    start = 14.dp,
                                    end = 14.dp,
                                    bottom = 8.dp
                                ),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.secondary
                            )
                        }

                        if (
                            message.emailDrafts.isNotEmpty() &&
                            emailLaunchErrorMessageId == message.id
                        ) {
                            Text(
                                text = "No compatible email app was found. The draft above has not been sent.",
                                modifier = Modifier.padding(
                                    start = 14.dp,
                                    end = 14.dp,
                                    bottom = 12.dp
                                ),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error
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
