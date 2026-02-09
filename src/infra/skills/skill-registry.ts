/**
 * Skill Registry
 * Central registry for managing skills
 */

import fs from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import type { Skill, SkillLoadOptions, SkillPromptFormat, ISkillRegistry } from './types.js';
import { loadSkillsWithPrecedence } from './skill-loader.js';

const readFile = promisify(fs.readFile);

export class SkillRegistry implements ISkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private loaded = false;

  async loadSkills(options: SkillLoadOptions): Promise<void> {
    const allSkills = await loadSkillsWithPrecedence({
      workspaceDir: options.workspaceDir,
      managedSkillsDir: options.managedSkillsDir,
      bundledSkillsDir: options.bundledSkillsDir,
      extraDirs: options.extraDirs,
    });

    // Apply filters
    let filteredSkills = allSkills;

    if (options.skillFilter && options.skillFilter.length > 0) {
      const nameSet = new Set(options.skillFilter);
      filteredSkills = filteredSkills.filter(skill => nameSet.has(skill.name));
    }

    if (options.phaseFilter && options.phaseFilter.length > 0) {
      filteredSkills = filteredSkills.filter(skill => {
        if (!skill.metadata.phases) return true; // No phase restriction
        return skill.metadata.phases.some(phase => 
          options.phaseFilter?.includes(phase)
        );
      });
    }

    // Store in registry
    this.skills.clear();
    for (const skill of filteredSkills) {
      this.skills.set(skill.name, skill);
    }

    this.loaded = true;
    console.log(`[SkillRegistry] Loaded ${this.skills.size} skills`);
  }

  getSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  getSkillsForPhase(phase: string): Skill[] {
    return this.getSkills().filter(skill => {
      if (!skill.metadata.phases) return true; // No phase restriction
      return skill.metadata.phases.includes(phase);
    });
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  hasSkill(name: string): boolean {
    return this.skills.has(name);
  }

  generateSkillsPrompt(options?: {
    phase?: string;
    format?: SkillPromptFormat;
  }): string {
    const format = options?.format?.format ?? 'xml';
    const skills = options?.phase 
      ? this.getSkillsForPhase(options.phase)
      : this.getSkills();

    // Filter out skills disabled for model invocation
    const invocableSkills = skills.filter(
      skill => !skill.metadata.disableModelInvocation
    );

    if (invocableSkills.length === 0) {
      return '';
    }

    if (format === 'xml') {
      return this.generateXMLPrompt(invocableSkills);
    } else {
      return this.generateMarkdownPrompt(invocableSkills);
    }
  }

  private generateXMLPrompt(skills: Skill[]): string {
    const lines: string[] = ['<available_skills>'];

    for (const skill of skills) {
      lines.push('  <skill>');
      lines.push(`    <name>${this.escapeXML(skill.name)}</name>`);
      lines.push(`    <description>${this.escapeXML(skill.description)}</description>`);
      lines.push(`    <location>${this.escapeXML(skill.filePath)}</location>`);
      
      if (skill.metadata.phases && skill.metadata.phases.length > 0) {
        lines.push(`    <phases>${this.escapeXML(skill.metadata.phases.join(', '))}</phases>`);
      }
      
      if (skill.metadata.requiresApproval) {
        lines.push('    <requires_approval>true</requires_approval>');
      }
      
      lines.push('  </skill>');
    }

    lines.push('</available_skills>');
    return lines.join('\n');
  }

  private generateMarkdownPrompt(skills: Skill[]): string {
    const lines: string[] = ['## Available Skills', ''];

    for (const skill of skills) {
      lines.push(`### ${skill.name}`);
      lines.push('');
      lines.push(`**Description**: ${skill.description}`);
      lines.push(`**Location**: \`${skill.filePath}\``);
      
      if (skill.metadata.phases && skill.metadata.phases.length > 0) {
        lines.push(`**Phases**: ${skill.metadata.phases.join(', ')}`);
      }
      
      if (skill.metadata.requiresApproval) {
        lines.push('**Requires Approval**: Yes');
      }
      
      lines.push('');
    }

    return lines.join('\n');
  }

  private escapeXML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async loadSkillContent(skillName: string): Promise<string> {
    const skill = this.skills.get(skillName);
    if (!skill) {
      throw new Error(`Skill not found: ${skillName}`);
    }

    // Check if already loaded
    if (skill.content) {
      return skill.content;
    }

    // Lazy load content
    const content = await readFile(skill.filePath, 'utf-8');
    skill.content = content;
    return content;
  }

  /**
   * Get user-invocable skills for CLI commands
   */
  getUserInvocableSkills(): Skill[] {
    return this.getSkills().filter(
      skill => skill.metadata.userInvocable !== false
    );
  }

  /**
   * Get skills by tag
   */
  getSkillsByTag(tag: string): Skill[] {
    return this.getSkills().filter(skill => 
      skill.metadata.tags?.includes(tag)
    );
  }

  /**
   * Get skill statistics
   */
  getStats() {
    const skills = this.getSkills();
    const bySource: Record<string, number> = {
      workspace: 0,
      managed: 0,
      bundled: 0,
      extra: 0,
    };

    for (const skill of skills) {
      bySource[skill.source]++;
    }

    return {
      total: skills.length,
      bySource,
      userInvocable: this.getUserInvocableSkills().length,
      modelInvocable: skills.filter(s => !s.metadata.disableModelInvocation).length,
    };
  }
}

// Singleton instance
let globalRegistry: SkillRegistry | null = null;

export function getGlobalSkillRegistry(): SkillRegistry {
  if (!globalRegistry) {
    globalRegistry = new SkillRegistry();
  }
  return globalRegistry;
}
