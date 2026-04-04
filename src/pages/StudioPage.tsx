import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Agent, AgentRole, AgentState, Proposal, Game, LogEntry, SSEEvent, TabKey, PermissionRequest, Handoff, TaskBoardTask, ProjectInfo, ProjectSettings } from '../types';
import { api } from '../config';
import AgentCard from '../components/AgentCard';
import ProposalList from '../components/ProposalList';
import GameList from '../components/GameList';
import LogPanel from '../components/LogPanel';
import CommandPanel from '../components/CommandPanel';
import ProposalDetail from '../components/ProposalDetail';
import GamePreview from '../components/GamePreview';
import HandoffPanel from '../components/HandoffPanel';
import TaskBoardPanel from '../components/TaskBoardPanel';
import PixelAgentWorkspace from '../components/PixelAgentWorkspace';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'overview', label: '团队总览', icon: '🏠' },
  { key: 'pixel_studio', label: '像素协作', icon: '🕹️' },
  { key: 'proposals', label: '策划案', icon: '📋' },
  { key: 'tasks', label: '任务看板', icon: '🗂️' },
  { key: 'handoffs', label: '任务交接', icon: '🔄' },
  { key: 'settings', label: '配置中心', icon: '⚙️' },
  { key: 'games', label: '游戏成品', icon: '🎮' },
  { key: 'logs', label: '运行日志', icon: '📜' },
  { key: 'commands', label: '指令中心', icon: '⌨️' },
];
const DEFAULT_PROJECT_ID = 'default';

// 按项目隔离的 localStorage key
const getCommandAgentKey = (projectId: string) => `commandPanel_lastAgent_${projectId}`;

export default function StudioPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [tasks, setTasks] = useState<TaskBoardTask[]>([]);
  const [projectSettings, setProjectSettings] = useState<ProjectSettings>({ project_id: DEFAULT_PROJECT_ID, autopilot_enabled: false });
  const [projects, setProjects] = useState<ProjectInfo[]>([{ id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_ID }]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(DEFAULT_PROJECT_ID);
  const [newProjectName, setNewProjectName] = useState('');
  const [projectError, setProjectError] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [commandTargetAgent, setCommandTargetAgent] = useState<AgentRole | undefined>(undefined);
  const [commandModel, setCommandModel] = useState<string>('glm-5.0');
  const handleCommandModelChange = useCallback((model: string) => {
    setCommandModel(model);
  }, []);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // 初始化 SSE 观测连接
  // 注意：React.StrictMode 开发模式下 useEffect 会执行两次，
  // 通过标记位避免建立重复连接
  const connectedRef = useRef(false);

  const handleSSEEvent = useCallback((event: SSEEvent) => {
    switch (event.type) {
      case 'init':
        // 合并 Agent 定义和状态
        setAgents(prev => {
          if (prev.length === 0) return prev; // 等待 agents API
          return prev.map(agent => {
            const state = (event as any).agents?.find((s: AgentState) => s.id === agent.id);
            return state ? { ...agent, state } : agent;
          });
        });
        setProposals((event as any).proposals || []);
        setGames((event as any).games || []);
        setLogs((event as any).logs || []);
        setTasks((event as any).tasks || []);
        setPendingPermissions((event as any).pendingPermissions || []);
        break;

      case 'agent_status_changed':
        setAgents(prev => prev.map(agent =>
          agent.id === (event as any).agentId
            ? { ...agent, state: (event as any).state }
            : agent
        ));
        break;

      case 'stream_event': {
        const streamEvent = (event as any).event;
        if (streamEvent.type === 'permission_request') {
          setPendingPermissions(prev => [...prev, {
            requestId: streamEvent.requestId,
            toolName: streamEvent.toolName,
            input: streamEvent.input,
            agentId: streamEvent.agentId,
            timestamp: Date.now()
          }]);
        }
        // 实时更新 logs，让指令中心能显示最新聊天记录
        if (streamEvent.agentId && ['text', 'tool', 'tool_result', 'agent_done', 'agent_error'].includes(streamEvent.type)) {
          setLogs(prev => {
            const newLog: LogEntry = {
              id: streamEvent.id || String(Date.now()) + Math.random(),
              project_id: selectedProjectId,
              agent_id: streamEvent.agentId,
              log_type: streamEvent.type === 'agent_done' ? 'done' : streamEvent.type === 'agent_error' ? 'error' : streamEvent.type,
              level: streamEvent.type === 'agent_error' ? 'error' : streamEvent.isError ? 'error' : 'info',
              content: streamEvent.content || streamEvent.error || '',
              tool_name: streamEvent.name || null,
              action: null,
              is_error: !!streamEvent.isError || streamEvent.type === 'agent_error',
              created_at: new Date().toISOString()
            };
            return [...prev, newLog].slice(-1000);
          });
        }
        break;
      }

      case 'proposal_created':
      case 'proposal_decided':
      case 'proposal_reviewed':
        setProposals(prev => {
          const proposal = (event as any).proposal as Proposal;
          if (proposal.project_id !== selectedProjectId) return prev;
          const idx = prev.findIndex(p => p.id === proposal.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = proposal;
            return next;
          }
          return [proposal, ...prev];
        });
        break;

      case 'game_submitted':
      case 'game_updated':
        setGames(prev => {
          const game = (event as any).game as Game;
          if (game.project_id !== selectedProjectId) return prev;
          const idx = prev.findIndex(g => g.id === game.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = game;
            return next;
          }
          return [game, ...prev];
        });
        break;

      case 'handoff_created':
        setHandoffs(prev => [(event as any).handoff as Handoff, ...prev]);
        break;

      case 'handoff_updated':
        setHandoffs(prev => {
          const updated = (event as any).handoff as Handoff;
          const idx = prev.findIndex(h => h.id === updated.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = updated;
            return next;
          }
          return [updated, ...prev];
        });
        break;

      case 'task_created':
      case 'task_updated':
        setTasks(prev => {
          const task = (event as any).task as TaskBoardTask;
          if (task.project_id !== selectedProjectId) return prev;
          const idx = prev.findIndex(t => t.id === task.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = task;
            return next;
          }
          return [task, ...prev];
        });
        break;
    }
  }, [selectedProjectId]);

  const connectSSE = useCallback(() => {
    // 防止 StrictMode 重复连接
    if (connectedRef.current) return;
    connectedRef.current = true;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(api.observeUrl(selectedProjectId));
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
      connectedRef.current = false; // 允许重连
      setTimeout(connectSSE, 3000);
    };

    es.onmessage = (e) => {
      try {
        const event: SSEEvent = JSON.parse(e.data);
        handleSSEEvent(event);
      } catch {}
    };
  }, [handleSSEEvent, selectedProjectId]);

  // 加载 Agents
  useEffect(() => {
    api.getAgents(selectedProjectId).then(data => setAgents(data.agents || []));
  }, [selectedProjectId]);

  useEffect(() => {
    api.getProjectSettings(selectedProjectId).then(data => {
      if (data?.settings) setProjectSettings(data.settings);
    }).catch((error) => {
      console.error('加载项目配置失败', error);
    });
  }, [selectedProjectId]);

  useEffect(() => {
    api.getProjects().then(data => {
      const list = (data.projects || []) as ProjectInfo[];
      if (!list.find(p => p.id === DEFAULT_PROJECT_ID)) {
        list.unshift({ id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_ID });
      }
      setProjects(list);
    }).catch((error) => {
      console.error('加载项目列表失败', error);
    });
  }, []);

  useEffect(() => {
    setSelectedProposal(null);
    setSelectedGame(null);
  }, [selectedProjectId]);

  // agents 加载后 / 项目切换时，从 localStorage 读取保存的 Agent
  useEffect(() => {
    if (agents.length === 0) return;
    const saved = localStorage.getItem(getCommandAgentKey(selectedProjectId));
    if (saved && agents.find(a => a.id === saved)) {
      setCommandTargetAgent(saved as AgentRole);
    } else {
      setCommandTargetAgent(undefined);
    }
  }, [agents, selectedProjectId]);

  // 连接 SSE
  useEffect(() => {
    connectSSE();
    return () => {
      eventSourceRef.current?.close();
      connectedRef.current = false; // StrictMode cleanup 后允许重建连接
    };
  }, [connectSSE, selectedProjectId]);

  // 处理权限响应
  const handlePermissionResponse = async (requestId: string, behavior: 'allow' | 'deny', message?: string, updatedInput?: Record<string, unknown>) => {
    await api.respondPermission(requestId, behavior, message, selectedProjectId, updatedInput);
    setPendingPermissions(prev => prev.filter(p => p.requestId !== requestId));
  };

  // 暂停/恢复 Agent
  const handleTogglePause = async (agentId: AgentRole) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;
    if (agent.state.isPaused) {
      await api.resumeAgent(agentId, selectedProjectId);
    } else {
      await api.pauseAgent(agentId, selectedProjectId);
    }
    // 状态会通过 SSE 更新
  };

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name || creatingProject) return;
    setProjectError(null);
    setCreatingProject(true);
    try {
      const id = name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      if (!id) {
        setProjectError('项目名无效，请使用字母数字下划线或短横线。');
        return;
      }
      if (id === DEFAULT_PROJECT_ID) {
        setProjectError('不能创建与默认项目同名的项目。');
        return;
      }
      const data = await api.createProject({ id, name });
      if (data?.error) {
        setProjectError(data.error);
        return;
      }
      const project = data.project as ProjectInfo | undefined;
      if (project) {
        setProjects(prev => {
          if (prev.find(p => p.id === project.id)) return prev;
          return [...prev, project];
        });
        setSelectedProjectId(project.id);
      }
      setNewProjectName('');
    } finally {
      setCreatingProject(false);
    }
  };

  const handleToggleAutoHandoff = async (enabled: boolean) => {
    const data = await api.updateProjectSettings(selectedProjectId, { autopilot_enabled: enabled });
    if (data?.settings) {
      setProjectSettings(data.settings);
    }
  };

  // 审批提案
  const handleDecideProposal = async (proposalId: string, decision: 'approved' | 'rejected', comment: string) => {
    await api.decideProposal(proposalId, decision, comment);
    setSelectedProposal(null);
  };

  // 预览游戏
  const handlePreviewGame = (game: Game) => {
    setSelectedGame(game);
  };

  const pendingProposals = proposals.filter(p => p.status === 'pending_review' || p.status === 'under_review');
  const workingAgents = agents.filter(a => a.state?.status === 'working');
  const pendingHandoffs = handoffs.filter(h => h.status === 'pending');
  const activeTasks = tasks.filter(t => ['todo', 'developing', 'testing', 'blocked'].includes(t.status));

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* 顶部导航栏 */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎮</span>
          <div>
            <h1 className="text-lg font-bold text-white">Game Dev Studio</h1>
            <p className="text-xs text-gray-400">游戏开发 Agent 团队 · 观测控制台 · 项目 {selectedProjectId}</p>
          </div>
        </div>

        {/* 状态指示器 */}
        <div className="flex items-center gap-4">
          {pendingPermissions.length > 0 && (
            <div className="flex items-center gap-1.5 bg-orange-500/20 border border-orange-500/40 rounded-full px-3 py-1 text-xs text-orange-300 animate-pulse">
              <span>⚠️</span>
              <span>{pendingPermissions.length} 个待审批操作</span>
            </div>
          )}
          {pendingProposals.length > 0 && (
            <div className="flex items-center gap-1.5 bg-blue-500/20 border border-blue-500/40 rounded-full px-3 py-1 text-xs text-blue-300">
              <span>📋</span>
              <span>{pendingProposals.length} 个待审批方案</span>
            </div>
          )}
          {pendingHandoffs.length > 0 && (
            <div className="flex items-center gap-1.5 bg-purple-500/20 border border-purple-500/40 rounded-full px-3 py-1 text-xs text-purple-300 animate-pulse cursor-pointer" onClick={() => setActiveTab('handoffs')}>
              <span>🔄</span>
              <span>{pendingHandoffs.length} 个待接收交接</span>
            </div>
          )}
          {activeTasks.length > 0 && (
            <div className="flex items-center gap-1.5 bg-cyan-500/20 border border-cyan-500/40 rounded-full px-3 py-1 text-xs text-cyan-300 cursor-pointer" onClick={() => setActiveTab('tasks')}>
              <span>🗂️</span>
              <span>{activeTasks.length} 个看板任务进行中</span>
            </div>
          )}
          {workingAgents.length > 0 && (
            <div className="flex items-center gap-1.5 bg-green-500/20 border border-green-500/40 rounded-full px-3 py-1 text-xs text-green-300">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse inline-block" />
              <span>{workingAgents.length} 个 Agent 工作中</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">项目</span>
            <select
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200"
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              placeholder="新建项目名"
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200 w-28"
            />
            <button
              onClick={handleCreateProject}
              disabled={!newProjectName.trim() || creatingProject}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded px-2 py-1"
            >
              {creatingProject ? '创建中' : '新建'}
            </button>
            {projectError && (
              <span className="text-red-400">{projectError}</span>
            )}
          </div>
          <div className={`flex items-center gap-1.5 text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'} ${connected ? '' : 'animate-pulse'}`} />
            {connected ? '已连接' : '连接中...'}
          </div>
        </div>
      </header>

      {/* 权限请求悬浮通知 */}
      {pendingPermissions.length > 0 && (
        <div className="shrink-0 bg-orange-950/50 border-b border-orange-900/50 px-6 py-2">
          <div className="text-xs text-orange-300 font-medium mb-1">⚠️ 有 Agent 正在请求操作权限，需要您确认：</div>
          <div className="space-y-2">
            {pendingPermissions.map(perm => {
              const isAskUser = perm.toolName === 'AskUserQuestion';
              const question = perm.input?.question as string || '';
              const options = perm.input?.options as string[] | undefined;
              const singleSelect = !(perm.input?.multiSelect);

              return (
                <div key={perm.requestId} className={`rounded-lg px-4 py-2.5 border ${isAskUser ? 'bg-blue-900/40 border-blue-700/50' : 'bg-orange-900/40 border-orange-700/50'}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-orange-300 font-medium">{getAgentEmoji(perm.agentId)} {perm.agentId}</span>
                    <span className="text-gray-500">→</span>
                    <span className="text-white font-mono font-semibold">{perm.toolName}</span>
                  </div>

                  {isAskUser ? (
                    /* AskUserQuestion: 显示问题 + 输入框 */
                    <div>
                      {question && <div className="text-sm text-gray-200 mb-2">{question}</div>}
                      <AskUserQuestionForm
                        options={options}
                        singleSelect={singleSelect}
                        onReply={(answer) => handlePermissionResponse(perm.requestId, 'allow', undefined, { response: answer })}
                        onDeny={() => handlePermissionResponse(perm.requestId, 'deny')}
                      />
                    </div>
                  ) : (
                    /* 普通工具权限请求 */
                    <>
                      {perm.input && Object.keys(perm.input).length > 0 && (
                        <div className="bg-gray-900/60 rounded-md p-2 mb-2 font-mono text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto border border-gray-700/50">
                          {Object.entries(perm.input).map(([key, value]) => (
                            <div key={key}>
                              <span className="text-blue-400">{key}</span>
                              <span className="text-gray-500">: </span>
                              <span className="text-gray-200">{formatToolValue(value)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handlePermissionResponse(perm.requestId, 'allow')}
                          className="bg-green-600 hover:bg-green-500 text-white rounded px-3 py-1 text-xs font-medium transition-colors"
                        >
                          ✅ 允许执行
                        </button>
                        <button
                          onClick={() => handlePermissionResponse(perm.requestId, 'deny')}
                          className="bg-red-700 hover:bg-red-600 text-white rounded px-3 py-1 text-xs font-medium transition-colors"
                        >
                          ❌ 拒绝
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 标签导航 */}
      <nav className="shrink-0 flex items-center gap-1 px-6 py-2 bg-gray-900/50 border-b border-gray-800">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.key === 'proposals' && pendingProposals.length > 0 && (
              <span className="bg-blue-400 text-blue-900 text-xs rounded-full px-1.5 py-0.5 font-bold min-w-[18px] text-center">
                {pendingProposals.length}
              </span>
            )}
            {tab.key === 'handoffs' && pendingHandoffs.length > 0 && (
              <span className="bg-purple-400 text-purple-900 text-xs rounded-full px-1.5 py-0.5 font-bold min-w-[18px] text-center">
                {pendingHandoffs.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* 主内容区 */}
      <main className="flex-1 overflow-auto p-4">
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Agent 卡片网格 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {agents.map(agent => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onPauseToggle={() => handleTogglePause(agent.id)}
                  onSendCommand={() => {
                    setCommandTargetAgent(agent.id);
                    setActiveTab('commands');
                  }}
                  streamLog={logs.filter(l => l.agent_id === agent.id && l.log_type === 'text').slice(-1)[0] ? { agentId: agent.id, content: logs.filter(l => l.agent_id === agent.id && l.log_type === 'text').slice(-1)[0].content, time: logs.filter(l => l.agent_id === agent.id && l.log_type === 'text').slice(-1)[0].created_at } : undefined}
                  pendingHandoffs={pendingHandoffs}
                  activeHandoffs={handoffs.filter(h => ['pending', 'accepted', 'working'].includes(h.status))}
                />
              ))}
            </div>

            {/* 最新提案预览 */}
            {proposals.length > 0 && (
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-300">最新提案</h3>
                  <button onClick={() => setActiveTab('proposals')} className="text-xs text-blue-400 hover:text-blue-300">
                    查看全部 →
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {proposals.slice(0, 3).map(p => (
                    <div
                      key={p.id}
                      onClick={() => { setSelectedProposal(p); setActiveTab('proposals'); }}
                      className="bg-gray-800 hover:bg-gray-750 rounded-lg p-3 cursor-pointer border border-gray-700 hover:border-gray-600 transition-all"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <ProposalStatusBadge status={p.status} />
                        <span className="text-xs text-gray-500">{p.author_agent_id}</span>
                      </div>
                      <p className="text-sm text-gray-200 font-medium truncate">{p.title}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'pixel_studio' && (
          <div className="space-y-4">
            <PixelAgentWorkspace agents={agents} handoffs={handoffs} />
          </div>
        )}

        {activeTab === 'proposals' && (
          <div className="flex gap-4 h-full">
            <div className="w-80 shrink-0">
              <ProposalList
                proposals={proposals}
                selectedId={selectedProposal?.id}
                onSelect={setSelectedProposal}
              />
            </div>
            <div className="flex-1">
              {selectedProposal ? (
                <ProposalDetail
                  proposal={selectedProposal}
                  onDecide={handleDecideProposal}
                  onClose={() => setSelectedProposal(null)}
                />
              ) : (
                <div className="flex items-center justify-center h-64 text-gray-500">
                  <div className="text-center">
                    <div className="text-4xl mb-2">📋</div>
                    <p>选择一个提案查看详情</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'games' && (
          <div className="flex gap-4 h-full">
            <div className="w-80 shrink-0">
              <GameList
                games={games}
                selectedId={selectedGame?.id}
                onSelect={handlePreviewGame}
              />
            </div>
            <div className="flex-1">
              {selectedGame ? (
                <GamePreview game={selectedGame} onClose={() => setSelectedGame(null)} />
              ) : (
                <div className="flex items-center justify-center h-64 text-gray-500">
                  <div className="text-center">
                    <div className="text-4xl mb-2">🎮</div>
                    <p>选择一个游戏预览</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className={activeTab === 'logs' ? '' : 'hidden'}>
          <LogPanel logs={logs} agents={agents} projectId={selectedProjectId} />
        </div>

        {activeTab === 'handoffs' && (
          <HandoffPanel agents={agents} projectId={selectedProjectId} />
        )}

        {activeTab === 'tasks' && (
          <TaskBoardPanel
            agents={agents}
            tasks={tasks}
            projectId={selectedProjectId}
            onTaskUpdated={(task) => {
              setTasks(prev => {
                const idx = prev.findIndex(t => t.id === task.id);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = task;
                  return next;
                }
                return [task, ...prev];
              });
            }}
          />
        )}

        {activeTab === 'commands' && (
          <CommandPanel
            agents={agents}
            logs={logs}
            projectId={selectedProjectId}
            selectedAgentId={commandTargetAgent}
            model={commandModel}
            onModelChange={handleCommandModelChange}
            onCommandSent={() => {}}
            onAgentChange={(agentId) => {
              setCommandTargetAgent(agentId);
            }}
          />
        )}

        {activeTab === 'settings' && (
          <div className="max-w-2xl space-y-4">
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-1">配置中心</h3>
              <p className="text-xs text-gray-500 mb-4">当前项目：{selectedProjectId}</p>
              <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3">
                <div>
                  <div className="text-sm text-white font-medium">🤖 自动驾驶模式</div>
                  <div className="text-xs text-gray-400 mt-1">
                    开启后，所有工具调用（交接、提交方案、提交成品等）自动放行，无需手动审批。
                  </div>
                </div>
                <button
                  onClick={() => handleToggleAutoHandoff(!projectSettings.autopilot_enabled)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    projectSettings.autopilot_enabled
                      ? 'bg-green-600/20 text-green-300 border-green-600/40 hover:bg-green-600/30'
                      : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                  }`}
                >
                  {projectSettings.autopilot_enabled ? '已开启' : '已关闭'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 模态：提案详情 */}
    </div>
  );
}

// 提案状态徽章
function ProposalStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    pending_review: { label: '待评审', className: 'bg-yellow-500/20 text-yellow-300 border-yellow-600/40' },
    under_review: { label: '评审中', className: 'bg-blue-500/20 text-blue-300 border-blue-600/40' },
    approved: { label: '已通过', className: 'bg-green-500/20 text-green-300 border-green-600/40' },
    rejected: { label: '已拒绝', className: 'bg-red-500/20 text-red-300 border-red-600/40' },
    revision_needed: { label: '需修改', className: 'bg-orange-500/20 text-orange-300 border-orange-600/40' },
    user_approved: { label: '已批准', className: 'bg-emerald-500/20 text-emerald-300 border-emerald-600/40' },
    user_rejected: { label: '已驳回', className: 'bg-rose-500/20 text-rose-300 border-rose-600/40' },
  };
  const c = config[status] || config.pending_review;
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}

// Agent emoji 映射
function getAgentEmoji(agentId: string): string {
  const map: Record<string, string> = {
    engineer: '👨‍💻', architect: '🏗️', game_designer: '🎮',
    biz_designer: '💼', ceo: '👔',
  };
  return map[agentId] || '🤖';
}

// 格式化工具输入值，便于展示
function formatToolValue(value: any): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    // 命令类内容完整显示
    if (value.length > 2000) return value.slice(0, 2000) + '\n... (内容过长已截断)';
    return value;
  }
  if (Array.isArray(value)) return JSON.stringify(value, null, 2);
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

// AskUserQuestion 回复表单
function AskUserQuestionForm({ options, singleSelect, onReply, onDeny }: {
  options?: string[];
  singleSelect: boolean;
  onReply: (answer: string) => void;
  onDeny: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [customText, setCustomText] = useState('');

  if (options && options.length > 0) {
    // 有预设选项
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt, idx) => {
            const isSelected = selected.includes(opt);
            return (
              <button
                key={idx}
                onClick={() => {
                  if (singleSelect) {
                    setSelected([opt]);
                  } else {
                    setSelected(prev => prev.includes(opt) ? prev.filter(o => o !== opt) : [...prev, opt]);
                  }
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                  isSelected
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => selected.length > 0 && onReply(selected.join(', '))}
            disabled={selected.length === 0}
            className="bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded px-3 py-1 text-xs font-medium transition-colors"
          >
            ✅ 提交回复
          </button>
          <button
            onClick={onDeny}
            className="bg-red-700 hover:bg-red-600 text-white rounded px-3 py-1 text-xs font-medium transition-colors"
          >
            ❌ 跳过
          </button>
        </div>
      </div>
    );
  }

  // 无预设选项，自由输入
  return (
    <div className="space-y-2">
      <input
        type="text"
        value={customText}
        onChange={e => setCustomText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && customText.trim()) {
            onReply(customText.trim());
          }
        }}
        placeholder="输入你的回复..."
        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        autoFocus
      />
      <div className="flex gap-2">
        <button
          onClick={() => customText.trim() && onReply(customText.trim())}
          disabled={!customText.trim()}
          className="bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded px-3 py-1 text-xs font-medium transition-colors"
        >
          ✅ 提交回复
        </button>
        <button
          onClick={onDeny}
          className="bg-red-700 hover:bg-red-600 text-white rounded px-3 py-1 text-xs font-medium transition-colors"
        >
          ❌ 跳过
        </button>
      </div>
    </div>
  );
}
