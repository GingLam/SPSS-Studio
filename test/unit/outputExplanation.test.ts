import assert from 'node:assert/strict';
import {
  buildOutputExplanationQuestion,
  extractSpssOutputForAi,
} from '../../src/ai/outputExplanation';
import { parseMarkdown } from '../../src/ai/markdown';

describe('SPSS output explanation extraction', () => {
  it('keeps statistical text and tables while removing Notes, paths, commands, and figures', () => {
    const html = `<!doctype html><html><head><style>.x{color:red}</style></head><body>
      <p align="left"><html><font>GET FILE='secret.sav'.<br>EXAMINE VARIABLES=income.</font></html></p>
      <p>[nlsw] /Users/example/private/nlsw1988.sav</p>
      <p class="procedureTitle">Explore</p>
      <table aria-label="Notes, Explore"><caption class="title">Notes</caption>
        <tr><th>Output Created</th><td>02-OCT-2026</td></tr>
        <tr><th>Active Dataset</th><td>nlsw</td></tr>
        <tr><th>Processor Time</th><td>00:00:00.02</td></tr>
      </table>
      <table aria-label="Descriptives"><caption>Descriptives<span class="details">hidden</span></caption>
        <tr><th>Variable</th><th>Statistic</th><th>Value</th></tr>
        <tr><td>income</td><td>Mean</td><td>12.40</td></tr>
        <tr><td colspan="3">a. 95% confidence interval.</td></tr>
      </table>
      <p>Warning: 2 cases have missing values.</p>
      <img src="chart.png" alt="A chart with secret values">
      <svg><text>SVG chart secret</text></svg>
      <figure><img src="another.png"><figcaption>Figure secret</figcaption><p>Figure paragraph secret</p></figure>
    </body></html>`;
    const result = extractSpssOutputForAi(html);
    assert.match(result.content, /## Explore/u);
    assert.match(result.content, /### Descriptives/u);
    assert.match(result.content, /income/u);
    assert.match(result.content, /12\.40/u);
    assert.match(result.content, /95% confidence interval/u);
    assert.match(result.content, /Warning: 2 cases/u);
    for (const removed of [
      'secret.sav', '/Users/', 'Notes', 'Output Created', 'Active Dataset',
      'Processor Time', 'chart.png', 'secret values', 'SVG chart secret', 'Figure secret',
      'Figure paragraph secret',
      'EXAMINE VARIABLES',
    ]) {
      assert.equal(result.content.includes(removed), false, `Leaked excluded output: ${removed}`);
    }
    assert.equal(result.truncated, false);
  });

  it('caps each table at 50 rows and the complete payload at 30,000 characters', () => {
    const rows = Array.from({ length: 80 }, (_value, index) => (
      `<tr><td>row-${String(index)}</td><td>value-${String(index)}</td></tr>`
    )).join('');
    const tableLimited = extractSpssOutputForAi(
      `<table><caption>Large table</caption><tr><th>Case</th><th>Value</th></tr>${rows}</table>`,
      'en',
    );
    assert.match(tableLimited.content, /TABLE TRUNCATED AFTER 50 ROWS/u);
    assert.doesNotMatch(tableLimited.content, /row-79/u);

    const verboseRows = Array.from({ length: 49 }, (_value, index) => (
      `<tr><td>row-${String(index)}</td><td>${'x'.repeat(800)}</td></tr>`
    )).join('');
    const result = extractSpssOutputForAi(
      `<table><caption>Verbose table</caption><tr><th>Case</th><th>Value</th></tr>${verboseRows}</table>`,
      'en',
    );
    assert.ok(result.content.length <= 30_030);
    assert.match(result.content, /OUTPUT TRUNCATED/u);
    assert.equal(result.truncated, true);
  });

  it('builds compact prompts in the shared response language', () => {
    const chinese = buildOutputExplanationQuestion('| Mean | 12.4 |');
    assert.match(chinese, /请简要解释/u);
    assert.match(chinese, /## SPSS 统计结果/u);
    assert.doesNotMatch(chinese, /<SPSS_OUTPUT>/u);
    assert.match(buildOutputExplanationQuestion('| Mean | 12.4 |', 'en'), /Briefly interpret/u);
    assert.throws(() => buildOutputExplanationQuestion('  '), /no statistical text/iu);
  });

  it('expands row spans and flattens multi-level column headers', () => {
    const result = extractSpssOutputForAi(`
      <table aria-label="Descriptives">
        <caption>Descriptives<span class="details">hidden accessibility details</span></caption>
        <thead>
          <tr><th rowspan="2">Variable</th><th rowspan="2">Statistic</th><th colspan="2">99% Confidence Interval</th></tr>
          <tr><th>Lower Bound</th><th>Upper Bound</th></tr>
        </thead>
        <tbody>
          <tr><th rowspan="2">Education</th><th>Mean</th><td>12.96</td><td>13.24</td></tr>
          <tr><th>Median</th><td>12.00</td><td>12.00</td></tr>
        </tbody>
        <tfoot><tr><td colspan="4">a. Missing values excluded.</td></tr></tfoot>
      </table>
    `, 'en');
    assert.match(result.content, /\| Variable \| Statistic \| 99% Confidence Interval \/ Lower Bound \| 99% Confidence Interval \/ Upper Bound \|/u);
    assert.match(result.content, /\| Education \| Mean \| 12\.96 \| 13\.24 \|/u);
    assert.match(result.content, /\| Education \| Median \| 12\.00 \| 12\.00 \|/u);
    assert.match(result.content, /Footnote: a\. Missing values excluded\./u);
    assert.doesNotMatch(result.content, /hidden accessibility details/u);
    assert.equal(parseMarkdown(result.content).some((block) => block.type === 'table'), true);
  });

  it('keeps body rows when a table has no explicit column header', () => {
    const result = extractSpssOutputForAi(`
      <table><caption>Single statistic</caption><tbody>
        <tr><th>Mean</th><td>12.4</td></tr>
      </tbody></table>
    `, 'en');
    assert.match(result.content, /\| Column 1 \| Column 2 \|/u);
    assert.match(result.content, /\| Mean \| 12\.4 \|/u);
  });

  it('keeps multiline cells readable without injecting raw HTML into Markdown', () => {
    const result = extractSpssOutputForAi(`
      <table><tr><th>Statistic</th><th>Value</th></tr>
      <tr><td>Confidence Interval<br>Lower Bound</td><td>12.96</td></tr></table>
    `);

    assert.match(result.content, /Confidence Interval \/ Lower Bound/u);
    assert.doesNotMatch(result.content, /<br>/u);
  });

  it('recognizes localized Notes metadata without relying on an English caption', () => {
    const result = extractSpssOutputForAi(`
      <table aria-label="注释，探索"><caption>注释</caption>
        <tr><th>输出已创建</th><td>2026-10-02</td></tr>
        <tr><th>活动数据集</th><td>survey</td></tr>
        <tr><th>处理器时间</th><td>00:00:00.02</td></tr>
      </table>
      <table><caption>描述统计</caption><tr><th>均值</th><td>12.4</td></tr></table>
    `);
    assert.doesNotMatch(result.content, /注释|活动数据集|处理器时间/u);
    assert.match(result.content, /描述统计/u);
    assert.match(result.content, /12\.4/u);
  });
});
