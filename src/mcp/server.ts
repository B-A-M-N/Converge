import { handleLoopCreate, handleLoopList, handleLoopDelete, handleLoopPause, handleLoopResume, handleLoopRunNow, handleLoopLogs, handleLoopDoctor } from './tools';

const tools = [
  {
    name: 'loop_create',
    description: 'Schedule a recurring agent task',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        interval: { type: 'string' },
        stopCondition: { type: 'object' },
        cli: { type: 'string' }
      },
      required: ['task', 'interval']
    }
  },
  {
    name: 'loop_list',
    description: 'List all recurring agent tasks',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'loop_delete',
    description: 'Delete a job (soft delete, preserve runs)',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    }
  },
  {
    name: 'loop_pause',
    description: 'Pause a job (non-destructive to current run)',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    }
  },
  {
    name: 'loop_resume',
    description: 'Resume a paused job',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    }
  },
  {
    name: 'loop_run_now',
    description: 'Force a job to run immediately',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    }
  },
  {
    name: 'loop_logs',
    description: 'Show run history for a job',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    }
  },
  {
    name: 'loop_doctor',
    description: 'Run active health probe',
    inputSchema: { type: 'object', properties: {} }
  }
];

export async function startMcpServer() {
  process.stdin.on('data', async (data) => {
    try {
      const request = JSON.parse(data.toString());
      if (request.method === 'initialize') {
        respond(request.id, { capabilities: { tools: {} }, serverInfo: { name: 'agent-loop-mcp', version: '0.1.0' } });
      } else if (request.method === 'tools/list') {
        respond(request.id, { tools });
      } else if (request.method === 'tools/call') {
        const { name, arguments: args } = request.params;
        let result;
        if (name === 'loop_create') result = await handleLoopCreate(args);
        else if (name === 'loop_list') result = await handleLoopList();
        else if (name === 'loop_delete') result = await handleLoopDelete(args);
        else if (name === 'loop_pause') result = await handleLoopPause(args);
        else if (name === 'loop_resume') result = await handleLoopResume(args);
        else if (name === 'loop_run_now') result = await handleLoopRunNow(args);
        else if (name === 'loop_logs') result = await handleLoopLogs(args);
        else if (name === 'loop_doctor') result = await handleLoopDoctor();
        else throw new Error('Unknown tool');

        respond(request.id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
      }
    } catch (e: any) {
      console.error('MCP Error:', e.message);
    }
  });
}

function respond(id: string | number, result: any) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

if (require.main === module) {
  startMcpServer();
}
