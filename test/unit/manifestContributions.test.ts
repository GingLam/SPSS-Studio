import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

interface CommandContribution {
  command: string;
  title: string;
  icon?: string;
}

interface MenuContribution {
  command: string;
  when?: string;
  group?: string;
}

interface ExtensionManifest {
  contributes: {
    commands: CommandContribution[];
    viewsContainers?: {
      panel?: Array<{ id: string; title: string; icon: string }>;
    };
    views?: Record<string, Array<{ id: string; name: string; type?: string }>>;
    menus?: {
      'editor/title'?: MenuContribution[];
    };
  };
}

describe('SPSS editor title actions', () => {
  it('contributes Undo, Run, and Run All only for SPSS editors in the requested order', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
    ) as ExtensionManifest;
    const expected = ['spssStudio.undo', 'spssStudio.runSelection', 'spssStudio.runFile'];
    const commands = new Map(manifest.contributes.commands.map((command) => [command.command, command]));
    for (const commandId of expected) {
      assert.ok(commands.get(commandId)?.icon, `Editor action has no product icon: ${commandId}`);
    }

    const actions = (manifest.contributes.menus?.['editor/title'] ?? [])
      .filter((item) => expected.includes(item.command))
      .sort((left, right) => String(left.group).localeCompare(String(right.group)));
    assert.deepEqual(actions.map((item) => item.command), expected);
    assert.ok(actions.every((item) => item.when === 'resourceLangId == spss'));
    assert.deepEqual(actions.map((item) => item.group), ['navigation@1', 'navigation@2', 'navigation@3']);
  });

  it('contributes a Webview View in the bottom panel for SPSS AI', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
    ) as ExtensionManifest;
    const container = manifest.contributes.viewsContainers?.panel?.find(
      (candidate) => candidate.id === 'spssStudioAi',
    );
    assert.ok(container);
    assert.equal(container.title, 'SPSS AI');
    assert.ok(container.icon);
    const view = manifest.contributes.views?.spssStudioAi?.find(
      (candidate) => candidate.id === 'spssStudio.aiView',
    );
    assert.ok(view);
    assert.equal(view.type, 'webview');
    assert.ok(manifest.contributes.commands.some((command) => command.command === 'spssStudio.showAi'));
    assert.ok(manifest.contributes.commands.some((command) => command.command === 'spssStudio.configureAi'));
  });
});
