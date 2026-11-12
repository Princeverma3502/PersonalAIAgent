# Personal AI Agent

A Kotlin Android chat app backed by a Node.js service that connects to Google Gemini. The agent can call backend tools for scheduled-task management, while user memories are stored locally on the device.

## Features

- Jetpack Compose chat UI with loading feedback, scrolling responses, and backend error handling.
- Local Room memory storage with save, list, search, and delete flows.
- Gemini agent tool calling with ordered model fallback and tool-execution history.
- JSON-backed one-time scheduled-task records with create, list, cancel, and due-status updates.
- Backend request validation, CORS, Helmet headers, request-size limits, rate limiting, and secret-safe provider diagnostics.

## Architecture

- **Android:** Compose UI, a Room-backed memory repository, and an HTTP client for the agent endpoint.
- **Backend:** Express API, Gemini integration, a registry of validated tools, and a JSON-file scheduler.
- **Communication:** The Android app sends `POST /api/agent` requests to `http://10.0.2.2:3000/api/agent` when running in the Android emulator.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for component and request-flow details, and [ASSIGNMENT_STATUS.md](./ASSIGNMENT_STATUS.md) for the implementation and verification status.

## Technology stack

- Android: Kotlin, Jetpack Compose, Material 3, Room, Kotlin coroutines.
- Backend: Node.js, Express, `@google/genai`, Helmet, CORS, and `express-rate-limit`.
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

## Tests

From the repository root in PowerShell:

```powershell
npm --prefix backend test
.\gradlew.bat testDebugUnitTest
```

The backend tests use mock Gemini responses for agent execution and isolated temporary storage for scheduler persistence. They do not consume Gemini quota or modify `backend\data\scheduled-tasks.json`. The Android unit-test suite currently contains a basic example test; emulator and live Gemini checks must be run separately.

## Screenshots

Screenshots are not included yet.

- Chat screen: _placeholder_
- Memory screen: _placeholder_

## Known limitations

- A scheduled task becoming due only changes its status to `completed` and logs a count. It does not execute arbitrary actions, notify the user, or run on Android.
- Voice input is not implemented; the chat screen labels it accordingly.
- The Android application has not been verified in an emulator or on a physical device in the current validation pass.
- The debug client uses cleartext HTTP and a fixed emulator URL. A production deployment needs HTTPS, configurable environments, and an authenticated backend.
- Local memories are included in agent requests (up to 10 entries, 500 characters each); backend logs do not include their contents.
- Gemini model availability and quota are controlled by the configured API account.
- When a tool fails and the model retries the same tool in the next round with corrected arguments, the agent can treat the retry as resolving the earlier failure. If multiple same-tool failures are outstanding, an unrelated later success does not clear them. Tool outcome correlation remains a heuristic because the provider does not supply a stable retry identifier.
