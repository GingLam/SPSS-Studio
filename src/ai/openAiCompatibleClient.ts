import {
  boundConversation,
  buildChatCompletionRequest,
  type AiChatMessage,
  type AiAssistantContext,
  type AiResponseLanguage,
} from './chatProtocol';
import {
  buildChatCompletionsUrl,
  providerReasoningFields,
  validateProviderConfiguration,
  type AiProviderConfiguration,
} from './providerPresets';
import { OpenAiSseParser } from './sseParser';

export interface StreamChatOptions {
  configuration: AiProviderConfiguration;
  apiKey: string;
  history: readonly AiChatMessage[];
  responseLanguage?: AiResponseLanguage;
  assistantContext?: AiAssistantContext;
  reasoningEnabled?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type AiConnectionResult = 'ok' | 'authentication' | 'model' | 'rateLimit' | 'service' | 'timeout'
  | 'network' | 'redirect' | 'response' | 'request' | 'cancelled';

export class ShortCompletionError extends Error {
  public constructor(public readonly code: Exclude<AiConnectionResult, 'ok'>) {
    super(`AI connection: ${code}`);
  }
}

interface ShortCompletionTarget {
  configuration: AiProviderConfiguration;
  apiKey: string;
  reasoningEnabled?: boolean;
}

interface ShortCompletionOptions extends ShortCompletionTarget {
  messages: readonly { role: AiChatMessage['role'] | 'system'; content: string }[];
  maxTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

function connectionStatus(status: number): Exclude<AiConnectionResult, 'ok'> {
  if (status >= 300 && status < 400) return 'redirect';
  if (status === 401 || status === 403) return 'authentication';
  if (status === 404) return 'model';
  if (status === 429) return 'rateLimit';
  if (status === 408 || status === 504) return 'timeout';
  return status >= 500 ? 'service' : 'request';
}

async function readShortResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new ShortCompletionError('response');
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      const value = chunk.value as Uint8Array;
      bytes += value.byteLength;
      if (bytes > 65_536) throw new ShortCompletionError('response');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  try {
    const value = JSON.parse(text) as { choices?: { message?: { content?: unknown } }[] };
    const content = value.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) return content.trim();
  } catch {
    // Provider payloads may contain private details. Only expose a diagnostic category.
  }
  throw new ShortCompletionError('response');
}

export class OpenAiCompatibleClient {
  public async testConnection(target: ShortCompletionTarget, signal?: AbortSignal): Promise<void> {
    await this.shortCompletion({
      ...target, messages: [{ role: 'user', content: 'Reply with OK.' }],
      timeoutMs: 12_000, maxTokens: target.reasoningEnabled ? 256 : 96, ...(signal ? { signal } : {}),
    });
  }

  public async shortCompletion(options: ShortCompletionOptions): Promise<string> {
    const configuration = validateProviderConfiguration(options.configuration);
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new ShortCompletionError('authentication');
    const controller = new AbortController();
    const deadline = Date.now() + options.timeoutMs;
    const cancel = (): void => controller.abort();
    const timeout = setTimeout(cancel, options.timeoutMs);
    if (options.signal?.aborted) cancel();
    else options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      controller.signal.throwIfAborted();
      const response = await fetch(buildChatCompletionsUrl(configuration.baseUrl), {
        method: 'POST',
        headers: {
          Accept: 'application/json', Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: configuration.model, messages: options.messages, stream: false, max_tokens: options.maxTokens,
          ...providerReasoningFields(configuration.providerId, options.reasoningEnabled ?? false),
        }),
        redirect: 'manual', signal: controller.signal,
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new ShortCompletionError(connectionStatus(response.status));
      }
      return await readShortResponse(response);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ShortCompletionError(Date.now() >= deadline && !options.signal?.aborted ? 'timeout' : 'cancelled');
      }
      if (error instanceof ShortCompletionError) throw error;
      throw new ShortCompletionError('network');
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', cancel);
    }
  }

  public async streamChat(
    options: StreamChatOptions,
    onDelta: (delta: string) => void,
  ): Promise<string> {
    const configuration = validateProviderConfiguration(options.configuration);
    const apiKey = options.apiKey.trim();
    if (!apiKey) {
      throw new Error('Enter an API Key for the selected AI provider.');
    }
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 120_000;
    const deadline = Date.now() + timeoutMs;
    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    const cancel = (): void => {
      controller.abort();
    };
    if (options.signal?.aborted) {
      controller.abort();
    } else {
      options.signal?.addEventListener('abort', cancel, { once: true });
    }

    try {
      const response = await fetch(buildChatCompletionsUrl(configuration.baseUrl), {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...buildChatCompletionRequest(
            configuration.model,
            boundConversation(options.history),
            options.responseLanguage,
            options.assistantContext,
          ),
          ...providerReasoningFields(configuration.providerId, options.reasoningEnabled ?? false),
        }),
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        throw new Error('The AI endpoint returned a redirect; redirects are not followed with API credentials.');
      }
      if (!response.ok) {
        throw new Error(`The AI provider returned HTTP ${String(response.status)} ${response.statusText}.`.trim());
      }
      if (!response.body) {
        throw new Error('The AI provider returned an empty streaming response.');
      }

      const parser = new OpenAiSseParser();
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let result = '';
      let part = await reader.read();
      while (!part.done) {
        const bytes = part.value as Uint8Array;
        for (const delta of parser.feed(decoder.decode(bytes, { stream: true }))) {
          result += delta;
          onDelta(delta);
        }
        part = await reader.read();
      }
      for (const delta of parser.feed(decoder.decode())) {
        result += delta;
        onDelta(delta);
      }
      for (const delta of parser.finish()) {
        result += delta;
        onDelta(delta);
      }
      if (!result) {
        throw new Error('The AI provider completed without returning assistant text.');
      }
      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        if (Date.now() >= deadline && !options.signal?.aborted) {
          throw new Error('The AI request timed out.', { cause: error });
        }
        throw new Error('The AI request was cancelled.', { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', cancel);
    }
  }
}
