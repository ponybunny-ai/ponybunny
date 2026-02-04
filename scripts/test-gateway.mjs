#!/usr/bin/env node

/**
 * Gateway API 完整测试脚本
 * 使用方法: node scripts/test-gateway.mjs [port] [db-path]
 */

import { WebSocket } from 'ws';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// 配置 ed25519 使用 sha512
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const PORT = process.argv[2] || '18789';
const DB_PATH = process.argv[3] || './pony.db';
const WS_URL = `ws://127.0.0.1:${PORT}`;

// 颜色
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const GRAY = '\x1b[90m';
const NC = '\x1b[0m';

let passed = 0;
let failed = 0;

function log(msg) {
    console.log(msg);
}

function logTest(name, success, detail = '') {
    if (success) {
        console.log(`  ${GREEN}✓${NC} ${name}${detail ? ` ${GRAY}${detail}${NC}` : ''}`);
        passed++;
    } else {
        console.log(`  ${RED}✗${NC} ${name}${detail ? ` ${GRAY}${detail}${NC}` : ''}`);
        failed++;
    }
}

function createWebSocketClient() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Connection timeout'));
        }, 5000);

        ws.on('open', () => {
            clearTimeout(timeout);
            resolve(ws);
        });

        ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

function sendRequest(ws, method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const timeout = setTimeout(() => {
            reject(new Error('Request timeout'));
        }, 5000);

        const handler = (data) => {
            try {
                const response = JSON.parse(data.toString());
                if (response.id === id) {
                    clearTimeout(timeout);
                    ws.off('message', handler);
                    if (response.error) {
                        const err = new Error(response.error.message);
                        err.code = response.error.code;
                        reject(err);
                    } else {
                        resolve(response.result);
                    }
                }
            } catch (e) {
                // ignore parse errors
            }
        };

        ws.on('message', handler);

        const request = { type: 'req', id, method };
        if (Object.keys(params).length > 0) {
            request.params = params;
        }
        ws.send(JSON.stringify(request));
    });
}

async function testPublicMethods(ws) {
    log('');
    log(`${BLUE}[1/4] 测试公开方法（无需认证）${NC}`);
    log('');

    // system.ping
    try {
        const result = await sendRequest(ws, 'system.ping');
        logTest('system.ping', result.pong === true, `timestamp: ${result.timestamp}`);
    } catch (err) {
        logTest('system.ping', false, err.message);
    }

    // system.info
    try {
        const result = await sendRequest(ws, 'system.info');
        logTest('system.info', result.name && result.version, `${result.name} v${result.version}`);
    } catch (err) {
        logTest('system.info', false, err.message);
    }
}

async function testAuthProtection(ws) {
    log('');
    log(`${BLUE}[2/4] 测试认证保护（应返回 -32001 错误）${NC}`);
    log('');

    const protectedMethods = [
        ['goal.submit', { title: 'test' }],
        ['goal.list', {}],
        ['goal.status', { goalId: 'test' }],
        ['workitem.list', {}],
    ];

    for (const [method, params] of protectedMethods) {
        try {
            await sendRequest(ws, method, params);
            logTest(`${method} (无认证)`, false, '应该返回错误');
        } catch (err) {
            logTest(`${method} (无认证)`, err.code === -32001, `code: ${err.code}`);
        }
    }
}

async function testAuthFlow() {
    log('');
    log(`${BLUE}[3/4] 测试认证流程${NC}`);
    log('');

    // 生成配对令牌
    let token;
    try {
        const cliPath = join(PROJECT_ROOT, 'dist/cli/index.js');
        const output = execSync(`node "${cliPath}" gateway pair -d "${DB_PATH}" --permissions read,write,admin 2>&1`, {
            encoding: 'utf-8',
            cwd: PROJECT_ROOT,
        });
        const match = output.match(/Token:\s+(\S+)/);
        if (match) {
            token = match[1];
            logTest('生成配对令牌', true, `${token.slice(0, 16)}...`);
        } else {
            logTest('生成配对令牌', false, '无法解析令牌');
            return null;
        }
    } catch (err) {
        logTest('生成配对令牌', false, err.message);
        return null;
    }

    // 创建新连接进行认证
    let ws;
    try {
        ws = await createWebSocketClient();
    } catch (err) {
        logTest('创建 WebSocket 连接', false, err.message);
        return null;
    }

    // 生成密钥对
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    const publicKeyHex = Buffer.from(publicKey).toString('hex');

    // auth.pair
    let challenge;
    try {
        const result = await sendRequest(ws, 'auth.pair', { token });
        challenge = result.challenge;
        logTest('auth.pair', !!challenge, `challenge: ${challenge.slice(0, 16)}...`);
    } catch (err) {
        logTest('auth.pair', false, err.message);
        ws.close();
        return null;
    }

    // auth.verify
    try {
        const challengeBytes = Buffer.from(challenge, 'hex');
        const signature = await ed.signAsync(challengeBytes, privateKey);
        const signatureHex = Buffer.from(signature).toString('hex');

        const result = await sendRequest(ws, 'auth.verify', {
            signature: signatureHex,
            publicKey: publicKeyHex,
        });

        logTest('auth.verify', result.success === true, `session: ${result.sessionId.slice(0, 8)}...`);
        return ws; // 返回已认证的连接
    } catch (err) {
        logTest('auth.verify', false, err.message);
        ws.close();
        return null;
    }
}

async function testAuthenticatedMethods(ws) {
    log('');
    log(`${BLUE}[4/4] 测试认证后的 RPC 方法${NC}`);
    log('');

    let goalId;

    // goal.submit
    try {
        const result = await sendRequest(ws, 'goal.submit', {
            title: 'Test Goal',
            description: 'This is a test goal from the test script',
            success_criteria: 'Test passes successfully',
        });
        goalId = result.id;  // Goal object has 'id' not 'goalId'
        logTest('goal.submit', !!goalId, `goalId: ${goalId.slice(0, 8)}...`);
    } catch (err) {
        logTest('goal.submit', false, err.message);
    }

    // goal.list
    try {
        const result = await sendRequest(ws, 'goal.list', {});
        logTest('goal.list', Array.isArray(result.goals), `count: ${result.goals.length}`);
    } catch (err) {
        logTest('goal.list', false, err.message);
    }

    // goal.status
    if (goalId) {
        try {
            const result = await sendRequest(ws, 'goal.status', { goalId });
            // goal.status returns the Goal object directly
            logTest('goal.status', result.id === goalId, `status: ${result.status}`);
        } catch (err) {
            logTest('goal.status', false, err.message);
        }
    }

    // workitem.list
    try {
        const result = await sendRequest(ws, 'workitem.list', {});
        logTest('workitem.list', Array.isArray(result.workItems), `count: ${result.workItems.length}`);
    } catch (err) {
        logTest('workitem.list', false, err.message);
    }

    // goal.subscribe
    if (goalId) {
        try {
            const result = await sendRequest(ws, 'goal.subscribe', { goalId });
            logTest('goal.subscribe', result.success === true);
        } catch (err) {
            logTest('goal.subscribe', false, err.message);
        }
    }

    // goal.cancel
    if (goalId) {
        try {
            const result = await sendRequest(ws, 'goal.cancel', { goalId });
            logTest('goal.cancel', result.success === true);
        } catch (err) {
            logTest('goal.cancel', false, err.message);
        }
    }

    // escalation.list (可能为空)
    try {
        const result = await sendRequest(ws, 'escalation.list', {});
        logTest('escalation.list', Array.isArray(result.escalations), `count: ${result.escalations.length}`);
    } catch (err) {
        logTest('escalation.list', false, err.message);
    }

    // approval.list (可能为空)
    try {
        const result = await sendRequest(ws, 'approval.list', {});
        logTest('approval.list', Array.isArray(result.approvals), `count: ${result.approvals.length}`);
    } catch (err) {
        logTest('approval.list', false, err.message);
    }
}

async function main() {
    log(`${BLUE}========================================${NC}`);
    log(`${BLUE}   PonyBunny Gateway API 测试${NC}`);
    log(`${BLUE}========================================${NC}`);
    log('');
    log(`目标: ${YELLOW}${WS_URL}${NC}`);
    log(`数据库: ${GRAY}${DB_PATH}${NC}`);

    // 检查连接
    log('');
    log(`${BLUE}[0/4] 检查 Gateway 连接${NC}`);
    log('');

    let ws;
    try {
        ws = await createWebSocketClient();
        logTest('WebSocket 连接', true);
    } catch (err) {
        logTest('WebSocket 连接', false, err.message);
        log('');
        log(`${RED}错误: 无法连接到 Gateway${NC}`);
        log('');
        log('请先启动 Gateway:');
        log(`  pb gateway start --port ${PORT}`);
        process.exit(1);
    }

    // 测试公开方法
    await testPublicMethods(ws);
    ws.close();

    // 测试认证保护
    ws = await createWebSocketClient();
    await testAuthProtection(ws);
    ws.close();

    // 测试认证流程
    const authWs = await testAuthFlow();

    // 测试认证后的方法
    if (authWs) {
        await testAuthenticatedMethods(authWs);
        authWs.close();
    }

    // 结果
    log('');
    log(`${BLUE}========================================${NC}`);
    log(`${BLUE}   测试完成${NC}`);
    log(`${BLUE}========================================${NC}`);
    log('');
    log(`  通过: ${GREEN}${passed}${NC}`);
    log(`  失败: ${RED}${failed}${NC}`);
    log('');

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error(`${RED}Fatal error: ${err.message}${NC}`);
    process.exit(1);
});
