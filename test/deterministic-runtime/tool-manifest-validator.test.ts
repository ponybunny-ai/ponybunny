import { ToolManifestValidator } from '../../src/deterministic-runtime/tool-manifest-validator.js';
import { ToolRegistry } from '../../src/infra/tools/tool-registry.js';
import { ReadFileTool } from '../../src/infra/tools/implementations/read-file-tool.js';

describe('ToolManifestValidator', () => {
  it('passes for registry with valid manifests', () => {
    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());

    const validator = new ToolManifestValidator();
    const result = validator.validateRegistry(registry);

    expect(result.valid).toBe(true);
    expect(result.totalTools).toBe(1);
    expect(result.manifestsValidated).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it('reports missing manifest when requireManifest is enabled', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'legacy_tool',
      category: 'code',
      riskLevel: 'safe',
      requiresApproval: false,
      description: 'Legacy tool without manifest',
      execute: async () => 'ok',
    });

    const validator = new ToolManifestValidator(undefined, { requireManifest: true });
    const result = validator.validateRegistry(registry);

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'MISSING_MANIFEST')).toBe(true);
  });

  it('reports schema and consistency issues for invalid manifest', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'broken_tool',
      category: 'code',
      riskLevel: 'moderate',
      requiresApproval: false,
      description: 'Broken tool',
      manifest: {
        tool_ref: 'local://unexpected_name',
        display_name: '',
        input_schema: {
          type: 'object',
          properties: {},
        },
        output_schema: {
          type: 'object',
          properties: {},
        },
        side_effect: 'none',
        default_timeout_ms: 999999,
        permissions: {
          network: 'allow',
        },
      },
      execute: async () => 'ok',
    });

    const validator = new ToolManifestValidator();
    const result = validator.validateRegistry(registry);

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'TOOL_REF_MISMATCH')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'DISPLAY_NAME_EMPTY')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'DEFAULT_TIMEOUT_INVALID')).toBe(true);
  });
});
