import * as fs from 'fs';
import * as path from 'path';

const cachedBanners = new Map<number, string | null>();

const DARK_GREEN = '\u001b[38;2;11;107;11m';
const LIGHT_GREEN = '\u001b[38;2;111;230;111m';
const COLOR_RESET = '\u001b[0m';

export function getAsciiArtBanner(width?: number): string | null {
  const cacheKey = width ?? -1;
  if (cachedBanners.has(cacheKey)) {
    return cachedBanners.get(cacheKey) ?? null;
  }

  const candidates = [
    path.join(process.cwd(), 'docs', 'ascii-art-draw.txt'),
    path.join(process.cwd(), '..', 'docs', 'ascii-art-draw.txt'),
  ];

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) {
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf-8').trimEnd();
      if (content.length > 0) {
        const centered = width ? centerAsciiArt(content, width) : content;
        const colored = colorizeAsciiArt(centered);
        cachedBanners.set(cacheKey, colored);
        return colored;
      }
    } catch {
      continue;
    }
  }

  cachedBanners.set(cacheKey, null);
  return null;
}

function colorizeAsciiArt(content: string): string {
  return content
    .replace(/█+/g, (match) => `${DARK_GREEN}${match}${COLOR_RESET}`)
    .replace(/░+/g, (match) => `${LIGHT_GREEN}${match}${COLOR_RESET}`);
}

function centerAsciiArt(content: string, width: number): string {
  return content
    .split('\n')
    .map((line) => {
      const padSize = Math.max(0, Math.floor((width - line.length) / 2));
      return `${' '.repeat(padSize)}${line}`;
    })
    .join('\n');
}
