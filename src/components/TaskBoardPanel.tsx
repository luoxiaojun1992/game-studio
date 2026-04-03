import React, { useMemo, useState } from 'react';
import { Agent, AgentRole, TaskBoardTask, TaskStatus, TaskType } from '../types';
import { api } from '../config';

interface Props {
  agents: Agent[];
  tasks: TaskBoardTask[];
  onTaskUpdated: (task: TaskBoardTask) => void;
}

const STATUS_COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: 'todo', label: '待开始' },
  { key: 'developing', label: '开发中' },
  { key: 'testing', label: '测试中' },
  { key: 'blocked', label: '阻塞' },
  { key: 'done', label: '已完成' },
];

const NEXT_STATUS_OPTIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ['developing', 'blocked'],
  developing: ['testing', 'blocked'],
  testing: ['done', 'blocked', 'developing'],
  blocked: ['todo', 'developing', 'testing'],
  done: [],
};

const AGENT_EMOJI: Record<string, string> = {
  engineer: '👨‍💻', architect: '🏗️', game_designer: '🎮',
  biz_designer: '💼', ceo: '👔',
};

function typeLabel(type: TaskType): string {
  return type === 'development' ? '开发' : '测试';
}

export default function TaskBoardPanel({ agents, tasks, onTaskUpdated }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formType, setFormType] = useState<TaskType>('development');
  const [formBy, setFormBy] = useState<AgentRole>('engineer');
  const [splitTestingTask, setSplitTestingTask] = useState(true);

  const grouped = useMemo(() => {
    const map: Record<TaskStatus, TaskBoardTask[]> = {
      todo: [],
      developing: [],
      testing: [],
      blocked: [],
      done: [],
    };
    tasks.forEach(t => map[t.status].push(t));
    return map;
  }, [tasks]);

  const handleCreate = async () => {
    if (!formTitle.trim()) return;
    setCreating(true);
    try {
      const data = await api.createTask({
        title: formTitle.trim(),
        description: formDesc.trim() || undefined,
        task_type: formType,
        created_by: formBy,
        split_testing_task: splitTestingTask
      });
      if (data.task) onTaskUpdated(data.task);
      if (data.testingTask) onTaskUpdated(data.testingTask);
      setShowCreate(false);
      setFormTitle('');
      setFormDesc('');
      setFormType('development');
      setSplitTestingTask(true);
    } finally {
      setCreating(false);
    }
  };

  const handleMove = async (task: TaskBoardTask, nextStatus: TaskStatus) => {
    setUpdatingId(task.id);
    try {
      const data = await api.updateTaskStatus(task.id, nextStatus, 'engineer');
      if (data.task) onTaskUpdated(data.task);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white">🗂️ 项目任务看板</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + 新建看板任务
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 flex-1 min-h-0">
        {STATUS_COLUMNS.map(col => (
          <div key={col.key} className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex flex-col min-h-0">
            <div className="text-sm font-semibold text-gray-200 mb-2">{col.label} · {grouped[col.key].length}</div>
            <div className="space-y-2 overflow-y-auto">
              {grouped[col.key].map(task => (
                <div key={task.id} className="bg-gray-800 border border-gray-700 rounded-lg p-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded ${task.task_type === 'development' ? 'bg-blue-500/20 text-blue-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                      {typeLabel(task.task_type)}
                    </span>
                    <span className="text-[11px] text-gray-500">{AGENT_EMOJI[task.created_by] || '🤖'} {task.created_by}</span>
                  </div>
                  <div className="text-sm text-white font-medium mb-1">{task.title}</div>
                  {task.description && <div className="text-xs text-gray-400 mb-2 line-clamp-3">{task.description}</div>}
                  {task.source_task_id && (
                    <div className="text-[11px] text-gray-500 mb-2">来自开发任务拆分</div>
                  )}
                  {NEXT_STATUS_OPTIONS[task.status].length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {NEXT_STATUS_OPTIONS[task.status].map(next => (
                        <button
                          key={next}
                          disabled={updatingId === task.id}
                          onClick={() => handleMove(task, next)}
                          className="text-[11px] px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 disabled:opacity-50"
                        >
                          移动到{STATUS_COLUMNS.find(s => s.key === next)?.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {grouped[col.key].length === 0 && (
                <div className="text-xs text-gray-600 py-8 text-center">暂无任务</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg mx-4 shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-lg font-bold text-white">🗂️ 新建看板任务</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-500 hover:text-gray-300 text-xl">✕</button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">任务标题 *</label>
                <input
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">任务描述</label>
                <textarea
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium">任务类型</label>
                  <select
                    value={formType}
                    onChange={e => setFormType(e.target.value as TaskType)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="development">开发任务</option>
                    <option value="testing">测试任务</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium">创建人</label>
                  <select
                    value={formBy}
                    onChange={e => setFormBy(e.target.value as AgentRole)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={splitTestingTask}
                  onChange={e => setSplitTestingTask(e.target.checked)}
                />
                自动拆分对应测试任务（仅开发任务生效）
              </label>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-800">
              <button onClick={() => setShowCreate(false)} className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium px-5 py-2 rounded-lg">取消</button>
              <button
                onClick={handleCreate}
                disabled={!formTitle.trim() || creating}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium px-5 py-2 rounded-lg"
              >
                {creating ? '创建中...' : '创建任务'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
