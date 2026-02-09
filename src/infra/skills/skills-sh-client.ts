/**
 * Skills.sh API Client
 * Integrates with https://skills.sh to discover and download skills
 */

import https from 'node:https';
import http from 'node:http';

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
      // Call the find-skills API
      const searchUrl = `${this.baseUrl}/api/vercel-labs/skills/find-skills`;
      const requestBody = JSON.stringify({
        query,
        limit,
        tags: options.tags,
        author: options.author,
      });

      const result = await this.makeRequest(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody).toString(),
        },
        body: requestBody,
      });

      const data = JSON.parse(result);

      // Parse response into SkillsShSkill format
      const skills: SkillsShSkill[] = (data.skills || []).map((skill: any) => ({
        name: skill.name || skill.id,
        description: skill.description || '',
        author: skill.author,
        version: skill.version,
        tags: skill.tags || [],
        url: skill.url || `${this.baseUrl}/${skill.author}/skills/${skill.name}`,
        downloadUrl: skill.downloadUrl,
      }));

      return {
        skills,
        total: data.total || skills.length,
      };
    } catch (error) {
      console.error('[SkillsShClient] Search failed:', error);
      throw new Error(`Failed to search skills: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
