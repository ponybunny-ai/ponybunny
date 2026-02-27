import type { ToolRegistry, ToolManifestV1 } from '../infra/tools/tool-registry.js';
import { DeterministicSchemaValidator } from './schema-validator.js';

export interface ToolManifestValidationIssue {
  toolName: string;
  code:
    | 'MISSING_MANIFEST'
    | 'SCHEMA_INVALID'
    | 'TOOL_REF_MISMATCH'
    | 'DISPLAY_NAME_EMPTY'
    | 'DEFAULT_TIMEOUT_INVALID';
  message: string;
  path?: string;
}

export interface ToolManifestValidationResult {
  valid: boolean;
  totalTools: number;
  manifestsValidated: number;
  issues: ToolManifestValidationIssue[];
}

export interface ToolManifestValidatorOptions {
  requireManifest?: boolean;
}

export class ToolManifestValidator {
  private readonly schemaValidator: DeterministicSchemaValidator;
  private readonly options: Required<ToolManifestValidatorOptions>;

  constructor(schemaValidator?: DeterministicSchemaValidator, options?: ToolManifestValidatorOptions) {
    this.schemaValidator = schemaValidator ?? new DeterministicSchemaValidator();
    this.options = {
      requireManifest: options?.requireManifest ?? false,
    };
  }

  validateRegistry(registry: ToolRegistry): ToolManifestValidationResult {
    const tools = registry.getAllTools();
    const issues: ToolManifestValidationIssue[] = [];
    let manifestsValidated = 0;

    for (const tool of tools) {
      const manifest = tool.manifest;
      if (!manifest) {
        if (this.options.requireManifest) {
          issues.push({
            toolName: tool.name,
            code: 'MISSING_MANIFEST',
            message: 'tool manifest is required but missing',
          });
        }
        continue;
      }

      manifestsValidated += 1;
      this.validateManifestShape(tool.name, manifest, issues);
      this.validateManifestConsistency(tool.name, manifest, issues);
    }

    return {
      valid: issues.length === 0,
      totalTools: tools.length,
      manifestsValidated,
      issues,
    };
  }

  private validateManifestShape(
    toolName: string,
    manifest: ToolManifestV1,
    issues: ToolManifestValidationIssue[]
  ): void {
    const schemaResult = this.schemaValidator.validate('tool_manifest', manifest);
    if (!schemaResult.valid) {
      for (const error of schemaResult.errors) {
        issues.push({
          toolName,
          code: 'SCHEMA_INVALID',
          message: error.message,
          path: error.path,
        });
      }
    }
  }

  private validateManifestConsistency(
    toolName: string,
    manifest: ToolManifestV1,
    issues: ToolManifestValidationIssue[]
  ): void {
    if (!manifest.tool_ref.endsWith(`/${toolName}`) && !manifest.tool_ref.endsWith(`://${toolName}`)) {
      issues.push({
        toolName,
        code: 'TOOL_REF_MISMATCH',
        message: `manifest tool_ref '${manifest.tool_ref}' does not match tool name '${toolName}'`,
        path: '/tool_ref',
      });
    }

    if (!manifest.display_name || manifest.display_name.trim().length === 0) {
      issues.push({
        toolName,
        code: 'DISPLAY_NAME_EMPTY',
        message: 'manifest display_name cannot be empty',
        path: '/display_name',
      });
    }

    if (manifest.default_timeout_ms !== undefined) {
      const timeout = manifest.default_timeout_ms;
      if (!Number.isInteger(timeout) || timeout < 0 || timeout > 600000) {
        issues.push({
          toolName,
          code: 'DEFAULT_TIMEOUT_INVALID',
          message: 'manifest default_timeout_ms must be an integer between 0 and 600000',
          path: '/default_timeout_ms',
        });
      }
    }
  }
}
