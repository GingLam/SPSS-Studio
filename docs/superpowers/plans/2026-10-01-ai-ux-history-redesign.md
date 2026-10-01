# SPSS AI Multi-Profile and Persistent History Implementation Plan

Design source: `docs/superpowers/specs/2026-10-01-ai-ux-history-redesign.md`

Target release: 0.5.0

Execution policy: test-first, local commits only, no GitHub push without a separate explicit request.

## 1. Establish the packaging boundary before adding runtime state

Files:

- modify `.gitignore`;
- replace `.vscodeignore` with a production allowlist strategy;
- add `tools/packagePolicy.mjs`;
- update `tools/package.mjs`;
- add `test/unit/packagePolicy.test.ts`;
- update development-only package dependencies only if a cross-platform VSIX reader is required.

Steps:

1. Add failing tests that classify required production paths as allowed and reject `.superpowers`, `.work`, `.git`, `src`, `test`, `tools`, `dist`, logs, source maps, cache files, local history names, and secret export names.
2. Add `.superpowers/` to `.gitignore` so browser mockups cannot be staged accidentally.
3. Implement one central allowlist policy used by both pre-package and post-package checks.
4. Before calling `vsce package`, obtain the planned package file list and fail on any unexpected path.
5. After creating the VSIX, enumerate the archive with a cross-platform Node implementation and apply the same policy.
6. Keep the generated VSIX under ignored `dist/`; never add it to Git.
7. Run the focused policy test and a real package build.

Expected commit:

```text
build: enforce a production-only VSIX allowlist
```

## 2. Introduce versioned model profiles

Files:

- add `src/ai/modelProfile.ts`;
- add `src/ai/modelProfileStore.ts`;
- retain or reduce `src/ai/providerConfigurationStore.ts` to a migration adapter until migration is complete;
- update `src/ai/providerPresets.ts` only where profile validation requires it;
- add `test/unit/modelProfileStore.test.ts`;
- extend provider validation tests.

Steps:

1. Write failing tests for empty state, automatic names, explicit names, create, edit, duplicate, select, delete, and list ordering.
2. Write failing tests proving two profiles for one provider can hold independent secrets.
3. Define a versioned profile index and bounded field validation.
4. Store profile metadata in `globalState` and secrets in `SecretStorage` using the profile id.
5. Ensure every returned UI object contains only `hasApiKey`, never the secret.
6. Make Duplicate copy the secret into a new secret key inside the extension host.
7. Prevent deletion of the active profile during an in-flight request through the controller boundary added later; the store itself remains deterministic and request-agnostic.
8. Run the focused tests and the existing provider/client suite.

Expected commits:

```text
test: define AI model profile behavior
feat: add versioned AI model profiles
```

## 3. Add safe 0.4.0 profile migration

Files:

- add `src/ai/modelProfileMigration.ts`;
- update `src/ai/modelProfileStore.ts`;
- add migration cases to `test/unit/modelProfileStore.test.ts`.

Steps:

1. Write failing tests for metadata-only migration, metadata-plus-secret migration, no legacy configuration, invalid legacy configuration, partial failure, and repeat activation.
2. Read but do not mutate the legacy `spssStudio.ai.providerConfiguration` value until the new profile and secret are verified.
3. Copy the legacy provider secret to the profile-specific secret key.
4. Write the migration marker only after successful verification.
5. Leave legacy metadata and secrets intact in 0.5.0 for rollback safety.
6. Run migration tests with in-memory value and secret stores.

Expected commit:

```text
feat: migrate legacy AI provider configuration
```

## 4. Implement persistent conversation storage

Files:

- add `src/ai/conversation.ts`;
- add `src/ai/conversationStore.ts`;
- add `src/ai/conversationTitle.ts`;
- add `test/unit/conversationStore.test.ts`;
- add `test/unit/conversationTitle.test.ts`.

Steps:

1. Write failing tests for a missing store, valid restore, create/update, active conversation, rename, delete, clear, sort order, and empty-draft exclusion.
2. Write failing tests for local title generation from Chinese, English, whitespace-heavy, and very long first questions.
3. Write failing tests for the 100-conversation limit, 25 MiB global limit, 200-message per-conversation limit, and 512 KiB per-conversation content limit.
4. Verify pruning removes complete user/assistant pairs and records `truncated`.
5. Implement a file-system adapter so persistence logic is testable without VS Code.
6. Store one global history under `ExtensionContext.globalStorageUri`, independent of the current workspace or file.
7. Serialize writes through one promise queue.
8. Implement temporary write, parse validation, backup, and replacement.
9. Test valid-backup recovery and unrecoverable corruption without deleting corrupt evidence.
10. Confirm no API key or workspace/file path field exists in the persisted schema.

Expected commits:

```text
test: define persistent AI conversation behavior
feat: add local AI conversation history
```

## 5. Separate durable display history from request context

Files:

- update `src/ai/chatProtocol.ts`;
- update `src/ai/openAiCompatibleClient.ts` only if its input type changes;
- add or update tests in `test/unit/aiCore.test.ts` and `test/unit/aiConfigurationAndClient.test.ts`.

Steps:

1. Add tests showing that a long stored conversation remains available to the UI while the provider request contains at most 20 recent messages and 30,000 characters.
2. Preserve complete recent conversational turns where possible.
3. Include only `role` and `content` in the provider request; exclude ids, timestamps, profile snapshots, file context, and storage metadata.
4. Confirm the request body still contains only `model`, `messages`, and `stream`.
5. Run the local HTTP mock transport test.

Expected commit:

```text
refactor: separate AI history from request context
```

## 6. Add the AI session controller

Files:

- add `src/ai/aiSessionController.ts`;
- add `src/ai/aiRenderState.ts`;
- add `test/unit/aiSessionController.test.ts`.

Steps:

1. Define controller dependencies as interfaces for profile storage, conversation storage, model transport, and UI notifications.
2. Write failing tests for initialization, repeated initialization, active-profile selection, New Chat, reopening history, renaming, deleting, and clearing.
3. Write failing tests for continuing with the historical profile and switching only future messages to a different profile.
4. Write failing tests for a deleted historical profile: reading remains possible and sending is rejected until a valid profile is selected.
5. Write failing tests that profile switching and mutation are rejected while a request is active.
6. Implement streaming ownership with immutable resolved profile credentials and request ids.
7. Preserve earlier successful messages on timeout, cancellation, HTTP failure, malformed stream, or persistence failure.
8. Return one complete render state after initialization and every persistent mutation; keep response deltas incremental.
9. Ensure no render state contains API key material.

Expected commits:

```text
test: define AI session lifecycle
feat: add the AI session controller
```

## 7. Redesign and validate the Webview protocol

Files:

- replace the current message types in `src/views/aiWebviewProtocol.ts`;
- add protocol validation tests in `test/unit/aiUi.test.ts`;
- update relevant source-contract tests.

Steps:

1. Add `ready`, page navigation, profile CRUD, conversation CRUD, selection, splitter, New Chat, Stop, Insert, and Copy actions.
2. Add explicit maximum lengths for ids, names, Base URLs, models, questions, titles, and code payloads.
3. Reject unknown action types, prototype-bearing surprises, malformed nested objects, and out-of-range splitter values.
4. Define complete render-state and streaming response messages.
5. Test that an initialization snapshot contains only non-secret profile state.

Expected commit:

```text
refactor: define the SPSS AI workspace protocol
```

## 8. Add Chinese and English localization

Files:

- add `package.nls.json`;
- add `package.nls.zh-cn.json`;
- replace AI-related contribution strings in `package.json` with localization keys;
- add `src/ai/aiStrings.ts` or an equivalent typed resource module;
- add `test/unit/aiLocalization.test.ts`.

Steps:

1. Write a failing parity test requiring exactly the same resource keys in Chinese and English.
2. Add typed strings for tabs, buttons, fields, empty states, warnings, confirmations, validation messages, and errors.
3. Select Simplified Chinese for `zh-cn` and English for every other locale.
4. Keep Provider labels, model ids, URLs, SPSS syntax, and model output untouched.
5. Verify localized command and view contribution titles in an Extension Host test where feasible.

Expected commit:

```text
feat: localize the SPSS AI workspace
```

## 9. Build the three-page Webview

Files:

- update `src/views/spssAiViewProvider.ts`;
- optionally extract HTML construction to `src/views/spssAiViewHtml.ts` if the provider would otherwise mix lifecycle and markup;
- replace `media/ai.js`;
- replace `media/ai.css`;
- extend `test/unit/aiUi.test.ts`;
- add pure splitter tests if splitter calculations are extracted to a small module.

Steps:

1. Add the Current Chat, Chat History, and Model Profiles internal tabs.
2. Make the Webview post `ready` after all handlers are installed.
3. Render complete state snapshots idempotently; rerendering must not duplicate messages, profiles, or handlers.
4. Current Chat: add profile selector, New Chat, Model Profiles shortcut, transcript, accessible splitter, composer, Stop, Send, Insert, and Copy.
5. Chat History: add sorted full-width entries, open, rename, delete, and double-confirmed clear-all.
6. Model Profiles: add left profile list plus right form, New, Save, Duplicate, Rename, Delete, Make Active, key status, key replacement, and Official Documentation.
7. Keep all untrusted content in `textContent`; do not add a general Markdown or HTML renderer.
8. Apply distinct VS Code theme surfaces to transcript and composer without hard-coded light/dark colors.
9. Add pointer, keyboard, ARIA, double-click reset, clamping, and persistence for the horizontal splitter.
10. Add responsive layouts for narrow Panels and Views moved to a sidebar.
11. Ensure the form always receives fresh host state when opened.

Expected commits:

```text
test: define the redesigned SPSS AI view
feat: add SPSS AI profiles history and splitter
```

## 10. Integrate activation and commands

Files:

- update `src/extension.ts`;
- update `package.json` command, menu, and view contributions;
- update `test/unit/manifestContributions.test.ts`;
- update `test/suite/spssStudio.extension.test.ts`.

Steps:

1. Construct stores with `globalState`, `secrets`, and `globalStorageUri`.
2. Initialize migration and controller without starting SPSS.
3. Register the Webview provider and dispose request/controller resources safely.
4. Make `SPSS: Configure AI Provider` reveal the existing view, refresh state, and open Model Profiles.
5. Preserve the current AI auto-reveal preference.
6. Preserve Workspace Trust checks for outbound AI requests.
7. Do not add or hide any non-SPSS Panel containers.
8. Verify existing SPSS API and test identities remain unchanged.

Expected commit:

```text
feat: integrate the redesigned SPSS AI workspace
```

## 11. Documentation and release metadata

Files:

- update `README.md`;
- update `docs/ARCHITECTURE.md`;
- update `docs/TROUBLESHOOTING.md`;
- update `CHANGELOG.md`;
- update `package.json` and `package-lock.json` to 0.5.0.

Steps:

1. Replace the 0.4.0 memory-only and single-provider documentation.
2. Document internal tabs, model profiles, New Chat, persistent history, retention limits, plaintext-local history, no-sync behavior, and API payload exclusions.
3. Explain that API keys are not displayed after saving and how key replacement/deletion works.
4. Explain the difference between SPSS AI and VS Code built-in Panel tabs.
5. Document 0.4.0 migration and the fact that old memory-only conversations cannot be recovered.
6. Add troubleshooting for missing profiles, missing keys, corrupt history recovery, unsupported provider protocols, and untrusted workspaces.
7. Record the feature and security changes in CHANGELOG.
8. Bump the release version only after behavior and migration tests pass.

Expected commits:

```text
docs: document SPSS AI profiles and history
chore: release SPSS Studio 0.5.0
```

## 12. Full verification and release candidate

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

1. Run focused tests after each red-green-refactor cycle.
2. Run `npm run verify` after integration.
3. Run fake Extension Host tests.
4. Run real SPSS Extension Host tests on the available macOS installation.
5. Build the 0.5.0 VSIX through the hardened package script.
6. Enumerate the final archive independently and record its SHA-256.
7. Confirm that `.superpowers`, development docs, source, tests, tools, API keys, history filenames, local paths, and local conversations are absent.
8. Install the VSIX into a clean VS Code profile and perform the approved manual acceptance cases where automation cannot cover the UI.
9. Keep production commits local until the user explicitly authorizes a GitHub push.

## Regression boundaries

The following behavior must remain unchanged:

- `.sps` syntax highlighting and completion;
- Run Selection / Current Command and Run File;
- persistent SPSS process lifecycle;
- native OMS HTML output, export, and print;
- Data and Variables views;
- active-dataset variable inlay and insertion;
- Workspace Trust enforcement;
- CSP and untrusted-model-output handling;
- macOS and Windows SPSS discovery.

## Estimated execution characteristics

- Expected implementation time on the current machine: approximately 2–4 hours, dominated by UI state work, migration tests, packaging validation, and Extension Host verification.
- Expected tool usage: more than 20 calls.
- Main pitfalls: Webview lifecycle races, migration idempotency, Windows-safe atomic replacement, history corruption recovery, strict allowlists accidentally excluding required runtime files, and UI testing limitations inside the real VS Code Panel.

## Planned production commit sequence

1. `build: enforce a production-only VSIX allowlist`
2. `test: define AI model profile behavior`
3. `feat: add versioned AI model profiles`
4. `feat: migrate legacy AI provider configuration`
5. `test: define persistent AI conversation behavior`
6. `feat: add local AI conversation history`
7. `refactor: separate AI history from request context`
8. `test: define AI session lifecycle`
9. `feat: add the AI session controller`
10. `refactor: define the SPSS AI workspace protocol`
11. `feat: localize the SPSS AI workspace`
12. `test: define the redesigned SPSS AI view`
13. `feat: add SPSS AI profiles history and splitter`
14. `feat: integrate the redesigned SPSS AI workspace`
15. `docs: document SPSS AI profiles and history`
16. `chore: release SPSS Studio 0.5.0`

The design and plan commits stay on the local design branch. When implementation is complete, only production commits are eligible to be cherry-picked to `main` and pushed after explicit authorization.
