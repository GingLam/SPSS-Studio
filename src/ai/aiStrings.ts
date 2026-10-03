export interface AiStrings {
  activeProfile: string;
  apiKey: string;
  apiKeyMissing: string;
  apiKeyPlaceholder: string;
  apiKeySaved: string;
  baseUrl: string;
  busyWarning: string;
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
  enableReasoning: string;
  insert: string;
  insertRequiresEditor: string;
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
  responseLanguage: string;
  responseLanguageChinese: string;
  responseLanguageEnglish: string;
  reasoningUnavailable: string;
  questionPlaceholder: string;
  questions: string;
  rename: string;
  run: string;
  runUnavailable: string;
  save: string;
  savedLocallyWarning: string;
  send: string;
  sending: string;
  stop: string;
  title: string;
  transcript: string;
  truncatedHistory: string;
  untrustedWorkspace: string;
  manageWorkspaceTrust: string;
  user: string;
}

export const AI_STRINGS_EN: AiStrings = {
  activeProfile: 'Active model',
  apiKey: 'API Key',
  apiKeyMissing: 'No API Key saved.',
  apiKeyPlaceholder: 'Leave blank to keep the saved key; enter a new key to replace it',
  apiKeySaved: 'API Key saved securely.',
  baseUrl: 'Base URL',
  busyWarning: 'Wait for the current AI response or stop it before sending another question.',
  cancel: 'Cancel',
  chatEmpty: 'Ask a question about SPSS Syntax. Only the text typed here is sent to the selected provider.',
  clearAll: 'Clear all history',
  clearAllConfirmFirst: 'Clear all SPSS AI conversation history?',
  clearAllConfirmSecond: 'This permanently removes every locally saved SPSS AI conversation.',
  configureModels: 'Setting',
  copy: 'Copy',
  copied: 'Copied',
  currentChat: 'Current',
  delete: 'Delete',
  deleteConversationConfirm: 'Delete this SPSS AI conversation?',
  deleteKey: 'Delete key',
  deleteProfileConfirm: 'Delete this AI model profile? Existing conversations will remain readable.',
  duplicate: 'Duplicate',
  history: 'History',
  historyEmpty: 'No saved conversations yet.',
  enableReasoning: 'Reasoning',
  insert: 'Insert',
  insertRequiresEditor: 'Open an SPSS syntax editor before inserting AI-generated code.',
  inserted: 'Inserted',
  makeActive: 'Activate',
  model: 'Model',
  modelProfiles: 'Models',
  name: 'Name',
  newChat: 'New',
  newProfile: 'New',
  noProfile: 'No model',
  officialDocs: 'Docs',
  open: 'Open',
  profileEmpty: 'Create a model profile to start using SPSS AI.',
  provider: 'Provider',
  responseLanguage: 'Language',
  responseLanguageChinese: 'Chinese (default)',
  responseLanguageEnglish: 'English',
  reasoningUnavailable: 'Automatic reasoning control is unavailable for custom providers.',
  questionPlaceholder: 'Ask about SPSS Syntax…',
  questions: 'question(s)',
  rename: 'Rename',
  run: 'Run',
  runUnavailable: 'SPSS Studio is not ready to run this code block.',
  save: 'Save',
  savedLocallyWarning: 'The answer is visible now but could not be saved to local history.',
  send: 'Send',
  sending: 'Generating…',
  stop: 'Stop',
  title: 'SPSS AI',
  transcript: 'Conversation',
  truncatedHistory: 'Older messages were removed because this conversation exceeded the local history limit.',
  untrustedWorkspace: 'Sending an AI question is disabled in an untrusted workspace.',
  manageWorkspaceTrust: 'Manage Workspace Trust',
  user: 'You',
};

export const AI_STRINGS_ZH_CN: AiStrings = {
  activeProfile: 'Active model',
  apiKey: 'API Key',
  apiKeyMissing: '尚未保存 API Key。',
  apiKeyPlaceholder: '留空以保留已保存密钥；输入新密钥可替换',
  apiKeySaved: 'API Key 已安全保存。',
  baseUrl: 'Base URL',
  busyWarning: '请等待当前 AI 回复完成，或先停止生成，再发送其他问题。',
  cancel: '取消',
  chatEmpty: '请输入有关 SPSS 语法的问题。只有你在此输入的文字会发送给所选模型服务商。',
  clearAll: '清空全部历史',
  clearAllConfirmFirst: '清空全部 SPSS AI 历史对话？',
  clearAllConfirmSecond: '此操作将永久删除本机保存的全部 SPSS AI 对话。',
  configureModels: 'Setting',
  copy: 'Copy',
  copied: 'Copied',
  currentChat: 'Current',
  delete: 'Delete',
  deleteConversationConfirm: '删除这条 SPSS AI 对话？',
  deleteKey: 'Delete key',
  deleteProfileConfirm: '删除这个 AI 模型配置？已有历史对话仍可查看。',
  duplicate: 'Duplicate',
  history: 'History',
  historyEmpty: '尚无历史对话。',
  enableReasoning: 'Reasoning',
  insert: 'Insert',
  insertRequiresEditor: '请先打开 SPSS 语法编辑器，再插入 AI 生成的代码。',
  inserted: 'Inserted',
  makeActive: 'Activate',
  model: 'Model',
  modelProfiles: 'Models',
  name: 'Name',
  newChat: 'New',
  newProfile: 'New',
  noProfile: 'No model',
  officialDocs: 'Docs',
  open: '打开',
  profileEmpty: '请先创建模型配置，然后使用 SPSS AI。',
  provider: 'Provider',
  responseLanguage: 'Language',
  responseLanguageChinese: 'Chinese (default)',
  responseLanguageEnglish: 'English',
  reasoningUnavailable: '自定义服务商不支持自动配置推理参数。',
  questionPlaceholder: '询问 SPSS 语法……',
  questions: '轮提问',
  rename: '重命名',
  run: 'Run',
  runUnavailable: 'SPSS Studio 尚未准备好执行该代码块。',
  save: 'Save',
  savedLocallyWarning: '回答当前可见，但未能保存到本机历史。',
  send: '发送',
  sending: '正在生成……',
  stop: '停止',
  title: 'SPSS AI',
  transcript: '对话内容',
  truncatedHistory: '该对话超过本地历史上限，较早的消息已被移除。',
  untrustedWorkspace: '不受信任的工作区禁止发送 AI 问题。',
  manageWorkspaceTrust: '管理工作区信任',
  user: '你',
};

export function aiStringsForLanguage(language: string): AiStrings {
  return language.toLowerCase() === 'zh-cn' ? AI_STRINGS_ZH_CN : AI_STRINGS_EN;
}
