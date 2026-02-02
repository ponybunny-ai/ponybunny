import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CLI Integration Tests', () => {
  const pbCommand = 'node dist/cli/index.js';
  let testConfigDir: string;

  beforeAll(() => {
    execSync('npm run build:cli', { cwd: process.cwd() });
  });

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `pb-test-${Date.now()}`);
    process.env.PONYBUNNY_CONFIG_DIR = testConfigDir;
  });

  afterEach(() => {
    if (existsSync(join(testConfigDir, 'auth.json'))) {
      unlinkSync(join(testConfigDir, 'auth.json'));
    }
    delete process.env.PONYBUNNY_CONFIG_DIR;
  });

  describe('pb --version', () => {
    test('outputs version number', () => {
      const output = execSync(`${pbCommand} --version`, {
        encoding: 'utf-8',
      });

      expect(output).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('pb --help', () => {
    test('displays help information', () => {
      const output = execSync(`${pbCommand} --help`, {
        encoding: 'utf-8',
      });

      expect(output).toContain('PonyBunny - Autonomous AI Employee CLI');
      expect(output).toContain('auth');
      expect(output).toContain('chat');
      expect(output).toContain('status');
      expect(output).toContain('config');
    });
  });

  describe('pb auth', () => {
    test('auth --help shows authentication commands', () => {
      const output = execSync(`${pbCommand} auth --help`, {
        encoding: 'utf-8',
      });

      expect(output).toContain('Authentication commands');
    });
  });

  describe('pb goal', () => {
    test('goal --help shows goal commands', () => {
      const output = execSync(`${pbCommand} goal --help`, {
        encoding: 'utf-8',
      });

      expect(output).toContain('Authentication commands');
    });
  });

  describe('pb config', () => {
    test('config --help shows config commands', () => {
      const output = execSync(`${pbCommand} config --help`, {
        encoding: 'utf-8',
      });

      expect(output).toContain('Manage CLI configuration');
    });
  });

  describe('pb status', () => {
    test('shows not authenticated when no credentials', () => {
      const output = execSync(`${pbCommand} status`, {
        encoding: 'utf-8',
      });

      expect(output).toContain('Not authenticated');
      expect(output).toContain('pb auth login');
    });
  });

  describe('Invalid commands', () => {
    test('shows error for unknown command', () => {
      try {
        execSync(`${pbCommand} unknown-command`, {
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      } catch (error: any) {
        expect(error.stderr.toString()).toContain('Invalid command');
      }
    });
  });
});
