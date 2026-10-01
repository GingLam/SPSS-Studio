export type AssistantContentSegment =
  | { type: 'text'; content: string }
  | { type: 'code'; content: string; language?: string };

export function parseAssistantContent(content: string): AssistantContentSegment[] {
  const segments: AssistantContentSegment[] = [];
  const fence = /```([^\r\n`]*)\r?\n([\s\S]*?)```/gu;
  let cursor = 0;
  for (const match of content.matchAll(fence)) {
    const index = match.index;
    if (index > cursor) {
      segments.push({ type: 'text', content: content.slice(cursor, index) });
    }
    const code = match[2] ?? '';
    const language = (match[1] ?? '').trim();
    segments.push(language
      ? { type: 'code', language, content: code }
      : { type: 'code', content: code });
    cursor = index + match[0].length;
  }
  if (cursor < content.length) {
    segments.push({ type: 'text', content: content.slice(cursor) });
  }
  if (segments.length === 0) {
    return [{ type: 'text', content }];
  }
  return segments;
}
