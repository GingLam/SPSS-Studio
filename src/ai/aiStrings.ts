export interface AiStrings {
  activeProfile: string;
  apiKey: string;
  apiKeyMissing: string;
  apiKeyPlaceholder: string;
  apiKeySaved: string;
  baseUrl: string;
  cancel: string;
  chatEmpty: string;
  clearAll: string;
  clearAllConfirmFirst: string;
  clearAllConfirmSecond: string;
  configureModels: string;
  copy: string;
  copied: string;
  currentChat: string;
  delete: string;
  deleteConversationConfirm: string;
  deleteKey: string;
  deleteProfileConfirm: string;
  duplicate: string;
  history: string;
  historyEmpty: string;
  insert: string;
  inserted: string;
  makeActive: string;
  model: string;
  modelProfiles: string;
  name: string;
  newChat: string;
  newProfile: string;
  noProfile: string;
  officialDocs: string;
  open: string;
  profileEmpty: string;
  provider: string;
  questionPlaceholder: string;
  rename: string;
  save: string;
  savedLocallyWarning: string;
  send: string;
  sending: string;
  stop: string;
  title: string;
  transcript: string;
  truncatedHistory: string;
  user: string;
}

export const AI_STRINGS_EN: AiStrings = {
  activeProfile: 'Current model',
  apiKey: 'API Key',
  apiKeyMissing: 'No API Key saved.',
  apiKeyPlaceholder: 'Leave blank to keep the saved key; enter a new key to replace it',
  apiKeySaved: 'API Key saved securely.',
  baseUrl: 'Base URL',
  cancel: 'Cancel',
  chatEmpty: 'Ask a question about SPSS Syntax. Only the text typed here is sent to the selected provider.',
  clearAll: 'Clear all history',
  clearAllConfirmFirst: 'Clear all SPSS AI conversation history?',
  clearAllConfirmSecond: 'This permanently removes every locally saved SPSS AI conversation.',
  configureModels: 'Manage models',
  copy: 'Copy',
  copied: 'Copied',
  currentChat: 'Current Chat',
  delete: 'Delete',
  deleteConversationConfirm: 'Delete this SPSS AI conversation?',
  deleteKey: 'Delete key',
  deleteProfileConfirm: 'Delete this AI model profile? Existing conversations will remain readable.',
  duplicate: 'Duplicate',
  history: 'Chat History',
  historyEmpty: 'No saved conversations yet.',
  insert: 'Insert',
  inserted: 'Inserted',
  makeActive: 'Make active',
  model: 'Model',
  modelProfiles: 'Model Profiles',
  name: 'Name',
  newChat: 'New Chat',
  newProfile: 'New profile',
  noProfile: 'No model configured',
  officialDocs: 'Official docs',
  open: 'Open',
  profileEmpty: 'Create a model profile to start using SPSS AI.',
  provider: 'Provider',
  questionPlaceholder: 'Ask about SPSS Syntax…',
  rename: 'Rename',
  save: 'Save',
  savedLocallyWarning: 'The answer is visible now but could not be saved to local history.',
  send: 'Send',
  sending: 'Generating…',
  stop: 'Stop',
  title: 'SPSS AI',
  transcript: 'Conversation',
  truncatedHistory: 'Older messages were removed because this conversation exceeded the local history limit.',
  user: 'You',
};

export const AI_STRINGS_ZH_CN: AiStrings = {
  activeProfile: '当前模型',
  apiKey: 'API Key',
  apiKeyMissing: '尚未保存 API Key。',
  apiKeyPlaceholder: '留空以保留已保存密钥；输入新密钥可替换',
  apiKeySaved: 'API Key 已安全保存。',
  baseUrl: 'Base URL',
  cancel: '取消',
  chatEmpty: '请输入有关 SPSS 语法的问题。只有你在此输入的文字会发送给所选模型服务商。',
  clearAll: '清空全部历史',
  clearAllConfirmFirst: '清空全部 SPSS AI 历史对话？',
  clearAllConfirmSecond: '此操作将永久删除本机保存的全部 SPSS AI 对话。',
  configureModels: '管理模型',
  copy: '复制',
  copied: '已复制',
  currentChat: '当前对话',
  delete: '删除',
  deleteConversationConfirm: '删除这条 SPSS AI 对话？',
  deleteKey: '删除密钥',
  deleteProfileConfirm: '删除这个 AI 模型配置？已有历史对话仍可查看。',
  duplicate: '复制配置',
  history: '历史对话',
  historyEmpty: '尚无历史对话。',
  insert: '插入',
  inserted: '已插入',
  makeActive: '设为当前模型',
  model: '模型',
  modelProfiles: '模型配置',
  name: '配置名称',
  newChat: '新建对话',
  newProfile: '新建配置',
  noProfile: '尚未配置模型',
  officialDocs: '官方文档',
  open: '打开',
  profileEmpty: '请先创建模型配置，然后使用 SPSS AI。',
  provider: '服务商',
  questionPlaceholder: '询问 SPSS 语法……',
  rename: '重命名',
  save: '保存',
  savedLocallyWarning: '回答当前可见，但未能保存到本机历史。',
  send: '发送',
  sending: '正在生成……',
  stop: '停止',
  title: 'SPSS AI',
  transcript: '对话内容',
  truncatedHistory: '该对话超过本地历史上限，较早的消息已被移除。',
  user: '你',
};

export function aiStringsForLanguage(language: string): AiStrings {
  return language.toLowerCase() === 'zh-cn' ? AI_STRINGS_ZH_CN : AI_STRINGS_EN;
}
