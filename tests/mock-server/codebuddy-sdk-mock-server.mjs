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

// ─── Per-agent Expectation Queues ───
// Key: "${projectId}:${agentRole}"  (e.g. "ui007_xxx:engineer")
// Value: array of expectation objects
// This enables precise routing per-agent, eliminating FIFO cross-agent interference.
const expectationQueues = new Map();

/**
 * Parse identity from HTTP headers injected by agent-manager (per-request env).
 * Node.js HTTP headers are lowercased by default.
 */
const parseIdentity = (req) => {
  const projectId = (req.headers['x-project-id'] || '').trim();
  const agentRole = (req.headers['x-agent-role'] || '').trim();
  return { projectId, agentRole };
};

/**
 * Get or create the queue for a specific (projectId, agentRole).
 * Also tracks per-agent call index (how many requests this agent has made).
 */
const getQueue = (projectId, agentRole) => {
  const key = `${projectId}:${agentRole}`;
  if (!expectationQueues.has(key)) {
    expectationQueues.set(key, {
      expectations: [],   // ordered array of {id, matcher, response}
      callIndex: 0         // how many requests this agent has made
    });
  }
  return expectationQueues.get(key);
};

/**
 * Match and consume the next expectation for a given (projectId, agentRole).
 * Returns the matched response object or null.
 *
 * Matching strategy:
 * 1. Look at the front of the agent's queue
 * 2. If it has a custom matcher, check it (for future extension)
 * 3. Otherwise, always match (FIFO)
 * 4. Consume and return
 *
 * If no expectations are queued for this agent → return null (default plain text)
 */
const matchExpectation = (projectId, agentRole) => {
  const queue = getQueue(projectId, agentRole);
  if (queue.expectations.length === 0) {
    // No expectations for this agent — this is fine, e.g. unexpected background calls
    return null;
  }

  const exp = queue.expectations.shift();
  queue.callIndex++;
  console.error(`[mock-debug] ${projectId}:${agentRole} consumed exp #${queue.callIndex}, remaining=${queue.expectations.length} for this agent`);
  return exp.response;
};

// ─── CORS helpers ───
const withCors = (headers = {}) => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Project-Id,X-Agent-Role',
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

// ─── Tool name resolution ───
const listToolNamesFromRequest = (body) => (
  Array.isArray(body?.tools)
    ? body.tools
      .map((tool) => {
        if (typeof tool?.function?.name === 'string') return tool.function.name;
        if (typeof tool?.name === 'string') return tool.name;
        return null;
      })
      .filter((name) => typeof name === 'string')
    : []
);

const resolveToolName = (toolName, availableTools) => (
  availableTools.find((name) => name === toolName || name.endsWith(`__${toolName}`))
  || toolName
);

// ─── Response builders ───
const buildToolCallResponse = (toolName, toolArgs, availableTools, stream) => {
  const callId = `call_mock_${toolName}_${randomUUID().slice(0, 8)}`;
  const resolvedName = resolveToolName(toolName, availableTools);
  const argsJson = typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs || {});

  if (stream) {
    const events = [
      { id: 'chatcmpl-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
      {
        id: 'chatcmpl-mock', object: 'chat.completion.chunk', choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: resolvedName, arguments: '' } }] }
        }]
      },
      {
        id: 'chatcmpl-mock', object: 'chat.completion.chunk', choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: argsJson } }] }
        }]
      },
      { id: 'chatcmpl-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '\n' } }] },
      { id: 'chatcmpl-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ];
    return events;
  }

  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: '', tool_calls: [{ id: callId, type: 'function', function: { name: resolvedName, arguments: argsJson } }] },
      finish_reason: 'tool_calls'
    }]
  };
};

const buildTextResponse = (text, stream) => {
  if (stream) {
    return [
      { id: 'chatcmpl-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: text } }] },
      { id: 'chatcmpl-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ];
  }
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }]
  };
};

// ─── HTTP Server ───
const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  console.log(`[codebuddy-mock] ${method} ${pathname}`);

  if (method === 'OPTIONS') {
    res.writeHead(200, withCors());
    res.end();
    return;
  }

  // ─── Health check ───
  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { status: 'ok', service: 'codebuddy-sdk-mock' });
  }

  // ─── Auth stubs ───
  if ((pathname === '/v1/auth/verify' || pathname === '/auth/verify') && method === 'POST') {
    return sendJson(res, 200, { success: true, user: { id: 'mock-user-id', name: 'Mock User', email: 'mock@example.com' } });
  }
  if ((pathname === '/v1/auth/refresh' || pathname === '/auth/refresh') && method === 'POST') {
    return sendJson(res, 200, { access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', expires_in: 3600 });
  }
  if ((pathname === '/v1/account' || pathname === '/account') && method === 'GET') {
    return sendJson(res, 200, { userId: 'mock-user-id', userName: 'Mock User', token: 'mock-token' });
  }

  // ─── Admin: Reset all state ───
  if (pathname === '/__admin/reset' && method === 'POST') {
    expectationQueues.clear();
    return sendJson(res, 200, { success: true });
  }

  // ─── Admin: List all queues ───
  if (pathname === '/__admin/expectations' && method === 'GET') {
    const summary = {};
    for (const [key, val] of expectationQueues.entries()) {
      summary[key] = { remaining: val.expectations.length, callIndex: val.callIndex };
    }
    return sendJson(res, 200, { queues: summary });
  }

  // ─── Expectation API: Test-driven mock control ───
  // POST /mock/expect — register an expectation for a specific (projectId, agentRole)
  // The test sets what the mock should return for a given agent BEFORE triggering it.
  if (pathname === '/mock/expect' && method === 'POST') {
    try {
      const body = await readBody(req);
      const { projectId, agentRole, matcher, response } = body || {};

      if (!response || typeof response !== 'object') {
        return sendJson(res, 400, { error: 'response object is required' });
      }
      if (!projectId || !agentRole) {
        return sendJson(res, 400, { error: 'projectId and agentRole are required' });
      }

      const key = `${projectId}:${agentRole}`;
      const queue = getQueue(projectId, agentRole);
      const expectation = {
        id: randomUUID(),
        matcher: matcher || {},      // optional matching criteria (reserved)
        response                     // the response to return when this agent calls
      };
      queue.expectations.push(expectation);

      console.error(`[mock-debug] queued for ${key}: id=${expectation.id}, queue_depth=${queue.expectations.length}`);
      return sendJson(res, 201, { expectation: { id: expectation.id, queueSize: queue.expectations.length, agent: key } });
    } catch (error) {
      return sendJson(res, 400, { error: `failed to parse expectation: ${error?.message}` });
    }
  }

  // ─── Models list ───
  if (pathname === '/models' && method === 'GET') {
    return sendJson(res, 200, { object: 'list', data: [{ id: 'codebuddy-mock', object: 'model', owned_by: 'mock' }] });
  }

  // ─── Chat completions (core mock endpoint) ───
  if (pathname === '/chat/completions' && method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    const stream = !!body?.stream;
    const availableTools = listToolNamesFromRequest(body);

    // Extract identity from per-request HTTP headers
    const { projectId, agentRole } = parseIdentity(req);
    const hasIdentity = !!(projectId && agentRole);

    console.error(`[mock-debug] /chat/completions identity=${projectId || '?'}:${agentRole || '?'} tools=${availableTools.length} hasIdentity=${hasIdentity}`);

    // Route by (projectId, agentRole) — precise per-agent queue
    if (hasIdentity) {
      const expected = matchExpectation(projectId, agentRole);

      if (expected) {
        // Build response from expectation
        if (expected.toolCalls && Array.isArray(expected.toolCalls)) {
          if (stream) {
            const events = [{ id: 'chatcmpl-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: expected.content || '' } }] }];
            for (let i = 0; i < expected.toolCalls.length; i++) {
              const tc = expected.toolCalls[i];
              const resolvedName = resolveToolName(tc.name, availableTools);
              const argsJson = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {});
              const callId = tc.id || `call_mock_${tc.name}_${randomUUID().slice(0, 8)}`;
              events.push({ id: 'chatcmpl-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: callId, type: 'function', function: { name: resolvedName, arguments: '' } }] } }] });
              events.push({ id: 'chatcmpl-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: argsJson } }] } }] });
            }
            events.push({ id: 'chatcmpl-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: expected.content || '\n' } }] });
            events.push({ id: 'chatcmpl-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
            return sendSse(res, events);
          }
          const calls = expected.toolCalls.map(tc => ({
            id: tc.id || `call_mock_${tc.name}_${randomUUID().slice(0, 8)}`,
            type: 'function',
            function: { name: resolveToolName(tc.name, availableTools), arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {}) }
          }));
          return sendJson(res, 200, {
            id: 'chatcmpl-mock', object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: expected.content || '', tool_calls: calls }, finish_reason: 'tool_calls' }]
          });
        }

        // Plain text response
        const text = expected.content || (stream ? 'mock-stream' : 'mock-response');
        if (stream) return sendSse(res, buildTextResponse(text, true));
        return sendJson(res, 200, buildTextResponse(text, false));
      }

      // Agent has no queued expectations → return default text
      // This handles unexpected background calls gracefully
      console.error(`[mock-debug] NO expectation for ${projectId}:${agentRole} → default text`);
      const defaultContent = '任务已完成。';
      if (stream) return sendSse(res, buildTextResponse(defaultContent, true));
      return sendJson(res, 200, buildTextResponse(defaultContent, false));
    }

    // No identity headers → fallback to plain text (handles legacy/non-agent calls)
    console.error(`[mock-debug] NO identity headers → returning default text`);
    const defaultContent = '任务已完成。';
    if (stream) return sendSse(res, buildTextResponse(defaultContent, true));
    return sendJson(res, 200, buildTextResponse(defaultContent, false));
  }

  // ─── Fallback for unhandled routes ───
  console.log(`[codebuddy-mock] Unhandled: ${method} ${pathname}`);
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
  console.log(`  - POST /mock/expect       ← per-agent test-driven mock (projectId+agentRole routing)`);
  console.log(`  - GET  /__admin/expectations`);
  console.log(`  - POST /__admin/reset`);
});
