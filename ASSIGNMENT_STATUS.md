# Assignment Status

## Completed

- Android Compose chat UI with loading feedback, automatic latest-message scrolling, and backend error handling.
- Android-to-backend agent request using the emulator host address and JSON request/response parsing.
- Parsing of all agent tool calls and their statuses.
- Foreground, one-shot Android speech recognition with runtime microphone permission and recognized-text editing.
- Room-backed local memories with save, list, search, single-delete, and confirmed delete-all flows.
- Lexically relevance-ranked memory retrieval for agent context, with recent-memory fallback.
- Gemini agent tool/function calling with argument validation and multi-round execution.
- Ordered model fallback and categorized provider diagnostics with credential redaction.
- JSON-backed one-time and timezone-aware recurring reminder creation, listing, cancellation, due execution, bounded retries, foreground polling, and best-effort WorkManager notification delivery.
- Validated email draft preparation, with user-initiated handoff to a compatible email app; the agent never sends.
- Read-only retrieval of explicitly provided public webpages with bounded text extraction and optional search.
- Controlled Android browser with HTTP(S) navigation, page history, scrolling, and bounded visible-text extraction.
- Per-request agent latency and process PSS diagnostics, plus persisted scheduler delay measurements.
- Backend security middleware, request-size and rate limits, input validation, and placeholder environment template.
- Debug APK build and backend/Android unit-test commands.

## Partially completed

- **Scheduled reminders:** one-time and recurring reminder results are durable. WorkManager checks at startup and on its 15-minute minimum periodic interval, constrained by network access and Android battery policies. The backend must be reachable and notification permission granted for background notifications.
- **Gemini integration:** fallback and tool recovery are covered with mocks; a successful live Gemini request was not verified.
- **Voice input:** permission and error handling are implemented and unit-tested; actual microphone recognition was not tested on a device.
- **Android runtime:** Kotlin compilation, unit tests, and APK packaging passed. No interactive emulator or physical-device pass was completed.
- **Performance analysis:** Per-event latency, process PSS, and scheduler delay are surfaced. A representative live Gemini/device benchmark has not yet been collected.
- **Documentation:** README, architecture, assignment status, and interview notes are present.
- **Web browsing:** public webpage retrieval and a user-controlled in-app browser are implemented. The agent cannot click controls, submit forms, authenticate, or autonomously browse.
- **Recurring workflows:** cron reminders are supported, but recurring actions such as checking email and producing summaries are not implemented.
- **Tool failure correlation:** same-round same-name calls are kept distinct and ambiguous multi-failure retries remain failures. A single failure followed by a same-name call in the next round can be inferred as a correction when arguments change; this is necessarily heuristic.

## Not implemented

- Gmail/OAuth integration, agent-side email sending, and email search. Users can review and send a draft themselves in a compatible email app.
- Agent-driven browser automation, authentication, and page actions such as clicking or submitting forms.
- Actual execution of arbitrary scheduled actions or recurring workflows.
- Arbitrary scheduled workflows/actions beyond reminders.
- Production authentication, HTTPS deployment, and configurable Android API environments.
- Screenshots.

## Verification results

| Check | Result |
|---|---|
| `node --check` for backend source/tests | Passed. |
| `npm --prefix backend test` | Passed: 29 tests, 0 failures. Agent/browser tests use mock AI and network adapters; scheduler tests use isolated storage. |
| Agent tool-failure handling | Mock tests pass for handler failure, exception, corrected retry, same-round same-name calls, multiple unresolved failures, multi-tool history, model fallback and redaction. |
| Email draft handling | Mock tests pass for validated draft display, explicit not-sent messaging, and malformed recipient rejection. |
| Public webpage retrieval | Tests pass for URL/IP restrictions, redirect validation, text extraction, search, and tool registration. A live agent-tool smoke test successfully read and searched `https://example.com` using mock Gemini responses. |
| Scheduler behavior | Isolated tests pass for validation, create/list/cancel, persistence across reload, durable reminder results, acknowledgement, retry limit, repeated execution check, and due-to-execution delay recording. |
| Recurring scheduler behavior | Isolated tests pass for five-field cron validation, minimum interval, IANA timezone, persistence, next-run advancement, reminder acknowledgement, and cancellation. |
| Android background reminders | `.\gradlew.bat testDebugUnitTest assembleDebug` verifies WorkManager integration compiles and packages; no device notification or Doze-mode test has been completed. |
| Memory retrieval | Unit tests verify relevance ranking, recent-memory fallback, and result limits. |
| Browser URL policy | Unit tests verify HTTPS normalization and reject non-web schemes and embedded credentials. |
| Android browser | `compileDebugAndroidTestKotlin` and APK build pass; interactive WebView behavior was not tested on a device. |
| Performance diagnostics | Android request duration and process PSS are displayed; scheduler delay is persisted and returned with reminders. No live Gemini/device baseline has been collected. |
| `GET /health` | Returned success once with backend running. |
| Malformed JSON request | Returned JSON error with HTTP 400. |
| Valid live `POST /api/agent` | Not verified; the local backend was not listening when attempted, so Gemini was not reached. |
| `.\gradlew.bat testDebugUnitTest assembleDebug compileDebugAndroidTestKotlin` | Passed: 7 Android unit tests, 0 failures; instrumentation tests compiled but were not run on a device. |
| Emulator/device tests | Emulator is present, but no interactive app test or speech-recognition test was completed. |
| Debug APK | Rebuilt at `app/build/outputs/apk/debug/app-debug.apk`; 12,334,276 bytes. |

## Known limitations and risks

- Scheduled task actions are limited to durable reminder records; Android notifications are best-effort and may be delayed by OS policy.
- Recurrence is limited to reminders and at least five minutes apart. It does not run workflows, and the backend process must be alive at execution time.
- Reminder delivery requires the backend to be running and reachable. Background delivery also requires notification permission and is subject to Android scheduling and battery policies.
- Speech recognition depends on device service availability and has not been exercised on an emulator.
- The backend has no authentication and the Android development client uses cleartext HTTP.
- Room migration behavior has not been exercised.
- There is no live Gemini verification because the smoke-test attempt could not connect to a running backend.
- Tool retry correlation cannot perfectly distinguish a corrected call from a new same-name operation when arguments change; ambiguous failures are handled conservatively.
- Email drafts are not persisted or sent by the agent. Sending still requires a user action in an installed email app; Gmail OAuth/provider integration is not configured.
- Backend webpage retrieval requires the exact URL in the user's message; the in-app browser allows user-controlled HTTP(S) navigation. Neither flow supports agent-driven page actions or authentication.
- Browser URL policy tests cover HTTPS normalization and blocking non-web schemes and embedded credentials. Device-level WebView behavior remains untested.
- Performance values are available per event, but median/percentile measurements from a live backend and target device remain to be collected.

## Recommended next steps

1. Start the backend and perform a valid, synthetic `/api/agent` request without printing credentials.
2. Run emulator checks for speech recognition, reminders, chat, memories, scrolling, backend errors, and tools.
3. Rebuild and re-check the APK timestamp and size.
4. Keep scheduler and notification limitations and lack of production authentication visible in the submission.
