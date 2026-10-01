import type {
  ConversationSummary,
  StoredConversation,
} from './conversation';
import type { ModelProfileState } from './modelProfile';

export interface AiRenderState {
  busy: boolean;
  profiles: ModelProfileState;
  history: ConversationSummary[];
  currentConversation?: StoredConversation;
}

export interface AiSendCallbacks {
  onStarted?: (question: string) => void;
  onDelta?: (content: string) => void;
}

export interface AiSendResult {
  response: string;
  state: AiRenderState;
  persistenceWarning?: string;
}
