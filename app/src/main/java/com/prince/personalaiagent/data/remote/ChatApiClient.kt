package com.prince.personalaiagent.data.remote

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class ChatApiClient {

    companion object {
        private const val BASE_URL = "http://10.0.2.2:3000/api/chat"
        private const val CONNECT_TIMEOUT = 15000
        private const val READ_TIMEOUT = 60000
    }

    fun sendMessage(message: String): String {
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

            if (responseCode !in 200..299) {
                throw IOException(
                    json.optString(
                        "error",
                        "Server error. Please try again."
                    )
                )
            }

            return json.optString(
                "reply",
                "The AI returned an empty response."
            )

        } finally {
            connection.disconnect()
        }
    }
}
