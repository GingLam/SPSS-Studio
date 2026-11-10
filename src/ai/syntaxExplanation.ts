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
  return `${instruction}\n\n${fenceSyntax(normalized)}`;
}

export function fenceSyntax(syntax: string): string {
  let longest = 0;
  for (const match of syntax.matchAll(/`+/gu)) {
    longest = Math.max(longest, match[0].length);
  }
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}spss\n${syntax.trim()}\n${fence}`;
}

export function buildJointQuestion(
  syntax: string,
  attachment: string,
  kind: 'output' | 'variables' | 'both',
  language: AiResponseLanguage,
): string {
  const english = language === 'en';
  const outputInstruction = english
      ? 'Explain the selected syntax together with the checked SPSS results. Relate each result to the relevant command. If there is an error, identify the likely cause and propose minimal corrected syntax; do not assume the selected code produced the result if the evidence is insufficient.'
      : '请结合所选语法和勾选的 SPSS 结果解释，指出每项结果对应的命令。有报错时说明可能原因，并给出最小修订语法；证据不足时，不要假定结果由这段语法产生。';
  const variableInstruction = english
      ? 'Use the selected syntax and checked variable summaries together. Infer the analysis goal from the code, then write minimal executable SPSS syntax using the checked variables where appropriate. Explain their roles and ask one focused question if the goal or variable roles are unclear.'
      : '请结合所选语法和勾选的变量摘要，从语法判断分析目标，使用适当的已勾选变量给出最简可执行的 SPSS 语法，并说明变量角色。目标或变量角色不明确时，只问一个关键问题。';
  const instruction = [kind !== 'variables' ? outputInstruction : '', kind !== 'output' ? variableInstruction : '']
    .filter(Boolean).join(' ');
  const heading = english ? 'Selected SPSS syntax' : '所选 SPSS 语法';
  return `${instruction}\n\n## ${heading}\n\n${fenceSyntax(syntax)}\n\n${attachment}`;
}
