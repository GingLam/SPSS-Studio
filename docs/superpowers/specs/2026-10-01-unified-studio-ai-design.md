# Unified SPSS Studio and SPSS AI Design

Status: approved design, awaiting written-spec review on 2026-10-01

Target release: 0.6.0

## Purpose

SPSS Studio 0.6.0 will replace the current three-region arrangement with two stable editor columns. The native `.sps` editor remains on the left. One extension-owned `SPSS Studio` WebviewPanel remains on the right and contains four internal tabs in this exact order:

```text
Output | Data | Variables | SPSS AI
```

The existing SPSS AI experience moves into the fourth tab without changing model-profile, API-key, conversation-history, provider, or request semantics. The separate bottom-panel SPSS AI contribution is removed. Variable insertion moves from the editor's first-line variable strip and searchable picker to a double-click action in the Variables table.

## Confirmed product decisions

- Keep the left/right layout: native `.sps` editor on the left and one SPSS Studio WebviewPanel on the right.
- Add SPSS AI after Variables as the fourth internal Studio tab.
- Preserve the current SPSS AI internal layout and behavior: Current Chat, Chat History, Manage Models, active-model selection, resizable transcript/composer boundary, streaming, Stop, code highlighting, Insert, and Copy.
- Remove the contributed `SPSS AI` bottom-panel container and view.
- Do not automatically reveal the VS Code bottom panel for AI, engine start, engine restart, or engine status.
- Retain the `SPSS` OutputChannel as a background diagnostic log that users may open manually.
- Do not automatically open SPSS Studio merely because an `.sps` editor becomes active.
- Remove the first-line variable Inlay Hint, `More Variables…`, and the searchable variable-picker command.
- Insert a variable only by double-clicking its Name cell in Variables.
- Preserve the current extension-private model, secret, and conversation storage without migration.
- Release the architectural change as version 0.6.0.

## Goals

- Use notebook screen space efficiently by eliminating the third, bottom SPSS AI region.
- Present all extension-owned result, dataset, dictionary, and AI tools in one coherent Studio surface.
- Preserve AI functionality and stored user data across the move.
- Make variable insertion discoverable in the Variables dictionary without decorating the source editor.
- Keep Studio and AI modules independently understandable, testable, and changeable.
- Ensure the extension never forces open VS Code's Problems, Output, Debug Console, Terminal, or Ports panel during ordinary use.

## Non-goals

- Removing, hiding, reordering, or modifying VS Code's built-in bottom-panel tabs.
- Moving SPSS Studio into the VS Code bottom panel.
- Making Variables editable or changing the SPSS data dictionary.
- Sending variables, cases, output, editor content, filenames, or workspace paths to an AI provider.
- Changing provider endpoints, model-profile schemas, conversation schemas, history limits, or SecretStorage keys.
- Automatically running or saving inserted AI-generated syntax.
- Adding a replacement variable search dialog in 0.6.0.

## Current-state diagnosis

The current layout is produced by two separate extension surfaces:

1. `SpssStudioPanel` creates a WebviewPanel in `ViewColumn.Beside` for Output, Data, and Variables.
2. `SpssAiViewProvider` contributes a separate Webview View under the `spssStudioAi` bottom-panel container and can auto-reveal it when an `.sps` editor becomes active.

The result can occupy the source editor, the right-side Studio, and the bottom panel simultaneously. The first-line variable list is a separately registered `InlayHintsProvider`, while its overflow action calls a separately contributed searchable picker. These independent entry points are the source of the redundant layout and variable-selection behavior.

## Architecture

```text
Native .sps editor (left)
       ^
       | undoable Insert actions
       |
SPSS Studio WebviewPanel (right)
  |-- Output module
  |-- Data module
  |-- Variables module
  `-- SPSS AI module
        |-- Current Chat
        |-- Chat History
        `-- Model management
              |
              v
        SpssAiPanelController
              |-- AiSessionController
              |-- ModelProfileStore / SecretStorage
              |-- ConversationStore / globalStorageUri
              `-- OpenAiCompatibleClient
```

### Single Webview host

`SpssStudioPanel` is the only Webview owner. It creates, reveals, retains, restores, and disposes the right-side panel. Its top-level navigation owns the four Studio tabs and records one active tab from this union:

```ts
type StudioTab = 'output' | 'data' | 'variables' | 'ai';
```

The panel continues to use `retainContextWhenHidden`. Closing and recreating the panel restores authoritative Extension Host state rather than depending on stale DOM state.

### AI controller without an independent view

`SpssAiViewProvider` is refactored into `SpssAiPanelController`. The controller no longer implements `WebviewViewProvider`, creates HTML, registers a VS Code View, or owns panel lifecycle. It retains responsibility for:

- waiting for legacy-profile initialization;
- producing complete AI render snapshots;
- validating and handling AI actions;
- profile and conversation mutations;
- streaming and cancellation;
- API-key isolation;
- provider documentation links;
- editor insertion and clipboard copy; and
- localized AI strings.

The controller communicates through a narrow host-supplied `postMessage` function. Output, Data, and Variables remain usable even if AI initialization fails.

### Modular Webview code

The Webview calls `acquireVsCodeApi()` exactly once in its shell bootstrap. The existing Studio script retains top-level navigation and passes a small bridge to an AI module. The AI module mounts only within `#ai-view` and cannot query or mutate Output, Data, or Variables elements.

AI styles are scoped below the AI view root. Global `body`, `button`, `input`, and generic `.page` rules from the former standalone AI stylesheet must be converted to scoped selectors so they cannot change the other Studio tabs.

The implementation must not solve integration by concatenating all Studio and AI behavior into one monolithic script or controller.

## Webview protocol

All messages use a runtime-validated scope and discriminated payload. Representative envelopes are:

```ts
type StudioWebviewMessage =
  | { scope: 'shell'; type: 'ready' }
  | { scope: 'studio'; type: StudioActionType; /* validated fields */ }
  | { scope: 'ai'; type: AiActionType; /* validated fields */ };
```

Extension-to-Webview messages use the same scope separation. The shell routes messages to the Studio or AI module; it does not interpret feature-specific payloads. Unknown scopes, unknown types, inherited objects, oversized strings, invalid integers, and incomplete payloads are rejected.

The ready handshake is installed only after both Webview modules have attached their message listeners. Studio state may render immediately. AI initialization resolves independently and produces either a complete AI state or an AI-local error banner.

## Top-level tab behavior

- `Output` becomes active when syntax execution starts.
- `Data` becomes active only through Show Data or direct user selection.
- `Variables` becomes active only through Show Variables or direct user selection.
- `SPSS AI` becomes active through Show AI Assistant, Manage AI Model Profiles, or direct user selection.
- Direct selection of Data or Variables may trigger the existing lazy refresh rules.
- Direct selection of SPSS AI requests an authoritative render snapshot if the module has not initialized.
- Switching away from SPSS AI does not cancel an in-flight request.
- Switching back retains the conversation, streaming state, active profile, internal AI page, and composer split height.
- Existing Output history width, Data row position, Data horizontal position, and Variables page state remain intact while switching tabs.

## Command behavior

| Command or event | Result |
| --- | --- |
| Open an `.sps` file | Do not open Studio automatically |
| Run Selection / Current Command | Open/reveal Studio on the right and select Output |
| Run File | Open/reveal Studio on the right and select Output |
| Show Output | Open/reveal Studio and select Output |
| Show Data | Open/reveal Studio and select Data |
| Show Variables | Open/reveal Studio and select Variables |
| Show AI Assistant | Open/reveal Studio and select SPSS AI / Current Chat |
| Manage AI Model Profiles | Open/reveal Studio and select SPSS AI / Model management |
| Start Engine | Start without opening the VS Code bottom panel |
| Restart Engine | Restart without opening the VS Code bottom panel |
| Show Status | Display one `showInformationMessage` summary without opening the VS Code bottom panel; append full details to the background diagnostic channel |

The editor-title AI button remains and calls Show AI Assistant. The `spssStudio.aiAutoReveal` setting and all associated activation logic are removed.

## SPSS AI tab

The AI tab preserves the approved 0.5.0 user experience inside the available Studio content area:

- Current Chat and Chat History remain the visible AI navigation items.
- Manage Models remains the sole entry to the profile editor.
- The active-model selector, New Chat, and Manage Models remain in the compact header.
- User messages have no redundant `You` label and retain the stronger theme-aware surface.
- Assistant messages retain their model-profile label.
- The transcript/composer boundary remains pointer- and keyboard-adjustable.
- Fenced `spss` and `sps` blocks retain theme-aware SPSS highlighting.
- Insert and Copy remain high-contrast actions.
- Insert is an ordinary, undoable editor edit and never saves or runs syntax.

The AI controller continues to process requests if another Studio tab is visible. The Stop command remains available after returning to the AI tab while the request is active.

## Variables double-click insertion

Only the Name cell is interactive. Each rendered Name cell carries the exact cached variable name. Its tooltip is `Double-click to insert <name>` in English and `双击插入 <name>` in Simplified Chinese.

The flow is:

1. A `dblclick` listener on the Name cell prevents accidental text-selection behavior and sends a scoped `insertVariable` action.
2. The Extension Host validates that the received string exactly matches a variable in the current `VariableCache`.
3. If valid, `SpssEditorTargetTracker.insert` restores the most recently used `.sps` editor and replaces its stored selection.
4. VS Code records one normal text edit, so Undo reverses the insertion.
5. If the variable is stale or no `.sps` target exists, no edit occurs and the user receives a specific warning.

Single-clicking a Name cell does not insert. Double-clicking the row number, Label, Type, Format, Measure, whitespace, or table header does not insert. The table remains read-only.

## Removed variable-entry surfaces

The extension stops registering `SpssVariableInlayProvider`. The first-line variable strip and `More Variables…` therefore disappear from every `.sps` editor.

The contributed and registered `spssStudio.showVariablePicker` command is removed. Its picker implementation and tests are removed when no remaining caller exists. The underlying validated insertion helper remains available to Variables and AI insertion flows, but it is not separately exposed as a user-facing variable-search feature.

## Bottom-panel behavior

The manifest removes:

- activation on `spssStudio.aiView`;
- the `spssStudioAi` panel container;
- the `spssStudio.aiView` Webview View;
- the AI view-title menu contribution; and
- the `spssStudio.aiAutoReveal` setting.

No plugin command calls `OutputChannel.show()`. The `SPSS` OutputChannel remains registered for diagnostic append operations and manual user inspection. Start and restart failures continue to use visible error notifications. Show Status uses `vscode.window.showInformationMessage` for a one-line engine-state, detected-version, and last-error summary and appends the detailed diagnostic block to the channel.

The extension does not and cannot remove VS Code's Problems, Output, Debug Console, Terminal, or Ports tabs. It simply stops contributing SPSS AI to that region and stops revealing the region automatically.

## Storage and privacy

This change has no storage migration:

- model metadata remains in the existing extension `globalState` keys;
- each API key remains in its existing SecretStorage key;
- conversations remain under the existing extension `globalStorageUri/ai-history` location;
- composer height remains non-synchronized extension UI state; and
- no data is written beside an `.sps` file.

The AI request boundary is unchanged. Requests contain only the fixed assistant instruction and bounded conversation text typed in SPSS AI. The active dataset, variable dictionary, SPSS output, editor selection, editor content, filenames, and workspace paths remain excluded.

The combined Webview keeps `connect-src 'none'`. Provider requests remain Extension Host operations. Sanitized IBM SPSS Output HTML retains its current image restrictions and cannot execute scripts.

## Error handling and isolation

- AI initialization or storage failure displays an AI-local error and does not block Output, Data, or Variables.
- AI request failure or cancellation retains earlier successful messages and restores the unsent question when practical.
- A missing Active Dataset leaves Variables in its existing empty state and cannot generate an insert action.
- A stale or forged variable name is rejected against the current cache.
- A missing SPSS editor target produces a warning and never edits another language document.
- Closing Studio during an AI request does not expose secrets or corrupt history. Reopening obtains current controller state.
- SPSS engine failures update the status bar, Studio state, notification, and background diagnostic log without revealing the bottom panel.
- A failure in one scoped Webview message handler is reported in its own feature surface and does not reset unrelated tab state.

## Manifest and documentation changes

Version changes from 0.5.0 to 0.6.0. README, changelog, command documentation, and architecture documentation must describe the single right-side Studio and Variables double-click behavior. References to a standalone bottom-panel SPSS AI view, automatic AI reveal, first-line variable strip, `More Variables…`, and the variable picker must be removed.

Package localization retains the Show AI Assistant and Manage AI Model Profiles command titles but removes strings used only by the deleted View contribution or setting.

## Verification and acceptance criteria

### Unit and protocol tests

- The manifest contains no `spssStudioAi` View Container, `spssStudio.aiView`, view-title AI menu, variable-picker command, or `aiAutoReveal` setting.
- The Studio shell declares Output, Data, Variables, and SPSS AI in the required order.
- The combined protocol accepts valid scoped Studio and AI messages and rejects invalid scope, prototype, bounds, and payload cases.
- Only Variables Name cells emit insertion messages on `dblclick`.
- Variable insertion rejects names absent from the current cache.
- The extension registers no variable Inlay Hint provider.
- Start, Restart, and Show Status contain no `OutputChannel.show()` call.
- AI inert-DOM rendering, CSP, localization parity, code highlighting, history, profile, migration, request-boundary, and packaging tests continue to pass.

### Extension Host tests

- Run and Run All reveal Output in the right-side Studio.
- Show Data, Show Variables, Show AI Assistant, and Manage AI Model Profiles select the correct destination.
- A Variables double-click-equivalent message inserts the exact cached name at the stored `.sps` selection and Undo restores the document.
- A forged variable name and a missing `.sps` target make no edit.
- Existing profiles and conversation history remain readable after activation.
- No ordinary command under test reveals the bottom panel.

### Visual checks

- At laptop-sized widths, the native editor and one right-side Studio form the only extension-driven layout regions.
- The fourth tab fits with the first three without obscuring the engine state.
- The AI tab preserves its compact header, transcript/composer distinction, adjustable boundary, role colors, code-block contrast, syntax highlighting, and visible Insert/Copy controls.
- Variables communicates double-click affordance without making other cells look editable.
- Light and dark VS Code themes preserve readable focus, hover, selected-tab, message, and code-token contrast.

### Packaging checks

- Full TypeScript, lint, Python bridge, and applicable Extension Host suites pass.
- The production VSIX allowlist passes.
- The VSIX contains no API keys, stored conversations, global-storage data, workspace data, test fixtures, `.work` files, Git data, or design/planning artifacts.
- The packaged manifest reports version 0.6.0 and contains only the single SPSS Studio WebviewPanel implementation.

## Delivery boundary

Implementation may make local source changes, tests, documentation updates, a 0.6.0 VSIX, and local Conventional Commits after a separate implementation-plan approval. It must not push GitHub, publish to Visual Studio Marketplace, modify user API keys, or modify stored conversations without separate explicit authorization.
