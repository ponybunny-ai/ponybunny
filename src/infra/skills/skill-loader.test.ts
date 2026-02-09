/**
 * Skill Loader Tests
 */

import { describe, it, expect } from '@jest/globals';
import { parseFrontmatter } from './skill-loader.js';

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
