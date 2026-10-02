# Troubleshooting

## SPSS is not detected

Run **SPSS: Show Status**. If automatic discovery reports no installation, set `spssStudio.installPath` and, if necessary, `spssStudio.pythonLauncherPath`.

On macOS, a typical root is `/Applications/IBM SPSS Statistics 27`. On Windows, it is usually below `C:\Program Files\IBM`. The launcher and installation root must belong to the same SPSS installation.

## The launcher exists but startup fails

Enable `spssStudio.debugLogging`, retry **SPSS: Start Engine**, and inspect the **SPSS** OutputChannel. Older x86_64 macOS SPSS releases require a working Rosetta environment on Apple Silicon. SPSS Studio does not install Rosetta or alter IBM binaries.

## Startup or execution times out

Increase `spssStudio.startupTimeoutSeconds` or `spssStudio.executionTimeoutSeconds`. On timeout, SPSS Studio terminates its own bridge because the processor's eventual state cannot be trusted; the next execution can start a new session.

## A successful command has no output

Data transformations such as `COMPUTE`, `RENAME VARIABLES`, or `DELETE VARIABLES` may legitimately produce no pivot table or log item. They appear as `SUCCESS_NO_OUTPUT`. This differs from an OMS or engine failure.

## Multiline commands report “invalid character”

Literal TAB characters at the start of continuation lines are rejected by the SPSS 27 Python `Submit` path even though the native Syntax Editor displays equivalent indentation normally. Version 0.3.0 expands command-indentation TABs at submission time and lists the affected source lines in the SPSS OutputChannel. The source file is not changed. Tabs inside quoted strings, inline data, and embedded program/GPL/MATRIX bodies remain untouched.

If a run still reports an SPSS error, remember that commands completed before the error are not rolled back. SPSS Studio refreshes Active Dataset metadata when the processor remains alive so Data Preview and variable completion reflect the actual partial state.

## Output HTML or a chart is missing

Each run uses one private OMS HTML destination and closes it immediately. The installed SPSS renderer determines how charts are encoded. SPSS 27 on the tested macOS host embedded a JPEG data URI even though OMS requested PNG; the panel accepts safe raster data URIs. Remote or executable content is intentionally removed.

User syntax that ends all OMS requests, calls `FINISH`, or otherwise changes processor state can disrupt capture. The plugin itself closes only its private tag.

## Exported output or printing does not open as expected

**Export** writes one sanitized HTML file and embeds local raster charts. If export fails, choose a writable local destination and confirm that the selected run still has HTML output.

**Print** opens a temporary print-ready HTML file in the operating system's default browser. Some browsers block the automatic print dialog; press `Ctrl+P` on Windows or `Cmd+P` on macOS in the opened page. SPSS Studio does not silently install a PDF printer or platform-specific print utility.

## Data Preview shows an unknown case count

SPSS can return `-1` while transformations or imports are pending. Run `EXECUTE.` and refresh the preview if an immediate materialized count is required. The extension does not substitute a guessed count.

## Data Preview changes a named dataset to `*`

Version 0.3.0 explicitly restores a valid original dataset name after IBM's `Dataset.close()` behavior breaks the name association. If this still occurs, record the SPSS version and syntax and report it as a compatibility defect.

## Data horizontal scrolling shows a temporary blank region

Wide datasets are loaded in variable chunks while one continuous scrollbar represents the whole dataset. A short blank interval can appear during an uncached horizontal jump while SPSS reads the requested variables. Returning to a cached window should be immediate. If the view remains blank, use **Refresh** and inspect the **SPSS** OutputChannel for a dataset-page error.

## Variables do not appear in completion

Variable candidates require an Active Dataset metadata refresh. Run the syntax that creates/opens the dataset successfully, use **SPSS: Refresh Data Preview**, or open **SPSS: Show Data**. Starting, stopping, restarting, or losing the engine intentionally clears the cache.

## Double-clicking a variable name does not insert it

First run syntax that creates or opens an Active Dataset, then open **SPSS: Show Variables**. Double-click the cell in the **Name** column, not its Label, Type, Format, or Measure cell. SPSS Studio inserts only names that still match the current metadata cache. Keep a `.sps` editor open; the insertion targets its most recently used selection and remains undoable with the ordinary editor undo command.

## SPSS AI says that it is not configured

Open **Model Profiles** or run **SPSS: Manage AI Model Profiles**. Create or select a profile, enter the model identifier exactly as supplied by the provider, and save an API Key. The model name is not discovered automatically because providers change model catalogs and account-specific endpoint identifiers independently of the extension.

The API Key field is blank whenever the page opens even when a key is saved. This is intentional: SPSS Studio never sends a stored key back into the Webview. Read the status below the field. Leave the field blank to preserve the saved key, or enter a replacement and save.

The Base URL is the protocol root, not a full `/chat/completions` URL. The extension appends `/chat/completions` itself.

## SPSS AI returns HTTP 401, 403, or 404

- `401` normally means the API Key is invalid, belongs to another region, or does not match the selected service.
- `403` normally means the account or key lacks permission for the requested model.
- `404` normally means the Base URL or model identifier is wrong, or the endpoint does not implement OpenAI-compatible Chat Completions.

Use the **Official docs** button in the configuration panel and verify the current provider values. SPSS Studio does not log the API Key or raw provider response body.

## SPSS AI reports an incompatible stream or empty response

SPSS Studio 0.6.0 and later require streamed OpenAI-compatible Chat Completions. Provider-specific native protocols, Responses-only endpoints, tools, and nonstandard event formats are not silently translated. Choose the provider's OpenAI-compatible endpoint or use a compatible gateway.

Only HTTPS endpoints are accepted. Plain HTTP is limited to `localhost`, `127.0.0.1`, and `::1` for local model servers. Redirects are intentionally rejected to avoid forwarding the bearer credential to another origin.

## Reasoning mode is unavailable or rejected

Reasoning is configured separately for each model profile and is off by default. DeepSeek, Zhipu GLM, and Doubao use the provider-native `thinking.type` field; Qwen uses `enable_thinking`. The checkbox is intentionally unavailable for Custom OpenAI-compatible profiles because there is no universal request field that can be sent safely to every compatible endpoint.

If a built-in provider returns an HTTP error after reasoning is enabled, first confirm that the selected model currently supports that provider's reasoning option. Disable reasoning for models that do not support it. SPSS Studio does not infer capability from a model name and does not silently retry with a different request body.

## AI-generated syntax does not run

Insert and Copy transfer the code block exactly without its fence markers or language identifier. They do not validate, save, or execute it. Model output can contain unsupported commands, version-specific options, or ordinary mistakes; inspect the syntax and compare uncertain details with IBM documentation before running it.

## SPSS AI history is missing or should be removed

History is shared across all `.sps` files and workspaces in the same local VS Code profile. It is not stored beside a syntax file and does not follow the project through Git. Different VS Code profiles or machines therefore have separate histories.

Use **Chat History** to open, rename, or delete one conversation. **Clear all history** asks twice before removing every saved conversation. The history is local plaintext and may contain whatever the user typed or the model returned; do not place sensitive material in the AI chat.

## Current command is not selected as expected

Place the cursor inside the command, not on a blank line or command comment. Explicit selection is the escape hatch: select exactly the intended syntax and run **SPSS: Run Selection / Current Command**.

## Windows status

Windows discovery, Registry parsing, paths with spaces, batch launch, bundled-Python fallback, JSONL transport, completion, paging bounds, AI protocol handling, and Webview-independent logic are unit tested. SPSS Studio does not yet claim Windows + SPSS real-machine verification.
