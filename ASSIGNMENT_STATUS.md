# Assignment Status

## Completed

- Android Compose chat UI with loading feedback, automatic latest-message scrolling, and backend error handling.
- Android-to-backend agent request using the emulator host address and JSON request/response parsing.
- Parsing of all agent tool calls and their statuses.
- Foreground, one-shot Android speech recognition with runtime microphone permission and recognized-text editing.
- Room-backed local memories with save, list, search, single-delete, and confirmed delete-all flows.
- Room-backed conversation history restored across app restarts, with a confirmed clear action separate from memory deletion.
- Lexically relevance-ranked memory retrieval for agent context, with recent-memory fallback.
- Gemini agent tool/function calling with argument validation and multi-round execution.
- Ordered model fallback and categorized provider diagnostics with credential redaction.
- JSON-backed one-time and timezone-aware recurring reminder creation, listing, cancellation, due execution, bounded retries, foreground polling, and best-effort WorkManager notification delivery.
- Validated email draft preparation, with user-initiated handoff to a compatible email app; the agent never sends.
- Read-only retrieval of explicitly provided public webpages with bounded text extraction and optional search; batch reads support up to three distinct, user-provided URLs per request.
- One-time and recurring scheduled public-webpage summaries for exact URLs supplied by the user; page retrieval and Gemini summarization run at the scheduled time and deliver results through reminders.
- Controlled Android browser with HTTP(S) navigation, page history, scrolling, and bounded visible-text extraction.
- Per-request agent latency and process PSS diagnostics, plus persisted scheduler delay measurements.
- Build-configurable Android backend origins; release builds require HTTPS and disable cleartext traffic.
- Backend security middleware, request-size and rate limits, input validation, and placeholder environment template.
- Debug APK build and backend/Android unit-test commands.

## Partially completed

- **Scheduled tasks:** one-time and recurring reminders and read-only public-webpage summaries are supported. WorkManager checks at startup and on its 15-minute minimum periodic interval, constrained by network access and Android battery policies. The backend must be reachable and notification permission granted for background notifications. Webpage workflows require the backend and Gemini to be available when due.
- **Gemini integration:** fallback and tool recovery are covered with mocks; a successful live Gemini request was not verified.
- **Voice input:** permission and error handling are implemented and unit-tested; actual microphone recognition was not tested on a device.
- **Android runtime:** Kotlin compilation, unit tests, debug and release APK packaging, and five emulator instrumentation tests passed. Speech-recognition and full interactive feature testing remain incomplete.
- **Performance analysis:** Android request latency and PSS plus backend scheduler delay are surfaced. A reproducible mock baseline is available; live Gemini and physical-device benchmarks remain uncollected.
- **Documentation:** README, architecture, assignment status, and interview notes are present.
- **Web browsing:** the agent can read one explicitly provided URL, batches of up to three explicitly provided URLs, and (when requested) at most two static links on the same origin as an explicitly provided seed URL. Retrieval is bounded and read-only. The in-app browser remains user-controlled. The agent cannot click controls, submit forms, or authenticate.
- **Scheduled workflow scope:** webpage summaries are supported only for explicit public URLs; email checks and other arbitrary actions are not implemented.
- **Tool failure correlation:** same-round same-name calls are kept distinct and ambiguous multi-failure retries remain failures. A single failure followed by a same-name call in the next round can be inferred as a correction when arguments change; this is necessarily heuristic.

## Not implemented

- Gmail/OAuth integration, agent-side email sending, and email search. Users can review and send a draft themselves in a compatible email app.
- Agent-driven browser automation, authentication, and page actions such as clicking or submitting forms.
- Gmail/OAuth-backed scheduled email checks or other arbitrary scheduled actions.
- Production backend authentication and deployment.
- Screenshots.

## Verification results

| Check | Result |
|---|---|
| `node --check` for backend source/tests | Passed. |
| `npm --prefix backend test` | Passed: 45 tests, 0 failures. Agent/browser tests use mock AI and network adapters; scheduler tests use isolated storage. |
| Agent tool-failure handling | Mock tests pass for handler failure, exception, corrected retry, same-round same-name calls, multiple unresolved failures, multi-tool history, model fallback and redaction. |
| Email draft handling | Mock tests pass for validated draft display, explicit not-sent messaging, and malformed recipient rejection. |
| Public webpage retrieval | Tests cover URL/IP restrictions, redirect validation, text extraction, search, explicit URL and link-navigation intent checks, batches of up to three pages, same-origin linked-page reads, cross-origin redirect rejection, and no follow-up tool round. A live agent-tool smoke test successfully read and searched `https://example.com` using mock Gemini responses. |
| Scheduler behavior | Isolated tests pass for validation, create/list/cancel, persistence across reload, durable reminder results, acknowledgement, retry limit, repeated execution check, and due-to-execution delay recording. |
| Recurring scheduler behavior | Isolated tests pass for five-field cron validation, minimum interval, IANA timezone, persistence, next-run advancement, reminder acknowledgement, and cancellation. |
| Scheduled webpage summaries | Mock tests pass for page retrieval followed by tool-free summarization, retrieval failure handling, explicit-URL enforcement, workflow validation, one-time and recurring execution, result/source delivery, and acknowledgement. |
| Android background reminders | `.\gradlew.bat testDebugUnitTest assembleDebug` verifies WorkManager integration compiles and packages; no device notification or Doze-mode test has been completed. |
| Memory retrieval | Unit tests verify relevance ranking, recent-memory fallback, and result limits. |
| Conversation history | Two emulator instrumentation tests pass for Room reopen/clear behavior and v1→v2 migration preserving existing memories; all five connected instrumentation tests passed. |
| Browser URL policy | Unit tests verify HTTPS normalization and reject non-web schemes and embedded credentials. |
| Android browser | `compileDebugAndroidTestKotlin` and APK build pass; interactive WebView behavior was not tested on a device. |
| Performance diagnostics and benchmark | `npm --prefix backend run benchmark` passed (20 mock iterations): agent response p50/p95 0.40/4.74 ms; scheduled workflow p50/p95 11.44/21.03 ms; RSS/heap delta +2.46/+1.28 MiB on Windows x64 / Node 22.17.1. Mock values exclude live Gemini/network and Android device memory. |
| `GET /health` | Returned success once with backend running. |
| Malformed JSON request | Returned JSON error with HTTP 400. |
| Valid live `POST /api/agent` | Not verified; the local backend was not listening when attempted, so Gemini was not reached. |
| `.\gradlew.bat testDebugUnitTest assembleDebug compileDebugAndroidTestKotlin` | Passed: 7 Android unit tests, 0 failures; Android instrumentation sources compiled. The separate `connectedDebugAndroidTest` run passed all 5 tests on the emulator. |
| Android API environment configuration | Debug custom HTTP URL generated successfully; release APK built with HTTPS configuration; release cleartext traffic disabled and HTTP release URL rejected. |
| Emulator/device tests | Conversation database instrumentation tests ran on the emulator; no full interactive app or speech-recognition pass was completed. |
| Debug APK | Rebuilt at `app/build/outputs/apk/debug/app-debug.apk`; 12,334,276 bytes. |

## Known limitations and risks

- Scheduled task actions are limited to durable reminders and read-only summaries of an explicitly provided public webpage; Android notifications are best-effort and may be delayed by OS policy.
- Recurrence is limited to reminders and webpage summaries and at least five minutes apart. It does not run email checks or arbitrary actions, and the backend process must be alive at execution time.
- Reminder delivery requires the backend to be running and reachable. Background delivery also requires notification permission and is subject to Android scheduling and battery policies.
- Speech recognition depends on device service availability and has not been exercised on an emulator.
- The backend has no authentication. Debug permits cleartext HTTP for development; release builds enforce HTTPS but still require a deployed, authenticated backend.
- Chat history is stored locally with the existing Room database and can be cleared separately from saved memories; it is not synchronized to the backend.
- There is no live Gemini verification because the smoke-test attempt could not connect to a running backend.
- Tool retry correlation cannot perfectly distinguish a corrected call from a new same-name operation when arguments change; ambiguous failures are handled conservatively.
- Email drafts are not persisted or sent by the agent. Sending still requires a user action in an installed email app; Gmail OAuth/provider integration is not configured.
- Backend webpage retrieval requires exact user-provided URLs for direct reads. Link navigation is only allowed on explicit request, only for static same-origin links, and is limited to two related pages; the in-app browser allows user-controlled HTTP(S) navigation. Neither flow supports agent-driven page actions or authentication.
- Browser URL policy tests cover HTTPS normalization and blocking non-web schemes and embedded credentials. Device-level WebView behavior remains untested.
- The local benchmark uses mocked model responses and excludes real provider/network latency; live Gemini latency and target-device PSS measurements remain to be collected.

## Recommended next steps

1. Start the backend and perform a valid, synthetic `/api/agent` request without printing credentials.
2. Run emulator checks for speech recognition, reminders, chat, memories, scrolling, backend errors, and tools.
3. Rebuild and re-check the APK timestamp and size.
4. Keep scheduler and notification limitations and lack of production authentication visible in the submission.
