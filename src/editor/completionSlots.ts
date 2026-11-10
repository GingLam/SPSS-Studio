import * as vscode from 'vscode';
import type { RenderedTemplate, TemplateSlot } from '../language/completionTemplates';

export const TRACK_TEMPLATE = 'spssStudio.trackCompletionTemplate';
export const FINISH_SLOT = 'spssStudio.finishCompletionSlot';

interface InstalledTemplate {
  start: number;
  end: number;
  slots: TemplateSlot[];
}

function shift(slot: TemplateSlot, by: number): TemplateSlot {
  return { ...slot, start: slot.start + by, end: slot.end + by };
}

function updateAnchors(item: InstalledTemplate, edit: vscode.TextDocumentContentChangeEvent): boolean {
  const start = edit.rangeOffset;
  const end = start + edit.rangeLength;
  const delta = edit.text.length - edit.rangeLength;
  if (end <= item.start && start < item.start) {
    item.start += delta;
    item.end += delta;
    item.slots = item.slots.map((slot) => shift(slot, delta));
    return true;
  }
  if (start >= item.end) return true;
  const index = item.slots.findIndex((slot) => start >= slot.start && end <= slot.end);
  if (index < 0) return false;
  item.end += delta;
  item.slots = item.slots.map((slot, i) => {
    if (i < index) return slot;
    if (i === index) return { ...slot, end: slot.end + delta };
    return shift(slot, delta);
  });
  return true;
}

function matchInsertedTemplate(
  document: vscode.TextDocument, start: number, template: RenderedTemplate, nativeInline: boolean,
): InstalledTemplate | undefined {
  const origin = document.positionAt(start);
  const templateLines = template.text.split('\n');
  const lines: { shift: number; offset: number }[] = [];
  let offset = 0;
  let end = start;
  for (const [index, expected] of templateLines.entries()) {
    const lineNumber = origin.line + index;
    if (lineNumber >= document.lineCount) return undefined;
    const actual = document.lineAt(lineNumber).text;
    const adjustIndent = nativeInline && index > 0;
    const expectedIndent = adjustIndent ? expected.length - expected.trimStart().length : 0;
    const from = index === 0 ? origin.character : adjustIndent ? actual.length - actual.trimStart().length : 0;
    const content = expected.slice(expectedIndent);
    if (!actual.startsWith(content, from)
      || (index < templateLines.length - 1 && from + content.length !== actual.length)) return undefined;
    const actualOffset = document.offsetAt(new vscode.Position(lineNumber, from));
    lines.push({ offset, shift: actualOffset - offset - expectedIndent });
    end = actualOffset + content.length;
    offset += expected.length + 1;
  }
  const slots = template.slots.map((slot) => {
    const line = lines.filter(({ offset: lineOffset }) => lineOffset <= slot.start).at(-1);
    return shift(slot, line?.shift ?? start);
  });
  return { start, end, slots };
}

export class CompletionSlots implements vscode.Disposable {
  private readonly installed = new Map<string, InstalledTemplate[]>();
  private readonly hint = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor('editorGhostText.foreground') },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private readonly subscriptions: vscode.Disposable[];
  private canFinish = false;

  public constructor() {
    this.subscriptions = [
      vscode.commands.registerCommand(TRACK_TEMPLATE, (
        uri: string, version: number, start: number, template: RenderedTemplate, nativeInline: boolean = false,
      ) => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.uri.toString() !== uri) return;
        const change = editor.document.version - version;
        if (change === 1 || (nativeInline && change === 2)) {
          this.track(editor, start, template, nativeInline);
        }
      }),
      vscode.commands.registerCommand(FINISH_SLOT, () => this.finish()),
      vscode.workspace.onDidChangeTextDocument((event) => this.onEdit(event)),
      vscode.workspace.onDidCloseTextDocument((document) => this.installed.delete(document.uri.toString())),
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.window.onDidChangeTextEditorSelection(() => this.refresh()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
    ];
  }

  public track(editor: vscode.TextEditor, start: number, template: RenderedTemplate, nativeInline = false): void {
    if (!template.slots.length || editor.document.languageId !== 'spss' || editor.selections.length !== 1) return;
    const item = matchInsertedTemplate(editor.document, start, template, nativeInline);
    if (!item) return;
    const key = editor.document.uri.toString();
    const existing = this.installed.get(key) ?? [];
    this.installed.set(key, [...existing.slice(-99), item]);
    this.refresh();
  }

  public intersectsIncomplete(document: vscode.TextDocument, start: number, end: number): boolean {
    return (this.installed.get(document.uri.toString()) ?? []).some((item) =>
      start < item.end && end > item.start && item.slots.some((slot) => !this.slotText(document, slot).trim()));
  }

  public dispose(): void {
    this.hint.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
    void vscode.commands.executeCommand('setContext', 'spssStudio.canFinishCompletionSlot', false);
  }

  private slotText(document: vscode.TextDocument, slot: TemplateSlot): string {
    return document.getText(new vscode.Range(document.positionAt(slot.start), document.positionAt(slot.end)));
  }

  private onEdit(event: vscode.TextDocumentChangeEvent): void {
    const key = event.document.uri.toString();
    let items = this.installed.get(key);
    if (!items || !event.contentChanges.length) return;
    // VS Code supplies offsets in the version before the transaction.
    for (const edit of [...event.contentChanges].sort((left, right) => right.rangeOffset - left.rangeOffset)) {
      items = items.filter((item) => updateAnchors(item, edit));
    }
    if (items.length) this.installed.set(key, items);
    else this.installed.delete(key);
    this.refresh();
  }

  private finishPosition(editor: vscode.TextEditor | undefined): vscode.Position | undefined {
    if (editor?.document.languageId !== 'spss' || editor.selections.length !== 1 || !editor.selection.isEmpty) return undefined;
    const { document } = editor;
    const caret = document.offsetAt(editor.selection.active);
    for (const item of this.installed.get(document.uri.toString()) ?? []) {
      const last = item.slots.at(-1);
      if (!last || caret !== last.end || caret === last.start) continue;
      const end = document.positionAt(item.end);
      if (end.line !== editor.selection.active.line || document.lineAt(end.line).text.slice(end.character).trim()) continue;
      const trailing = document.getText(new vscode.Range(editor.selection.active, end));
      if (!/^[")]*\.$/u.test(trailing)) continue;
      if (item.slots.some((slot) => !this.slotText(document, slot).trim())) continue;
      if (trailing.startsWith('"') && this.slotText(document, last).replace(/""/gu, '').includes('"')) continue;
      return end;
    }
    return undefined;
  }

  private refresh(): void {
    const active = vscode.window.activeTextEditor;
    for (const editor of vscode.window.visibleTextEditors) {
      const { document } = editor;
      const decorations: vscode.DecorationOptions[] = [];
      for (const item of this.installed.get(document.uri.toString()) ?? []) {
        for (const slot of item.slots) {
          if (this.slotText(document, slot).length) continue;
          const position = document.positionAt(slot.start);
          decorations.push({
            range: new vscode.Range(position, position),
            hoverMessage: slot.hint,
            renderOptions: { after: { contentText: slot.hint } },
          });
        }
      }
      editor.setDecorations(this.hint, decorations);
    }
    const canFinish = this.finishPosition(active) !== undefined;
    if (canFinish !== this.canFinish) {
      this.canFinish = canFinish;
      void vscode.commands.executeCommand('setContext', 'spssStudio.canFinishCompletionSlot', canFinish);
    }
  }

  private async finish(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const position = this.finishPosition(editor);
    if (editor && position) {
      editor.selection = new vscode.Selection(position, position);
    }
    await vscode.commands.executeCommand('default:type', { text: '\n' });
  }
}
