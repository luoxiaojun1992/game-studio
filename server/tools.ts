/**
 * 游戏开发工作室自定义工具
 * 使用 CodeBuddy Agent SDK 的 Custom Tools 机制注册
 *
 * 这些工具通过 MCP Server 直接注册到 SDK，Agent 可以像使用内置工具一样调用它们，
 * 不再需要通过 curl 调用 localhost API。
 */
import { z } from 'zod';
import { tool, createSdkMcpServer, type SdkMcpServerResult } from '@tencent-ai/agent-sdk';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';
import { AgentRole } from './agents.js';
import { sseBroadcaster } from './sse-broadcaster.js';

/**
 * 工具回调函数类型 — 用于记录日志
 */
type ToolLogFn = (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;

/**
 * 创建工作室 MCP Server，包含所有自定义工具
 *
 * @param agentId - 当前 Agent 的角色 ID，用于标识操作来源
 * @param logFn - 日志记录函数
 */
export function createStudioToolsServer(agentId: AgentRole, logFn?: ToolLogFn): SdkMcpServerResult {
  const log = logFn || (() => {});
  const TASK_STATUS_FLOW: Record<string, string[]> = {
    todo: ['developing', 'blocked'],
    developing: ['testing', 'blocked'],
    testing: ['done', 'blocked', 'developing'],
    blocked: ['todo', 'developing', 'testing'],
    done: []
  };
  const TASK_STATUS_LABEL: Record<string, string> = {
    todo: '待开发',
    developing: '开发中',
    testing: '测试中',
    blocked: '阻塞',
    done: '已完成'
  };
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const TASK_ID_HELP_TEXT = '请先调用 get_tasks 获取完整任务 ID（UUID）后重试。';

  const server = createSdkMcpServer({
    name: 'studio-tools',
    version: '1.0.0',
    tools: [
      // ==================== 记忆工具 ====================

      tool(
        'save_memory',
        '保存一条长期记忆。在做出重要决策、获得经验教训、产出成果等关键时刻，你应该主动调用此工具保存信息。',
        {
          category: z.enum(['general', 'preference', 'decision', 'lesson', 'achievement']).describe(
            '记忆分类：general=通用, preference=用户偏好, decision=重要决策, lesson=经验教训, achievement=成果产出'
          ),
          content: z.string().max(5000).describe('记忆内容，简明扼要，不超过5000字符'),
          importance: z.enum(['low', 'normal', 'high', 'critical']).optional().default('normal').describe('重要程度'),
          source_task: z.string().optional().describe('关联的任务名称')
        },
        async ({ category, content, importance, source_task }) => {
          const now = new Date().toISOString();
          const memory = db.createAgentMemory({
            id: uuidv4(),
            agent_id: agentId,
            category,
            content,
            importance: importance || 'normal',
            source_task: source_task || null,
            created_at: now,
            updated_at: now
          });
          log(agentId, '保存记忆', `类别: ${category} | 重要度: ${importance}`, 'info');
          return {
            content: [{ type: 'text' as const, text: `记忆已保存 (ID: ${memory.id.slice(0, 8)})` }]
          };
        }
      ),

      tool(
        'get_memories',
        '获取你之前保存的长期记忆，帮助你回忆之前的决策、经验和成果。',
        {
          category: z.enum(['general', 'preference', 'decision', 'lesson', 'achievement']).optional().describe('按类别筛选，不填则返回全部'),
          limit: z.number().min(1).max(50).optional().default(20).describe('返回条数上限')
        },
        async ({ category, limit }) => {
          const memories = db.getAgentMemories(agentId, category, limit || 20);
          if (memories.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '暂无保存的记忆。' }]
            };
          }
          const text = memories.map(m =>
            `[${m.category}/${m.importance}] (${m.created_at.slice(0, 10)}) ${m.content}`
          ).join('\n');
          return {
            content: [{ type: 'text' as const, text }]
          };
        }
      ),

      // ==================== 交接工具 ====================

      tool(
        'create_handoff',
        '将任务移交给其他团队成员。当你完成自己的工作部分，需要其他 Agent 接手时调用此工具。交接需要管理者确认后目标 Agent 才会开始工作。',
        {
          to_agent_id: z.enum(['engineer', 'architect', 'game_designer', 'biz_designer', 'ceo']).describe(
            '目标 Agent ID：engineer=软件工程师（含软件测试）, architect=架构师, game_designer=游戏策划（含UI设计）, biz_designer=商业策划, ceo=CEO'
          ),
          title: z.string().describe('简短的任务标题'),
          description: z.string().describe('详细的任务描述'),
          context: z.string().optional().describe(
            '上下文信息：你的工作成果摘要、相关文件路径、关键决策等。这些信息对下一个 Agent 完成任务至关重要。'
          ),
          priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal').describe('任务优先级')
        },
        async ({ to_agent_id, title, description, context, priority }) => {
          const now = new Date().toISOString();
          const handoff = db.createHandoff({
            id: uuidv4(),
            from_agent_id: agentId,
            to_agent_id,
            title,
            description,
            context: context || null,
            status: 'pending',
            priority: priority || 'normal',
            result: null,
            accepted_at: null,
            completed_at: null,
            source_command_id: null,
            created_at: now,
            updated_at: now,
          });
          sseBroadcaster.broadcast({ type: 'handoff_created', handoff });
          log(agentId, '创建交接', `${agentId} → ${to_agent_id}: ${title}`, 'success');
          return {
            content: [{ type: 'text' as const, text: `交接已创建 (ID: ${handoff.id.slice(0, 8)})，等待管理者确认后 ${to_agent_id} 才会开始工作。` }]
          };
        }
      ),

      // ==================== 任务看板工具 ====================

      tool(
        'split_dev_test_tasks',
        '将一个功能目标拆分为开发任务和测试任务，并写入任务看板。',
        {
          project_id: z.string().optional().default('default').describe('项目 ID'),
          feature_title: z.string().describe('功能标题'),
          development_description: z.string().describe('开发任务描述'),
          testing_description: z.string().optional().describe('测试任务描述（不填则自动生成）'),
          priority_hint: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal').describe('优先级提示（用于描述，不影响状态机）')
        },
        async ({ project_id, feature_title, development_description, testing_description, priority_hint }) => {
          const now = new Date().toISOString();
          const devTask = db.createTaskBoardTask({
            id: uuidv4(),
            project_id: project_id || 'default',
            title: `开发：${feature_title}`,
            description: `[优先级:${priority_hint || 'normal'}] ${development_description}`,
            task_type: 'development',
            status: 'todo',
            source_task_id: null,
            created_by: agentId,
            updated_by: agentId,
            started_at: null,
            completed_at: null,
            created_at: now,
            updated_at: now
          });

          const testTask = db.createTaskBoardTask({
            id: uuidv4(),
            project_id: project_id || 'default',
            title: `测试：${feature_title}`,
            description: testing_description || `验证“${feature_title}”功能正确性与回归影响，覆盖功能、边界和异常路径。`,
            task_type: 'testing',
            status: 'todo',
            source_task_id: devTask.id,
            created_by: agentId,
            updated_by: agentId,
            started_at: null,
            completed_at: null,
            created_at: now,
            updated_at: now
          });

          sseBroadcaster.broadcast({ type: 'task_created', task: devTask });
          sseBroadcaster.broadcast({ type: 'task_created', task: testTask });
          log(agentId, '拆分任务看板', `${feature_title} -> 开发+测试`, 'success');

          return {
            content: [{
              type: 'text' as const,
              text: `已拆分任务：开发任务 ${devTask.id}，测试任务 ${testTask.id}。`
            }]
          };
        }
      ),

      tool(
        'get_tasks',
        '查询任务看板中的任务，用于查看待办和当前进度。',
        {
          project_id: z.string().optional().describe('项目 ID，不填默认全部'),
          status: z.enum(['todo', 'developing', 'testing', 'blocked', 'done']).optional().describe('按状态筛选'),
          task_type: z.enum(['development', 'testing']).optional().describe('按任务类型筛选'),
          limit: z.number().min(1).max(100).optional().default(20).describe('返回条数上限')
        },
        async ({ project_id, status, task_type, limit }) => {
          let tasks = db.getTaskBoardTasks(project_id || undefined);
          if (status) tasks = tasks.filter(t => t.status === status);
          if (task_type) tasks = tasks.filter(t => t.task_type === task_type);
          tasks = tasks.slice(0, limit || 20);
          if (tasks.length === 0) {
            return { content: [{ type: 'text' as const, text: '没有匹配的看板任务。' }] };
          }
          const text = tasks.map(t => {
            const rel = t.source_task_id ? ` | 来源:${t.source_task_id}` : '';
            return `[${t.status}/${t.task_type}] ${t.title} (ID:${t.id})${rel}`;
          }).join('\n');
          return { content: [{ type: 'text' as const, text }] };
        }
      ),

      tool(
        'update_task_status',
        '更新看板任务状态，维护开发与测试过程进度。',
        {
          task_id: z.string().describe('任务 ID'),
          status: z.enum(['todo', 'developing', 'testing', 'blocked', 'done']).describe('目标状态')
        },
        async ({ task_id, status }) => {
          const normalizedTaskId = task_id.trim();
          if (!UUID_PATTERN.test(normalizedTaskId)) {
            return { content: [{ type: 'text' as const, text: `任务 ID 格式非法: ${normalizedTaskId}。${TASK_ID_HELP_TEXT}` }] };
          }
          const task = db.getTaskBoardTask(normalizedTaskId);

          if (!task) {
            return { content: [{ type: 'text' as const, text: `任务不存在: ${normalizedTaskId}。${TASK_ID_HELP_TEXT}` }] };
          }
          if (!TASK_STATUS_FLOW[task.status]?.includes(status)) {
            const allowed = TASK_STATUS_FLOW[task.status] || [];
            const allowedLabel = allowed.length > 0
              ? allowed.map(s => TASK_STATUS_LABEL[s] || s).join('、')
              : '无（终态）';
            return {
              content: [{
                type: 'text' as const,
                text: `状态流转非法: ${TASK_STATUS_LABEL[task.status] || task.status} -> ${TASK_STATUS_LABEL[status] || status}。合法流转: ${allowedLabel}`
              }]
            };
          }

          const now = new Date().toISOString();
          const updates: Partial<db.DbTaskBoardTask> = { status, updated_by: agentId };
          if (status === 'developing' || status === 'testing') {
            updates.started_at = task.started_at || now;
          }
          if (status === 'done') {
            updates.completed_at = now;
          } else if (task.status === 'done') {
            updates.completed_at = null;
          }

          const success = db.updateTaskBoardTask(task.id, updates);
          if (!success) {
            return { content: [{ type: 'text' as const, text: `任务状态更新失败: ${task_id}` }] };
          }
          const updated = db.getTaskBoardTask(task.id)!;
          sseBroadcaster.broadcast({ type: 'task_updated', task: updated });
          log(agentId, '维护任务状态', `${task.title}: ${task.status} -> ${status}`, 'success');

          return {
            content: [{ type: 'text' as const, text: `任务状态已更新: ${task.id} -> ${status}` }]
          };
        }
      ),

      // ==================== 提案工具 ====================

      tool(
        'submit_proposal',
        '提交一份策划案或方案文档（如游戏策划案、商业策划案、技术方案等）。提案提交后将通知管理者进行审批。',
        {
          project_id: z.string().optional().default('default').describe('项目 ID，用于归档到 /output/{project_id}/... 目录'),
          type: z.enum(['game_design', 'biz_design', 'tech_arch', 'tech_impl', 'ceo_review']).describe(
            '提案类型：game_design=游戏策划, biz_design=商业策划, tech_arch=架构方案, tech_impl=技术方案'
          ),
          title: z.string().describe('提案标题'),
          content: z.string().describe('提案的完整内容（Markdown 格式）')
        },
        async ({ project_id, type, title, content }) => {
          const now = new Date().toISOString();
          const proposal = db.createProposal({
            id: uuidv4(),
            project_id: project_id || 'default',
            type,
            title,
            content,
            author_agent_id: agentId,
            status: 'pending_review',
            reviewer_agent_id: null,
            review_comment: null,
            user_decision: null,
            user_comment: null,
            version: 1,
            parent_id: null,
            created_at: now,
            updated_at: now
          });
          const filePath = db.saveProposalToFile(proposal);
          sseBroadcaster.broadcast({ type: 'proposal_created', proposal, filePath });
          log(agentId, '提交提案', `提案: ${title}${filePath ? ' → 已保存' : ''}`, 'success');
          return {
            content: [{ type: 'text' as const, text: `提案已提交 (ID: ${proposal.id.slice(0, 8)})，等待审批。` }]
          };
        }
      ),

      // ==================== 游戏工具 ====================

      tool(
        'submit_game',
        '提交一个完成的游戏成品（单文件 HTML）。游戏将被保存到数据库和产出目录中。',
        {
          project_id: z.string().optional().default('default').describe('项目 ID，用于归档到 /output/{project_id}/... 目录'),
          name: z.string().describe('游戏名称'),
          html_content: z.string().min(100).describe('完整的游戏 HTML 代码（必须是包含所有 CSS/JS 的单文件 HTML）'),
          description: z.string().optional().describe('游戏简介'),
          version: z.string().optional().default('1.0.0').describe('版本号'),
          proposal_id: z.string().optional().describe('关联的策划案 ID（如果有）')
        },
        async ({ project_id, name, html_content, description, version, proposal_id }) => {
          const now = new Date().toISOString();
          const game = db.createGame({
            id: uuidv4(),
            project_id: project_id || 'default',
            name,
            description: description || null,
            html_content,
            proposal_id: proposal_id || null,
            version: version || '1.0.0',
            status: 'draft',
            author_agent_id: agentId,
            created_at: now,
            updated_at: now
          });
          const filePath = db.saveGameToFile(game);
          sseBroadcaster.broadcast({ type: 'game_submitted', game: { ...game, html_content: undefined as any, hasContent: true }, filePath });
          log(agentId, '提交游戏', `游戏: ${name} v${version || '1.0.0'}${filePath ? ' → 已保存' : ''}`, 'success');
          return {
            content: [{ type: 'text' as const, text: `游戏已提交 (ID: ${game.id.slice(0, 8)})，名称: ${name}，版本: ${version || '1.0.0'}。` }]
          };
        }
      ),

      // ==================== 查询工具 ====================

      tool(
        'get_proposals',
        '查询已有的提案列表，用于了解当前项目的策划案进度。',
        {
          status: z.enum(['pending_review', 'under_review', 'approved', 'rejected', 'revision_needed', 'user_approved', 'user_rejected']).optional().describe('按状态筛选'),
          limit: z.number().min(1).max(50).optional().default(10).describe('返回条数上限')
        },
        async ({ status, limit }) => {
          let proposals = db.getAllProposals();
          if (status) {
            proposals = proposals.filter(p => p.status === status);
          }
          proposals = proposals.slice(0, limit || 10);
          if (proposals.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '没有找到匹配的提案。' }]
            };
          }
          const text = proposals.map(p =>
            `[${p.status}] ${p.title} (作者: ${p.author_agent_id}, 类型: ${p.type}, ${p.created_at.slice(0, 10)})`
          ).join('\n');
          return {
            content: [{ type: 'text' as const, text }]
          };
        }
      ),

      tool(
        'get_pending_handoffs',
        '查询待处理的任务交接，了解是否有其他 Agent 向你发起了交接。',
        {
          limit: z.number().min(1).max(20).optional().default(5).describe('返回条数上限')
        },
        async ({ limit }) => {
          const handoffs = db.getPendingHandoffs(agentId);
          const relevant = handoffs.slice(0, limit || 5);
          if (relevant.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '没有待处理的交接任务。' }]
            };
          }
          const text = relevant.map(h =>
            `[${h.status}] ${h.title} (来自: ${h.from_agent_id}, 优先级: ${h.priority}, ${h.created_at.slice(0, 10)})\n  描述: ${h.description.slice(0, 100)}`
          ).join('\n\n');
          return {
            content: [{ type: 'text' as const, text }]
          };
        }
      )
    ]
  });

  return server;
}

/**
 * 获取 Agent 的记忆摘要，用于注入到 systemPrompt
 */
export function getMemorySummaryForPrompt(agentId: AgentRole): string {
  const memories = db.getAgentMemories(agentId, undefined, 20);
  if (memories.length === 0) return '';

  const summary = memories.map(m =>
    `- [${m.category}/${m.importance}] ${m.content}`
  ).join('\n');

  return `

## 你的长期记忆
以下是你在之前会话中保存的重要信息，请参考这些记忆来保持工作的连续性：
${summary}
`;
}
