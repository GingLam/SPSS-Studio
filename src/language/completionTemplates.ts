export interface SyntaxTemplate {
  id: string;
  command: string;
  pattern: string;
  variant?: string;
}

export interface TemplateSlot {
  start: number;
  end: number;
  hint: string;
  field: string;
}

export interface RenderedTemplate {
  text: string;
  snippet: string;
  preview: string;
  slots: TemplateSlot[];
}

function template(id: string, command: string, tail = '.', variant?: string): SyntaxTemplate {
  return { id, command, pattern: command + tail, ...(variant ? { variant } : {}) };
}

export const COMMAND_TEMPLATES: readonly SyntaxTemplate[] = [
  template('cd', 'CD', ' "{directory}".'),
  template('get-file', 'GET FILE', ' "{savFile}".'),
  template('get-xlsx', 'GET DATA', ' /TYPE=XLSX /FILE="{xlsxFile}".', 'Excel'),
  template('get-csv', 'GET DATA', ' /TYPE=TXT /FILE="{csvFile}" /ARRANGEMENT=DELIMITED /DELIMITERS=","\n /VARIABLES={columnDefinitions}.', 'CSV'),
  template('new-file', 'NEW FILE'),
  template('dataset-name', 'DATASET NAME', ' {dataset}.'),
  template('dataset-activate', 'DATASET ACTIVATE', ' {dataset}.'),
  template('dataset-declare', 'DATASET DECLARE', ' {dataset}.'),
  template('dataset-copy', 'DATASET COPY', ' {dataset}.'),
  template('dataset-close', 'DATASET CLOSE', ' {dataset}.'),
  template('dataset-display', 'DATASET DISPLAY'),
  template('save', 'SAVE', ' OUTFILE "{savFile}".'),
  template('save-csv', 'SAVE TRANSLATE', ' OUTFILE="{csvFile}" /TYPE=CSV.', 'CSV'),
  template('sysfile-info', 'SYSFILE INFO', ' FILE="{savFile}".'),
  template('dictionary', 'DISPLAY', ' DICTIONARY.'),
  template('codebook', 'CODEBOOK', ' {variables}.'),
  template('list', 'LIST', ' {variables} /CASES=TO {lastCase}.'),
  template('data-list', 'DATA LIST', ' FREE /{columnDefinitions}.'),
  template('get-stata', 'GET STATA', ' FILE="{stataFile}".'),
  template('get-sas', 'GET SAS', ' DATA="{sasFile}".'),
  template('insert', 'INSERT', ' FILE="{syntaxFile}".'),
  template('variable-labels', 'VARIABLE LABELS', ' {variable} "{label}".'),
  template('value-labels', 'VALUE LABELS', ' {variable} {value} "{label}".'),
  template('add-value-labels', 'ADD VALUE LABELS', ' {variable} {value} "{label}".'),
  template('variable-level', 'VARIABLE LEVEL', ' {variable} ({level}).'),
  template('missing-values', 'MISSING VALUES', ' {variable} ({missingCode}).'),
  template('formats', 'FORMATS', ' {variables} ({format}).'),
  template('numeric', 'NUMERIC', ' {newVariables}.'),
  template('string', 'STRING', ' {newVariables} (A{width}).'),
  template('alter-type', 'ALTER TYPE', ' {variables} ({format}).'),
  template('rename', 'RENAME VARIABLES', ' ({variable} = {newVariable}).'),
  template('delete-variables', 'DELETE VARIABLES', ' {variables}.'),
  template('compute', 'COMPUTE', ' {newVariable} = {expression}.'),
  template('if', 'IF', ' ({condition}) {newVariable} = {expression}.'),
  template('do-if', 'DO IF', ' {condition}.\n {statement}\nEND IF.'),
  template('do-repeat', 'DO REPEAT', ' {iterator} = {variables}.\n {statement}\nEND REPEAT.'),
  template('loop', 'LOOP', ' {iterator} = {start} TO {stop}.\n {statement}\nEND LOOP.'),
  template('recode', 'RECODE', ' {variable} ({oldValues}={newValue}) INTO {newVariable}.'),
  template('autorecode', 'AUTORECODE', ' VARIABLES={variable} /INTO {newVariable}.'),
  template('count', 'COUNT', ' {newVariable} = {variables} ({value}).'),
  template('sort', 'SORT CASES', ' BY {keys}.'),
  template('sort-variables', 'SORT VARIABLES', ' {attribute}.'),
  template('select-if', 'SELECT IF', ' ({condition}).'),
  template('temporary', 'TEMPORARY'),
  template('filter', 'FILTER', ' BY {indicator}.'),
  template('filter-off', 'FILTER', ' OFF.', 'OFF'),
  template('split', 'SPLIT FILE', ' BY {groups}.'),
  template('split-off', 'SPLIT FILE', ' OFF.', 'OFF'),
  template('weight', 'WEIGHT', ' BY {weight}.'),
  template('weight-off', 'WEIGHT', ' OFF.', 'OFF'),
  template('execute', 'EXECUTE'),
  template('append', 'ADD FILES', ' /FILE=* /FILE="{savFile}".'),
  template('match', 'MATCH FILES', ' /FILE=* /TABLE="{savFile}" /BY {keys}.'),
  template('aggregate', 'AGGREGATE', ' OUTFILE=* MODE=ADDVARIABLES /BREAK={groups}\n /{newVariable}={expression}.'),
  template('vars-to-cases', 'VARSTOCASES', ' /MAKE {newVariable} FROM {variables}.'),
  template('cases-to-vars', 'CASESTOVARS', ' /ID={subject} /INDEX={index}.'),
  template('rank', 'RANK', ' VARIABLES={variables}.'),
  template('frequencies', 'FREQUENCIES', ' {variables}.'),
  template('descriptives', 'DESCRIPTIVES', ' {variables}.'),
  template('examine', 'EXAMINE', ' {variables}.'),
  template('examine-groups', 'EXAMINE', ' {variables} BY {groups}.', 'BY'),
  template('means', 'MEANS', ' TABLES {outcome} BY {groups}.'),
  template('crosstabs', 'CROSSTABS', ' /TABLES {row} BY {column}.'),
  template('crosstabs-layer', 'CROSSTABS', ' /TABLES {row} BY {column} BY {groups}.', '3D'),
  template('bar', 'GRAPH', ' /BAR(SIMPLE)=COUNT BY {groups}.'),
  template('histogram', 'GRAPH', ' /HISTOGRAM {variable}.', 'Histogram'),
  template('scatter', 'GRAPH', ' /SCATTERPLOT={first} WITH {second}.', 'Scatterplot'),
  template('correlations', 'CORRELATIONS', ' /VARIABLES {variables}.'),
  template('spearman', 'NONPAR CORR', ' /VARIABLES {variables}.'),
  template('kendall', 'NONPAR CORR', ' /VARIABLES {variables} /PRINT=KENDALL.', 'Kendall'),
  template('partial-corr', 'PARTIAL CORR', ' /VARIABLES={variables} /CONTROLLING={predictors}.'),
  template('ttest-independent', 'T-TEST', ' /GROUPS {groups}({group1} {group2}) /VARIABLES {outcome}.'),
  template('ttest-one', 'T-TEST', ' /TESTVAL {testValue} /VARIABLES {outcome}.', 'One sample'),
  template('ttest-paired', 'T-TEST', ' /PAIRS {first} WITH {second} (PAIRED).', 'Paired'),
  template('oneway', 'ONEWAY', ' {outcome} BY {groups}.'),
  template('unianova', 'UNIANOVA', ' {outcome} BY {groups}.'),
  template('ancova', 'UNIANOVA', ' {outcome} BY {groups} WITH {predictors}.', 'ANCOVA'),
  template('manova', 'GLM', ' {outcomes} BY {groups}.'),
  template('mann-whitney', 'NPAR TESTS', ' /M-W {outcome} BY {groups}({group1} {group2}).', 'Mann–Whitney'),
  template('wilcoxon', 'NPAR TESTS', ' /WILCOXON {first} WITH {second} (PAIRED).', 'Wilcoxon'),
  template('np-independent', 'NPTESTS', ' /INDEPENDENT TEST({outcome}) GROUP({groups}).'),
  template('bootstrap', 'BOOTSTRAP'),
  template('regression', 'REGRESSION', ' /DEPENDENT {outcome} /METHOD=ENTER {predictors}.'),
  template('logistic', 'LOGISTIC REGRESSION', ' {outcome} /METHOD=ENTER {predictors}.'),
  template('wls', 'WLS', ' VARIABLES={outcome} WITH {predictors} /SOURCE={weight}.'),
  template('nomreg', 'NOMREG', ' {outcome} BY {groups} WITH {predictors}.'),
  template('plum', 'PLUM', ' {outcome} BY {groups} WITH {predictors}.'),
  template('genlin', 'GENLIN', ' {outcome} WITH {predictors}\n /MODEL {effects} DISTRIBUTION={distribution} LINK={link}.'),
  template('gee', 'GENLIN', ' {outcome} WITH {predictors}\n /MODEL {effects} DISTRIBUTION={distribution} LINK={link}\n /REPEATED SUBJECT={subject}.', 'GEE'),
  template('mixed', 'MIXED', ' {outcome} WITH {predictors} /FIXED={effects}\n /RANDOM=INTERCEPT | SUBJECT({subject}).'),
  template('genlinmixed', 'GENLINMIXED', '\n /FIELDS TARGET={outcome}\n /TARGET_OPTIONS DISTRIBUTION={distribution} LINK={link}\n /FIXED EFFECTS={effects}.'),
  template('iv', '2SLS', ' {outcome} WITH {predictors} /INSTRUMENTS {instruments}.'),
  template('quantile', 'QUANTILE REGRESSION', ' {outcome} WITH {predictors}.'),
  template('reliability', 'RELIABILITY', ' /VARIABLES={variables}.'),
  template('factor', 'FACTOR', ' /VARIABLES={variables}.'),
  template('factor-paf', 'FACTOR', ' /VARIABLES={variables} /EXTRACTION=PAF.', 'PAF'),
  template('cluster', 'CLUSTER', ' {variables}.'),
  template('quick-cluster', 'QUICK CLUSTER', ' {variables} /CRITERIA=CLUSTER({clusters}).'),
  template('km', 'KM', ' {duration} /STATUS={event}({eventValue}).'),
  template('coxreg', 'COXREG', ' {duration} WITH {predictors} /STATUS={event}({eventValue}).'),
  template('roc', 'ROC', ' {score} BY {event}({eventValue}).'),
  template('roc-analysis', 'ROC ANALYSIS', ' {score} BY {event}({eventValue}).'),
  template('tree', 'TREE', ' {outcome} BY {predictors}.'),
  template('mlp', 'MLP', ' {outcome} BY {groups} WITH {predictors}.'),
  template('acf', 'ACF', ' {variables}.'),
  template('pacf', 'PACF', ' {variables}.'),
  template('ccf', 'CCF', ' {first} WITH {second}.'),
  template('arima', 'ARIMA', ' {series} /MODEL=({p},{d},{q}).'),
  template('tsmodel', 'TSMODEL', ' /MODEL DEPENDENT={series}.'),
  template('multiple-imputation', 'MULTIPLE IMPUTATION', ' {variables} /OUTFILE IMPUTATIONS="{savFile}".'),
  template('csplan', 'CSPLAN', ' ANALYSIS /PLAN FILE="{planFile}" /PLANVARS ANALYSISWEIGHT={weight}.'),
  template('csglm', 'CSGLM', ' {outcome} WITH {predictors} /PLAN FILE="{planFile}".'),
  template('ctables', 'CTABLES', ' /TABLE {row} BY {column}.'),
  template('bayes-regression', 'BAYES REGRESSION', ' {outcome} WITH {predictors}.'),
  template('output-save', 'OUTPUT SAVE', ' OUTFILE="{viewerFile}".'),
  template('output-export', 'OUTPUT EXPORT', ' /HTML DOCUMENTFILE="{htmlFile}".'),
  template('oms', 'OMS', ' /DESTINATION FORMAT=HTML OUTFILE="{htmlFile}".'),
  template('omsend', 'OMSEND'),
  template('comment', 'COMMENT', ' {comment}.'),
  template('set', 'SET', ' {option}.'),
];

const functionPatterns: Record<string, string> = {
  ABS: '{expression}', LN: '{expression}', LG10: '{expression}', SQRT: '{expression}', RND: '{expression}',
  TRUNC: '{expression}', EXP: '{expression}', MOD: '{expression}, {divisor}',
  SUM: '{expression}', MEAN: '{expression}', MIN: '{expression}', MAX: '{expression}', SD: '{expressions}',
  MISSING: '{expression}', SYSMIS: '{expression}', NVALID: '{expressions}', NMISS: '{expressions}',
  ANY: '{expression}, {values}', RANGE: '{expression}, {start}, {stop}',
  'CHAR.LENGTH': '{string}', 'CHAR.SUBSTR': '{string}, {start}', SUBSTR: '{string}, {start}',
  CONCAT: '{string}, {secondString}', RTRIM: '{string}', 'DATE.MDY': '{month}, {day}, {year}',
  DATEDIFF: '{date}, {secondDate}, "{unit}"', 'XDATE.YEAR': '{date}',
  'CDF.NORMAL': '{value}, {mean}, {sd}', 'IDF.NORMAL': '{probability}, {mean}, {sd}',
  'RV.NORMAL': '{mean}, {sd}', LAG: '{variable}',
};

const hintsZh: Record<string, string> = {
  directory: '工作目录', savFile: 'SPSS数据名.sav', xlsxFile: '工作簿.xlsx', csvFile: '数据.csv',
  stataFile: '数据.dta', sasFile: '数据.sas7bdat', syntaxFile: '语法.sps', planFile: '抽样计划.csaplan',
  viewerFile: '结果.spv', htmlFile: '结果.html', dataset: '数据集名称', lastCase: '最后一行',
  variable: '变量名', variables: '变量列表', newVariable: '新变量名', newVariables: '新变量名',
  label: '标签', value: '取值', level: '测量层次', missingCode: '缺失码', format: '格式',
  width: '字符数', expression: '表达式', expressions: '表达式列表', condition: '条件', statement: '命令',
  iterator: '迭代变量', start: '起点', stop: '终点', oldValues: '原取值', newValue: '新取值',
  keys: '键变量', attribute: '字典属性', indicator: '指示变量', groups: '分组变量', weight: '权重变量',
  subject: '主体变量', index: '索引变量', outcome: '结果变量', outcomes: '结果变量列表',
  row: '行变量', column: '列变量', first: '变量1', second: '变量2',
  group1: '组1取值', group2: '组2取值', testValue: '比较常数', predictors: '解释变量',
  effects: '模型项', distribution: '分布', link: '链接函数', instruments: '工具与外生变量',
  clusters: '聚类数', duration: '时长变量', event: '事件变量', eventValue: '事件取值',
  score: '得分变量', series: '序列变量', columnDefinitions: '变量及格式', comment: '注释',
  option: '选项', string: '字符串', secondString: '第二个字符串', month: '月', day: '日', year: '年',
  date: '日期', secondDate: '第二个日期', unit: '单位', mean: '均值', sd: '标准差',
  probability: '概率', values: '候选值', divisor: '除数',
};

function fieldHint(field: string, chinese: boolean): string {
  if (chinese && hintsZh[field]) return hintsZh[field];
  if (field === 'savFile') return 'data.sav';
  if (field === 'xlsxFile') return 'data.xlsx';
  if (field === 'csvFile') return 'data.csv';
  return field.replace(/[A-Z]/gu, (letter) => ` ${letter.toLowerCase()}`);
}

function escapeSnippet(text: string): string {
  return text.replace(/[\\$}]/gu, '\\$&');
}

export function renderSyntaxTemplate(
  pattern: string,
  chinese: boolean,
  bindings: Readonly<Record<string, string>> = {},
): RenderedTemplate {
  const slots: TemplateSlot[] = [];
  let text = '';
  let snippet = '';
  let preview = '';
  let offset = 0;
  const append = (literal: string): void => {
    text += literal;
    snippet += escapeSnippet(literal);
    preview += literal;
  };
  for (const match of pattern.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)) {
    const field = match[1];
    if (!field) continue;
    append(pattern.slice(offset, match.index));
    const value = Object.hasOwn(bindings, field) ? bindings[field] : undefined;
    if (value !== undefined) {
      append(value);
    } else {
      const hint = fieldHint(field, chinese);
      slots.push({ start: text.length, end: text.length, hint, field });
      snippet += `$${String(slots.length)}`;
      preview += hint;
    }
    offset = match.index + match[0].length;
  }
  append(pattern.slice(offset));
  return { text, snippet, preview, slots };
}

export function functionTemplate(command: string, chinese: boolean): RenderedTemplate | undefined {
  const pattern = Object.hasOwn(functionPatterns, command) ? functionPatterns[command] : undefined;
  return pattern === undefined ? undefined : renderSyntaxTemplate(`${command}(${pattern})`, chinese);
}

export function syntaxTemplate(id: string): SyntaxTemplate | undefined {
  return COMMAND_TEMPLATES.find((entry) => entry.id === id);
}
