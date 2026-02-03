export interface ModelInfo {
  name: string;
  label?: string;
  description?: string;
  provider: 'codex' | 'antigravity';
}

export interface ModelsCache {
  version: number;
  lastUpdated: number;
  models: {
    codex: ModelInfo[];
    antigravity: ModelInfo[];
  };
}
