import type { QuickStartLanguage } from './quickStartState';

export interface QuickStartHtmlOptions {
  language: QuickStartLanguage;
  suppressAfterUpdates: boolean;
  styleUri: string;
  scriptUri: string;
  nonce: string;
  cspSource: string;
}

interface QuickStartCopy {
  title: string;
  eyebrow: string;
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
      <li>Create or obtain at least one <code>.sps</code> file and open it in VS Code. SPSS Studio works with SPSS Syntax files; opening an unrelated file will not expose its editor actions.</li>
    </ul>
  </section>
  <section>
    <h2>2. Start in 60 seconds</h2>
    <ol>
      <li>Open a <code>.sps</code> file.</li>
      <li>Enter or paste valid SPSS Syntax.</li>
      <li>Select syntax and click <strong>Run</strong>, or place the cursor inside a command and click <strong>Run</strong>. Use <strong>Run All</strong> for the complete in-memory file.</li>
      <li>The first execution starts the persistent local SPSS processor and opens <strong>SPSS Studio</strong> beside the editor on the <strong>Output</strong> tab. You do not normally need to open the SPSS desktop application first.</li>
    </ol>
    <p><kbd>Cmd</kbd>+<kbd>Enter</kbd> runs on macOS; <kbd>Ctrl</kbd>+<kbd>Enter</kbd> runs on Windows and Linux.</p>
  </section>
  <section>
    <h2>3. Edit and run Syntax</h2>
    <div class="feature-grid">
      <article><h3>Undo</h3><p>Uses the native VS Code undo stack and targets the most recently used SPSS editor.</p></article>
      <article><h3>Run</h3><p>Runs the selection. With no selection, it resolves the current SPSS command or structural block.</p></article>
      <article><h3>Run All</h3><p>Runs the complete document, including unsaved changes. Requests are serialized through one local SPSS session.</p></article>
      <article><h3>Show AI Assistant</h3><p>Opens the Studio <strong>Chat</strong> tab without sending or executing anything automatically.</p></article>
    </div>
  </section>
  <section>
    <h2>4. Use SPSS Studio</h2>
    <table>
      <thead><tr><th>Tab</th><th>Main uses</th></tr></thead>
      <tbody>
        <tr><td><strong>Variables</strong></td><td>Filter Name or Label, select variables, <strong>Copy</strong> their names, <strong>Insert</strong> them into Syntax, or use <strong>Explore</strong> for bounded AI-assisted analysis ideas. Double-click a Name cell for immediate insertion.</td></tr>
        <tr><td><strong>Data</strong></td><td>Inspect the Active Dataset in a read-only, paged view. Horizontal scrolling exposes all variables.</td></tr>
        <tr><td><strong>Output</strong></td><td>Review native SPSS results. <strong>Explain</strong> sends the selected run's principal tables and text—not figures, Notes, paths, or runtime metadata—to Chat. <strong>Export</strong> saves HTML, <strong>Print</strong> opens a print-ready copy, and <strong>History</strong> toggles previous runs.</td></tr>
        <tr><td><strong>Chat</strong></td><td>Ask focused questions about SPSS Syntax, applied statistics in SPSS, and SPSS output interpretation.</td></tr>
      </tbody>
    </table>
  </section>
  <section>
    <h2>5. Configure and use Chat</h2>
    <ol>
      <li>Open <strong>Chat → Setting</strong>.</li>
      <li>Create a DeepSeek, Zhipu GLM, Qwen, Doubao, or custom OpenAI-compatible profile.</li>
      <li>Confirm the Base URL, enter the provider's model identifier and API Key, choose Chinese or English, and optionally enable provider-supported reasoning.</li>
      <li>Select Syntax and use <strong>Explain in Chat</strong> from the editor context menu for a concise explanation.</li>
      <li>Assistant code blocks provide <strong>Copy</strong>, <strong>Insert</strong>, and—for SPSS blocks—<strong>Run</strong>. Insert edits the Syntax file without executing it. Run executes the complete block and switches to Output.</li>
    </ol>
    <div class="notice"><strong>Review generated Syntax before running it.</strong> Model output can be incomplete or incorrect.</div>
  </section>
  <section>
    <h2>6. Privacy and troubleshooting</h2>
    <ul>
      <li>SPSS Syntax and dataset operations run through the locally installed IBM SPSS Statistics processor.</li>
      <li>API Keys are stored in VS Code SecretStorage. They are not stored in settings, Chat history, the repository, or the VSIX.</li>
      <li>Ordinary Chat sends only text you submit. Output Explain and Variables Explore use bounded, locally prepared content described in the extension documentation.</li>
      <li>If execution cannot start, verify the licensed SPSS installation, trust the workspace, and run <strong>SPSS: Show Status</strong> or <strong>SPSS: Restart Engine</strong>. Installation paths can be overridden in SPSS Studio Settings.</li>
    </ul>
  </section>`;

const CHINESE_SECTIONS = `
  <section>
    <h2>1. 使用前提</h2>
    <ul>
      <li>安装 Visual Studio Code 1.95 或更高版本。</li>
      <li>安装并授权 IBM SPSS Statistics，同时具备 Python Integration Package。</li>
      <li>打开受信任的文件夹或工作区。受限模式下不能执行 SPSS、访问数据集或发送 AI 请求。</li>
      <li>至少准备一个 <code>.sps</code> 文件并用 VS Code 打开。SPSS Studio 面向 SPSS Syntax 文件；打开其他文件不会显示对应的编辑器操作按钮。</li>
    </ul>
  </section>
  <section>
    <h2>2. 60 秒快速启动</h2>
    <ol>
      <li>打开一个 <code>.sps</code> 文件。</li>
      <li>输入或粘贴有效的 SPSS Syntax。</li>
      <li>选中语法后点击 <strong>Run</strong>；没有选区时，将光标放在命令内再点击 <strong>Run</strong>。点击 <strong>Run All</strong> 可运行内存中的完整文件。</li>
      <li>第一次执行时，插件会启动持久化的本地 SPSS 处理器，并在编辑器右侧打开 <strong>SPSS Studio</strong> 的 <strong>Output</strong> 页面。通常无须预先手动打开 SPSS 桌面程序。</li>
    </ol>
    <p>macOS 使用 <kbd>Cmd</kbd>+<kbd>Enter</kbd>；Windows 和 Linux 使用 <kbd>Ctrl</kbd>+<kbd>Enter</kbd>。</p>
  </section>
  <section>
    <h2>3. 编辑和运行 Syntax</h2>
    <div class="feature-grid">
      <article><h3>Undo</h3><p>调用 VS Code 原生撤销栈，并以最近使用的 SPSS 编辑器为目标。</p></article>
      <article><h3>Run</h3><p>存在选区时运行选中语法；没有选区时，识别并运行光标所在的完整 SPSS 命令或结构块。</p></article>
      <article><h3>Run All</h3><p>运行整个文档，包括尚未保存的修改。所有请求通过同一个本地 SPSS 会话依次执行。</p></article>
      <article><h3>Show AI Assistant</h3><p>打开 Studio 的 <strong>Chat</strong> 页面，不会自动发送内容或执行代码。</p></article>
    </div>
  </section>
  <section>
    <h2>4. 使用 SPSS Studio</h2>
    <table>
      <thead><tr><th>页面</th><th>主要用途</th></tr></thead>
      <tbody>
        <tr><td><strong>Variables</strong></td><td>按 Name 或 Label 筛选变量；选择后可 <strong>Copy</strong>、<strong>Insert</strong>，或通过 <strong>Explore</strong> 获取边界明确的 AI 分析建议。双击 Name 单元格可立即插入变量名。</td></tr>
        <tr><td><strong>Data</strong></td><td>以只读、分页方式查看 Active Dataset；通过横向滚动查看全部变量。</td></tr>
        <tr><td><strong>Output</strong></td><td>查看 SPSS 原生结果。<strong>Explain</strong> 将所选运行的主要统计表格和文字发送给 Chat，不发送图形、Notes、路径和运行元数据；<strong>Export</strong> 导出 HTML，<strong>Print</strong> 打开打印版本，<strong>History</strong> 展开或收起历史运行记录。</td></tr>
        <tr><td><strong>Chat</strong></td><td>询问 SPSS Syntax、能够在 SPSS 中实现的应用统计方法，以及 SPSS 输出结果的解释。</td></tr>
      </tbody>
    </table>
  </section>
  <section>
    <h2>5. 配置和使用 Chat</h2>
    <ol>
      <li>打开 <strong>Chat → Setting</strong>。</li>
      <li>创建 DeepSeek、智谱 GLM、通义千问、豆包或自定义 OpenAI-compatible 模型配置。</li>
      <li>确认 Base URL，填写服务商提供的模型标识和 API Key，选择中文或英文，并按需开启模型支持的推理功能。</li>
      <li>在编辑器中选择语法，通过右键菜单 <strong>Explain in Chat</strong> 获取简洁解释。</li>
      <li>AI 回复中的代码块提供 <strong>Copy</strong>、<strong>Insert</strong>，SPSS 代码块还提供 <strong>Run</strong>。Insert 只修改语法文件，不执行命令；Run 会执行整个代码块并切换到 Output。</li>
    </ol>
    <div class="notice"><strong>运行前必须检查 AI 生成的 Syntax。</strong> 模型输出可能不完整或存在错误。</div>
  </section>
  <section>
    <h2>6. 隐私与故障诊断</h2>
    <ul>
      <li>SPSS Syntax 和数据集操作通过本机安装的 IBM SPSS Statistics 处理器执行。</li>
      <li>API Key 保存在 VS Code SecretStorage 中，不会写入设置、Chat 历史、GitHub 仓库或 VSIX。</li>
      <li>普通 Chat 只发送用户主动提交的文字。Output Explain 和 Variables Explore 只使用插件文档所述的、本地整理且有长度限制的内容。</li>
      <li>如果无法执行，请检查 SPSS 授权与安装状态、确认工作区受信任，并运行 <strong>SPSS: Show Status</strong> 或 <strong>SPSS: Restart Engine</strong>。必要时可在 SPSS Studio 设置中手动指定安装路径。</li>
    </ul>
  </section>`;

function copyFor(language: QuickStartLanguage): QuickStartCopy {
  if (language === 'zh-cn') {
    return {
      title: '快速上手',
      eyebrow: 'SPSS Studio 1.2.0',
      introduction: '从打开第一个 .sps 文件开始，完成 Syntax 编辑、SPSS 本地执行、数据与变量查看，以及 AI 辅助解释。',
      preferenceTitle: '更新提醒',
      preferenceText: '此后版本更新时不再自动显示快速上手',
      preferenceHint: '勾选后仍可随时点击 .sps 编辑器右上角的书本图标重新打开本页。取消勾选后，下一次版本更新将再次自动显示。',
      preferenceSaving: '正在保存…',
      preferenceSavedOn: '已保存：此后更新不再自动显示。',
      preferenceSavedOff: '已保存：下一次版本更新将继续显示。',
      sections: CHINESE_SECTIONS,
    };
  }
  return {
    title: 'Quick Start',
    eyebrow: 'SPSS Studio 1.2.0',
    introduction: 'Open your first .sps file, edit and run Syntax locally, inspect data and variables, and use focused AI assistance.',
    preferenceTitle: 'Update reminder',
    preferenceText: 'Do not show Quick Start automatically after future updates',
    preferenceHint: 'You can still reopen this page from the book icon in the upper-right corner of any .sps editor. Clear the checkbox to show it again after the next update.',
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
      <div class="eyebrow">${copy.eyebrow}</div>
      <h1>${copy.title}</h1>
      <p>${copy.introduction}</p>
    </header>
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
