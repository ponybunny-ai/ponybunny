import fs from 'fs';
import path from 'path';

const skillPaths = [
  'skills/control-tick/SKILL.md',
  'skills/source-read-stream/SKILL.md',
  'skills/text-detect-problem-signal/SKILL.md',
  'skills/text-extract-problem-block/SKILL.md',
  'skills/analysis-guess-author-role/SKILL.md',
  'skills/data-store-record/SKILL.md',
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
