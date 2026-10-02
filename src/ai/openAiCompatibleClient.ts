import {
  boundConversation,
  buildChatCompletionRequest,
  type AiChatMessage,
  type AiResponseLanguage,
} from './chatProtocol';
import {
  buildChatCompletionsUrl,
  validateProviderConfiguration,
  type AiProviderConfiguration,
} from './providerPresets';
import { OpenAiSseParser } from './sseParser';

export interface StreamChatOptions {
  configuration: AiProviderConfiguration;
  apiKey: string;
  history: readonly AiChatMessage[];
  responseLanguage?: AiResponseLanguage;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class OpenAiCompatibleClient {
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
        body: JSON.stringify(buildChatCompletionRequest(
          configuration.model,
          boundConversation(options.history),
          options.responseLanguage,
        )),
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
