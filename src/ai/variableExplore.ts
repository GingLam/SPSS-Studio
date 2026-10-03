import {
  DEFAULT_AI_RESPONSE_LANGUAGE,
  type AiResponseLanguage,
} from './chatProtocol';
import type {
  DatasetCell,
  SpssVariableProfile,
  VariableProfiles,
} from '../spss/types';

const MAX_PROMPT_CHARACTERS = 30_000;
const LEGACY_ZH_DISCLAIMER = '以上仅为分析建议；严谨的统计分析还须结合变量内涵、测量层次、取值分布与缺失情况。';

export function exploreDisclaimer(
  language: AiResponseLanguage = DEFAULT_AI_RESPONSE_LANGUAGE,
): string {
  return language === 'en'
    ? 'These are exploratory suggestions only; rigorous analysis requires understanding the variables, measurement levels, value distributions, and missing data.'
    : '**以上仅为分析建议；严谨统计分析还须考虑变量内涵、测量层次、取值分布与缺失情况**⚠️';
}

export function appendExploreDisclaimer(
  response: string,
  language: AiResponseLanguage = DEFAULT_AI_RESPONSE_LANGUAGE,
): string {
  const disclaimer = exploreDisclaimer(language);
  const candidates = language === 'zh-CN'
    ? [disclaimer, LEGACY_ZH_DISCLAIMER]
    : [disclaimer];
  const withoutDuplicate = candidates.reduce(
    (content, candidate) => content.split(candidate).join(''),
    response,
  ).trim();
  return `${withoutDuplicate}\n\n${disclaimer}`;
}

export function isOutOfScopeReply(response: string): boolean {
  const normalized = response.trim();
  return normalized === '该问题超出 SPSS Studio Chat 的支持范围。请提出与 SPSS Syntax、SPSS 应用或统计分析有关的问题。'
    || normalized === 'That question is outside SPSS Studio Chat’s scope. Please ask about SPSS Syntax, SPSS use, or statistical analysis.';
}

export function buildVariableExploreQuestion(
  profiles: VariableProfiles,
  language: AiResponseLanguage = DEFAULT_AI_RESPONSE_LANGUAGE,
): string {
  if (profiles.profiles.length === 0 || profiles.profiles.length > 20) {
    throw new Error('Variable Explore requires between 1 and 20 profiles.');
  }
  const limits: Array<readonly [number, number]> = [
    [20, 100], [15, 50], [10, 25], [5, 10], [3, 5], [0, 0],
  ];
  for (const [categoryLimit, labelLimit] of limits) {
    const prompt = renderPrompt(profiles, language, categoryLimit, labelLimit);
    if (prompt.length <= MAX_PROMPT_CHARACTERS) {
      return prompt;
    }
  }
  const core = renderPrompt(profiles, language, 0, 0);
  const boundary = core.lastIndexOf('\n', MAX_PROMPT_CHARACTERS - 80);
  const end = boundary > 0 ? boundary : MAX_PROMPT_CHARACTERS - 80;
  const marker = language === 'en' ? '[PROFILE TEXT TRUNCATED]' : '[变量摘要文字已截断]';
  return `${core.slice(0, end).trimEnd()}\n\n${marker}`;
}

function renderPrompt(
  profiles: VariableProfiles,
  language: AiResponseLanguage,
  categoryLimit: number,
  labelLimit: number,
): string {
  const english = language === 'en';
  const lines = [
    '## Variable Explore',
    '',
    `${english ? 'Dataset' : '数据集'}: ${safeText(profiles.datasetName)}`,
    `${english ? 'Selected variables' : '所选变量数'}: ${String(profiles.profiles.length)}`,
    `${english ? 'Cases in dataset' : '数据集个案数'}: ${String(profiles.caseCount)}`,
  ];
  const controls = [
    profiles.filterVariable ? `${english ? 'Filter' : '筛选'}=${safeText(profiles.filterVariable)}` : '',
    profiles.weightVariable ? `${english ? 'Weight' : '权重'}=${safeText(profiles.weightVariable)}` : '',
    profiles.splitVariables?.length
      ? `${english ? 'Split' : '拆分'}=${profiles.splitVariables.map(safeText).join(', ')}`
      : '',
  ].filter(Boolean);
  if (controls.length > 0) {
    lines.push(`${english ? 'Active controls' : '当前设置'}: ${controls.join('; ')}`);
  }
  for (const profile of profiles.profiles) {
    lines.push('', ...renderProfile(profile, english, categoryLimit, labelLimit));
  }
  lines.push('', english
    ? 'Use these bounded summaries only to propose an appropriate SPSS exploration; they are not formal analysis results and contain no case-level relationships.'
    : '请仅依据这些受限摘要提出合适的 SPSS 探索方案；它们不是正式分析结果，也不包含个案层面的变量关系。');
  return lines.join('\n');
}

function renderProfile(
  profile: SpssVariableProfile,
  english: boolean,
  categoryLimit: number,
  labelLimit: number,
): string[] {
  const summary = profile.summary;
  const lines = [
    `### ${safeText(profile.name)}`,
    `- ${english ? 'Label' : '标签'}: ${safeText(profile.label || '—')}`,
    `- ${english ? 'Type' : '类型'}: ${safeText(profile.type)}`,
    `- ${english ? 'Format' : '格式'}: ${safeText(profile.format)}`,
    `- ${english ? 'Measure' : '测量层次'}: ${safeText(profile.measurementLevel || '—')}`,
    `- ${english ? 'Valid N' : '有效 N'}: ${String(summary.validN)}`,
    `- ${english ? 'Missing N' : '缺失 N'}: ${String(summary.missingN)}`,
  ];
  if (summary.kind === 'continuous') {
    if (summary.minimum !== undefined) lines.push(`- ${english ? 'Minimum' : '最小值'}: ${formatNumber(summary.minimum)}`);
    if (summary.maximum !== undefined) lines.push(`- ${english ? 'Maximum' : '最大值'}: ${formatNumber(summary.maximum)}`);
    if (summary.mean !== undefined) lines.push(`- ${english ? 'Mean' : '均值'}: ${formatNumber(summary.mean)}`);
    if (summary.standardDeviation !== undefined) lines.push(`- ${english ? 'Standard deviation' : '标准差'}: ${formatNumber(summary.standardDeviation)}`);
  } else if (summary.kind === 'temporal') {
    if (summary.earliest !== undefined) lines.push(`- ${english ? 'Earliest' : '最早值'}: ${safeText(summary.earliest)}`);
    if (summary.latest !== undefined) lines.push(`- ${english ? 'Latest' : '最晚值'}: ${safeText(summary.latest)}`);
  } else {
    if (summary.distinctCount !== undefined) {
      lines.push(`- ${english ? 'Distinct valid values' : '不同有效取值'}: ${String(summary.distinctCount)}`);
    } else if (summary.distinctCountAtLeast !== undefined) {
      lines.push(`- ${english ? 'Distinct valid values' : '不同有效取值'}: ≥${String(summary.distinctCountAtLeast)} (${english ? 'approximate' : '近似'})`);
    }
    const values = summary.topValues.slice(0, categoryLimit);
    if (values.length > 0) {
      lines.push(`- ${english ? 'Observed values' : '观察值'}:`);
      for (const item of values) {
        const label = item.label ? ` = ${safeText(item.label)}` : '';
        const approximate = summary.approximate ? '≈' : '';
        lines.push(`  - ${formatValue(item.value)}${label}; N${approximate}=${String(item.frequency)}`);
      }
      if (summary.topValues.length > values.length) {
        lines.push(`  - [${english ? 'observed values truncated' : '观察值已截断'}]`);
      }
    }
  }
  const labels = profile.valueLabels.slice(0, labelLimit);
  if (labels.length > 0) {
    lines.push(`- ${english ? 'Defined value labels' : '已定义值标签'}:`);
    for (const item of labels) {
      lines.push(`  - ${formatValue(item.value)} = ${safeText(item.label)}`);
    }
    if (profile.valueLabelsTruncated || profile.valueLabels.length > labels.length) {
      lines.push(`  - [${english ? 'value labels truncated' : '值标签已截断'}]`);
    }
  } else if (profile.valueLabels.length > 0 || profile.valueLabelsTruncated) {
    lines.push(`- [${english ? 'value labels omitted to fit the prompt' : '值标签因篇幅限制已省略'}]`);
  }
  return lines;
}

function formatValue(value: DatasetCell): string {
  if (value === null) return 'null';
  return safeText(String(value));
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toPrecision(8)).toString();
}

function safeText(value: string): string {
  return value
    .slice(0, 500)
    .replace(/\\/gu, '\\\\')
    .replace(/\r?\n/gu, ' ')
    .replace(/\|/gu, '\\|');
}
