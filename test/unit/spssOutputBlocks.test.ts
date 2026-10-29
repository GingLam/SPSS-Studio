import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSpssOutputBlocks, buildSelectedOutputQuestion } from '../../src/views/spssOutputBlocks';
import { isWebviewMessage } from '../../src/views/webviewProtocol';

const native = fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/output-multiple-tables.html'), 'utf8');

describe('SPSS native output table selection', () => {
  it('marks each real statistical table independently without changing its original HTML or order', () => {
    const result = createSpssOutputBlocks(native, 'en');
    assert.equal(result.blocks.length, 12);
    const regression = result.blocks.filter((block) => block.title.startsWith('Regression'));
    assert.equal(regression.length, 4);
    assert.deepEqual(regression.map((block) => block.title), [
      'Regression · Variables Entered/Removed', 'Regression · Model Summary', 'Regression · ANOVA', 'Regression · Coefficients',
    ]);
    assert.equal(result.html.replace(/ data-spss-output-block="block-\d+"/gu, ''), native);
    assert.equal((result.html.match(/data-spss-output-block=/gu) ?? []).length, 12);
    assert.ok(result.blocks.every((block) => !/^Notes$/iu.test(block.title)));
  });

  it('sends only selected table bodies, with captions, merged headers, footnotes and safe model qualifications', () => {
    const { blocks } = createSpssOutputBlocks(native, 'en');
    const coefficients = blocks.find((block) => block.title === 'Regression · Coefficients');
    const effect = blocks.find((block) => block.title.includes('Effect Sizes'));
    assert.ok(coefficients && effect);
    const question = buildSelectedOutputQuestion(blocks, [coefficients.id, effect.id], 'en');
    assert.match(question, /separately/u);
    assert.match(question, /Unstandardized Coefficients \/ Std\. Error/u);
    assert.match(question, /1598\.992/u);
    assert.match(question, /Predictors: \(Constant\), Weekly working hours/u);
    assert.match(question, /denominator used in estimating/u);
    assert.doesNotMatch(question, /7846492\.510|353\.27620|Output Created|\/examples\/|REGRESSION \/DEPENDENT|Processor Time/u);
    assert.ok(question.indexOf('Effect Sizes') < question.indexOf('### 2.'), 'Use source order, not click order.');
    assert.equal((question.match(/### \d+\./gu) ?? []).length, 2);
  });

  it('keeps external footnotes with the previous table and isolates repeated analyses', () => {
    const html = '<p class="procedureTitle">Regression A</p><table><caption>Coefficients</caption><tr><th>B</th><td>1.234</td></tr></table>'
      + '<p class="footnote">a. Dependent Variable: income_A</p><p>Warning: 2 cases omitted.</p>'
      + '<p class="procedureTitle">Regression B</p><table><caption>Coefficients</caption><tr><th>B</th><td>9.876</td></tr></table>'
      + '<p class="footnote">a. Dependent Variable: income_B</p>';
    const { blocks } = createSpssOutputBlocks(html);
    const second = blocks.find((block) => block.title.startsWith('Regression B'));
    assert.ok(second);
    const question = buildSelectedOutputQuestion(blocks, [second.id]);
    assert.match(question, /income_B|9\.876/u);
    assert.doesNotMatch(question, /income_A|1\.234|2 cases omitted/u);
  });

  it('excludes localized Notes, images, executable markup, paths and forged selection markers', () => {
    const html = '<p class="procedureTitle">分析</p><table aria-label="注释"><caption>注释</caption><tr><td>活动数据集</td><td>private</td></tr></table>'
      + '<figure><table><caption>Figure secret</caption><tr><td>999</td></tr></table><img src="private.png"></figure>'
      + '<p data-spss-output-block="block-1">/Users/private/data.sav</p>'
      + '<table data-spss-output-block="forged"><caption>统计量</caption><tr><th>均值</th><td>12.4</td></tr></table>';
    const { blocks, html: marked } = createSpssOutputBlocks(html);
    assert.equal(blocks.length, 1);
    const first = blocks[0]; assert.ok(first);
    const question = buildSelectedOutputQuestion(blocks, [first.id]);
    assert.match(question, /12\.4/u);
    assert.doesNotMatch(question, /private|Figure secret|999|活动数据集/u);
    assert.equal((marked.match(/data-spss-output-block=/gu) ?? []).length, 1);
  });

  it('rejects unknown, duplicate or malformed IDs instead of sending the full run', () => {
    const { blocks } = createSpssOutputBlocks(native);
    const first = blocks[0]; assert.ok(first);
    assert.throws(() => buildSelectedOutputQuestion(blocks, ['block-99999']), /selection/iu);
    assert.throws(() => buildSelectedOutputQuestion(blocks, [first.id, first.id]), /selection/iu);
    assert.equal(isWebviewMessage({ type: 'explainOutput', id: 'run', blockIds: [] }), true);
    assert.equal(isWebviewMessage({ type: 'explainOutput', id: 'run', blockIds: [first.id] }), true);
    for (const blockIds of ['all', [1], ['forged'], [first.id, first.id]]) {
      assert.equal(isWebviewMessage({ type: 'explainOutput', id: 'run', blockIds }), false);
    }
  });

  it('selects nested statistical tables independently while preserving their outer layout table', () => {
    const html = '<table class="layout"><tr><td><table><caption>First</caption><tr><th>Mean</th><td>1.25</td></tr></table></td>'
      + '<td><table><caption>Second</caption><tr><th>Mean</th><td>9.75</td></tr></table></td></tr></table>';
    const result = createSpssOutputBlocks(html);
    assert.equal(result.blocks.length, 2);
    assert.match(result.html, /^<table class="layout">/u);
    const second = result.blocks[1]; assert.ok(second);
    const question = buildSelectedOutputQuestion(result.blocks, [second.id]);
    assert.match(question, /9\.75/u); assert.doesNotMatch(question, /1\.25/u);
  });

  it('keeps all selected sections within the payload limit and preserves their statistical footnotes', () => {
    const rows = '<tr><th>Label</th><td>' + 'value'.repeat(250) + '</td></tr>';
    const table = (caption: string) => `<table><caption>${caption}</caption><tbody>${rows.repeat(70)}</tbody><tfoot><tr><td>a. Missing values excluded.</td></tr></tfoot></table>`;
    const { blocks } = createSpssOutputBlocks(table('First') + table('Second'));
    const question = buildSelectedOutputQuestion(blocks, blocks.map((block) => block.id), 'en');
    assert.ok(question.length <= 30_000);
    assert.match(question, /### 1\. First/u); assert.match(question, /### 2\. Second/u);
    assert.match(question, /TABLE TRUNCATED/u); assert.match(question, /Missing values excluded/u);
  });

  it('does not add filesystem details from an unselected warning to statistical context', () => {
    const html = '<p class="procedureTitle">Regression</p><p>Warning: file /Users/private/source.sav is in use.</p>'
      + '<table><caption>Warnings</caption><tr><td>File C:\\private\\source.sav unavailable.</td></tr></table>'
      + '<table><caption>Coefficients</caption><tr><th>B</th><td>2.50</td></tr></table>';
    const { blocks } = createSpssOutputBlocks(html);
    const coefficients = blocks.find((block) => block.title.endsWith('Coefficients')); assert.ok(coefficients);
    const question = buildSelectedOutputQuestion(blocks, [coefficients.id]);
    assert.match(question, /2\.50/u); assert.doesNotMatch(question, /private|source\.sav/u);
  });

  it('uses localized fallback titles without changing selection IDs', () => {
    const html = '<table><tr><th>Mean</th><td>12.4</td></tr></table>';
    const english = createSpssOutputBlocks(html, 'en').blocks[0];
    const chinese = createSpssOutputBlocks(html, 'zh-CN').blocks[0];
    assert.ok(english && chinese);
    assert.equal(english.title, 'Table'); assert.equal(chinese.title, '表格');
    assert.equal(english.id, chinese.id);
  });

  it('skips graph-only tables and nested chart text while keeping numeric table cells', () => {
    const html = '<table><caption>Graph</caption><tr><td><svg><text>GRAPH SECRET</text></svg></td></tr></table>'
      + '<table><caption>Statistics</caption><tr><th>Mean</th><td>12.4<svg><text>OTHER GRAPH SECRET</text></svg></td></tr></table>';
    const { blocks } = createSpssOutputBlocks(html);
    assert.equal(blocks.length, 1);
    const first = blocks[0]; assert.ok(first);
    const question = buildSelectedOutputQuestion(blocks, [first.id]);
    assert.match(question, /12\.4/u); assert.doesNotMatch(question, /GRAPH SECRET/u);
  });
});
