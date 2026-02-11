import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

export interface ConfigWatcherOptions {
  configPaths: string[];
  debounceMs?: number;
}

export class ConfigWatcher extends EventEmitter {
  private watchers: fs.FSWatcher[] = [];
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private configPaths: string[];
  private debounceMs: number;
  private isWatching = false;

  constructor(options: ConfigWatcherOptions) {
    super();
    this.configPaths = options.configPaths;
    this.debounceMs = options.debounceMs ?? 1000;
  }

  start(): void {
    if (this.isWatching) {
      return;
    }

    this.isWatching = true;

    for (const configPath of this.configPaths) {
      if (!fs.existsSync(configPath)) {
        console.warn(`[ConfigWatcher] Config file not found: ${configPath}`);
        continue;
      }

      try {
        const watcher = fs.watch(configPath, (eventType) => {
          if (eventType === 'change') {
            this.handleConfigChange(configPath);
          }
        });

        this.watchers.push(watcher);
        console.log(`[ConfigWatcher] Watching: ${configPath}`);
      } catch (error) {
        console.error(`[ConfigWatcher] Failed to watch ${configPath}:`, error);
      }
    }
  }

  stop(): void {
    if (!this.isWatching) {
      return;
    }

    this.isWatching = false;

    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    console.log('[ConfigWatcher] Stopped watching config files');
  }

  private handleConfigChange(configPath: string): void {
    const existingTimer = this.debounceTimers.get(configPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(configPath);
      console.log(`[ConfigWatcher] Config changed: ${configPath}`);
      this.emit('change', { path: configPath, timestamp: Date.now() });
    }, this.debounceMs);

    this.debounceTimers.set(configPath, timer);
  }

  getWatchedPaths(): string[] {
    return [...this.configPaths];
  }

  isActive(): boolean {
    return this.isWatching;
  }
}

export function createConfigWatcher(configDir: string): ConfigWatcher {
  const configPaths = [
    path.join(configDir, 'credentials.json'),
    path.join(configDir, 'llm-config.json'),
    path.join(configDir, 'mcp-config.json'),
  ].filter(p => fs.existsSync(p));

  return new ConfigWatcher({ configPaths });
}
