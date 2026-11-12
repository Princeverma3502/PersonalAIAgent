# Architecture

## System overview

The project has an Android client and a Node.js backend. Android owns the chat UI and local memories. The backend owns Gemini access, tool execution, and scheduled-task JSON storage.

```text
Compose UI
  ├─ Local memory commands ──> MemoryRepository ──> Room database
  └─ Other messages ──HTTP──> Express /api/agent ──> Gemini
                                                    └─ Registered tools
                                                         └─ JSON scheduler
```

## Android architecture

- `MainActivity.kt` hosts the Compose screen and chat state. It handles memory-specific command phrases locally and sends other messages to the backend.
- `MemoryScreen.kt` displays the saved memories and confirms deletion.
- `MemoryEntity`, `MemoryDao`, `MemoryDatabase`, and `MemoryRepository` define the Room persistence layer. The database is named `personal_agent_memory`.
- `ChatApiClient.kt` sends JSON to the emulator address `http://10.0.2.2:3000/api/agent`, includes at most ten short memories, reads all `toolCalls`, and raises a response exception for non-2xx HTTP codes.
- The network call runs on `Dispatchers.IO`; loading and error messages are shown in the Compose UI.
- `VoiceInput.kt` requests `RECORD_AUDIO` at runtime, starts a one-shot `SpeechRecognizer` session on user action, places recognized text into the editable field, and cancels/destroys the recognizer when the control leaves composition. It does not store audio or listen in the background.

The current UI and data access are directly hosted by Compose state and repository calls; this project does not use a separate ViewModel layer.

## Backend architecture

- `server.js` loads backend environment variables, configures Express security middleware, defines the three API routes, and initializes the scheduler before listening.
- `agentService.js` validates the request, builds Gemini context, sends tool declarations, executes returned calls, and continues the model/tool loop for at most five rounds.
- `tools.js` is the single registry for tool names, descriptions, JSON schemas, argument validation, and handlers.
- `geminiError.js` extracts provider error details, classifies common errors, redacts common credential patterns in diagnostics, and chooses user-facing messages.
- `taskScheduler.js` stores scheduled task records in `backend/data/scheduled-tasks.json`.

The Gemini API key is read only by the backend from `GEMINI_API_KEY`. The Android application does not contain a Gemini key.
Email draft preparation is a local backend tool; it does not connect to a mail provider or send messages.

## Agent execution flow

1. `POST /api/agent` validates the message and filters the optional memory list.
2. The service builds an instruction prompt and supplies the registered tool declarations to Gemini.
3. If Gemini returns function calls, each is validated and handled. Each result is added to the execution history and returned to Gemini as a function response.
4. The service continues until Gemini returns final text or the five-round limit is reached.
5. Failed calls remain visible in `toolCalls`. Unresolved failures override a contradictory success claim in the final text.
6. If Gemini fails before any tool executes, eligible provider errors fall through the configured models in order. A bounded delay is used for temporary overloads.
7. If Gemini fails after a tool executed, the service returns the known tool outcome rather than replaying the initial prompt and potentially repeating a side effect.

Failure recovery correlates operation arguments and model rounds. A single same-name failure followed by one same-name call in the next round can be treated as a corrected retry when arguments differ. Multiple pending failures are not cleared by one unrelated success. Because Gemini does not give a stable retry identifier, this remains a conservative heuristic.

## Gemini integration

The configured order is:

1. `gemini-3.8-flash`
2. `gemini-3.6-flash`
3. `gemini-3.5-flash-lite`

The order is shared by the basic chat and agent routes. Error handling distinguishes quota exhaustion, rate limiting, temporary overload, invalid credentials, and model-not-found responses when provider details permit. Invalid credentials do not trigger pointless fallback requests. Provider retries are bounded; there is no unbounded retry loop.

## Tool/function calling

The registry exposes:

- `get_current_time`
- `create_scheduled_task`
- `list_scheduled_tasks`
- `cancel_scheduled_task`
- `draft_email`

Each tool has a schema and a local argument validator. Handlers can report failure with `success: false` or throw; both paths become failed tool calls and their error is sent back to Gemini. The response preserves the complete tool-call history and a compatibility `toolCall` field for the last call.

`draft_email` validates the recipient, subject, and complete message, then returns the draft verbatim to the user with an explicit “NOT SENT” label. There is no email provider, send tool, or search tool configured; sending is intentionally unavailable until a provider and a user-confirmation flow exist.

## Memory persistence

Memories are kept only in the Android Room database. Local command phrases invoke repository operations for save, view, search, and delete. For normal agent requests, the client includes up to ten memories, truncated to 500 characters each, as prompt context. The backend does not persist the memory list.

## Scheduled-task flow and limitations

1. Gemini obtains current time and requests a task with title, description, and an ISO 8601 `runAt` value containing `Z` or an explicit offset.
2. The scheduler checks non-empty bounded title/description, valid timestamp, and future execution time.
3. The task record is written to JSON using a temporary file followed by rename.
4. The scheduler checks for due pending reminders every five seconds. It persists an `executing` state, creates a durable reminder result keyed by task ID, and persists completion. Interrupted `executing` tasks are re-queued at startup; action failures retry with bounded backoff and eventually become `failed`.
5. `GET /api/reminders` exposes unacknowledged results. While the chat screen is open, Android polls every 30 seconds, displays each task ID once per app process, and acknowledges it with `POST /api/reminders/:taskId/ack`.
6. Cancellation only changes a pending task to `cancelled`; unknown, completed, or cancelled IDs return failure.

**Important:** The only supported action is creating an in-app reminder result. There are no Android system notifications or background app polling; reminders are displayed when the app is open. The scheduler does not run arbitrary actions or execute generated code.

## Voice input

The Compose control requests microphone permission only after a user tap. Speech recognition is a one-shot foreground interaction; the recognized text remains editable before submission. Permission denial, unavailable recognition, cancellation, silence, and recognition service errors are surfaced in the UI. No recording is saved. Actual speech availability depends on the emulator/device recognition service and was not verified in the current test pass.

## Security and deployment notes

- Helmet, a 20 KB JSON limit, request validation, and a rate limit of 20 API requests per minute are configured.
- CORS allows the configured `ALLOWED_ORIGIN`, defaulting to `http://localhost:3000`.
- `.env` files and backend scheduler data are ignored by Git; `.env.example` contains placeholders.
- The current emulator setup uses cleartext HTTP and has no user authentication. Use HTTPS, authentication, deployment-specific origins, and secret management before exposing the service publicly.
- No email provider/OAuth integration or browser retrieval tool is configured in this project.
