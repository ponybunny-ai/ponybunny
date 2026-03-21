import path from 'node:path';
import { existsSync } from 'node:fs';

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

/**
 * Walk up from cwd (or from the entry-point dir) looking for the nearest
 * directory that contains a package.json — that is the project root.
 * This works regardless of cwd changes because it also searches from the
 * entry-point directory.
 */
function getProjectRootCandidates(): string[] {
  const roots: string[] = [];

  const startDirs = [process.cwd()];
  const entryPoint = process.argv[1];
  if (entryPoint) {
    startDirs.push(path.dirname(path.resolve(entryPoint)));
  }

  for (const startDir of startDirs) {
    let dir = path.resolve(startDir);
    for (let i = 0; i < 8; i++) {
      // Skip node_modules directories — their package.json is not the project root.
      if (!dir.includes(`${path.sep}node_modules`) && existsSync(path.join(dir, 'package.json'))) {
        roots.push(dir);
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return roots;
}

function dedupeCandidates(candidates: string[]): string[] {
  return Array.from(new Set(candidates.map((candidate) => path.resolve(candidate))));
}

export function getPersistenceAssetCandidates(fileName: string): string[] {
  const entryDirs = getEntryDirCandidates();
  const moduleRoots = getProjectRootCandidates();

  return dedupeCandidates([
    path.join(process.cwd(), 'src', 'infra', 'persistence', fileName),
    path.join(process.cwd(), 'dist', 'infra', 'persistence', fileName),
    ...entryDirs.flatMap((dir) => [
      path.join(dir, 'infra', 'persistence', fileName),
      path.join(dir, 'src', 'infra', 'persistence', fileName),
      path.join(dir, 'dist', 'infra', 'persistence', fileName),
    ]),
    ...moduleRoots.flatMap((dir) => [
      path.join(dir, 'src', 'infra', 'persistence', fileName),
      path.join(dir, 'dist', 'infra', 'persistence', fileName),
    ]),
  ]);
}

export function getDocsAssetCandidates(...relativePathSegments: string[]): string[] {
  const entryDirs = getEntryDirCandidates();
  const moduleRoots = getProjectRootCandidates();

  return dedupeCandidates([
    path.join(process.cwd(), 'docs', ...relativePathSegments),
    path.join(process.cwd(), 'dist', 'docs', ...relativePathSegments),
    ...entryDirs.flatMap((dir) => [
      path.join(dir, 'docs', ...relativePathSegments),
      path.join(dir, 'dist', 'docs', ...relativePathSegments),
    ]),
    ...moduleRoots.flatMap((dir) => [
      path.join(dir, 'docs', ...relativePathSegments),
      path.join(dir, 'dist', 'docs', ...relativePathSegments),
    ]),
  ]);
}
