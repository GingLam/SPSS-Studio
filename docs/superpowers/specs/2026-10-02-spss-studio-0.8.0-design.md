# SPSS Studio 0.8.0 Design

## Status

Approved on 2026-10-02. This document defines the product and technical scope for version 0.8.0. It does not authorize Marketplace publication.

## Objectives

Version 0.8.0 will turn SPSS Syntax highlighting into a durable developer-facing system rather than a shallow keyword colorizer. It will also keep Chat code blocks visually and lexically aligned with the editor, constrain Chat to the SPSS and applied-statistics domain, add provider-aware reasoning control, and refresh the public product description.

Success requires:

- clear, low-fatigue visual separation of SPSS commands, subcommands, variables, functions, literals, operators, and supporting syntax in long files;
- exact editor/Chat palette parity when either bundled SPSS Studio theme is active;
- one generated syntax vocabulary and classification model rather than separate editor and Chat lists;
- lightweight, SPSS-specific Chat behavior without an additional classification request;
- explicit provider-native reasoning controls that never silently enable reasoning;
- a verified 0.8.0 VSIX that excludes API keys, conversation history, and development-only files; and
- one README used both by the VS Code Marketplace package and the GitHub repository homepage.

## Scope and non-goals

### In scope

- A revised generated TextMate grammar and token taxonomy.
- Bundled `SPSS Studio Light` and `SPSS Studio Dark` color themes.
- A Chat SPSS tokenizer and palette generated from the same syntax and theme sources.
- A concise SPSS-domain system instruction with a localized refusal contract.
- Per-model-profile reasoning enablement, disabled by default.
- A model-profile schema migration that preserves existing profiles and SecretStorage keys.
- Cleanup of the verified legacy SecretStorage key after migration.
- Version, README, CHANGELOG, packaging, automated tests, and GitHub synchronization.

### Out of scope

- A full SPSS parser, language server, semantic validator, or diagnostics engine.
- Automatic activation of a bundled VS Code color theme.
- Editing user or workspace `editor.tokenColorCustomizations`.
- Keyword-based local domain blocking or a second AI request for domain classification.
- Displaying, persisting, or replaying provider `reasoning_content`.
- Guessing reasoning parameters for arbitrary custom OpenAI-compatible endpoints.
- Publishing version 0.8.0 to the VS Code Marketplace.

## Syntax architecture

### Source of truth

`syntax/spss-language.json` remains the canonical vocabulary source. A small, reviewable theme/taxonomy source will define token-family identifiers and the Light/Dark presentation rules. The grammar generator will produce all derived artifacts so that editor and Chat coverage cannot drift silently.

Generated artifacts will include:

1. `syntaxes/spss.tmLanguage.json` for the native editor;
2. `media/spss-syntax-data.js` for the Chat tokenizer;
3. theme color files or generated theme fragments for the bundled themes; and
4. the syntax coverage document.

Generated-file checks will fail when any derived artifact is stale.

### Token taxonomy

The grammar and Chat tokenizer will distinguish at least these families:

| Family | Examples | Visual role |
| --- | --- | --- |
| Control command | `DO IF`, `LOOP`, `BEGIN PROGRAM` | Strongest structural emphasis |
| Procedure/data command | `REGRESSION`, `COMPUTE`, `GET FILE` | Primary command emphasis |
| Subcommand | `/DEPENDENT`, `/STATISTICS` | Secondary command emphasis |
| Structural/reserved keyword | `BY`, `WITH`, `TO`, `ALL` | Grammar connective |
| Function | `MEAN`, `CDF.NORMAL`, `LAG` | Callable operation |
| Format | `F8.2`, `A20`, `DATE11` | Type/format cue |
| Ordinary variable | `income`, `education` | Neutral but clearly legible identifier |
| System variable | `$CASENUM`, `$SYSMIS` | Special built-in identifier |
| Scratch variable | `#index` | Temporary identifier |
| Macro directive/variable | `!DO`, `!value` | Macro-language cue |
| String | `'female'`, `"file.sav"` | Literal value |
| Number | `0.05`, `99`, `.5E-2` | Numeric literal |
| Missing value | `SYSMIS`, `LO`, `HI`, `THRU` | Special constant |
| Arithmetic operator | `+`, `-`, `*`, `/`, `**` | Calculation cue |
| Relational operator | `=`, `<>`, `GE`, `LT` | Comparison cue |
| Logical operator | `AND`, `OR`, `NOT`, `&`, `|` | Boolean cue |
| Comment | command and block comments | De-emphasized annotation |
| Punctuation/terminator | `(`, `)`, `,`, final `.` | Low-emphasis structure |

Ordering must protect strings, comments, and raw block bodies before keyword matching. Slash-prefixed subcommands must not misclassify arithmetic division. Unknown commands, subcommands, and functions retain forward-compatible fallback scopes.

### Visual system

The bundled themes will follow mature Python/C++ theme principles: a limited set of stable hue families, strong hierarchy for control and command tokens, quieter variables and punctuation, and restrained use of bold and italic. They will not assign an unrelated bright color to every token.

Both themes must:

- keep ordinary source text comfortable for long reading sessions;
- make primary commands, subcommands, functions, literals, and comments distinguishable without relying on color alone;
- preserve legibility for Chinese comments and mixed Chinese/English syntax;
- meet an automated minimum contrast target for syntax foregrounds against the editor background, with documented exceptions only for deliberately de-emphasized punctuation; and
- keep selection and error decorations readable.

The themes are optional contributions. Installation never changes `workbench.colorTheme`. Users select them through VS Code's normal Color Theme picker.

## Editor and Chat parity

The Chat tokenizer will consume the generated vocabulary and emit the same family identifiers used by the editor grammar. The bundled theme palettes will be available to the Webview through generated CSS variables or data.

When `SPSS Studio Light` or `SPSS Studio Dark` is active, Chat SPSS code blocks will use the exact same token colors and font styles as the editor. With any other theme, the editor follows that theme and Chat uses a compatible light/dark fallback; lexical categories remain identical, but exact color equality is not promised.

Parity tests will cover every canonical command and the shared inventories for subcommands, functions, formats, macro directives, and system variables. A representative long-syntax fixture will cover comments, strings, numeric expressions, division, block forms, and forward-compatible fallbacks.

## Chat domain boundary

The system instruction will remain short. It will define the supported domain as:

- SPSS Syntax authoring and explanation;
- editing and using IBM SPSS Statistics;
- implementing statistical methods in SPSS; and
- interpreting SPSS statistical output.

For a clearly unrelated request, it will instruct the model to give one short localized refusal and redirect the user to an SPSS-related question. The refusal will preserve the configured Chinese or English response language.

The extension will not claim perfect enforcement. System-prompt compliance is probabilistic and controlled by the selected third-party model. A keyword gate would create unacceptable false positives, and a classifier request would add latency and token cost without eliminating error. Automated tests therefore verify the instruction contract rather than claiming deterministic semantic blocking.

## Reasoning control

### Profile model

Reasoning is a boolean property stored independently on each model profile. It defaults to `false`. Existing 0.7.0 profiles migrate with reasoning disabled. The setting is non-secret global extension state; API keys remain in VS Code SecretStorage.

The Manage Models form will show a localized `Enable reasoning` checkbox. It is unchecked by default. For the Custom provider, the control is unavailable and explains that SPSS Studio does not guess private provider parameters.

### Request mapping

The request builder will use only the documented native fields:

| Provider | Disabled | Enabled |
| --- | --- | --- |
| DeepSeek | `thinking: { type: "disabled" }` | `thinking: { type: "enabled" }` |
| Zhipu GLM | `thinking: { type: "disabled" }` | `thinking: { type: "enabled" }` |
| Qwen | `enable_thinking: false` | `enable_thinking: true` |
| Doubao | `thinking: { type: "disabled" }` | `thinking: { type: "enabled" }` |
| Custom | no reasoning field | no reasoning field |

If a selected model rejects the requested mode, the extension surfaces the provider error. It must not retry with reasoning enabled, change the saved preference, or silently fall back to provider defaults.

Streaming continues to collect only final `content`. Any `reasoning_content` is ignored and is not displayed or stored in conversation history.

## Storage migration and privacy

The model-profile schema version will advance. Migration must:

1. validate the existing profile index;
2. copy every profile and preserve ids, names, providers, URLs, models, timestamps, active selection, and SecretStorage key association;
3. add `reasoningEnabled: false` when absent;
4. write and re-read the new index before declaring success; and
5. delete the legacy SecretStorage key only after the destination key is verified.

Migration must be idempotent. Failure leaves the last valid stored state usable and must never log a secret value.

The VSIX packaging policy continues to exclude SecretStorage, extension global storage, conversation history, `.env` files, logs, tests, and development state. Archive inspection and high-confidence secret-pattern scanning remain release gates.

## Public description

The README will begin with this English paragraph:

> **SPSS Studio is an exceptionally powerful integrated environment for developing, executing, and interpreting SPSS Syntax.** It grew out of a vision that its designer, Jing LIN, has carried throughout his years of teaching statistics at university: to bring professional syntax highlighting and completion, connection to and execution through a local IBM SPSS Statistics engine, dataset management and output, and AI-assisted dialogue into one coherent workflow. It helps professional researchers write, run, inspect, and understand SPSS statistical analyses efficiently, conveniently, and elegantly—giving a youthful character to a venerable statistical package with a history of nearly sixty years.

It will be followed immediately by the approved Chinese paragraph without editorial alteration:

> **SPSS Studio 是一个功能极端强大的 SPSS Syntax 集成式开发、执行与解释环境。** 它源于设计者Jing LIN在大学任教统计学课程以来念兹在兹的愿景：将IBM SPSS Statistics软件的专业语法高亮与补全、本地计算引擎链接与执行、数据集管理与输出以及 AI 问答交互和谐地整合在同一工作流中，助力专业研究人员以高效、便捷、优雅的方式编写、运行、检查和理解SPSS统计分析，赋予这个拥有近60年历史的古老统计软件以年轻的气质。

The history heading becomes `Version History`; the Chinese suffix is removed. README and CHANGELOG will describe 0.8.0. The repository homepage uses this same tracked README, so no parallel GitHub-only description is maintained.

## Versioning and packaging

`package.json` and `package-lock.json` advance to 0.8.0. The package allowlist will include only the required theme assets and generated runtime files. The final artifact will be `dist/spss-studio-0.8.0.vsix`.

GitHub synchronization is part of this implementation after local verification and commit. VS Code Marketplace publication is explicitly separate and requires a later authorized release action.

## Verification

Automated verification will cover:

- TextMate scopes for every token family;
- Chat/editor vocabulary and taxonomy parity;
- Light/Dark palette completeness and contrast;
- correct tokenization of the long syntax fixture;
- no subcommand classification after arithmetic division;
- reasoning request bodies for all four built-in providers;
- absence of reasoning fields for Custom profiles;
- profile-schema migration, idempotence, and legacy-key cleanup;
- Chinese and English domain-boundary instructions;
- package allowlist enforcement; and
- VSIX archive and suspected-secret scans.

The release candidate must pass `npm run verify`, `npm run package`, and an explicit VSIX manifest inspection. Relevant integration tests will be run where the local environment supports them. Real-SPSS execution tests are not required for a syntax-theme and Chat-request release unless implementation changes the engine boundary.

## Acceptance criteria

0.8.0 is complete when:

1. long `.sps` files show an obvious, low-fatigue hierarchy under both bundled themes;
2. editor and Chat token classifications are generated from one source and exact palette parity holds under bundled themes;
3. Chat refuses clearly unrelated requests according to the concise localized instruction;
4. reasoning defaults off per profile and uses only the documented provider mapping;
5. existing profiles and API-key access survive migration without exposing credentials;
6. the approved bilingual opening and English-only history heading appear in README;
7. all verification and packaging gates pass;
8. the 0.8.0 commit is pushed to the existing GitHub repository; and
9. no Marketplace publication occurs as part of this work.
