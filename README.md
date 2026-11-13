# Personal AI Agent

A Kotlin Android chat app backed by a Node.js service that connects to Google Gemini. The agent can call backend tools for reminders, read-only Gmail inbox search, email drafts, and read-only webpage retrieval, while user memories are stored locally on the device.

## Features

- Jetpack Compose chat UI with loading feedback, scrolling responses, and backend error handling.
- Runtime-permission-based speech recognition that puts recognized text in the editable chat field.
- Local Room memory storage with save, list, search, delete, and relevance-ranked agent context.
- Room-backed conversation history that restores after app restarts and can be cleared separately from saved memories.
- Gemini agent tool calling with ordered model fallback and tool-execution history.
- Read-only Gmail inbox search using Gmail search syntax, returning message headers and snippets only.
- Validated email draft preparation with an explicit handoff to an installed email app.
- Read-only public webpage retrieval (single page or batches of up to three) and optional same-origin linked-page reading when requested by the user.
- Controlled in-app browser with HTTP(S) navigation, page history, scrolling, and bounded visible-text extraction.
- JSON-backed one-time and recurring reminders, plus scheduled one-time or recurring public-webpage summaries, with in-chat delivery and best-effort Android background notifications.
- In-chat agent request timing and process-memory diagnostics, plus scheduled reminder delay measurements.
- Backend request validation, CORS, Helmet headers, request-size limits, rate limiting, and secret-safe provider diagnostics.

## Architecture

- **Android:** Compose UI, a Room-backed memory repository, and an HTTP client for the agent endpoint.
- **Backend:** Express API, Gemini integration, a registry of validated tools, and a JSON-file scheduler.
- **Communication:** The Android app sends `POST /api/agent` requests to `http://10.0.2.2:3000/api/agent` when running in the Android emulator.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for component and request-flow details, and [ASSIGNMENT_STATUS.md](./ASSIGNMENT_STATUS.md) for the implementation and verification status.

## Technology stack

- Android: Kotlin, Jetpack Compose, Material 3, Room, Kotlin coroutines.
- Backend: Node.js, Express, `@google/genai`, `cron-parser`, Helmet, CORS, and `express-rate-limit`.
- Build and tests: Gradle, Kotlin/JUnit, and Node's built-in test runner.

## Backend setup

Requirements: Node.js 18 or later and npm.

From the repository root in PowerShell:

```powershell
Set-Location .\backend
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm install
npm start
```

Set `GEMINI_API_KEY` in `backend\.env` before using AI routes. For Gmail features, also add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` with a redirect of `http://localhost:3000/api/gmail/callback`. The sample file contains placeholders only. Do not commit `.env`. `PORT` defaults to `3000`; `ALLOWED_ORIGIN` defaults to `http://localhost:3000`.

After setting Google OAuth credentials, open `http://localhost:3000/api/gmail/auth` to obtain the consent URL and complete the Gmail connection. The consent request asks only for `gmail.readonly`. Reopen that URL and authorize again if `/api/gmail/status` reports `searchAvailable: false`; it never returns tokens. OAuth tokens are stored in `backend/data/gmail-tokens.json`, which is ignored by Git.

To try inbox search after reconnecting, ask the agent something like `Search my Gmail for unread messages from sender@example.com`. Search results include sender, subject, date, and Gmail's short snippet; full message bodies are not fetched. Search is read-only and limited to 20 results.

The user manually verified that Gmail OAuth connected, `/api/gmail/status` reported the connection, and a live inbox search returned results. Automated Gmail API tests use mocks; they do not contact Gmail. Agent-side email sending is deliberately disabled: secure server-side approval bound to the exact message is not implemented, and `/api/actions/approve` returns HTTP 501 without sending. The backend has no authentication, so do not expose this development server to the public internet.

Check backend health from another PowerShell window:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

The health endpoint remains available without an API key but reports a degraded status; AI routes return `503` until credentials are configured.

## Android setup and run

1. Open the repository root in Android Studio and allow Gradle sync to finish.
2. Start an Android emulator.
3. Start the backend on the development machine as described above.
4. Run the `app` configuration from Android Studio, or build from PowerShell:

```powershell
.\gradlew.bat testDebugUnitTest assembleDebug compileDebugAndroidTestKotlin connectedDebugAndroidTest
```

The debug APK is written to `app\build\outputs\apk\debug\app-debug.apk`. The Android client uses the emulator host alias `10.0.2.2` and local HTTP; this setup is for development, not production deployment.

For a DEBUG-only reminder diagnostic, start the backend and use the debug APK on the emulator:

```powershell
adb shell am broadcast -n com.prince.personalaiagent/.DebugReminderWorkerTriggerReceiver -a com.prince.personalaiagent.DEBUG_TRIGGER_REMINDER_WORKER
adb logcat -s ReminderDelivery
```

This enqueues the existing network-constrained WorkManager worker immediately; it still retrieves real pending reminders and applies the production notification permission/channel checks. It does not create a test notification. The trigger is absent from release builds. The trigger was verified to start the worker and contact the backend, but the worker found zero pending reminders, so system notification posting has not been verified.

### Configure the Android backend URL

Debug builds default to `http://10.0.2.2:3000` for the Android emulator. To point a debug build at a backend reachable from a physical device, pass its development-machine URL:

```powershell
.\gradlew.bat assembleDebug -PPERSONAL_AI_DEBUG_API_BASE_URL=http://192.168.1.20:3000
```

Release builds use a safe placeholder unless configured. Set an HTTPS backend origin when building a release APK:

```powershell
.\gradlew.bat assembleRelease -PPERSONAL_AI_RELEASE_API_BASE_URL=https://agent.example.com
```

The URL must be an HTTP(S) origin without credentials, query, or fragment. HTTP is allowed only for debug builds; release builds reject non-HTTPS URLs and disable cleartext traffic. A real release still needs a deployed backend and backend authentication.

## API endpoints

### `GET /health`

Reports whether the backend is running and whether Gemini credentials are configured.

### `POST /api/chat`

Basic text-only Gemini chat endpoint.

```json
{ "message": "Hello" }
```

### `POST /api/agent`

Agent endpoint used by Android. `memories` is optional and contains short strings supplied by the app.

```json
{
  "message": "List my scheduled tasks",
  "memories": []
}
```

Responses include `success`, `reply`, and `status`. Agent responses also include `toolCall` for compatibility and `toolCalls` for the execution history.

The agent can use `read_public_webpage` for one complete public HTTP(S) URL, or `read_public_webpages` for up to three distinct URLs all explicitly included in the user's message. If the user explicitly asks to follow links from a provided URL, `read_public_linked_pages` reads the source plus at most two static links on the same origin. All return bounded readable text; none click controls, submit forms, authenticate, or allow retrieved page text to trigger follow-up tool calls.

For inbox requests, the agent can use `search_gmail` with Gmail search syntax such as `from:person@example.com`, `subject:invoice`, `after:2026/01/01`, `before:2026/02/01`, and `is:unread`. It searches only the Inbox label and returns at most 20 results (5 by default), with sender, subject, date, and snippet. It is read-only and does not fetch full message bodies.

Recurring reminder requests use a five-field cron expression and the Android device's IANA timezone. For scheduled webpage summaries, the user must provide the exact public HTTP(S) URL; one-time and recurring summaries fetch that page when due and use Gemini to summarize its content. The workflow is read-only and does not check email, follow page instructions, or perform other actions. The backend must be running when the task is due.

### `GET /api/gmail/status`

Returns OAuth configuration and connection indicators (`configured`, `connected`, and `searchAvailable`) without exposing tokens. If `searchAvailable` is false, restart the backend and reauthorize at `/api/gmail/auth`, then approve Gmail read access.

### `GET /api/gmail/auth`

Returns a Google OAuth consent URL requesting Gmail readonly access only. Open the returned URL to connect or reauthorize. Redirect URI must match `GOOGLE_REDIRECT_URI`.

### `GET /api/reminders`

Returns due in-app reminders or scheduled webpage summaries that have not yet been acknowledged by the Android client. Webpage results include their source URL.

### `POST /api/reminders/:taskId/ack`

Acknowledges a reminder after the Android app posts its system notification. If notification permission or the channel is unavailable, the app uses the persisted in-chat reminder as a fallback. The chat polls every 30 seconds; WorkManager checks at startup and periodically (Android's 15-minute minimum), subject to network availability and Android scheduling. Background notification delivery is best-effort, not exact-time.

## Tests

From the repository root in PowerShell:

```powershell
npm --prefix backend test
.\gradlew.bat testDebugUnitTest assembleDebug compileDebugAndroidTestKotlin connectedDebugAndroidTest
npm --prefix backend run benchmark
```

Latest verification: backend tests **71 passed, 0 failed**; Android unit tests **15 passed**; emulator instrumentation tests **13 passed**; the debug APK built and installed successfully. Agent/Gmail automated tests use mocked provider APIs and isolated temporary storage; they do not consume Gemini quota or make Gmail API calls. Instrumentation tests are automated checks, not a full interactive app test.

### Manual verification (user-confirmed)

- The app was installed and launched on the emulator, and AI responses worked.
- Live Gemini chat was confirmed, with occasional model overload or incomplete final responses.
- Chat history remained after closing and reopening the app.
- A local memory was saved, appeared in the app, and remained after reopening.
- Live speech-to-text succeeded on the emulator; recognized text appeared in chat.
- Gmail OAuth connected, `/api/gmail/status` confirmed the connection, and a live read-only inbox search returned results. Search displays sender, subject, date, and snippet only.
- Reminder scheduling and in-chat delivery were confirmed. The DEBUG WorkManager trigger started the worker and contacted the backend, but the worker found zero pending reminders, so no Android system notification was verified.

These user-confirmed manual checks are separate from automated tests. Full interactive Android testing and live system-notification posting remain unverified.

The benchmark runs 20 mock agent requests and scheduled webpage workflows by default. It reports mean, p50, and p95 latency plus backend RSS and heap deltas. It makes no network requests and does not measure live Gemini or Android performance; these figures are a reproducible local baseline, not production latency.

Conversation messages are stored locally in Room. Use **Clear** in the chat toolbar to remove the transcript from this device; saved memories are unaffected. Chat history is not synchronized to the backend.

## Screenshots

Screenshots are not included yet.

- Chat screen: _placeholder_
- Memory screen: _placeholder_

## Known limitations

- Scheduled tasks support one-time and recurring reminders, plus read-only public-webpage summaries for an explicitly user-provided URL. Android background delivery uses network-constrained WorkManager and system notifications; delivery is best-effort and may be delayed by Android battery policies. The backend must remain reachable, and notification permission must be granted. Scheduled workflows do not check email or execute arbitrary actions.
- Voice input uses the device speech-recognition service and requires microphone permission. Live speech-to-text was confirmed on the emulator; behavior still depends on the installed recognition service, network, locale, and device configuration.
- Gmail OAuth asks for the readonly scope only and does not request previously granted scopes. Agent inbox search is read-only and returns only message metadata and snippets. Live inbox search was manually verified by the user; automated Google API tests remain mocked. Reauthorize through `/api/gmail/auth` if `/api/gmail/status` shows `searchAvailable: false`. If you previously granted Gmail send access, revoke the existing app grant in your Google Account security settings to remove that old consent.
- Agent-side Gmail sending is disabled, including the Gmail API send function and OAuth send scope. The agent can prepare a draft for review, but cannot send it. The approval endpoint rejects send requests because no server-verified, exact-action approval flow exists.
- Gmail search is limited to messages in the Inbox label, up to 20 results, and does not fetch message bodies. Gmail API authorization and quota errors are reported without returning raw provider details.
- Backend OAuth tokens are stored locally in `backend/data/gmail-tokens.json`. This file and `.env` are ignored by Git, but encrypted token storage and production credential management are not implemented.
- The in-app browser supports user-controlled navigation and text extraction, but form submission and agent-driven browser actions (including clicking controls or authenticating) are unsupported.
- Emulator checks confirmed app launch, AI responses, chat-history persistence, memory persistence, live speech-to-text, Gmail search, and reminder scheduling/in-chat delivery. The worker contacted the backend but found no pending reminder, so system notification posting and physical-device behavior remain unverified.
- Debug builds permit cleartext HTTP for local development. Release builds require an HTTPS backend URL and disable cleartext traffic, but production still needs a deployed backend and backend authentication.
- Up to ten lexically relevant local memories are included in agent requests (500 characters each); if none match, the newest memories are used. Backend logs do not include their contents.
- Gemini model availability and quota are controlled by the configured API account.
- Live Gemini chat can occasionally encounter model overload or return an incomplete final response.
- When a tool fails and the model retries the same tool in the next round with corrected arguments, the agent can treat the retry as resolving the earlier failure. If multiple same-tool failures are outstanding, an unrelated later success does not clear them. Tool outcome correlation remains a heuristic because the provider does not supply a stable retry identifier.
