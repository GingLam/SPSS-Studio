# Unified SPSS Studio and SPSS AI Implementation Plan

Design source: `docs/superpowers/specs/2026-10-01-unified-studio-ai-design.md`

Target release: 0.6.0

Execution policy: test-first, local Conventional Commits only, no GitHub push or Marketplace publication without a separate explicit request.

## 1. Record the baseline and add failing architectural contracts

Files:

- update `test/unit/studioUi.test.ts`;
- update `test/unit/aiUi.test.ts`;
- update `test/unit/manifestContributions.test.ts`;
- update `test/suite/spssStudio.extension.test.ts` only for assertions that describe the approved final architecture.

Steps:

1. Run the current focused UI, manifest, AI, and fake Extension Host suites and record the passing baseline.
2. Add failing tests requiring the Studio shell to declare four tabs in this order: Output, Data, Variables, SPSS AI.
3. Add failing manifest tests requiring the absence of `spssStudioAi`, `spssStudio.aiView`, `onView:spssStudio.aiView`, the AI view-title menu, `spssStudio.showVariablePicker`, and `spssStudio.aiAutoReveal`.
4. Add failing tests requiring `spssStudio.showAi` and `spssStudio.configureAi` to remain available as commands even though no separate AI View exists.
5. Add failing UI contracts requiring the Variables Name cell to emit one double-click insertion action and prohibiting insertion listeners on other columns.
6. Add a failing source contract proving only one Webview script path calls `acquireVsCodeApi()`.
7. Add failing engine-command contracts requiring Start, Restart, and Show Status not to call `OutputChannel.show()`.
8. Run only these tests and retain the expected failures before implementation.

Expected commit after the corresponding behavior turns green:

```text
test: define the unified SPSS Studio layout
```

## 2. Add a strict scoped shell protocol

Files:

- add `src/views/studioShellProtocol.ts`;
- update `src/views/webviewProtocol.ts`;
- update `src/views/aiWebviewProtocol.ts`;
- add `test/unit/studioShellProtocol.test.ts`;
- update `test/unit/studioUi.test.ts` and `test/unit/aiUi.test.ts`.

Steps:

1. Write failing tests for the three allowed message scopes: `shell`, `studio`, and `ai`.
2. Define one shell-ready message and scoped envelopes for existing Studio and AI actions.
3. Reuse the existing Studio and AI payload validators behind the scope router rather than duplicating validation rules.
4. Reject unknown scopes and types, inherited objects, arrays, malformed nested payloads, negative or oversized page values, and oversized AI strings.
5. Add scoped Extension-to-Webview message types so the browser-side shell can route state without interpreting feature payloads.
6. Keep the existing AI profile, question, code, title, splitter, and id bounds unchanged.
7. Run the protocol suites and TypeScript compilation.

Expected commit:

```text
refactor: add scoped Studio Webview messaging
```

## 3. Extract a host-independent AI panel controller

Files:

- add `src/views/spssAiPanelController.ts`;
- reduce `src/views/spssAiViewProvider.ts` temporarily to an adapter or remove it only when the combined host is ready in step 5;
- reuse `src/ai/aiSessionController.ts`, `src/ai/aiStrings.ts`, `src/ai/fencedCode.ts`, and provider stores without schema changes;
- add `test/unit/spssAiPanelController.test.ts`;
- update `test/unit/aiUi.test.ts`.

Steps:

1. Define a narrow host port for posting scoped AI messages, editor insertion, clipboard writing, external-link opening, confirmations, workspace trust, and UI-state persistence.
2. Write failing tests for ready, complete render state, pending internal page, streaming start/delta/completion, cancellation, request failure, profile mutations, history mutations, code insertion, copy, and provider documentation.
3. Move message handling and render-state conversion out of `SpssAiViewProvider` into `SpssAiPanelController`.
4. Keep `AiSessionController` unchanged unless a test exposes a real host-independence defect.
5. Ensure AI initialization failure posts an AI-scoped error and does not throw through the Studio host.
6. Make attach/detach safe: posts after panel disposal become no-ops, while an in-flight request and its controller state continue safely.
7. Preserve the existing storage keys, conversation location, API-key isolation, trust checks, and localization selection.
8. Run controller, AI core, history, profile, localization, and client suites.

Expected commits:

```text
test: define embedded AI controller behavior
refactor: decouple SPSS AI from its panel view
```

## 4. Convert the AI browser code into an embeddable module

Files:

- replace standalone behavior in `media/ai.js` with `media/studioAi.js` or an equivalently named factory module;
- scope and update `media/ai.css`;
- update `test/unit/aiUi.test.ts`;
- update package-policy tests only if an exact runtime asset assertion exists.

Steps:

1. Add failing static contracts proving the AI module never calls `acquireVsCodeApi()` and accepts a host bridge plus `#ai-view` root.
2. Move all element lookup below the provided AI root so duplicate ids or selectors outside the module cannot be read.
3. Preserve Current Chat, Chat History, Manage Models, model selector, New Chat, splitter, composer, streaming, Stop, role styling, SPSS highlighting, Insert, and Copy.
4. Prefix or root-scope AI CSS selectors. Remove standalone `body`, generic `.page`, generic `.tabs`, generic `button`, and other rules that could alter Studio tabs.
5. Preserve inert rendering: user and model text use `textContent`; no Markdown renderer, `eval`, `innerHTML`, `outerHTML`, or `insertAdjacentHTML` is introduced in the AI module.
6. Let the module receive scoped Extension messages and return scoped AI actions through the shared bridge.
7. Make repeated initialization and complete render snapshots idempotent so panel recreation does not duplicate handlers or messages.
8. Run focused AI UI and security contracts.

Expected commit:

```text
refactor: make the SPSS AI view embeddable
```

## 5. Build the four-tab Studio shell and integrate AI

Files:

- update `src/views/spssStudioPanel.ts`;
- optionally add `src/views/spssStudioHtml.ts` to keep lifecycle and markup separate;
- update `media/studio.js`;
- update `media/studio.css`;
- load scoped `media/ai.css` and the AI browser module from the combined shell;
- update `test/unit/studioUi.test.ts` and `test/unit/aiUi.test.ts`.

Steps:

1. Add `ai` to the `StudioTab` state and render `SPSS AI` after Variables.
2. Add a single `#ai-view` containing the approved compact AI markup below the top-level Studio toolbar.
3. Keep `studio.js` as the only caller of `acquireVsCodeApi()` and construct a shared bridge for the Studio and AI modules.
4. Install all message listeners before posting the shell-ready handshake.
5. Route scoped browser actions through the strict shell validator to either the Studio handler or `SpssAiPanelController`.
6. Route scoped host messages to the correct browser module without parsing unrelated payloads.
7. Add `showAi('chat')` and `showAi('profiles')` host methods. Both reveal `ViewColumn.Beside`; the second also selects internal model management.
8. On direct AI-tab selection, request an authoritative AI render state if necessary.
9. Preserve Output selection and HTML rendering, Data lazy horizontal paging, Variables paging, output-history width, and engine-state display.
10. Preserve AI generation while another top-level tab is visible and restore Stop/current-stream state when returning.
11. Retain `connect-src 'none'`. Keep the current sanitized-output allowance for inline IBM presentation styles without permitting AI HTML rendering or executable scripts.
12. Run Studio UI, AI UI, protocol, sanitizer, viewport, and controller suites.

Expected commits:

```text
test: define the four-tab Studio shell
feat: embed SPSS AI in SPSS Studio
```

## 6. Move variable insertion to the Variables Name column

Files:

- update `media/studio.js`;
- update `media/studio.css`;
- update `src/views/spssStudioPanel.ts`;
- update `src/views/studioShellProtocol.ts` or the Studio payload protocol;
- update `src/commands/variableCommands.ts` to expose only validated cached-variable insertion;
- update `test/unit/studioUi.test.ts`;
- update `test/suite/spssStudio.extension.test.ts`.

Steps:

1. Write a failing pure test for accepting an exact current-cache variable and rejecting an absent, stale, empty, or non-string name.
2. Render the Name cell as the only cell with a variable-name class and the exact cached name in controlled state.
3. Add a `dblclick` listener only to that Name cell. Single-click remains inert.
4. Use `document.documentElement.lang` to choose `Double-click to insert <name>` or `双击插入 <name>` for the tooltip.
5. Send a scoped `insertVariable` action containing only the variable name.
6. Validate the name against the current `VariableCache` in the Extension Host before calling `SpssEditorTargetTracker.insert`.
7. Preserve the exact dictionary casing, replace the tracked selection, restore editor focus, and produce one undoable edit.
8. Warn without editing if the cache changed or no `.sps` target exists.
9. Add Extension Host coverage for valid insertion, Undo, forged-name rejection, and non-SPSS target rejection.
10. Visually distinguish Name cells with cursor and hover treatment without making other cells look editable.

Expected commits:

```text
test: define Variables double-click insertion
feat: insert cached variables from the Variables view
```

## 7. Remove obsolete variable and bottom-panel surfaces

Files:

- update `src/extension.ts`;
- remove `src/language/variableInlayProvider.ts` and `src/language/variableInlayModel.ts` after all callers are gone;
- remove `test/unit/variableInlayModel.test.ts` and replace its relevant insertion boundary with the tests from step 6;
- remove the picker function and dead types from `src/commands/variableCommands.ts`;
- remove `src/views/spssAiViewProvider.ts` after `SpssAiPanelController` is the only AI host;
- update `package.json`, `package.nls.json`, and `package.nls.zh-cn.json`;
- update `test/unit/manifestContributions.test.ts` and `test/suite/spssStudio.extension.test.ts`.

Steps:

1. Remove the Inlay Hint provider construction, registration, disposal, and model imports.
2. Remove `spssStudio.showVariablePicker` from activation events, command contributions, registration, tests, and documentation references.
3. Remove the `spssStudioAi` View Container, `spssStudio.aiView`, its activation event, and its view-title menu.
4. Remove `spssStudio.aiAutoReveal` and all editor-change auto-reveal logic.
5. Keep `spssStudio.showAi` and `spssStudio.configureAi`, but route both to the combined Studio panel.
6. Remove files and localization keys that have no remaining runtime or test caller. Use Git-tracked deletion only; do not delete user data or ignored runtime storage.
7. Compile and use `rg` to prove no obsolete ids, commands, setting names, provider registration, or inlay registration remain.
8. Run manifest, localization, UI, and Extension Host suites.

Expected commit:

```text
refactor: remove standalone AI and variable picker surfaces
```

## 8. Stop automatic bottom-panel reveal and preserve diagnostics

Files:

- update `src/commands/engineCommands.ts`;
- update or add `test/unit/engineCommands.test.ts`;
- update `test/suite/spssStudio.extension.test.ts` where status behavior is observable.

Steps:

1. Write failing tests proving Start, Restart, and Show Status never call `OutputChannel.show()`.
2. Keep every existing diagnostic `appendLine` call and the `SPSS` OutputChannel registration.
3. Keep error notifications for failed start and restart operations.
4. Change Show Status to append the complete existing diagnostic block and display one `showInformationMessage` containing engine state, detected SPSS version, and last error.
5. Ensure status-bar clicks call the revised status command without revealing the bottom panel.
6. Confirm ordinary runs, data refresh, metadata refresh, and bridge warnings never call `show()` indirectly.
7. Run engine-command, bridge, session, and fake Extension Host suites.

Expected commit:

```text
fix: keep SPSS diagnostics in the background
```

## 9. Integrate activation, disposal, and command routing

Files:

- update `src/extension.ts`;
- update `src/studioSession.ts` only if the panel's AI methods require a typed façade;
- update `src/views/spssStudioPanel.ts`;
- update `test/suite/spssStudio.extension.test.ts`;
- update `test/suite/realSpss.extension.test.ts` only for stable observable behavior.

Steps:

1. Construct `SpssEditorTargetTracker` before the combined panel so both AI and Variables share the same target safely.
2. Construct stores, legacy migration, `AiSessionController`, and `SpssAiPanelController` with the existing keys and paths.
3. Inject the AI controller and validated variable-insertion callback into `SpssStudioPanel`.
4. Attach the AI post transport when the panel is created and detach it when disposed without disposing the session controller prematurely.
5. Dispose the AI controller exactly once during extension deactivation.
6. Route Show AI Assistant to `showAi('chat')` and Manage AI Model Profiles to `showAi('profiles')`.
7. Preserve Run/Run All to Output and the existing Show Output/Data/Variables routes.
8. Verify opening an `.sps` file alone creates no Webview and changes no layout.
9. Verify reopening the Studio after disposal restores Output metadata, dataset metadata, engine state, AI profile state, and current/history conversation state.
10. Run the complete fake Extension Host suite and, when the installed macOS SPSS 27 runtime is available, the real integration suite.

Expected commit:

```text
feat: integrate the unified SPSS Studio workspace
```

## 10. Update documentation and release metadata

Files:

- update `README.md`;
- update `docs/ARCHITECTURE.md`;
- update `docs/TROUBLESHOOTING.md`;
- update `CHANGELOG.md`;
- update `package.json` and `package-lock.json` to 0.6.0.

Steps:

1. Replace standalone bottom-panel SPSS AI instructions with the fourth Studio tab.
2. Document the exact command-to-tab behavior and the fact that opening `.sps` alone does not open Studio.
3. Replace first-line variable-strip, `More Variables…`, and variable-picker instructions with Variables Name-cell double-click insertion.
4. Explain that the native bottom panel remains part of VS Code but the plugin neither contributes SPSS AI to it nor reveals it automatically.
5. Retain the current privacy description for SecretStorage, global history, request boundaries, and VSIX exclusions.
6. Add migration guidance stating that existing profiles, API keys, and conversations remain available without reconfiguration.
7. Record the architectural change and behavior removals under 0.6.0 in CHANGELOG.
8. Bump version only after all behavior and integration tests pass.

Expected commits:

```text
docs: document the unified Studio workspace
chore: release SPSS Studio 0.6.0
```

## 11. Full verification and release candidate

Automated commands:

```text
npm run check:grammar
npm run compile
npm run lint
npm run test:unit
npm run test:python
npm run test:extension
npm run test:extension:real
npm run package
```

Verification order:

1. Run focused tests after every red-green-refactor cycle.
2. Run `npm run verify` after integration.
3. Run the fake Extension Host suite in a clean extension-development host.
4. Run the real SPSS suite only against the installed local runtime; do not fabricate success if SPSS or the test host is unavailable.
5. Open a representative `.sps` file and confirm no automatic Studio or bottom-panel reveal.
6. Exercise Run, Data, Variables, Show AI, Manage Models, model switching, streaming, Stop, history reopen, code Copy, AI code Insert, Variables double-click Insert, and Undo.
7. Inspect the left/right layout at laptop dimensions in both light and dark themes.
8. Confirm the AI tab retains its internal layout and that CSS changes do not alter Output, Data, or Variables.
9. Build `dist/spss-studio-0.6.0.vsix` through the hardened package script.
10. Enumerate the archive independently and confirm the manifest has no standalone AI View contribution.
11. Confirm the VSIX contains no API keys, stored conversations, global-storage data, project data, tests, `.work`, source maps, Git data, design documents, or implementation plans.
12. Record the VSIX absolute path, byte size, and SHA-256.
13. Keep every production commit and the VSIX local until the user separately authorizes a GitHub push or Marketplace publication.

## Regression boundaries

The following behavior must remain unchanged unless this plan explicitly changes it:

- SPSS syntax highlighting and context-sensitive completion;
- Undo, Run Selection / Current Command, and Run File;
- persistent SPSS process lifecycle and serialized requests;
- OMS HTML output ordering, sanitization, export, and print;
- Data row paging and continuous horizontal variable scrolling;
- Variables Name, Label, Type, Format, and Measure values and paging;
- Active Dataset metadata refresh after successful and failed syntax;
- Workspace Trust enforcement;
- model-profile storage, legacy migration, SecretStorage isolation, and provider URL policy;
- global conversation history, limits, recovery, and request-context bounds;
- AI code Copy/Insert without automatic save or execution;
- macOS and Windows SPSS discovery; and
- the production-only VSIX allowlist.

## Expected execution characteristics

- Expected implementation and verification time on the current machine: approximately 2–4 hours.
- Expected tool usage: more than 20 calls because the change crosses manifest, Extension Host, two Webview modules, tests, visual QA, and packaging.
- Main risks: calling `acquireVsCodeApi()` twice, CSS leakage between modules, a panel-disposal race during streaming, stale variable insertion after dataset replacement, command routing that opens the wrong tab, CSP regression caused by combining sanitized SPSS output with inert AI content, and old manifest contributions surviving packaging.
- A subagent is optional only for an independent post-implementation test or diff audit. Core editing should remain in one agent because the protocol, host, and Webview changes are tightly coupled. No subagent may be used without explicit user authorization.

## Planned production commit sequence

1. `test: define the unified SPSS Studio layout`
2. `refactor: add scoped Studio Webview messaging`
3. `test: define embedded AI controller behavior`
4. `refactor: decouple SPSS AI from its panel view`
5. `refactor: make the SPSS AI view embeddable`
6. `test: define the four-tab Studio shell`
7. `feat: embed SPSS AI in SPSS Studio`
8. `test: define Variables double-click insertion`
9. `feat: insert cached variables from the Variables view`
10. `refactor: remove standalone AI and variable picker surfaces`
11. `fix: keep SPSS diagnostics in the background`
12. `feat: integrate the unified SPSS Studio workspace`
13. `docs: document the unified Studio workspace`
14. `chore: release SPSS Studio 0.6.0`

The design and plan commits remain local. Product implementation begins only after explicit plan approval and selection of the execution mode.
