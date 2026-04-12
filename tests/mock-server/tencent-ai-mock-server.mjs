import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_SERVER_PORT || 3001);

const agents = [
  { id: 'engineer', name: 'Engineer', role: 'engineer', state: { id: 'engineer', status: 'idle', currentTask: null, lastMessage: null, lastActiveAt: null, isPaused: false } },
  { id: 'architect', name: 'Architect', role: 'architect', state: { id: 'architect', status: 'idle', currentTask: null, lastMessage: null, lastActiveAt: null, isPaused: false } },
  { id: 'game_designer', name: 'Game Designer', role: 'game_designer', state: { id: 'game_designer', status: 'idle', currentTask: null, lastMessage: null, lastActiveAt: null, isPaused: false } },
  { id: 'biz_designer', name: 'Business Designer', role: 'biz_designer', state: { id: 'biz_designer', status: 'idle', currentTask: null, lastMessage: null, lastActiveAt: null, isPaused: false } },
  { id: 'ceo', name: 'CEO', role: 'ceo', state: { id: 'ceo', status: 'idle', currentTask: null, lastMessage: null, lastActiveAt: null, isPaused: false } },
  { id: 'team_builder', name: 'Team Building', role: 'team_builder', state: { id: 'team_builder', status: 'idle', currentTask: null, lastMessage: null, lastActiveAt: null, isPaused: false } }
];

const initialData = () => ({
  projects: [{ id: 'default', name: 'default' }],
  settings: { default: { project_id: 'default', autopilot_enabled: false } }
});

let state = initialData();
const injectedMocks = [];

const sendJson = (res, statusCode, body, headers = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...headers
  });
  res.end(payload);
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

const matchPath = (configuredPath, pathname) => configuredPath === pathname;
const normalizeDelayMs = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed <= 0) return 0;
  return Math.min(parsed, 30_000);
};

const resolveInjectedMock = (method, pathname) => {
  const idx = injectedMocks.findIndex(mock => mock.method === method && matchPath(mock.path, pathname));
  if (idx < 0) return null;
  const mock = injectedMocks[idx];
  if (mock.once) {
    injectedMocks.splice(idx, 1);
  }
  return mock;
};

const sendInjectedMock = async (res, mock) => {
  const delayMs = normalizeDelayMs(mock.delayMs);
  if (delayMs > 0) {
    await new Promise(r => setTimeout(r, delayMs));
  }
  if (mock.sse) {
    res.writeHead(mock.status || 200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...(mock.headers || {})
    });
    const events = Array.isArray(mock.body) ? mock.body : [mock.body ?? { type: 'init', agents, proposals: [], games: [], logs: [], tasks: [], pendingPermissions: [], projectId: 'default' }];
    for (const item of events) {
      res.write(`data: ${JSON.stringify(item)}\n\n`);
    }
    return;
  }
  sendJson(res, mock.status || 200, mock.body ?? {}, mock.headers || {});
};

const writeSseInit = (req, res, projectId) => {
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  const initPayload = {
    type: 'init',
    projectId,
    agents: agents.map(a => a.state),
    proposals: [],
    games: [],
    logs: [],
    tasks: [],
    pendingPermissions: []
  };
  res.write(`data: ${JSON.stringify(initPayload)}\n\n`);
  const timer = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);
  const clearHeartbeat = () => clearInterval(timer);
  req.on('close', clearHeartbeat);
  res.on('close', clearHeartbeat);
  res.on('error', clearHeartbeat);
};

const normalizeProjectId = (value) => {
  if (typeof value !== 'string') return 'default';
  const trimmed = value.trim();
  return trimmed || 'default';
};

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  if (method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    });
    res.end();
    return;
  }

  if (pathname === '/__admin/mocks' && method === 'GET') {
    return sendJson(res, 200, { mocks: injectedMocks });
  }

  if (pathname === '/__admin/reset' && method === 'POST') {
    state = initialData();
    injectedMocks.splice(0, injectedMocks.length);
    return sendJson(res, 200, { success: true });
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
      const mock = {
        id: randomUUID(),
        method: String(body.method || 'GET').toUpperCase(),
        path: body.path,
        status: Number(body.status || 200),
        headers: body.headers || {},
        body: body.body,
        delayMs: normalizeDelayMs(body.delayMs),
        once: !!body.once,
        sse: !!body.sse
      };
      injectedMocks.push(mock);
      return sendJson(res, 201, { mock });
    } catch (error) {
      return sendJson(res, 400, { error: `invalid request body for mock injection: ${error?.message || 'unknown parse error'}` });
    }
  }

  const injected = resolveInjectedMock(method, pathname);
  if (injected) {
    return sendInjectedMock(res, injected);
  }

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
  }

  if (pathname === '/api/check-login' && method === 'GET') {
    return sendJson(res, 200, { isLoggedIn: true, userName: 'mock-user' });
  }

  if (pathname === '/api/models' && method === 'GET') {
    return sendJson(res, 200, { models: ['glm-5.0', 'hunyuan-lite'] });
  }

  if (pathname === '/api/agents' && method === 'GET') {
    return sendJson(res, 200, { agents });
  }

  if (pathname === '/api/projects' && method === 'GET') {
    return sendJson(res, 200, { projects: state.projects });
  }

  if (pathname === '/api/projects' && method === 'POST') {
    try {
      const body = await readBody(req);
      const id = normalizeProjectId(body?.id);
      const name = typeof body?.name === 'string' ? body.name : id;
      if (state.projects.some(p => p.id === id)) {
        return sendJson(res, 409, { error: 'project already exists' });
      }
      const project = { id, name };
      state.projects.push(project);
      state.settings[id] = { project_id: id, autopilot_enabled: false };
      return sendJson(res, 201, { project });
    } catch (error) {
      return sendJson(res, 400, { error: `invalid request body for project creation: ${error?.message || 'unknown parse error'}` });
    }
  }

  if (pathname === '/api/projects/switch' && method === 'POST') {
    return sendJson(res, 200, { success: true });
  }

  if (pathname.startsWith('/api/projects/') && pathname.endsWith('/settings') && method === 'GET') {
    const projectId = pathname.replace('/api/projects/', '').replace('/settings', '') || 'default';
    const settings = state.settings[projectId] || { project_id: projectId, autopilot_enabled: false };
    return sendJson(res, 200, { settings });
  }

  if (pathname.startsWith('/api/projects/') && pathname.endsWith('/settings') && method === 'PATCH') {
    const projectId = pathname.replace('/api/projects/', '').replace('/settings', '') || 'default';
    try {
      const body = await readBody(req);
      const current = state.settings[projectId] || { project_id: projectId, autopilot_enabled: false };
      const next = { ...current, autopilot_enabled: !!body?.autopilot_enabled };
      state.settings[projectId] = next;
      return sendJson(res, 200, { settings: next });
    } catch (error) {
      return sendJson(res, 400, { error: `invalid request body for project settings patch: ${error?.message || 'unknown parse error'}` });
    }
  }

  if (pathname === '/api/observe' && method === 'GET') {
    const projectId = normalizeProjectId(parsedUrl.searchParams.get('projectId'));
    writeSseInit(req, res, projectId);
    return;
  }

  return sendJson(res, 404, { error: `mock route not found: ${method} ${pathname}` });
});

server.listen(PORT, () => {
  console.log(`[mock-server] Tencent AI mock API server listening on http://0.0.0.0:${PORT}`);
});
