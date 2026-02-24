import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CREDENTIALS_SCHEMA_TEMPLATE,
  LLM_CONFIG_SCHEMA_TEMPLATE,
  MCP_CONFIG_SCHEMA_TEMPLATE,
  PONYBUNNY_CONFIG_SCHEMA_TEMPLATE,
} from '../src/infra/config/onboarding.ts';

const scriptFilePath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptFilePath), '..');
const outputDir = path.join(projectRoot, 'docs', 'schemas');

const outputs: Array<{ name: string; schema: object }> = [
  { name: 'ponybunny.schema.json', schema: PONYBUNNY_CONFIG_SCHEMA_TEMPLATE },
  { name: 'credentials.schema.json', schema: CREDENTIALS_SCHEMA_TEMPLATE },
  { name: 'llm-config.schema.json', schema: LLM_CONFIG_SCHEMA_TEMPLATE },
  { name: 'mcp-config.schema.json', schema: MCP_CONFIG_SCHEMA_TEMPLATE },
];

fs.mkdirSync(outputDir, { recursive: true });

for (const output of outputs) {
  const filePath = path.join(outputDir, output.name);
  fs.writeFileSync(filePath, `${JSON.stringify(output.schema, null, 2)}\n`, 'utf-8');
  console.log(`synced ${path.relative(projectRoot, filePath)}`);
}
