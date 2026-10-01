# SPSS AI Multi-Profile and Persistent History Redesign

Status: approved for implementation planning on 2026-10-01

## Purpose

SPSS Studio 0.5.0 will replace the fragile single-provider, memory-only AI view introduced in 0.4.0 with a reliable but still lightweight SPSS Syntax question-and-answer subsystem. The redesign keeps one contributed `SPSS AI` Webview View in the VS Code bottom panel. Inside that Webview, users can switch among the current conversation, a persistent conversation history, and model profile management.

The change remains entirely inside the extension. It will not patch VS Code, hide built-in or third-party panel containers, replace the native `.sps` editor, or add AI access to SPSS datasets or output.

## Confirmed product decisions

- Use one modular Webview rather than multiple VS Code Views.
- Use three internal pages: Current Chat, Chat History, and Model Profiles.
- Share one local history space across every `.sps` file, folder, and VS Code workspace on the same machine.
- Keep at most 100 conversations.
- Support multiple independently named model profiles, including multiple profiles for the same provider.
- Generate a default profile name from the provider and model, and allow renaming.
- Reopen a historical conversation with its last model profile when that profile still exists.
- Let a user change the model for subsequent messages without rewriting earlier messages.
- Generate a conversation title locally from the first user question; do not spend a model request on title generation.
- Replace Clear with New Chat. A non-empty current conversation is saved before a new one starts.
- Require one confirmation for deleting one conversation and two confirmations for clearing all history.
- Store conversation text as ordinary local JSON in extension-private storage. It is not encrypted and is not synchronized.
- Follow the VS Code display language for Simplified Chinese and English UI text.
- Never place developer or user API keys, real conversations, or brainstorming artifacts in the VSIX.

## Problems in 0.4.0

### Lost Webview initialization

`SpssAiViewProvider.resolveWebviewView` installs the HTML and immediately posts the initial provider state. The Webview script does not send a ready signal. If the host message arrives before the script has attached its `message` listener, the provider list and saved non-secret fields remain empty. The header can therefore say `Not configured` while the extension host still has a usable saved provider.

The Configure action only unhides the existing form; it does not request fresh state. It cannot recover from the lost initialization message.

### Single active configuration

The existing provider store writes one object to `spssStudio.ai.providerConfiguration`. Saving another provider or model replaces the previous object. Provider-specific secret keys can survive, but the UI and data model cannot represent multiple named configurations or multiple models for the same provider.

### Fixed layout and weak hierarchy

The Webview uses a fixed CSS grid. There is no splitter element, pointer handling, keyboard resizing, or persisted split position. The transcript and composer also use visually similar theme colors, so the boundary is hard to see in light themes.

### Memory-only conversation

The current conversation is an array owned by the view provider. It is discarded on extension deactivation or VS Code reload and has no conversation identity, title, index, or storage format.

### Shared Panel boundary

Problems, Output, Debug Console, Terminal, and Ports are built-in VS Code panel containers. Spell Checker is contributed by another extension. SPSS Studio owns only its `SPSS AI` container and must not hide, move, or mutate the other containers.

## Goals

- Make provider and model configuration reliably visible after every reveal, reload, and upgrade.
- Allow multiple named OpenAI-compatible model profiles and fast switching.
- Preserve conversations locally across VS Code reloads and workspace changes.
- Provide a usable internal history page without adding another VS Code panel tab.
- Let users resize the transcript and question composer with an accessible splitter.
- Establish a clear visual hierarchy in both light and dark themes.
- Preserve the existing Insert and Copy controls for fenced code.
- Keep the Webview offline and keep model transport in the extension host.
- Preserve the strict boundary that excludes editor text, variables, cases, output, filenames, and workspace paths from AI requests.
- Prove through packaging checks that runtime secrets, conversations, and development artifacts cannot enter a VSIX.

## Non-goals

- Attachments, images, web search, retrieval, embeddings, tools, agents, or function calling.
- Provider-specific SDKs or native provider protocols.
- Automatic execution, validation, or saving of model-generated syntax.
- Synchronizing profiles, secrets, or conversations across computers.
- Encrypting conversation JSON beyond normal operating-system account and disk protections.
- Importing or exporting conversations in 0.5.0.
- Searching conversation content in 0.5.0.
- Modifying or hiding other VS Code panel containers.
- Changing the SPSS execution engine, Output, Data, Variables, variable inlay, or completion behavior.

## Architecture

```text
SPSS AI Webview
    | ready / typed user actions / complete render state
    v
SpssAiViewProvider
    |
    v
AiSessionController
    |-- ModelProfileStore
    |     |-- globalState: non-secret profile metadata and active profile
    |     `-- SecretStorage: one API key per profile id
    |
    |-- ConversationStore
    |     `-- globalStorageUri: one machine-local shared history
    |
    `-- OpenAiCompatibleClient
          `-- configured /chat/completions endpoint
```

### SpssAiViewProvider

The view provider owns only the Webview lifecycle, Content Security Policy, localization bundle selection, message validation, and forwarding between the Webview and the controller. It does not own profile persistence, conversation persistence, or model-request state.

The Webview sends `ready` only after it has installed its event handlers. Every `ready` receives a complete, authoritative render snapshot. Repeated ready messages are safe and idempotent. The Configure command reveals the view, opens the Model Profiles page, and requests a new snapshot from storage instead of exposing stale DOM state.

### AiSessionController

The controller owns:

- the active conversation;
- the active model profile;
- request lifecycle and cancellation;
- New Chat behavior;
- model changes within a conversation;
- conversion between stored messages and provider request context; and
- complete render snapshots for the Webview.

An in-flight request captures an immutable resolved profile and secret. Switching or deleting the active profile is disabled until the request completes or the user stops it.

### ModelProfileStore

The profile store supports create, update, duplicate, rename, delete, select, list, resolve, and migration operations. It separates ordinary metadata from secrets.

Conceptual metadata schema:

```ts
interface ModelProfileIndexV2 {
  schemaVersion: 2;
  activeProfileId?: string;
  profiles: ModelProfileV2[];
}

interface ModelProfileV2 {
  id: string;
  name: string;
  providerId: AiProviderId;
  baseUrl: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}
```

The index is stored in extension `globalState` without registering it for Settings Sync. Each secret uses this key shape:

```text
spssStudio.ai.profile.<profile-id>.apiKey
```

The API key is never returned to the Webview. UI state contains only `hasApiKey`.

Duplicating a profile copies its secret inside the extension host when one exists, giving the new profile an independent secret entry. Later changes to either profile do not affect the other.

### ConversationStore

The conversation store uses one global history for the extension installation, regardless of the current file, folder, or workspace. It writes only under `ExtensionContext.globalStorageUri`, never beside an `.sps` file and never inside the installed extension.

Conceptual schema:

```ts
interface ConversationFileV1 {
  schemaVersion: 1;
  activeConversationId?: string;
  conversations: StoredConversationV1[];
}

interface StoredConversationV1 {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastProfileId?: string;
  lastProfileName?: string;
  messages: StoredMessageV1[];
  truncated?: boolean;
}

interface StoredMessageV1 {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  profileId?: string;
  profileName?: string;
  providerId?: AiProviderId;
  model?: string;
}
```

Assistant messages store a profile snapshot so old answers remain attributable after a profile is renamed or deleted. User messages do not contain editor, dataset, output, filename, or workspace context.

The store keeps no more than 100 conversations and no more than 25 MiB of serialized history in total. Each conversation is limited to 200 stored messages and 512 KiB of UTF-8 message content. When a limit is exceeded, the oldest complete user/assistant pairs are removed and `truncated` is set so the UI can disclose the omission. When the global limit is exceeded, the least recently updated conversations are removed first.

The provider request remains more tightly bounded than stored display history: at most the latest 20 messages and 30,000 characters are sent, using complete conversational turns where possible.

### Durable writes

History uses a versioned primary JSON file, a temporary file, and one last-known-good backup. A save writes and validates the temporary representation before replacing the primary file. If the primary file cannot be parsed on startup, the store attempts to restore the backup. If neither copy is valid, it preserves the corrupt files for diagnosis, creates an empty in-memory history, and shows an explicit warning. It never silently overwrites the only corrupt copy.

Write operations are serialized so rapid streamed UI events cannot interleave file replacements. Only completed assistant responses are added to durable history. A failed or cancelled request preserves all earlier successful messages and restores the unsent question to the composer when practical.

## User experience

### Internal navigation

The one Webview contains three internal pages:

```text
Current Chat | Chat History (count) | Model Profiles
```

In Simplified Chinese:

```text
当前对话 | 历史对话（数量） | 模型配置
```

The internal navigation does not create additional VS Code panel tabs.

### Current Chat

The header contains an active-profile selector, New Chat, and a shortcut to Model Profiles. The page body is:

```text
Transcript
================ accessible horizontal splitter ================
Question composer                                      Stop  Send
```

The transcript and composer use distinct VS Code theme surfaces, a visible separator, and stable section labels. No fixed light or dark colors are used. The layout responds when the user moves the view to another View Container.

The splitter supports pointer dragging, Arrow Up and Arrow Down keyboard changes, Home or a double-click to restore the default, and an ARIA separator value. Both sections have enforced minimum heights. The composer height is stored as non-synchronized extension UI state and clamped against the current view height before application.

Stop is enabled only during generation. The former Clear action is removed. New Chat persists a non-empty current conversation and starts a blank draft. An empty draft is not added to history.

Fenced code blocks keep the existing Insert and Copy actions. Insert remains one normal undoable editor edit and never executes or saves code.

### Chat History

The history page uses the complete Webview width. Entries are sorted by `updatedAt` descending and display title, last update time, last model-profile snapshot, and user-question count.

The initial title is derived locally from normalized text at the start of the first user question. No model or network request is used. Users can rename a conversation. Opening an entry sets it active and returns to Current Chat.

Deleting one conversation requires one modal confirmation. Clearing all conversations requires two distinct confirmations. Deletion affects conversation files only and never removes a model profile or API key.

If a conversation references a deleted profile, it remains fully readable. Sending another message requires selecting an existing profile. Selecting a different profile changes only subsequent requests and messages.

### Model Profiles

The Model Profiles page uses a profile list and an editor:

```text
Profile list             Profile editor
----------------         ----------------------------
Daily Syntax             Name
Complex Analysis         Provider
Local Model              Base URL
                         Model
                         API key status/replacement
```

Actions are New, Save, Duplicate, Rename, Delete, Make Active, and Official Documentation. The form always reloads current non-secret values from the extension host when opened.

An automatically generated name combines the provider label and model id. Users can replace it with any non-empty bounded name. The API key field is always empty on load and is labelled with one of these semantic states: not saved, saved securely, or enter a new key to replace. Deleting a profile requires confirmation. Historical profile snapshots are not deleted.

### Localization

Command titles, view text, buttons, validation messages, warnings, confirmations, and empty states use Simplified Chinese when `vscode.env.language` resolves to `zh-cn`; all other languages fall back to English in 0.5.0. Provider labels, model identifiers, Base URLs, SPSS syntax, and model responses are not translated.

Package contribution strings use `package.nls.json` and `package.nls.zh-cn.json`. Webview and extension-host strings use matched typed resources with a parity test so neither language can omit a key.

## Webview protocol

All messages remain discriminated unions with runtime validation and explicit size limits.

Representative Webview-to-extension actions:

```text
ready
openPage
sendQuestion
stop
newChat
openConversation
renameConversation
deleteConversation
clearAllConversations
selectProfile
createProfile
saveProfile
duplicateProfile
deleteProfile
deleteProfileKey
openProviderHelp
setComposerHeight
insertCode
copyCode
```

The extension normally responds with complete render snapshots after persistent mutations. Streaming response deltas are the only incremental content messages. This favors consistency and recovery over a large collection of fragile partial UI updates.

## Migration from 0.4.0

Migration is idempotent and records completion only after new metadata and any existing secret are readable.

1. Read the old single configuration from `spssStudio.ai.providerConfiguration`.
2. Validate it with the existing URL and model rules.
3. Generate a profile id and default name.
4. Copy metadata into the version-2 profile index.
5. Read the old provider secret and copy it to the new profile-specific secret key when present.
6. Re-read the new profile and secret.
7. Mark migration complete.

On any failure, the old metadata and old secret remain untouched. The old secret is not deleted automatically in 0.5.0, which makes rollback safe. A later release may remove legacy keys after a separate, tested migration.

There is no persisted 0.4.0 chat history to migrate. A conversation already lost on reload cannot be reconstructed.

## Error handling

- A configuration save error leaves every form value in place and identifies the failed field or storage operation.
- A missing API key identifies the affected profile by name.
- URL validation continues to require HTTPS except for loopback HTTP, rejects embedded credentials, and rejects query strings and fragments.
- HTTP status, timeout, cancellation, malformed stream, empty response, and local persistence errors remain distinct.
- A failed or cancelled request does not remove earlier successful messages.
- A history write failure leaves the active in-memory conversation usable and warns that it was not persisted.
- A deleted active profile requires another profile before sending.
- Profile mutation is disabled during an in-flight request until completion or Stop.
- A missing or corrupt profile index produces a recoverable unconfigured state instead of an empty, misleading form.

## Security and privacy

- The Webview Content Security Policy retains `default-src 'none'` and `connect-src 'none'`.
- The Webview receives `hasApiKey`, never an API key value.
- Secrets are not written to settings, global state, history, logs, diagnostics, Git, or error messages.
- Model text is rendered through inert DOM nodes and `textContent`; model HTML is never injected.
- The Webview cannot initiate provider requests. Only the extension host can resolve a profile secret and call the configured endpoint.
- The request body contains the fixed SPSS assistant instruction and bounded user/assistant chat text only.
- The extension does not read or attach SPS source, editor selections, variable metadata, case data, SPSS output, filenames, workspace paths, or terminal content.
- Conversation JSON is local, ordinary plaintext under `globalStorageUri`, is not registered for Settings Sync, and is not included in backups controlled by the extension.

## Packaging boundary

The current blacklist-oriented `.vscodeignore` does not exclude `.superpowers/`, so it is insufficient after local brainstorming artifacts have been created. Version 0.5.0 changes packaging to an explicit production allowlist.

Allowed content is limited to the extension manifest and notices, compiled production code, grammar and language configuration, runtime bridge resources, icons, and Webview assets. Source, tests, tools, maps, logs, caches, `.work`, `.superpowers`, repository metadata, local VSIX files, and all unexpected paths are forbidden.

The package command performs two independent checks:

1. inspect the file set that `vsce` plans to package and reject every path outside the allowlist;
2. after packaging, enumerate the VSIX archive and apply the same allowlist plus forbidden-path and sensitive-artifact checks.

The verifier must fail closed. It must specifically reject `.superpowers`, `.work`, `.git`, `src`, `test`, `tools`, `dist`, local history filenames, secret-storage exports, logs, caches, and editor backup artifacts. The GitHub workflow builds from a clean checkout. A future Marketplace token belongs only in GitHub Actions Secrets and is never written to the repository or package.

## Testing strategy

### Unit tests

- ready/initialize handshake and repeat initialization;
- complete snapshot construction;
- profile create, update, duplicate, rename, delete, select, and resolve;
- independent secrets for multiple profiles, including profiles for the same provider;
- 0.4.0 metadata and secret migration, rollback behavior, and idempotency;
- conversation create, persist, restore, rename, delete, and clear;
- 100-conversation and serialized-size eviction;
- per-conversation pruning without splitting user/assistant pairs;
- corrupt-primary recovery from backup and preservation of unrecoverable files;
- historical profile snapshots after rename or deletion;
- request-context bounding independently of display history;
- splitter clamping, keyboard increments, and default restoration;
- Chinese/English resource-key parity and English fallback;
- Webview message validation and size bounds;
- CSP and inert text rendering;
- VSIX pre-package and post-package allowlist enforcement.

### Extension Host and integration tests

- view registration and command contributions;
- Webview reveal followed by authoritative initialization;
- Configure command opening Model Profiles with refreshed values;
- Insert and Copy actions;
- model HTTP streaming, cancellation, and errors against a local mock endpoint;
- reload-level profile and conversation persistence where the test environment permits;
- unchanged SPSS language, execution, Output, Data, Variables, and variable-inlay contracts.

TypeScript, unit, Python bridge, and Extension Host tests run on macOS and Windows CI. Real SPSS execution remains a separately labelled local acceptance test because CI does not have an IBM SPSS license or installation.

## Manual acceptance

Before release:

1. Test a fresh unconfigured installation.
2. Upgrade an installation with a 0.4.0 provider and secret.
3. Create DeepSeek and Doubao profiles and switch repeatedly.
4. Create two profiles for one provider with independent keys.
5. Hide, reveal, move, and reload the Webview; saved fields must remain visible.
6. Restart VS Code; profiles, active conversation, history, and splitter size must return.
7. Switch among `.sps` files, folders, and workspaces; the same history must appear.
8. Reopen a historical conversation, continue with its original model, then switch models.
9. Delete a referenced model profile and verify the history remains readable.
10. Exercise New Chat, rename, single delete, and double-confirmed clear-all.
11. Verify light and dark themes plus narrow and wide panel layouts.
12. Verify Simplified Chinese and English VS Code display languages.
13. Inspect the final VSIX file list and extracted content.
14. Install the VSIX into a clean VS Code profile and confirm it contains no developer API key, real conversation, local storage, or development document.

## Release

The feature targets version 0.5.0. README, CHANGELOG, architecture, troubleshooting, privacy explanations, configuration instructions, and Marketplace-facing descriptions must be updated. The release VSIX is not committed to Git. Production commits can later be cherry-picked to `main` without the `docs/superpowers` design and plan commits.
