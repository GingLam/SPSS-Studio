export interface RuntimeStrings {
  statusBarTooltip: string;
  configurationMigrationFailed: string;
  variableExploreRequiresTrusted: string;
  studioNotReady: string;
  exploreRequiresVariables: string;
  openSpssEditor: string;
  activeEditorNotSpss: string;
  selectedSyntaxEmpty: string;
  cursorInComment: string;
  noCommandAtCursor: string;
  insertRequiresEditor: string;
  variableUnavailable: string;
  selectedVariablesUnavailable: string;
  untrustedExecution: string;
  manageWorkspaceTrust: string;
  couldNotStartSpss: string;
  couldNotRestartSpss: string;
  state: string;
  version: string;
  lastError: string;
  notDetected: string;
  none: string;
  executionFailed: string;
  dataPageFailed: string;
  exportSaveLabel: string;
  outputExported: string;
  outputExportFailed: string;
  noExplainableOutput: string;
  copyVariablesFailed: string;
  insertVariablesFailed: string;
  exploreLimit: string;
  preparingVariableSummaries: string;
  exploreVariablesFailed: string;
  printableOutputNotOpened: string;
  printableOutputFailed: string;
  selectedRunNoHtml: string;
  selectedHtmlUnavailable: string;
}

export const RUNTIME_STRINGS_EN: RuntimeStrings = {
  statusBarTooltip: 'Show IBM SPSS Statistics engine status',
  configurationMigrationFailed: 'SPSS AI configuration migration failed',
  variableExploreRequiresTrusted: 'Variable Explore requires a trusted workspace.',
  studioNotReady: 'SPSS Studio is not ready.',
  exploreRequiresVariables: 'Explore requires between 1 and 20 variables.',
  openSpssEditor: 'Open an SPSS Syntax (.sps) editor first.',
  activeEditorNotSpss: 'The active editor is not an SPSS Syntax document.',
  selectedSyntaxEmpty: 'The selected SPSS Syntax is empty.',
  cursorInComment: 'The cursor is inside an SPSS command comment.',
  noCommandAtCursor: 'No SPSS command exists at the cursor position.',
  insertRequiresEditor: 'Open an SPSS Syntax editor before inserting a variable.',
  variableUnavailable: 'That variable is no longer available in the current Active Dataset.',
  selectedVariablesUnavailable: 'One or more selected variables are no longer available in the current Active Dataset.',
  untrustedExecution: 'Running SPSS Syntax executes code and is disabled in an untrusted workspace.',
  manageWorkspaceTrust: 'Manage Workspace Trust',
  couldNotStartSpss: 'Could not start SPSS',
  couldNotRestartSpss: 'Could not restart SPSS',
  state: 'State',
  version: 'Version',
  lastError: 'Last error',
  notDetected: 'not detected',
  none: 'none',
  executionFailed: 'SPSS execution failed',
  dataPageFailed: 'Could not read Active Dataset page',
  exportSaveLabel: 'Export SPSS HTML',
  outputExported: 'SPSS output exported to {path}.',
  outputExportFailed: 'Could not export SPSS output',
  noExplainableOutput: 'The selected run contains no statistical tables or text to explain. Figures and system metadata are skipped.',
  copyVariablesFailed: 'Could not copy variables',
  insertVariablesFailed: 'Could not insert variables',
  exploreLimit: 'Explore can process at most 20 variables at a time. Reduce the selection.',
  preparingVariableSummaries: 'SPSS Studio: preparing variable summaries…',
  exploreVariablesFailed: 'Could not explore SPSS variables',
  printableOutputNotOpened: 'The system did not open the printable SPSS output.',
  printableOutputFailed: 'Could not prepare SPSS output for printing',
  selectedRunNoHtml: 'The selected run has no HTML output to explain, export, or print.',
  selectedHtmlUnavailable: 'The selected SPSS HTML output file is no longer available.',
};

export const RUNTIME_STRINGS_ZH_CN: RuntimeStrings = {
  statusBarTooltip: '查看 IBM SPSS Statistics 引擎状态',
  configurationMigrationFailed: 'SPSS AI 配置迁移失败',
  variableExploreRequiresTrusted: '变量探索需要受信任的工作区。',
  studioNotReady: 'SPSS Studio 尚未准备就绪。',
  exploreRequiresVariables: '探索功能需要选择 1 至 20 个变量。',
  openSpssEditor: '请先打开 SPSS Syntax（.sps）编辑器。',
  activeEditorNotSpss: '当前编辑器不是 SPSS Syntax 文档。',
  selectedSyntaxEmpty: '所选 SPSS Syntax 为空。',
  cursorInComment: '光标位于 SPSS 命令注释中。',
  noCommandAtCursor: '光标所在位置没有可执行的 SPSS 命令。',
  insertRequiresEditor: '请先打开 SPSS Syntax 编辑器，再插入变量。',
  variableUnavailable: '该变量已不在当前活动数据集中。',
  selectedVariablesUnavailable: '一个或多个所选变量已不在当前活动数据集中。',
  untrustedExecution: '运行 SPSS Syntax 会执行代码，因此不受信任的工作区已禁用此功能。',
  manageWorkspaceTrust: '管理工作区信任',
  couldNotStartSpss: '无法启动 SPSS',
  couldNotRestartSpss: '无法重启 SPSS',
  state: '状态',
  version: '版本',
  lastError: '最近错误',
  notDetected: '未检测到',
  none: '无',
  executionFailed: 'SPSS 执行失败',
  dataPageFailed: '无法读取活动数据集页面',
  exportSaveLabel: '导出 SPSS HTML',
  outputExported: 'SPSS 输出已导出至 {path}。',
  outputExportFailed: '无法导出 SPSS 输出',
  noExplainableOutput: '所选运行不含可供解释的统计表格或文字；图形和系统元数据已跳过。',
  copyVariablesFailed: '无法复制变量',
  insertVariablesFailed: '无法插入变量',
  exploreLimit: '探索功能每次最多处理 20 个变量，请减少选择数量。',
  preparingVariableSummaries: 'SPSS Studio：正在准备变量摘要……',
  exploreVariablesFailed: '无法探索 SPSS 变量',
  printableOutputNotOpened: '系统未能打开可打印的 SPSS 输出。',
  printableOutputFailed: '无法准备可打印的 SPSS 输出',
  selectedRunNoHtml: '所选运行没有可供解释、导出或打印的 HTML 输出。',
  selectedHtmlUnavailable: '所选 SPSS HTML 输出文件已不可用。',
};

export function runtimeStringsForLanguage(language: string): RuntimeStrings {
  return language.toLowerCase() === 'zh-cn' ? RUNTIME_STRINGS_ZH_CN : RUNTIME_STRINGS_EN;
}

export function formatLocalized(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-z]+)\}/giu, (match, key: string) => values[key] ?? match);
}
