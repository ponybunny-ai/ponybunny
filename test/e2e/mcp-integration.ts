/**
 * MCP Integration Test
 * Tests the full MCP integration with a real filesystem server
 */

import { MCPClient } from '../../src/infra/mcp/client/mcp-client.js';
import { getMCPConnectionManager, initializeMCPConnectionManager } from '../../src/infra/mcp/index.js';
import { ToolRegistry } from '../../src/infra/tools/tool-registry.js';
import { registerMCPTools } from '../../src/infra/mcp/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function testMCPClient() {
  console.log('🧪 Test 1: MCP Client Connection\n');

  const client = new MCPClient({
    serverName: 'test-filesystem',
    config: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
      allowedTools: ['*'],
      timeout: 30000,
    },
  });

  try {
    console.log('  ⏳ Connecting to MCP server...');
    await client.connect();
    console.log('  ✅ Connected successfully');

    const serverInfo = client.getServerInfo();
    console.log(`  📋 Server: ${serverInfo?.name} v${serverInfo?.version}`);
    console.log(`  📋 Protocol: ${serverInfo?.protocolVersion}`);

    console.log('\n  ⏳ Listing tools...');
    const tools = await client.listTools();
    console.log(`  ✅ Found ${tools.length} tools:`);
    tools.forEach((tool) => {
      console.log(`     - ${tool.name}: ${tool.description}`);
    });

    // Test tool execution
    console.log('\n  ⏳ Testing tool execution (read package.json)...');
    const result = await client.callTool('read_file', {
      path: 'package.json',
    });
    console.log('  ✅ Tool executed successfully');
    console.log(`  📄 Result preview: ${result.content[0].text?.substring(0, 100)}...`);

    await client.disconnect();
    console.log('  ✅ Disconnected\n');

    return true;
  } catch (error) {
    console.error('  ❌ Test failed:', (error as Error).message);
    await client.disconnect();
    return false;
  }
}

async function testConnectionManager() {
  console.log('🧪 Test 2: Connection Manager\n');

  // Use a temp directory to avoid overwriting real ~/.ponybunny/mcp-config.json
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponybunny-test-'));
  const configPath = path.join(configDir, 'mcp-config.json');

  // Create test config in temp directory
  const testConfig = {
    mcpServers: {
      'test-fs': {
        enabled: true,
        transport: 'stdio' as const,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
        allowedTools: ['*'],
        autoReconnect: true,
        timeout: 30000,
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));

  // Override config dir so the loader reads from temp directory
  process.env.PONYBUNNY_CONFIG_DIR = configDir;

  try {
    console.log('  ⏳ Initializing connection manager...');
    const manager = await initializeMCPConnectionManager();
    console.log('  ✅ Connection manager initialized');

    const connectedServers = manager.getConnectedServers();
    console.log(`  ✅ Connected servers: ${connectedServers.join(', ')}`);

    console.log('\n  ⏳ Listing all tools from all servers...');
    const toolsMap = await manager.listAllTools();
    let totalTools = 0;
    for (const [serverName, tools] of toolsMap.entries()) {
      console.log(`  📋 ${serverName}: ${tools.length} tools`);
      totalTools += tools.length;
    }
    console.log(`  ✅ Total tools: ${totalTools}`);

    console.log('\n  ⏳ Testing tool execution through manager...');
    const result = await manager.callTool('test-fs', 'read_file', {
      path: 'package.json',
    });
    console.log('  ✅ Tool executed successfully through manager');

    await manager.disconnectAll();
    console.log('  ✅ All connections closed\n');

    return true;
  } catch (error) {
    console.error('  ❌ Test failed:', (error as Error).message);
    return false;
  } finally {
    // Clean up temp directory
    delete process.env.PONYBUNNY_CONFIG_DIR;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
}

async function testToolRegistryIntegration() {
  console.log('🧪 Test 3: Tool Registry Integration\n');

  // Use a temp directory to avoid overwriting real ~/.ponybunny/mcp-config.json
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponybunny-test-'));
  const configPath = path.join(configDir, 'mcp-config.json');

  // Create test config in temp directory
  const testConfig = {
    mcpServers: {
      'test-fs': {
        enabled: true,
        transport: 'stdio' as const,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
        allowedTools: ['read_file', 'write_file'],
        autoReconnect: true,
        timeout: 30000,
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));

  // Override config dir so the loader reads from temp directory
  process.env.PONYBUNNY_CONFIG_DIR = configDir;

  try {
    console.log('  ⏳ Creating tool registry...');
    const registry = new ToolRegistry();

    console.log('  ⏳ Initializing connection manager...');
    await initializeMCPConnectionManager();

    console.log('  ⏳ Registering MCP tools...');
    await registerMCPTools(registry);

    const allTools = registry.getAllTools();
    console.log(`  ✅ Registered ${allTools.length} tools in registry`);

    const mcpTools = allTools.filter((t) => t.name.startsWith('mcp__'));
    console.log(`  ✅ MCP tools: ${mcpTools.length}`);
    mcpTools.forEach((tool) => {
      console.log(`     - ${tool.name}`);
      console.log(`       Category: ${tool.category}, Risk: ${tool.riskLevel}`);
    });

    // Test tool execution through registry
    console.log('\n  ⏳ Testing tool execution through registry...');
    const readTool = registry.getTool('mcp__test-fs__read_file');
    if (readTool) {
      const result = await readTool.execute(
        { path: 'package.json' },
        {
          cwd: process.cwd(),
          allowlist: { isAllowed: () => true } as any,
          enforcer: {} as any,
        }
      );
      console.log('  ✅ Tool executed successfully through registry');
      console.log(`  📄 Result preview: ${result.substring(0, 100)}...`);
    } else {
      console.error('  ❌ Tool not found in registry');
    }

    const manager = getMCPConnectionManager();
    await manager.disconnectAll();
    console.log('  ✅ Test completed\n');

    return true;
  } catch (error) {
    console.error('  ❌ Test failed:', (error as Error).message);
    console.error((error as Error).stack);
    return false;
  } finally {
    // Clean up temp directory
    delete process.env.PONYBUNNY_CONFIG_DIR;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
}

async function runAllTests() {
  console.log('🚀 MCP Integration Test Suite\n');
  console.log('=' .repeat(60) + '\n');

  const results = {
    client: false,
    manager: false,
    registry: false,
  };

  results.client = await testMCPClient();
  console.log('=' .repeat(60) + '\n');

  results.manager = await testConnectionManager();
  console.log('=' .repeat(60) + '\n');

  results.registry = await testToolRegistryIntegration();
  console.log('=' .repeat(60) + '\n');

  // Summary
  console.log('📊 Test Summary\n');
  console.log(`  Test 1 (MCP Client):           ${results.client ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Test 2 (Connection Manager):   ${results.manager ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Test 3 (Registry Integration): ${results.registry ? '✅ PASS' : '❌ FAIL'}`);

  const allPassed = results.client && results.manager && results.registry;
  console.log(`\n${allPassed ? '✅ All tests passed!' : '❌ Some tests failed'}\n`);

  process.exit(allPassed ? 0 : 1);
}

runAllTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
