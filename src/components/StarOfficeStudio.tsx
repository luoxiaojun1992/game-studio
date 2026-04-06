import React, { useEffect, useRef, useState } from 'react';
import { Agent, Handoff, LogEntry, TaskBoardTask } from '../types';

const STAR_OFFICE_UI_URL = import.meta.env.VITE_STAR_OFFICE_UI_URL || 'http://127.0.0.1:19000';
const LOAD_TIMEOUT_MS = 10000;
const STAR_OFFICE_SET_STATE_URL = import.meta.env.VITE_STAR_OFFICE_SET_STATE_URL || '';
const STAR_OFFICE_AGENT_PUSH_URL = import.meta.env.VITE_STAR_OFFICE_AGENT_PUSH_URL || '';

function isTrustedSameOriginUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl, window.location.origin);
    if (url.origin === window.location.origin) return true;
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

interface StarOfficeStudioProps {
  projectId: string;
  agents: Agent[];
  handoffs?: Handoff[];
  tasks?: TaskBoardTask[];
  logs?: LogEntry[];
}

function safeTargetOrigin(rawUrl: string): string {
  try {
    return new URL(rawUrl, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
}

function buildBridgeState(
  projectId: string,
  agents: Agent[],
  handoffs: Handoff[],
  tasks: TaskBoardTask[],
  logs: LogEntry[],
) {
  const now = new Date().toISOString();
  const latestAgentLogMap = new Map<string, LogEntry>();
  logs.forEach((log) => {
    const prev = latestAgentLogMap.get(log.agent_id);
    if (!prev || new Date(prev.created_at).getTime() < new Date(log.created_at).getTime()) {
      latestAgentLogMap.set(log.agent_id, log);
    }
  });

  return {
    source: 'game-studio',
    projectId,
    timestamp: now,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      title: agent.title,
      status: agent.state?.status || 'idle',
      isPaused: !!agent.state?.isPaused,
      currentTask: agent.state?.currentTask || null,
      lastMessage: agent.state?.lastMessage || latestAgentLogMap.get(agent.id)?.content || null,
      lastActiveAt: agent.state?.lastActiveAt || latestAgentLogMap.get(agent.id)?.created_at || null,
    })),
    counters: {
      workingAgents: agents.filter((a) => a.state?.status === 'working').length,
      pendingHandoffs: handoffs.filter((h) => h.status === 'pending').length,
      activeTasks: tasks.filter((t) => ['todo', 'developing', 'testing', 'blocked'].includes(t.status)).length,
    },
  };
}

export default function StarOfficeStudio({ projectId, agents, handoffs = [], tasks = [], logs = [] }: StarOfficeStudioProps) {
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const latestStateRef = useRef<ReturnType<typeof buildBridgeState> | null>(null);
  const allowSameOrigin = isTrustedSameOriginUrl(STAR_OFFICE_UI_URL);
  const sandboxValue = allowSameOrigin
    ? 'allow-scripts allow-same-origin allow-forms allow-popups'
    : 'allow-scripts allow-forms allow-popups';
  const isInsecureRemoteHttp = (() => {
    try {
      const parsed = new URL(STAR_OFFICE_UI_URL, window.location.origin);
      const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || parsed.hostname.endsWith('.localhost');
      return parsed.protocol === 'http:' && !isLocal;
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    setLoadFailed(false);
    setLoaded(false);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setLoadFailed(true);
    }, LOAD_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (loaded && timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setLoadFailed(false);
    }
  }, [loaded]);

  const pushStateToBridge = React.useCallback(async (state: ReturnType<typeof buildBridgeState>) => {
    const iframeWindow = iframeRef.current?.contentWindow;
    if (iframeWindow) {
      try {
        iframeWindow.postMessage(
          {
            type: 'game_studio_state_sync',
            event: 'set_state',
            payload: state,
          },
          safeTargetOrigin(STAR_OFFICE_UI_URL),
        );
      } catch {}
    }

    const setStateUrl = STAR_OFFICE_SET_STATE_URL || new URL('/set_state', STAR_OFFICE_UI_URL).toString();
    const agentPushUrl = STAR_OFFICE_AGENT_PUSH_URL || new URL('/agent-push', STAR_OFFICE_UI_URL).toString();
    await Promise.allSettled([
      fetch(setStateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      }),
      fetch(agentPushUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'game-studio',
          projectId: state.projectId,
          timestamp: state.timestamp,
          agents: state.agents,
        }),
      }),
    ]);
  }, []);

  useEffect(() => {
    const state = buildBridgeState(projectId, agents, handoffs, tasks, logs);
    latestStateRef.current = state;
    if (!loaded) return;
    void pushStateToBridge(state);
  }, [projectId, agents, handoffs, tasks, logs, loaded, pushStateToBridge]);

  return (
    <section className="space-y-3">
      <div className="bg-gray-900 rounded-xl border border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-blue-300 tracking-wider uppercase">Star-Office-UI</p>
            <h3 className="text-sm md:text-base text-white font-semibold">Studio（Real Integration）</h3>
          </div>
          <a
            href={STAR_OFFICE_UI_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] md:text-xs text-blue-400 hover:text-blue-300"
          >
            打开独立页面 ↗
          </a>
        </div>
      </div>
      <div className="relative bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {isInsecureRemoteHttp && (
          <div className="px-4 py-2 text-xs text-yellow-300 bg-yellow-950/30 border-b border-yellow-900/60">
            检测到非本地 HTTP 地址，生产环境建议使用 HTTPS：{STAR_OFFICE_UI_URL}
          </div>
        )}
        {!loaded && !loadFailed && (
          <div className="absolute top-2 left-2 pointer-events-none text-xs text-gray-400 px-2 py-1 bg-black/40 rounded">
            正在加载 Star-Office-UI...
          </div>
        )}
        {loadFailed ? (
          <div className="h-[76vh] min-h-[560px] flex items-center justify-center text-gray-300 text-sm px-6 text-center">
            Star-Office-UI 加载失败，请确认服务已启动并检查地址：{STAR_OFFICE_UI_URL}
          </div>
        ) : (
          <iframe
            title="Star-Office-UI"
            src={STAR_OFFICE_UI_URL}
            className="w-full h-[76vh] min-h-[560px] bg-black"
            referrerPolicy="no-referrer"
            sandbox={sandboxValue}
            ref={iframeRef}
            onLoad={() => {
              setLoaded(true);
              setLoadFailed(false);
              if (latestStateRef.current) {
                void pushStateToBridge(latestStateRef.current);
              }
            }}
          />
        )}
      </div>
    </section>
  );
}
