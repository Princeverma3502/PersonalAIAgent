# Assignment Status

## Completed

- Android Compose chat UI with loading feedback, automatic latest-message scrolling, and backend error handling.
- Android-to-backend agent request using the emulator host address and JSON request/response parsing.
- Parsing of all agent tool calls and their statuses.
- Foreground, one-shot Android speech recognition with runtime microphone permission and recognized-text editing; live speech-to-text was confirmed on the emulator.
- Room-backed local memories with save, list, search, single-delete, and confirmed delete-all flows; saving and persistence after reopening were manually verified.
- Room-backed conversation history restored across app restarts, with a confirmed clear action separate from memory deletion.
- Lexically relevance-ranked memory retrieval for agent context, with recent-memory fallback.
- Gemini agent tool/function calling with argument validation and multi-round execution.
- Ordered model fallback and categorized provider diagnostics with credential redaction.
- JSON-backed one-time and timezone-aware recurring reminder creation, listing, cancellation, due execution, bounded retries, foreground polling, and best-effort WorkManager notification delivery. In-chat delivery was manually verified; the debug worker trigger contacted the backend, but no pending reminder was available to verify an Android notification.
- Validated email draft preparation with user-initiated handoff to a compatible email app. Agent-side Gmail sending is disabled because a server-verified approval flow bound to the exact message is not implemented.
- Read-only Gmail inbox search tool using Gmail search syntax, Inbox label filtering, metadata-only message fetches, and a 20-result cap. Google API behavior is covered by mocked tests; the user also manually verified a live search returned results.
- Gmail OAuth authorization requests only `gmail.readonly`; stored scope metadata is checked before inbox search. Reauthorize through `/api/gmail/auth` if search is unavailable after a scope change.
- Read-only retrieval of explicitly provided public webpages with bounded text extraction and optional search; batch reads support up to three distinct, user-provided URLs per request.
- One-time and recurring scheduled public-webpage summaries for exact URLs supplied by the user; page retrieval and Gemini summarization run at the scheduled time and deliver results through reminders.
- Controlled Android browser with HTTP(S) navigation, page history, scrolling, and bounded visible-text extraction.
- Per-request agent latency and process PSS diagnostics, plus persisted scheduler delay measurements.
- Build-configurable Android backend origins; release builds require HTTPS and disable cleartext traffic.
- Backend security middleware, request-size and rate limits, input validation, and placeholder environment template.
- Debug APK build and backend/Android unit-test commands.

## Partially completed

- **Scheduled tasks:** one-time and recurring reminders and read-only public-webpage summaries are supported. WorkManager checks at startup and on its 15-minute minimum periodic interval, constrained by network access and Android battery policies. In-chat delivery was verified; the debug trigger reached the backend, but it found zero pending reminders, so system-notification posting remains unverified.
- **Gemini integration:** fallback and tool recovery are covered with mocks. Live chat responses were confirmed by the user; occasional model overload or incomplete final responses remain.
- **Voice input:** permission and error handling are implemented and unit-tested. Live speech-to-text was verified on the emulator, where recognized text appeared in chat.
- **Android runtime:** latest verification passed 15 Android unit tests and 13 emulator instrumentation tests; the debug APK built and installed successfully. The user also confirmed chat-history and memory persistence after reopening. This is not full interactive testing.
- **Performance analysis:** Android request latency and PSS plus backend scheduler delay are surfaced. A reproducible mock baseline is available; live Gemini and physical-device benchmarks remain uncollected.
- **Documentation:** README, architecture, assignment status, and interview notes are present.
- **Web browsing:** the agent can read one explicitly provided URL, batches of up to three explicitly provided URLs, and (when requested) at most two static links on the same origin as an explicitly provided seed URL. Retrieval is bounded and read-only. The in-app browser remains user-controlled. The agent cannot click controls, submit forms, or authenticate.
- **Gmail:** read-only Inbox search is implemented and covered by mocked Google API tests. The user manually confirmed OAuth connection, `/api/gmail/status`, and a live search that returned results. Search returns sender, subject, date, and Gmail snippet only; it does not fetch message bodies. Agent-side sending is deliberately disabled.
- **Gmail live validation:** the user confirmed live OAuth connection and inbox search; these manual checks are distinct from mocked automated tests. Agent-side email sending is disabled, not merely unverified.
- **Scheduled workflow scope:** webpage summaries are supported only for explicit public URLs; email checks and other arbitrary actions are not implemented.
- **Tool failure correlation:** same-round same-name calls are kept distinct and ambiguous multi-failure retries remain failures. A single failure followed by a same-name call in the next round can be inferred as a correction when arguments change; this is necessarily heuristic.

## Not implemented

- Gmail-backed scheduled email checks and email delete/archive actions.
- Agent-side email sending is disabled. The `send_email` tool and `/api/actions/approve` fail closed; Gmail's send API method and `gmail.send` OAuth scope have been removed.
- Agent-driven browser automation, authentication, and page actions such as clicking or submitting forms.
- Gmail/OAuth-backed scheduled email checks or other arbitrary scheduled actions.
- Production backend authentication and deployment.
- Screenshots are pending; none are included yet.

## Verification results

| Check | Result |
|---|---|
| `node --check` for backend source/tests | Passed. |
| `npm --prefix backend test` | Latest run passed: 71 tests, 0 failures. Gmail search, OAuth scope handling, and agent tool flow use mocked Google/Gemini APIs; browser and scheduler tests use mocks or isolated storage. |
| Agent tool-failure handling | Mock tests pass for handler failure, exception, corrected retry, same-round same-name calls, multiple unresolved failures, multi-tool history, model fallback and redaction. |
| Email draft handling | Mock tests pass for validated draft display, explicit not-sent messaging, and malformed recipient rejection. |
| Public webpage retrieval | Tests cover URL/IP restrictions, redirect validation, text extraction, search, explicit URL and link-navigation intent checks, batches of up to three pages, same-origin linked-page reads, cross-origin redirect rejection, and no follow-up tool round. A live agent-tool smoke test successfully read and searched `https://example.com` using mock Gemini responses. |
| Scheduler behavior | Isolated tests pass for validation, create/list/cancel, persistence across reload, durable reminder results, acknowledgement, retry limit, repeated execution check, and due-to-execution delay recording. |
| Recurring scheduler behavior | Isolated tests pass for five-field cron validation, minimum interval, IANA timezone, persistence, next-run advancement, reminder acknowledgement, and cancellation. |
| Scheduled webpage summaries | Mock tests pass for page retrieval followed by tool-free summarization, retrieval failure handling, explicit-URL enforcement, workflow validation, one-time and recurring execution, result/source delivery, and acknowledgement. |
| Android background reminders | In-chat delivery was manually verified. The DEBUG-only WorkManager trigger started the existing worker and contacted the backend, but it found zero pending reminders; Android system-notification posting and Doze-mode delivery remain unverified. Background delivery remains best-effort. |
| Memory retrieval | Unit tests verify relevance ranking, recent-memory fallback, and result limits. |
| Conversation history and local memory | Room persistence and reopen behavior are covered by instrumentation tests; the user also manually verified chat history and a saved memory persisted after reopening. |
| Browser URL policy | Unit tests verify HTTPS normalization and reject non-web schemes and embedded credentials. |
| Android browser | `compileDebugAndroidTestKotlin` and APK build pass; interactive WebView behavior was not tested on a device. |
| Performance diagnostics and benchmark | `npm --prefix backend run benchmark` passed (20 mock iterations): agent response p50/p95 0.40/4.74 ms; scheduled workflow p50/p95 11.44/21.03 ms; RSS/heap delta +2.46/+1.28 MiB on Windows x64 / Node 22.17.1. Mock values exclude live Gemini/network and Android device memory. |
| `GET /health` | Returned success once with backend running. |
| Malformed JSON request | Returned JSON error with HTTP 400. |
| Direct live `POST /api/agent` smoke test | Not separately performed. The user confirmed AI responses through the Android app. |
| `.\gradlew.bat testDebugUnitTest assembleDebug compileDebugAndroidTestKotlin connectedDebugAndroidTest` | Passed: 15 Android unit tests and 13 emulator instrumentation tests; debug APK built and installed successfully. |
| Android API environment configuration | Debug custom HTTP URL generated successfully; release APK built with HTTPS configuration; release cleartext traffic disabled and HTTP release URL rejected. |
| User-confirmed manual emulator checks | Live Gemini chat works, with occasional model overload or incomplete final responses; chat history and local memory persisted after reopening; speech-to-text returned recognized text; Gmail OAuth and read-only search worked; reminder scheduling and in-chat delivery worked. These are manual checks, not all automated. |
| DEBUG WorkManager trigger | Started the existing worker and reached the backend. The backend returned zero pending reminders, so this did not verify system notification posting. The trigger is absent from the release manifest. |
| Debug APK | Built and installed successfully at `app/build/outputs/apk/debug/app-debug.apk`. |

## User-confirmed manual verification

- The Android app was installed and launched on the emulator; the user confirmed AI responses worked.
- Live Gemini chat occasionally experienced model overload or an incomplete final response.
- Chat history was present after closing and reopening the app.
- A locally saved memory appeared in the app and persisted after reopening.
- Live speech-to-text returned recognized text in the chat.
- Gmail OAuth connected, `/api/gmail/status` confirmed connection, and a live read-only inbox search returned results. Results contain sender, subject, date, and snippet.
- Reminder scheduling and in-chat delivery worked. The DEBUG WorkManager trigger started the worker and contacted the backend, but there were zero pending reminders, so no system notification was verified.

These manual checks are separate from automated tests. Automated Gmail API tests use mocks and do not make real Gmail requests. The 13 passing emulator instrumentation tests do not constitute full interactive app testing or live system-notification verification.

## Known limitations and risks

- Scheduled task actions are limited to durable reminders and read-only summaries of an explicitly provided public webpage; Android notifications are best-effort and may be delayed by OS policy.
- Recurrence is limited to reminders and webpage summaries and at least five minutes apart. It does not run email checks or arbitrary actions, and the backend process must be alive at execution time.
- Reminder delivery requires the backend to be running and reachable. Background delivery also requires notification permission and is subject to Android scheduling and battery policies.
- System notification posting has not been verified: the debug worker reached the backend but found no pending reminder to deliver. Background reminder delivery remains best-effort, not exact-time.
- Speech recognition depends on device service availability, network, locale, and device configuration. Live speech-to-text was verified on the emulator; behavior on other devices is not verified.
- The backend has no authentication. Debug permits cleartext HTTP for development; release builds enforce HTTPS but still require a deployed, authenticated backend.
- Chat history is stored locally with the existing Room database and can be cleared separately from saved memories; it is not synchronized to the backend.
- Live Gemini response behavior was confirmed by the user through the Android app; a separate direct backend endpoint smoke test was not performed.
- Gemini can occasionally report model overload or return an incomplete final response.
- Tool retry correlation cannot perfectly distinguish a corrected call from a new same-name operation when arguments change; ambiguous failures are handled conservatively.
- Email drafts are not persisted. Users can review and send drafts through an installed email app; the agent itself cannot send messages.
- Existing Google OAuth grants are not revoked by this code change. Revoke a previous Gmail send grant from the Google Account security settings if you want to remove that old consent.
- Gmail OAuth tokens are stored in a local JSON file ignored by Git; encrypted token storage is not implemented. Do not expose or commit the token file, `.env`, or credentials.
- Backend webpage retrieval requires exact user-provided URLs for direct reads. Link navigation is only allowed on explicit request, only for static same-origin links, and is limited to two related pages; the in-app browser allows user-controlled HTTP(S) navigation. Neither flow supports agent-driven page actions or authentication.
- Browser URL policy tests cover HTTPS normalization and blocking non-web schemes and embedded credentials. Device-level WebView behavior remains untested.
- The local benchmark uses mocked model responses and excludes real provider/network latency; live Gemini latency and target-device PSS measurements remain to be collected.

## Recommended next steps

1. Verify Android system notification posting using a real pending reminder and the DEBUG WorkManager trigger; do not treat the zero-pending diagnostic as a delivery test.
2. Capture actual chat and memory screenshots if they are to be included; screenshots remain pending.
3. Keep the best-effort background scheduling, occasional Gemini response issues, unsupported actions, and missing production authentication/encrypted token storage visible in the submission.
