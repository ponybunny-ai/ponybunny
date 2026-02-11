/**
 * Skills.sh CLI Client
 * Integrates with https://skills.sh to discover and download skills
 * Uses the skills CLI (npx skills) for searching
 */

import https from 'node:https';
import http from 'node:http';
import { spawn } from 'node:child_process';

export interface SkillsShSkill {
  name: string;
  description: string;
  author?: string;
  version?: string;
  tags?: string[];
  url: string; // Full URL to the skill on skills.sh
  downloadUrl?: string; // URL to download SKILL.md
}

export interface SkillSearchOptions {
  query?: string;
  tags?: string[];
  author?: string;
  limit?: number;
}

export interface SkillSearchResult {
  skills: SkillsShSkill[];
  total: number;
}

/**
 * Skills.sh API Client
 * Provides discovery and download capabilities for skills from skills.sh
 */
export class SkillsShClient {
  private readonly baseUrl = 'https://skills.sh';

  /**
   * Search for skills using the find-skills skill
   * Uses the vercel-labs/skills/find-skills endpoint
   */
  async searchSkills(options: SkillSearchOptions): Promise<SkillSearchResult> {
    const { query = '', limit = 10 } = options;

    try {
      const output = await this.executeSkillsCLI(['find', query]);
      const skills = this.parseSkillsOutput(output, limit);

      return {
        skills,
        total: skills.length,
      };
    } catch (error) {
      console.error('[SkillsShClient] Search failed:', error);
      throw new Error(`Failed to search skills: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private executeSkillsCLI(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('npx', ['skills', ...args], {
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
      };

      timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('skills CLI timeout after 10s'));
      }, 10000);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        cleanup();
        if (code === 0 || stdout.length > 0) {
          resolve(stdout);
        } else {
          reject(new Error(`skills CLI exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        cleanup();
        reject(error);
      });
    });
  }

  private parseSkillsOutput(output: string, limit: number): SkillsShSkill[] {
    const skills: SkillsShSkill[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
      
      const skillMatch = cleanLine.match(/^([^\s]+\/[^\s]+)@([^\s]+)$/);
      if (skillMatch) {
        const [, ownerRepo, skillName] = skillMatch;
        const [owner, repo] = ownerRepo.split('/');
        const url = `https://skills.sh/${ownerRepo}/${skillName}`;
        
        skills.push({
          name: skillName,
          description: '',
          author: owner,
          url,
          downloadUrl: `${url}/SKILL.md`,
        });

        if (skills.length >= limit) {
          break;
        }
      }
    }

    return skills;
  }

  /**
   * Download a skill's SKILL.md content
   */
  async downloadSkill(skillUrl: string): Promise<string> {
    try {
      // If it's a full URL, use it directly
      let downloadUrl = skillUrl;

      // If it's a skill path (author/skills/name), construct the URL
      if (!skillUrl.startsWith('http')) {
        downloadUrl = `${this.baseUrl}/${skillUrl}/SKILL.md`;
      } else if (!skillUrl.endsWith('SKILL.md')) {
        // Append SKILL.md if not already present
        downloadUrl = `${skillUrl}/SKILL.md`;
      }

      const content = await this.makeRequest(downloadUrl, { method: 'GET' });
      return content;
    } catch (error) {
      console.error('[SkillsShClient] Download failed:', error);
      throw new Error(`Failed to download skill: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get skill details by full path (author/skills/name)
   */
  async getSkillDetails(skillPath: string): Promise<SkillsShSkill> {
    try {
      const apiUrl = `${this.baseUrl}/api/${skillPath}`;
      const result = await this.makeRequest(apiUrl, { method: 'GET' });
      const data = JSON.parse(result);

      return {
        name: data.name || skillPath.split('/').pop() || '',
        description: data.description || '',
        author: data.author,
        version: data.version,
        tags: data.tags || [],
        url: `${this.baseUrl}/${skillPath}`,
        downloadUrl: data.downloadUrl || `${this.baseUrl}/${skillPath}/SKILL.md`,
      };
    } catch (error) {
      console.error('[SkillsShClient] Get details failed:', error);
      throw new Error(`Failed to get skill details: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Make HTTP/HTTPS request
   */
  private makeRequest(
    url: string,
    options: {
      method: 'GET' | 'POST';
      headers?: Record<string, string>;
      body?: string;
    }
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;

      const req = client.request(
        url,
        {
          method: options.method,
          headers: options.headers || {},
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            }
          });
        }
      );

      req.on('error', (error) => {
        reject(error);
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }
}

// Singleton instance
let globalClient: SkillsShClient | null = null;

export function getSkillsShClient(): SkillsShClient {
  if (!globalClient) {
    globalClient = new SkillsShClient();
  }
  return globalClient;
}
