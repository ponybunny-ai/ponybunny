import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { service, action } = body;

    if (!service || !action) {
      return NextResponse.json({ error: 'Service and action are required' }, { status: 400 });
    }

    const validServices = ['all', 'gateway', 'scheduler'];
    const validActions = ['start', 'stop', 'restart'];

    if (!validServices.includes(service)) {
      return NextResponse.json({ error: 'Invalid service' }, { status: 400 });
    }

    if (!validActions.includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Execute command
    const command = `pb service ${action} ${service}`;
    console.log(`Executing: ${command}`);
    
    const { stdout, stderr } = await execAsync(command);
    
    if (stderr) {
      console.warn('Command stderr:', stderr);
    }

    return NextResponse.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Failed to execute control command:', error);
    return NextResponse.json(
      { error: 'Failed to execute command', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
