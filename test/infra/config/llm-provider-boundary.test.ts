import * as fs from 'fs';
import * as path from 'path';

type Violation = {
  filePath: string;
  line: number;
  reason: string;
  snippet: string;
};

function collectSourceFiles(rootDir: string): string[] {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function findViolations(filePath: string): Violation[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const violations: Violation[] = [];

  const bannedDirectClientPatterns: Array<{ regex: RegExp; reason: string }> = [
    { regex: /openaiClient\.streamChatCompletion\(/, reason: 'Direct openaiClient model invocation outside provider layer' },
    { regex: /new\s+OpenAI\s*\(/, reason: 'Direct OpenAI client creation outside provider layer' },
    { regex: /new\s+Anthropic\s*\(/, reason: 'Direct Anthropic client creation outside provider layer' },
  ];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';

    for (const pattern of bannedDirectClientPatterns) {
      if (pattern.regex.test(line)) {
        violations.push({
          filePath,
          line: index + 1,
          reason: pattern.reason,
          snippet: line.trim(),
        });
      }
    }

    if (!/\bfetch\s*\(/.test(line)) {
      continue;
    }

    const window = lines.slice(index, Math.min(index + 10, lines.length)).join('\n');
    if (/\/v1\/(models|responses|messages)|\/chat\/completions|\/models\b/.test(window)) {
      violations.push({
        filePath,
        line: index + 1,
        reason: 'Direct LLM endpoint fetch outside provider layer',
        snippet: line.trim(),
      });
    }
  }

  return violations;
}

describe('llm provider boundary', () => {
  it('prevents direct LLM endpoint access outside provider layer', () => {
    const repoRoot = process.cwd();
    const protectedDirs = [
      path.join(repoRoot, 'src', 'app'),
      path.join(repoRoot, 'src', 'gateway'),
      path.join(repoRoot, 'src', 'scheduler'),
      path.join(repoRoot, 'src', 'autonomy'),
      path.join(repoRoot, 'src', 'cli', 'commands'),
    ];

    const violations: Violation[] = [];
    for (const dir of protectedDirs) {
      if (!fs.existsSync(dir)) {
        continue;
      }
      for (const filePath of collectSourceFiles(dir)) {
        violations.push(...findViolations(filePath));
      }
    }

    if (violations.length > 0) {
      const message = violations
        .map((violation) => `${path.relative(repoRoot, violation.filePath)}:${violation.line} ${violation.reason} -> ${violation.snippet}`)
        .join('\n');
      throw new Error(`Found direct LLM endpoint access outside provider layer:\n${message}`);
    }
  });
});
