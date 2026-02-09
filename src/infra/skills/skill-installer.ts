/**
 * Skill Installer
 * Installs skills from skills.sh to the managed directory
 */

import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { getSkillsShClient, type SkillsShSkill } from './skills-sh-client.js';
import { parseFrontmatter } from './skill-loader.js';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);

export interface SkillInstallOptions {
  managedSkillsDir: string; // Default: ~/.ponybunny/skills
  overwrite?: boolean;
}

export interface SkillInstallResult {
  success: boolean;
  skillName: string;
  path?: string;
  error?: string;
  skipped?: boolean;
}

/**
 * Skill Installer Service
 */
export class SkillInstaller {
  private client = getSkillsShClient();

  /**
   * Install a skill from skills.sh by path (e.g., "vercel-labs/skills/find-skills")
   */
  async installSkillByPath(
    skillPath: string,
    options: SkillInstallOptions
  ): Promise<SkillInstallResult> {
    try {
      console.log(`[SkillInstaller] Installing skill: ${skillPath}`);

      // Download skill content
      const content = await this.client.downloadSkill(skillPath);

      // Parse metadata to get skill name
      const metadata = parseFrontmatter(content);
      const skillName = metadata.name || skillPath.split('/').pop() || 'unknown';

      // Determine installation directory
      const skillDir = path.join(options.managedSkillsDir, skillName);
      const skillMdPath = path.join(skillDir, 'SKILL.md');

      // Check if skill already exists
      const exists = await this.skillExists(skillMdPath);
      if (exists && !options.overwrite) {
        console.log(`[SkillInstaller] Skill already exists: ${skillName}`);
        return {
          success: true,
          skillName,
          path: skillDir,
          skipped: true,
        };
      }

      // Create skill directory
      await mkdir(skillDir, { recursive: true });

      // Write SKILL.md
      await writeFile(skillMdPath, content, 'utf-8');

      console.log(`[SkillInstaller] Successfully installed: ${skillName} at ${skillDir}`);

      return {
        success: true,
        skillName,
        path: skillDir,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[SkillInstaller] Installation failed:`, error);

      return {
        success: false,
        skillName: skillPath.split('/').pop() || 'unknown',
        error: errorMessage,
      };
    }
  }

  /**
   * Install a skill from a SkillsShSkill object
   */
  async installSkill(
    skill: SkillsShSkill,
    options: SkillInstallOptions
  ): Promise<SkillInstallResult> {
    // Extract skill path from URL or use download URL
    const skillPath = skill.downloadUrl || skill.url;
    return this.installSkillByPath(skillPath, options);
  }

  /**
   * Install multiple skills
   */
  async installSkills(
    skills: SkillsShSkill[],
    options: SkillInstallOptions
  ): Promise<SkillInstallResult[]> {
    const results: SkillInstallResult[] = [];

    for (const skill of skills) {
      const result = await this.installSkill(skill, options);
      results.push(result);
    }

    return results;
  }

  /**
   * Check if a skill exists at the given path
   */
  private async skillExists(skillMdPath: string): Promise<boolean> {
    try {
      const fileStat = await stat(skillMdPath);
      return fileStat.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Get installed skill info
   */
  async getInstalledSkillInfo(skillName: string, managedSkillsDir: string): Promise<{
    exists: boolean;
    path?: string;
    metadata?: any;
  }> {
    const skillDir = path.join(managedSkillsDir, skillName);
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    const exists = await this.skillExists(skillMdPath);
    if (!exists) {
      return { exists: false };
    }

    try {
      const content = await readFile(skillMdPath, 'utf-8');
      const metadata = parseFrontmatter(content);

      return {
        exists: true,
        path: skillDir,
        metadata,
      };
    } catch (error) {
      return {
        exists: true,
        path: skillDir,
      };
    }
  }
}

// Singleton instance
let globalInstaller: SkillInstaller | null = null;

export function getSkillInstaller(): SkillInstaller {
  if (!globalInstaller) {
    globalInstaller = new SkillInstaller();
  }
  return globalInstaller;
}
