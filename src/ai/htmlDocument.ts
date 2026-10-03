export interface HtmlElement {
  type: 'element';
  tag: string;
  attributes: Record<string, string>;
  children: HtmlNode[];
  parent?: HtmlElement;
}

export interface HtmlText {
  type: 'text';
  content: string;
  parent?: HtmlElement;
}

export type HtmlNode = HtmlElement | HtmlText;

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

export function parseHtmlDocument(source: string): HtmlElement {
  const root: HtmlElement = {
    type: 'element',
    tag: '#document',
    attributes: {},
    children: [],
  };
  const stack = [root];
  let offset = 0;
  while (offset < source.length) {
    const opening = source.indexOf('<', offset);
    if (opening < 0) {
      appendText(stack[stack.length - 1] ?? root, source.slice(offset));
      break;
    }
    if (opening > offset) {
      appendText(stack[stack.length - 1] ?? root, source.slice(offset, opening));
    }
    if (source.startsWith('<!--', opening)) {
      const end = source.indexOf('-->', opening + 4);
      offset = end < 0 ? source.length : end + 3;
      continue;
    }
    const closing = findTagEnd(source, opening + 1);
    if (closing < 0) {
      appendText(stack[stack.length - 1] ?? root, source.slice(opening));
      break;
    }
    const rawTag = source.slice(opening + 1, closing).trim();
    offset = closing + 1;
    if (!rawTag || rawTag.startsWith('!') || rawTag.startsWith('?')) {
      continue;
    }
    if (rawTag.startsWith('/')) {
      const closingName = tagName(rawTag.slice(1));
      if (closingName) {
        closeElement(stack, closingName);
      }
      continue;
    }
    const selfClosing = /\/\s*$/u.test(rawTag);
    const normalizedTag = selfClosing ? rawTag.replace(/\/\s*$/u, '').trimEnd() : rawTag;
    const name = tagName(normalizedTag);
    if (!name) {
      continue;
    }
    const nameEnd = normalizedTag.search(/\s/u);
    const attributesSource = nameEnd < 0 ? '' : normalizedTag.slice(nameEnd + 1);
    const parent = stack[stack.length - 1] ?? root;
    const element: HtmlElement = {
      type: 'element',
      tag: name,
      attributes: parseAttributes(attributesSource),
      children: [],
      parent,
    };
    parent.children.push(element);
    if (RAW_TEXT_ELEMENTS.has(name)) {
      const closePattern = `</${name}`;
      const lowerSource = source.toLowerCase();
      const rawClose = lowerSource.indexOf(closePattern, offset);
      if (rawClose < 0) {
        offset = source.length;
        continue;
      }
      const rawCloseEnd = findTagEnd(source, rawClose + 2);
      offset = rawCloseEnd < 0 ? source.length : rawCloseEnd + 1;
      continue;
    }
    if (!selfClosing && !VOID_ELEMENTS.has(name)) {
      stack.push(element);
    }
  }
  return root;
}

export function elementChildren(element: HtmlElement, tag?: string): HtmlElement[] {
  return element.children.filter((child): child is HtmlElement => (
    child.type === 'element' && (tag === undefined || child.tag === tag)
  ));
}

export function hasClass(element: HtmlElement, value: string): boolean {
  return (element.attributes.class ?? '').split(/\s+/u).includes(value);
}

export function htmlText(element: HtmlElement): string {
  return normalizeText(collectText(element));
}

export function descendants(element: HtmlElement, tag: string): HtmlElement[] {
  const found: HtmlElement[] = [];
  const visit = (current: HtmlElement): void => {
    for (const child of current.children) {
      if (child.type !== 'element') {
        continue;
      }
      if (child.tag === tag) {
        found.push(child);
      }
      visit(child);
    }
  };
  visit(element);
  return found;
}

export function hasDescendantTag(element: HtmlElement, tags: ReadonlySet<string>): boolean {
  for (const child of element.children) {
    if (child.type !== 'element') {
      continue;
    }
    if (tags.has(child.tag) || hasDescendantTag(child, tags)) {
      return true;
    }
  }
  return false;
}

function appendText(parent: HtmlElement, content: string): void {
  if (!content) {
    return;
  }
  const previous = parent.children[parent.children.length - 1];
  if (previous?.type === 'text') {
    previous.content += content;
    return;
  }
  parent.children.push({ type: 'text', content, parent });
}

function findTagEnd(source: string, start: number): number {
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (quote) {
      if (character === quote) {
        quote = '';
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

function tagName(value: string): string {
  return value.match(/^([A-Za-z][A-Za-z0-9:-]*)/u)?.[1]?.toLowerCase() ?? '';
}

function closeElement(stack: HtmlElement[], name: string): void {
  for (let index = stack.length - 1; index > 0; index -= 1) {
    if (stack[index]?.tag === name) {
      stack.length = index;
      return;
    }
  }
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let offset = 0;
  while (offset < source.length) {
    while (/\s/u.test(source[offset] ?? '')) {
      offset += 1;
    }
    const nameStart = offset;
    while (offset < source.length && !/[\s=>/]/u.test(source[offset] ?? '')) {
      offset += 1;
    }
    const name = source.slice(nameStart, offset).toLowerCase();
    if (!name) {
      offset += 1;
      continue;
    }
    while (/\s/u.test(source[offset] ?? '')) {
      offset += 1;
    }
    let value = '';
    if (source[offset] === '=') {
      offset += 1;
      while (/\s/u.test(source[offset] ?? '')) {
        offset += 1;
      }
      const quote = source[offset];
      if (quote === '"' || quote === "'") {
        offset += 1;
        const valueStart = offset;
        while (offset < source.length && source[offset] !== quote) {
          offset += 1;
        }
        value = source.slice(valueStart, offset);
        if (source[offset] === quote) {
          offset += 1;
        }
      } else {
        const valueStart = offset;
        while (offset < source.length && !/[\s>]/u.test(source[offset] ?? '')) {
          offset += 1;
        }
        value = source.slice(valueStart, offset);
      }
    }
    attributes[name] = decodeHtmlEntities(value);
  }
  return attributes;
}

function collectText(element: HtmlElement): string {
  if (element.tag === 'script' || element.tag === 'style' || hasClass(element, 'details')) {
    return '';
  }
  const parts: string[] = [];
  for (const child of element.children) {
    if (child.type === 'text') {
      parts.push(decodeHtmlEntities(child.content));
    } else if (child.tag === 'br') {
      parts.push('\n');
    } else {
      parts.push(collectText(child));
      if (child.tag === 'p') {
        parts.push('\n');
      }
    }
  }
  return parts.join('');
}

function normalizeText(value: string): string {
  return value
    .replace(/[\t\r ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
    ndash: '–', mdash: '—', minus: '−', middot: '·', le: '≤', ge: '≥',
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
