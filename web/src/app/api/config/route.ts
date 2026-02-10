import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.ponybunny');

const ALLOWED_FILES = [
  'credentials.json',
  'llm-config.json',
  'mcp-config.json'
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get('file');

  if (!file || !ALLOWED_FILES.includes(file)) {
    return NextResponse.json({ error: 'Invalid file requested' }, { status: 400 });
  }

  try {
    const filePath = path.join(CONFIG_DIR, file);
    const content = await fs.readFile(filePath, 'utf-8');
    return NextResponse.json({ content: JSON.parse(content) });
  } catch (error) {
    console.error(`Failed to read config file ${file}:`, error);
    // If file doesn't exist, return empty object or specific error
    if ((error as any).code === 'ENOENT') {
       return NextResponse.json({ content: {} });
    }
    return NextResponse.json(
      { error: 'Failed to read config file' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { file, content } = body;

    if (!file || !ALLOWED_FILES.includes(file)) {
      return NextResponse.json({ error: 'Invalid file' }, { status: 400 });
    }

    if (typeof content !== 'object') {
      return NextResponse.json({ error: 'Content must be a JSON object' }, { status: 400 });
    }

    const filePath = path.join(CONFIG_DIR, file);
    await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf-8');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to save config file:', error);
    return NextResponse.json(
      { error: 'Failed to save config file' },
      { status: 500 }
    );
  }
}
