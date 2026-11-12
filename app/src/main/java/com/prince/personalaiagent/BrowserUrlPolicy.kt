package com.prince.personalaiagent

import java.net.URI
import java.net.URISyntaxException

object BrowserUrlPolicy {
    fun normalize(input: String): String? {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return null

        val hasScheme = "://" in trimmed ||
            trimmed.startsWith("javascript:", ignoreCase = true) ||
            trimmed.startsWith("file:", ignoreCase = true) ||
            trimmed.startsWith("content:", ignoreCase = true) ||
            trimmed.startsWith("intent:", ignoreCase = true) ||
            trimmed.startsWith("data:", ignoreCase = true)
        val candidate = if (hasScheme) trimmed else "https://$trimmed"
        return candidate.takeIf(::isAllowedNavigation)
    }

    fun isAllowedNavigation(url: String): Boolean {
        val uri = try {
            URI(url)
        } catch (_: URISyntaxException) {
            return false
        }

        return (uri.scheme.equals("http", ignoreCase = true) ||
            uri.scheme.equals("https", ignoreCase = true)) &&
            uri.rawUserInfo == null &&
            !uri.host.isNullOrBlank() &&
            (uri.port == -1 || uri.port in 1..65535)
    }
}
