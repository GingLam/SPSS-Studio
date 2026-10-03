# SPSS Studio 0.9.0 Implementation Plan

**Design:** `docs/plans/2026-10-03-output-tables-variable-explore-design.md`  
**Target:** 0.9.0

## Phase 1: Structured Output Tables

1. Add a focused structured HTML parser for SPSS output under `src/ai/` without a browser DOM dependency.
2. Replace the regex table extraction in `src/ai/outputExplanation.ts` with a rowspan/colspan-aware grid normalizer.
3. Flatten multi-level column headers, propagate row-spanned stub labels, preserve captions/footnotes, and provide explicit fallbacks.
4. Remove the visible XML wrapper from Output Explain prompts.
5. Render user messages with the existing safe Markdown pipeline in `src/views/spssAiPanelController.ts` and `media/ai.js`.
6. Expand `test/unit/outputExplanation.test.ts`, `test/unit/markdown.test.ts`, and AI UI/controller tests.

## Phase 2: Variable Selection Actions

1. Extend `src/views/webviewProtocol.ts` with Copy, Insert-list, and Explore messages.
2. Extend `src/commands/variableCommands.ts` to validate, dataset-order, copy, and insert multiple variable names.
3. Add selection state, checkbox rendering, toolbar actions, stale-selection cleanup, and compact Explore help to `media/studio.js`, `media/studio.css`, and `src/views/spssStudioPanel.ts`.
4. Preserve existing double-click insertion.
5. Add protocol, command, and UI tests.

## Phase 3: Read-only Variable Profiles

1. Add profile request/response types to `src/spss/types.ts`.
2. Add `variableProfiles` transport methods to `src/spss/bridgeManager.ts`, `src/spss/engineService.ts`, and `src/studioSession.ts`.
3. Implement bounded, read-only summaries in `resources/bridge/spss_bridge.py`:
   - validate 1–20 unique variables;
   - extract metadata and value labels;
   - combine system/user missing handling;
   - produce categorical, continuous, and temporal profiles;
   - bound category/value-label payloads;
   - guarantee DataStep cleanup and dataset non-mutation.
4. Add Python bridge fixtures/tests and TypeScript bridge-manager tests.

## Phase 4: Explore Chat Context

1. Add a bounded Markdown Explore prompt builder under `src/ai/`.
2. Add request/context kinds and schema-v1 migration support to the conversation model/store.
3. Extend `src/ai/chatProtocol.ts` with concise Explore-specific instructions.
4. Extend `src/ai/aiSessionController.ts` and `src/views/spssAiPanelController.ts` to preserve Explore follow-up context and deterministically append the localized responsibility statement.
5. Connect Variables Explore to the current Chat without creating a new conversation.
6. Add prompt, context, disclaimer, migration, and controller tests.

## Phase 5: Documentation and Release

1. Update `README.md` and `CHANGELOG.md` for 0.9.0 behavior and privacy boundaries.
2. Update `package.json` and lockfile to 0.9.0.
3. Run compile, lint, TypeScript tests, Python tests, extension tests where available, and the complete `npm run verify` suite.
4. Package `dist/spss-studio-0.9.0.vsix`.
5. Inspect the VSIX archive against the package policy and confirm no keys, profiles, histories, datasets, outputs, local paths, logs, or planning documents are present.
6. Report artifact size and SHA-256. Do not push without separate authorization.
