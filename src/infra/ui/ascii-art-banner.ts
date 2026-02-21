import * as fs from 'fs';
import * as path from 'path';

let cachedBanner: string | null | undefined;

export function getAsciiArtBanner(): string | null {
  if (cachedBanner !== undefined) {
    return cachedBanner;
  }

  const candidates = [
    path.join(process.cwd(), 'docs', 'ascii-art-pagga.txt'),
    path.join(process.cwd(), '..', 'docs', 'ascii-art-pagga.txt'),
  ];

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) {
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf-8').trimEnd();
      if (content.length > 0) {
        cachedBanner = content;
        return cachedBanner;
      }
    } catch {
      continue;
    }
  }

  cachedBanner = null;
  return null;
}
