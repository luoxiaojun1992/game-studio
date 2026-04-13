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
import StarOfficeStudio from '../components/StarOfficeStudio';
import { useI18n } from '../i18n';

const AGENT_NAMES_ZH: Record<string, string> = {
  engineer: '软件工程师',
  architect: '架构师',
  game_designer: '游戏策划',
  biz_designer: '商业策划',
  ceo: 'CEO',
  team_builder: '团队建设',
};

const AGENT_NAMES_EN: Record<string, string> = {
  engineer: 'Engineer',
  architect: 'Architect',
  game_designer: 'Game Designer',
  biz_designer: 'Business Designer',
  ceo: 'CEO',
  team_builder: 'Team Building',
};

const TABS: { key: TabKey; label: { zh: string; en: string }; icon: string }[] = [
  { key: 'overview', label: { zh: '团队总览', en: 'Overview' }, icon: '🏠' },
  { key: 'team_building', label: { zh: '团队建设', en: 'Team Building' }, icon: '🧠' },
  { key: 'pixel_studio', label: { zh: 'Studio', en: 'Studio' }, icon: '🏢' },
  { key: 'proposals', label: { zh: '策划案', en: 'Proposals' }, icon: '📋' },
  { key: 'tasks', label: { zh: '任务看板', en: 'Task Board' }, icon: '🗂️' },
  { key: 'handoffs', label: { zh: '任务交接', en: 'Handoffs' }, icon: '🔄' },
  { key: 'settings', label: { zh: '配置中心', en: 'Settings' }, icon: '⚙️' },
  { key: 'games', label: { zh: '游戏成品', en: 'Games' }, icon: '🎮' },
  { key: 'logs', label: { zh: '运行日志', en: 'Logs' }, icon: '📜' },
  { key: 'commands', label: { zh: '指令中心', en: 'Commands' }, icon: '⌨️' },
];
const DEFAULT_PROJECT_ID = 'default';
const getCommandAgentKey = (projectId: string) => `commandPanel_lastAgent_${projectId}`;

export default function StudioPage() {
  const { l, language, setLanguage, isZh } = useI18n();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [tasks, setTasks] = useState<TaskBoardTask[]>([]);
  const [projectSettings, setProjectSettings] = useState<ProjectSettings>({ project_id: DEFAULT_PROJECT_ID, autopilot_enabled: false });
  const [projects, setProjects] = useState<ProjectInfo[]>([{ id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_ID }]);
  const [selectedProjectId, setSelectedProjectIdState] = useState<string>(DEFAULT_PROJECT_ID);
  const prevProjectIdRef = useRef<string>(DEFAULT_PROJECT_ID);
  const [newProjectName, setNewProjectName] = useState('');
  const setSelectedProjectId = useCallback(async (newProjectId: string) => {
    const oldProjectId = prevProjectIdRef.current;
    if (oldProjectId === newProjectId) return;
    setSelectedProjectIdState(newProjectId);
    prevProjectIdRef.current = newProjectId;
    try {
      await api.switchProject(oldProjectId, newProjectId);
      console.log(`[Project Switch] Synced from ${oldProjectId} to ${newProjectId}`);
    } catch (error) {
      console.error('[Project Switch] Failed to sync:', error);
    }
  }, []);
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
  const connectedRef = useRef(false);

  const handleSSEEvent = useCallback((event: SSEEvent) => {
    switch (event.type) {
      case 'init':
        setAgents(prev => {
          if (prev.length === 0) return prev;
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

      case 'logs_cleared':
        if ((event as any).agentId) {
          setLogs(prev => prev.filter(l => l.agent_id !== (event as any).agentId));
        } else {
          setLogs([]);
        }
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
      connectedRef.current = false;
      setTimeout(connectSSE, 3000);
    };

    es.onmessage = (e) => {
      try {
        const event: SSEEvent = JSON.parse(e.data);
        handleSSEEvent(event);
      } catch {}
    };
  }, [handleSSEEvent, selectedProjectId]);
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
  useEffect(() => {
    const commandableAgents = agents.filter(a => a.id !== 'team_builder');
    if (commandableAgents.length === 0) return;
    const saved = localStorage.getItem(getCommandAgentKey(selectedProjectId));
    if (saved && commandableAgents.find(a => a.id === saved)) {
      setCommandTargetAgent(saved as AgentRole);
    } else {
      setCommandTargetAgent(undefined);
    }
  }, [agents, selectedProjectId]);
  useEffect(() => {
    connectSSE();
    return () => {
      eventSourceRef.current?.close();
      connectedRef.current = false;
    };
  }, [connectSSE, selectedProjectId]);
  const handlePermissionResponse = async (requestId: string, behavior: 'allow' | 'deny', message?: string, updatedInput?: Record<string, unknown>) => {
    await api.respondPermission(requestId, behavior, message, selectedProjectId, updatedInput);
    setPendingPermissions(prev => prev.filter(p => p.requestId !== requestId));
  };
  const handleTogglePause = async (agentId: AgentRole) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;
    if (agent.state.isPaused) {
      await api.resumeAgent(agentId, selectedProjectId);
    } else {
      await api.pauseAgent(agentId, selectedProjectId);
    }
  };

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name || creatingProject) return;
    setProjectError(null);
    setCreatingProject(true);
    try {
      const id = name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      if (!id) {
        setProjectError(l('项目名无效，请使用字母数字下划线或短横线。', 'Invalid project name. Use letters, numbers, underscores or hyphens.'));
        return;
      }
      if (id === DEFAULT_PROJECT_ID) {
        setProjectError(l('不能创建与默认项目同名的项目。', 'Cannot create project with the same name as default project.'));
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
  const handleDecideProposal = async (proposalId: string, decision: 'approved' | 'rejected', comment: string) => {
    await api.decideProposal(proposalId, decision, comment);
    setSelectedProposal(null);
  };
  const handlePreviewGame = (game: Game) => {
    setSelectedGame(game);
  };

  const pendingProposals = proposals.filter(p => p.status === 'pending_review' || p.status === 'under_review');
  const overviewAgents = agents.filter(a => a.id !== 'team_builder');
  const teamBuildingAgent = agents.find(a => a.id === 'team_builder');
  const workingAgents = overviewAgents.filter(a => a.state?.status === 'working');
  const pendingHandoffs = handoffs.filter(h => h.status === 'pending');
  const activeTasks = tasks.filter(t => ['todo', 'developing', 'testing', 'blocked'].includes(t.status));
  const getLatestStreamLog = (agentId: AgentRole) => {
    let latest: LogEntry | undefined;
    for (let i = logs.length - 1; i >= 0; i--) {
      const item = logs[i];
      if (item.agent_id === agentId && item.log_type === 'text') {
        latest = item;
        break;
      }
    }
    if (!latest) return undefined;
    return { agentId, content: latest.content, time: latest.created_at };
  };

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎮</span>
          <div>
            <h1 className="text-lg font-bold text-white">Game Dev Studio</h1>
            <p className="text-xs text-gray-400">{l('游戏开发 Agent 团队 · 观测控制台 · 项目', 'Game development agent team · observability console · project')} {selectedProjectId}</p>
          </div>
        </div>

        
        <div className="flex items-center gap-4">
          {pendingPermissions.length > 0 && (
            <div className="flex items-center gap-1.5 bg-orange-500/20 border border-orange-500/40 rounded-full px-3 py-1 text-xs text-orange-300 animate-pulse">
              <span>⚠️</span>
              <span>{pendingPermissions.length} {l('个待审批操作', 'pending approvals')}</span>
            </div>
          )}
          {pendingProposals.length > 0 && (
            <div className="flex items-center gap-1.5 bg-blue-500/20 border border-blue-500/40 rounded-full px-3 py-1 text-xs text-blue-300">
              <span>📋</span>
              <span>{pendingProposals.length} {l('个待审批方案', 'pending proposals')}</span>
            </div>
          )}
          {pendingHandoffs.length > 0 && (
            <div className="flex items-center gap-1.5 bg-purple-500/20 border border-purple-500/40 rounded-full px-3 py-1 text-xs text-purple-300 animate-pulse cursor-pointer" onClick={() => setActiveTab('handoffs')}>
              <span>🔄</span>
              <span>{pendingHandoffs.length} {l('个待接收交接', 'pending handoffs')}</span>
            </div>
          )}
          {activeTasks.length > 0 && (
            <div className="flex items-center gap-1.5 bg-cyan-500/20 border border-cyan-500/40 rounded-full px-3 py-1 text-xs text-cyan-300 cursor-pointer" onClick={() => setActiveTab('tasks')}>
              <span>🗂️</span>
              <span>{activeTasks.length} {l('个看板任务进行中', 'active board tasks')}</span>
            </div>
          )}
          {workingAgents.length > 0 && (
            <div className="flex items-center gap-1.5 bg-green-500/20 border border-green-500/40 rounded-full px-3 py-1 text-xs text-green-300">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse inline-block" />
              <span>{workingAgents.length} {l('个 Agent 工作中', 'agents working')}</span>
            </div>
          )}
          <div className="flex items-center rounded-lg border border-gray-700 overflow-hidden">
            <button
              onClick={() => setLanguage('zh-CN')}
              className={`px-2.5 py-1 text-xs ${language === 'zh-CN' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            >
              中文
            </button>
            <button
              onClick={() => setLanguage('en-US')}
              className={`px-2.5 py-1 text-xs ${language === 'en-US' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            >
              EN
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">{l('项目', 'Project')}</span>
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
              placeholder={l('新建项目名', 'New project name')}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200 w-28"
            />
            <button
              onClick={handleCreateProject}
              disabled={!newProjectName.trim() || creatingProject}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded px-2 py-1"
            >
              {creatingProject ? l('创建中', 'Creating') : l('新建', 'Create')}
            </button>
            {projectError && (
              <span className="text-red-400">{projectError}</span>
            )}
          </div>
          <div className={`flex items-center gap-1.5 text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'} ${connected ? '' : 'animate-pulse'}`} />
            {connected ? l('已连接', 'Connected') : l('连接中...', 'Connecting...')}
          </div>
        </div>
      </header>

      
      {pendingPermissions.length > 0 && (
        <div className="shrink-0 bg-orange-950/50 border-b border-orange-900/50 px-6 py-2">
          <div className="text-xs text-orange-300 font-medium mb-1">⚠️ {l('有 Agent 正在请求操作权限，需要您确认：', 'An agent is requesting tool permission, please review:')}</div>
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
                    /* AskUserQuestion */
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
                     /* Permission request */
                    <>
                      {perm.input && Object.keys(perm.input).length > 0 && (
                        <div className="bg-gray-900/60 rounded-md p-2 mb-2 font-mono text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto border border-gray-700/50">
                          {Object.entries(perm.input).map(([key, value]) => (
                            <div key={key}>
                              <span className="text-blue-400">{key}</span>
                              <span className="text-gray-500">: </span>
                              <span className="text-gray-200">{formatToolValue(value, isZh)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handlePermissionResponse(perm.requestId, 'allow')}
                          className="bg-green-600 hover:bg-green-500 text-white rounded px-3 py-1 text-xs font-medium transition-colors"
                        >
                          {l('✅ 允许执行', '✅ Allow')}
                        </button>
                        <button
                          onClick={() => handlePermissionResponse(perm.requestId, 'deny')}
                          className="bg-red-700 hover:bg-red-600 text-white rounded px-3 py-1 text-xs font-medium transition-colors"
                        >
                          {l('❌ 拒绝', '❌ Deny')}
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

      
      <nav
        aria-label="Studio sections"
        className="shrink-0 flex items-center gap-1 px-6 py-2 bg-gray-900/50 border-b border-gray-800"
      >
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            aria-pressed={activeTab === tab.key}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{isZh ? tab.label.zh : tab.label.en}</span>
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

      
      <main className="flex-1 overflow-auto p-4">
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {overviewAgents.map(agent => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onPauseToggle={() => handleTogglePause(agent.id)}
                  onSendCommand={() => {
                    setCommandTargetAgent(agent.id);
                    setActiveTab('commands');
                  }}
                  streamLog={getLatestStreamLog(agent.id)}
                  pendingHandoffs={pendingHandoffs}
                  activeHandoffs={handoffs.filter(h => ['pending', 'accepted', 'working'].includes(h.status))}
                />
              ))}
            </div>

            
            {proposals.length > 0 && (
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-300">{l('最新提案', 'Latest Proposals')}</h3>
                  <button onClick={() => setActiveTab('proposals')} className="text-xs text-blue-400 hover:text-blue-300">
                    {l('查看全部 →', 'View all →')}
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
                        <ProposalStatusBadge status={p.status} isZh={isZh} />
                        <span className="text-xs text-gray-500">{(isZh ? AGENT_NAMES_ZH : AGENT_NAMES_EN)[p.author_agent_id] || p.author_agent_id}</span>
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
            <StarOfficeStudio />
          </div>
        )}

        {activeTab === 'team_building' && (
          <div className="space-y-4">
            {teamBuildingAgent ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                <AgentCard
                  agent={teamBuildingAgent}
                  disableActions
                  streamLog={getLatestStreamLog(teamBuildingAgent.id)}
                />
              </div>
            ) : (
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 text-sm text-gray-400">
                {l('团队建设 Agent 未初始化', 'Team building agent is not initialized')}
              </div>
            )}
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
                     <p>{l('选择一个提案查看详情', 'Select a proposal to view details')}</p>
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
                     <p>{l('选择一个游戏预览', 'Select a game to preview')}</p>
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
            agents={agents.filter(a => a.id !== 'team_builder')}
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
              <h3 className="text-sm font-semibold text-gray-300 mb-1">{l('配置中心', 'Settings')}</h3>
              <p className="text-xs text-gray-500 mb-4">{l('当前项目', 'Current project')}: {selectedProjectId}</p>
              <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3">
                <div>
                    <div className="text-sm text-white font-medium">🤖 {l('自动驾驶模式', 'Autopilot Mode')}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {l('开启后，所有工具调用（交接、提交方案、提交成品等）自动放行，无需手动审批。', 'When enabled, all tool calls (handoffs, proposal submissions, game submissions, etc.) are auto-approved.')}
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
                  {projectSettings.autopilot_enabled ? l('已开启', 'Enabled') : l('已关闭', 'Disabled')}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      
    </div>
  );
}
function ProposalStatusBadge({ status, isZh }: { status: string; isZh: boolean }) {
  const config: Record<string, { label: string; className: string }> = {
    pending_review: { label: isZh ? '待评审' : 'Pending Review', className: 'bg-yellow-500/20 text-yellow-300 border-yellow-600/40' },
    under_review: { label: isZh ? '评审中' : 'In Review', className: 'bg-blue-500/20 text-blue-300 border-blue-600/40' },
    approved: { label: isZh ? '已通过' : 'Approved', className: 'bg-green-500/20 text-green-300 border-green-600/40' },
    rejected: { label: isZh ? '已拒绝' : 'Rejected', className: 'bg-red-500/20 text-red-300 border-red-600/40' },
    revision_needed: { label: isZh ? '需修改' : 'Needs Revision', className: 'bg-orange-500/20 text-orange-300 border-orange-600/40' },
    user_approved: { label: isZh ? '已批准' : 'Approved by User', className: 'bg-emerald-500/20 text-emerald-300 border-emerald-600/40' },
    user_rejected: { label: isZh ? '已驳回' : 'Rejected by User', className: 'bg-rose-500/20 text-rose-300 border-rose-600/40' },
  };
  const c = config[status] || config.pending_review;
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}
function getAgentEmoji(agentId: string): string {
  const map: Record<string, string> = {
    engineer: '👨‍💻', architect: '🏗️', game_designer: '🎮',
    biz_designer: '💼', ceo: '👔', team_builder: '🧠',
  };
  return map[agentId] || '🤖';
}
function formatToolValue(value: any, isZh: boolean): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    if (value.length > 2000) return value.slice(0, 2000) + (isZh ? '\n... (内容过长已截断)' : '\n... (content truncated)');
    return value;
  }
  if (Array.isArray(value)) return JSON.stringify(value, null, 2);
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}
function AskUserQuestionForm({ options, singleSelect, onReply, onDeny }: {
  options?: string[];
  singleSelect: boolean;
  onReply: (answer: string) => void;
  onDeny: () => void;
}) {
  const { l } = useI18n();
  const [selected, setSelected] = useState<string[]>([]);
  const [customText, setCustomText] = useState('');

  if (options && options.length > 0) {
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
            {l('✅ 提交回复', '✅ Submit')}
          </button>
          <button
            onClick={onDeny}
            className="bg-red-700 hover:bg-red-600 text-white rounded px-3 py-1 text-xs font-medium transition-colors"
          >
            {l('❌ 跳过', '❌ Skip')}
          </button>
        </div>
      </div>
    );
  }
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
        placeholder={l('输入你的回复...', 'Enter your reply...')}
        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        autoFocus
      />
      <div className="flex gap-2">
        <button
          onClick={() => customText.trim() && onReply(customText.trim())}
          disabled={!customText.trim()}
          className="bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded px-3 py-1 text-xs font-medium transition-colors"
        >
          {l('✅ 提交回复', '✅ Submit')}
        </button>
        <button
          onClick={onDeny}
          className="bg-red-700 hover:bg-red-600 text-white rounded px-3 py-1 text-xs font-medium transition-colors"
        >
          {l('❌ 跳过', '❌ Skip')}
        </button>
      </div>
    </div>
  );
}
