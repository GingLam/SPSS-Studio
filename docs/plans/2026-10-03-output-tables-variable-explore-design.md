# SPSS Studio 0.9.0: Output Tables and Variable Explore Design

**Date:** 2026-10-03  
**Status:** Approved design; implementation not started  
**Target version:** 0.9.0

## 1. Objectives

SPSS Studio 0.9.0 will deliver two connected improvements:

1. Preserve the structure of native SPSS HTML tables when Output **Explain** sends results to Chat, and render those tables as safe Markdown instead of raw pipe-delimited text.
2. Add a read-only variable-selection and exploration workflow to the **Variables** tab, including checkbox selection, **Copy**, **Insert**, and **Explore** actions.

All functionality remains inside the VS Code extension. It does not modify VS Code itself, run hidden SPSS analysis procedures, or distribute user model settings, API keys, conversations, datasets, or output files.

## 2. Chosen Architecture

The approved architecture is approach A:

```text
SPSS Active Dataset
        |
        +-- datasetInfo -----------------> Variables table
        |
        +-- variableProfiles (new) ------> bounded variable summaries
                                                |
selected variables -> Copy / Insert          Explore
                                                |
                                                v
                                          current Chat

SPSS native HTML Output
        |
        v
merged-cell expansion -> header normalization -> Markdown table
        |
        v
current Chat -> safe Markdown rendering
```

The alternatives rejected were direct native-HTML submission/rendering and running `CODEBOOK` or `FREQUENCIES` to manufacture exploration output. Direct HTML is verbose and inconsistent across models, while auxiliary SPSS procedures would pollute Output and Run history and couple Explore to the output parser.

## 3. Output Explain Table Normalization

### 3.1 Parsing

The current regular-expression table extraction must be replaced by structured HTML parsing. The implementation must:

- expand `rowspan` and `colspan` into a rectangular cell grid;
- preserve empty cells that carry positional meaning;
- distinguish table headers, body cells, captions, stub columns, and footnotes;
- normalize `<br>` elements and HTML entities;
- remove scripts, styles, images, SVG, canvas, iframe, object, figure, map, and embedded content;
- escape Markdown pipes, backslashes, and line breaks;
- continue excluding SPSS Notes/system-metadata tables.

SPSS output contains real merged cells and multi-level headers, so regular expressions must not be used as a substitute for a table DOM.

### 3.2 Row spans

Row-spanned stub labels must be propagated into the relevant normalized rows. Repeating a row label is preferred to leaving a blank Markdown cell because it preserves the relationship between a statistic and its variable or group for both people and models.

### 3.3 Column spans and multi-level headers

Each final Markdown column receives a complete header path. For example:

```text
99% Confidence Interval
    +-- Lower Bound
    +-- Upper Bound
```

becomes:

```markdown
| 99% Confidence Interval / Lower Bound | 99% Confidence Interval / Upper Bound |
```

Duplicate adjacent header fragments are collapsed. If no reliable header exists, stable names such as `Column 1` are generated instead of treating the first data row as a header.

### 3.4 Content policy

Output Explain retains:

- procedure titles;
- table titles and statistical tables;
- substantive text results;
- table footnotes and significance notes;
- warnings with analytical meaning.

It removes:

- Run number, error level, and duration metadata;
- file paths and command echoes;
- Output Created, Active Dataset, Filter, Weight, Split File, Processor Time, and Elapsed Time metadata;
- Notes tables;
- all graphical images and drawing objects.

Figures remain outside the 0.9.0 Explain scope.

### 3.5 Bounds and fallback

- A normalized table retains at most 50 data rows.
- Truncation occurs only at a complete-row boundary.
- A truncated table receives an explicit localized marker.
- One Output Explain payload is bounded to approximately 30,000 characters.
- Titles, headers, leading rows, and footnotes receive priority.
- If a table cannot be reconstructed confidently, the extension emits a labeled, regularized row/column representation instead of silently returning a misaligned Markdown table.

### 3.6 Chat rendering

The Output Explain question will use clean Markdown and will no longer expose an XML-like `<SPSS_OUTPUT>` wrapper. User messages, not only assistant messages, will pass through the existing typed, safe Markdown renderer. Arbitrary HTML remains inert. Wide tables render inside their own horizontal scroll container.

## 4. Variables Tab Interaction

### 4.1 Layout

The toolbar order is:

```text
Copy -> Insert -> Refresh -> Explore?
```

The circular question mark is a small superscript attached to **Explore**, not a separate toolbar button. It remains independently focusable and clickable and exposes a short localized tooltip/popover:

> Explore sends selected variables' metadata and bounded summaries to Chat; with no selection, it uses the first 10 variables.

The table layout becomes:

```text
checkbox | # | Name | Label | Type | Format | Measure
```

The header checkbox position is only a column marker; version 0.9.0 will not add select-all behavior.

### 4.2 Selection behavior

- Only a row checkbox changes selection.
- Double-clicking a variable name keeps the existing single-variable insertion behavior.
- Selection persists across Variables pagination and Studio tab changes.
- Refresh retains only selections whose variable names still exist.
- Closing the Active Dataset clears selection.
- A changed dataset or materially changed variable schema drops stale selections.
- Copy, Insert, and Explore do not clear selection after success.
- The toolbar reports the number of selected variables.

### 4.3 Copy

Copy writes selected names in dataset order with one space between names and no quotes, commas, line breaks, or trailing spaces:

```text
Education Health Income
```

Copy has no variable-count limit. It is disabled with no selection and uses the VS Code clipboard API rather than browser clipboard permissions.

### 4.4 Insert

Insert uses the same dataset-order, space-delimited text. It replaces non-empty selections or inserts at cursors in the most recently used `.sps` editor, supports multiple selections/cursors, restores editor focus, and refuses to write to a non-SPSS document. It does not add commands, punctuation, line breaks, or surrounding whitespace. Insert has no variable-count limit and is disabled with no selection.

### 4.5 Explore

Explore operates as follows:

1. Validate selected names against the current metadata cache.
2. If none are selected, choose the first 10 variables in dataset order.
3. If more than 20 are selected, stop before any SPSS or AI request and ask the user to reduce the selection.
4. Request read-only bounded profiles from SPSS.
5. Switch to the current Chat and send the Explore request automatically.
6. Do not create a new conversation. The user can select **New Chat** when isolation is desired.

While summaries are being prepared, duplicate Explore activation is prevented. A failed or timed-out profile request does not create a partial Chat message.

### 4.6 Trust boundary

The Webview manages presentation and selected-name state only. The extension host revalidates names, orders them by the dataset dictionary, writes to the clipboard, edits `.sps` documents, invokes the bridge, builds prompts, and starts Chat requests.

## 5. Read-only Variable Profile Bridge

### 5.1 Protocol

Add the serialized bridge operation `variableProfiles`.

Conceptual request:

```json
{
  "op": "variableProfiles",
  "variableNames": ["Education", "Health", "Income"]
}
```

Conceptual response:

```json
{
  "datasetName": "nlsw",
  "caseCount": 2246,
  "filterVariable": null,
  "weightVariable": null,
  "splitVariables": [],
  "profiles": [
    {
      "name": "Education",
      "label": "教育年限",
      "type": "Numeric",
      "format": "F2.0",
      "measurementLevel": "Scale",
      "valueLabels": [],
      "summary": {
        "kind": "continuous",
        "validN": 2244,
        "missingN": 2,
        "minimum": 0,
        "maximum": 18,
        "mean": 13.1,
        "standardDeviation": 2.52
      }
    }
  ]
}
```

This operation must not submit SPSS Syntax, create viewer output, add a Run record, modify the dataset, or return case rows to the extension host.

### 5.2 Variable classification

1. SPSS Nominal or Ordinal variables are categorical.
2. String variables are categorical.
3. Scale numeric variables are continuous.
4. Numeric variables with missing measurement metadata but defined value labels are categorical.
5. Other numeric variables with missing measurement metadata are continuous.
6. Recognized date/time formats receive a temporal summary.

Variable names do not determine classification.

### 5.3 Categorical profiles

Return:

- valid N;
- missing N;
- distinct valid-value count when feasible;
- at most 20 observed values with frequency;
- the corresponding value label when defined;
- at most 100 defined value-label pairs.

System-missing and user-missing values do not enter valid frequencies. Values and labels are length-bounded and serialized safely.

### 5.4 Continuous and temporal profiles

Continuous profiles return valid N, missing N, minimum, maximum, mean, and sample standard deviation. A numerically stable streaming algorithm must be used. Temporal profiles return valid N, missing N, earliest value, and latest value in readable form; they do not send internal SPSS epoch values or a default date mean/standard deviation.

### 5.5 Performance bounds

- Maximum 20 variables per request.
- Read selected variables in bounded chunks.
- Accumulate profiles inside the SPSS Python process.
- Do not materialize the whole dataset or return raw rows.
- Maintain exact categorical counts while distinct values remain at or below 10,000.
- Switch to a bounded Top-20 streaming structure beyond 10,000 distinct values and mark the result as approximate.
- Existing engine execution timeouts apply.

Memory use must depend on the selected variable count, chunk size, and bounded category structures, not directly on the full case count.

### 5.6 Prompt bound

The Explore prompt is bounded to approximately 30,000 characters. Always retain variable name, label, type, measurement level, valid/missing N, and core summary statistics. Then prioritize observed high-frequency values over unobserved dictionary labels. If further reduction is required, reduce per-variable value-label/category tails fairly and mark every truncation.

### 5.7 Filter, Weight, and Split

Current Filter, Weight, and Split state is included as context. Explore is explicitly a quick preview rather than a replacement for a formal SPSS procedure. When these states are active, Chat must tell the user to confirm formal results using the appropriate SPSS analysis commands.

### 5.8 Privacy boundary

The bridge does not send complete cases, row identifiers, row-level combinations, unselected variables, or raw rows. It sends bounded dictionary information and summaries only.

This does not mean zero disclosure: a categorical or string observed value can itself contain sensitive text. The UI and README must state that up to 20 literal observed category values can be sent to the configured model provider. High-cardinality safeguards, string-length bounds, and the 20-value limit reduce but do not eliminate that risk.

Profiles are stored only as part of the local Chat question. They are not placed in diagnostic logs, the repository, Settings Sync, GitHub, or the VSIX.

## 6. Explore Chat Behavior

### 6.1 Conversation context

Conversations support a standard context and a variable-explore context. Explore activates variable-explore in the current conversation. Manual follow-ups continue in that context. **New Chat** resets it. A new Output Explain or Syntax Explain action replaces the variable-explore task context with its own context. Existing stored conversations migrate to standard context without message loss.

### 6.2 Prompt presentation

The user-visible and model-visible Explore request is readable Markdown, not raw JSON or hidden XML. Users can inspect exactly which metadata and summaries were sent.

### 6.3 Compact system instruction

The existing concise SPSS-only instruction remains. Explore adds the following compact behavior:

```text
VARIABLE_EXPLORE:
One variable: provide measurement-appropriate descriptive syntax, a brief
explanation, and next steps.
Two or three variables: only when statistically appropriate, provide two- or
three-way crosstabs, relationship plots, correlation, or regression syntax;
state role assumptions and next steps.
More than three variables: propose exploration themes and ask for the intended
analysis; do not generate syntax before clarification.
Do not treat profile summaries as formal results or infer absent case-level
relationships.
```

The localized form is used according to Chat language settings.

### 6.4 One variable

- Categorical variables favor `FREQUENCIES`, tables, and bar charts.
- Continuous variables favor `DESCRIPTIVES`, `EXAMINE`, histograms, and boxplots.
- Temporal variables favor range, missingness, and time-distribution checks.
- The answer contains executable syntax, brief purpose, and concise next steps such as recoding, plotting, tabulation, or relationship exploration.

### 6.5 Two or three variables

The model chooses methods compatible with measurement levels:

| Combination | Preferred exploration |
| --- | --- |
| categorical × categorical | two- or three-way crosstabs, chi-square, categorical relationship plots |
| continuous × continuous | scatterplots, correlation, simple regression |
| categorical × continuous | grouped descriptives, boxplots, mean comparison, or clearly explained dummy-variable regression |
| three mixed variables | three-way tables, grouped plots, or regression with explicit provisional roles |

The extension must not encourage invalid Pearson correlation or ordinary linear regression for pure categorical variables. If outcome/predictor roles are unknown, any example must label its roles as provisional and ask one focused follow-up question.

### 6.6 More than three variables

The first response proposes grounded exploration themes, possible outcome/explanatory/control/grouping roles, and one focused question. It does not dump variables into a model, assign a causal direction, or generate long executable syntax before the user clarifies the analytical objective.

### 6.7 Deterministic responsibility statement

A system prompt alone cannot guarantee an exact final sentence. Therefore Explore uses both a model instruction and deterministic extension-host post-processing.

Chinese final sentence:

> 以上仅为分析建议；严谨的统计分析还须结合变量内涵、测量层次、取值分布与缺失情况。

English final sentence:

> These are exploratory suggestions only; rigorous analysis requires understanding the variables, measurement levels, value distributions, and missing data.

After a successful Explore response, the host removes an exact duplicate, closes presentation spacing after any code block, and appends the localized sentence once. The processed response is what the UI displays and history stores. Cancelled/failed requests and the fixed out-of-scope refusal do not receive a false analysis disclaimer.

### 6.8 Existing scope boundary

Chat remains limited to SPSS Syntax, SPSS usage, applied statistics in SPSS, and SPSS output interpretation. Clearly unrelated questions trigger the existing fixed refusal. The assistant must not claim generated syntax was executed or verified and must not invent variable meanings or absent row-level relationships.

## 7. Error Handling

| Condition | Required behavior |
| --- | --- |
| no Active Dataset | disable Copy, Insert, and Explore; show `No Active Dataset` |
| no selected variables | disable Copy/Insert; Explore uses first 10 variables |
| more than 20 selected | reject before SPSS or AI access |
| stale/renamed variable | revalidate in extension host and reject stale request |
| engine stopped | follow existing `autoStart` behavior and report exact startup failure |
| engine busy | serialize through the existing bridge queue |
| profile timeout/failure | create no partial Chat message |
| no AI profile | open Chat and direct the user to Manage Models |
| AI request failure | preserve the sent question for inspection/retry |
| no `.sps` editor | refuse Insert without editing another file type |
| clipboard failure | report failure; do not claim success |
| malformed output table | emit labeled structured-text fallback |
| no substantive output | explain that there is no statistical text/table to interpret |

Diagnostic logging must not include API keys, model credentials, variable values, profile summaries, or conversation bodies.

## 8. Testing Strategy

### 8.1 TypeScript unit tests

- rowspan and colspan expansion;
- multi-level headers and empty corner cells;
- row groups, Chinese labels, percentages, negative values, significance marks, and footnotes;
- Notes/runtime metadata filtering;
- row and payload truncation;
- Markdown escaping and hostile HTML inertness;
- Markdown rendering for user messages;
- Variables selection persistence/intersection/reset;
- Copy/Insert order and exact spacing;
- multi-cursor insertion and non-`.sps` refusal;
- Explore selection defaults and 20/21-variable boundaries;
- prompt construction and language behavior;
- deterministic disclaimer placement and deduplication;
- conversation-context migration.

### 8.2 Python bridge tests

- protocol validation and unknown variables;
- categorical, continuous, string, and temporal profiles;
- system/user missing handling;
- value-label extraction and caps;
- high-cardinality bounded behavior;
- streaming mean and sample standard deviation;
- 20-variable limit;
- cleanup after errors;
- dataset remains unchanged.

### 8.3 Webview and extension tests

- checkbox behavior across pages;
- superscript Explore-help hover, focus, click, and accessible label;
- toolbar ordering and compact layout;
- duplicate Explore prevention;
- automatic switch to current Chat;
- safe table rendering and horizontal scrolling;
- light/dark theme readability;
- narrow laptop split-view layout.

### 8.4 Regression and real-SPSS verification

Run the existing verification suite and add a reduced, sanitized fixture based on genuine SPSS native HTML. Manual real-SPSS checks cover Output Explain, Variables selection, profile extraction, current-Chat dispatch, and dataset non-mutation. No personal file path or dataset content enters committed fixtures.

## 9. Documentation, Privacy Audit, and Release

### 9.1 Documentation

README documents structured Output Explain, Variables selection, Copy/Insert/Explore, selection/default limits, summary types, provider data exposure, high-cardinality behavior, Filter/Weight/Split boundaries, and the fact that Explore is not formal statistical output.

CHANGELOG receives a user-facing `0.9.0 — 2026-10-03` entry without implementation-process notes.

### 9.2 Packaging audit

Before release, inspect the VSIX manifest and archive contents. It must not contain API keys, model profiles, Chat history, global storage, SecretStorage, datasets, original Output files, local paths, logs, design/process documents, or test data. Only runtime-necessary compiled files, Webview resources, syntax/theme assets, bridge code, product documentation, license, package metadata, and icon are allowed.

Any new HTML parser must be small, actively suitable for Node extension-host use, license-compatible with distribution, and verified inside the packaged VSIX. A full browser DOM or large rendering framework is out of scope.

### 9.3 Version and artifact

Version changes from 0.8.1 to 0.9.0. The release artifact is:

```text
dist/spss-studio-0.9.0.vsix
```

The delivery report includes test results, artifact path, byte size, SHA-256, local Git commits, any manual-only checks, and the Marketplace publication command.

## 10. Git and Execution Boundaries

Implementation commits follow Conventional Commits. This design approval authorizes local design and implementation work after a separately reviewed implementation plan. It does not authorize `git push`; remote publication requires explicit user approval.

The implementation sequence is:

1. approve and commit this design;
2. review this document;
3. prepare and approve a file-by-file implementation plan;
4. implement tests and code;
5. verify, package, and audit the VSIX;
6. request separate authorization before pushing GitHub.
