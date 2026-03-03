import * as fs from 'fs';
import * as path from 'path';
import {
  PONYBUNNY_CONFIG_SCHEMA_TEMPLATE,
  getOnboardingFiles,
  initAllConfigFiles,
} from '../../../src/infra/config/onboarding.js';

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

describe('config change coupling invariants', () => {
  const repoRoot = process.cwd();

  it('keeps docs schema synchronized with onboarding schema template', () => {
    const docsSchemaPath = path.join(repoRoot, 'docs', 'schemas', 'ponybunny.schema.json');
    const docsSchema = readJson(docsSchemaPath);

    expect(docsSchema).toEqual(PONYBUNNY_CONFIG_SCHEMA_TEMPLATE);
  });

  it('keeps docs example aligned with schema-required top-level keys and tui fields', () => {
    const docsExamplePath = path.join(repoRoot, 'docs', 'config-templates', 'ponybunny.example.json');
    const docsExample = readJson(docsExamplePath) as Record<string, unknown>;

    expect(docsExample.$schema).toBe('https://ponybunny.dho.ai/schemas/ponybunny.schema.json');

    const requiredTopLevel = PONYBUNNY_CONFIG_SCHEMA_TEMPLATE.required;
    for (const key of requiredTopLevel) {
      expect(docsExample[key]).toBeDefined();
    }

    const tui = docsExample.tui as Record<string, unknown>;
    expect(typeof tui.inputBackgroundColor).toBe('string');
    expect(typeof tui.sessionFirstEnabled).toBe('boolean');
    expect(typeof tui.goalSubmitFastPathEnabled).toBe('boolean');
  });

  it('keeps pb init dry-run output consistent for schema and runtime config artifacts', () => {
    const tempRoot = fs.mkdtempSync(path.join(repoRoot, '.tmp-config-coupling-'));
    const previousConfigDir = process.env.PONYBUNNY_CONFIG_DIR;
    process.env.PONYBUNNY_CONFIG_DIR = tempRoot;

    try {
      const onboardingNames = new Set(getOnboardingFiles().map((file) => file.name));
      expect(onboardingNames.has('ponybunny.schema.json')).toBe(true);
      expect(onboardingNames.has('ponybunny.json')).toBe(true);

      const dryRunResults = initAllConfigFiles({ dryRun: true });
      const dryRunByFile = new Map(dryRunResults.map((result) => [result.file, result]));

      expect(dryRunByFile.get('ponybunny.schema.json')?.status).toBe('created');
      expect(dryRunByFile.get('ponybunny.json')?.status).toBe('created');
      expect(dryRunByFile.get('ponybunny.schema.json')?.message).toContain(tempRoot);
      expect(dryRunByFile.get('ponybunny.json')?.message).toContain(tempRoot);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.PONYBUNNY_CONFIG_DIR;
      } else {
        process.env.PONYBUNNY_CONFIG_DIR = previousConfigDir;
      }

      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
