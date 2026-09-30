export interface CommandRange {
  start: number;
  end: number;
  text: string;
  type: 'command' | 'block' | 'comment';
  blockType?: string;
}

export type LexicalRegion = 'code' | 'string' | 'comment' | 'begin-data' | 'embedded-program' | 'blank';

export type CurrentCommandResult =
  | (CommandRange & { kind: 'found'; type: 'command' | 'block' })
  | { kind: 'none'; reason: 'blank' | 'comment' };

interface LineInfo {
  start: number;
  contentEnd: number;
  end: number;
  text: string;
}

interface BlockDefinition {
  type: string;
  begin: RegExp;
  end: RegExp;
}

const BLOCKS: BlockDefinition[] = [
  { type: 'data', begin: /^BEGIN\s+DATA\.?$/iu, end: /^END\s+DATA\.$/iu },
  { type: 'program', begin: /^BEGIN\s+PROGRAM(?:\s+[A-Z][A-Z0-9_]*)?\.$/iu, end: /^END\s+PROGRAM\.$/iu },
  { type: 'gpl', begin: /^BEGIN\s+GPL\.$/iu, end: /^END\s+GPL\.$/iu },
  { type: 'expr', begin: /^BEGIN\s+EXPR\.$/iu, end: /^END\s+EXPR\.$/iu },
  { type: 'matrix', begin: /^MATRIX\.$/iu, end: /^END\s+MATRIX\.$/iu },
  { type: 'input-program', begin: /^INPUT\s+PROGRAM\.$/iu, end: /^END\s+INPUT\s+PROGRAM\.$/iu },
  { type: 'file-type', begin: /^FILE\s+TYPE(?:\s+.*)?\.$/iu, end: /^END\s+FILE\s+TYPE\.$/iu },
  { type: 'macro', begin: /^DEFINE\b.*$/iu, end: /^!ENDDEFINE\.$/iu },
  { type: 'simprep', begin: /^SIMPREP\s+BEGIN\b.*$/iu, end: /^SIMPREP\s+END\.$/iu },
  { type: 'tms', begin: /^TMS\s+BEGIN\b.*$/iu, end: /^TMS\s+END\.$/iu },
  { type: 'do-if', begin: /^DO\s+IF\b.*\.$/iu, end: /^END\s+IF\.$/iu },
  { type: 'do-repeat', begin: /^DO\s+REPEAT\b.*\.$/iu, end: /^END\s+REPEAT\.$/iu },
  { type: 'loop', begin: /^LOOP\b.*\.$/iu, end: /^END\s+LOOP(?:\s+IF\b.*)?\.$/iu },
];

function getLines(text: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text[index] !== '\n') {
      continue;
    }
    const rawContentEnd = index > start && text[index - 1] === '\r' ? index - 1 : index;
    lines.push({
      start,
      contentEnd: rawContentEnd,
      end: index < text.length ? index + 1 : index,
      text: text.slice(start, rawContentEnd),
    });
    start = index + 1;
  }
  return lines;
}

function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith('*') || /^COMMENT(?:\s|\.|$)/iu.test(trimmed);
}

function findBlockRanges(text: string): CommandRange[] {
  const lines = getLines(text);
  const stack: Array<{ definition: BlockDefinition; line: LineInfo }> = [];
  const ranges: CommandRange[] = [];

  for (const line of lines) {
    const trimmed = line.text.trim();
    if (!trimmed || isCommentLine(trimmed) || trimmed.startsWith('/*')) {
      continue;
    }

    const top = stack.at(-1);
    if (top?.definition.end.test(trimmed)) {
      stack.pop();
      if (stack.length === 0) {
        const start = top.line.start;
        const end = line.contentEnd;
        ranges.push({
          start,
          end,
          text: text.slice(start, end),
          type: 'block',
          blockType: top.definition.type,
        });
      }
      continue;
    }

    for (const definition of BLOCKS) {
      if (definition.begin.test(trimmed)) {
        stack.push({ definition, line });
        break;
      }
    }
  }

  return ranges.sort((left, right) => left.start - right.start);
}

function openBlockAt(text: string, offset: number): BlockDefinition | undefined {
  const stack: BlockDefinition[] = [];
  for (const line of getLines(text.slice(0, offset))) {
    const trimmed = line.text.trim();
    if (!trimmed || isCommentLine(trimmed) || trimmed.startsWith('/*')) {
      continue;
    }
    const top = stack.at(-1);
    if (top?.end.test(trimmed)) {
      stack.pop();
      continue;
    }
    const opening = BLOCKS.find((definition) => definition.begin.test(trimmed));
    if (opening) {
      stack.push(opening);
    }
  }
  return stack.at(-1);
}

function previousNonWhitespace(text: string, from: number, before: number): string | undefined {
  for (let index = before - 1; index >= from; index -= 1) {
    const character = text[index];
    if (character !== undefined && !/\s/u.test(character)) {
      return character;
    }
  }
  return undefined;
}

function isTerminatorDot(text: string, index: number, commandStart: number): boolean {
  const lineEndIndex = text.indexOf('\n', index);
  const lineEnd = lineEndIndex < 0 ? text.length : lineEndIndex;
  if (!/^\s*$/u.test(text.slice(index + 1, lineEnd))) {
    return false;
  }

  const next = text[index + 1];
  if (next !== undefined && /[A-Z0-9_@#$]/iu.test(next)) {
    return false;
  }

  const previous = previousNonWhitespace(text, commandStart, index);
  if (previous === undefined || /[=,(+\-*/<>&|~]/u.test(previous)) {
    return false;
  }
  return true;
}

function isBlankLineBoundary(text: string, index: number): boolean {
  if (text[index] !== '\n') {
    return false;
  }
  let cursor = index + 1;
  while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t' || text[cursor] === '\r')) {
    cursor += 1;
  }
  return text[cursor] === '\n';
}

function trimEndOffset(text: string, start: number, end: number): number {
  let result = end;
  while (result > start && /[\s]/u.test(text[result - 1] ?? '')) {
    result -= 1;
  }
  return result;
}

export function scanCommands(text: string): CommandRange[] {
  const blocks = findBlockRanges(text);
  const ranges: CommandRange[] = [];
  let blockIndex = 0;
  let cursor = 0;

  while (cursor < text.length) {
    const block = blocks[blockIndex];
    if (block && cursor >= block.start) {
      ranges.push(block);
      cursor = block.end;
      blockIndex += 1;
      continue;
    }

    const lineStart = cursor === 0 ? 0 : (text.lastIndexOf('\n', cursor - 1) + 1);
    while (cursor < text.length && /\s/u.test(text[cursor] ?? '')) {
      cursor += 1;
    }
    if (cursor >= text.length) {
      break;
    }
    if (block && cursor >= block.start) {
      continue;
    }

    const commandStart = Math.max(lineStart, text.lastIndexOf('\n', cursor - 1) + 1);
    const firstText = text.slice(cursor);
    const isComment = text[cursor] === '*' || /^COMMENT(?:\s|\.|$)/iu.test(firstText);
    let state: 'normal' | 'single' | 'double' | 'inline-comment' = 'normal';
    let index = cursor;
    let ended = false;

    while (index < text.length) {
      if (block && index >= block.start) {
        break;
      }
      const character = text[index];
      const following = text[index + 1];

      if (state === 'single') {
        if (character === "'" && following === "'") {
          index += 2;
          continue;
        }
        if (character === "'") {
          state = 'normal';
        }
        index += 1;
        continue;
      }

      if (state === 'double') {
        if (character === '"' && following === '"') {
          index += 2;
          continue;
        }
        if (character === '"') {
          state = 'normal';
        }
        index += 1;
        continue;
      }

      if (state === 'inline-comment') {
        if (character === '*' && following === '/') {
          state = 'normal';
          index += 2;
        } else {
          index += 1;
        }
        continue;
      }

      if (character === '/' && following === '*') {
        state = 'inline-comment';
        index += 2;
        continue;
      }
      if (character === "'") {
        state = 'single';
        index += 1;
        continue;
      }
      if (character === '"') {
        state = 'double';
        index += 1;
        continue;
      }
      if (character === '.' && isTerminatorDot(text, index, commandStart)) {
        const end = index + 1;
        ranges.push({
          start: commandStart,
          end,
          text: text.slice(commandStart, end),
          type: isComment ? 'comment' : 'command',
        });
        cursor = end;
        ended = true;
        break;
      }
      if (!isComment && isBlankLineBoundary(text, index)) {
        const end = trimEndOffset(text, commandStart, index);
        if (end > commandStart) {
          ranges.push({
            start: commandStart,
            end,
            text: text.slice(commandStart, end),
            type: 'command',
          });
        }
        cursor = index + 1;
        ended = true;
        break;
      }
      index += 1;
    }

    if (!ended) {
      if (block && index >= block.start) {
        const end = trimEndOffset(text, commandStart, block.start);
        if (end > commandStart) {
          ranges.push({
            start: commandStart,
            end,
            text: text.slice(commandStart, end),
            type: isComment ? 'comment' : 'command',
          });
        }
        cursor = block.start;
      } else {
        const end = trimEndOffset(text, commandStart, text.length);
        if (end > commandStart) {
          ranges.push({
            start: commandStart,
            end,
            text: text.slice(commandStart, end),
            type: isComment ? 'comment' : 'command',
          });
        }
        cursor = text.length;
      }
    }
  }

  return ranges.sort((left, right) => left.start - right.start);
}

export function findCurrentCommand(text: string, offset: number): CurrentCommandResult {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  for (const range of scanCommands(text)) {
    if (safeOffset >= range.start && safeOffset <= range.end) {
      if (range.type === 'comment') {
        return { kind: 'none', reason: 'comment' };
      }
      return { ...range, kind: 'found', type: range.type };
    }
  }
  return { kind: 'none', reason: 'blank' };
}

/** Returns the lexical region at an offset using the same command ranges as execution. */
export function lexicalRegionAt(text: string, offset: number): LexicalRegion {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const openBlock = openBlockAt(text, safeOffset);
  if (openBlock?.type === 'data') {
    return 'begin-data';
  }
  if (openBlock?.type === 'program') {
    return 'embedded-program';
  }
  const range = scanCommands(text).find((candidate) => safeOffset >= candidate.start && safeOffset <= candidate.end);
  if (!range) {
    return 'blank';
  }
  if (range.type === 'comment') {
    return 'comment';
  }
  if (range.type === 'block' && range.blockType === 'data') {
    const firstLineEnd = text.indexOf('\n', range.start);
    const lastLineStart = text.lastIndexOf('\n', range.end) + 1;
    if (safeOffset > firstLineEnd && safeOffset < lastLineStart) {
      return 'begin-data';
    }
  }
  if (range.type === 'block' && range.blockType === 'program') {
    const firstLineEnd = text.indexOf('\n', range.start);
    const lastLineStart = text.lastIndexOf('\n', range.end) + 1;
    if (safeOffset > firstLineEnd && safeOffset < lastLineStart) {
      return 'embedded-program';
    }
  }

  let state: 'code' | 'single' | 'double' | 'inline-comment' = 'code';
  for (let index = range.start; index < safeOffset; index += 1) {
    const character = text[index];
    const following = text[index + 1];
    if (state === 'single') {
      if (character === "'" && following === "'") {
        index += 1;
      } else if (character === "'") {
        state = 'code';
      }
      continue;
    }
    if (state === 'double') {
      if (character === '"' && following === '"') {
        index += 1;
      } else if (character === '"') {
        state = 'code';
      }
      continue;
    }
    if (state === 'inline-comment') {
      if (character === '*' && following === '/') {
        state = 'code';
        index += 1;
      }
      continue;
    }
    if (character === '/' && following === '*') {
      state = 'inline-comment';
      index += 1;
    } else if (character === "'") {
      state = 'single';
    } else if (character === '"') {
      state = 'double';
    }
  }
  if (state === 'single' || state === 'double') {
    return 'string';
  }
  return state === 'inline-comment' ? 'comment' : 'code';
}
