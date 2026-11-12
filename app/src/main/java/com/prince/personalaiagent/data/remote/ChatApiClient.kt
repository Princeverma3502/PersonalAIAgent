
package com.prince.personalaiagent.data.remote

import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.TimeZone

data class AgentResponse(
    val reply: String,
    val status: String,
    val toolName: String?,
    val emailDrafts: List<EmailDraft> = emptyList(),
    val browserUrl: String? = null,
    val requestDurationMs: Long? = null
)

data class EmailDraft(
    val to: String,
    val subject: String,
    val body: String
)

data class AgentReminder(
    val taskId: String,
    val title: String,
    val message: String,
    val executionDelayMs: Long? = null
)

class AgentApiException(
    val response: AgentResponse
) : IOException(response.reply)

class ChatApiClient {

    companion object {
        private const val BASE_URL = "http://10.0.2.2:3000/api/agent"
        private const val REMINDERS_URL = "http://10.0.2.2:3000/api/reminders"
        private const val CONNECT_TIMEOUT = 15000
        private const val READ_TIMEOUT = 60000
    }

    fun getPendingReminders(): List<AgentReminder> {
        val connection = URL(REMINDERS_URL)
            .openConnection() as HttpURLConnection

        try {
            connection.requestMethod = "GET"
            connection.connectTimeout = CONNECT_TIMEOUT
            connection.readTimeout = READ_TIMEOUT

            val responseCode = connection.responseCode
            val responseText = readResponse(connection, responseCode)
            val json = JSONObject(responseText)

            if (responseCode !in 200..299) {
                throw IOException(json.optString("message", "Could not load reminders."))
            }

            val reminders = json.optJSONArray("reminders") ?: return emptyList()
            return (0 until reminders.length()).mapNotNull { index ->
                val reminder = reminders.optJSONObject(index) ?: return@mapNotNull null
                val taskId = reminder.optString("taskId")
                if (taskId.isBlank() || taskId == "null") {
                    return@mapNotNull null
                }

                AgentReminder(
                    taskId = taskId,
                    title = reminder.optString("title", "Reminder"),
                    message = reminder.optString("message", ""),
                    executionDelayMs = reminder.optLong(
                        "executionDelayMs",
                        -1
                    ).takeIf { it >= 0 }
                )
            }
        } finally {
            connection.disconnect()
        }
    }

    fun acknowledgeReminder(taskId: String) {
        val encodedTaskId = URLEncoder.encode(taskId, Charsets.UTF_8.name())
        val connection = URL("$REMINDERS_URL/$encodedTaskId/ack")
            .openConnection() as HttpURLConnection

        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = CONNECT_TIMEOUT
            connection.readTimeout = READ_TIMEOUT
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }

            val responseCode = connection.responseCode
            if (responseCode !in 200..299) {
                val responseText = readResponse(connection, responseCode)
                val message = try {
                    JSONObject(responseText).optString(
                        "message",
                        "Could not acknowledge reminder."
                    )
                } catch (error: JSONException) {
                    throw IOException("Could not parse reminder acknowledgement.", error)
                }
                throw IOException(message)
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun readResponse(
        connection: HttpURLConnection,
        responseCode: Int
    ): String {
        val stream = if (responseCode in 200..299) {
            connection.inputStream
        } else {
            connection.errorStream
        }

        return stream
            ?.bufferedReader()
            ?.use { it.readText() }
            ?: ""
    }

    fun sendMessage(
        message: String,
        memories: List<String> = emptyList()
    ): AgentResponse {
        val requestStartedAt = SystemClock.elapsedRealtime()

        val connection = URL(BASE_URL)
            .openConnection() as HttpURLConnection

        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = CONNECT_TIMEOUT
            connection.readTimeout = READ_TIMEOUT
            connection.doOutput = true

            connection.setRequestProperty(
                "Content-Type",
                "application/json"
            )

            val memoriesJson = JSONArray()

            memories.take(10).forEach { memory ->
                if (memory.isNotBlank()) {
                    memoriesJson.put(memory.take(500))
                }
            }

            val requestBody = JSONObject()
                .put("message", message)
                .put("memories", memoriesJson)
                .put("timeZone", TimeZone.getDefault().id)
                .toString()

            connection.outputStream.use { output ->
                output.write(requestBody.toByteArray(Charsets.UTF_8))
            }

            val responseCode = connection.responseCode

            val responseText = readResponse(connection, responseCode)
            val json = JSONObject(responseText)

            // Read all tool executions from the backend.
            val toolCalls = json.optJSONArray("toolCalls")
            val emailDrafts = parseEmailDrafts(toolCalls)
            val browserUrl = parsePublicPageUrl(toolCalls)
            val executedTools = mutableListOf<String>()

            if (toolCalls != null) {
                for (index in 0 until toolCalls.length()) {
                    val tool = toolCalls.optJSONObject(index)
                        ?: continue

                    val name = tool.optString("name")
                    val status = tool.optString("status")

                    if (name.isNotBlank() && name != "null") {
                        executedTools.add(
                            if (status.isNotBlank() && status != "null") {
                                "$name ($status)"
                            } else {
                                name
                            }
                        )
                    }
                }
            }

            // Support the existing single-tool response format too.
            val singleTool = json.optJSONObject("toolCall")

            val toolName = when {
                executedTools.isNotEmpty() ->
                    executedTools.joinToString(" → ")

                singleTool != null -> {
                    singleTool.optString("name")
                        .takeIf { it.isNotBlank() && it != "null" }
                }

                else -> null
            }

            val status = json.optString("status")
                .takeIf { it.isNotBlank() && it != "null" }
                ?: singleTool?.optString("status")
                    ?.takeIf { it.isNotBlank() && it != "null" }
                ?: "unknown"

            val agentResponse = AgentResponse(
                reply = json.optString(
                    "reply",
                    "The AI returned an empty response."
                ),
                status = status,
                toolName = toolName,
                emailDrafts = emailDrafts,
                browserUrl = browserUrl,
                requestDurationMs = SystemClock.elapsedRealtime() - requestStartedAt
            )

            if (responseCode !in 200..299) {
                throw AgentApiException(agentResponse)
            }

            return agentResponse

        } finally {
            connection.disconnect()
        }
    }

    private fun parseEmailDrafts(toolCalls: JSONArray?): List<EmailDraft> {
        if (toolCalls == null) return emptyList()

        return (0 until toolCalls.length()).mapNotNull { index ->
            val tool = toolCalls.optJSONObject(index) ?: return@mapNotNull null
            if (
                tool.optString("name") != "draft_email" ||
                tool.optString("status") != "success"
            ) {
                return@mapNotNull null
            }

            val result = tool.optJSONObject("result")
                ?.takeIf { it.optBoolean("success") }
                ?: return@mapNotNull null
            val draft = result.optJSONObject("draft") ?: return@mapNotNull null
            val recipient = draft.optString("to").takeIf { it.isNotBlank() && it != "null" }
                ?: return@mapNotNull null
            val subject = draft.optString("subject").takeIf { it != "null" }
                ?: return@mapNotNull null
            val body = draft.optString("body").takeIf { it.isNotBlank() && it != "null" }
                ?: return@mapNotNull null

            EmailDraft(recipient, subject, body)
        }
    }

    private fun parsePublicPageUrl(toolCalls: JSONArray?): String? {
        if (toolCalls == null) return null

        for (index in 0 until toolCalls.length()) {
            val tool = toolCalls.optJSONObject(index) ?: continue
            if (
                tool.optString("name") != "read_public_webpage" ||
                tool.optString("status") != "success"
            ) {
                continue
            }

            val result = tool.optJSONObject("result")
                ?.takeIf { it.optBoolean("success") }
                ?: continue
            val url = result.optString("url")
            if (url.isNotBlank() && url != "null") return url
        }

        return null
    }
}
