import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import type { ILogger } from '../../infra/observability/logger.js';
import { NoopLogger } from '../../infra/observability/logger.js';

export interface ConfigWatcherOptions {
  configPaths: string[];
  debounceMs?: number;
  logger?: ILogger;
}

export class ConfigWatcher extends EventEmitter {
  private watchers: fs.FSWatcher[] = [];
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private configPaths: string[];
  private debounceMs: number;
  private isWatching = false;
  private readonly logger: ILogger;

  constructor(options: ConfigWatcherOptions) {
    super();
    this.configPaths = options.configPaths;
    this.debounceMs = options.debounceMs ?? 1000;
    this.logger = options.logger ?? new NoopLogger();
  }

  start(): void {
    if (this.isWatching) {
      return;
    }

    this.isWatching = true;

    for (const configPath of this.configPaths) {
      if (!fs.existsSync(configPath)) {
        this.logger.warn({ event: 'config_file_not_found', configPath }, `Config file not found: ${configPath}`);
        continue;
      }

      try {
        const watcher = fs.watch(configPath, (eventType) => {
          if (eventType === 'change') {
            this.handleConfigChange(configPath);
          }
        });

        this.watchers.push(watcher);
        this.logger.debug({ event: 'config_watch_started', configPath }, `Watching: ${configPath}`);
      } catch (error) {
        this.logger.error({ event: 'config_watch_failed', configPath }, `Failed to watch ${configPath}`, error instanceof Error ? error : undefined);
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

    this.logger.debug({ event: 'config_watch_stopped' }, 'Stopped watching config files');
  }

  private handleConfigChange(configPath: string): void {
    const existingTimer = this.debounceTimers.get(configPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(configPath);
      this.logger.info({ event: 'config_changed', configPath }, `Config changed: ${configPath}`);
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
