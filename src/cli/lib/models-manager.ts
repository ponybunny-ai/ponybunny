import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { ModelsCache, ModelInfo } from './models-cache.js';
import { openaiClient } from './openai-client.js';
import { antigravityClient } from './antigravity-client.js';

const CACHE_VERSION = 1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class ModelsManager {
  private configPath: string;
  private cache: ModelsCache | null = null;

  constructor() {
    const configDir = join(homedir(), '.ponybunny');
    this.configPath = join(configDir, 'models.json');
  }

  private loadCache(): ModelsCache | null {
    try {
      if (!existsSync(this.configPath)) {
        return null;
      }
      const data = readFileSync(this.configPath, 'utf-8');
      const cache = JSON.parse(data) as ModelsCache;
      
      if (cache.version !== CACHE_VERSION) {
        return null;
      }
      
      return cache;
    } catch (error) {
      console.warn('Failed to load models cache:', error);
      return null;
    }
  }

  private saveCache(cache: ModelsCache): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(cache, null, 2), 'utf-8');
    } catch (error) {
      console.warn('Failed to save models cache:', error);
    }
  }

  private isCacheValid(cache: ModelsCache | null): boolean {
    if (!cache) return false;
    const age = Date.now() - cache.lastUpdated;
    return age < CACHE_TTL_MS;
  }

  private getDefaultModels(): ModelsCache {
    return {
      version: CACHE_VERSION,
      lastUpdated: Date.now(),
      models: {
        codex: [
          { name: 'gpt-5.2', label: 'GPT-5.2 (Latest)', provider: 'codex' },
          { name: 'gpt-5.2-codex', label: 'GPT-5.2 Codex (Code optimized)', provider: 'codex' },
          { name: 'gpt-4o', label: 'GPT-4o (Fast)', provider: 'codex' },
          { name: 'gpt-4', label: 'GPT-4 (Stable)', provider: 'codex' },
        ],
        antigravity: [
          { name: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', provider: 'antigravity' },
          { name: 'claude-sonnet-4-5-thinking', label: 'Claude Sonnet 4.5 Thinking', provider: 'antigravity' },
          { name: 'claude-opus-4-5-thinking', label: 'Claude Opus 4.5 Thinking', provider: 'antigravity' },
          { name: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Recommended)', provider: 'antigravity' },
          { name: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'antigravity' },
        ],
      },
    };
  }

  async getModels(forceRefresh = false): Promise<ModelsCache> {
    if (!forceRefresh) {
      const cache = this.loadCache();
      if (this.isCacheValid(cache)) {
        return cache!;
      }
    }

    return await this.refreshModels();
  }

  async refreshModels(): Promise<ModelsCache> {
    console.log('Refreshing model lists from APIs...');
    
    const [codexModels, antigravityModels] = await Promise.allSettled([
      this.fetchCodexModels(),
      this.fetchAntigravityModels(),
    ]);

    const cache: ModelsCache = {
      version: CACHE_VERSION,
      lastUpdated: Date.now(),
      models: {
        codex: codexModels.status === 'fulfilled' 
          ? codexModels.value 
          : this.getDefaultModels().models.codex,
        antigravity: antigravityModels.status === 'fulfilled'
          ? antigravityModels.value
          : this.getDefaultModels().models.antigravity,
      },
    };

    this.saveCache(cache);
    console.log(`✓ Models cached: ${cache.models.codex.length} Codex, ${cache.models.antigravity.length} Antigravity`);
    
    return cache;
  }

  private async fetchCodexModels(): Promise<ModelInfo[]> {
    try {
      const modelNames = await openaiClient.listModels();
      return modelNames.map(name => ({
        name,
        provider: 'codex' as const,
      }));
    } catch (error) {
      console.warn('Failed to fetch Codex models:', error);
      return this.getDefaultModels().models.codex;
    }
  }

  private async fetchAntigravityModels(): Promise<ModelInfo[]> {
    try {
      const modelNames = await antigravityClient.listModels();
      return modelNames.map(name => ({
        name,
        provider: 'antigravity' as const,
      }));
    } catch (error) {
      console.warn('Failed to fetch Antigravity models:', error);
      return this.getDefaultModels().models.antigravity;
    }
  }

  getCacheAge(): number | null {
    const cache = this.loadCache();
    if (!cache) return null;
    return Date.now() - cache.lastUpdated;
  }

  clearCache(): void {
    try {
      if (existsSync(this.configPath)) {
        writeFileSync(this.configPath, JSON.stringify(this.getDefaultModels(), null, 2));
        console.log('Models cache cleared and reset to defaults');
      }
    } catch (error) {
      console.warn('Failed to clear cache:', error);
    }
  }
}

export const modelsManager = new ModelsManager();
