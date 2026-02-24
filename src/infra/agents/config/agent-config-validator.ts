import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type { AnySchema } from 'ajv';
import addFormats from 'ajv-formats';
import type { AgentConfig, CompiledAgentConfig } from './agent-config-types.js';
import { compileAgentConfig } from './agent-config-types.js';

export class AgentConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: Array<{ path: string; message: string }>
  ) {
    super(message);
    this.name = 'AgentConfigValidationError';
  }
}

function createValidator(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

let schemaCache: unknown | null = null;
let compiledValidator: ReturnType<Ajv2020['compile']> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeSchemaForAjv(schema: unknown): unknown {
  if (!isRecord(schema)) {
    return schema;
  }

  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  const defs = isRecord(clone.$defs) ? clone.$defs : undefined;
  if (!defs) {
    return clone;
  }

  const limits = isRecord(defs.limits) ? defs.limits : undefined;
  if (limits && isRecord(limits.additionalProperties) && Array.isArray(limits.additionalProperties.oneOf)) {
    limits.additionalProperties.anyOf = limits.additionalProperties.oneOf;
    delete limits.additionalProperties.oneOf;
  }

  const runnerConfigBase = isRecord(defs.runnerConfigBase) ? defs.runnerConfigBase : undefined;
  const thresholds = runnerConfigBase
    && isRecord(runnerConfigBase.properties)
    && isRecord(runnerConfigBase.properties.thresholds)
    && isRecord(runnerConfigBase.properties.thresholds.additionalProperties)
      ? runnerConfigBase.properties.thresholds.additionalProperties
      : undefined;

  if (thresholds && Array.isArray(thresholds.oneOf)) {
    thresholds.anyOf = thresholds.oneOf;
    delete thresholds.oneOf;
  }

  return clone;
}

function resolveSchemaPath(): string {
  const envPath = process.env.PONYBUNNY_AGENT_SCHEMA_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const candidates = [
    path.resolve(process.cwd(), 'docs', 'schemas', 'agent.schema.json'),
    path.resolve(process.cwd(), 'dist', 'docs', 'schemas', 'agent.schema.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Agent schema file not found. Tried: ${candidates.join(', ')}`
  );
}

function loadSchema(): unknown {
  if (schemaCache) {
    return schemaCache;
  }

  const schemaPath = resolveSchemaPath();
  const content = fs.readFileSync(schemaPath, 'utf-8');
  schemaCache = normalizeSchemaForAjv(JSON.parse(content) as unknown);
  return schemaCache;
}

function getCompiledValidator() {
  if (compiledValidator) {
    return compiledValidator;
  }

  const ajv = createValidator();
  compiledValidator = ajv.compile(loadSchema() as AnySchema);
  return compiledValidator;
}

function formatErrorPath(error: { instancePath?: string; keyword?: string; params?: any }): string {
  const instancePath = error.instancePath ?? '';

  if (error.keyword === 'additionalProperties' && typeof error.params?.additionalProperty === 'string') {
    const suffix = error.params.additionalProperty;
    return instancePath ? `${instancePath}/${suffix}` : `/${suffix}`;
  }

  if (error.keyword === 'required' && typeof error.params?.missingProperty === 'string') {
    const suffix = error.params.missingProperty;
    return instancePath ? `${instancePath}/${suffix}` : `/${suffix}`;
  }

  return instancePath || '/';
}

export function validateAgentConfig(config: unknown): AgentConfig {
  const validate = getCompiledValidator();

  if (!validate(config)) {
    const errors = (validate.errors || []).map((err) => ({
      path: formatErrorPath(err),
      message: err.message || 'Unknown validation error',
    }));

    throw new AgentConfigValidationError(
      `Invalid agent configuration: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
      errors
    );
  }

  return config as unknown as AgentConfig;
}

export function validateAndCompileAgentConfig(config: unknown): CompiledAgentConfig {
  return compileAgentConfig(validateAgentConfig(config));
}
