import {
  DEFAULT_AI_RESPONSE_LANGUAGE,
  type AiResponseLanguage,
} from './chatProtocol';

const MAX_TABLE_ROWS = 50;
const MAX_OUTPUT_CHARACTERS = 30_000;

export interface ExtractedOutput {
  content: string;
  truncated: boolean;
}

export function extractSpssOutputForAi(rawHtml: string): ExtractedOutput {
  let html = rawHtml
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/giu, '')
    .replace(/<(svg|canvas|object|iframe|figure|map)\b[^>]*>[\s\S]*?<\/\1>/giu, '')
    .replace(/<(?:img|embed)\b[^>]*>/giu, '');

  html = html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/giu, (table) => (
    isNotesTable(table) ? '' : table
  ));

  const blocks: string[] = [];
  const blockPattern = /<table\b[^>]*>[\s\S]*?<\/table>|<p\b[^>]*>[\s\S]*?<\/p>|<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/giu;
  for (const match of html.matchAll(blockPattern)) {
    const block = match[0];
    if (/^<table\b/iu.test(block)) {
      const markdown = tableToMarkdown(block);
      if (markdown) {
        blocks.push(markdown);
      }
      continue;
    }
    if (isCommandEchoOrPath(block)) {
      continue;
    }
    const text = htmlText(block);
    if (!text || isSystemMetadataText(text)) {
      continue;
    }
    const heading = /class\s*=\s*["'][^"']*\bprocedureTitle\b/iu.test(block)
      || /^<h[1-6]\b/iu.test(block);
    blocks.push(heading ? `## ${text}` : text);
  }

  const normalized = blocks.join('\n\n').replace(/\n{3,}/gu, '\n\n').trim();
  if (normalized.length <= MAX_OUTPUT_CHARACTERS) {
    return { content: normalized, truncated: false };
  }
  const boundary = normalized.lastIndexOf('\n', MAX_OUTPUT_CHARACTERS);
  const end = boundary >= Math.floor(MAX_OUTPUT_CHARACTERS * 0.8)
    ? boundary
    : MAX_OUTPUT_CHARACTERS;
  return {
    content: `${normalized.slice(0, end).trimEnd()}\n\n[OUTPUT TRUNCATED]`,
    truncated: true,
  };
}

export function buildOutputExplanationQuestion(
  output: string,
  language: AiResponseLanguage = DEFAULT_AI_RESPONSE_LANGUAGE,
): string {
  const normalized = output.trim();
  if (!normalized) {
    throw new Error('The selected SPSS output contains no statistical text or tables to explain.');
  }
  const instruction = language === 'en'
    ? 'Briefly interpret the following SPSS statistical output. Focus on the substantive findings, effect direction and size, uncertainty, and statistical significance when available. Do not restate every cell or infer information that is absent. Runtime metadata, provenance details, command echoes, and figures have already been removed.'
    : '请简要解释以下 SPSS 统计结果。重点说明实质性发现，以及现有结果中的效应方向与大小、不确定性和统计显著性；不要逐格复述表格，也不要推断未提供的信息。运行元数据、来源信息、命令回显和图形已经移除。';
  return `${instruction}\n\n<SPSS_OUTPUT>\n${normalized}\n</SPSS_OUTPUT>`;
}

function isNotesTable(table: string): boolean {
  const opening = table.match(/^<table\b[^>]*>/iu)?.[0] ?? '';
  if (/aria-label\s*=\s*["']\s*(?:Notes|注释|备注)(?:\s|,|，|["'])/iu.test(opening)) {
    return true;
  }
  const caption = table.match(/<caption\b[^>]*>[\s\S]*?<\/caption>/iu)?.[0];
  if (caption !== undefined && /^(?:Notes\b|注释|备注)/iu.test(htmlText(caption))) {
    return true;
  }
  const text = htmlText(table);
  const metadataLabels = [
    /\bOutput Created\b/iu,
    /\bActive Dataset\b/iu,
    /\bMissing Value Handling\b/iu,
    /\bCases Used\b/iu,
    /\bProcessor Time\b/iu,
    /\bElapsed Time\b/iu,
    /输出(?:已)?创建|活动数据集|缺失值处理|使用的个案|处理器时间|已用时间/u,
  ];
  return metadataLabels.filter((pattern) => pattern.test(text)).length >= 2;
}

function tableToMarkdown(table: string): string {
  const captionHtml = table.match(/<caption\b[^>]*>[\s\S]*?<\/caption>/iu)?.[0];
  const caption = captionHtml ? htmlText(removeDetails(captionHtml)) : '';
  const rows: string[][] = [];
  let truncated = false;
  for (const rowMatch of table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/giu)) {
    if (rows.length >= MAX_TABLE_ROWS) {
      truncated = true;
      break;
    }
    const cells = [...rowMatch[0].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/giu)]
      .map((cell) => markdownCell(htmlText(removeDetails(cell[1] ?? ''))));
    if (cells.some(Boolean)) {
      rows.push(cells);
    }
  }
  if (rows.length === 0) {
    return caption ? `### ${caption}` : '';
  }
  const columns = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => [
    ...row,
    ...Array.from({ length: columns - row.length }, () => ''),
  ]);
  const header = normalizedRows[0] ?? [];
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...normalizedRows.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ];
  if (truncated) {
    lines.push('', '[TABLE TRUNCATED AFTER 50 ROWS]');
  }
  return [caption ? `### ${caption}` : '', ...lines].filter(Boolean).join('\n');
}

function removeDetails(value: string): string {
  return value.replace(/<([a-z][a-z0-9]*)\b[^>]*class\s*=\s*["'][^"']*\bdetails\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/giu, '');
}

function isCommandEchoOrPath(block: string): boolean {
  if (/<html\b|<font\b/iu.test(block)) {
    return true;
  }
  const text = htmlText(block);
  return /^\[[^\]]+\]\s*(?:\/|[A-Za-z]:[\\/])/u.test(text)
    || /^(?:file:\/\/|\/Users\/|\/home\/|[A-Za-z]:[\\/])/u.test(text);
}

function isSystemMetadataText(text: string): boolean {
  return /^(?:Run\s*#\d+|Error level:|Duration:|Output Created|Active Dataset|Processor Time|Elapsed Time)\b/iu.test(text);
}

function markdownCell(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|').replace(/\n+/gu, '<br>');
}

function htmlText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/giu, '\n')
      .replace(/<\/p\s*>/giu, '\n')
      .replace(/<[^>]+>/gu, ''),
  )
    .replace(/[\t\r ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (entity, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return decodeCodePoint(body.slice(2), 16, entity);
    }
    if (body.startsWith('#')) {
      return decodeCodePoint(body.slice(1), 10, entity);
    }
    return named[body.toLowerCase()] ?? entity;
  });
}

function decodeCodePoint(value: string, radix: number, fallback: string): string {
  const codePoint = Number.parseInt(value, radix);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : fallback;
}
