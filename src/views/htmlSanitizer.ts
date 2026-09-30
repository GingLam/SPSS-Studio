export type LocalImageResolver = (source: string) => string | undefined;

function sanitizeStyle(value: string): string {
  return value
    .replace(/@import\s+[^;]+;?/giu, '')
    .replace(/url\s*\([^)]*\)/giu, '')
    .replace(/expression\s*\([^)]*\)/giu, '')
    .replace(/behavior\s*:[^;]+;?/giu, '');
}

/** Keeps SPSS presentation markup while removing executable and remote content. */
export function sanitizeSpssHtml(rawHtml: string, resolveImage: LocalImageResolver): string {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/iu.exec(rawHtml)?.[1] ?? rawHtml;
  const styles = [...rawHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)]
    .map((match) => `<style>${sanitizeStyle(match[1] ?? '')}</style>`)
    .join('');
  let html = `${styles}${body}`;
  html = html.replace(/<(script|iframe|object|embed|form|input|button|textarea|select|option|base|link|meta)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, '');
  html = html.replace(/<(script|iframe|object|embed|form|input|button|textarea|select|option|base|link|meta)\b[^>]*\/?\s*>/giu, '');
  html = html.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, '');
  html = html.replace(/\s+(?:srcdoc|action|formaction)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, '');
  html = html.replace(/\s+href\s*=\s*(["'])(?!#)[\s\S]*?\1/giu, '');
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/giu, (_match, open: string, css: string, close: string) => `${open}${sanitizeStyle(css)}${close}`);
  html = html.replace(/<img\b([^>]*?)\bsrc\s*=\s*(["'])(.*?)\2([^>]*)>/giu, (_match, before: string, _quote: string, source: string, after: string) => {
    const resolved = resolveImage(source);
    return resolved ? `<img${before}src="${resolved}"${after}>` : '';
  });
  return html;
}
