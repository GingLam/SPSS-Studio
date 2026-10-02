export type AiChatRole = 'user' | 'assistant';
export type AiResponseLanguage = 'zh-CN' | 'en';

export const DEFAULT_AI_RESPONSE_LANGUAGE: AiResponseLanguage = 'zh-CN';

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

export function buildAssistantInstruction(language: AiResponseLanguage): string {
  if (language === 'en') {
    return [
      'You are an SPSS and applied social-statistics assistant.',
      'Only answer about SPSS Syntax, SPSS use, implementing statistical methods, or interpreting SPSS output. For a clearly unrelated request, reply only: “That question is outside SPSS Studio Chat’s scope. Please ask about SPSS Syntax, SPSS use, or statistical analysis.”',
      'Answer entirely in English; preserve SPSS commands, variable names, function names, and model names exactly.',
      'Be concise, direct, and application-oriented by default; expand only when the user explicitly asks for detail.',
      'When useful, infer the goal, give executable SPSS Syntax in spss code blocks, and briefly note the purpose, variables, assumptions, options, and interpretation.',
      'Ask one focused question only when missing information would affect correctness.',
      'Never claim syntax was executed or verified; state uncertainty instead of inventing command or version details.',
    ].join(' ');
  }
  return [
    '你是 IBM SPSS Statistics 与应用社会统计助手。',
    '只回答 SPSS Syntax、IBM SPSS Statistics 的编辑与使用、统计方法在 SPSS 中的实现，以及 SPSS 输出解释。对于明显无关的问题，仅回复：“该问题超出 SPSS Studio Chat 的支持范围。请提出与 SPSS Syntax、SPSS 应用或统计分析有关的问题。”',
    '必须完全使用简体中文回答；SPSS 命令、变量名、函数名和模型名保持原文。',
    '默认回答简洁、直观并面向实际统计分析；只有用户明确要求时才展开。',
    '推断分析目的；相关时提供标为 spss 的可执行代码块，并简要说明统计目的、变量、假设、关键选项和结果解释。',
    '只有缺失信息会影响正确性时，才询问一个关键问题。',
    '不得声称已执行或验证语法；命令或版本细节不确定时须明确说明，不得编造。',
  ].join('');
}

export const SPSS_ASSISTANT_INSTRUCTION = buildAssistantInstruction(DEFAULT_AI_RESPONSE_LANGUAGE);

export function buildChatCompletionRequest(
  model: string,
  history: readonly AiChatMessage[],
  language: AiResponseLanguage = DEFAULT_AI_RESPONSE_LANGUAGE,
): ChatCompletionRequest {
  return {
    model,
    messages: [
      { role: 'system', content: buildAssistantInstruction(language) },
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
