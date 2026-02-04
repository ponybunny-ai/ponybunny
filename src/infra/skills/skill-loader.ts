import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Skill, SkillMetadata } from '../../domain/skill/types.js';

export class SkillLoader {
  private skills = new Map<string, Skill>();
  private skillDirs: string[] = [];

  constructor(baseDirs: string[]) {
    this.skillDirs = baseDirs.map(d => resolve(d));
  }

  loadSkills(): Skill[] {
    this.skills.clear();

    for (const dir of this.skillDirs) {
      if (!existsSync(dir)) continue;

      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        if (statSync(fullPath).isDirectory()) {
          const skillMdPath = join(fullPath, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            this.parseAndRegisterSkill(skillMdPath);
          }
        }
      }
    }

    return Array.from(this.skills.values());
  }

  private parseAndRegisterSkill(filePath: string): void {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const metadata = this.extractFrontmatter(content);
      
      if (metadata) {
        const skill: Skill = {
          name: metadata.name,
          description: metadata.description,
          path: filePath,
        };
        this.skills.set(skill.name, skill);
      }
    } catch (error) {
      console.error(`Failed to load skill from ${filePath}:`, error);
    }
  }

  private extractFrontmatter(content: string): SkillMetadata | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const yaml = match[1];
    const metadata: any = {};
    
    // Simple YAML parser for flat keys (robust enough for our needs)
    yaml.split('\n').forEach(line => {
      const [key, ...values] = line.split(':');
      if (key && values.length) {
        metadata[key.trim()] = values.join(':').trim();
      }
    });

    if (!metadata.name || !metadata.description) return null;

    return {
      name: metadata.name,
      description: metadata.description,
      // emoji/requires parsing omitted for MVP simplicity
    };
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }
}
