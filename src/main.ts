import { AutonomyDaemon } from './autonomy/daemon.js';
import { WorkOrderDatabase } from './work-order/database/manager.js';

const DB_PATH = process.env.PONY_DB_PATH || './pony-work-orders.db';

async function main() {
  const daemon = new AutonomyDaemon({
    dbPath: DB_PATH,
    maxConcurrentRuns: 2,
    pollingIntervalMs: 5000,
    maxConsecutiveErrors: 3,
  });

  process.on('SIGINT', () => {
    console.log('\n[PonyBunny] Shutting down gracefully...');
    daemon.stop();
    process.exit(0);
  });

  console.log('[PonyBunny] Autonomy Daemon starting...');
  console.log(`[PonyBunny] Database: ${DB_PATH}`);
  
  await daemon.start();
}

main().catch(error => {
  console.error('[PonyBunny] Fatal error:', error);
  process.exit(1);
});
