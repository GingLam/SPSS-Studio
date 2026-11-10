import * as vscode from 'vscode';
import type { ModelProfileStore } from '../ai/modelProfileStore';
import type { OpenAiCompatibleClient } from '../ai/openAiCompatibleClient';
import {
  analyzeCodingDocument, CODING_INSTRUCTION, nextCommandContext, parseCodingChoice,
  type CodingDocument, type NextCommandContext,
} from '../language/codingCompletion';
import type { RenderedTemplate } from '../language/completionTemplates';
import type { SpssLanguageSchema } from '../language/languageSchema';
import type { CompletionSlots } from './completionSlots';

export const ACCEPT_CODING = 'spssStudio.acceptNextCommand';
export const DISMISS_CODING = 'spssStudio.dismissNextCommand';

interface Location {
  editor: vscode.TextEditor;
  version: number;
  offset: number;
  profileId: string;
}

interface ScannedPage {
  document: vscode.TextDocument;
  version: number;
  result: CodingDocument;
}

const MAX_DOCUMENT_CHARS = 1_000_000;
const REQUEST_DELAY_MS = 600;

export class CodingCompletionController implements vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor('editorGhostText.foreground') },
  });
  private readonly subscriptions: vscode.Disposable[];
  private location: Location | undefined;
  private preview: RenderedTemplate | undefined;
  private scan: ScannedPage | undefined;
  private lastSelectedEditor: vscode.TextEditor | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private request: AbortController | undefined;
  private cached: { key: string; response: string } | undefined;
  private lastNetworkStart = 0;
  private visible = false;
  private disposed = false;
  private readonly chinese = vscode.env.language.startsWith('zh');

  public constructor(
    private readonly schema: SpssLanguageSchema,
    private readonly profiles: ModelProfileStore,
    private readonly client: OpenAiCompatibleClient,
    private readonly slots: CompletionSlots,
  ) {
    this.lastSelectedEditor = vscode.window.activeTextEditor;
    this.subscriptions = [
      vscode.commands.registerCommand(ACCEPT_CODING, () => this.accept()),
      vscode.commands.registerCommand(DISMISS_CODING, () => this.invalidate()),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.invalidate();
        this.scan = undefined;
        this.cached = undefined;
        if (editor) this.lastSelectedEditor = editor;
        if (editor?.document.languageId === 'spss' && this.profileId()) this.scanActiveEditor();
      }),
      vscode.window.onDidChangeTextEditorSelection(({ textEditor }) => {
        if (textEditor === vscode.window.activeTextEditor) this.lastSelectedEditor = textEditor;
        if (this.location && !this.matches(this.location)) this.invalidate();
      }),
      vscode.workspace.onDidChangeTextDocument((event) => this.onEdit(event)),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document === this.scan?.document) this.scan = undefined;
        if (document === this.lastSelectedEditor?.document) this.lastSelectedEditor = undefined;
      }),
    ];
  }

  public scanActiveEditor(): void {
    const active = vscode.window.activeTextEditor;
    const editor = active ?? this.lastSelectedEditor;
    if (editor?.document.languageId === 'spss'
      && vscode.window.visibleTextEditors.some((visible) => visible === editor)) {
      this.scanPage(editor.document, editor.document.getText());
    }
  }

  public modelChanged(): void {
    this.invalidate();
    this.cached = undefined;
  }

  public dispose(): void {
    this.disposed = true;
    this.invalidate();
    this.decoration.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
  }

  private profileId(): string | undefined {
    try {
      return this.profiles.readStoredIndex().codingProfileId;
    } catch {
      return undefined;
    }
  }

  private scanPage(document: vscode.TextDocument, source: string): CodingDocument | undefined {
    if (source.length > MAX_DOCUMENT_CHARS) return undefined;
    if (this.scan?.document === document && this.scan.version === document.version) return this.scan.result;
    const result = analyzeCodingDocument(source, this.schema);
    this.scan = { document, version: document.version, result };
    return result;
  }

  private onEdit(event: vscode.TextDocumentChangeEvent): void {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document !== event.document || editor.document.languageId !== 'spss') return;
    this.invalidate();
    if (!vscode.workspace.isTrusted || event.reason || editor.selections.length !== 1
      || !editor.selection.isEmpty || event.contentChanges.length !== 1) return;
    const change = event.contentChanges[0];
    if (!change || change.rangeLength || !/^\r?\n[ \t]*$/u.test(change.text)) return;
    const profileId = this.profileId();
    if (!profileId) return;
    const offset = change.rangeOffset + change.text.length;
    const caret = event.document.offsetAt(editor.selection.active);
    if (caret !== change.rangeOffset && caret !== offset) return;
    const location = { editor, version: event.document.version, offset, profileId };
    this.location = location;
    // Selection updates can arrive just after the document event in the extension host.
    this.timer = setTimeout(() => this.evaluate(location), 40);
  }

  private evaluate(location: Location): void {
    this.timer = undefined;
    if (!this.matches(location)) { this.invalidate(); return; }
    const { document } = location.editor;
    const source = document.getText();
    const scan = this.scanPage(document, source);
    if (!scan) return;
    const context = nextCommandContext(source, location.offset, scan, this.chinese);
    if (!context || this.slots.intersectsIncomplete(document, context.previous.start, context.previous.end)) return;
    if (context.local) {
      this.show(location, context.local);
    } else if (context.payload) {
      const delay = Math.max(REQUEST_DELAY_MS, this.lastNetworkStart + REQUEST_DELAY_MS - Date.now());
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.requestNext(location, context);
      }, delay);
    }
  }

  private async requestNext(location: Location, context: NextCommandContext): Promise<void> {
    if (!context.payload || !this.matches(location)) return;
    const key = JSON.stringify([location.profileId, location.editor.document.uri.toString(), location.version, location.offset]);
    if (this.cached?.key === key) {
      const result = parseCodingChoice(this.cached.response, context, this.chinese);
      if (result) this.show(location, result);
      return;
    }
    const controller = new AbortController();
    this.request = controller;
    try {
      const target = await this.profiles.resolveCoding();
      if (!target || target.profile.id !== location.profileId || controller.signal.aborted || !this.matches(location)) return;
      this.lastNetworkStart = Date.now();
      const response = await this.client.shortCompletion({
        configuration: target.configuration, apiKey: target.apiKey,
        reasoningEnabled: target.profile.reasoningEnabled,
        messages: [
          { role: 'system', content: CODING_INSTRUCTION },
          { role: 'user', content: context.payload },
        ],
        timeoutMs: 8_000, maxTokens: 192, signal: controller.signal,
      });
      if (this.request !== controller || !this.matches(location)) return;
      const result = parseCodingChoice(response, context, this.chinese);
      if (result) {
        this.cached = { key, response };
        this.show(location, result);
      }
    } catch {
      // An unavailable model never interrupts editing or disables local completion.
    } finally {
      if (this.request === controller) this.request = undefined;
    }
  }

  private matches(location: Location): boolean {
    const { editor, version, offset, profileId } = location;
    return !this.disposed && this.location === location && vscode.workspace.isTrusted
      && vscode.window.activeTextEditor === editor && editor.document.version === version
      && editor.selections.length === 1 && editor.selection.isEmpty
      && editor.document.offsetAt(editor.selection.active) === offset
      && this.profileId() === profileId;
  }

  private show(location: Location, template: RenderedTemplate): void {
    if (!this.matches(location) || /[\r\n]/u.test(template.preview) || template.preview.length > 240) return;
    const position = location.editor.document.positionAt(location.offset);
    this.preview = template;
    location.editor.setDecorations(this.decoration, [{
      range: new vscode.Range(position, position),
      renderOptions: { after: { contentText: template.preview } },
    }]);
    this.setVisible(true);
  }

  private async accept(): Promise<void> {
    const { location, preview } = this;
    if (!location || !preview || !this.matches(location)) {
      this.invalidate();
      await vscode.commands.executeCommand('tab');
      return;
    }
    const { editor, offset } = location;
    this.invalidate();
    if (await editor.insertSnippet(new vscode.SnippetString(preview.snippet), editor.document.positionAt(offset))) {
      this.slots.track(editor, offset, preview);
    }
  }

  private invalidate(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.request?.abort();
    this.request = undefined;
    if (this.preview && this.location) this.location.editor.setDecorations(this.decoration, []);
    this.location = undefined;
    this.preview = undefined;
    this.setVisible(false);
  }

  private setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    void vscode.commands.executeCommand('setContext', 'spssStudio.nextCommandVisible', visible);
  }
}
