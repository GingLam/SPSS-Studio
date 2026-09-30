import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSpssHtml } from './htmlSanitizer';

export interface PortableOutputOptions {
  print?: boolean;
}

const rasterMimeTypes = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.bmp', 'image/bmp'],
]);

function insideDirectory(candidate: string, directory: string): boolean {
  return candidate === directory || candidate.startsWith(`${directory}${path.sep}`);
}

function resolvePortableImage(
  source: string,
  outputDirectory: string,
  htmlPath: string,
): string | undefined {
  if (/^data:image\/(?:png|jpe?g|gif|bmp);base64,[a-z0-9+/=\s]+$/iu.test(source)) {
    return source;
  }
  if (/^(?:https?:|javascript:|data:|\/\/)/iu.test(source)) {
    return undefined;
  }
  let resolved: string;
  try {
    if (/^file:/iu.test(source)) {
      resolved = fileURLToPath(source);
    } else {
      resolved = path.resolve(path.dirname(htmlPath), decodeURIComponent(source));
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return undefined;
    }
    const realRoot = fs.realpathSync(outputDirectory);
    const realImage = fs.realpathSync(resolved);
    if (!insideDirectory(realImage, realRoot)) {
      return undefined;
    }
    const mime = rasterMimeTypes.get(path.extname(realImage).toLowerCase());
    if (!mime) {
      return undefined;
    }
    return `data:${mime};base64,${fs.readFileSync(realImage).toString('base64')}`;
  } catch {
    return undefined;
  }
}

/** Builds a self-contained, sanitized HTML document for export or browser printing. */
export function buildPortableOutputHtml(
  rawHtml: string,
  outputDirectory: string,
  htmlPath: string,
  options: PortableOutputOptions = {},
): string {
  const content = sanitizeSpssHtml(
    rawHtml,
    (source) => resolvePortableImage(source, outputDirectory, htmlPath),
  );
  const print = options.print === true;
  const printHint = print
    ? '<div class="print-hint">If the print dialog does not open, press Ctrl/Cmd+P.</div>'
    : '';
  const printLauncher = print
    ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},50);});</script>'
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SPSS Studio Output</title>
<style>
html { color-scheme: light; }
body { margin: 24px; color: #111; background: #fff; font-family: Arial, Helvetica, sans-serif; }
table { border-collapse: collapse; max-width: 100%; }
th, td { border: 1px solid #777; padding: 4px 7px; }
img { max-width: 100%; height: auto; }
.print-hint { margin: 0 0 16px; padding: 10px; border: 1px solid #999; background: #f5f5f5; }
@media print {
  body { margin: 0; }
  .print-hint { display: none; }
  table, img { break-inside: avoid; }
}
</style>
</head>
<body>
${printHint}${content}
${printLauncher}
</body>
</html>`;
}
