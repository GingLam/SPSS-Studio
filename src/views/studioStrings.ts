import type { EngineState, ExecutionStatus } from '../spss/types';

export interface StudioStrings {
  tabVariables: string;
  tabData: string;
  tabOutput: string;
  tabChat: string;
  enginePrefix: string;
  engineStates: Record<EngineState, string>;
  executionStatuses: Record<ExecutionStatus | 'RUNNING', string>;
  outputExplain: string;
  outputExport: string;
  outputPrint: string;
  outputHistory: string;
  noExecutions: string;
  resizeRunHistory: string;
  runs: string;
  clear: string;
  clearOutput: string;
  runNumber: string;
  errorLevel: string;
  duration: string;
  executionRunning: string;
  executionNoDisplayOutput: string;
  executionNoHtmlOutput: string;
  noActiveDataset: string;
  refresh: string;
  previousRows: string;
  nextRows: string;
  rows: string;
  dataset: string;
  cases: string;
  variables: string;
  weight: string;
  split: string;
  filter: string;
  casesUnknown: string;
  rowRange: string;
  variablesSelected: string;
  copy: string;
  insert: string;
  explore: string;
  exploring: string;
  exploreHelp: string;
  variableSelection: string;
  name: string;
  label: string;
  type: string;
  format: string;
  measure: string;
  previous: string;
  next: string;
  filterNameOrLabel: string;
  itemRange: string;
  filteredItemRange: string;
  selectVariable: string;
  doubleClickInsert: string;
}

export const STUDIO_STRINGS_EN: StudioStrings = {
  tabVariables: 'Variables',
  tabData: 'Data',
  tabOutput: 'Output',
  tabChat: 'Chat',
  enginePrefix: 'SPSS',
  engineStates: {
    stopped: 'Stopped',
    starting: 'Starting',
    ready: 'Ready',
    running: 'Running',
    error: 'Error',
  },
  executionStatuses: {
    RUNNING: 'Running',
    SUCCESS: 'Success',
    SUCCESS_NO_OUTPUT: 'Success, no output',
    WARNING: 'Warning',
    ERROR: 'Error',
    ENGINE_ERROR: 'Engine error',
    TIMEOUT: 'Timeout',
  },
  outputExplain: 'Explain',
  outputExport: 'Export',
  outputPrint: 'Print',
  outputHistory: 'History',
  noExecutions: 'No executions yet.',
  resizeRunHistory: 'Resize run history',
  runs: 'Runs',
  clear: 'Clear',
  clearOutput: 'Clear output',
  runNumber: 'Run #{number}',
  errorLevel: 'Error level',
  duration: 'Duration',
  executionRunning: 'SPSS execution is running…',
  executionNoDisplayOutput: 'Execution completed successfully. SPSS produced no display output.',
  executionNoHtmlOutput: 'No SPSS HTML output is available for this execution.',
  noActiveDataset: 'No Active Dataset.',
  refresh: 'Refresh',
  previousRows: 'Previous rows',
  nextRows: 'Next rows',
  rows: 'Rows',
  dataset: 'Dataset',
  cases: 'Cases',
  variables: 'Variables',
  weight: 'Weight',
  split: 'Split',
  filter: 'Filter',
  casesUnknown: 'Unknown until data are materialized',
  rowRange: '{first}–{last} of {total}',
  variablesSelected: '{count} selected',
  copy: 'Copy',
  insert: 'Insert',
  explore: 'Explore',
  exploring: 'Exploring…',
  exploreHelp: 'Send selected variables’ metadata and bounded summaries to Chat. With no selection, the first 10 filtered variables are used.',
  variableSelection: 'Variable selection',
  name: 'Name',
  label: 'Label',
  type: 'Type',
  format: 'Format',
  measure: 'Measure',
  previous: 'Previous',
  next: 'Next',
  filterNameOrLabel: 'Filter Name or Label',
  itemRange: '{first}–{last} of {count}',
  filteredItemRange: '{range} ({total} total)',
  selectVariable: 'Select {name}',
  doubleClickInsert: 'Double-click to insert {name}',
};

export const STUDIO_STRINGS_ZH_CN: StudioStrings = {
  tabVariables: '变量',
  tabData: '数据',
  tabOutput: '输出',
  tabChat: '对话',
  enginePrefix: 'SPSS',
  engineStates: {
    stopped: '已停止',
    starting: '正在启动',
    ready: '就绪',
    running: '正在运行',
    error: '错误',
  },
  executionStatuses: {
    RUNNING: '正在运行',
    SUCCESS: '成功',
    SUCCESS_NO_OUTPUT: '成功，无输出',
    WARNING: '警告',
    ERROR: '错误',
    ENGINE_ERROR: '引擎错误',
    TIMEOUT: '超时',
  },
  outputExplain: '解释',
  outputExport: '导出',
  outputPrint: '打印',
  outputHistory: '历史',
  noExecutions: '暂无执行记录。',
  resizeRunHistory: '调整运行记录宽度',
  runs: '运行记录',
  clear: '清空',
  clearOutput: '清空输出',
  runNumber: '运行 #{number}',
  errorLevel: '错误级别',
  duration: '用时',
  executionRunning: 'SPSS 正在执行……',
  executionNoDisplayOutput: '执行成功，SPSS 未生成可显示的结果。',
  executionNoHtmlOutput: '本次执行没有可用的 SPSS HTML 输出。',
  noActiveDataset: '当前没有活动数据集。',
  refresh: '刷新',
  previousRows: '上一页',
  nextRows: '下一页',
  rows: '每页行数',
  dataset: '数据集',
  cases: '个案数',
  variables: '变量数',
  weight: '加权',
  split: '拆分',
  filter: '筛选',
  casesUnknown: '数据完成处理后方可确定',
  rowRange: '第 {first}–{last} 行，共 {total} 行',
  variablesSelected: '已选 {count} 个',
  copy: '复制',
  insert: '插入',
  explore: '探索',
  exploring: '正在探索……',
  exploreHelp: '将所选变量的元数据与有限统计摘要发送至对话；未选择变量时，使用当前筛选结果的前 10 个变量。',
  variableSelection: '选择变量',
  name: '名称',
  label: '标签',
  type: '类型',
  format: '格式',
  measure: '测量层次',
  previous: '上一页',
  next: '下一页',
  filterNameOrLabel: '按名称或标签筛选',
  itemRange: '第 {first}–{last} 项，共 {count} 项',
  filteredItemRange: '{range}（总计 {total} 项）',
  selectVariable: '选择 {name}',
  doubleClickInsert: '双击插入 {name}',
};

export function studioStringsForLanguage(language: string): StudioStrings {
  return language.toLowerCase() === 'zh-cn' ? STUDIO_STRINGS_ZH_CN : STUDIO_STRINGS_EN;
}
