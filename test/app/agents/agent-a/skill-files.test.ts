import fs from 'fs';
import path from 'path';

const skillPaths = [
  'skills/agent-a/control-tick/SKILL.md',
  'skills/agent-a/source-read-stream/SKILL.md',
  'skills/agent-a/text-detect-problem-signal/SKILL.md',
  'skills/agent-a/text-extract-problem-block/SKILL.md',
  'skills/agent-a/analysis-guess-author-role/SKILL.md',
  'skills/agent-a/data-store-record/SKILL.md',
];

describe('Agent A skill files', () => {
  test('all skill files exist with frontmatter name and description', () => {
    for (const relativePath of skillPaths) {
      const fullPath = path.resolve(process.cwd(), relativePath);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, 'utf-8');
      expect(content).toContain('name:');
      expect(content).toContain('description:');
    }
  });
});
