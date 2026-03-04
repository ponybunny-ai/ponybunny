import { render } from 'markdansi';
import { highlight } from 'cli-highlight';

function highlightCode(code: string, lang?: string): string {
  try {
    return highlight(code, {
      language: lang && lang.trim().length > 0 ? lang.trim() : undefined,
      ignoreIllegals: true,
    });
  } catch {
    return code;
  }
}

function normalizeRenderedMarkdown(rendered: string): string {
  return rendered
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trimEnd();
}

export function renderMarkdownToTerminalLines(markdown: string, width: number): string[] {
  const source = markdown.trim().length > 0 ? markdown : '(empty)';
  const rendered = render(source, {
    width: Math.max(20, width),
    wrap: true,
    color: true,
    hyperlinks: true,
    listIndent: 2,
    tableBorder: 'unicode',
    tablePadding: 1,
    tableTruncate: true,
    codeBox: true,
    codeGutter: true,
    codeWrap: true,
    highlighter: highlightCode,
  });

  const normalized = normalizeRenderedMarkdown(rendered);
  return normalized.split('\n');
}
