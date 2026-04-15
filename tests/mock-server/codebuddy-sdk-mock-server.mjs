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
const CHAT_COMPLETION_PATHS = new Set(['/chat/completions', '/v1/chat/completions']);

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

const normalizeInjectedMockPath = (pathname) => (
  CHAT_COMPLETION_PATHS.has(pathname) ? '/chat/completions' : pathname
);

const resolveInjectedMock = (method, pathname) => {
  const normalizedPathname = normalizeInjectedMockPath(pathname);
  const idx = injectedMocks.findIndex(mock => (
    mock.method === method && normalizeInjectedMockPath(mock.path) === normalizedPathname
  ));
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

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  if (method === 'OPTIONS') {
    res.writeHead(200, withCors());
    res.end();
    return;
  }

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { status: 'ok', service: 'codebuddy-sdk-mock' });
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

  if (pathname === '/v1/models' && method === 'GET') {
    return sendJson(res, 200, {
      object: 'list',
      data: [
        { id: 'codebuddy-mock', object: 'model', owned_by: 'mock' }
      ]
    });
  }

  if ((pathname === '/v1/chat/completions' || pathname === '/chat/completions') && method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    const content = body?.stream ? 'mock-stream' : 'mock-response';
    if (body?.stream) {
      return sendSse(res, [
        { id: 'chatcmpl-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content } }] }
      ]);
    }
    return sendJson(res, 200, {
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
    });
  }

  return sendJson(res, 404, { error: `mock route not found: ${method} ${pathname}` });
});

server.listen(PORT, HOST, () => {
  console.log(`[codebuddy-mock] SDK mock API server listening on http://${HOST}:${PORT}`);
});
