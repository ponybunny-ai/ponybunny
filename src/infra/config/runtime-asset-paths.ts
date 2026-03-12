import path from 'node:path';

function getEntryDirCandidates(): string[] {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return [];
  }

  const entryDir = path.dirname(path.resolve(entryPoint));
  return [
    entryDir,
    path.join(entryDir, '..'),
    path.join(entryDir, '..', '..'),
  ];
}

function dedupeCandidates(candidates: string[]): string[] {
  return Array.from(new Set(candidates.map((candidate) => path.resolve(candidate))));
}

export function getPersistenceAssetCandidates(fileName: string): string[] {
  const entryDirs = getEntryDirCandidates();

  return dedupeCandidates([
    path.join(process.cwd(), 'src', 'infra', 'persistence', fileName),
    path.join(process.cwd(), 'dist', 'infra', 'persistence', fileName),
    ...entryDirs.flatMap((dir) => [
      path.join(dir, 'infra', 'persistence', fileName),
      path.join(dir, 'src', 'infra', 'persistence', fileName),
      path.join(dir, 'dist', 'infra', 'persistence', fileName),
    ]),
  ]);
}

export function getDocsAssetCandidates(...relativePathSegments: string[]): string[] {
  const entryDirs = getEntryDirCandidates();

  return dedupeCandidates([
    path.join(process.cwd(), 'docs', ...relativePathSegments),
    path.join(process.cwd(), 'dist', 'docs', ...relativePathSegments),
    ...entryDirs.flatMap((dir) => [
      path.join(dir, 'docs', ...relativePathSegments),
      path.join(dir, 'dist', 'docs', ...relativePathSegments),
    ]),
  ]);
}
