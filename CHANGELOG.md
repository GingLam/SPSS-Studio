# Changelog

## 0.5.0 — 2026-10-01

- Rebuilt SPSS AI as one lightweight Webview with Current Chat, Chat History, and Model Profiles pages.
- Added multiple named model profiles with independent SecretStorage API keys, an active-model selector, duplication, deletion, automatic names, and migration from the 0.4.0 configuration.
- Added local history shared across all `.sps` files and workspaces in one VS Code profile, capped at 100 conversations with reopen, rename, individual delete, and double-confirmed clear-all actions.
- Added a mouse- and keyboard-adjustable boundary between the visually distinct transcript and question composer.
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
