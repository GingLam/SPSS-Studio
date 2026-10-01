export type AiProviderId = 'deepseek' | 'zhipu' | 'qwen' | 'doubao' | 'custom';

export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  baseUrl: string;
  modelPlaceholder: string;
  helpUrl: string;
}

export interface AiProviderConfiguration {
  providerId: AiProviderId;
  baseUrl: string;
  model: string;
}

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    modelPlaceholder: 'Enter a model ID from the DeepSeek console',
    helpUrl: 'https://api-docs.deepseek.com/',
  },
  {
    id: 'zhipu',
    label: 'Zhipu GLM (智谱)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelPlaceholder: 'Enter a GLM model ID',
    helpUrl: 'https://docs.bigmodel.cn/',
  },
  {
    id: 'qwen',
    label: 'Qwen (通义千问)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelPlaceholder: 'For example: qwen-plus',
    helpUrl: 'https://help.aliyun.com/zh/model-studio/base-url',
  },
  {
    id: 'doubao',
    label: 'Doubao (豆包)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelPlaceholder: 'Enter a ModelArk model or endpoint ID',
    helpUrl: 'https://docs.volcengine.com/docs/ark/compatible-with-openai-sdk',
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible',
    baseUrl: '',
    modelPlaceholder: 'Enter the provider model ID',
    helpUrl: 'https://platform.openai.com/docs/api-reference/chat',
  },
] as const;

const PROVIDER_IDS = new Set<AiProviderId>(AI_PROVIDER_PRESETS.map((preset) => preset.id));

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && PROVIDER_IDS.has(value as AiProviderId);
}

export function providerPreset(id: AiProviderId): AiProviderPreset {
  const preset = AI_PROVIDER_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) {
    throw new Error(`Unknown AI provider: ${id}`);
  }
  return preset;
}

export function validateProviderConfiguration(
  configuration: AiProviderConfiguration,
): AiProviderConfiguration {
  if (!isAiProviderId(configuration.providerId)) {
    throw new Error('Select a supported AI provider.');
  }
  const model = configuration.model.trim();
  if (!model) {
    throw new Error('Enter a model identifier.');
  }
  const baseUrl = normalizeBaseUrl(configuration.baseUrl);
  return { providerId: configuration.providerId, baseUrl, model };
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

function normalizeBaseUrl(value: string): string {
  const input = value.trim();
  if (!input) {
    throw new Error('Enter an OpenAI-compatible Base URL.');
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('The AI Base URL is not a valid absolute URL.');
  }
  if (url.username || url.password) {
    throw new Error('The AI Base URL must not contain embedded credentials.');
  }
  if (url.search || url.hash) {
    throw new Error('The AI Base URL must not contain a query string or fragment.');
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopbackHosts.has(url.hostname))) {
    throw new Error('The AI Base URL must use HTTPS; HTTP is allowed only for loopback addresses.');
  }
  return url.toString().replace(/\/+$/u, '');
}
