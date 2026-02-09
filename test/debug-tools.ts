import { getGlobalToolProvider } from '../src/infra/tools/tool-provider.js';

const toolProvider = getGlobalToolProvider();
const tools = toolProvider.getToolDefinitions();
const conversationTools = tools.filter(tool =>
  ['web_search', 'find_skills'].includes(tool.name)
);

console.log('All tools:', tools.length);
console.log('Conversation tools:', conversationTools.length);
console.log('\nTool definitions:');
console.log(JSON.stringify(conversationTools, null, 2));
