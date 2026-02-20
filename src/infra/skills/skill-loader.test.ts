/**
 * Skill Loader Tests
 */

import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFrontmatter, loadSkillsFromDir } from './skill-loader.js';

describe('parseFrontmatter', () => {
  it('should parse basic frontmatter', () => {
    const content = `---
name: test-skill
description: A test skill
version: 1.0.0
---

# Test Skill

Content here.`;

    const metadata = parseFrontmatter(content);
    expect(metadata.name).toBe('test-skill');
    expect(metadata.description).toBe('A test skill');
    expect(metadata.version).toBe('1.0.0');
  });

  it('should parse arrays', () => {
    const content = `---
name: test-skill
tags: [testing, example, demo]
phases: [execution, verification]
---`;

    const metadata = parseFrontmatter(content);
    expect(metadata.tags).toEqual(['testing', 'example', 'demo']);
    expect(metadata.phases).toEqual(['execution', 'verification']);
  });

  it('should parse boolean flags', () => {
    const content = `---
name: test-skill
requiresApproval: true
userInvocable: false
disableModelInvocation: true
---`;

    const metadata = parseFrontmatter(content);
    expect(metadata.requiresApproval).toBe(true);
    expect(metadata.userInvocable).toBe(false);
    expect(metadata.disableModelInvocation).toBe(true);
  });

  it('should handle both kebab-case and camelCase keys', () => {
    const content = `---
name: test-skill
requires-approval: true
primary-env: sandbox
command-dispatch: tool
---`;

    const metadata = parseFrontmatter(content);
    expect(metadata.requiresApproval).toBe(true);
    expect(metadata.primaryEnv).toBe('sandbox');
    expect(metadata.commandDispatch).toBe('tool');
  });

  it('should return empty metadata for content without frontmatter', () => {
    const content = `# Test Skill

No frontmatter here.`;

    const metadata = parseFrontmatter(content);
    expect(metadata.name).toBe('');
    expect(metadata.description).toBe('');
  });
});

describe('loadSkillsFromDir', () => {
  it('loads nested skills and skips grouping folders without SKILL.md', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponybunny-skills-'));
    const groupedRoot = path.join(tempDir, 'agent-a');
    const nestedSkillDir = path.join(groupedRoot, 'nested-skill');
    const topLevelSkillDir = path.join(tempDir, 'top-level-skill');

    fs.mkdirSync(nestedSkillDir, { recursive: true });
    fs.mkdirSync(topLevelSkillDir, { recursive: true });

    fs.writeFileSync(
      path.join(nestedSkillDir, 'SKILL.md'),
      `---\nname: nested-skill\ndescription: nested\n---\n# Nested Skill\n`
    );
    fs.writeFileSync(
      path.join(topLevelSkillDir, 'SKILL.md'),
      `---\nname: top-level-skill\ndescription: top level\n---\n# Top Skill\n`
    );

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    try {
      const skills = await loadSkillsFromDir(tempDir, 'workspace');
      const names = skills.map(skill => skill.name).sort();
      expect(names).toEqual(['nested-skill', 'top-level-skill']);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
