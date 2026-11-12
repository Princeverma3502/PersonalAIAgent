# Personal AI Agent

A Kotlin Android chat app backed by a Node.js service that connects to Google Gemini. The agent can call backend tools for reminders, email drafts, and read-only webpage retrieval, while user memories are stored locally on the device.

## Features

- Jetpack Compose chat UI with loading feedback, scrolling responses, and backend error handling.
- Runtime-permission-based speech recognition that puts recognized text in the editable chat field.
- Local Room memory storage with save, list, search, and delete flows.
- Gemini agent tool calling with ordered model fallback and tool-execution history.
- Validated email draft preparation; drafts are shown for review and are never sent.
- Read-only public webpage retrieval and optional text search for URLs supplied by the user.
- JSON-backed one-time and recurring reminders with in-app delivery and best-effort Android background notifications.
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

Set `GEMINI_API_KEY` in `backend\.env` before using AI routes. The sample file contains placeholders only. Do not commit `.env`. `PORT` defaults to `3000`; `ALLOWED_ORIGIN` defaults to `http://localhost:3000`.

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
.\gradlew.bat testDebugUnitTest assembleDebug
```

The debug APK is written to `app\build\outputs\apk\debug\app-debug.apk`. The Android client uses the emulator host alias `10.0.2.2` and local HTTP; this setup is for development, not production deployment.

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

The agent can use `read_public_webpage` when the user includes a complete public HTTP(S) URL. It returns the page title and bounded readable text, with an optional phrase search. It does not click, submit forms, authenticate, or automate page controls.

Recurring reminder requests use a five-field cron expression and the Android device's IANA timezone. They create reminders only; they do not execute email checks or other actions.

### `GET /api/reminders`

Returns due in-app reminders that have not yet been acknowledged by the Android client.

### `POST /api/reminders/:taskId/ack`

Acknowledges a reminder after the Android app displays it or posts its system notification. The app polls every 30 seconds while its chat screen is open. WorkManager also checks at startup and periodically (Android's 15-minute minimum), subject to network availability and notification permission.

## Tests

From the repository root in PowerShell:

```powershell
npm --prefix backend test
.\gradlew.bat testDebugUnitTest
```

The backend tests use mock Gemini responses for agent execution and isolated temporary storage for scheduler persistence. They do not consume Gemini quota or modify `backend\data\scheduled-tasks.json`. Android unit tests cover the example and speech-error mapping; microphone recognition, emulator interactions, and live Gemini calls must be verified separately.

## Screenshots

Screenshots are not included yet.

- Chat screen: _placeholder_
- Memory screen: _placeholder_

## Known limitations

- Scheduled tasks support one-time and recurring reminders only. Android background delivery uses network-constrained WorkManager and system notifications; delivery is best-effort and may be delayed by Android battery policies. The backend must remain reachable, and notification permission must be granted. These schedules do not execute arbitrary actions.
- Voice input uses the device speech-recognition service and requires microphone permission; behavior depends on an installed/available recognition service and has not been verified on an emulator or physical device.
- Email is draft-only: no Gmail/OAuth provider, sending, or email search is configured. Drafts are not sent.
- Browser access is read-only and limited to explicit public URLs; page interaction, authentication, and browser automation are not implemented.
- The Android application has not been verified interactively in an emulator or on a physical device in the current validation pass.
- The debug client uses cleartext HTTP and a fixed emulator URL. A production deployment needs HTTPS, configurable environments, and an authenticated backend.
- Local memories are included in agent requests (up to 10 entries, 500 characters each); backend logs do not include their contents.
- Gemini model availability and quota are controlled by the configured API account.
- When a tool fails and the model retries the same tool in the next round with corrected arguments, the agent can treat the retry as resolving the earlier failure. If multiple same-tool failures are outstanding, an unrelated later success does not clear them. Tool outcome correlation remains a heuristic because the provider does not supply a stable retry identifier.
