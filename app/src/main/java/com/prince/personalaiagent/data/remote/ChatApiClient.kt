package com.prince.personalaiagent.data.remote

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class AgentResponse(
    val reply: String,
    val status: String,
    val toolName: String?
)

class AgentApiException(
    val response: AgentResponse
) : IOException(response.reply)

class ChatApiClient {

    companion object {
        private const val BASE_URL = "http://10.0.2.2:3000/api/agent"
        private const val CONNECT_TIMEOUT = 15000
        private const val READ_TIMEOUT = 60000
    }

    fun sendMessage(message: String): AgentResponse {
        val connection = URL(BASE_URL).openConnection() as HttpURLConnection

        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = CONNECT_TIMEOUT
            connection.readTimeout = READ_TIMEOUT
            connection.doOutput = true

            connection.setRequestProperty(
                "Content-Type",
                "application/json"
            )

            val requestBody = JSONObject()
                .put("message", message)
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

            val toolCall = json.optJSONObject("toolCall")
            val toolName = toolCall?.optString("name")?.takeIf {
                it.isNotBlank() && it != "null"
            }
            val status = toolCall?.optString("status")?.takeIf {
                it.isNotBlank() && it != "null"
            } ?: json.optString("status", "unknown")

            val agentResponse = AgentResponse(
                reply = json.optString(
                    "reply",
                    "The AI returned an empty response."
                ),
                status = status,
                toolName = toolName
            )

            if (responseCode !in 200..299) {
                throw AgentApiException(agentResponse)
            }

            return agentResponse

        } finally {
            connection.disconnect()
        }
    }
}
