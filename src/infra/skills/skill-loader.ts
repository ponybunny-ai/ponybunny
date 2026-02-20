/**
 * Skill Loader
 * Loads skills from multiple directories with precedence handling
 */

import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Skill, SkillMetadata, SkillSource } from './types.js';

const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

async function hasSkillFile(dir: string): Promise<boolean> {
  try {
    const skillMdPath = path.join(dir, 'SKILL.md');
    const skillStat = await stat(skillMdPath);
    return skillStat.isFile();
  } catch {
    return false;
  }
}

/**
 * Parse frontmatter from SKILL.md
 */
export function parseFrontmatter(content: string): SkillMetadata {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { name: '', description: '' };
  }

  const frontmatterText = match[1];
  const metadata: Partial<SkillMetadata> = {};

  // Parse YAML-like frontmatter
  const lines = frontmatterText.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    switch (key) {
      case 'name':
        metadata.name = value.replace(/['"]/g, '');
        break;
      case 'description':
        metadata.description = value.replace(/['"]/g, '');
        break;
      case 'version':
        metadata.version = value.replace(/['"]/g, '');
        break;
      case 'author':
        metadata.author = value.replace(/['"]/g, '');
        break;
      case 'tags':
        metadata.tags = value
          .replace(/[\[\]'"]/g, '')
          .split(',')
          .map(t => t.trim());
        break;
      case 'phases':
        metadata.phases = value
          .replace(/[\[\]'"]/g, '')
          .split(',')
          .map(p => p.trim());
        break;
      case 'requires-approval':
      case 'requiresApproval':
        metadata.requiresApproval = value.toLowerCase() === 'true';
        break;
      case 'primary-env':
      case 'primaryEnv':
        metadata.primaryEnv = value.replace(/['"]/g, '') as 'host' | 'sandbox';
        break;
      case 'user-invocable':
      case 'userInvocable':
        metadata.userInvocable = value.toLowerCase() !== 'false';
        break;
      case 'disable-model-invocation':
      case 'disableModelInvocation':
        metadata.disableModelInvocation = value.toLowerCase() === 'true';
        break;
      case 'command-dispatch':
      case 'commandDispatch':
        metadata.commandDispatch = value.replace(/['"]/g, '') as 'tool' | 'skill';
        break;
      case 'command-tool':
      case 'commandTool':
        metadata.commandTool = value.replace(/['"]/g, '');
        break;
      case 'command-arg-mode':
      case 'commandArgMode':
        metadata.commandArgMode = value.replace(/['"]/g, '') as 'raw' | 'parsed';
        break;
    }
  }

  return metadata as SkillMetadata;
}

/**
 * Load a single skill from a directory
 */
export async function loadSkill(
  skillDir: string,
  source: SkillSource
): Promise<Skill | null> {
  try {
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    const skillStat = await stat(skillMdPath);

    if (!skillStat.isFile()) {
      return null;
    }

    const content = await readFile(skillMdPath, 'utf-8');
    const metadata = parseFrontmatter(content);

    // Use directory name as fallback if name not in frontmatter
    if (!metadata.name) {
      metadata.name = path.basename(skillDir);
    }

    // Extract description from content if not in frontmatter
    if (!metadata.description) {
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.startsWith('#') && !line.startsWith('##')) {
          metadata.description = line.replace(/^#+\s*/, '').trim();
          break;
        }
      }
    }

    return {
      name: metadata.name,
      description: metadata.description || 'No description provided',
      filePath: skillMdPath,
      baseDir: skillDir,
      source,
      metadata,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    console.warn(`[skills] Failed to load skill from ${skillDir}:`, error);
    return null;
  }
}

/**
 * Load all skills from a directory
 */
export async function loadSkillsFromDir(
  dir: string,
  source: SkillSource
): Promise<Skill[]> {
  try {
    const dirStat = await stat(dir);
    if (!dirStat.isDirectory()) {
      return [];
    }

    const entries = await readdir(dir);
    const skills: Skill[] = [];
    const queue = entries.map(entry => path.join(dir, entry));

    while (queue.length > 0) {
      const entryPath = queue.shift()!;
      const entryStat = await stat(entryPath);

      if (entryStat.isDirectory()) {
        if (await hasSkillFile(entryPath)) {
          const skill = await loadSkill(entryPath, source);
          if (skill) {
            skills.push(skill);
          }
          continue;
        }

        const childEntries = await readdir(entryPath);
        queue.push(...childEntries.map(child => path.join(entryPath, child)));
      }
    }

    return skills;
  } catch {
    return [];
  }
}

/**
 * Load skills with precedence: extra < bundled < managed < workspace
 */
export async function loadSkillsWithPrecedence(options: {
  workspaceDir: string;
  managedSkillsDir?: string;
  bundledSkillsDir?: string;
  extraDirs?: string[];
}): Promise<Skill[]> {
  const skillMap = new Map<string, Skill>();

  for (const dir of options.extraDirs ?? []) {
    const skills = await loadSkillsFromDir(dir, 'extra');
    for (const skill of skills) {
      skillMap.set(skill.name, skill);
    }
  }

  if (options.bundledSkillsDir) {
    const skills = await loadSkillsFromDir(options.bundledSkillsDir, 'bundled');
    for (const skill of skills) {
      skillMap.set(skill.name, skill);
    }
  }

  if (options.managedSkillsDir) {
    const skills = await loadSkillsFromDir(options.managedSkillsDir, 'managed');
    for (const skill of skills) {
      skillMap.set(skill.name, skill);
    }
  }

  const workspaceSkillsDir = path.join(options.workspaceDir, 'skills');
  const skills = await loadSkillsFromDir(workspaceSkillsDir, 'workspace');
  for (const skill of skills) {
    skillMap.set(skill.name, skill);
  }

  return Array.from(skillMap.values());
}
