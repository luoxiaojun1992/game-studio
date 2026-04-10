/**
 *
 */
import { z } from 'zod';
import { tool, createSdkMcpServer, type SdkMcpServerResult } from '@tencent-ai/agent-sdk';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';
import { AGENT_IDS, AgentRole, getAllAgents } from './agents.js';
import { sseBroadcaster } from './sse-broadcaster.js';

/**
 */
type ToolLogFn = (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
type AutoHandoffHook = (handoff: db.DbHandoff) => Promise<void> | void;
const TEAM_BUILDING_AGENT_ID: AgentRole = 'team_builder';
const CONTENT_PREVIEW_LENGTH = 160;
const FETCH_MULTIPLIER = 4;
const MIN_FETCH_WINDOW = 20;
const MAX_FETCH_WINDOW = 200;
const NO_NEWLINES_PATTERN = /^[^\r\n]*$/;
const toSingleLinePreview = (content: string | null | undefined) =>
  (content || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CONTENT_PREVIEW_LENGTH);

/**
 *
 */
export function createStudioToolsServer(projectId: string, agentId: AgentRole, logFn?: ToolLogFn, onAutoHandoff?: AutoHandoffHook): SdkMcpServerResult {
  const log = logFn || (() => {});
  const scopedProjectId = (projectId || 'default').trim() || 'default';
  const enforceProject = (requested?: string): string => {
    const normalized = (requested || scopedProjectId).trim() || scopedProjectId;
    if (normalized !== scopedProjectId) {
      throw new Error(`禁止跨项目操作：当前项目为 ${scopedProjectId}，请求项目为 ${normalized}`);
    }
    return scopedProjectId;
  };
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
  const validateAgentPermission = (allowed: AgentRole[], action: string): void => {
    if (allowed.includes(agentId)) return;
    throw new Error(`权限不足：${action} 仅允许 ${allowed.join(' / ')}，当前为 ${agentId}`);
  };
  const ALLOWED_HANDOFF_TARGETS: Record<AgentRole, AgentRole[]> = {
    game_designer: ['ceo'],
    ceo: ['architect', 'biz_designer'],
    architect: ['engineer'],
    engineer: ['biz_designer'],
    biz_designer: ['ceo'],
    team_builder: []
  };
  const AGENT_ID_ENUM = z.enum(AGENT_IDS);

  const server = createSdkMcpServer({
    name: 'studio-tools',
    version: '1.0.0',
    tools: [
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
            project_id: scopedProjectId,
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
          keyword: z.string().trim().max(200).optional().describe('按关键词模糊搜索记忆内容，可选，最长 200 字符'),
          limit: z.number().min(1).max(50).optional().default(20).describe('返回条数上限')
        },
        async ({ category, keyword, limit }) => {
          const memories = db.getAgentMemories(scopedProjectId, agentId, {
            category,
            keyword,
            limit
          });
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
      tool(
        'create_handoff',
        '将任务移交给其他团队成员。当你完成自己的工作部分，需要其他 Agent 接手时调用此工具。交接需要管理者确认后目标 Agent 才会开始工作。',
        {
          to_agent_id: AGENT_ID_ENUM.describe(
            '目标 Agent ID：engineer=软件工程师（含软件测试）, architect=架构师, game_designer=游戏策划（含UI设计）, biz_designer=商业策划, ceo=CEO'
          ),
          title: z.string().regex(NO_NEWLINES_PATTERN, '标题不允许包含换行符').describe('简短的任务标题'),
          description: z.string().describe('详细的任务描述'),
          context: z.string().optional().describe(
            '上下文信息：你的工作成果摘要、相关文件路径、关键决策等。这些信息对下一个 Agent 完成任务至关重要。'
          ),
          priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal').describe('任务优先级')
        },
        async ({ to_agent_id, title, description, context, priority }) => {
          const allowedTargets = ALLOWED_HANDOFF_TARGETS[agentId] || [];
          if (!allowedTargets.includes(to_agent_id)) {
            throw new Error(`交接目标不合法：${agentId} 仅可移交给 ${allowedTargets.join(' / ') || '无'}`);
          }
          const now = new Date().toISOString();
          const settings = db.getProjectSettings(scopedProjectId);
          const autoHandoffEnabled = settings.autopilot_enabled === 1;
          const handoff = db.createHandoff({
            id: uuidv4(),
            project_id: scopedProjectId,
            from_agent_id: agentId,
            to_agent_id,
            title,
            description,
            context: context || null,
            status: autoHandoffEnabled ? 'working' : 'pending',
            priority: priority || 'normal',
            result: null,
            accepted_at: autoHandoffEnabled ? now : null,
            completed_at: null,
            source_command_id: null,
            created_at: now,
            updated_at: now,
          });
          sseBroadcaster.broadcast({ type: 'handoff_created', handoff }, scopedProjectId);
          log(agentId, '创建交接', `${agentId} → ${to_agent_id}: ${title}`, 'success');
          if (autoHandoffEnabled && onAutoHandoff) {
            try {
              await onAutoHandoff(handoff);
            } catch (error: any) {
              log(
                to_agent_id,
                '交接任务执行失败',
                `[${agentId} → ${to_agent_id}: ${title}] ${error?.message || String(error)}`,
                'error'
              );
            }
          }
          return {
            content: [{
              type: 'text' as const,
              text: autoHandoffEnabled
                ? `交接已创建并自动接收 (ID: ${handoff.id})，${to_agent_id} 已进入执行状态。`
                : `交接已创建 (ID: ${handoff.id})，等待管理者确认后 ${to_agent_id} 才会开始工作。`
            }]
          };
        }
      ),
      tool(
        'split_dev_test_tasks',
        '将一个功能目标拆分为开发任务和测试任务，并写入任务看板。',
        {
          project_id: z.string().optional().default('default').describe('项目 ID'),
          feature_title: z.string().regex(NO_NEWLINES_PATTERN, '标题不允许包含换行符').describe('功能标题'),
          development_description: z.string().describe('开发任务描述'),
          testing_description: z.string().optional().describe('测试任务描述（不填则自动生成）'),
          priority_hint: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal').describe('优先级提示（用于描述，不影响状态机）')
        },
        async ({ project_id, feature_title, development_description, testing_description, priority_hint }) => {
          validateAgentPermission(['engineer'], '拆分开发与测试任务');
          const targetProjectId = enforceProject(project_id);
          const now = new Date().toISOString();
          const devTask = db.createTaskBoardTask({
            id: uuidv4(),
            project_id: targetProjectId,
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
            project_id: targetProjectId,
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

          sseBroadcaster.broadcast({ type: 'task_created', task: devTask }, targetProjectId);
          sseBroadcaster.broadcast({ type: 'task_created', task: testTask }, targetProjectId);
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
        '查询任务看板中的任务，用于查看待办和当前进度。可选按 agent_id 筛选 created_by/updated_by；不传则查询项目内全部任务。',
        {
          project_id: z.string().optional().describe('项目 ID，不填默认当前项目（且仅允许当前项目）'),
          status: z.enum(['todo', 'developing', 'testing', 'blocked', 'done']).optional().describe('按状态筛选'),
          task_type: z.enum(['development', 'testing']).optional().describe('按任务类型筛选'),
          agent_id: AGENT_ID_ENUM.optional().describe('按创建者/更新者 Agent ID 筛选；不传则查询全部'),
          limit: z.number().min(1).max(100).optional().default(20).describe('返回条数上限')
        },
        async ({ project_id, status, task_type, agent_id, limit }) => {
          const targetProjectId = enforceProject(project_id);
          const tasks = db.getTaskBoardTasks({
            projectId: targetProjectId,
            status,
            taskType: task_type,
            agentId: agent_id,
            limit: limit || 20
          });
          if (tasks.length === 0) {
            return { content: [{ type: 'text' as const, text: '没有匹配的看板任务。' }] };
          }
          const text = tasks.map(t => {
            const rel = t.source_task_id ? ` | 来源:${t.source_task_id}` : '';
            return `[${t.status}/${t.task_type}] ${t.title} (ID:${t.id}, 创建:${t.created_by}, 更新:${t.updated_by || '-'})${rel}`;
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
          validateAgentPermission(['engineer'], '更新任务看板状态');
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
          sseBroadcaster.broadcast({ type: 'task_updated', task: updated }, task.project_id);
          log(agentId, '维护任务状态', `${task.title}: ${task.status} -> ${status}`, 'success');

          return {
            content: [{ type: 'text' as const, text: `任务状态已更新: ${task.id} -> ${status}` }]
          };
        }
      ),
      tool(
        'submit_proposal',
        '提交一份策划案或方案文档（如游戏策划案、商业策划案、技术方案等）。提案提交后将通知管理者进行审批。',
        {
          project_id: z.string().optional().default('default').describe('项目 ID，用于归档到 /output/{project_id}/... 目录'),
          type: z.enum(['game_design', 'biz_design', 'tech_arch', 'tech_impl', 'ceo_review']).describe(
            '提案类型：game_design=游戏策划, biz_design=商业策划, tech_arch=架构方案, tech_impl=技术方案'
          ),
          title: z.string().regex(NO_NEWLINES_PATTERN, '标题不允许包含换行符').describe('提案标题'),
          content: z.string().describe('提案的完整内容（Markdown 格式）')
        },
        async ({ project_id, type, title, content }) => {
          if (type === 'game_design') {
            validateAgentPermission(['game_designer'], '提交游戏策划案');
          } else if (type === 'biz_design') {
            validateAgentPermission(['biz_designer'], '提交商业策划案');
          } else if (type === 'tech_arch') {
            validateAgentPermission(['architect'], '提交技术架构方案');
          } else if (type === 'tech_impl') {
            validateAgentPermission(['engineer'], '提交技术实现方案');
          } else if (type === 'ceo_review') {
            validateAgentPermission(['ceo'], '提交 CEO 评审结论');
          }
          const targetProjectId = enforceProject(project_id);
          const now = new Date().toISOString();
          const proposal = db.createProposal({
            id: uuidv4(),
            project_id: targetProjectId,
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
          sseBroadcaster.broadcast({ type: 'proposal_created', proposal, filePath }, targetProjectId);
          log(agentId, '提交提案', `提案: ${title}${filePath ? ' → 已保存' : ''}`, 'success');
          return {
            content: [{ type: 'text' as const, text: `提案已提交 (ID: ${proposal.id.slice(0, 8)})，等待审批。` }]
          };
        }
      ),
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
          validateAgentPermission(['engineer'], '提交游戏成品');
          const targetProjectId = enforceProject(project_id);
          const now = new Date().toISOString();
          const game = db.createGame({
            id: uuidv4(),
            project_id: targetProjectId,
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
          sseBroadcaster.broadcast({ type: 'game_submitted', game: { ...game, html_content: undefined as any, hasContent: true }, filePath }, targetProjectId);
          log(agentId, '提交游戏', `游戏: ${name} v${version || '1.0.0'}${filePath ? ' → 已保存' : ''}`, 'success');
          return {
            content: [{ type: 'text' as const, text: `游戏已提交 (ID: ${game.id.slice(0, 8)})，名称: ${name}，版本: ${version || '1.0.0'}。` }]
          };
        }
      ),
      tool(
        'get_agent_logs',
        '读取当前项目下你自己的历史日志，用于回顾上下文和最近执行记录。',
        {
          limit: z.number().min(1).max(200).optional().default(20).describe('返回条数上限')
        },
        async ({ limit }) => {
          const logs = db.getLogs(scopedProjectId, agentId, limit);
          if (logs.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '暂无历史日志。' }]
            };
          }
          const text = logs.map(logItem => {
            const actionPart = logItem.action ? `[${logItem.action}] ` : '';
            const toolPart = logItem.tool_name ? ` (tool: ${logItem.tool_name})` : '';
            return `[${logItem.created_at}][${logItem.level}/${logItem.log_type}] ${actionPart}${logItem.content}${toolPart}`;
          }).join('\n');
          return {
            content: [{ type: 'text' as const, text }]
          };
        }
      ),

      tool(
        'get_agents',
        '查询所有 Agent 的信息（含 agent_id、名称、职责等），用于确认可用 Agent ID。',
        {},
        async () => {
          const agents = getAllAgents();
          if (agents.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '当前没有可用的 Agent。' }]
            };
          }
          const text = agents.map(a =>
            `${a.id} | ${a.name} | ${a.title}\n职责: ${a.responsibilities.join('、')}`
          ).join('\n\n');
          return {
            content: [{ type: 'text' as const, text }]
          };
        }
      ),

      tool(
        'get_proposals',
        '查询已有的提案列表，用于了解当前项目的策划案进度。可选按 agent_id 筛选 author/reviewer；不传则查询项目内全部提案。',
        {
          status: z.enum(['pending_review', 'under_review', 'approved', 'rejected', 'revision_needed', 'user_approved', 'user_rejected']).optional().describe('按状态筛选'),
          agent_id: AGENT_ID_ENUM.optional().describe('按作者/评审 Agent ID 筛选；不传则查询全部'),
          limit: z.number().min(1).max(50).optional().default(10).describe('返回条数上限')
        },
        async ({ status, agent_id, limit }) => {
          const proposals = db.getScopedProposals(scopedProjectId, {
            status,
            agentId: agent_id,
            limit: limit || 10
          });
          if (proposals.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '没有找到匹配的提案。' }]
            };
          }
          const text = proposals.map(p =>
            `[${p.status}] ${p.title} (作者: ${p.author_agent_id}, 评审: ${p.reviewer_agent_id || '未分配'}, 类型: ${p.type}, ${p.created_at.slice(0, 10)})`
          ).join('\n');
          return {
            content: [{ type: 'text' as const, text }]
          };
        }
      ),

      tool(
        'get_pending_handoffs',
        '查询待处理的任务交接。可选按 agent_id 筛选发给该 Agent 的交接；不传则查询项目内全部待处理交接。',
        {
          agent_id: AGENT_ID_ENUM.optional().describe('目标 Agent ID（to_agent_id）筛选；不传则查询全部'),
          limit: z.number().min(1).max(20).optional().default(5).describe('返回条数上限')
        },
        async ({ agent_id, limit }) => {
          const handoffs = db.getPendingHandoffs(scopedProjectId, agent_id, limit || 5);
          if (handoffs.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '没有待处理的交接任务。' }]
            };
          }
          const text = handoffs.map(h =>
            `[${h.status}] ${h.title} (来自: ${h.from_agent_id}, 发给: ${h.to_agent_id}, 优先级: ${h.priority}, ${h.created_at.slice(0, 10)})\n  描述: ${h.description.slice(0, 100)}`
          ).join('\n\n');
          return {
            content: [{ type: 'text' as const, text }]
          };
        }
      ),
      tool(
        'get_project_latest_info',
        '查询当前项目最新 n 条关键信息，覆盖提案、任务、交接、日志、记忆，供总结提炼使用。',
        {
          limit: z.number().min(1).max(100).optional().default(20).describe('返回条数上限（跨类型混合排序）')
        },
        async ({ limit }) => {
          validateAgentPermission([TEAM_BUILDING_AGENT_ID], '查询项目最新信息');
          const effectiveLimit = limit || 20;
          const fetchWindow = Math.min(Math.max(effectiveLimit * FETCH_MULTIPLIER, MIN_FETCH_WINDOW), MAX_FETCH_WINDOW);
          const proposals = db.getScopedProposals(scopedProjectId, { limit: fetchWindow });
          const projectTasks = db.getTaskBoardTasks({ projectId: scopedProjectId, limit: fetchWindow });
          const handoffs = db.getAllHandoffs(scopedProjectId, fetchWindow);
          const logs = db.getLogs(scopedProjectId, undefined, fetchWindow);
          const memories = db.getAllAgentMemories(scopedProjectId, fetchWindow);

          const unified = [
            ...proposals.map(item => ({
              timestamp: item.created_at,
              line: `[proposal][${item.status}] ${item.title} | author=${item.author_agent_id} | reviewer=${item.reviewer_agent_id || '-'} | sort_at=${item.created_at} | created_at=${item.created_at}${item.updated_at ? ` | updated_at=${item.updated_at}` : ''}`
            })),
            ...projectTasks.map(item => ({
              timestamp: item.created_at,
              line: `[task][${item.status}/${item.task_type}] ${item.title} | by=${item.created_by} | sort_at=${item.created_at} | created_at=${item.created_at}${item.updated_at ? ` | updated_at=${item.updated_at}` : ''}`
            })),
            ...handoffs.map(item => ({
              timestamp: item.created_at,
              line: `[handoff][${item.status}/${item.priority}] ${item.title} | ${item.from_agent_id}→${item.to_agent_id} | sort_at=${item.created_at} | created_at=${item.created_at}${item.updated_at ? ` | updated_at=${item.updated_at}` : ''}`
            })),
            ...logs.map(item => ({
              timestamp: item.created_at,
              line: `[log][${item.level}/${item.log_type}] ${item.agent_id} | ${item.action || '-'} | ${toSingleLinePreview(item.content)} | sort_at=${item.created_at}`
            })),
            ...memories.map(item => ({
              timestamp: item.created_at,
              line: `[memory][${item.category}/${item.importance}] ${item.agent_id} | ${toSingleLinePreview(item.content)} | sort_at=${item.created_at} | created_at=${item.created_at}${item.updated_at ? ` | updated_at=${item.updated_at}` : ''}`
            }))
          ]
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, effectiveLimit);

          if (unified.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '当前项目暂无可用于总结的信息。' }]
            };
          }

          return {
            content: [{ type: 'text' as const, text: unified.map(item => item.line).join('\n') }]
          };
        }
      )
    ]
  });

  return server;
}

/**
 */
export function getMemorySummaryForPrompt(projectId: string, agentId: AgentRole): string {
  const memories = db.getAgentMemories(projectId, agentId, { limit: 20 });
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
