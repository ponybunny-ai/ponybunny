#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { get } from 'https';

function parseArgs(argv) {
  const args = {
    version: undefined,
    packageName: 'ponybunny',
    formulaPath: 'packaging/homebrew/pb.rb',
    sha256: undefined,
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--version' && argv[i + 1]) {
      args.version = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--package' && argv[i + 1]) {
      args.packageName = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--formula' && argv[i + 1]) {
      args.formulaPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--sha256' && argv[i + 1]) {
      args.sha256 = argv[i + 1];
      i += 1;
      continue;
    }
  }

  return args;
}

function getPackageVersion() {
  const packageJsonPath = path.resolve('package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  return packageJson.version;
}

function computeSha256(url) {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download tarball: HTTP ${response.statusCode}`));
        response.resume();
        return;
      }

      const hash = createHash('sha256');
      response.on('data', chunk => hash.update(chunk));
      response.on('end', () => resolve(hash.digest('hex')));
      response.on('error', reject);
    }).on('error', reject);
  });
}

function updateFormulaContent(content, tarballUrl, sha256) {
  const urlUpdated = content.replace(/^\s*url\s+".*"$/m, `  url "${tarballUrl}"`);
  const shaUpdated = urlUpdated.replace(/^\s*sha256\s+".*"$/m, `  sha256 "${sha256}"`);
  return shaUpdated;
}

async function main() {
  const args = parseArgs(process.argv);
  const version = args.version ?? getPackageVersion();
  const tarballUrl = `https://registry.npmjs.org/${args.packageName}/-/${args.packageName}-${version}.tgz`;
  const formulaPath = path.resolve(args.formulaPath);

  if (!fs.existsSync(formulaPath)) {
    throw new Error(`Formula not found: ${formulaPath}`);
  }

  const sha256 = args.sha256 ?? await computeSha256(tarballUrl);
  const original = fs.readFileSync(formulaPath, 'utf-8');
  const updated = updateFormulaContent(original, tarballUrl, sha256);

  if (args.dryRun) {
    console.log(`[dry-run] formula: ${formulaPath}`);
    console.log(`[dry-run] url: ${tarballUrl}`);
    console.log(`[dry-run] sha256: ${sha256}`);
    return;
  }

  fs.writeFileSync(formulaPath, updated, 'utf-8');
  console.log(`Updated ${formulaPath}`);
  console.log(`url: ${tarballUrl}`);
  console.log(`sha256: ${sha256}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
