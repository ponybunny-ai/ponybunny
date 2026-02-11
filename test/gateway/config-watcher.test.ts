import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ConfigWatcher } from '../../src/gateway/config/config-watcher.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ConfigWatcher', () => {
  let tempDir: string;
  let configPath: string;
  let watcher: ConfigWatcher;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-watcher-test-'));
    configPath = path.join(tempDir, 'test-config.json');
    fs.writeFileSync(configPath, JSON.stringify({ test: 'initial' }));
  });

  afterEach(() => {
    if (watcher) {
      watcher.stop();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should start watching config files', () => {
    watcher = new ConfigWatcher({ configPaths: [configPath] });
    watcher.start();

    expect(watcher.isActive()).toBe(true);
    expect(watcher.getWatchedPaths()).toEqual([configPath]);
  });

  it('should stop watching config files', () => {
    watcher = new ConfigWatcher({ configPaths: [configPath] });
    watcher.start();
    watcher.stop();

    expect(watcher.isActive()).toBe(false);
  });

  it('should emit change event when config file is modified', (done) => {
    watcher = new ConfigWatcher({ configPaths: [configPath], debounceMs: 100 });

    watcher.on('change', (event: { path: string; timestamp: number }) => {
      expect(event.path).toBe(configPath);
      expect(event.timestamp).toBeGreaterThan(0);
      done();
    });

    watcher.start();

    setTimeout(() => {
      fs.writeFileSync(configPath, JSON.stringify({ test: 'modified' }));
    }, 50);
  }, 10000);

  it('should debounce multiple rapid changes', (done) => {
    watcher = new ConfigWatcher({ configPaths: [configPath], debounceMs: 200 });

    let changeCount = 0;
    watcher.on('change', () => {
      changeCount++;
    });

    watcher.start();

    fs.writeFileSync(configPath, JSON.stringify({ test: 'change1' }));
    setTimeout(() => fs.writeFileSync(configPath, JSON.stringify({ test: 'change2' })), 50);
    setTimeout(() => fs.writeFileSync(configPath, JSON.stringify({ test: 'change3' })), 100);

    setTimeout(() => {
      expect(changeCount).toBeLessThanOrEqual(1);
      done();
    }, 500);
  }, 10000);

  it('should handle non-existent config files gracefully', () => {
    const nonExistentPath = path.join(tempDir, 'non-existent.json');
    watcher = new ConfigWatcher({ configPaths: [nonExistentPath] });

    expect(() => watcher.start()).not.toThrow();
    expect(watcher.isActive()).toBe(true);
  });

  it('should not emit events after stopping', (done) => {
    watcher = new ConfigWatcher({ configPaths: [configPath], debounceMs: 100 });

    let changeCount = 0;
    watcher.on('change', () => {
      changeCount++;
    });

    watcher.start();
    watcher.stop();

    fs.writeFileSync(configPath, JSON.stringify({ test: 'after-stop' }));

    setTimeout(() => {
      expect(changeCount).toBe(0);
      done();
    }, 300);
  }, 10000);
});
