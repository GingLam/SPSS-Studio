import {
  descendants,
  elementChildren,
  hasClass,
  hasDescendantTag,
  htmlText,
  parseHtmlDocument,
  type HtmlElement,
} from './htmlDocument';
import {
  DEFAULT_AI_RESPONSE_LANGUAGE,
  type AiResponseLanguage,
} from './chatProtocol';

const MAX_TABLE_ROWS = 50;
const MAX_OUTPUT_CHARACTERS = 30_000;
const EXCLUDED_OUTPUT_ELEMENTS = new Set([
  'audio', 'canvas', 'embed', 'figure', 'iframe', 'img', 'map', 'object',
  'picture', 'script', 'style', 'svg', 'video',
]);

interface TableCell {
  text: string;
  header: boolean;
  colspan: number;
  rowspan: number;
}

interface TableRow {
  section: 'thead' | 'tbody' | 'tfoot' | 'unknown';
  cells: TableCell[];
}

interface GridCell {
  text: string;
  header: boolean;
}

interface GridRow {
  section: TableRow['section'];
  cells: GridCell[];
  headerOnly: boolean;
}

interface PendingSpan {
  cell: GridCell;
  remaining: number;
}

export interface ExtractedOutput {
  content: string;
  truncated: boolean;
}

export function extractSpssOutputForAi(
  rawHtml: string,
  language: AiResponseLanguage = DEFAULT_AI_RESPONSE_LANGUAGE,
): ExtractedOutput {
  const document = parseHtmlDocument(rawHtml);
  const blocks: string[] = [];
  collectBlocks(document, blocks, language);
  const normalized = blocks.join('\n\n').replace(/\n{3,}/gu, '\n\n').trim();
  if (normalized.length <= MAX_OUTPUT_CHARACTERS) {
    return { content: normalized, truncated: false };
  }
  const boundary = normalized.lastIndexOf('\n', MAX_OUTPUT_CHARACTERS);
  const end = boundary >= Math.floor(MAX_OUTPUT_CHARACTERS * 0.8)
    ? boundary
    : MAX_OUTPUT_CHARACTERS;
  return {
    content: `${normalized.slice(0, end).trimEnd()}\n\n${language === 'en' ? '[OUTPUT TRUNCATED]' : '[输出内容已截断]'}`,
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
    ? 'Briefly interpret the following SPSS statistical output. Focus on substantive findings, effect direction and size, uncertainty, and statistical significance when available. Do not restate every cell or infer information that is absent. Runtime metadata, provenance details, command echoes, and figures have already been removed.'
    : '请简要解释以下 SPSS 统计结果。重点说明实质性发现，以及现有结果中的效应方向与大小、不确定性和统计显著性；不要逐格复述表格，也不要推断未提供的信息。运行元数据、来源信息、命令回显和图形已经移除。';
  const heading = language === 'en' ? '## SPSS Output' : '## SPSS 统计结果';
  return `${instruction}\n\n${heading}\n\n${normalized}`;
}

function collectBlocks(
  element: HtmlElement,
  blocks: string[],
  language: AiResponseLanguage,
): void {
  for (const child of element.children) {
    if (child.type !== 'element') {
      continue;
    }
    if (EXCLUDED_OUTPUT_ELEMENTS.has(child.tag)) {
      continue;
    }
    if (child.tag === 'table') {
      if (!isNotesTable(child)) {
        const markdown = tableToMarkdown(child, language);
        if (markdown) {
          blocks.push(markdown);
        }
      }
      continue;
    }
    if (child.tag === 'p' || /^h[1-6]$/u.test(child.tag)) {
      if (!isCommandEchoOrPath(child)) {
        const text = htmlText(child);
        if (text && !isSystemMetadataText(text)) {
          const heading = hasClass(child, 'procedureTitle') || /^h[1-6]$/u.test(child.tag);
          blocks.push(heading ? `## ${text}` : text);
        }
      }
      continue;
    }
    collectBlocks(child, blocks, language);
  }
}

function isNotesTable(table: HtmlElement): boolean {
  const ariaLabel = table.attributes['aria-label'] ?? '';
  if (/^\s*(?:Notes|注释|备注)(?:\s|,|，|$)/iu.test(ariaLabel)) {
    return true;
  }
  const caption = descendants(table, 'caption')[0];
  if (caption && /^(?:Notes\b|注释|备注)/iu.test(htmlText(caption))) {
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
    /输出(?:已)?创建|活动数据集|缺失值处理|使用的个案|处理程序时间|处理器时间|耗用时间|已用时间/u,
  ];
  return metadataLabels.filter((pattern) => pattern.test(text)).length >= 2;
}

function tableToMarkdown(table: HtmlElement, language: AiResponseLanguage): string {
  const captionElement = descendants(table, 'caption')[0];
  const caption = captionElement ? htmlText(captionElement) : '';
  const sourceRows = collectTableRows(table);
  const footnotes = sourceRows
    .filter((row) => row.section === 'tfoot')
    .flatMap((row) => row.cells.map((cell) => cell.text).filter(Boolean));
  const gridRows = expandGrid(sourceRows.filter((row) => row.section !== 'tfoot'))
    .filter((row) => row.cells.some((cell) => cell.text));
  if (gridRows.length === 0) {
    const footnoteLabel = language === 'en' ? 'Footnote' : '脚注';
    return [caption ? `### ${caption}` : '', ...footnotes.map((value) => `${footnoteLabel}: ${value}`)]
      .filter(Boolean)
      .join('\n');
  }
  const columns = Math.max(...gridRows.map((row) => row.cells.length));
  const normalizedRows = gridRows.map((row) => ({
    ...row,
    cells: Array.from({ length: columns }, (_unused, index) => (
      row.cells[index] ?? { text: '', header: false }
    )),
  }));
  const headerCount = countHeaderRows(normalizedRows);
  const headerRows = normalizedRows.slice(0, headerCount);
  const bodyRows = normalizedRows.slice(headerCount);
  const header = Array.from({ length: columns }, (_unused, column) => {
    const parts: string[] = [];
    for (const row of headerRows) {
      const value = row.cells[column]?.text ?? '';
      if (value && value !== parts[parts.length - 1]) {
        parts.push(value);
      }
    }
    const fallback = language === 'en' ? `Column ${String(column + 1)}` : `列 ${String(column + 1)}`;
    return markdownCell(parts.join(' / ') || fallback);
  });
  const limitedRows = bodyRows.slice(0, MAX_TABLE_ROWS);
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...limitedRows.map((row) => (
      `| ${row.cells.map((cell) => markdownCell(cell.text)).join(' | ')} |`
    )),
  ];
  if (bodyRows.length > MAX_TABLE_ROWS) {
    lines.push('', language === 'en' ? '[TABLE TRUNCATED AFTER 50 ROWS]' : '[表格已在50行后截断]');
  }
  if (footnotes.length > 0) {
    const footnoteLabel = language === 'en' ? 'Footnote' : '脚注';
    lines.push('', ...footnotes.map((value) => `${footnoteLabel}: ${markdownCell(value)}`));
  }
  return [caption ? `### ${caption}` : '', ...lines].filter(Boolean).join('\n');
}

function collectTableRows(table: HtmlElement): TableRow[] {
  const rows: TableRow[] = [];
  const visit = (element: HtmlElement, section: TableRow['section']): void => {
    for (const child of elementChildren(element)) {
      if (child.tag === 'table') {
        continue;
      }
      const nextSection = child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot'
        ? child.tag
        : section;
      if (child.tag === 'tr') {
        const cells = collectRowCells(child);
        if (cells.length > 0) {
          rows.push({ section: nextSection, cells });
        }
      } else {
        visit(child, nextSection);
      }
    }
  };
  visit(table, 'unknown');
  return rows;
}

function collectRowCells(row: HtmlElement): TableCell[] {
  const cells: TableCell[] = [];
  const visit = (element: HtmlElement): void => {
    for (const child of elementChildren(element)) {
      if (child.tag === 'tr' || child.tag === 'table') {
        continue;
      }
      if (child.tag === 'th' || child.tag === 'td') {
        cells.push({
          text: htmlText(child),
          header: child.tag === 'th',
          colspan: positiveSpan(child.attributes.colspan),
          rowspan: positiveSpan(child.attributes.rowspan),
        });
      } else {
        visit(child);
      }
    }
  };
  visit(row);
  return cells;
}

function expandGrid(rows: readonly TableRow[]): GridRow[] {
  const expanded: GridRow[] = [];
  const spans = new Map<number, PendingSpan>();
  for (const sourceRow of rows) {
    const cells: Array<GridCell | undefined> = [];
    for (const [column, span] of spans) {
      cells[column] = { ...span.cell };
      span.remaining -= 1;
      if (span.remaining <= 0) {
        spans.delete(column);
      }
    }
    let column = 0;
    for (const sourceCell of sourceRow.cells) {
      while (cells[column] !== undefined) {
        column += 1;
      }
      for (let offset = 0; offset < sourceCell.colspan; offset += 1) {
        const gridCell: GridCell = {
          text: offset === 0 || sourceCell.header ? sourceCell.text : '',
          header: sourceCell.header,
        };
        cells[column + offset] = gridCell;
        if (sourceCell.rowspan > 1) {
          spans.set(column + offset, {
            cell: { ...gridCell },
            remaining: sourceCell.rowspan - 1,
          });
        }
      }
      column += sourceCell.colspan;
    }
    const concrete = cells.map((cell) => cell ?? { text: '', header: false });
    expanded.push({
      section: sourceRow.section,
      cells: concrete,
      headerOnly: concrete.length > 0 && concrete.every((cell) => cell.header),
    });
  }
  return expanded;
}

function countHeaderRows(rows: readonly GridRow[]): number {
  let count = 0;
  while (count < rows.length && rows[count]?.section === 'thead') {
    count += 1;
  }
  if (count > 0) {
    return count;
  }
  return rows[0]?.headerOnly === true ? 1 : 0;
}

function positiveSpan(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '1', 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 1_000) : 1;
}

function isCommandEchoOrPath(block: HtmlElement): boolean {
  if (hasDescendantTag(block, new Set(['html', 'font']))) {
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
  return value.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|').replace(/\n+/gu, ' / ');
}
