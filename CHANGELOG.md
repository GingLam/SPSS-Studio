# Changelog

## 1.0.0 — 2026-10-03

- Added a compact Variables Name/Label filter with case-insensitive English matching and direct Chinese substring matching.
- Kept variable selections across filter changes, so Copy, Insert, and Explore continue to use every selected variable, including selections hidden by the current filter.
- Made no-selection Explore use the first 10 variables in the current filtered result while preserving the existing 20-variable request limit.
- Shortened the Variables paging actions to **Previous** and **Next** and kept the filter aligned at the right edge of the paging row.
- Updated the deterministic Chinese Explore responsibility statement and verified that Chat renders it as bold Markdown followed by the warning symbol.

## 0.9.0 — 2026-10-03

- Replaced flat-text Output extraction with structural native-HTML parsing that preserves row spans, column spans, layered headers, row labels, and footnotes as aligned Markdown tables for Chat interpretation.
- Kept Output Explain privacy boundaries and payload limits: figures, Notes, runtime and provenance fields, command echoes, file paths, scripts, and styles remain excluded; tables remain capped at 50 body rows and requests at 30,000 characters.
- Added a Variables checkbox column plus dataset-ordered **Copy** and undoable multi-cursor **Insert** actions.
- Added Variables **Explore**, using the selected variables or the first 10 when none are selected, with a hard maximum of 20 variables per request and a compact superscript help control.
- Added a serialized read-only SPSS bridge operation for bounded variable profiles: dictionary metadata, up to 100 value labels, up to 20 categorical values with frequencies, continuous summaries, and temporal bounds. Raw case rows are never sent to the model, and high-cardinality categorical summaries are marked approximate.
- Added measurement-aware Explore guidance for one, two to three, and more than three variables, retained the Explore context for manual follow-ups, and appended a deterministic localized analysis disclaimer to every successful Explore response.
- Preserved compatibility with existing local Chat histories by extending the version-1 conversation format with optional context metadata.

## 0.8.1 — 2026-10-03

- Refined the English and Chinese product introduction for the final Marketplace presentation.
- Kept the extension's runtime behavior unchanged from 0.8.0.

## 0.8.0 — 2026-10-02

- Rebuilt SPSS highlighting around one canonical taxonomy that separates control commands, commands, subcommands, keywords, functions, formats, ordinary/system/scratch/macro variables, strings, numbers, missing-value constants, arithmetic/relational/logical operators, comments, and punctuation.
- Added optional **SPSS Studio Light** and **SPSS Studio Dark** themes with a contrast-checked low-fatigue palette. Installing or updating the extension does not activate either theme automatically.
- Generated editor TextMate scopes, Chat token data, Chat presentation rules, and both bundled themes from shared language and highlighting schemas so fenced SPSS blocks follow the editor's classification and exact bundled-theme colors.
- Added a concise instruction-level Chat boundary for SPSS Syntax, IBM SPSS Statistics use, statistical methods implemented in SPSS, and SPSS output interpretation; clearly unrelated requests receive a short scope notice.
- Added a per-model **Enable reasoning** setting, disabled by default, using native request fields for DeepSeek, Zhipu GLM, Qwen, and Doubao. Custom compatible profiles do not receive guessed reasoning parameters.
- Migrated existing model profiles to the new schema with reasoning disabled, preserved their identifiers and keys, and removed the verified legacy single-provider secret after successful migration.
- Updated the bilingual product introduction and technical documentation for the 0.8.0 release.

## 0.7.0 — 2026-10-02

- Replaced the generic AI instruction with a concise applied-social-statistics system prompt that defaults to Simplified Chinese, supports a shared English response preference, produces fenced executable SPSS Syntax when relevant, and briefly covers purpose, variables, assumptions, key options, and interpretation.
- Added a standard `.sps` editor context action that sends the exact selection—or the scanner-resolved command when there is no selection—directly to Chat without a second Send action.
- Queued editor-originated explanations until the embedded Chat Webview is ready, blocked parallel sends, and redirected missing-profile or missing-key cases to model management.
- Preserved the AI privacy boundary: the new action sends no file path, surrounding document, variables, cases, Output, or workspace metadata and never executes the selected syntax.
- Added Output **Explain** for concise interpretation of statistical headings, tables, footnotes, and text through the current Chat model, using the same Chinese/English preference as editor explanations.
- Added deterministic local Output reduction that excludes figures, Notes, runtime/provenance fields, command echoes, and file paths before the request, with per-table and total payload limits.

## 0.6.1 — 2026-10-02

- Collapsed Output run history by default and added a History toggle beside Print so results receive the full panel width until history is requested.
- Renamed the fourth Studio tab from SPSS AI to Chat.
- Added safe structured Markdown rendering for headings, emphasis, inline code, lists, blockquotes, rules, tables, and HTTPS or email links while keeping model HTML inert.
- Replaced the Chat code block's manually maintained SPSS keyword subset with generated vocabulary from the same language schema that builds the editor TextMate Grammar.
- Expanded theme-aware Chat highlighting across commands, control commands, subcommands, functions, formats, macro directives and variables, keywords, missing values, comments, strings, numbers, operators, punctuation, and variables.

## 0.6.0 — 2026-10-01

- Consolidated the product into a two-column workflow: the native `.sps` editor on the left and one reusable SPSS Studio panel on the right.
- Embedded SPSS AI as the fourth Studio tab after Output, Data, and Variables while preserving chat, history, model profiles, resizing, code highlighting, Insert, and Copy.
- Removed the standalone SPSS AI bottom-panel contribution, automatic reveal behavior, and redundant native-panel integration.
- Removed the editor variable inlay strip, More Variables action, and searchable variable-picker command.
- Added exact-cache, undoable variable insertion by double-clicking only a Name cell in the Variables tab.
- Stopped engine lifecycle and status commands from automatically revealing VS Code's Output panel; diagnostics remain available in the background SPSS OutputChannel.
- Added scoped shell messaging and regression coverage for the unified Studio/AI Webview.

## 0.5.0 — 2026-10-01

- Rebuilt SPSS AI as one lightweight Webview with Current Chat and Chat History navigation plus model management opened from a dedicated Manage Models button.
- Added multiple named model profiles with independent SecretStorage API keys, an active-model selector, duplication, deletion, automatic names, and migration from the 0.4.0 configuration.
- Added local history shared across all `.sps` files and workspaces in one VS Code profile, capped at 100 conversations with reopen, rename, individual delete, and double-confirmed clear-all actions.
- Added a mouse- and keyboard-adjustable boundary between the visually distinct transcript and question composer.
- Compacted the SPSS AI header by placing navigation beside the active-model controls and removing redundant titles and the duplicate Model Profiles tab.
- Restyled chat roles without a redundant user label, using a stronger user-message background while retaining the assistant model label.
- Added theme-aware SPSS highlighting, a distinct code-block surface, and high-contrast Insert and Copy buttons to fenced `spss` and `sps` responses.
- Added English and Simplified Chinese SPSS AI controls following the VS Code display language.
- Added a production-only VSIX allowlist and archive verification that exclude API keys, conversations, tests, Git data, and development artifacts.

## 0.4.0 — 2026-10-01

- Added clickable Active Dataset variable names at the first SPSS editor position, with Label tooltips and native undoable insertion.
- Added a complete searchable variable picker and a 50-name inlay limit for wide dictionaries.
- Added a bottom-panel SPSS AI question-and-answer view using streamed OpenAI-compatible Chat Completions.
- Added quick provider presets for DeepSeek, Zhipu GLM, Qwen, and Doubao plus a custom compatible endpoint.
- Stored provider API keys in VS Code SecretStorage and prevented editor, dataset, Output, filename, and workspace context from entering AI requests.
- Added Insert and Copy actions to every fenced assistant code block without automatic save or execution.
- Added strict Webview rendering, HTTPS and loopback URL rules, manual redirect rejection, cancellation, timeout, and bounded in-memory conversation history.
- Fixed Undo so it explicitly targets the SPSS text editor when a Webview has focus.
- Added local mock-server, protocol, security, variable-cache, inlay, manifest, and Extension Host regressions.

## 0.3.0 — 2026-09-30

- Added SPSS-only editor title actions for native Undo, Run Selection / Current Command, and Run All.
- Reordered SPSS Studio tabs as Output, Data, and Variables.
- Moved selected Output to the left and run history to a resizable right-side pane.
- Added sanitized, self-contained HTML export and browser-based printing for selected output.
- Replaced Data variable paging controls with continuous horizontal virtual scrolling while retaining row paging and the 200-variable bridge limit.
- Added a read-only Variables view for Name, Label, Type, Format, and Measure without changing the SPSS bridge or Active Dataset.
- Added manifest, protocol, portable-output, viewport, and UI-contract regression tests.

## 0.2.1 — 2026-09-28

- Fixed SPSS 27 Python Integration failures caused by literal TAB indentation in multiline Syntax.
- Added block-aware submission normalization that preserves strings, inline data, and embedded program/GPL/MATRIX bodies.
- Added diagnostic reporting of normalized TAB counts and source line numbers without editing the source document.
- Refreshes Active Dataset metadata after an SPSS syntax error when the processor remains alive, because preceding commands are not rolled back.
- Added unit, fake Extension Host, real Extension Host, and real user-file regressions for TAB-indented Syntax.

## 0.2.0 — 2026-09-28

- Added deterministic context-sensitive command, subcommand, keyword, function, snippet, and Active Dataset variable completion.
- Extended the single language schema and generated coverage report with completion vocabulary.
- Added Active Dataset metadata, in-memory variable caching, and lazy two-dimensional data pagination.
- Added a persistent side-by-side SPSS Studio panel with Output and Data tabs.
- Replaced TEXT capture with one private, short-lived OMS HTML destination per execution using `VIEWER=NO`.
- Added lazy on-disk output history, HTML sanitization, local image rewriting, and secure Webview messaging.
- Added six execution statuses and serialized all SPSS run/metadata/page operations.
- Added completion, paging, output-store, sanitizer, bridge, Extension Host, large-data, user-OMS coexistence, and real macOS SPSS tests.

## 0.1.0 — 2026-09-28

- Added SPSS Syntax language registration and generated TextMate Grammar.
- Added the complete 309-command SPSS v25 canonical highlighting baseline.
- Added lexical current-command and structural-block scanning.
- Added persistent IBM SPSS Statistics execution through a JSONL Python Bridge.
- Added OMS text capture, error-level reporting, output channel, and status bar.
- Added macOS and Windows installation discovery with manual overrides.
- Added unit, protocol, Extension Host, and macOS SPSS 27 smoke tests.
