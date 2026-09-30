import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPortableOutputHtml } from '../../src/views/portableOutput';

describe('portable SPSS output', () => {
  it('creates a safe standalone HTML file with local raster images inlined', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spss-portable-'));
    try {
      const imageDirectory = path.join(root, 'output_files');
      fs.mkdirSync(imageDirectory);
      fs.writeFileSync(path.join(imageDirectory, 'chart.png'), Buffer.from('PNG DATA'));
      const raw = `<!doctype html><html><head><style>@import 'https://bad'; table { color: red; background: url(https://bad); }</style></head><body>
<script>alert(1)</script><div onclick="bad()">Result</div><table><tr><td>42</td></tr></table>
<img src="output_files/chart.png"><img src="https://bad/chart.png"><img src="data:image/svg+xml;base64,PHN2Zz4=">
</body></html>`;
      const html = buildPortableOutputHtml(raw, root, path.join(root, 'output.html'));
      assert.match(html, /^<!doctype html>/iu);
      assert.match(html, /<meta charset="UTF-8">/u);
      assert.match(html, /data:image\/png;base64,/u);
      assert.match(html, /<table><tr><td>42<\/td><\/tr><\/table>/u);
      assert.doesNotMatch(html, /https:\/\/bad|onclick|image\/svg|alert\(1\)/u);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('adds print styling and only the extension-owned print launcher when requested', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spss-print-'));
    try {
      const html = buildPortableOutputHtml(
        '<body><p>Printable</p><script>bad()</script></body>',
        root,
        path.join(root, 'output.html'),
        { print: true },
      );
      assert.match(html, /@media print/u);
      assert.match(html, /Ctrl\/Cmd\+P/u);
      assert.match(html, /window\.print\(\)/u);
      assert.doesNotMatch(html, /bad\(\)/u);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects local images that escape the execution directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spss-portable-root-'));
    const outside = path.join(path.dirname(root), 'outside-spss-studio.png');
    try {
      fs.writeFileSync(outside, Buffer.from('outside'));
      const html = buildPortableOutputHtml(
        '<body><img src="../outside-spss-studio.png"></body>',
        root,
        path.join(root, 'output.html'),
      );
      assert.doesNotMatch(html, /outside-spss-studio|data:image/u);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { force: true });
    }
  });
});
