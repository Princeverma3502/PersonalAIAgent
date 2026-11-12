package com.prince.personalaiagent

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.json.JSONArray
import org.json.JSONException

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun BrowserScreen(
    initialUrl: String?,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    var address by remember(initialUrl) { mutableStateOf(initialUrl.orEmpty()) }
    var currentUrl by remember { mutableStateOf<String?>(null) }
    var extractedText by remember { mutableStateOf("") }
    var browserError by remember { mutableStateOf<String?>(null) }
    var progress by remember { mutableStateOf(0) }
    var canGoBack by remember { mutableStateOf(false) }
    var canGoForward by remember { mutableStateOf(false) }

    val webView = remember(context) {
        createBrowserWebView(
            context = context,
            onPageStarted = { url ->
                currentUrl = url
                address = url
                extractedText = ""
                browserError = null
            },
            onNavigationStateChanged = { view ->
                canGoBack = view.canGoBack()
                canGoForward = view.canGoForward()
            },
            onProgressChanged = { progress = it },
            onNavigationBlocked = {
                browserError = "Only HTTP and HTTPS website links can be opened."
            },
            onLoadError = { description ->
                browserError = description
            }
        )
    }

    BackHandler {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            onBack()
        }
    }

    fun navigateToAddress() {
        val url = BrowserUrlPolicy.normalize(address)
        if (url == null) {
            browserError = "Enter a valid HTTP or HTTPS website address."
            return
        }

        browserError = null
        extractedText = ""
        address = url
        webView.loadUrl(url)
    }

    LaunchedEffect(initialUrl, webView) {
        if (!initialUrl.isNullOrBlank()) {
            navigateToAddress()
        }
    }

    DisposableEffect(webView) {
        onDispose {
            webView.stopLoading()
            webView.destroy()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row {
            TextButton(onClick = onBack) {
                Text("Back to chat")
            }
            Text(
                text = "Controlled browser",
                modifier = Modifier.padding(start = 8.dp, top = 12.dp),
                style = MaterialTheme.typography.titleMedium
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = address,
                onValueChange = { address = it },
                modifier = Modifier.weight(1f),
                label = { Text("Website URL") },
                maxLines = 1
            )
            Button(
                onClick = ::navigateToAddress,
                modifier = Modifier.padding(top = 8.dp)
            ) {
                Text("Go")
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = { webView.goBack() },
                enabled = canGoBack
            ) {
                Text("Previous")
            }
            OutlinedButton(
                onClick = { webView.goForward() },
                enabled = canGoForward
            ) {
                Text("Next")
            }
            OutlinedButton(
                onClick = { webView.reload() },
                enabled = currentUrl != null
            ) {
                Text("Reload")
            }
            Button(
                onClick = { extractVisibleText(webView, onText = { extractedText = it }) },
                enabled = currentUrl != null
            ) {
                Text("Extract text")
            }
        }

        if (progress in 1..99) {
            LinearProgressIndicator(
                progress = { progress / 100f },
                modifier = Modifier.fillMaxWidth()
            )
        }

        browserError?.let { error ->
            Text(
                text = error,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall
            )
        }

        AndroidView(
            factory = { webView },
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        )

        if (extractedText.isNotBlank()) {
            Text(
                text = "Extracted page text",
                style = MaterialTheme.typography.titleSmall
            )
            Text(
                text = extractedText,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(160.dp)
                    .verticalScroll(rememberScrollState()),
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
private fun createBrowserWebView(
    context: Context,
    onPageStarted: (String) -> Unit,
    onNavigationStateChanged: (WebView) -> Unit,
    onProgressChanged: (Int) -> Unit,
    onNavigationBlocked: () -> Unit,
    onLoadError: (String) -> Unit
): WebView = WebView(context).apply {
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.javaScriptCanOpenWindowsAutomatically = false
    settings.setSupportMultipleWindows(false)
    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
    settings.safeBrowsingEnabled = true
    CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)

    webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest
        ): Boolean {
            if (!BrowserUrlPolicy.isAllowedNavigation(request.url.toString())) {
                onNavigationBlocked()
                return true
            }
            return false
        }

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            onPageStarted(url)
            onNavigationStateChanged(view)
        }

        override fun onPageFinished(view: WebView, url: String) {
            onNavigationStateChanged(view)
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError
        ) {
            if (request.isForMainFrame) {
                onLoadError(error.description.toString())
            }
        }
    }
    webChromeClient = object : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            onProgressChanged(newProgress)
            onNavigationStateChanged(view)
        }
    }
}

private fun extractVisibleText(webView: WebView, onText: (String) -> Unit) {
    webView.evaluateJavascript(
        "(function(){return document.body ? document.body.innerText : '';})()"
    ) { result ->
        try {
            onText(JSONArray("[$result]").optString(0).take(MAX_EXTRACTED_TEXT_LENGTH))
        } catch (_: JSONException) {
            onText("")
        }
    }
}

private const val MAX_EXTRACTED_TEXT_LENGTH = 10_000
