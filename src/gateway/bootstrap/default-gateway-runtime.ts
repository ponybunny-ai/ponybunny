import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import type { GatewayConfig } from '../types.js';
import { GatewayServer } from '../gateway-server.js';
import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import { WorkOrderDatabase } from '../../work-order/database/manager.js';

const MODULE_DIR = resolveModuleDir();

export interface DefaultGatewayPersistenceConfig {
  dbPath: string;
  memoryDbPath: string;
}

export interface DefaultGatewayRuntimeConfig extends DefaultGatewayPersistenceConfig {
  host: string;
  port: number;
  debugMode?: boolean;
}

export interface GatewayPersistenceAssembly {
  db: Database.Database;
  dbPath: string;
  memoryDb: Database.Database;
  memoryDbPath: string;
  repository: IWorkOrderRepository;
}

export interface DefaultGatewayRuntimeAssembly extends GatewayPersistenceAssembly {
  gateway: GatewayServer;
}

export function ensureGatewayPersistenceSchemas(assembly: Pick<GatewayPersistenceAssembly, 'db' | 'memoryDb'>): void {
  applySchema(assembly.db, [
    '../../infra/persistence/schema.sql',
    '../../../dist/infra/persistence/schema.sql',
  ]);
  applySchema(assembly.memoryDb, [
    '../../infra/persistence/schema-memory.sql',
    '../../../dist/infra/persistence/schema-memory.sql',
  ]);
}

export async function createDefaultGatewayPersistence(
  config: DefaultGatewayPersistenceConfig
): Promise<GatewayPersistenceAssembly> {
  const db = new Database(config.dbPath);
  const memoryDb = new Database(config.memoryDbPath);

  try {
    ensureGatewayPersistenceSchemas({ db, memoryDb });

    const repository = new WorkOrderDatabase(config.dbPath);
    await repository.initialize();

    return {
      db,
      dbPath: config.dbPath,
      memoryDb,
      memoryDbPath: config.memoryDbPath,
      repository,
    };
  } catch (error) {
    db.close();
    memoryDb.close();
    throw error;
  }
}

export async function createDefaultGatewayRuntime(
  config: DefaultGatewayRuntimeConfig
): Promise<DefaultGatewayRuntimeAssembly> {
  const persistence = await createDefaultGatewayPersistence(config);

  try {
    const gateway = new GatewayServer(
      {
        db: persistence.db,
        dbPath: persistence.dbPath,
        memoryDb: persistence.memoryDb,
        memoryDbPath: persistence.memoryDbPath,
        repository: persistence.repository,
        debugMode: config.debugMode,
      },
      {
        host: config.host,
        port: config.port,
      } satisfies Partial<GatewayConfig>
    );

    return {
      ...persistence,
      gateway,
    };
  } catch (error) {
    closeRepository(persistence.repository);
    persistence.db.close();
    persistence.memoryDb.close();
    throw error;
  }
}

export async function stopDefaultGatewayRuntime(runtime: DefaultGatewayRuntimeAssembly): Promise<void> {
  try {
    await runtime.gateway.stop();
  } finally {
    closeRepository(runtime.repository);
    runtime.db.close();
    runtime.memoryDb.close();
  }
}

function applySchema(db: Database.Database, relativeCandidates: string[]): void {
  for (const candidate of relativeCandidates) {
    try {
      const schemaPath = join(MODULE_DIR, candidate);
      const schema = readFileSync(schemaPath, 'utf-8');
      db.exec(schema);
      return;
    } catch {
      // Try the next known source/dist location.
    }
  }
}

function closeRepository(repository: IWorkOrderRepository): void {
  if (typeof repository.close === 'function') {
    repository.close();
  }
}

function resolveModuleDir(): string {
  const importMetaUrl = readImportMetaUrl();
  return importMetaUrl ? dirname(fileURLToPath(importMetaUrl)) : process.cwd();
}

function readImportMetaUrl(): string | undefined {
  try {
    return (0, eval)('import.meta.url') as string;
  } catch {
    return undefined;
  }
}
