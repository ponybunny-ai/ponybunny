#!/usr/bin/env node

import * as fs from 'node:fs';

function parseArgs(argv) {
  const args = {
    before: '',
    after: '',
    out: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--before' && typeof value === 'string') {
      args.before = value;
      i += 1;
      continue;
    }
    if (key === '--after' && typeof value === 'string') {
      args.after = value;
      i += 1;
      continue;
    }
    if (key === '--out' && typeof value === 'string') {
      args.out = value;
      i += 1;
    }
  }

  if (args.before.length === 0 || args.after.length === 0) {
    throw new Error('Usage: node scripts/refine/compare-rollout-baseline.mjs --before <before.json> --after <after.json> [--out <file.md>]');
  }

  return args;
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function extractSessionFirstMetrics(doc) {
  const direct = doc?.metrics?.sessionFirst;
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const nested = doc?.runtimeRollout?.metrics?.sessionFirst;
  if (nested && typeof nested === 'object') {
    return nested;
  }

  throw new Error('Cannot find metrics.sessionFirst or runtimeRollout.metrics.sessionFirst in input JSON');
}

function toPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function buildComparison(before, after) {
  const beforeMetrics = extractSessionFirstMetrics(before);
  const afterMetrics = extractSessionFirstMetrics(after);

  const beforeConversationRate = Number(beforeMetrics.conversationMessageSuccessRate ?? 0);
  const afterConversationRate = Number(afterMetrics.conversationMessageSuccessRate ?? 0);
  const beforeRunRate = Number(beforeMetrics.runSuccessRate ?? 0);
  const afterRunRate = Number(afterMetrics.runSuccessRate ?? 0);

  return {
    generatedAt: Date.now(),
    before: {
      conversationMessageSuccessRate: beforeConversationRate,
      runSuccessRate: beforeRunRate,
    },
    after: {
      conversationMessageSuccessRate: afterConversationRate,
      runSuccessRate: afterRunRate,
    },
    delta: {
      conversationMessageSuccessRate: afterConversationRate - beforeConversationRate,
      runSuccessRate: afterRunRate - beforeRunRate,
    },
    nonRegression: {
      conversationMessageSuccessRate: afterConversationRate >= beforeConversationRate,
      runSuccessRate: afterRunRate >= beforeRunRate,
    },
  };
}

function toMarkdown(result) {
  return [
    '# Migration Baseline Comparison',
    '',
    '| Metric | Before | After | Delta | Non-regression |',
    '| --- | --- | --- | --- | --- |',
    `| conversationMessageSuccessRate | ${toPercent(result.before.conversationMessageSuccessRate)} | ${toPercent(result.after.conversationMessageSuccessRate)} | ${toPercent(result.delta.conversationMessageSuccessRate)} | ${result.nonRegression.conversationMessageSuccessRate ? 'pass' : 'fail'} |`,
    `| runSuccessRate | ${toPercent(result.before.runSuccessRate)} | ${toPercent(result.after.runSuccessRate)} | ${toPercent(result.delta.runSuccessRate)} | ${result.nonRegression.runSuccessRate ? 'pass' : 'fail'} |`,
    '',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const before = readJson(args.before);
  const after = readJson(args.after);
  const result = buildComparison(before, after);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (args.out.length > 0) {
    fs.writeFileSync(args.out, `${toMarkdown(result)}\n`, 'utf-8');
  }

  if (!result.nonRegression.conversationMessageSuccessRate || !result.nonRegression.runSuccessRate) {
    process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`[compare-rollout-baseline] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
