import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  FileSearch, FileText, FolderOpen, Pencil,
  Terminal, Brain, Database,
  CheckSquare, ListTodo,
  Shapes,
  Image, Crop, Scissors, Maximize,
  PenTool, Gamepad2, Package, Upload, Download,
  Users, MessageSquare, ShieldCheck, Search,
  Clock, Play,
  Wrench, Settings2, ChevronDown, ChevronUp,
  LucideIcon
} from 'lucide-react';
import { api } from '../config';
import { useI18n } from '../i18n';
import { LogEntry, AgentRole } from '../types';

// ── Tool Icon Map ──────────────────────────────────────────

const TOOL_ICON_MAP: Record<string, LucideIcon> = {
  // 文件操作
  search_file: FileSearch,
  search_content: Search,
  read_file: FileText,
  write_file: Pencil,
  write_game_file: Pencil,
  list_files: FolderOpen,
  // 终端
  bash: Terminal,
  run_: Play,
  // 记忆与数据
  save_memory: Brain,
  get_memories: Database,
  get_agent_logs: Clock,
  // 任务管理
  get_tasks: ListTodo,
  update_task_status: CheckSquare,
  split_dev_test_tasks: ListTodo,
  // Blender 建模
  blender_: Shapes,
  // 图片处理
  image_: Image,
  image_resize: Maximize,
  image_crop: Crop,
  image_sprite_sheet: Scissors,
  // Draw.io
  drawio_: PenTool,
  // 视频
  video_: Play,
  // 游戏
  submit_game: Upload,
  get_games: Package,
  get_game_info: Gamepad2,
  // Agent 交互
  get_agents: Users,
  create_handoff: MessageSquare,
  get_pending_handoffs: MessageSquare,
  // Lint
  lint_: ShieldCheck,
  // 上传下载
  upload_: Upload,
  download_: Download,
  // 提案
  submit_proposal: FileText,
  get_proposals: ListTodo,
};

const getToolIcon = (toolName: string): LucideIcon => {
  if (TOOL_ICON_MAP[toolName]) return TOOL_ICON_MAP[toolName];
  const prefixKey = Object.keys(TOOL_ICON_MAP)
    .filter(k => k.endsWith('_'))
    .find(k => toolName.startsWith(k));
  if (prefixKey) return TOOL_ICON_MAP[prefixKey];
  return Wrench;
};

// ── Config ─────────────────────────────────────────────────

interface ToolChainConfig {
  maxLength: number;
  displayMode: 'compact' | 'expanded';
}

const CONFIG_STORAGE_KEY = 'toolChainConfig';
const DEFAULT_CONFIG: ToolChainConfig = { maxLength: 15, displayMode: 'compact' };

function loadConfig(): ToolChainConfig {
  try {
    const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch {}
  return DEFAULT_CONFIG;
}

function saveConfig(config: ToolChainConfig): void {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

// ── ToolCallChain Component ────────────────────────────────

interface ToolCallChainProps {
  projectId: string;
  agentId: AgentRole;
  logs: LogEntry[];
}

export default function ToolCallChain({ projectId, agentId, logs }: ToolCallChainProps) {
  const { l, isZh } = useI18n();
  const [config, setConfig] = useState<ToolChainConfig>(loadConfig);
  const [toolCalls, setToolCalls] = useState<LogEntry[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const chainRef = useRef<HTMLDivElement>(null);
  const prevToolLogIdsRef = useRef<Set<string>>(new Set());

  // Initial API fetch on mount / agent change
  useEffect(() => {
    console.error(`[DEBUG:ToolCallChain] init: projectId=${projectId} agentId=${agentId} maxLength=${config.maxLength} displayMode=${config.displayMode}`);
    prevToolLogIdsRef.current = new Set();
    api.getLogs(projectId, agentId, { log_type: 'tool', limit: config.maxLength })
      .then((res: any) => {
        const fetched: LogEntry[] = res.logs || [];
        console.error(`[DEBUG:ToolCallChain] apiFetch: GET /logs?log_type=tool&limit=${config.maxLength} → ${fetched.length} results`);
        setToolCalls(fetched.slice(-config.maxLength));
        prevToolLogIdsRef.current = new Set(fetched.map(l => l.id));
      })
      .catch(() => {
        console.error(`[DEBUG:ToolCallChain] apiFetch: failed`);
        setToolCalls([]);
      });
  }, [projectId, agentId]);

  // Re-fetch when maxLength changes
  useEffect(() => {
    api.getLogs(projectId, agentId, { log_type: 'tool', limit: config.maxLength })
      .then((res: any) => {
        const fetched: LogEntry[] = res.logs || [];
        setToolCalls(fetched.slice(-config.maxLength));
      })
      .catch(() => {});
  }, [config.maxLength]);

  // SSE real-time update: detect new tool entries from logs prop
  useEffect(() => {
    const newToolLogs = logs
      .filter(l => l.agent_id === agentId && l.log_type === 'tool' && !prevToolLogIdsRef.current.has(l.id));
    if (newToolLogs.length > 0) {
      for (const nl of newToolLogs) {
        console.error(`[DEBUG:ToolCallChain] sseAppend: tool=${nl.tool_name} agentId=${nl.agent_id}`);
        prevToolLogIdsRef.current.add(nl.id);
      }
      setToolCalls(prev => [...prev, ...newToolLogs].slice(-config.maxLength));
    }
  }, [logs, agentId, config.maxLength]);

  // Auto-scroll to latest entry
  useEffect(() => {
    if (chainRef.current && config.displayMode === 'compact') {
      chainRef.current.scrollLeft = chainRef.current.scrollWidth;
    }
  }, [toolCalls, config.displayMode]);

  const updateConfig = useCallback((partial: Partial<ToolChainConfig>) => {
    const next = { ...config, ...partial };
    setConfig(next);
    saveConfig(next);
    console.error(`[DEBUG:ToolCallChain] configChange: maxLength=${next.maxLength} displayMode=${next.displayMode}`);
  }, [config]);

  const toggleMode = useCallback(() => {
    const nextMode = config.displayMode === 'compact' ? 'expanded' : 'compact';
    updateConfig({ displayMode: nextMode });
    console.error(`[DEBUG:ToolCallChain] modeChange: ${config.displayMode}→${nextMode}`);
  }, [config, updateConfig]);

  const visibleCalls = useMemo(() => toolCalls.slice(-config.maxLength), [toolCalls, config.maxLength]);
  console.error(`[DEBUG:ToolCallChain] render: toolCount=${toolCalls.length} visibleCount=${visibleCalls.length}`);

  if (visibleCalls.length === 0) {
    return (
      <div className="tool-chain-empty" data-testid="tool-call-chain">
        <span className="text-xs text-gray-600 px-3 py-1.5">
          {isZh ? '暂无工具调用' : 'No tool calls yet'}
        </span>
      </div>
    );
  }

  return (
    <div className="tool-chain-wrapper" data-testid="tool-call-chain">
      {/* Header row: title + controls */}
      <div className="flex items-center gap-1.5 px-3 py-1 bg-gray-900/30 border-b border-gray-700/50">
        <span className="text-xs text-gray-500 font-medium">
          {isZh ? '工具链' : 'Tool Chain'}
        </span>
        <span className="text-xs text-gray-600 tabular-nums">
          {visibleCalls.length}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={toggleMode}
            className="text-gray-500 hover:text-gray-300 transition-colors p-0.5"
            title={config.displayMode === 'compact' ? l('展开模式', 'Expanded') : l('紧凑模式', 'Compact')}
            data-testid="tool-chain-mode-toggle"
          >
            {config.displayMode === 'compact' ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button
            onClick={() => setShowConfig(v => !v)}
            className="text-gray-500 hover:text-gray-300 transition-colors p-0.5"
            title={l('配置', 'Config')}
            data-testid="tool-chain-config-btn"
          >
            <Settings2 size={14} />
          </button>
        </div>
      </div>

      {/* Config panel */}
      {showConfig && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-900/40 border-b border-gray-700/30 text-xs">
          <label className="flex items-center gap-1.5 text-gray-400">
            {isZh ? '最大数量' : 'Max length'}
            <input
              type="range"
              min={10}
              max={20}
              value={config.maxLength}
              onChange={e => updateConfig({ maxLength: Number(e.target.value) })}
              className="w-20 accent-blue-500"
              data-testid="tool-chain-max-length"
            />
            <span className="text-gray-300 tabular-nums w-4">{config.maxLength}</span>
          </label>
        </div>
      )}

      {/* Chain display */}
      {config.displayMode === 'compact' ? (
        <div ref={chainRef} className="tool-chain-compact">
          {visibleCalls.map((tc, i) => {
            const Icon = getToolIcon(tc.tool_name || '');
            return (
              <React.Fragment key={tc.id}>
                {i > 0 && <span className="chain-arrow">&rarr;</span>}
                <span className="chain-badge" title={`${tc.tool_name} — ${new Date(tc.created_at).toLocaleTimeString()}`}>
                  <Icon size={12} className="chain-icon" />
                  <span className="chain-name">{tc.tool_name}</span>
                </span>
              </React.Fragment>
            );
          })}
        </div>
      ) : (
        <div className="tool-chain-expanded">
          {visibleCalls.map((tc, i) => {
            const Icon = getToolIcon(tc.tool_name || '');
            return (
              <div key={tc.id} className="chain-row">
                <span className="chain-index">{i + 1}</span>
                <Icon size={14} className="chain-icon" />
                <span className="chain-name">{tc.tool_name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
