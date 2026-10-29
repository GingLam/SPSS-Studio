import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { STUDIO_STRINGS_EN } from '../../src/views/studioStrings';

class ElementPort {
  public children: ElementPort[] = [];
  public parentNode: ElementPort | undefined;
  public textContent = '';
  public value = '';
  public title = '';
  public type = '';
  public checked = false;
  public disabled = false;
  public hidden = false;
  public className = '';
  public clientWidth = 900;
  public scrollLeft = 0;
  public style = { width: '', left: '', setProperty: (): void => undefined };
  public attributes = new Map<string, string>();
  public listeners = new Map<string, (event: unknown) => void>();
  private classes = new Set<string>();
  public classList = {
    toggle: (name: string, enabled?: boolean): void => { if (enabled ?? !this.classes.has(name)) this.classes.add(name); else this.classes.delete(name); },
  };
  private html = '';
  public constructor(public tagName: string) {}
  public set innerHTML(value: string) {
    this.replaceChildren(); this.html = value;
    // A bounded DOM port for the shipped script's native marked elements.
    // Cell parsing is exercised separately against actual SPSS HTML fixtures.
    for (const match of value.matchAll(/<(table|p|img)\b([^>]*)>/gu)) {
      const child = new ElementPort(match[1] ?? 'p');
      const marker = /data-spss-output-block="([^"]+)"/u.exec(match[2] ?? '')?.[1];
      if (marker) child.attributes.set('data-spss-output-block', marker);
      this.append(child);
    }
  }
  public get innerHTML(): string { return this.html; }
  public append(...nodes: ElementPort[]): void {
    for (const node of nodes) {
      if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
      node.parentNode = this; this.children.push(node);
    }
  }
  public insertBefore(node: ElementPort, target: ElementPort): void {
    const index = this.children.indexOf(target); assert.ok(index >= 0);
    node.parentNode = this; this.children.splice(index, 0, node);
  }
  public replaceChildren(...nodes: ElementPort[]): void { this.children.forEach((child) => { child.parentNode = undefined; }); this.children = []; this.html = ''; this.append(...nodes); }
  public setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  public addEventListener(name: string, listener: (event: unknown) => void): void { this.listeners.set(name, listener); }
  public closest(): this { return this; }
  public fire(name: string): void { this.listeners.get(name)?.({ target: this }); }
  public querySelector(selector: string): ElementPort | undefined {
    const marker = /^\[data-spss-output-block="([^"]+)"\]$/u.exec(selector)?.[1];
    for (const child of this.children) {
      if (marker ? child.attributes.get('data-spss-output-block') === marker : child.tagName === selector) return child;
      const found = child.querySelector(selector); if (found) return found;
    }
    return undefined;
  }
}

interface Envelope { scope: string; message?: { type: string; blockIds?: string[] } }
function uiFixture() {
  const elements = new Map<string, ElementPort>();
  const element = (id: string): ElementPort => {
    let node = elements.get(id);
    if (!node) { node = new ElementPort('div'); elements.set(id, node); }
    return node;
  };
  element('variables-table').append(new ElementPort('tbody'));
  const posted: Envelope[] = [];
  let receiver: (event: unknown) => void = () => undefined;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../media/studio.js'), 'utf8'), {
    acquireVsCodeApi: () => ({ getState: () => ({}), setState: () => undefined, postMessage: (value: Envelope) => posted.push(value) }),
    SPSS_STUDIO_STRINGS: STUDIO_STRINGS_EN, spssVariableFilter: { filterVariables: (variables: unknown[]) => variables },
    document: { getElementById: element, createElement: (tag: string) => new ElementPort(tag), documentElement: element('root') },
    window: { innerWidth: 1200, addEventListener: (name: string, callback: (event: unknown) => void) => { if (name === 'message') receiver = callback; }, setTimeout: (callback: () => void) => { callback(); return 1; }, clearTimeout: () => undefined, requestAnimationFrame: (callback: () => void) => callback(), createSpssAiModule: () => ({ resize: () => undefined, handleMessage: () => undefined }) },
  });
  return { element, posted, deliver: (message: unknown) => receiver({ data: { scope: 'studio', message } }) };
}
const record = (id: string) => ({ id, sequence: 1, label: 'Run', timestamp: '2026-10-29T12:00:00Z', status: 'SUCCESS', durationMs: 10, errorLevel: 0, hasHtml: true });
const blocks = [{ id: 'block-1', title: 'Regression · ANOVA' }, { id: 'block-2', title: 'Regression · Coefficients' }];
const html = '<p>Procedure heading</p><table data-spss-output-block="block-1"><caption>ANOVA</caption></table><img src="chart.png"><table data-spss-output-block="block-2"><caption>Coefficients</caption></table>';
function render(ui: ReturnType<typeof uiFixture>, id: string, available = blocks): void {
  ui.deliver({ type: 'executionSelected', record: record(id), html, blocks: available });
}
function checkbox(ui: ReturnType<typeof uiFixture>, id: string): ElementPort {
  const target = ui.element('spss-output').querySelector(`[data-spss-output-block="${id}"]`);
  const check = target?.parentNode?.parentNode?.querySelector('input'); assert.ok(check); return check;
}

describe('SPSS Output checkbox behavior', () => {
  it('wraps native tables in place and keeps headings and images in their original order', () => {
    const ui = uiFixture(); render(ui, 'one');
    const nodes = ui.element('spss-output').children;
    assert.equal(nodes[0]?.tagName, 'p');
    assert.equal(nodes[1]?.className, 'output-block');
    assert.equal(nodes[2]?.tagName, 'img');
    assert.equal(nodes[3]?.className, 'output-block');
    assert.equal(checkbox(ui, 'block-2').attributes.get('aria-label'), 'Select result: Regression · Coefficients');
  });
  it('sends multiple choices in table order and sends an empty selection after explicit deselection', () => {
    const ui = uiFixture(); render(ui, 'one');
    const first = checkbox(ui, 'block-1'), second = checkbox(ui, 'block-2');
    second.checked = true; second.fire('change'); first.checked = true; first.fire('change');
    ui.element('explain-output').fire('click');
    assert.equal(ui.posted.at(-1)?.message?.blockIds?.join(','), 'block-1,block-2');
    assert.equal(ui.element('explain-output').title, 'Explain 2 selected results');
    first.checked = false; first.fire('change'); second.checked = false; second.fire('change');
    ui.element('explain-output').fire('click');
    assert.equal(ui.posted.at(-1)?.message?.blockIds?.length, 0);
  });
  it('preserves choices across page switches and re-render, but isolates runs and blocks stale-result clicks', () => {
    const ui = uiFixture();
    ui.deliver({ type: 'executionCompleted', history: [record('one'), record('two')], selectedId: 'one' });
    render(ui, 'one'); const first = checkbox(ui, 'block-1'); first.checked = true; first.fire('change');
    ui.deliver({ type: 'showVariables' }); ui.deliver({ type: 'showOutput' }); render(ui, 'one');
    assert.equal(checkbox(ui, 'block-1').checked, true);
    ui.deliver({ type: 'executionStarted', history: [record('one'), { ...record('two'), status: 'RUNNING' }], selectedId: 'two' });
    const count = ui.posted.length; ui.element('explain-output').fire('click'); assert.equal(ui.posted.length, count);
    render(ui, 'two'); assert.equal(checkbox(ui, 'block-1').checked, false);
    render(ui, 'one'); assert.equal(checkbox(ui, 'block-1').checked, true);
    ui.deliver({ type: 'outputCleared' }); render(ui, 'one'); assert.equal(checkbox(ui, 'block-1').checked, false);
  });
  it('requires reselection rather than sending all when previously checked tables disappear', () => {
    const ui = uiFixture(); render(ui, 'one');
    const second = checkbox(ui, 'block-2'); second.checked = true; second.fire('change');
    render(ui, 'one', [blocks[0]].filter((value): value is { id: string; title: string } => value !== undefined));
    assert.equal(ui.element('explain-output').disabled, true);
    const count = ui.posted.length; ui.element('explain-output').fire('click'); assert.equal(ui.posted.length, count);
    const first = checkbox(ui, 'block-1'); first.checked = true; first.fire('change');
    assert.equal(ui.element('explain-output').disabled, false);
    ui.element('explain-output').fire('click');
    assert.equal(ui.posted.at(-1)?.message?.blockIds?.join(','), 'block-1');
  });
});
