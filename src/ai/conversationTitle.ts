export function conversationTitleFromQuestion(question: string, maximumCharacters = 48): string {
  const normalized = question.replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    throw new Error('A conversation title requires a non-empty question.');
  }
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const characters = Array.from(segmenter.segment(normalized), (item) => item.segment);
  if (characters.length <= maximumCharacters) {
    return normalized;
  }
  return `${characters.slice(0, maximumCharacters).join('')}…`;
}
