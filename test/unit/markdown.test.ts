import assert from 'node:assert/strict';
import { parseMarkdown, safeMarkdownUrl } from '../../src/ai/markdown';

describe('safe assistant Markdown parsing', () => {
  it('parses headings, emphasis, lists, quotes, tables, links, and inline code', () => {
    const blocks = parseMarkdown([
      '## Learning notes',
      '',
      'Use **Paste** and `LOG` with [IBM docs](https://www.ibm.com/docs/).',
      '',
      '1. First item',
      '2. Second item',
      '',
      '> Check the Output.',
      '',
      '| Command | Purpose |',
      '| --- | --- |',
      '| FREQUENCIES | Counts |',
    ].join('\n'));

    assert.deepEqual(blocks.map((block) => block.type), [
      'heading', 'paragraph', 'list', 'blockquote', 'table',
    ]);
    assert.equal(blocks[0]?.type === 'heading' ? blocks[0].level : undefined, 2);
    assert.equal(blocks[2]?.type === 'list' ? blocks[2].ordered : undefined, true);
    assert.equal(blocks[4]?.type === 'table' ? blocks[4].rows.length : undefined, 1);
    assert.match(JSON.stringify(blocks), /"type":"strong"/u);
    assert.match(JSON.stringify(blocks), /"type":"code"/u);
    assert.match(JSON.stringify(blocks), /https:\/\/www\.ibm\.com\/docs\//u);
  });

  it('keeps raw HTML inert and rejects unsafe or relative links', () => {
    const serialized = JSON.stringify(parseMarkdown(
      '<script>alert(1)</script> income_total_score [bad](javascript:alert(1))',
    ));
    assert.match(serialized, /<script>alert\(1\)<\/script>/u);
    assert.match(serialized, /income_total_score/u);
    assert.doesNotMatch(serialized, /"type":"emphasis"/u);
    assert.doesNotMatch(serialized, /"type":"link"/u);
    assert.equal(safeMarkdownUrl('javascript:alert(1)'), undefined);
    assert.equal(safeMarkdownUrl('/relative'), undefined);
    assert.equal(safeMarkdownUrl('https://example.com/a'), 'https://example.com/a');
  });
});
