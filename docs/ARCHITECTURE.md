# Architecture

## Runtime flow

```text
VS Code editor
  -> command handler and Workspace Trust check
  -> lexical Command Scanner (when there is no selection)
  -> StudioSession
  -> EngineService
  -> one serialized BridgeManager queue
  -> IBM statisticspython3 or bundled Python
  -> resources/bridge/spss_bridge.py
  -> spss.StartSPSS() / spss.Submit() / Dataset
       |-> one short-lived OMS HTML output
       |-> Active Dataset metadata
       `-> sliced case and variable page
  -> OutputStore / VariableCache / DataPreviewState / DataViewportState
  -> reusable SPSS Studio WebviewPanel
```

The extension implements editor integration and transport, not statistical algorithms. IBM SPSS Statistics remains the computation engine.

## Static Language Schema

`syntax/spss-language.json` is the single static language source. It contains canonical commands, subcommands, functions, formats, macro directives, system/scratch variables, command-specific subcommands, keywords, and verified snippets. `tools/generate-grammar.mjs` validates the schema and generates both `syntaxes/spss.tmLanguage.json` and `docs/SYNTAX-COVERAGE.md`.

The TextMate Grammar colors lexical forms; it is not a semantic validator. The completion provider reads the same schema at activation. The SPSS 25 command inventory therefore does not block later-version syntax from running unchanged.

## Completion Context

`completionContext.ts` combines the command scanner's lexical-region result with the current command text. It identifies command start/name, subcommand, variable list, expression, function argument, and macro contexts. It deliberately returns no candidates inside strings, comments, `BEGIN DATA`, or embedded program bodies.

`completionEngine.ts` is a pure ranking function. Commands lead at command start; command-specific subcommands lead after `/`; variables lead in variable and expression positions; functions and keywords follow. Prefix matching is case-insensitive, but cached variable insertion preserves dictionary case. Multi-word commands are replaced as one range.

The completion path is synchronous and local. It never sends a bridge request on a keypress.

## Command Scanner

`commandScanner.ts` tracks quoted strings and doubled quotes, inline and command comments, line boundaries, decimals, formats, dotted functions, terminators, and incomplete structural blocks. It distinguishes `BEGIN DATA` and embedded `BEGIN PROGRAM`-style regions before ordinary command scanning. Blank/comment cursor positions remain explicitly non-executable.

## Variable Cache and Active Dataset

`VariableCache` holds only the most recently fetched `ActiveDatasetInfo` and its variable metadata. `StudioSession` replaces the cache after `SUCCESS`, `SUCCESS_NO_OUTPUT`, or `WARNING`, and clears it when the engine stops, starts, or enters an error state. Completion reads this cache directly.

The `datasetInfo` bridge operation obtains the Active Dataset name, case and variable counts, variable name/label/type/format, optional measurement level, and weight/split/filter state where the installed SPSS API exposes it. No case values are read during metadata refresh.

## Lazy Data Preview and Continuous Variable Scrolling

Opening Output does not read cases. A `datasetPage` request is issued only when the Data tab is visible or the user explicitly refreshes it. Rows remain paginated. Horizontally, the Webview presents one continuous scrollbar and calculates an aligned variable window from the visible scroll position. `DataViewportState` independently normalizes the requested window, and the bridge still enforces a maximum of 500 rows and 200 variables per request.

The Webview caches chunks for the current row page and attaches a generation number to each request. Row-page changes, refreshes, dataset revisions, and engine resets advance the generation and discard stale responses. Only visible variable columns plus overscan are present in the table DOM.

The bridge brackets every case read with `StartDataStep()` and `EndDataStep()` and slices both dimensions:

```python
dataset.cases[row_slice, variable_slice]
```

It never uses `fetchall`. Dates are converted by IBM's `Dataset(..., cvtDates=True)`, JSON `null` represents system-missing data, and the UI alone renders null as `.`. SPSS may report case count `-1` before pending transformations are materialized; the UI labels this unknown rather than inventing a count.

IBM documents that closing an active named `Dataset` object breaks the dataset-name association. The bridge therefore records a syntactically safe original name and restores it after `EndDataStep()`.

## Single OMS HTML Output and Short-lived OMS

Every execution allocates one run directory and opens exactly one private OMS destination:

```text
OMS /TAG='__SPSS_STUDIO_<UUID>' /SELECT ALL
 /DESTINATION FORMAT=HTML OUTFILE='.../output.html'
 VIEWER=NO IMAGES=YES IMAGEFORMAT=PNG.

<compatibility-normalized user syntax, submitted once>

OMSEND TAG=['__SPSS_STUDIO_<UUID>'].
```

The tag is private and unique. `OMSEND TAG` runs in the immediate `finally` path; the bridge never sends a generic `OMSEND`, so unrelated user OMS requests stay active. It does not create SPV, OXML, or duplicate TEXT output, and it never starts `SpssClient` or the SPSS GUI.

HTML is a display artifact, not an error classifier. The bridge calls `GetLastErrorLevel()` and `GetLastErrorMessage()` after the user's single submission and maps processor/transport results to `SUCCESS`, `SUCCESS_NO_OUTPUT`, `WARNING`, `ERROR`, `ENGINE_ERROR`, or `TIMEOUT`.

### Submission compatibility normalization

The native SPSS Syntax Editor inserts spaces when the user presses Tab, but external files edited in general-purpose editors can contain literal U+0009 characters. SPSS 27's Python-driven `Submit` path rejects such characters in command indentation. Immediately before the single user submission, the bridge expands only leading TAB indentation on SPSS command lines to four-column spaces. It preserves quoted content and raw bodies inside `BEGIN DATA`, `BEGIN PROGRAM`, `BEGIN GPL`, `BEGIN SCRIPT`, and `MATRIX`; block delimiter lines remain SPSS commands and are normalized. The editor buffer and source file are untouched, and the response diagnostics identify the changed line numbers.

An `ERROR` response does not imply rollback: earlier SPSS commands may already have changed the Active Dataset. If the processor is still alive, `StudioSession` therefore refreshes metadata and the variable cache after errors as well as successful and warning runs.

## Lazy Output History

`OutputStore` creates an owned session directory below the operating system's temporary directory. Node memory retains only run metadata and paths. HTML and image assets stay on disk and `readHtml()` is called only when a run is selected. The Webview script replaces the current output element, so only one historical run is present in the DOM.

Clear removes only run directories owned by the current `OutputStore`; disposal removes that session root. The OutputChannel contains lifecycle and diagnostic text, not a second rendering of output.

The Output tab renders the selected result on the left and metadata-only run history on the right. Export and print reuse the same sanitizer. `portableOutput.ts` converts only in-run raster images to data URIs and creates a complete standalone HTML document. Export writes that document through VS Code's save dialog. Print writes a temporary copy and opens it in the system browser because direct Webview printing is not a reliable extension API.

## Read-only Variables View

The Variables tab consumes `ActiveDatasetInfo.variables`, which is already populated for completion and Data preview. It displays Name, Label, Type, Format, and optional measurement level with client-side row pagination. It does not add a bridge operation and cannot modify the Active Dataset dictionary.

## Webview security

`SpssStudioPanel` is a singleton reusable panel in `ViewColumn.Beside`, with Output, Data, and Variables tabs. Its Content Security Policy defaults to no access, permits only the extension's nonce-bearing script, extension/local styles, owned session images, and strict raster image data URIs. `localResourceRoots` contains only `media` and the owned session root.

Before insertion, `htmlSanitizer.ts` removes executable and embedding elements, inline event handlers, form actions, remote links, CSS imports/URLs/expressions, and unsafe image sources. Local images are resolved only when their normalized path stays inside the run directory. Dataset cells are rendered with `textContent`.

## Serialized SPSS Operations

Run, `datasetInfo`, and `datasetPage` all use the same BridgeManager promise queue. The JSONL protocol allows only one in-flight request per SPSS child, preserving deterministic processor and Active Dataset state. Ping/status/shutdown participate in lifecycle control. A timeout terminates the bridge because the processor's eventual state is unknown.

## Platform and failure handling

The macOS and Windows locators return a shared installation model. Production launch uses argument arrays, never a shell-interpolated syntax string. Malformed JSON, response-ID mismatch, write failure, child error/close, startup timeout, and execution timeout remain distinct transport failures. An SPSS analysis error can leave the persistent engine reusable; a dead engine tears down the child and clears dataset state.

## Primary references

- [VS Code Webview security guidance](https://code.visualstudio.com/api/extension-guides/webview)
- [VS Code Extension Testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [IBM `GetLastErrorLevel` and `GetLastErrorMessage`](https://www.ibm.com/docs/en/spss-statistics/32.0.0?topic=classes-spssgetlasterrorlevel-spssgetlasterrormessage-functions-python)
- [IBM OMS `VIEWER` keyword](https://www.ibm.com/docs/en/spss-statistics/30.0.0?topic=command-viewer-keyword-oms)
- [IBM OMS images](https://www.ibm.com/docs/en/spss-statistics/32.0.0?topic=command-images-imageformat-keywords-oms)
- [IBM `CaseList` class](https://www.ibm.com/docs/en/spss-statistics/30.0.0?topic=python-caselist-class)
- [IBM `Dataset` class](https://www.ibm.com/docs/en/spss-statistics/31.0.0?topic=classes-spssdataset-class-python)
