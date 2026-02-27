import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv';

export type DeterministicSchemaType = 'plan' | 'runtime_profile' | 'tool_manifest';

interface SchemaValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
}

const SCHEMA_FILENAMES: Record<DeterministicSchemaType, string> = {
  plan: 'plan.schema.v1.json',
  runtime_profile: 'runtime-profile.schema.v1.json',
  tool_manifest: 'tool-manifest.schema.v1.json',
};

function createAjv(): Ajv2020 {
  return new Ajv2020({ allErrors: true, strict: false });
}

function formatErrorPath(error: ErrorObject): string {
  const instancePath = error.instancePath ?? '';
  const params = error.params as { additionalProperty?: string; missingProperty?: string };

  if (error.keyword === 'additionalProperties' && typeof params.additionalProperty === 'string') {
    return instancePath ? `${instancePath}/${params.additionalProperty}` : `/${params.additionalProperty}`;
  }

  if (error.keyword === 'required' && typeof params.missingProperty === 'string') {
    return instancePath ? `${instancePath}/${params.missingProperty}` : `/${params.missingProperty}`;
  }

  return instancePath || '/';
}

export class DeterministicSchemaValidator {
  private readonly ajv = createAjv();
  private readonly validators = new Map<DeterministicSchemaType, ValidateFunction>();

  constructor(private readonly schemaDir: string = path.resolve(process.cwd(), 'src', 'deterministic-runtime', 'schemas')) {}

  validate(type: DeterministicSchemaType, payload: unknown): SchemaValidationResult {
    const validator = this.getValidator(type);
    const valid = validator(payload);

    if (valid) {
      return { valid: true, errors: [] };
    }

    const errors = (validator.errors ?? []).map((error) => ({
      path: formatErrorPath(error),
      message: error.message ?? 'Unknown validation error',
    }));

    return {
      valid: false,
      errors,
    };
  }

  private getValidator(type: DeterministicSchemaType): ValidateFunction {
    const cached = this.validators.get(type);
    if (cached) {
      return cached;
    }

    const schemaPath = path.join(this.schemaDir, SCHEMA_FILENAMES[type]);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8')) as AnySchema;
    const validator = this.ajv.compile(schema);
    this.validators.set(type, validator);
    return validator;
  }
}
