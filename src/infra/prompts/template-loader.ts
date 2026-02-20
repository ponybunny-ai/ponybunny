import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getConfigDir } from '../config/credentials-loader.js';
import { promptDebugLog } from './prompt-debug.js';

export const PROMPT_TEMPLATE_PATHS = {
  'system.md': 'system/identity.md',
  'system-none.md': 'system/identity-none.md',
  'tooling.md': 'system/tooling.md',
  'tool-call-style.md': 'system/tool-call-style.md',
  'safety-core.md': 'system/safety/core.md',
  'safety-escalation.md': 'system/safety/escalation.md',
  'safety-budget.md': 'system/safety/budget.md',
  'skills.md': 'system/skills.md',
  'memory.md': 'system/memory.md',
  'workspace.md': 'system/workspace.md',
  'project-context.md': 'system/project-context.md',
  'runtime.md': 'system/runtime.md',
  'additional-context.md': 'system/additional-context.md',
  'phase-intake.md': 'system/phases/intake.md',
  'phase-elaboration.md': 'system/phases/elaboration.md',
  'phase-planning.md': 'system/phases/planning.md',
  'phase-execution.md': 'system/phases/execution.md',
  'phase-verification.md': 'system/phases/verification.md',
  'phase-evaluation.md': 'system/phases/evaluation.md',
  'phase-publish.md': 'system/phases/publish.md',
  'phase-monitor.md': 'system/phases/monitor.md',
  'phase-conversation.md': 'system/phases/conversation.md',
  'persona.md': 'persona/base.md',
  'persona-guidelines.md': 'persona/guidelines.md',
} as const;

export type PromptTemplateName = keyof typeof PROMPT_TEMPLATE_PATHS;

interface PromptManifestEntry {
  version: string;
}

interface PromptManifest {
  manifestVersion: string;
  templates: Record<string, PromptManifestEntry>;
}

export interface PromptDoctorIssue {
  severity: 'error' | 'warning';
  code:
    | 'default_manifest_missing'
    | 'default_manifest_invalid'
    | 'user_manifest_missing'
    | 'user_manifest_invalid'
    | 'template_missing'
    | 'manifest_entry_missing'
    | 'manifest_version_mismatch'
    | 'manifest_unknown_entry'
    | 'unknown_local_template';
  path?: string;
  message: string;
}

export interface PromptDoctorReport {
  promptDir: string;
  defaultManifestPath: string;
  userManifestPath: string;
  checkedTemplates: number;
  issues: PromptDoctorIssue[];
}

const PROMPT_SEED_SUPPORT_FILES = ['README.md', 'manifest.json'] as const;

export function getPromptTemplateRelativePaths(): string[] {
  return Object.values(PROMPT_TEMPLATE_PATHS);
}

export function getPromptSeedRelativePaths(): string[] {
  return [...getPromptTemplateRelativePaths(), ...PROMPT_SEED_SUPPORT_FILES];
}

function getPromptConfigDir(): string {
  return path.join(getConfigDir(), 'prompts');
}

function getDefaultTemplateSourceDir(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, 'defaults'),
    path.join(process.cwd(), 'src', 'infra', 'prompts', 'defaults'),
    path.join(process.cwd(), 'dist', 'infra', 'prompts', 'defaults'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function resolveTemplateRelativePath(templateName: string): string {
  return PROMPT_TEMPLATE_PATHS[templateName as PromptTemplateName] ?? templateName;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function listFilesRecursively(baseDir: string): string[] {
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  const result: string[] = [];
  const stack = [baseDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      const relativePath = path.relative(baseDir, fullPath);
      result.push(normalizeRelativePath(relativePath));
    }
  }

  return result;
}

function readManifest(filePath: string): PromptManifest | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as PromptManifest;
}

function writeManifest(filePath: string, manifest: PromptManifest): void {
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
}

let seeded = false;

function ensurePromptTemplates(): void {
  if (seeded) {
    return;
  }

  const promptDir = getPromptConfigDir();
  if (!fs.existsSync(promptDir)) {
    fs.mkdirSync(promptDir, { recursive: true, mode: 0o700 });
    promptDebugLog('seed', `created prompt directory: ${promptDir}`);
  }

  const sourceDir = getDefaultTemplateSourceDir();
  const defaultManifestPath = path.join(sourceDir, 'manifest.json');
  const defaultManifest = readManifest(defaultManifestPath);
  if (!defaultManifest) {
    throw new Error(`Default prompt manifest missing: ${defaultManifestPath}`);
  }

  const userManifestPath = path.join(promptDir, 'manifest.json');
  const userManifest = readManifest(userManifestPath) ?? {
    manifestVersion: defaultManifest.manifestVersion,
    templates: {},
  };

  let manifestChanged = false;
  for (const relativePath of getPromptSeedRelativePaths()) {
    if (relativePath === 'manifest.json') {
      continue;
    }

    const targetPath = path.join(promptDir, relativePath);
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    }

    if (fs.existsSync(targetPath)) {
      const defaultVersion = defaultManifest.templates[relativePath]?.version;
      if (defaultVersion && !userManifest.templates[relativePath]) {
        userManifest.templates[relativePath] = { version: defaultVersion };
        manifestChanged = true;
      }

      if (defaultVersion && userManifest.templates[relativePath]?.version !== defaultVersion) {
        promptDebugLog(
          'manifest',
          `version mismatch ${relativePath}: local=${userManifest.templates[relativePath]?.version ?? 'none'} default=${defaultVersion}`
        );
      }
      continue;
    }

    const sourcePath = path.join(sourceDir, relativePath);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    const content = fs.readFileSync(sourcePath, 'utf-8');
    const fileMode = relativePath === 'README.md' ? 0o644 : 0o600;
    fs.writeFileSync(targetPath, content, { mode: fileMode });

    const defaultVersion = defaultManifest.templates[relativePath]?.version;
    if (defaultVersion) {
      userManifest.templates[relativePath] = { version: defaultVersion };
      manifestChanged = true;
    }

    promptDebugLog('seed', `copied default template ${relativePath} -> ${targetPath}`);
  }

  if (userManifest.manifestVersion !== defaultManifest.manifestVersion) {
    userManifest.manifestVersion = defaultManifest.manifestVersion;
    manifestChanged = true;
  }

  if (manifestChanged || !fs.existsSync(userManifestPath)) {
    writeManifest(userManifestPath, userManifest);
    promptDebugLog('manifest', `updated ${userManifestPath} entries=${Object.keys(userManifest.templates).length}`);
  }

  seeded = true;
}

const templateCache = new Map<string, string>();

export function loadPromptTemplate(templateName: string): { path: string; content: string } {
  ensurePromptTemplates();

  const promptDir = getPromptConfigDir();
  const relativePath = resolveTemplateRelativePath(templateName);
  const templatePath = path.join(promptDir, relativePath);

  if (templateCache.has(templatePath)) {
    const cached = templateCache.get(templatePath);
    if (cached !== undefined) {
      promptDebugLog('load', `cache hit ${templatePath} (${cached.length} chars)`);
      return { path: templatePath, content: cached };
    }
  }

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Prompt template not found: ${templatePath}`);
  }

  const content = fs.readFileSync(templatePath, 'utf-8');
  templateCache.set(templatePath, content);
  promptDebugLog('load', `${templatePath} (${content.length} chars)`);

  return {
    path: templatePath,
    content,
  };
}

export function renderPromptTemplate(template: string, values: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }
  return output;
}

export function getPromptDoctorReport(): PromptDoctorReport {
  const promptDir = getPromptConfigDir();
  const sourceDir = getDefaultTemplateSourceDir();
  const defaultManifestPath = path.join(sourceDir, 'manifest.json');
  const userManifestPath = path.join(promptDir, 'manifest.json');

  const report: PromptDoctorReport = {
    promptDir,
    defaultManifestPath,
    userManifestPath,
    checkedTemplates: 0,
    issues: [],
  };

  let defaultManifest: PromptManifest | null = null;
  try {
    defaultManifest = readManifest(defaultManifestPath);
  } catch (error) {
    report.issues.push({
      severity: 'error',
      code: 'default_manifest_invalid',
      path: defaultManifestPath,
      message: `Invalid default manifest JSON: ${(error as Error).message}`,
    });
    return report;
  }

  if (!defaultManifest) {
    report.issues.push({
      severity: 'error',
      code: 'default_manifest_missing',
      path: defaultManifestPath,
      message: `Default manifest not found: ${defaultManifestPath}`,
    });
    return report;
  }

  const expectedTemplates = Object.keys(defaultManifest.templates);
  report.checkedTemplates = expectedTemplates.length;

  let userManifest: PromptManifest | null = null;
  try {
    userManifest = readManifest(userManifestPath);
  } catch (error) {
    report.issues.push({
      severity: 'error',
      code: 'user_manifest_invalid',
      path: userManifestPath,
      message: `Invalid user manifest JSON: ${(error as Error).message}`,
    });
  }

  if (!userManifest) {
    report.issues.push({
      severity: 'error',
      code: 'user_manifest_missing',
      path: userManifestPath,
      message: `User manifest not found: ${userManifestPath}`,
    });
  }

  for (const relativePath of expectedTemplates) {
    const templatePath = path.join(promptDir, relativePath);
    if (!fs.existsSync(templatePath)) {
      report.issues.push({
        severity: 'error',
        code: 'template_missing',
        path: templatePath,
        message: `Missing template file: ${templatePath}`,
      });
    }

    if (!userManifest) {
      continue;
    }

    const userEntry = userManifest.templates[relativePath];
    if (!userEntry) {
      report.issues.push({
        severity: 'warning',
        code: 'manifest_entry_missing',
        path: relativePath,
        message: `Manifest entry missing for template: ${relativePath}`,
      });
      continue;
    }

    const defaultVersion = defaultManifest.templates[relativePath]?.version;
    if (defaultVersion && userEntry.version !== defaultVersion) {
      report.issues.push({
        severity: 'warning',
        code: 'manifest_version_mismatch',
        path: relativePath,
        message: `Version mismatch for ${relativePath}: local=${userEntry.version} default=${defaultVersion}`,
      });
    }
  }

  if (userManifest) {
    for (const relativePath of Object.keys(userManifest.templates)) {
      if (!(relativePath in defaultManifest.templates)) {
        report.issues.push({
          severity: 'warning',
          code: 'manifest_unknown_entry',
          path: relativePath,
          message: `Unknown manifest entry not in defaults: ${relativePath}`,
        });
      }
    }
  }

  const expectedSet = new Set(expectedTemplates);
  const localFiles = listFilesRecursively(promptDir);
  for (const localRelativePath of localFiles) {
    if (localRelativePath === 'manifest.json') {
      continue;
    }

    if (!expectedSet.has(localRelativePath)) {
      report.issues.push({
        severity: 'warning',
        code: 'unknown_local_template',
        path: localRelativePath,
        message: `Untracked local template file: ${localRelativePath}`,
      });
    }
  }

  return report;
}
