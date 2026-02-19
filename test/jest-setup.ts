import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

process.env.PONYBUNNY_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'pb-jest-'));
