export type AiChatRole = 'user' | 'assistant';

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

interface ChatCompletionMessage {
  role: 'system' | AiChatRole;
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  stream: true;
}

export const SPSS_ASSISTANT_INSTRUCTION = [
  'You are a concise IBM SPSS Statistics Syntax assistant.',
  'Answer the user question only and place executable SPSS syntax in fenced code blocks labelled spss.',
  'Do not claim that syntax has been executed or verified.',
  'If a command or version detail is uncertain, say so instead of inventing syntax.',
].join(' ');

export function buildChatCompletionRequest(
  model: string,
  history: readonly AiChatMessage[],
): ChatCompletionRequest {
  return {
    model,
    messages: [
      { role: 'system', content: SPSS_ASSISTANT_INSTRUCTION },
      ...history.map((message) => ({ role: message.role, content: message.content })),
    ],
    stream: true,
  };
}

export function boundConversation(
  history: readonly AiChatMessage[],
  maximumMessages = 20,
  maximumCharacters = 30_000,
): AiChatMessage[] {
  let bounded = history.map((message) => ({ ...message }));
  const characterCount = (): number => bounded.reduce((total, message) => total + message.content.length, 0);
  while ((bounded.length > maximumMessages || characterCount() > maximumCharacters) && bounded.length > 2) {
    bounded = bounded.slice(2);
  }
  return bounded;
}
