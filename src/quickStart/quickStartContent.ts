import type { QuickStartLanguage } from './quickStartState';

export interface QuickStartHtmlOptions {
  language: QuickStartLanguage;
  suppressAfterUpdates: boolean;
  styleUri: string;
  scriptUri: string;
  nonce: string;
  cspSource: string;
  isWindows?: boolean;
  isRemote?: boolean;
  version?: string;
}

interface QuickStartCopy {
  title: string;
  introduction: string;
  preferenceTitle: string;
  preferenceText: string;
  preferenceHint: string;
  preferenceSaving: string;
  preferenceSavedOn: string;
  preferenceSavedOff: string;
  sections: string;
}

const ENGLISH_SECTIONS = `
  <section>
    <h2>1. Before you start</h2>
    <ul>
      <li>Install Visual Studio Code 1.95 or newer.</li>
      <li>Install and license IBM SPSS Statistics with the Python Integration Package.</li>
      <li>Open a trusted folder or workspace. SPSS execution, dataset access, and AI requests are disabled in Restricted Mode.</li>
      <li>Use the SPSS syntax editor for the extension’s editor actions. You can create a syntax file from the File menu.</li>
    </ul>
  </section>
  <section>
    <h2>2. Start in 60 seconds</h2>
    <ol>
      <li>Choose <strong>File → New File… → SPSS File</strong>. VS Code opens a blank syntax editor and Studio beside it. Save the file with a <code>.sps</code> extension when ready.</li>
      <li>Enter or paste valid SPSS Syntax.</li>
      <li>Select syntax and click <strong>Run</strong>, or place the cursor inside a command and click <strong>Run</strong>. Use <strong>Run All</strong> for the complete in-memory file.</li>
      <li>The first execution starts the local SPSS engine and switches Studio to <strong>Output</strong>. You do not normally need to open the SPSS desktop application first.</li>
    </ol>
    <p><kbd>Cmd</kbd>+<kbd>Enter</kbd> runs on macOS; <kbd>Ctrl</kbd>+<kbd>Enter</kbd> runs on Windows and Linux.</p>
    <p>Native result headings follow the VS Code display language: Chinese uses Simplified Chinese, English and other languages use English. The AI chat language is set separately. Windows CRLF and macOS/Unix LF syntax are accepted without rewriting the file. Completion recommends <code>GET FILE "data.sav".</code> and double-quoted strings.</p>
  </section>
  <section>
    <h2>3. Edit and run Syntax</h2>
    <p>Local completion starts with one character. <code>/</code> offers the current command's covered subcommands. Press <kbd>Tab</kbd> to accept the selected minimal template, then fill the gray fields. <kbd>Ctrl</kbd>+<kbd>Space</kbd> opens the full local list.</p>
    <div class="feature-grid">
      <article><h3>Undo</h3><p>Uses the native VS Code undo stack and targets the most recently used SPSS editor.</p></article>
      <article><h3>Run</h3><p>Runs the selection. With no selection, it resolves the current SPSS command or structural block.</p></article>
      <article><h3>Run All</h3><p>Runs the complete document, including unsaved changes. Requests are serialized through one local SPSS session.</p></article>
      <article><h3>AI Assistant</h3><p>Opens the Studio <strong>Chat</strong> tab without sending or executing anything automatically.</p></article>
    </div>
  </section>
  <section>
    <h2>4. Use SPSS Studio</h2>
    <table>
      <thead><tr><th>Tab</th><th>Main uses</th></tr></thead>
      <tbody>
        <tr><td><strong>Variables</strong></td><td>Filter Name or Label, select variables, <strong>Copy</strong> their names, <strong>Insert</strong> them into Syntax, or use <strong>Explore</strong> for bounded AI-assisted analysis ideas. Double-click a Name cell for immediate insertion.</td></tr>
        <tr><td><strong>Data</strong></td><td>Inspect the Active Dataset in a read-only, paged view. Horizontal scrolling exposes all variables.</td></tr>
        <tr><td><strong>Output</strong></td><td>Review native SPSS results. Check individual tables or result blocks on the left, then click <strong>Explain</strong> for separate interpretations in Chat. With no checks, explain the whole run. Figures, Notes, paths, and runtime metadata are excluded. <strong>Export</strong> saves HTML, <strong>Print</strong> opens a print-ready copy, and <strong>History</strong> toggles previous runs.</td></tr>
        <tr><td><strong>Chat</strong></td><td>Ask focused questions about SPSS Syntax, applied statistics in SPSS, and SPSS output interpretation.</td></tr>
        <tr><td><strong>Settings</strong></td><td>Manage AI models. In <strong>System</strong>, reopen Quick Start, change the theme, set independent font sizes, or choose the AI chat language.</td></tr>
      </tbody>
    </table>
  </section>
  <section>
    <h2>5. Configure and use Chat</h2>
    <ol>
      <li>Open <strong>Settings</strong> beside Chat and create a DeepSeek, Zhipu GLM, Qwen, Doubao, or custom OpenAI-compatible profile.</li>
      <li>Confirm the Base URL, enter the model ID and API Key, then use <strong>Test</strong> to check the connection. Enable <strong>Reasoning</strong> if the model supports it, or <strong>Coding</strong> for next-command suggestions based on an anonymized syntax summary.</li>
      <li>To change the language of AI replies, go to <strong>Settings → System → AI chat language</strong>.</li>
      <li>Select syntax and use <strong>Explain in Chat</strong> from the editor context menu. It also includes any checked Output results and Variables summaries in the same request.</li>
      <li>Assistant code blocks provide <strong>Copy</strong>, <strong>Insert</strong>, and—for SPSS blocks—<strong>Run</strong>. Insert edits the Syntax file without executing it. Run executes the complete block and switches to Output.</li>
    </ol>
    <div class="notice"><strong>Review generated Syntax before running it.</strong> Model output can be incomplete or incorrect.</div>
  </section>
  <section>
    <h2>6. Privacy and troubleshooting</h2>
    <ul>
      <li>SPSS Syntax and dataset operations run through the locally installed IBM SPSS Statistics processor.</li>
      <li>API Keys are stored in VS Code SecretStorage. They are not stored in settings, Chat history, the repository, or the VSIX.</li>
      <li>Ordinary Chat uses the text you submit. Editor explanations and the Output and Variables actions can combine selected syntax with checked results or locally prepared variable summaries.</li>
      <li>If execution cannot start, verify the licensed SPSS installation, trust the workspace, and run <strong>SPSS: Show Status</strong> or <strong>SPSS: Restart Engine</strong>. You can set the installation path in VS Code’s extension settings.</li>
    </ul>
  </section>`;

const CHINESE_SECTIONS = `
  <section>
    <h2>1. 使用前提</h2>
    <ul>
      <li>安装 Visual Studio Code 1.95 或更高版本。</li>
      <li>安装并授权 IBM SPSS Statistics，同时具备 Python Integration Package。</li>
      <li>打开受信任的文件夹或工作区。受限模式下不能执行 SPSS、访问数据集或发送 AI 请求。</li>
      <li>使用 SPSS 语法编辑器可看到插件的专用操作按钮。可以从 VS Code 的文件菜单新建语法文件。</li>
    </ul>
  </section>
  <section>
    <h2>2. 60 秒快速启动</h2>
    <ol>
      <li>选择 <strong>文件 → 新建文件… → SPSS 文件</strong>。左侧会打开空白 SPSS 语法编辑器，右侧会打开 Studio。编辑后可保存为 <code>.sps</code> 文件。</li>
      <li>输入或粘贴有效的 SPSS 语法。</li>
      <li>选中语法后点击 <strong>运行</strong>；没有选区时，将光标放在命令内再点击 <strong>运行</strong>。点击<strong>运行全部</strong>可运行整个文件，包括尚未保存的修改。</li>
      <li>第一次执行时，插件会启动本地 SPSS 引擎，并切换到 Studio 的<strong>输出</strong>页。通常无须预先手动打开 SPSS 桌面程序。</li>
    </ol>
    <p>macOS 使用 <kbd>Cmd</kbd>+<kbd>Enter</kbd>；Windows 和 Linux 使用 <kbd>Ctrl</kbd>+<kbd>Enter</kbd>。</p>
    <p>原生结果表头跟随 VS Code 界面语言：中文界面使用简体中文，英文及其他界面使用英文，AI 对话语言另行设置。Windows CRLF 和 macOS/Unix LF 换行均可直接运行，不改写源文件。补全推荐 <code>GET FILE "data.sav".</code> 及双引号字符串。</p>
  </section>
  <section>
    <h2>3. 编辑和运行语法</h2>
    <p>主命令、变量和函数从一个字符开始提示。输入 <code>/</code> 可查看当前命令的子命令。按 <kbd>Tab</kbd> 接受当前选中的最小模板，再填灰色提示。按 <kbd>Ctrl</kbd>+<kbd>Space</kbd> 可打开完整本地候选。</p>
    <div class="feature-grid">
      <article><h3>撤销</h3><p>调用 VS Code 原生撤销栈，并以最近使用的 SPSS 编辑器为目标。</p></article>
      <article><h3>运行</h3><p>存在选区时运行选中语法；没有选区时，识别并运行光标所在的完整 SPSS 命令或结构块。</p></article>
      <article><h3>运行全部</h3><p>运行整个文档，包括尚未保存的修改。所有请求通过同一个本地 SPSS 会话依次执行。</p></article>
      <article><h3>AI助手</h3><p>打开 Studio 的<strong>对话</strong>页面，不会自动发送内容或执行代码。</p></article>
    </div>
  </section>
  <section>
    <h2>4. 使用 SPSS Studio</h2>
    <table>
      <thead><tr><th>页面</th><th>主要用途</th></tr></thead>
      <tbody>
        <tr><td><strong>变量</strong></td><td>按名称或标签筛选变量；选择后可<strong>复制</strong>、<strong>插入</strong>，或通过<strong>探索</strong>获取边界明确的 AI 分析建议。双击名称单元格可立即插入变量名。</td></tr>
        <tr><td><strong>数据</strong></td><td>以只读、分页方式查看活动数据集；通过横向滚动查看全部变量。</td></tr>
        <tr><td><strong>输出</strong></td><td>查看 SPSS 原生结果。在左侧勾选表格或结果板块，点击<strong>解释</strong>，由对话逐项解读；未勾选时解释整次运行。图形、注释表、路径和运行元数据会在发送前过滤。<strong>导出</strong>保存 HTML，<strong>打印</strong>打开打印版本，<strong>历史</strong>展开或收起运行记录。</td></tr>
        <tr><td><strong>对话</strong></td><td>询问 SPSS 语法、可在 SPSS 中实现的统计方法，以及如何解读输出结果。</td></tr>
        <tr><td><strong>设置</strong></td><td>管理 AI 模型。在<strong>系统</strong>栏可打开快速上手、切换主题、分别调整字号或选择 AI 对话语言。</td></tr>
      </tbody>
    </table>
  </section>
  <section>
    <h2>5. 配置和使用对话</h2>
    <ol>
      <li>打开「对话」右侧的<strong>设置</strong>，新建 DeepSeek、智谱 GLM、通义千问、豆包或自定义 OpenAI 兼容接口的模型配置。</li>
      <li>确认接口地址，填写模型标识和 API 密钥，再点击<strong>测试</strong>验证连接。可按需启用模型支持的<strong>推理</strong>，或勾选<strong>编程应用</strong>，根据当前语法的匿名化摘要获得下一条命令建议。</li>
      <li>在<strong>设置 → 系统 → AI 对话语言</strong>中选择中文或英文。</li>
      <li>在编辑器中选中语法，右键点击<strong>在对话中解释</strong>。若同时勾选了输出或变量，对话会在同一请求中结合语法、结果和变量摘要。</li>
      <li>AI 回复中的代码块提供<strong>复制</strong>、<strong>插入</strong>，SPSS 代码块还提供<strong>运行</strong>。插入只修改语法文件，不执行命令；运行会执行整个代码块并切换到输出页面。</li>
    </ol>
    <div class="notice"><strong>运行前请检查 AI 生成的语法。</strong> 模型输出可能不完整或存在错误。</div>
  </section>
  <section>
    <h2>6. 隐私与故障诊断</h2>
    <ul>
      <li>SPSS 语法和数据集操作通过本机安装的 IBM SPSS Statistics 处理器执行。</li>
      <li>API 密钥保存在 VS Code 的安全存储中，与设置、对话历史和插件安装包分开。</li>
      <li>普通对话使用你主动提交的文字。编辑器解释、输出解释和变量探索可结合所选语法与本地整理的勾选结果或变量摘要。</li>
      <li>如果无法执行，请检查 SPSS 授权与安装状态、确认工作区受信任，并运行 <strong>SPSS：查看状态</strong>或 <strong>SPSS：重启引擎</strong>。必要时可在 VS Code 的扩展设置中指定 SPSS 安装路径。</li>
    </ul>
  </section>`;

function copyFor(language: QuickStartLanguage): QuickStartCopy {
  if (language === 'zh-cn') {
    return {
      title: '快速上手',
      introduction: '从新建 SPSS 语法文件开始，了解语法编辑、本地执行、数据与变量查看以及 AI 辅助解释。',
      preferenceTitle: '更新提醒',
      preferenceText: '此后版本更新时不再自动显示快速上手',
      preferenceHint: '勾选后仍可通过语法编辑器右上角的书本图标，或「设置 → 系统」打开本页。取消勾选后，下一次版本更新将再次自动显示。',
      preferenceSaving: '正在保存…',
      preferenceSavedOn: '已保存：此后更新不再自动显示。',
      preferenceSavedOff: '已保存：下一次版本更新将继续显示。',
      sections: CHINESE_SECTIONS,
    };
  }
  return {
    title: 'Quick Start',
    introduction: 'Create your first .sps file, edit and run syntax locally, inspect data and variables, and use focused AI assistance.',
    preferenceTitle: 'Update reminder',
    preferenceText: 'Do not show Quick Start automatically after future updates',
    preferenceHint: 'Reopen this page from the book icon in the SPS editor or from Settings → System. Clear the checkbox to show it again after the next update.',
    preferenceSaving: 'Saving…',
    preferenceSavedOn: 'Saved: future updates will not open Quick Start automatically.',
    preferenceSavedOff: 'Saved: the next update will open Quick Start again.',
    sections: ENGLISH_SECTIONS,
  };
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function buildQuickStartHtml(options: QuickStartHtmlOptions): string {
  const copy = copyFor(options.language);
  const checked = options.suppressAfterUpdates ? ' checked' : '';
  return `<!DOCTYPE html>
<html lang="${options.language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeAttribute(options.cspSource)}; script-src 'nonce-${escapeAttribute(options.nonce)}';">
  <title>${copy.title}</title>
  <link rel="stylesheet" href="${escapeAttribute(options.styleUri)}">
</head>
<body
  data-saving="${escapeAttribute(copy.preferenceSaving)}"
  data-saved-on="${escapeAttribute(copy.preferenceSavedOn)}"
  data-saved-off="${escapeAttribute(copy.preferenceSavedOff)}"
>
  <main>
    <header class="hero">
      <div class="eyebrow">SPSS Studio${options.version ? ` ${escapeAttribute(options.version)}` : ''}</div>
      <h1>${copy.title}</h1>
      <p>${copy.introduction}</p>
    </header>
    ${options.isWindows || options.isRemote ? `<section class="setup-entry"><h2>${options.language === 'zh-cn' ? 'SPSS 一键配置' : 'SPSS Setup'}</h2>
    <p>${options.isRemote
      ? options.language === 'zh-cn' ? '当前是远程窗口，无法连接本机 SPSS。请在本机 Windows 或 Mac 的 VS Code 窗口打开 .sps 文件，再运行“SPSS：检测并配置”。' : 'This is a remote window and cannot connect to local SPSS. Open the .sps file in a local Windows or Mac VS Code window, then run SPSS: Detect and Configure.'
      : options.language === 'zh-cn' ? '自动查找 SPSS、配置连接并验证实际运行，无需手动设置环境变量。未配置成功时，可随时从命令面板运行“SPSS：检测并配置”。' : 'Find SPSS, save working settings, and verify execution without manual environment-variable editing. Reopen setup anytime from the command palette: SPSS: Detect and Configure.'}</p>
    <button id="configure-runtime">${options.language === 'zh-cn' ? '一键检测并配置 SPSS' : 'Detect and Configure SPSS'}</button></section>` : ''}
    <section class="setup-entry">
      <h2>${options.language === 'zh-cn' ? '内置示例' : 'Built-in Example'}</h2>
      <p>${options.language === 'zh-cn' ? '内置 60 条模拟个案，包含编号、年龄、性别、教育年限、月收入和每周工时。配套语法演示数据导入、变量设置、描述统计、条形图、散点图、t 检验和回归分析。' : 'Includes 60 simulated cases with ID, age, gender, years of education, monthly income, and weekly working hours. The tutorial covers data import, variable setup, descriptive statistics, bar and scatter charts, t tests, and regression.'}</p>
      <button id="open-example">${options.language === 'zh-cn' ? '一键加载示例' : 'Load Example'}</button>
    </section>
    <aside class="update-preference" aria-labelledby="update-preference-title">
      <h2 id="update-preference-title">${copy.preferenceTitle}</h2>
      <label for="suppress-after-updates">
        <input id="suppress-after-updates" type="checkbox"${checked}>
        <strong>${copy.preferenceText}</strong>
      </label>
      <p>${copy.preferenceHint}</p>
      <div id="preference-status" class="preference-status" role="status" aria-live="polite"></div>
    </aside>
    ${copy.sections}
  </main>
  <script nonce="${escapeAttribute(options.nonce)}" src="${escapeAttribute(options.scriptUri)}"></script>
</body>
</html>`;
}
