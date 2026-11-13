
package com.prince.personalaiagent

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Debug
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import com.prince.personalaiagent.data.local.MemorySaveCommandHandler
import com.prince.personalaiagent.data.local.MemorySaveCommandResult
import com.prince.personalaiagent.data.local.ConversationMessageEntity
import com.prince.personalaiagent.data.local.ConversationRepository
import com.prince.personalaiagent.data.remote.AgentApiException
import com.prince.personalaiagent.data.remote.AgentResponse
import com.prince.personalaiagent.data.remote.ChatApiClient
import com.prince.personalaiagent.data.remote.EmailDraft
import com.prince.personalaiagent.data.remote.PendingEmailApproval
import com.prince.personalaiagent.data.remote.PendingWebNavigationApproval
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

private fun createGreetingMessage() = ChatMessage(
    id = 0,
    text = "Hello! I'm your Personal AI Agent. How can I help you today?",
    isUser = false
)

private fun nextChatMessageId(messages: List<ChatMessage>): Int {
    return (messages.maxOfOrNull { it.id } ?: -1) + 1
}

private fun ConversationMessageEntity.toChatMessage() = ChatMessage(
    id = id,
    text = text,
    isUser = isUser
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
    var notificationPermissionDenied by remember {
        mutableStateOf(false)
    }
    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        notificationPermissionDenied = !granted
    }

    val memoryRepository = remember {
        MemoryRepository(
            MemoryDatabase.getDatabase(context).memoryDao()
        )
    }
    val conversationRepository = remember {
        ConversationRepository(
            MemoryDatabase.getDatabase(context).conversationMessageDao()
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
    var pendingEmailApproval by remember {
        mutableStateOf<PendingEmailApproval?>(null)
    }
    var pendingWebNavigationApproval by remember {
        mutableStateOf<PendingWebNavigationApproval?>(null)
    }
    var isApprovingEmail by remember {
        mutableStateOf(false)
    }
    var isApprovingWebNavigation by remember {
        mutableStateOf(false)
    }

    var pendingDeletionKeyword by remember {
        mutableStateOf<String?>(null)
    }

    var pendingDeleteAll by remember {
        mutableStateOf(false)
    }
    var isConversationLoaded by remember {
        mutableStateOf(false)
    }
    var isClearingConversation by remember {
        mutableStateOf(false)
    }
    var showClearConversationConfirmation by remember {
        mutableStateOf(false)
    }
    var conversationHistoryError by remember {
        mutableStateOf<String?>(null)
    }
    val messages = remember {
        mutableStateListOf<ChatMessage>()
    }

    val listState = rememberLazyListState()
    val apiClient = remember { ChatApiClient() }
    val displayedReminderIds = remember { mutableSetOf<String>() }
    var reminderServiceUnavailable by remember {
        mutableStateOf(false)
    }

    LaunchedEffect(conversationRepository) {
        try {
            val savedMessages = withContext(Dispatchers.IO) {
                conversationRepository.getAllMessages()
            }
            if (savedMessages.isEmpty()) {
                val greeting = createGreetingMessage()
                messages.add(greeting)
                withContext(Dispatchers.IO) {
                    conversationRepository.saveMessage(
                        greeting.id,
                        greeting.text,
                        greeting.isUser
                    )
                }
            } else {
                messages.addAll(savedMessages.map { it.toChatMessage() })
            }
        } catch (error: Exception) {
            if (messages.isEmpty()) {
                messages.add(createGreetingMessage())
            }
            conversationHistoryError =
                "Could not load saved chat history: ${error.message ?: "storage error"}"
        } finally {
            isConversationLoaded = true
        }
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

    LaunchedEffect(apiClient, isConversationLoaded) {
        if (!isConversationLoaded) return@LaunchedEffect

        while (isActive) {
            try {
                val reminders = withContext(Dispatchers.IO) {
                    apiClient.getPendingReminders()
                }
                reminderServiceUnavailable = false

                if (isClearingConversation) {
                    delay(30_000)
                    continue
                }

                reminders.forEach { reminder ->
                    if (
                        reminder.taskId !in displayedReminderIds &&
                        !ReminderDeliveryStore.wasDisplayedInApp(
                            context,
                            reminder.taskId
                        )
                    ) {
                        val reminderMessage = ChatMessage(
                            id = nextChatMessageId(messages),
                            text = "**Reminder: ${reminder.title}**\n\n${reminder.message}",
                            isUser = false,
                            toolName = "scheduled_reminder",
                            toolStatus = "success",
                            schedulerDelayMs = reminder.executionDelayMs,
                            browserUrl = reminder.sourceUrl
                        )
                        messages.add(reminderMessage)
                        try {
                            withContext(Dispatchers.IO) {
                                conversationRepository.saveMessage(
                                    reminderMessage.id,
                                    reminderMessage.text,
                                    reminderMessage.isUser
                                )
                                ReminderDeliveryStore.markDisplayedInApp(
                                    context,
                                    reminder.taskId
                                )
                            }
                            displayedReminderIds.add(reminder.taskId)
                        } catch (error: Exception) {
                            messages.remove(reminderMessage)
                            conversationHistoryError =
                                "Could not save reminder to chat history: ${error.message ?: "storage error"}"
                            throw error
                        }
                    }

                    withContext(Dispatchers.IO) {
                        if (!areReminderNotificationsEnabled(context)) {
                            // The saved chat entry is the fallback when notifications cannot be posted.
                            apiClient.acknowledgeReminder(reminder.taskId)
                        }
                    }
                }
            } catch (error: Exception) {
                Log.w(
                    "ReminderPolling",
                    "Could not check or acknowledge scheduled reminders; polling will retry.",
                    error
                )
                reminderServiceUnavailable = true
            }

            delay(30_000)
        }
    }

    fun clearConversationHistory() {
        if (!isConversationLoaded || isLoading || isClearingConversation) return

        isClearingConversation = true
        coroutineScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    conversationRepository.clearHistory()
                }
                messages.clear()
                displayedReminderIds.clear()
                pendingDeletionKeyword = null
                pendingDeleteAll = false
                input = ""

                val greeting = createGreetingMessage()
                messages.add(greeting)
                withContext(Dispatchers.IO) {
                    conversationRepository.saveMessage(
                        greeting.id,
                        greeting.text,
                        greeting.isUser
                    )
                }
                conversationHistoryError = null
            } catch (error: Exception) {
                conversationHistoryError =
                    "Could not clear chat history: ${error.message ?: "storage error"}"
            } finally {
                isClearingConversation = false
                showClearConversationConfirmation = false
            }
        }
    }

    fun approvePendingEmail() {
        val approval = pendingEmailApproval ?: return
        if (isApprovingEmail) return

        isApprovingEmail = true
        coroutineScope.launch {
            val result = try {
                withContext(Dispatchers.IO) {
                    apiClient.approveSensitiveAction(
                        type = "send_email",
                        approvalToken = approval.approvalToken
                    )
                }
            } catch (error: Exception) {
                Log.w(
                    "EmailApproval",
                    "Could not confirm the email approval result.",
                    error
                )
                null
            }

            val messageText = when {
                result?.success == true ->
                    "Email sent successfully."

                result == null || result.outcome == "unknown" ->
                    "Gmail could not confirm whether the email was sent. Check the Sent folder before retrying."

                else ->
                    "Email was not sent: ${result.message}"
            }
            val actionStatus = when {
                result?.success == true -> "success"
                result?.sent == false || result?.outcome == "failed" -> "failed"
                else -> "unknown"
            }
            val approvalResultMessage = ChatMessage(
                id = nextChatMessageId(messages),
                text = messageText,
                isUser = false,
                toolName = "send_email",
                toolStatus = actionStatus
            )
            messages.add(approvalResultMessage)

            try {
                withContext(Dispatchers.IO) {
                    conversationRepository.saveMessage(
                        approvalResultMessage.id,
                        approvalResultMessage.text,
                        approvalResultMessage.isUser
                    )
                }
                conversationHistoryError = null
            } catch (error: Exception) {
                conversationHistoryError =
                    "Could not save the email result to chat history: ${error.message ?: "storage error"}"
            } finally {
                pendingEmailApproval = null
                isApprovingEmail = false
            }
        }
    }

    fun approvePendingWebNavigation() {
        val approval = pendingWebNavigationApproval ?: return
        if (isApprovingWebNavigation) return

        isApprovingWebNavigation = true
        coroutineScope.launch {
            val result = try {
                withContext(Dispatchers.IO) {
                    apiClient.approveSensitiveAction(
                        type = "read_public_webpage",
                        approvalToken = approval.approvalToken
                    )
                }
            } catch (error: Exception) {
                Log.w(
                    "WebApproval",
                    "Could not confirm the webpage approval result.",
                    error
                )
                null
            }

            val messageText = when {
                result?.success == true -> buildString {
                    append(result.summary ?: "The webpage was retrieved.")
                    result.pageText?.let {
                        append("\n\nExtracted page text:\n")
                        append(it)
                    }
                    if (result.pageMatches.isNotEmpty()) {
                        append("\n\nMatching passages:\n")
                        append(result.pageMatches.joinToString("\n"))
                    }
                    if (result.pageLinks.isNotEmpty()) {
                        append("\n\nRelevant links:\n")
                        append(result.pageLinks.joinToString("\n"))
                    }
                }
                result == null -> "The approved webpage could not be retrieved."
                else -> "Webpage was not retrieved: ${result.message}"
            }
            val actionStatus = if (result?.success == true) "success" else "failed"
            val resultMessage = ChatMessage(
                id = nextChatMessageId(messages),
                text = messageText,
                isUser = false,
                toolName = "read_public_webpage",
                toolStatus = actionStatus,
                browserUrl = result?.pageUrl ?: approval.url
            )
            messages.add(resultMessage)

            try {
                withContext(Dispatchers.IO) {
                    conversationRepository.saveMessage(
                        resultMessage.id,
                        resultMessage.text,
                        resultMessage.isUser
                    )
                }
                conversationHistoryError = null
            } catch (error: Exception) {
                conversationHistoryError =
                    "Could not save the webpage result to chat history: ${error.message ?: "storage error"}"
            } finally {
                pendingWebNavigationApproval = null
                isApprovingWebNavigation = false
            }
        }
    }

    fun sendMessage() {

        val userMessage = input.trim()

        if (
            userMessage.isBlank() ||
            isLoading ||
            !isConversationLoaded ||
            isClearingConversation
        ) return

        val keywordToConfirm = pendingDeletionKeyword
        val deleteAllToConfirm = pendingDeleteAll

        val userChatMessage = ChatMessage(
            id = nextChatMessageId(messages),
            text = userMessage,
            isUser = true
        )
        messages.add(userChatMessage)

        input = ""
        isLoading = true

        coroutineScope.launch {
            var historyWarning: String? = null

            val result = withContext(Dispatchers.IO) {
                try {
                    conversationRepository.saveMessage(
                        userChatMessage.id,
                        userChatMessage.text,
                        userChatMessage.isUser
                    )
                } catch (error: Exception) {
                    historyWarning =
                        "Could not save your message to chat history: ${error.message ?: "storage error"}"
                }

                try {

                    val command = userMessage.lowercase().trim()
                    val memorySaveResult = MemorySaveCommandHandler.handle(
                        userMessage,
                        memoryRepository
                    )

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

                        memorySaveResult is MemorySaveCommandResult.Saved ->
                            AgentResponse(
                                reply = "I've saved this in your memories:\n\n" +
                                    "**${memorySaveResult.content}**",
                                status = "success",
                                toolName = "save_memory"
                            )

                        memorySaveResult === MemorySaveCommandResult.MissingContent ->
                            AgentResponse(
                                reply = "Please tell me what you want me to remember.",
                                status = "failed",
                                toolName = "save_memory"
                            )

                        memorySaveResult is MemorySaveCommandResult.UnsupportedIntent ->
                            AgentResponse(
                                reply = memorySaveResult.message,
                                status = "failed",
                                toolName = "save_memory"
                            )

                        memorySaveResult is MemorySaveCommandResult.Failed ->
                            AgentResponse(
                                reply = memorySaveResult.message,
                                status = "failed",
                                toolName = "save_memory"
                            )

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

            result.pendingEmailApproval?.let { approval ->
                pendingEmailApproval = approval
            }
            result.pendingWebNavigationApproval?.let { approval ->
                pendingWebNavigationApproval = approval
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

            val assistantMessage = ChatMessage(
                id = nextChatMessageId(messages),
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
            messages.add(assistantMessage)
            val assistantMessageIndex = messages.indexOfFirst {
                it.id == assistantMessage.id
            }

            try {
                withContext(Dispatchers.IO) {
                    conversationRepository.saveMessage(
                        assistantMessage.id,
                        assistantMessage.text,
                        assistantMessage.isUser
                    )
                }
            } catch (error: Exception) {
                historyWarning =
                    "Could not save the reply to chat history: ${error.message ?: "storage error"}"
            }
            if (historyWarning != null) {
                conversationHistoryError = historyWarning
                if (assistantMessageIndex >= 0) {
                    messages[assistantMessageIndex] = assistantMessage.copy(
                        text = "${assistantMessage.text}\n\n$historyWarning"
                    )
                }
            } else {
                conversationHistoryError = null
            }

            isLoading = false
        }
    }

    pendingEmailApproval?.let { approval ->
        AlertDialog(
            onDismissRequest = {
                if (!isApprovingEmail) pendingEmailApproval = null
            },
            title = { Text("Send this email?") },
            text = {
                Column(
                    modifier = Modifier
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState())
                ) {
                    Text("To: ${approval.to}")
                    Spacer(modifier = Modifier.height(12.dp))
                    Text("Subject:")
                    Text(approval.subject)
                    Spacer(modifier = Modifier.height(12.dp))
                    Text("Message:")
                    Text(approval.body)
                    Spacer(modifier = Modifier.height(16.dp))
                    Text("Approving sends this email from your connected Gmail account.")
                }
            },
            confirmButton = {
                Button(
                    onClick = { approvePendingEmail() },
                    enabled = !isApprovingEmail
                ) {
                    Text(if (isApprovingEmail) "Sending..." else "Approve and send")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { pendingEmailApproval = null },
                    enabled = !isApprovingEmail
                ) {
                    Text("Cancel")
                }
            }
        )
    }

    pendingWebNavigationApproval?.let { approval ->
        AlertDialog(
            onDismissRequest = {
                if (!isApprovingWebNavigation) pendingWebNavigationApproval = null
            },
            title = { Text("Open this webpage?") },
            text = {
                Column(
                    modifier = Modifier
                        .heightIn(max = 260.dp)
                        .verticalScroll(rememberScrollState())
                ) {
                    Text("Destination:")
                    Text(approval.url)
                    approval.searchTerm?.let {
                        Spacer(modifier = Modifier.height(12.dp))
                        Text("Find: $it")
                    }
                    Spacer(modifier = Modifier.height(16.dp))
                    Text("Approving retrieves the page as read-only text. It will not submit forms, authenticate, or execute page actions.")
                }
            },
            confirmButton = {
                Button(
                    onClick = { approvePendingWebNavigation() },
                    enabled = !isApprovingWebNavigation
                ) {
                    Text(if (isApprovingWebNavigation) "Opening..." else "Approve and open")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { pendingWebNavigationApproval = null },
                    enabled = !isApprovingWebNavigation
                ) {
                    Text("Cancel")
                }
            }
        )
    }

    if (showClearConversationConfirmation) {
        AlertDialog(
            onDismissRequest = {
                showClearConversationConfirmation = false
            },
            title = { Text("Clear chat history?") },
            text = {
                Text(
                    "This removes saved conversation messages from this device. " +
                        "Your saved memories will not be deleted."
                )
            },
            confirmButton = {
                TextButton(
                    onClick = { clearConversationHistory() },
                    enabled = !isLoading && !isClearingConversation
                ) {
                    Text("Clear chat")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showClearConversationConfirmation = false }
                ) {
                    Text("Cancel")
                }
            }
        )
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
                        TextButton(
                            onClick = {
                                showClearConversationConfirmation = true
                            },
                            enabled = isConversationLoaded &&
                                !isLoading &&
                                !isClearingConversation
                        ) {
                            Text("Clear")
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
                    isLoading = isLoading ||
                        !isConversationLoaded ||
                        isClearingConversation,
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
                        text = "Could not check scheduled reminders. Will retry.",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.labelSmall
                    )
                }
                if (notificationPermissionDenied) {
                    Text(
                        text = "Notifications are disabled. Reminders can still appear in chat while it is open.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelSmall
                    )
                }
                conversationHistoryError?.let { error ->
                    Text(
                        text = error,
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
                        enabled = input.isNotBlank() &&
                            !isLoading &&
                            isConversationLoaded &&
                            !isClearingConversation
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
                                "pending_approval" -> "awaiting approval"
                                "unknown" -> "result unconfirmed"
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
