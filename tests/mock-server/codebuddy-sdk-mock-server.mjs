import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';

const parsePort = (rawPort) => {
  const parsed = Number(rawPort);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`[codebuddy-mock] invalid MOCK_SERVER_PORT: "${rawPort}" (expected integer 1-65535)`);
  }
  return parsed;
};

const PORT = parsePort(process.env.MOCK_SERVER_PORT || '3001');
const HOST = process.env.MOCK_SERVER_HOST || '127.0.0.1';
const MAX_INJECTED_MOCKS = 100;
const injectedMocks = [];
const MCP_SERVER_TOOLS_PATH_RE = /^\/(?:v1\/)?mcp\/servers\/[^/]+\/tools$/;
const MCP_SERVER_NAME = 'studio-tools';
const MCP_TOOL_DEFS = [
  { name: 'create_handoff', description: 'Create agent handoff task' },
  { name: 'submit_proposal', description: 'Submit proposal document' },
  { name: 'submit_game', description: 'Submit game build result' },
  { name: 'save_memory', description: 'Save long-term memory' }
];

const withCors = (headers = {}) => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  ...headers
});

const sendJson = (res, statusCode, body, headers = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, withCors({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...headers
  }));
  res.end(payload);
};

const sendSse = (res, events, status = 200, headers = {}) => {
  res.writeHead(status, withCors({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...headers
  }));
  for (const event of events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
};

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    if (chunks.length === 0) return resolve(undefined);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return resolve(undefined);
    try {
      resolve(JSON.parse(raw));
    } catch (error) {
      reject(error);
    }
  });
  req.on('error', reject);
});

const resolveInjectedMock = (method, pathname) => {
  const idx = injectedMocks.findIndex(mock => mock.method === method && mock.path === pathname);
  if (idx < 0) return null;
  const mock = injectedMocks[idx];
  if (mock.once) injectedMocks.splice(idx, 1);
  return mock;
};

const sendInjectedMock = async (res, mock) => {
  if (mock.sse) {
    const events = Array.isArray(mock.body) ? mock.body : [mock.body ?? {}];
    return sendSse(res, events, mock.status || 200, mock.headers || {});
  }
  return sendJson(res, mock.status || 200, mock.body ?? {}, mock.headers || {});
};

const buildMcpTools = (availableToolNames = []) => MCP_TOOL_DEFS.map((tool) => {
  const toolName = availableToolNames.find((name) =>
    name === tool.name ||
    name.endsWith(`__${tool.name}`)
  ) || tool.name;
  return {
    name: toolName,
    description: tool.description,
    input_schema: { type: 'object', properties: {} }
  };
});

const listToolNamesFromRequest = (body) => (
  Array.isArray(body?.tools)
    ? body.tools
      .map((tool) => tool?.function?.name)
      .filter((name) => typeof name === 'string')
    : []
);

const resolveToolName = (toolName, availableTools) => (
  availableTools.find((name) => name === toolName || name.endsWith(`__${toolName}`))
  || toolName
);

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Log all incoming requests for debugging
  console.log(`[codebuddy-mock] ${method} ${pathname}`);

  if (method === 'OPTIONS') {
    res.writeHead(200, withCors());
    res.end();
    return;
  }

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { status: 'ok', service: 'codebuddy-sdk-mock' });
  }

  // Handle authentication endpoints - return mock success
  if ((pathname === '/v1/auth/verify' || pathname === '/auth/verify') && method === 'POST') {
    return sendJson(res, 200, { 
      success: true, 
      user: { 
        id: 'mock-user-id', 
        name: 'Mock User',
        email: 'mock@example.com'
      }
    });
  }

  // Handle token refresh
  if ((pathname === '/v1/auth/refresh' || pathname === '/auth/refresh') && method === 'POST') {
    return sendJson(res, 200, { 
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600
    });
  }

  // Handle account info
  if ((pathname === '/v1/account' || pathname === '/account') && method === 'GET') {
    return sendJson(res, 200, { 
      userId: 'mock-user-id',
      userName: 'Mock User',
      userNickname: 'Mock',
      token: 'mock-token',
      enterpriseId: 'mock-enterprise',
      enterprise: 'Mock Enterprise'
    });
  }

  if (pathname === '/__admin/reset' && method === 'POST') {
    injectedMocks.splice(0, injectedMocks.length);
    return sendJson(res, 200, { success: true });
  }

  if (pathname === '/__admin/mocks' && method === 'GET') {
    return sendJson(res, 200, { mocks: injectedMocks });
  }

  if (pathname === '/__admin/mocks' && method === 'DELETE') {
    injectedMocks.splice(0, injectedMocks.length);
    return sendJson(res, 200, { success: true });
  }

  if (pathname.startsWith('/__admin/mocks/') && method === 'DELETE') {
    const id = pathname.replace('/__admin/mocks/', '');
    const idx = injectedMocks.findIndex(item => item.id === id);
    if (idx < 0) return sendJson(res, 404, { error: 'mock not found' });
    injectedMocks.splice(idx, 1);
    return sendJson(res, 200, { success: true });
  }

  if (pathname === '/__admin/mocks' && method === 'POST') {
    try {
      const body = await readBody(req);
      if (!body || typeof body.path !== 'string') {
        return sendJson(res, 400, { error: 'path is required' });
      }
      if (injectedMocks.length >= MAX_INJECTED_MOCKS) {
        return sendJson(res, 400, { error: `mock limit exceeded (${MAX_INJECTED_MOCKS})` });
      }
      const mock = {
        id: randomUUID(),
        method: String(body.method || 'GET').toUpperCase(),
        path: body.path,
        status: Number(body.status || 200),
        body: body.body ?? {},
        headers: typeof body.headers === 'object' && body.headers ? body.headers : {},
        once: !!body.once,
        sse: !!body.sse
      };
      injectedMocks.push(mock);
      return sendJson(res, 201, { mock });
    } catch (error) {
      return sendJson(res, 400, { error: `failed to parse mock request body: ${error?.message || 'invalid JSON body'}` });
    }
  }

  const injected = resolveInjectedMock(method, pathname);
  if (injected) return sendInjectedMock(res, injected);

  if (pathname === '/models' && method === 'GET') {
    return sendJson(res, 200, {
      object: 'list',
      data: [
        { id: 'codebuddy-mock', object: 'model', owned_by: 'mock' }
      ]
    });
  }

  if ((pathname === '/mcp/servers' || pathname === '/v1/mcp/servers') && method === 'GET') {
    return sendJson(res, 200, {
      servers: [{
        id: MCP_SERVER_NAME,
        name: MCP_SERVER_NAME,
        status: 'connected',
        tools: buildMcpTools()
      }]
    });
  }

  if ((pathname === '/mcp/servers/tools' || pathname === '/v1/mcp/servers/tools') && method === 'GET') {
    return sendJson(res, 200, {
      server: MCP_SERVER_NAME,
      tools: buildMcpTools()
    });
  }

  if (MCP_SERVER_TOOLS_PATH_RE.test(pathname) && method === 'GET') {
    return sendJson(res, 200, {
      server: MCP_SERVER_NAME,
      tools: buildMcpTools()
    });
  }

  if (pathname === '/chat/completions' && method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    const stream = body?.stream;
    const availableTools = listToolNamesFromRequest(body);
    const messages = body?.messages || [];
    const lastMessage = messages[messages.length - 1];
    const prompt = lastMessage?.content || '';
    const systemPrompt = messages.find(m => m.role === 'system')?.content || '';

    // Determine agent role from system prompt
    let agentRole = 'unknown';
    if (systemPrompt.includes('游戏策划')) agentRole = 'game_designer';
    else if (systemPrompt.includes('软件工程师')) agentRole = 'engineer';
    else if (systemPrompt.includes('架构师')) agentRole = 'architect';
    else if (systemPrompt.includes('CEO')) agentRole = 'ceo';
    else if (systemPrompt.includes('商业策划')) agentRole = 'biz_designer';

    // Determine mock response based on prompt content
    let responseContent = stream ? 'mock-stream' : 'mock-response';
    let toolCalls = null;

    // Default: always return create_handoff for task completion simulation
    // This allows the agent to automatically create handoffs without manual UI interaction
    const handoffTargets = {
      game_designer: 'ceo',
      ceo: 'architect',
      architect: 'engineer',
      engineer: 'biz_designer',
      biz_designer: 'ceo'
    };
    const targetAgent = handoffTargets[agentRole] || 'ceo';

    // Extract text content from prompt (handle both string and array formats)
    const promptText = typeof prompt === 'string' ? prompt :
      Array.isArray(prompt) ? prompt.map(p => typeof p === 'string' ? p : (p?.text || '')).join(' ') : String(prompt || '');

    // Check for specific tool call triggers in the prompt first
    if (promptText.includes('submit_proposal') || promptText.includes('提案')) {
        toolCalls = [{
          id: 'call_mock_proposal_' + randomUUID().slice(0, 8),
          type: 'function',
          function: {
            name: resolveToolName('submit_proposal', availableTools),
            arguments: JSON.stringify({
              type: 'game_design',
              title: '测试游戏策划案',
              content: '# 游戏策划案\n\n这是一个测试策划案内容'
            })
          }
        }];
      } else if (promptText.includes('submit_game') || promptText.includes('提交游戏')) {
        toolCalls = [{
          id: 'call_mock_game_' + randomUUID().slice(0, 8),
          type: 'function',
          function: {
            name: resolveToolName('submit_game', availableTools),
            arguments: JSON.stringify({
              name: '测试游戏',
              html: '<html><body><h1>测试游戏</h1></body></html>'
            })
          }
        }];
      } else if (promptText.includes('save_memory') || promptText.includes('记忆')) {
        toolCalls = [{
          id: 'call_mock_memory_' + randomUUID().slice(0, 8),
          type: 'function',
          function: {
            name: resolveToolName('save_memory', availableTools),
            arguments: JSON.stringify({
              category: 'general',
              content: '测试记忆内容',
              importance: 'normal'
            })
          }
        }];
      } else {
        // Default behavior: return create_handoff to simulate task completion
        // This ensures agents automatically create handoffs without manual UI interaction
        toolCalls = [{
          id: 'call_mock_handoff_' + randomUUID().slice(0, 8),
          type: 'function',
          function: {
            name: resolveToolName('create_handoff', availableTools),
            arguments: JSON.stringify({
              to_agent_id: targetAgent,
              title: `${agentRole} 任务完成交接`,
              description: `任务已完成，移交给 ${targetAgent} 继续处理`,
              priority: 'high'
            })
          }
        }];
      }

    if (stream) {
      const events = [];
      // Send initial assistant message with role
      events.push({
        id: 'chatcmpl-mock',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { role: 'assistant', content: '我来帮您处理这个任务。' } }]
      });

      // Send tool calls if triggered - use proper OpenAI streaming format
      if (toolCalls) {
        for (let i = 0; i < toolCalls.length; i++) {
          const toolCall = toolCalls[i];
          // First chunk: tool_calls array with index
          events.push({
            id: 'chatcmpl-mock',
            object: 'chat.completion.chunk',
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: i,
                  id: toolCall.id,
                  type: toolCall.type,
                  function: {
                    name: toolCall.function.name,
                    arguments: ''
                  }
                }]
              }
            }]
          });
          // Second chunk: arguments
          events.push({
            id: 'chatcmpl-mock',
            object: 'chat.completion.chunk',
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: i,
                  function: {
                    arguments: toolCall.function.arguments
                  }
                }]
              }
            }]
          });
        }
      }

      // Send final content
      events.push({
        id: 'chatcmpl-mock',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: '\n\n任务已完成。' } }]
      });

      // Send finish_reason
      events.push({
        id: 'chatcmpl-mock',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: toolCalls ? 'tool_calls' : 'stop' }]
      });

      return sendSse(res, events);
    }

    // Non-streaming response
    const response = {
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: toolCalls ? '我来帮您处理这个任务。\n\n任务已完成。' : responseContent,
          tool_calls: toolCalls
        },
        finish_reason: toolCalls ? 'tool_calls' : 'stop'
      }]
    };
    return sendJson(res, 200, response);
  }

  // Log unhandled requests for debugging
  console.log(`[codebuddy-mock] Unhandled request: ${method} ${pathname}`);
  console.log(`[codebuddy-mock] Headers:`, JSON.stringify(req.headers));
  
  // For unhandled routes, return 200 with empty success response for auth-related paths
  // to prevent 401 errors from breaking the CLI flow
  if (pathname.includes('auth') || pathname.includes('login') || pathname.includes('token')) {
    return sendJson(res, 200, { success: true, mock: true });
  }
  
  return sendJson(res, 404, { error: `mock route not found: ${method} ${pathname}` });
});

server.listen(PORT, HOST, () => {
  console.log(`[codebuddy-mock] SDK mock API server listening on http://${HOST}:${PORT}`);
  console.log(`[codebuddy-mock] Available endpoints:`);
  console.log(`  - GET  /api/health`);
  console.log(`  - GET  /models`);
  console.log(`  - POST /chat/completions`);
  console.log(`  - POST /__admin/mocks`);
  console.log(`  - POST /__admin/reset`);
});
