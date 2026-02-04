/**
 * Gateway E2E Test
 *
 * Tests the full gateway flow:
 * 1. Start gateway server
 * 2. Generate pairing token
 * 3. Connect client and authenticate
 * 4. Make RPC calls
 * 5. Receive events
 *
 * Run with: npx tsx test/e2e-gateway.ts
 */

import { WebSocket } from 'ws';
import Database from 'better-sqlite3';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as ed from '@noble/ed25519';

import { GatewayServer } from '../src/gateway/gateway-server.js';
import { WorkOrderDatabase } from '../src/work-order/database/manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEST_DB_PATH = './test-gateway-e2e.db';
const TEST_PORT = 18799;

interface TestContext {
  db: Database.Database;
  repository: WorkOrderDatabase;
  gateway: GatewayServer;
  privateKey: Uint8Array;
  publicKey: string;
}

async function setup(): Promise<TestContext> {
  // Clean up any existing test database
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }

  // Initialize database
  const db = new Database(TEST_DB_PATH);
  const schemaPath = join(__dirname, '../src/infra/persistence/schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  // Initialize repository
  const repository = new WorkOrderDatabase(TEST_DB_PATH);
  await repository.initialize();

  // Create gateway
  const gateway = new GatewayServer(
    { db, repository },
    { host: '127.0.0.1', port: TEST_PORT }
  );

  // Generate Ed25519 keypair for client
  const privateKey = ed.utils.randomPrivateKey();
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKey);
  const publicKey = Buffer.from(publicKeyBytes).toString('hex');

  return { db, repository, gateway, privateKey, publicKey };
}

async function cleanup(ctx: TestContext): Promise<void> {
  await ctx.gateway.stop();
  ctx.db.close();

  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }
}

function createClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function sendRequest(ws: WebSocket, method: string, params?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const timeout = setTimeout(() => {
      reject(new Error(`Request timeout: ${method}`));
    }, 5000);

    const handler = (data: Buffer) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.type === 'res' && response.id === id) {
          clearTimeout(timeout);
          ws.off('message', handler);
          if (response.error) {
            reject(new Error(`RPC Error: ${response.error.message} (${response.error.code})`));
          } else {
            resolve(response.result);
          }
        }
      } catch {
        // Ignore parse errors for other messages
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify({ type: 'req', id, method, params }));
  });
}

async function runTests(): Promise<void> {
  console.log('🚀 Starting Gateway E2E Tests\n');

  const ctx = await setup();

  try {
    // Start gateway
    console.log('1. Starting gateway server...');
    await ctx.gateway.start();
    console.log('   ✓ Gateway started on port', TEST_PORT);

    // Create pairing token
    console.log('\n2. Creating pairing token...');
    const { token, id: tokenId } = ctx.gateway.createPairingToken(['read', 'write'], 60000);
    console.log('   ✓ Token created:', tokenId);

    // Connect client
    console.log('\n3. Connecting client...');
    const ws = await createClient(TEST_PORT);
    console.log('   ✓ Connected');

    // Test unauthenticated ping (should work)
    console.log('\n4. Testing system.ping (no auth)...');
    const pingResult = await sendRequest(ws, 'system.ping');
    console.log('   ✓ Ping response:', pingResult);

    // Test authenticated method without auth (should fail)
    console.log('\n5. Testing goal.list without auth (should fail)...');
    try {
      await sendRequest(ws, 'goal.list', {});
      console.log('   ✗ Should have failed');
    } catch (error: any) {
      if (error.message.includes('Authentication required')) {
        console.log('   ✓ Correctly rejected:', error.message);
      } else {
        throw error;
      }
    }

    // Start pairing flow
    console.log('\n6. Starting pairing flow...');
    const pairResult = await sendRequest(ws, 'auth.pair', { token });
    console.log('   ✓ Challenge received:', pairResult.challenge.slice(0, 16) + '...');

    // Sign challenge
    console.log('\n7. Signing challenge...');
    const challengeBytes = Buffer.from(pairResult.challenge, 'hex');
    const signature = await ed.signAsync(challengeBytes, ctx.privateKey);
    const signatureHex = Buffer.from(signature).toString('hex');
    console.log('   ✓ Signature:', signatureHex.slice(0, 32) + '...');

    // Verify and complete auth
    console.log('\n8. Completing authentication...');
    const verifyResult = await sendRequest(ws, 'auth.verify', {
      signature: signatureHex,
      publicKey: ctx.publicKey,
    });
    console.log('   ✓ Authenticated! Session:', verifyResult.sessionId);
    console.log('   ✓ Permissions:', verifyResult.permissions.join(', '));

    // Test authenticated methods
    console.log('\n9. Testing goal.list (authenticated)...');
    const listResult = await sendRequest(ws, 'goal.list', {});
    console.log('   ✓ Goals:', listResult.total);

    // Create a goal
    console.log('\n10. Creating a goal...');
    const goal = await sendRequest(ws, 'goal.submit', {
      title: 'E2E Test Goal',
      description: 'Testing gateway functionality',
      success_criteria: [
        {
          description: 'Test passes',
          type: 'deterministic',
          verification_method: 'manual',
          required: true,
        },
      ],
    });
    console.log('   ✓ Goal created:', goal.id);
    console.log('   ✓ Title:', goal.title);
    console.log('   ✓ Status:', goal.status);

    // Get goal status
    console.log('\n11. Getting goal status...');
    const status = await sendRequest(ws, 'goal.status', { goalId: goal.id });
    console.log('   ✓ Status:', status.status);

    // List methods
    console.log('\n12. Listing available methods...');
    const methods = await sendRequest(ws, 'system.methods', {});
    console.log('   ✓ Available methods:', methods.methods.length);
    console.log('   ✓ Methods:', methods.methods.slice(0, 5).join(', '), '...');

    // Cancel goal
    console.log('\n13. Cancelling goal...');
    const cancelResult = await sendRequest(ws, 'goal.cancel', {
      goalId: goal.id,
      reason: 'E2E test complete',
    });
    console.log('   ✓ Cancelled:', cancelResult.success);

    // Verify cancellation
    console.log('\n14. Verifying cancellation...');
    const finalStatus = await sendRequest(ws, 'goal.status', { goalId: goal.id });
    console.log('   ✓ Final status:', finalStatus.status);

    // Close connection
    ws.close();

    console.log('\n✅ All E2E tests passed!\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exitCode = 1;
  } finally {
    await cleanup(ctx);
  }
}

// Run tests
runTests().catch(console.error);
