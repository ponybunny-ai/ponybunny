#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const sourceFormula = path.resolve('packaging/homebrew/pb.rb');
const targetFormula = path.resolve('packaging/homebrew/tap-template/Formula/pb.rb');

if (!fs.existsSync(sourceFormula)) {
  console.error(`Source formula not found: ${sourceFormula}`);
  process.exit(1);
}

const targetDir = path.dirname(targetFormula);
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

fs.copyFileSync(sourceFormula, targetFormula);
console.log(`Synced formula to ${targetFormula}`);
