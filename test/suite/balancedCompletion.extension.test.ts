import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { SpssCompletionProvider } from '../../src/language/completionProvider';
import { loadLanguageSchema } from '../../src/language/languageSchema';
import { VariableCache } from '../../src/spss/variableCache';

describe('SPSS native completion', () => {
  before(async () => {
    const extension = vscode.extensions.getExtension('jinglin.spss-studio');
    assert.ok(extension);
    await extension.activate();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('registers explicit completion without adding an editor toolbar action', async () => {
    assert.ok((await vscode.commands.getCommands(true)).includes('spssStudio.complete'));
  });

  it('applies anti-accidental defaults only to SPS and respects an explicit user override', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'spss', content: 'reg' });
    const editor = vscode.workspace.getConfiguration('editor', document);
    assert.equal(editor.get('acceptSuggestionOnEnter'), 'off');
    assert.equal(editor.get('suggest.selectionMode'), 'always');
    assert.equal(editor.get('quickSuggestionsDelay'), 300);
    assert.equal(editor.get('tabCompletion'), 'off');
    const plain = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'reg' });
    assert.equal(vscode.workspace.getConfiguration('editor', plain).inspect('acceptSuggestionOnEnter')?.defaultLanguageValue, undefined);
    try {
      await editor.update('acceptSuggestionOnEnter', 'on', vscode.ConfigurationTarget.Workspace, true);
      assert.equal(vscode.workspace.getConfiguration('editor', document).get('acceptSuggestionOnEnter'), 'on');
    } finally { await editor.update('acceptSuggestionOnEnter', undefined, vscode.ConfigurationTarget.Workspace, true); }
  });

  it('returns quiet automatic lists and identifies its own candidates', async () => {
    const extension = vscode.extensions.getExtension('jinglin.spss-studio');
    assert.ok(extension);
    const provider = new SpssCompletionProvider(loadLanguageSchema(extension.extensionPath), new VariableCache());
    for (const source of ['', 'GET FILE ', 'COMPUTE x=1.\r\n']) {
      const document = await vscode.workspace.openTextDocument({ language: 'spss', content: source });
      assert.deepEqual(provider.provideCompletionItems(document, document.positionAt(source.length)).items, []);
    }
    const document = await vscode.workspace.openTextDocument({ language: 'spss', content: 'reg' });
    const items = provider.provideCompletionItems(document, document.positionAt(3)).items;
    assert.ok(items.some((item) => (typeof item.label === 'string' ? item.label : item.label.label) === 'REGRESSION'));
    assert.ok(items.every((item) => item.detail?.includes('SPSS Studio')));
    assert.ok(items.every((item) => item.kind !== vscode.CompletionItemKind.Snippet));
  });

  it('consumes manual intent once and rejects a different document or edited version', async () => {
    const extension = vscode.extensions.getExtension('jinglin.spss-studio');
    assert.ok(extension);
    const provider = new SpssCompletionProvider(loadLanguageSchema(extension.extensionPath), new VariableCache());
    const document = await vscode.workspace.openTextDocument({ language: 'spss', content: '' });
    const position = document.positionAt(0);
    provider.prepareManualCompletion(document, position);
    assert.ok(provider.provideCompletionItems(document, position).items.length > 1);
    assert.deepEqual(provider.provideCompletionItems(document, position).items, []);
    const other = await vscode.workspace.openTextDocument({ language: 'spss', content: '' });
    provider.prepareManualCompletion(document, position);
    assert.deepEqual(provider.provideCompletionItems(other, position).items, []);
    assert.deepEqual(provider.provideCompletionItems(document, position).items, []);
    const cancellation = new vscode.CancellationTokenSource();
    try {
      provider.prepareManualCompletion(document, position);
      cancellation.cancel();
      assert.deepEqual(provider.provideCompletionItems(document, position, cancellation.token).items, []);
    } finally { cancellation.dispose(); }
    provider.prepareManualCompletion(document, position);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, position, ' ');
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    assert.deepEqual(provider.provideCompletionItems(document, position).items, []);
  });

  it('accepts the first one-character template in the native editor and finishes its file field', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'spss', content: 'G' });
    const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    editor.selection = new vscode.Selection(document.positionAt(1), document.positionAt(1));
    await vscode.commands.executeCommand('workbench.action.focusWindow');
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await vscode.commands.executeCommand('spssStudio.complete');
    await new Promise((resolve) => setTimeout(resolve, 600));
    await vscode.commands.executeCommand('acceptSelectedSuggestion');
    assert.equal(document.getText(), 'GET FILE "".');
    assert.equal(editor.selection.active.character, 'GET FILE "'.length);
    await vscode.commands.executeCommand('spssStudio.runFile');
    await vscode.commands.executeCommand('default:type', { text: 'sample.sav' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await vscode.commands.executeCommand('spssStudio.finishCompletionSlot');
    assert.equal(document.getText(), 'GET FILE "sample.sav".\n');
    await vscode.commands.executeCommand('hideSuggestWidget');
  });
});
