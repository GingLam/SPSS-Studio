import {
  DEFAULT_AI_RESPONSE_LANGUAGE,
  type AiResponseLanguage,
} from './chatProtocol';

export function buildSyntaxExplanationQuestion(
  syntax: string,
  language: AiResponseLanguage = DEFAULT_AI_RESPONSE_LANGUAGE,
): string {
  const normalized = syntax.trim();
  if (!normalized) {
    throw new Error('The selected SPSS Syntax is empty.');
  }
  const instruction = language === 'en'
    ? 'Briefly explain this SPSS Syntax:'
    : '请简要解释以下 SPSS Syntax：';
  return `${instruction}\n\n\`\`\`spss\n${normalized}\n\`\`\``;
}
