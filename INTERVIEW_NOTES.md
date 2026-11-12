# Interview Notes

## Why Kotlin and Jetpack Compose?

Kotlin provides a concise, type-safe language for Android. Jetpack Compose keeps the chat and memory screens declarative and allows UI state such as loading, messages, and deletion confirmation to be expressed directly. The trade-off in this project is that screen state and command handling are concentrated in `MainActivity`; a larger app would benefit from ViewModels and a clearer domain layer.

## Why Node.js and Express?

Node.js provides a straightforward asynchronous HTTP layer for calling Gemini and executing tools. Express keeps the API endpoints and middleware small and easy to demonstrate. The scheduler and API are intentionally simple for an assignment rather than a distributed job-processing system.

## How does Gemini function calling work?

The backend sends tool declarations and a conversation to Gemini. Gemini may return one or more function calls. The service checks each function name and arguments against a local registry, invokes the matching handler, and sends a function-response part containing the result or error back to Gemini. It continues for a bounded number of rounds and returns both the final reply and tool-call history.

## How are tools registered and validated?

`backend/src/agent/tools.js` defines each tool's name, description, JSON schema, argument validator, and handler in one registry. The backend validates names and arguments before running handlers; handlers may return `success: false` or throw, and both outcomes are reported as failures to Gemini. Keeping the schema and validator together avoids relying only on model-generated arguments. The webpage tool requires a URL explicitly supplied by the user and treats retrieved content as untrusted data.

## How does Room persist memories?

Room maps a Kotlin memory entity to a local SQLite table. A DAO defines insert, list, search, and delete queries; a repository provides the suspend/Flow operations used by Compose. The database is device-local. The app selectively includes up to ten short saved memories in agent requests when relevant to normal chat.

## How does voice input work?

The app requests `RECORD_AUDIO` only after a microphone-button tap. `SpeechRecognizer` runs a single foreground recognition session and returns text to the editable chat input. The recognizer is cancelled and destroyed when the composable is disposed. Audio is not stored, and the feature depends on a recognition service available on the device.

## How are scheduled tasks persisted?

The scheduler serializes task records into `backend/data/scheduled-tasks.json`, writing a temporary file and renaming it into place. One-time reminders use timezone-explicit timestamps; `cron-parser` evaluates recurring five-field expressions using the Android client's IANA timezone and enforces a five-minute minimum interval. A five-second timer executes the single supported `reminder` action and advances recurring schedules, with bounded retries. The Android app polls and acknowledges reminders while the chat screen is open. It does **not** run arbitrary work or create Android system notifications/background workers.

## Security considerations

- Keep `GEMINI_API_KEY` in backend environment configuration; never put it in Android source or commit `.env`.
- Provider diagnostics redact common API-key and bearer-token formats; user messages and memories are not logged.
- Helmet, CORS, request validation, a 20 KB request limit, and a per-IP rate limit are configured.
- The current app/backend connection uses local cleartext HTTP and the API has no authentication. These are development assumptions, not production security.
- Local memories and task descriptions may be personal data; do not expose the local JSON file or logs when sharing the project.

## Trade-offs and limitations

- The model list falls through in a fixed preferred order; quota exhaustion can still prevent a live response.
- Retrying a failed tool call is inferred from tool name, arguments, and model round because there is no stable provider retry ID. Ambiguous multi-failure cases remain failed rather than being silently counted as success.
- Scheduled-task storage is a simple JSON file suitable for a single local process, not concurrent distributed workers. Reminder delivery requires the Android app to be open.
- Recurring cron schedules are reminders only. They do not execute email checks or other workflows, and the backend must be running for due reminders to be generated.
- Email support only prepares a validated, user-visible draft and explicitly does not send it. Sending would require a backend mail provider and a separate explicit confirmation flow.
- Web access only retrieves bounded text from public URLs; it does not automate page controls or bypass sign-in. A smoke test read and searched `https://example.com` using mock Gemini responses.
- Memory and agent UI behavior has been compiled but not interactively demonstrated on an emulator in the current validation pass.
- Gmail sending/search, interactive browser automation, Android system notifications, authentication, and production HTTPS setup are not implemented.
