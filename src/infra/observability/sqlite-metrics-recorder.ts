/**
 * SQLiteMetricsRecorder — persists counters, gauges, and duration samples
 * to SQLite tables (metric_counters, metric_samples).
 *
 * Tables are created via migration v2 (metrics_tables) but this class also
 * runs CREATE IF NOT EXISTS in its constructor as a safety net.
 *
 * Prepared statements are cached for performance — all writes are
 * single-statement, no transactions needed.
 */

import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';
import type { IMetricsRecorder, MetricName } from './metrics.js';

function serializeLabels(labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return '{}';
  const sorted = Object.keys(labels).sort();
  const obj: Record<string, string> = {};
  for (const key of sorted) {
    obj[key] = labels[key];
  }
  return JSON.stringify(obj);
}

export class SQLiteMetricsRecorder implements IMetricsRecorder {
  private readonly stmtIncrement: Statement;
  private readonly stmtGauge: Statement;
  private readonly stmtSample: Statement;

  constructor(private readonly db: Database.Database) {
    this.ensureTables();

    this.stmtIncrement = db.prepare(`
      INSERT INTO metric_counters (name, labels, value, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(name, labels) DO UPDATE SET
        value = value + 1,
        updated_at = excluded.updated_at
    `);

    this.stmtGauge = db.prepare(`
      INSERT INTO metric_counters (name, labels, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(name, labels) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    this.stmtSample = db.prepare(`
      INSERT INTO metric_samples (name, labels, value, recorded_at)
      VALUES (?, ?, ?, ?)
    `);
  }

  increment(name: MetricName, labels?: Record<string, string>): void {
    this.stmtIncrement.run(name, serializeLabels(labels), Date.now());
  }

  recordDuration(name: MetricName, durationMs: number, labels?: Record<string, string>): void {
    this.stmtSample.run(name, serializeLabels(labels), durationMs, Date.now());
  }

  gauge(name: MetricName, value: number, labels?: Record<string, string>): void {
    this.stmtGauge.run(name, serializeLabels(labels), value, Date.now());
  }

  private ensureTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metric_counters (
        name       TEXT    NOT NULL,
        labels     TEXT    NOT NULL,
        value      REAL    NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (name, labels)
      );

      CREATE TABLE IF NOT EXISTS metric_samples (
        name        TEXT    NOT NULL,
        labels      TEXT    NOT NULL,
        value       REAL    NOT NULL,
        recorded_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_metric_samples_name
        ON metric_samples (name, recorded_at);
    `);
  }
}
