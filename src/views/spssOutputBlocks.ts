import { DEFAULT_AI_RESPONSE_LANGUAGE, type AiResponseLanguage } from '../ai/chatProtocol';
import { descendants, elementChildren, hasClass, hasDescendantTag, htmlText, parseHtmlDocument, type HtmlElement } from '../ai/htmlDocument';
import {
  buildOutputExplanationQuestion, extractSpssOutputForAi, EXCLUDED_OUTPUT_ELEMENTS,
  isCommandEchoOrPath, isNotesTable, isSystemMetadataText,
} from '../ai/outputExplanation';

export interface SpssOutputBlock {
  id: string;
  title: string;
  sourceHtml: string;
  context: string;
  footnotes: string;
}

interface OutputScope { title: string; qualifiers: string[]; blocks: SpssOutputBlock[] }
const MARKER = 'data-spss-output-block';
const FOOTNOTE_CONTEXT = /^(?:[a-z]\.[\s\u00a0]*)?(?:Dependent Variable|Predictors|Grouping Variable|Weight|因变量|预测变量|预测值|分组变量|加权|权重)\s*[:：]/iu;

function sourceHtml(element: HtmlElement, rawHtml: string): string {
  const range = element.source;
  return range?.end === undefined ? '' : rawHtml.slice(range.start, range.end);
}

function captionOf(table: HtmlElement): string {
  const caption = elementChildren(table, 'caption')[0];
  return caption ? htmlText(caption) : table.attributes['aria-label'] ?? '';
}

/** Keep source ranges intact: only add reserved markers to independent results. */
export function createSpssOutputBlocks(
  rawHtml: string,
  language: AiResponseLanguage = DEFAULT_AI_RESPONSE_LANGUAGE,
): { html: string; blocks: SpssOutputBlock[] } {
  const document = parseHtmlDocument(rawHtml);
  const blocks: SpssOutputBlock[] = [];
  const markers = new Map<HtmlElement, string>();
  const edits: Array<{ start: number; end: number; value: string }> = [];
  const scopes: OutputScope[] = [];
  let scope: OutputScope = { title: '', qualifiers: [], blocks: [] };
  scopes.push(scope);
  let previous: SpssOutputBlock | undefined;

  const walk = (element: HtmlElement): void => {
    if (EXCLUDED_OUTPUT_ELEMENTS.has(element.tag)) { return; }
    if (element.tag === 'table') {
      if (isNotesTable(element)) { return; }
      if (hasDescendantTag(element, EXCLUDED_OUTPUT_ELEMENTS)
        && ![...descendants(element, 'td'), ...descendants(element, 'th')].some((cell) => htmlText(cell).trim())) { return; }
      if (descendants(element, 'table').length && !captionOf(element) && !hasClass(element, 'pivot') && !hasClass(element, 'PivotTable')) {
        // Layout tables may contain independent statistical tables.
        elementChildren(element).forEach(walk);
        return;
      }
      const original = sourceHtml(element, rawHtml);
      if (!original || !extractSpssOutputForAi(original, language).content) { return; }
      const caption = captionOf(element);
      const fallback = language === 'en' ? 'Table' : '表格';
      const footnotes = descendants(element, 'tfoot').map(htmlText).filter(Boolean).join('\n');
      const block: SpssOutputBlock = {
        id: `block-${String(blocks.length + 1)}`, title: [scope.title, caption || fallback].filter(Boolean).join(' · '),
        sourceHtml: original, context: '', footnotes,
      };
      blocks.push(block); scope.blocks.push(block); markers.set(element, block.id); previous = block;
      for (const cell of descendants(element, 'td')) {
        if (!hasAncestor(cell, 'tfoot')) { continue; }
        for (const line of htmlText(cell).split('\n')) {
          if (FOOTNOTE_CONTEXT.test(line) && !isPath(line)) { scope.qualifiers.push(line); }
        }
      }
      if (/^(?:Warnings?|警告)(?:\b|，|,|$)/iu.test(caption)) {
        const warning = htmlText(element);
        if (!isPath(warning)) { scope.qualifiers.push(warning); }
      }
      return;
    }
    if (element.tag === 'p' || /^h[1-6]$/u.test(element.tag)) {
      const text = htmlText(element);
      if (!text || isCommandEchoOrPath(element) || isSystemMetadataText(text)) { return; }
      if (hasClass(element, 'procedureTitle') || /^h[1-6]$/u.test(element.tag)) {
        scope = { title: text, qualifiers: [], blocks: [] }; scopes.push(scope); previous = undefined;
        return;
      }
      const original = sourceHtml(element, rawHtml);
      if (!original) { return; }
      if (/(?:^|\s)footnotes?(?:\s|$)/iu.test(element.attributes.class ?? '') && previous) {
        previous.sourceHtml += original;
        previous.footnotes += `${previous.footnotes ? '\n' : ''}${text}`;
        if (FOOTNOTE_CONTEXT.test(text) && !isPath(text)) { scope.qualifiers.push(text); }
        return;
      }
      if (/^(?:Warning:|Note:|警告[:：]|注[:：])/iu.test(text)) {
        if (!isPath(text)) { scope.qualifiers.push(text); }
        return;
      }
      if (descendants(element, 'table').length) { elementChildren(element).forEach(walk); return; }
      if (!extractSpssOutputForAi(original, language).content) { return; }
      const block: SpssOutputBlock = {
        id: `block-${String(blocks.length + 1)}`, title: [scope.title, text.slice(0, 90)].filter(Boolean).join(' · '),
        sourceHtml: original, context: '', footnotes: '',
      };
      blocks.push(block); scope.blocks.push(block); markers.set(element, block.id); previous = block;
      return;
    }
    elementChildren(element).forEach(walk);
  };
  walk(document);
  for (const group of scopes) {
    const context = [...new Set(group.qualifiers)].join('\n');
    group.blocks.forEach((block) => { block.context = context; });
  }
  const mark = (element: HtmlElement): void => {
    const range = element.source;
    const id = markers.get(element);
    if (range && (id || element.attributes[MARKER] !== undefined)) {
      let opening = rawHtml.slice(range.start, range.openEnd);
      // Strip pre-existing reserved markers from all elements, including those
      // excluded from AI, so a forged duplicate cannot select the wrong DOM node.
      if (element.attributes[MARKER] !== undefined) {
        opening = opening.replace(/\sdata-spss-output-block(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/giu, '');
      }
      if (id) { opening = opening.replace(/>$/u, ` ${MARKER}="${id}">`); }
      edits.push({ start: range.start, end: range.openEnd, value: opening });
    }
    elementChildren(element).forEach(mark);
  };
  mark(document);
  let html = rawHtml;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
  }
  return { html, blocks };
}

function hasAncestor(element: HtmlElement, tag: string): boolean {
  for (let parent = element.parent; parent; parent = parent.parent) { if (parent.tag === tag) { return true; } }
  return false;
}

function isPath(text: string): boolean {
  return /(?:\/Users\/|\/home\/|[A-Za-z]:[\\/]|file:\/\/)/u.test(text);
}

export function buildSelectedOutputQuestion(
  blocks: readonly SpssOutputBlock[],
  ids: readonly string[],
  language: AiResponseLanguage = DEFAULT_AI_RESPONSE_LANGUAGE,
): string {
  const wanted = new Set(ids);
  const availableIds = new Set(blocks.map((block) => block.id));
  if (!ids.length || wanted.size !== ids.length || ids.some((id) => !availableIds.has(id))) {
    throw new Error('Output selection is stale or invalid.');
  }
  const selected = blocks.filter((block) => wanted.has(block.id));
  const headings = selected.map((block, index) => {
    const title = block.title.replace(/[\r\n#]/gu, ' ').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const qualification = [block.context, block.footnotes].filter(Boolean).join('\n');
    return `### ${String(index + 1)}. ${title}\n\n${qualification ? `${language === 'en' ? 'Statistical context' : '统计限定'}:\n\n${qualification}\n\n` : ''}`;
  });
  const budget = Math.floor((27_000 - headings.join('').length) / selected.length);
  if (budget < 200) { throw new Error('Output selection is too large. Select fewer tables.'); }
  const content = selected.map((block, index) => {
    let text = extractSpssOutputForAi(block.sourceHtml, language).content;
    if (text.length > budget) {
      const newline = text.lastIndexOf('\n', budget);
      text = text.slice(0, newline > 0 ? newline : budget) + (language === 'en' ? '\n[TABLE TRUNCATED]' : '\n[表格已截断]');
    }
    return `${headings[index] ?? ''}${text}`;
  }).join('\n\n');
  const instruction = language === 'en'
    ? 'Interpret each numbered selected table separately using its number and title. Do not merge the interpretations or infer absent model/sample information from other tables. Statistical context contains qualifications, not additional selected results.'
    : '请按编号和标题逐项解释所选表格，不要合并解释，也不要借其他表格推断未提供的模型或样本信息；统计限定仅为必要上下文，并非额外选中的结果。';
  return buildOutputExplanationQuestion(`${instruction}\n\n${content}`, language);
}
