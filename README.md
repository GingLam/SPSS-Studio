# SPSS Studio

SPSS Studio is a Visual Studio Code extension for editing and running IBM SPSS Statistics Syntax (`.sps`). It provides syntax highlighting, context-aware completion, a persistent local SPSS execution engine, native OMS HTML output, and read-only Active Dataset previews.

Author：Jing LIN (林景)

Affiliation：Associate Professor, Nanjing University of Finance and Economics

Contact：[linjing@nufe.edu.cn](mailto:linjing@nufe.edu.cn)

> SPSS Studio is independently developed. It is not affiliated with, endorsed by, or sponsored by IBM.

## Features

- Generated TextMate highlighting based on a 309-command IBM SPSS Statistics syntax inventory.
- Context-aware completion for commands, subcommands, keywords, functions, snippets, and cached Active Dataset variables.
- Editor-title actions for Undo, Run, and Run All.
- A persistent, serialized local SPSS backend.
- Native OMS HTML output with run history, safe standalone HTML export, and browser-based printing.
- Read-only Data and Variables views for the current Active Dataset.
- Automatic IBM SPSS Statistics discovery on macOS and Windows, with manual path overrides.

## Requirements

- Visual Studio Code 1.95 or newer.
- A locally installed and licensed IBM SPSS Statistics with the Python Integration Package.
- A trusted VS Code workspace for execution and Active Dataset access.

IBM SPSS Statistics 27 has been tested on macOS. Windows discovery, Registry parsing, paths containing spaces, batch-launch transport, and paging behavior are covered by automated tests, but Windows execution against a real SPSS installation has not yet been validated.

No separate Python installation is normally required. SPSS Studio prefers IBM's `statisticspython3` launcher and uses IBM's bundled Python only as a fallback.

## Installation

Install **SPSS Studio** from the Extensions view in Visual Studio Code, then open a `.sps` file. VS Code automatically assigns the **SPSS Syntax** language mode.

## Running syntax

- macOS: `Cmd+Enter`
- Windows/Linux: `Ctrl+Enter`
- Command Palette: **SPSS: Run Selection / Current Command**

With a selection, Run submits the selected syntax. Without a selection, it identifies and submits the current SPSS command or structural block. Run All submits the complete in-memory document, including unsaved changes. Undo uses VS Code's native undo stack.

The first execution starts one persistent local SPSS processor. Run, metadata, and data-page requests share one serialized queue so that two calls never enter SPSS concurrently.

SPSS Studio expands leading TAB indentation on SPSS command lines only at the final submission boundary. This avoids the SPSS 27 external Python `Submit` failure caused by literal TAB characters while preserving quoted strings and `BEGIN DATA`, `BEGIN PROGRAM`, `BEGIN GPL`, `BEGIN SCRIPT`, and `MATRIX` bodies. The source document is never modified.

## Output

Each execution uses one private, uniquely tagged, short-lived OMS HTML destination. The SPSS Studio panel places the selected result on the left and run history on the right.

- **Export HTML** saves the selected output as a sanitized, self-contained HTML file.
- **Print** opens a print-ready copy in the default browser.
- **SPSS: Clear Output** removes output files from the current extension session without changing the Active Dataset.

The extension displays native SPSS HTML rather than reconstructing statistical tables. It does not generate SPV or OXML files and does not use `SpssClient`.

Execution statuses are `SUCCESS`, `SUCCESS_NO_OUTPUT`, `WARNING`, `ERROR`, `ENGINE_ERROR`, and `TIMEOUT`.

## Data and Variables

**SPSS: Show Data** opens a read-only view of the current Active Dataset. Rows are paged, while variables are available through continuous horizontal scrolling. The bridge never calls `fetchall` and limits each request to 500 rows and 200 variables.

**SPSS: Show Variables** displays variable order, Name, Label, Type, Format, and Measure. It reuses metadata already cached for completion and Data preview and does not modify the SPSS data dictionary.

## Commands

- **SPSS: Run Selection / Current Command**
- **SPSS: Run File**
- **SPSS: Undo Last Edit**
- **SPSS: Start Engine**
- **SPSS: Stop Engine**
- **SPSS: Restart Engine**
- **SPSS: Show Status**
- **SPSS: Show Output**
- **SPSS: Show Data**
- **SPSS: Show Variables**
- **SPSS: Refresh Data Preview**
- **SPSS: Clear Output**

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `spssStudio.installPath` | empty | IBM SPSS Statistics installation root; empty enables automatic discovery. |
| `spssStudio.pythonLauncherPath` | empty | IBM `statisticspython3` launcher; empty enables automatic discovery. |
| `spssStudio.startupTimeoutSeconds` | `45` | Maximum engine startup time. |
| `spssStudio.executionTimeoutSeconds` | `300` | Maximum time for one execution request. |
| `spssStudio.dataPreviewPageSize` | `100` | Active Dataset rows per page: 25, 50, 100, 200, or 500. |
| `spssStudio.autoStart` | `true` | Start the engine when syntax is first executed. |
| `spssStudio.debugLogging` | `false` | Write additional bridge diagnostics. |

On Windows, JSON settings paths must escape backslashes, for example `C:\\Program Files\\IBM\\SPSS Statistics\\32`.

## Workspace trust and local processing

Syntax highlighting and static completion remain available in an untrusted workspace. Starting SPSS, executing syntax, and accessing the Active Dataset require a trusted workspace.

SPSS syntax and dataset requests are sent to the locally installed IBM SPSS Statistics processor. The extension does not provide a cloud execution service.

## Development

Node.js 22 or newer and npm are required.

```sh
npm ci
npm run verify
npm run package
```

`npm run verify` regenerates and checks the grammar, compiles TypeScript, runs ESLint, executes the TypeScript unit tests, and executes the Python Bridge tests. `npm run package` repeats verification before creating the VSIX under `dist/`.

Architecture, syntax coverage, and troubleshooting details are available in:

- [Architecture](docs/ARCHITECTURE.md)
- [Syntax coverage](docs/SYNTAX-COVERAGE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

Report reproducible defects through [GitHub Issues](https://github.com/GingLam/SPSS-Studio/issues).

## Limitations

SPSS Studio is not an LSP or a full semantic validator. It does not provide statistical menus, editable Data View cells, variable metadata editing, AI features, paper-table generation, or a general SPV viewer. Variables is intentionally read-only, and exported output is HTML rather than SPV.

## License

SPSS Studio is proprietary software distributed free of charge for permitted use. The source code is publicly visible for review but is not open source. Modification, derivative works, sale, sublicensing, republication, redistribution, and repackaging are prohibited unless prior written permission is granted. See [LICENSE](LICENSE) for the complete terms.

Copyright © 2026 Jing LIN (林景). All rights reserved.

IBM and SPSS are trademarks of International Business Machines Corporation, registered in many jurisdictions worldwide. All other trademarks belong to their respective owners.
