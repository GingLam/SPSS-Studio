export class OpenAiSseParser {
  private buffer = '';

  public feed(chunk: string): string[] {
    this.buffer += chunk;
    const content: string[] = [];
    let delimiter = /\r?\n\r?\n/u.exec(this.buffer);
    while (delimiter) {
      const event = this.buffer.slice(0, delimiter.index);
      this.buffer = this.buffer.slice(delimiter.index + delimiter[0].length);
      content.push(...this.parseEvent(event));
      delimiter = /\r?\n\r?\n/u.exec(this.buffer);
    }
    return content;
  }

  public finish(): string[] {
    const final = this.buffer.trim();
    this.buffer = '';
    return final ? this.parseEvent(final) : [];
  }

  private parseEvent(event: string): string[] {
    const data = event
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') {
      return [];
    }
    let value: unknown;
    try {
      value = JSON.parse(data) as unknown;
    } catch {
      throw new Error('Malformed JSON in the OpenAI-compatible response stream.');
    }
    if (typeof value !== 'object' || value === null || !('choices' in value)) {
      return [];
    }
    const untypedChoices = (value as { choices?: unknown }).choices;
    if (!Array.isArray(untypedChoices)) {
      return [];
    }
    const choices = untypedChoices as unknown[];
    const first = choices[0];
    if (typeof first !== 'object' || first === null || !('delta' in first)) {
      return [];
    }
    const delta = (first as { delta?: unknown }).delta;
    if (typeof delta !== 'object' || delta === null || !('content' in delta)) {
      return [];
    }
    const content = (delta as { content?: unknown }).content;
    return typeof content === 'string' && content.length > 0 ? [content] : [];
  }
}
