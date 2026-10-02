# SPSS Studio 0.8.0 Implementation Plan

Design source: `docs/superpowers/specs/2026-10-02-spss-studio-0.8.0-design.md`

Target release: 0.8.0

Execution policy: test-first; preserve user data and API-key secrecy; Conventional Commits; push the verified release commit to the existing GitHub repository; do not publish to the VS Code Marketplace.

## 1. Record the baseline and define release contracts

Files:

- update `test/unit/grammarScopes.test.ts`;
- update `test/unit/spssHighlighter.test.ts`;
- update `test/unit/grammarGenerator.test.ts`;
- update `test/unit/manifestContributions.test.ts`;
- update `test/unit/packagePolicy.test.ts`;
- add focused theme/taxonomy tests if a separate test file keeps responsibilities clearer.

Steps:

1. Record the clean Git state, Node/npm versions, current generated-artifact check, focused grammar/highlighter tests, and full `npm run verify` baseline.
2. Add failing contracts for the approved token taxonomy: control command, ordinary command, subcommand, structural keyword, function, format, ordinary/system/scratch/macro variables, string, number, missing value, arithmetic/relational/logical operators, comment, punctuation, and terminator.
3. Add a failing regression proving arithmetic division does not turn the following variable into a subcommand in the Chat tokenizer.
4. Add failing manifest/package-policy contracts for two contributed themes and their required packaged assets.
5. Add failing parity contracts requiring every generated editor token family to have a Chat family and Light/Dark presentation.
6. Run only the focused tests and retain the expected failures before production changes.

Expected commit after the behavior is implemented:

```text
test: define the SPSS highlighting system
```

## 2. Introduce one generated token taxonomy and palette

Files:

- update `syntax/spss-language.json` only where vocabulary grouping is genuinely missing;
- add a small canonical taxonomy/palette source under `syntax/`;
- update `tools/generate-grammar.mjs`;
- regenerate `syntaxes/spss.tmLanguage.json`;
- regenerate `media/spss-syntax-data.js`;
- regenerate `docs/SYNTAX-COVERAGE.md`;
- generate or add theme assets under `themes/`;
- update `tools/packagePolicy.mjs`.

Steps:

1. Define stable token-family ids shared by the generator, TextMate scopes, Chat tokenizer, tests, and theme assets.
2. Preserve the existing canonical command inventory and completion schema; do not create a second vocabulary list.
3. Split command scopes into control and ordinary/procedure commands without breaking forward-compatible generic commands.
4. Split structural keywords, missing constants, and the three operator families into distinct scopes.
5. Preserve block precedence for comments, strings, `BEGIN DATA`, embedded Python, GPL, MATRIX, macro definitions, and input blocks.
6. Produce complete Light/Dark palette entries with foreground, optional font style, and editor background references.
7. Add a contrast helper test and verify the approved minimum for every non-punctuation foreground.
8. Make `npm run check:grammar` fail when grammar, Chat data, coverage, or generated theme material is stale.
9. Extend the package allowlist narrowly for the final theme files only.

Expected commit:

```text
feat: generate the SPSS token taxonomy and palettes
```

## 3. Rebuild editor grammar coverage

Files:

- update `tools/generate-grammar.mjs`;
- regenerate `syntaxes/spss.tmLanguage.json`;
- expand `test/fixtures/syntax/all-features.sps`;
- update `test/unit/grammarScopes.test.ts`;
- update `test/unit/grammarGenerator.test.ts`.

Steps:

1. Write representative lines for each token family, mixed-case commands, Chinese comments, multiline commands, strings containing keyword-like text, and numeric edge cases.
2. Assert exact family scopes rather than merely asserting that a token received any scope.
3. Keep ordinary variables visually separate from functions and formats.
4. Preserve function fallbacks for future dotted functions and numeric modifiers such as `MEAN.3`.
5. Ensure slash subcommands require command/subcommand context and do not capture division.
6. Confirm unknown command-start identifiers and slash-prefixed options remain forward compatible.
7. Tokenize the complete fixture with state carried between lines and assert that every required family is observed.
8. Run grammar generation, check mode, and focused TextMate tests.

Expected commit:

```text
feat: deepen SPSS editor syntax classification
```

## 4. Add the optional SPSS Studio Light and Dark themes

Files:

- add generated or maintained files under `themes/`;
- update `package.json` theme contributions;
- update `test/unit/manifestContributions.test.ts`;
- update theme/taxonomy tests;
- update `tools/packagePolicy.mjs` and its tests.

Steps:

1. Contribute `SPSS Studio Light` with `uiTheme: vs` and `SPSS Studio Dark` with `uiTheme: vs-dark`.
2. Add explicit TextMate selectors for every SPSS token family and restrained defaults for ordinary editor text.
3. Use a limited mature-language hierarchy: strongest structural/control emphasis, strong procedure commands, distinct subcommands and functions, quiet variables/punctuation, italic de-emphasized comments, and special styles for system/scratch/macro identifiers.
4. Avoid changing the user's active theme during activation, update, or file opening.
5. Confirm both themes appear in the normal VS Code Color Theme picker through manifest tests.
6. Verify that the VSIX allowlist contains the two theme assets and no unrelated theme-development files.

Expected commit:

```text
feat: add SPSS Studio light and dark themes
```

## 5. Make Chat syntax rendering use the same taxonomy and palette

Files:

- update `media/spss-highlighter.js`;
- update `media/ai.js`;
- update `media/ai.css`;
- update `src/views/spssAiPanelController.ts` or Studio render state only if the active theme name must be transmitted;
- update `test/unit/spssHighlighter.test.ts`;
- update `test/unit/aiUi.test.ts`;
- update `test/unit/studioUi.test.ts` where Studio shell delivery is involved.

Steps:

1. Replace ad hoc Chat token names with the canonical family ids.
2. Correct slash handling so only actual subcommand syntax enters the subcommand state.
3. Render SPSS fenced blocks from text nodes and typed spans only; preserve the existing no-model-HTML security boundary.
4. Detect whether either bundled theme is active without changing the theme setting.
5. Under a bundled theme, apply the exact generated palette and font styles used by the editor.
6. Under other themes, apply the compatible light/dark fallback while preserving taxonomy parity.
7. Preserve high-contrast Insert and Copy controls, horizontal code scrolling, code selection, and non-SPSS fenced blocks.
8. Run full vocabulary parity plus representative multiline-code tests.

Expected commit:

```text
feat: unify editor and Chat SPSS highlighting
```

## 6. Version model profiles and migrate reasoning state safely

Files:

- update `src/ai/modelProfile.ts`;
- update `src/ai/modelProfileStore.ts`;
- update `src/ai/modelProfileMigration.ts`;
- update `test/unit/modelProfileStore.test.ts`;
- update migration-related cases in `test/unit/aiConfigurationAndClient.test.ts` if applicable.

Steps:

1. Add failing tests for `reasoningEnabled: false` on newly created profiles and explicit true/false persistence on updates and duplicates.
2. Advance the schema version and parse both the supported previous schema and the new schema through an explicit migration path.
3. Preserve profile ids, names, provider settings, timestamps, active selection, and profile-specific SecretStorage keys.
4. Default every migrated profile to reasoning disabled.
5. Keep UI-facing profile state secret-free.
6. Make migration idempotent and verify the newly stored index before recording completion.
7. After a legacy single-provider key has been copied and verified under its profile-specific key, delete only that exact legacy SecretStorage entry.
8. Test destination-write failure, destination-readback failure, delete failure, repeated activation, missing legacy state, and corrupt legacy state without logging secret material.

Expected commits:

```text
test: define profile reasoning migration
feat: add per-profile reasoning settings
fix: remove verified legacy AI key copies
```

## 7. Add strict provider-native reasoning requests

Files:

- update `src/ai/providerPresets.ts` with typed reasoning capability metadata;
- update `src/ai/chatProtocol.ts`;
- update `src/ai/openAiCompatibleClient.ts`;
- update `test/unit/aiConfigurationAndClient.test.ts`;
- update `test/unit/aiCore.test.ts`;
- update `test/unit/sseParser.test.ts` only if new final-content cases require it.

Steps:

1. Model provider reasoning controls as typed capabilities rather than scattered provider-id conditionals.
2. Build DeepSeek, Zhipu GLM, and Doubao bodies with `thinking.type` set explicitly to `enabled` or `disabled`.
3. Build Qwen bodies with `enable_thinking` set explicitly to true or false.
4. Emit no reasoning field for Custom endpoints.
5. Keep the request body limited to the current model, bounded messages, streaming flag, and the one documented provider field.
6. Surface an HTTP rejection directly; do not retry with changed reasoning settings or provider defaults.
7. Ignore streamed `reasoning_content` and collect only final `content`; do not store reasoning text in history.
8. Verify the request behavior through the existing local mock server without contacting live providers.

Expected commit:

```text
feat: control provider reasoning explicitly
```

## 8. Add the reasoning control to Manage Models

Files:

- update `src/views/aiWebviewProtocol.ts`;
- update `src/views/spssAiPanelController.ts`;
- update `src/ai/aiSessionController.ts` only where resolved profile state must reach the client;
- update `src/ai/aiStrings.ts`;
- update `media/ai.js`;
- update `media/ai.css`;
- update `test/unit/aiUi.test.ts`;
- update `test/unit/aiLocalization.test.ts`;
- update `test/unit/spssAiPanelController.test.ts`.

Steps:

1. Add a bounded boolean field to profile create/save messages and reject non-boolean values.
2. Render a localized checkbox in the existing model form, unchecked for new and migrated profiles.
3. Restore the saved value whenever a profile is selected or Manage Models is reopened.
4. Disable the checkbox for Custom profiles and show a concise explanation that private protocol fields are not guessed.
5. Include the value in create, save, duplicate, and complete render-state flows without exposing API keys.
6. Prevent edits while a request is active under the existing profile-mutation rules.
7. Add narrow responsive CSS without increasing the form's minimum width or harming laptop layouts.
8. Run UI, localization, protocol, profile, and controller tests.

Expected commit:

```text
feat: configure reasoning per AI model
```

## 9. Strengthen the concise SPSS-only system instruction

Files:

- update `src/ai/chatProtocol.ts`;
- update `test/unit/aiCore.test.ts`;
- update `test/unit/aiLocalization.test.ts`;
- update syntax/output explanation tests only if they assert the shared instruction text.

Steps:

1. Add failing Chinese and English contracts covering the allowed SPSS and applied-statistics domain.
2. Add the exact short refusal behavior for clearly unrelated questions.
3. Preserve the existing Chinese-default response rule, concise-answer rule, executable fenced SPSS code rule, and uncertainty rule.
4. Keep the instruction compact and avoid examples or duplicated prose that consume tokens on every request.
5. Confirm ordinary Chat, Explain in Chat, and Output Explain all receive the same domain boundary and language preference.
6. Document that the boundary is model-enforced rather than a deterministic local classifier.

Expected commit:

```text
feat: constrain Chat to SPSS analysis
```

## 10. Update the product description and release metadata

Files:

- update `README.md`;
- update `CHANGELOG.md`;
- update `docs/ARCHITECTURE.md`;
- update `docs/TROUBLESHOOTING.md` where reasoning errors or theme selection need explanation;
- update `package.json`;
- update `package-lock.json`.

Steps:

1. Replace the opening English paragraph with the exact approved translation from the design.
2. Place the exact approved Chinese paragraph immediately after it without editorial changes.
3. Rename `Version History / 更新历史` to `Version History`.
4. Document theme selection, editor/Chat exact-parity conditions, token-family scope, per-profile reasoning behavior, Custom-provider limitation, and prompt boundary.
5. Add the 0.8.0 release summary to README and detailed entries to CHANGELOG.
6. Update the architecture document to identify the generated taxonomy and provider capability mapping.
7. Advance package and lockfile versions to 0.8.0 only after behavior tests pass.
8. Keep proprietary licensing, author identity, affiliation, contact information, repository metadata, and icon unchanged.

Expected commits:

```text
docs: document the 0.8.0 developer experience
chore: release SPSS Studio 0.8.0
```

## 11. Full verification, visual acceptance, and VSIX audit

Automated commands:

```text
npm run check:grammar
npm run compile
npm run lint
npm run test:unit
npm run test:python
npm run test:extension
npm run verify
npm run package
```

Verification order:

1. Run focused red-green-refactor tests after each task.
2. Run `npm run verify` after integration.
3. Run the fake Extension Host suite.
4. Do not require real SPSS execution unless engine-boundary files changed unexpectedly.
5. Open the long syntax fixture under both bundled themes and inspect commands, subcommands, variables, functions, literals, operators, comments, selections, diagnostics, and Chinese text.
6. Open the same representative SPSS code in a Chat code block and compare the exact token categories, colors, and font styles under each bundled theme.
7. Exercise model create/edit/duplicate/select for all presets and verify the reasoning checkbox persists independently.
8. Use local mock endpoints to verify request bodies and provider-error behavior; never send test prompts or credentials to live providers.
9. Build `dist/spss-studio-0.8.0.vsix` through the hardened package script.
10. Enumerate the VSIX independently and confirm it contains only allowlisted production files, including exactly the required theme assets.
11. Scan archive entries for high-confidence credential patterns without printing any secret values.
12. Confirm API keys, conversation history, global storage, `.env`, tests, source, tools, logs, Git data, design documents, and implementation plans are absent.
13. Record the absolute VSIX path, size, and SHA-256.

## 12. Commit and GitHub synchronization

Steps:

1. Confirm the worktree contains only the intended 0.8.0 changes.
2. Review the complete diff for generated-file consistency, accidental secrets, local paths, and unrelated edits.
3. Create the final release commit sequence using the Conventional Commit messages listed above; combine only tightly coupled changes when intermediate commits would not build.
4. Push the verified branch to the existing `GingLam/SPSS-Studio` GitHub repository.
5. Fast-forward or update the repository's published default branch only if it remains a clean fast-forward from the already audited history.
6. Verify the remote commit SHA and inspect the GitHub README rendering.
7. Do not upload the VSIX to the Marketplace and do not create or modify Marketplace credentials.

## Regression boundaries

The following behavior must remain unchanged unless a test exposes a direct dependency:

- SPSS command completion and Active Dataset variable completion;
- Run Selection / Current Command and Run File;
- editor Undo and Explain in Chat;
- persistent local SPSS process lifecycle;
- native OMS HTML Output, Explain, Export, Print, and collapsible History;
- Data and Variables views and double-click variable insertion;
- conversation history behavior and response-language preference;
- Insert and Copy controls for Chat code blocks;
- Workspace Trust, CSP, Markdown sanitization, and output sanitization;
- SecretStorage and local-history privacy boundaries; and
- macOS and Windows SPSS discovery.

## Expected execution characteristics

- Expected implementation time on the current machine: approximately 3–5 hours, dominated by grammar generation, theme visual checks, migration coverage, and packaging verification.
- Expected tool usage: more than 20 calls. The work remains sequential because grammar, Chat parity, profile migration, and release packaging share generated artifacts and one worktree; no subagent is used unless the user explicitly requests delegation.
- Main pitfalls: third-party themes cannot guarantee palette parity; provider model capabilities change independently of the extension; GLM models that cannot disable reasoning must return a visible error; migration must never delete an unverified legacy key; and hard-coded Webview colors must remain readable with VS Code selection and focus states.

## Planned production commit sequence

1. `test: define the SPSS highlighting system`
2. `feat: generate the SPSS token taxonomy and palettes`
3. `feat: deepen SPSS editor syntax classification`
4. `feat: add SPSS Studio light and dark themes`
5. `feat: unify editor and Chat SPSS highlighting`
6. `test: define profile reasoning migration`
7. `feat: add per-profile reasoning settings`
8. `fix: remove verified legacy AI key copies`
9. `feat: control provider reasoning explicitly`
10. `feat: configure reasoning per AI model`
11. `feat: constrain Chat to SPSS analysis`
12. `docs: document the 0.8.0 developer experience`
13. `chore: release SPSS Studio 0.8.0`
