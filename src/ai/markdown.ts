export type MarkdownInline =
  | { type: 'text'; content: string }
  | { type: 'code'; content: string }
  | { type: 'break' }
  | { type: 'strong' | 'emphasis' | 'delete'; children: MarkdownInline[] }
  | { type: 'link'; url: string; children: MarkdownInline[] };

export type MarkdownBlock =
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'heading'; level: number; children: MarkdownInline[] }
  | { type: 'list'; ordered: boolean; start?: number; items: MarkdownBlock[][] }
  | { type: 'blockquote'; blocks: MarkdownBlock[] }
  | { type: 'thematicBreak' }
  | { type: 'table'; header: MarkdownInline[][]; rows: MarkdownInline[][][] };

interface ListMarker {
  indent: number;
  ordered: boolean;
  start?: number;
  content: string;
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  return parseBlocks(source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n'));
}

export function safeMarkdownUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'mailto:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseBlocks(lines: string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1]?.length ?? 1,
        children: parseInline(heading[2] ?? ''),
      });
      index += 1;
      continue;
    }

    if (/^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/u.test(line)) {
      blocks.push({ type: 'thematicBreak' });
      index += 1;
      continue;
    }

    if (/^ {0,3}>/u.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^ {0,3}>/u.test(lines[index] ?? '')) {
        quoted.push((lines[index] ?? '').replace(/^ {0,3}> ?/u, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', blocks: parseBlocks(quoted) });
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      const parsed = parseList(lines, index, marker);
      blocks.push(parsed.block);
      index = parsed.next;
      continue;
    }

    if (index + 1 < lines.length && isTableSeparator(lines[index + 1] ?? '')) {
      const header = splitTableRow(line).map(parseInline);
      const columnCount = splitTableRow(lines[index + 1] ?? '').length;
      if (header.length === columnCount && columnCount > 0) {
        index += 2;
        const rows: MarkdownInline[][][] = [];
        while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim()) {
          const cells = splitTableRow(lines[index] ?? '');
          rows.push(Array.from({ length: columnCount }, (_unused, cellIndex) => (
            parseInline(cells[cellIndex] ?? '')
          )));
          index += 1;
        }
        blocks.push({ type: 'table', header, rows });
        continue;
      }
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && (lines[index] ?? '').trim()) {
      const candidate = lines[index] ?? '';
      if (startsBlock(lines, index)) {
        break;
      }
      paragraph.push(candidate.trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
  }
  return blocks;
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  return /^ {0,3}(?:#{1,6})\s+/u.test(line)
    || /^ {0,3}>/u.test(line)
    || /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/u.test(line)
    || listMarker(line) !== undefined
    || (index + 1 < lines.length && isTableSeparator(lines[index + 1] ?? ''));
}

function parseList(
  lines: string[],
  startIndex: number,
  first: ListMarker,
): { block: Extract<MarkdownBlock, { type: 'list' }>; next: number } {
  const items: MarkdownBlock[][] = [];
  let index = startIndex;
  while (index < lines.length) {
    const marker = listMarker(lines[index] ?? '');
    if (!marker || marker.indent !== first.indent || marker.ordered !== first.ordered) {
      break;
    }
    const itemLines = [marker.content];
    index += 1;
    while (index < lines.length) {
      const line = lines[index] ?? '';
      const nextMarker = listMarker(line);
      if (nextMarker && nextMarker.indent === first.indent && nextMarker.ordered === first.ordered) {
        break;
      }
      if (!line.trim()) {
        itemLines.push('');
        index += 1;
        if (index >= lines.length || !(lines[index] ?? '').trim()) {
          break;
        }
        continue;
      }
      const indentation = line.match(/^\s*/u)?.[0].length ?? 0;
      if (indentation <= first.indent && startsBlock(lines, index) && !nextMarker) {
        break;
      }
      const removable = Math.min(indentation, first.indent + 2);
      itemLines.push(line.slice(removable));
      index += 1;
    }
    items.push(parseBlocks(itemLines));
  }
  return {
    block: {
      type: 'list',
      ordered: first.ordered,
      ...(first.start === undefined ? {} : { start: first.start }),
      items,
    },
    next: index,
  };
}

function listMarker(line: string): ListMarker | undefined {
  const match = line.match(/^(\s{0,12})([-+*]|(\d+)[.)])\s+(.+)$/u);
  if (!match) {
    return undefined;
  }
  const ordered = match[3] !== undefined;
  return {
    indent: match[1]?.length ?? 0,
    ordered,
    ...(ordered ? { start: Number.parseInt(match[3] ?? '1', 10) } : {}),
    content: match[4] ?? '',
  };
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()));
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/u, '').replace(/\|$/u, '');
  if (!trimmed.includes('|')) {
    return [];
  }
  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  let inCode = false;
  for (const character of trimmed) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '`') {
      inCode = !inCode;
      cell += character;
    } else if (character === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parseInline(source: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let index = 0;
  const appendText = (content: string): void => {
    if (!content) {
      return;
    }
    const previous = nodes[nodes.length - 1];
    if (previous?.type === 'text') {
      previous.content += content;
    } else {
      nodes.push({ type: 'text', content });
    }
  };

  while (index < source.length) {
    const character = source[index] ?? '';
    if (character === '\\' && index + 1 < source.length) {
      appendText(source[index + 1] ?? '');
      index += 2;
      continue;
    }
    if (character === '\n') {
      nodes.push({ type: 'break' });
      index += 1;
      continue;
    }
    if (character === '`') {
      const end = source.indexOf('`', index + 1);
      if (end > index + 1) {
        nodes.push({ type: 'code', content: source.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    if (character === '[') {
      const labelEnd = source.indexOf('](', index + 1);
      const urlEnd = labelEnd >= 0 ? source.indexOf(')', labelEnd + 2) : -1;
      if (labelEnd > index + 1 && urlEnd > labelEnd + 2) {
        const url = safeMarkdownUrl(source.slice(labelEnd + 2, urlEnd));
        if (url) {
          nodes.push({
            type: 'link',
            url,
            children: parseInline(source.slice(index + 1, labelEnd)),
          });
          index = urlEnd + 1;
          continue;
        }
      }
    }
    const underscoreCanOpen = character !== '_'
      || !/[\p{L}\p{N}_]/u.test(source[index - 1] ?? '')
      || !/[\p{L}\p{N}_]/u.test(source[index + 1] ?? '');
    const delimiter = source.startsWith('**', index)
      || (source.startsWith('__', index) && underscoreCanOpen)
      ? source.slice(index, index + 2)
      : source.startsWith('~~', index)
        ? '~~'
        : character === '*' || (character === '_' && underscoreCanOpen)
          ? character
          : undefined;
    if (delimiter) {
      const end = source.indexOf(delimiter, index + delimiter.length);
      if (end > index + delimiter.length) {
        const type = delimiter === '~~'
          ? 'delete'
          : delimiter.length === 2
            ? 'strong'
            : 'emphasis';
        nodes.push({
          type,
          children: parseInline(source.slice(index + delimiter.length, end)),
        });
        index = end + delimiter.length;
        continue;
      }
    }
    appendText(character);
    index += 1;
  }
  return nodes;
}
