/**
 * Find Skills Tool
 * Search and install skills from skills.sh marketplace
 */

import type { ToolDefinition, ToolContext } from '../tool-registry.js';
import { getSkillsShClient } from '../../skills/skills-sh-client.js';
import { getSkillInstaller } from '../../skills/skill-installer.js';
import os from 'node:os';
import path from 'node:path';

export const findSkillsTool: ToolDefinition = {
  name: 'find_skills',
  category: 'network',
  riskLevel: 'safe',
  requiresApproval: false,
  description: 'Search for skills on skills.sh marketplace and optionally install them',

  async execute(args: Record<string, any>, context: ToolContext): Promise<string> {
    const { query, install = false, limit = 10, tags, author } = args;

    if (!query || typeof query !== 'string') {
      return JSON.stringify({
        error: 'Query parameter is required and must be a string',
      });
    }

    try {
      const client = getSkillsShClient();

      // Search for skills
      const result = await client.searchSkills({
        query,
        limit: Number(limit),
        tags: tags ? (Array.isArray(tags) ? tags : [tags]) : undefined,
        author: author ? String(author) : undefined,
      });

      if (result.skills.length === 0) {
        return JSON.stringify({
          message: `No skills found for query: "${query}"`,
          skills: [],
          total: 0,
        });
      }

      // Format results
      const skillsList = result.skills.map((skill, index) => ({
        index: index + 1,
        name: skill.name,
        description: skill.description,
        author: skill.author,
        tags: skill.tags,
        url: skill.url,
      }));

      // If install flag is set, install the first matching skill
      if (install) {
        const skillToInstall = result.skills[0];
        const installer = getSkillInstaller();
        const managedSkillsDir = path.join(os.homedir(), '.ponybunny', 'skills');

        const installResult = await installer.installSkill(skillToInstall, {
          managedSkillsDir,
          overwrite: false,
        });

        return JSON.stringify({
          message: `Found ${result.total} skill(s) matching "${query}"`,
          skills: skillsList,
          total: result.total,
          installed: {
            success: installResult.success,
            skillName: installResult.skillName,
            path: installResult.path,
            skipped: installResult.skipped,
            error: installResult.error,
          },
        });
      }

      return JSON.stringify({
        message: `Found ${result.total} skill(s) matching "${query}"`,
        skills: skillsList,
        total: result.total,
        hint: 'To install a skill, use the install parameter: {"query": "...", "install": true}',
      });
    } catch (error) {
      return JSON.stringify({
        error: `Failed to search skills: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  },
};
