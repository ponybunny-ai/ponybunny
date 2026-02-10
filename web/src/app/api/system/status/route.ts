import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function GET() {
  try {
    // Execute pb service status
    // We assume 'pb' is in the PATH or we can run it from the project root
    // Since we are in web/src/app/api/..., the project root is ../../../../../
    // But let's try 'pb' first as it's likely installed or aliased
    
    // If pb is not found, we might need to use the absolute path to the dist/cli
    // For now, let's try to run a simple check.
    
    // Actually, since we are in a dev environment, we can try to run the CLI directly
    // But for safety and simplicity, let's assume the user has set up the environment
    // as per README (pb init, etc.)
    
    const { stdout, stderr } = await execAsync('pb service status');
    
    if (stderr) {
      console.warn('pb service status stderr:', stderr);
    }

    // Parse the output
    // Output format is typically:
    // Service    Status    PID
    // gateway    running   1234
    // scheduler  stopped   -
    
    const lines = stdout.split('\n').filter(line => line.trim());
    const services = [];
    
    for (const line of lines) {
      if (line.startsWith('Service') || line.startsWith('-------')) continue;
      
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        services.push({
          name: parts[0],
          status: parts[1],
          pid: parts[2] !== '-' ? parts[2] : null
        });
      }
    }

    return NextResponse.json({ services });
  } catch (error) {
    console.error('Failed to get service status:', error);
    return NextResponse.json(
      { error: 'Failed to get service status', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
