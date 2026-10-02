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
  activationEvents?: string[];
  contributes: {
    commands: CommandContribution[];
    viewsContainers?: {
      panel?: Array<{ id: string; title: string; icon: string }>;
    };
    views?: Record<string, Array<{ id: string; name: string; type?: string }>>;
    menus?: {
      'editor/title'?: MenuContribution[];
      'editor/context'?: MenuContribution[];
    };
    configuration?: {
      properties?: Record<string, unknown>;
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

  it('keeps AI inside Studio and removes obsolete variable and bottom-panel contributions', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
    ) as ExtensionManifest;
    const commandIds = manifest.contributes.commands.map((command) => command.command);
    assert.equal(manifest.contributes.viewsContainers, undefined);
    assert.equal(manifest.contributes.views, undefined);
    assert.ok(commandIds.includes('spssStudio.showAi'));
    assert.ok(commandIds.includes('spssStudio.configureAi'));
    assert.ok(!commandIds.includes('spssStudio.showVariablePicker'));
    assert.ok(!commandIds.includes('spssStudio.insertVariable'));
    assert.equal(
      manifest.contributes.configuration?.properties?.['spssStudio.aiAutoReveal'],
      undefined,
    );
  });

  it('contributes a standard SPSS editor context action that sends syntax to Chat', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
    ) as ExtensionManifest;
    const commandId = 'spssStudio.explainSyntaxInChat';
    assert.ok(manifest.contributes.commands.some((command) => command.command === commandId));
    assert.ok(manifest.activationEvents?.includes(`onCommand:${commandId}`));
    assert.deepEqual(manifest.contributes.menus?.['editor/context'], [{
      command: commandId,
      when: 'editorLangId == spss',
      group: 'navigation@10',
    }]);
    const english = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.nls.json'), 'utf8'),
    ) as Record<string, string>;
    const chinese = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.nls.zh-cn.json'), 'utf8'),
    ) as Record<string, string>;
    assert.equal(english['spssStudio.command.explainSyntaxInChat'], 'Explain in Chat');
    assert.equal(chinese['spssStudio.command.explainSyntaxInChat'], 'Explain in Chat');
  });
});
