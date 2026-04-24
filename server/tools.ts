/**
 *
 */
import { z } from 'zod';
import { tool, createSdkMcpServer, type SdkMcpServerResult } from '@tencent-ai/agent-sdk';
import yazl from 'yazl';
import type { Stats } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';
import { AGENT_IDS, AgentRole, getAllAgents } from './agents.js';
import { sseBroadcaster } from './sse-broadcaster.js';
import { lintGameContent, lintZipBuffer, type LintIssue } from './lint/index.js';
import { getCachedSonarIssues, clearCachedSonarIssues, globalTokenManager } from './lint/checkers/sonarqube.js';
import {
  createFileStorageRecord,
  uploadBuffer,
  getPresignedDownloadUrl
} from './file-storage.js';
import {
  createBlenderProject,
  listBlenderProjects,
  deleteBlenderProject,
  blenderCreateMesh,
  blenderAddMaterial,
  blenderExportModel,
  downloadModelFile,
  deleteModelFile,
  type CreateBlenderProjectOptions,
  type DeleteBlenderProjectOptions,
  type BlenderCreateMeshOptions,
  type BlenderAddMaterialOptions,
  type BlenderExportModelOptions,
  type DownloadModelFileOptions,
  type DeleteModelFileOptions,
} from './creator-service.js';

/**
 */
type ToolLogFn = (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
type AutoHandoffHook = (handoff: db.DbHandoff) => Promise<void> | void;
const TEAM_BUILDING_AGENT_ID: AgentRole = 'team_builder';
const CONTENT_PREVIEW_LENGTH = 160;
const FETCH_MULTIPLIER = 4;
const MIN_FETCH_WINDOW = 20;
const MAX_FETCH_WINDOW = 200;
const singleLineTitleSchema = (fieldName: string) =>
  z.string().transform((value, ctx) => {
    try {
      return db.normalizeAndValidateTitle(value, fieldName);
    } catch (error: any) {
      ctx.addIssue({ code: 'custom', message: error?.message || `${fieldName} 验证失败` });
      return z.NEVER;
    }
  });
const requiredTextSchema = (fieldName: string) =>
  z.string().transform((value, ctx) => {
    try {
      return db.normalizeAndValidateRequiredText(value, fieldName);
    } catch (error: any) {
      ctx.addIssue({ code: 'custom', message: error?.message || `${fieldName} 验证失败` });
      return z.NEVER;
    }
  });
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
  // 安全锚点：来自 API 请求的权威 project_id，直接注入到所有工具作用域中
  const scopedProjectId = (projectId || 'default').trim() || 'default';
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
          to_agent_id: AGENT_ID_ENUM
            .refine((value) => value !== TEAM_BUILDING_AGENT_ID, { message: 'to_agent_id 不支持 team_builder' })
            .describe(
              '目标 Agent ID：engineer=软件工程师（含软件测试）, architect=架构师, game_designer=游戏策划（含UI设计）, biz_designer=商业策划, ceo=CEO（不支持 team_builder）'
            ),
          title: singleLineTitleSchema('title').describe('简短的任务标题'),
          description: requiredTextSchema('description').describe('详细的任务描述'),
          context: z.string().optional().describe(
            '上下文信息：你的工作成果摘要、相关文件路径、关键决策等。这些信息对下一个 Agent 完成任务至关重要。'
          ),
          priority: z.enum(db.HANDOFF_PRIORITIES).optional().default('normal').describe('任务优先级')
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
          feature_title: singleLineTitleSchema('feature_title').describe('功能标题'),
          development_description: requiredTextSchema('development_description').describe('开发任务描述'),
          testing_description: z.string().optional().transform((value, ctx) => {
            if (value === undefined) return undefined;
            try {
              const normalized = db.normalizeOptionalText(value, 'testing_description');
              return normalized || undefined;
            } catch (error: any) {
              ctx.addIssue({ code: 'custom', message: error?.message || 'testing_description 验证失败' });
              return z.NEVER;
            }
          }).describe('测试任务描述（不填则自动生成）'),
          priority_hint: z.enum(db.HANDOFF_PRIORITIES).optional().default('normal').describe('优先级提示（用于描述，不影响状态机）')
        },
        async ({ feature_title, development_description, testing_description, priority_hint }) => {
          validateAgentPermission(['engineer'], '拆分开发与测试任务');
          const now = new Date().toISOString();
          const devTask = db.createTaskBoardTask({
            id: uuidv4(),
            project_id: scopedProjectId,
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
            project_id: scopedProjectId,
            title: `测试：${feature_title}`,
            description: testing_description || `验证"${feature_title}"功能正确性与回归影响，覆盖功能、边界和异常路径。`,
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

          sseBroadcaster.broadcast({ type: 'task_created', task: devTask }, scopedProjectId);
          sseBroadcaster.broadcast({ type: 'task_created', task: testTask }, scopedProjectId);
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
          status: z.enum(db.TASK_STATUSES).optional().describe('按状态筛选'),
          task_type: z.enum(db.TASK_TYPES).optional().describe('按任务类型筛选'),
          agent_id: AGENT_ID_ENUM.optional().describe('按创建者/更新者 Agent ID 筛选；不传则查询全部'),
          limit: z.number().min(1).max(100).optional().default(20).describe('返回条数上限')
        },
        async ({ status, task_type, agent_id, limit }) => {
          const tasks = db.getTaskBoardTasks({
            projectId: scopedProjectId,
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
          status: z.enum(db.TASK_STATUSES).describe('目标状态')
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
          type: z.enum(db.PROPOSAL_TYPES).describe(
            '提案类型：game_design=游戏策划, biz_design=商业策划, tech_arch=架构方案, tech_impl=技术方案'
          ),
          title: singleLineTitleSchema('title').describe('提案标题'),
          content: requiredTextSchema('content').describe('提案的完整内容（Markdown 格式）')
        },
        async ({ type, title, content }) => {
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
          const now = new Date().toISOString();
          const proposal = db.createProposal({
            id: uuidv4(),
            project_id: scopedProjectId,
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
          sseBroadcaster.broadcast({ type: 'proposal_created', proposal, filePath }, scopedProjectId);
          log(agentId, '提交提案', `提案: ${title}${filePath ? ' → 已保存' : ''}`, 'success');
          return {
            content: [{ type: 'text' as const, text: `提案已提交 (ID: ${proposal.id.slice(0, 8)})，等待审批。` }]
          };
        }
      ),

      tool(
        'submit_game',
        '提交一个完成的游戏成品（仅 engineer 可用）。支持两种模式：1) 单文件 HTML 模式（传入 html_content）；2) 文件打包模式（传入 file_path）。文件打包模式下，游戏文件夹会被压缩为 ZIP 并上传到 MinIO 存储。\n\n⚠️ 提交前请确保游戏通过以下 lint 检查（error 级别规则阻断提交）：\n- HTML 结构：必须包含 DOCTYPE、html/head/body 标签、UTF-8 编码声明，body 内容非空\n- HTTP 安全：fetch / XMLHttpRequest 仅允许 GET/OPTIONS/HEAD/CONNECT/TRACE 方法，禁止 POST/PUT/DELETE/PATCH 等\n- JS 安全（warn，不阻断）：eval、Function()、javascript: 协议、innerHTML 赋值等高风险模式需自查',
        {
          name: z.string().max(db.MAX_FILENAME_LENGTH, `name 长度不能超过 ${db.MAX_FILENAME_LENGTH}`).transform((value, ctx) => {
            try {
              return db.normalizeAndValidateRequiredText(value, 'name');
            } catch (error: any) {
              ctx.addIssue({ code: 'custom', message: error?.message || 'name 验证失败' });
              return z.NEVER;
            }
          }).describe('游戏名称'),
          html_content: z.string().min(db.MIN_GAME_HTML_LENGTH, `html_content 长度不能少于 ${db.MIN_GAME_HTML_LENGTH}`).transform((value, ctx) => {
            try {
              return db.normalizeAndValidateRequiredText(value, 'html_content');
            } catch (error: any) {
              ctx.addIssue({ code: 'custom', message: error?.message || 'html_content 验证失败' });
              return z.NEVER;
            }
          }).describe('完整的游戏 HTML 代码（必须是包含所有 CSS/JS 的单文件 HTML）。与 file_path 二选一，不能同时为空。'),
          file_path: z.string().optional().describe('游戏产出文件/文件夹路径（相对于 output/<当前项目ID>）。与 html_content 二选一，不能同时为空。例如：games/my-game 或 games/my-game/index.html'),
          description: z.string().optional().describe('游戏简介'),
          version: z.preprocess(
            (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
            z.string().max(db.MAX_VERSION_LENGTH, `version 长度不能超过 ${db.MAX_VERSION_LENGTH}`).transform((value, ctx) => {
              try {
                return db.normalizeAndValidateRequiredText(value, 'version');
              } catch (error: any) {
                ctx.addIssue({ code: 'custom', message: error?.message || 'version 验证失败' });
                return z.NEVER;
              }
            }).optional().default('1.0.0')
          ).describe('版本号'),
          proposal_id: z.string().optional().describe('关联的策划案 ID（如果有）')
        },
        async ({ name, html_content, file_path, description, version, proposal_id }) => {
          validateAgentPermission(['engineer'], '提交游戏成品');

          const hasHtmlContent = typeof html_content === 'string' && html_content.length >= db.MIN_GAME_HTML_LENGTH;
          const hasFilePath = typeof file_path === 'string' && file_path.trim().length > 0;

          if (!hasHtmlContent && !hasFilePath) {
            return {
              content: [{ type: 'text' as const, text: '提交游戏失败：html_content 或 file_path 至少需要提供一个。' }]
            };
          }

          let fileStorageId: string | null = null;
          let sonarStorageId: string | null = null;

          // ========== 文件打包模式 ==========
          if (hasFilePath) {
            // 路径校验：只允许 output/{project_id} 下的路径
            const { execSync } = await import('child_process');
            const pathModule = await import('path');
            const fsModule = await import('fs');

            const outputDir = pathModule.resolve(pathModule.join(__dirname, '..', 'output', scopedProjectId));
            let targetPath: string;
            try {
              targetPath = pathModule.resolve(outputDir, file_path);
              // 检查路径是否在 output/{project_id} 下
              if (!targetPath.startsWith(outputDir + pathModule.sep) && targetPath !== outputDir) {
                return {
                  content: [{ type: 'text' as const, text: `提交游戏失败：file_path 只能在 output/${scopedProjectId} 目录下。` }]
                };
              }
            } catch (error: any) {
              return {
                content: [{ type: 'text' as const, text: `提交游戏失败：无效的 file_path。` }]
              };
            }

            // 检查路径是否存在
            let stat: Stats;
            try {
              stat = fsModule.statSync(targetPath);
            } catch {
              return {
                content: [{ type: 'text' as const, text: `提交游戏失败：file_path 不存在。` }]
              };
            }

            // 创建临时 ZIP 文件
            const zipId = uuidv4();
            const zipName = `${scopedProjectId}_${zipId}.zip`;
            const zipTempPath = pathModule.join('/tmp', zipName);

            try {
              // 切换到 output/{project_id} 目录执行 zip，保留相对路径
              const parentDir = stat.isDirectory() ? outputDir : pathModule.dirname(targetPath);
              const entryName = stat.isDirectory() ? file_path : file_path;

              // 使用 -j 保留相对路径打包
              const zipCmd = stat.isDirectory()
                ? `cd ${parentDir} && zip -r ${zipTempPath} ${entryName}`
                : `cd ${parentDir} && zip ${zipTempPath} ${entryName}`;

              execSync(zipCmd, { stdio: 'pipe' });

              if (!fsModule.existsSync(zipTempPath)) {
                return {
                  content: [{ type: 'text' as const, text: '提交游戏失败：ZIP 打包失败。' }]
                };
              }

              // 直接调用内部函数上传文件到 MinIO
              const objectKey = `games/${zipName}`;
              const fileSize = fsModule.statSync(zipTempPath).size;
              const fileBuffer = fsModule.readFileSync(zipTempPath);

              // lint 检查：ZIP 内每个 HTML 逐一检查，遇第一个 error 即阻断
              const zipLintResult = await lintZipBuffer(fileBuffer, { projectId: scopedProjectId });
              if (!zipLintResult.passed) {
                try { fsModule.unlinkSync(zipTempPath); } catch { /* ignore */ }
                return {
                  content: [{ type: 'text' as const, text: `提交游戏失败：\n${zipLintResult.summary}` }]
                };
              }
              if (zipLintResult.warnings.length > 0) {
                log(agentId, '提交游戏-lint', `警告: ${zipLintResult.warnings.map(w => w.message).join('; ')}`, 'warn');
              }

              // === Sonar 报告生成：复用 lintZipBuffer 缓存的 raw issues ===
              const scopedProjectKey = `game-${scopedProjectId}`;
              const cachedSonarIssues = getCachedSonarIssues(scopedProjectKey) ?? [];

              // 使用 yazl 将 sonar-issues.json 追加到 ZIP（不改变原文件内容）
              const sonarReportBuffer = Buffer.from(
                JSON.stringify({ version: '1.0', issues: cachedSonarIssues }, null, 2),
                'utf-8'
              );
              const finalZipBuffer = await new Promise<Buffer>((resolve, reject) => {
                const zip = new yazl.ZipFile();
                zip.addBuffer(fileBuffer, zipName);
                zip.addBuffer(sonarReportBuffer, 'sonar-issues.json');
                zip.end((err: Error | undefined) => {
                  if (err) reject(err);
                });
                const chunks: Buffer[] = [];
                zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
                zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
                zip.outputStream.on('error', reject);
              });
              const finalFileSize = finalZipBuffer.length;

              // 清理 lint 缓存
              clearCachedSonarIssues(scopedProjectKey);

              try {
                // 创建游戏文件存储记录
                const { storage: gameStorage } = await createFileStorageRecord({
                  project_id: scopedProjectId,
                  object_key: objectKey,
                  file_name: zipName,
                  file_size: finalFileSize,
                  content_type: 'application/zip'
                });
                fileStorageId = gameStorage.id;

                // 上传含 sonar 报告的最终 ZIP 到 MinIO
                await uploadBuffer(finalZipBuffer, objectKey, 'application/zip');

                // 上传独立 sonar-issues.json 报告到 MinIO
                const sonarObjectKey = `sonar/${zipName}`;
                const { storage: sonarStorage } = await createFileStorageRecord({
                  project_id: scopedProjectId,
                  object_key: sonarObjectKey,
                  file_name: `${zipName.replace('.zip', '')}-sonar-issues.json`,
                  file_size: sonarReportBuffer.length,
                  content_type: 'application/json'
                });
                sonarStorageId = sonarStorage.id;
                await uploadBuffer(sonarReportBuffer, sonarObjectKey, 'application/json');

              } catch (error: any) {
                return {
                  content: [{ type: 'text' as const, text: `提交游戏失败：文件上传异常 ${error?.message || String(error)}` }]
                };
              } finally {
                // 清理临时文件
                try { fsModule.unlinkSync(zipTempPath); } catch { /* ignore */ }
              }

            } catch (error: any) {
              try { fsModule.unlinkSync(zipTempPath); } catch { /* ignore */ }
              return {
                content: [{ type: 'text' as const, text: `提交游戏失败：ZIP 打包失败 ${error?.message || String(error)}` }]
              };
            }

            // 创建游戏记录（使用 placeholder html_content）
            const now = new Date().toISOString();
            let game: db.DbGame;
            try {
              game = db.createGame({
                id: uuidv4(),
                project_id: scopedProjectId,
                name,
                description: description || null,
                html_content: 'FILE_ONLY',
                proposal_id: proposal_id || null,
                version: version || '1.0.0',
                status: 'draft',
                file_storage_id: fileStorageId,
                sonar_storage_id: sonarStorageId,
                created_at: now,
                updated_at: now
              });
            } catch (error: any) {
              return {
                content: [{ type: 'text' as const, text: `提交游戏失败：${error?.message || String(error)}` }]
              };
            }

            sseBroadcaster.broadcast({ type: 'game_submitted', game: { ...game, html_content: undefined as any, hasContent: false, fileStorageId, sonarStorageId }, filePath: null }, scopedProjectId);
            log(agentId, '提交游戏', `游戏: ${name} v${version || '1.0.0'} [文件模式，ZIP: ${zipName}，Sonar报告: sonar/${zipName}]`, 'success');
            return {
              content: [{ type: 'text' as const, text: `游戏已提交 (ID: ${game.id.slice(0, 8)})，名称: ${name}，版本: ${version || '1.0.0'}，文件已上传到存储。` }]
            };
          }

          // ========== HTML 内容模式 ==========
          // Lint 检查：在写入 DB 前对游戏 HTML 进行静态质量检查
          const lintResult = await lintGameContent(html_content, { fileName: `${name}.html`, projectId: scopedProjectId });
          if (!lintResult.passed) {
            return {
              content: [{ type: 'text' as const, text: `提交游戏失败：\n${lintResult.summary}` }]
            };
          }
          if (lintResult.warnings.length > 0) {
            log(agentId, '提交游戏-lint', `警告: ${lintResult.warnings.map((w: LintIssue) => w.message).join('; ')}`, 'warn');
          }

          const now = new Date().toISOString();
          let game: db.DbGame;
          try {
            game = db.createGame({
              id: uuidv4(),
              project_id: scopedProjectId,
              name,
              description: description || null,
              html_content,
              proposal_id: proposal_id || null,
              version: version || '1.0.0',
              status: 'draft',
              file_storage_id: null,
              sonar_storage_id: null,
              created_at: now,
              updated_at: now
            });
          } catch (error: any) {
            return {
              content: [{ type: 'text' as const, text: `提交游戏失败：${error?.message || String(error)}` }]
            };
          }
          const filePath = db.saveGameToFile(game);
          sseBroadcaster.broadcast({ type: 'game_submitted', game: { ...game, html_content: undefined as any, hasContent: true }, filePath }, scopedProjectId);
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
        '查询所有 Agent 的信息（含 agent_id、名称、职责等），用于确认可用 Agent ID。此工具不涉及项目数据，无需传 project_id。',
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
          status: z.enum(db.PROPOSAL_STATUSES).optional().describe('按状态筛选'),
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
        'get_games',
        '获取当前项目下已提交的游戏成品列表，按时间倒序返回。用于查看有哪些游戏已提交及其基本信息。',
        {
          limit: z.number().min(1).max(100).optional().default(20).describe('返回条数上限')
        },
        async ({ limit }) => {
          const allGames = db.getAllGames().filter(g => g.project_id === scopedProjectId);
          const games = allGames.slice(0, limit || 20).map(g => ({
            id: g.id,
            name: g.name,
            description: g.description,
            version: g.version,
            status: g.status,
            created_at: g.created_at,
            hasContent: g.html_content !== 'FILE_ONLY',
            isFileOnly: g.html_content === 'FILE_ONLY'
          }));
          if (games.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '当前项目下还没有提交过游戏。' }]
            };
          }
          const lines = games.map(g =>
            `[${g.status}] ${g.name} v${g.version} | ${g.isFileOnly ? '文件模式' : 'HTML模式'} | ${g.created_at.slice(0, 10)}`
          ).join('\n');
          return {
            content: [{ type: 'text' as const, text: lines }]
          };
        }
      ),

      tool(
        'get_game_info',
        '获取指定游戏的详细信息。若为 HTML 模式游戏则返回完整 HTML 内容（可直接在浏览器预览）；若为文件模式游戏则返回 MinIO presigned 下载链接。',
        {
          game_id: z.string().describe('游戏 ID')
        },
        async ({ game_id }) => {
          const game = db.getGame(game_id);
          if (!game) {
            return {
              content: [{ type: 'text' as const, text: `游戏不存在：${game_id}` }]
            };
          }
          if (game.project_id !== scopedProjectId) {
            return {
              content: [{ type: 'text' as const, text: '游戏不存在或无权限访问。' }]
            };
          }
          // HTML 模式：直接返回完整内容
          if (game.html_content !== 'FILE_ONLY') {
            const result = {
              id: game.id,
              name: game.name,
              description: game.description,
              version: game.version,
              status: game.status,
              created_at: game.created_at,
              hasContent: true,
              isFileOnly: false,
              html_content: game.html_content
            };
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }]
            };
          }
          // 文件模式：生成 MinIO presigned 下载链接
          const storage = db.getFileStorage(game.file_storage_id!);
          if (!storage) {
            return {
              content: [{ type: 'text' as const, text: `游戏文件记录不存在（ID: ${game.file_storage_id}），无法获取下载链接。` }]
            };
          }
          const fullObjectKey = `${storage.project_id}/${storage.object_key}`;
          let downloadUrl: string;
          try {
            downloadUrl = await getPresignedDownloadUrl(fullObjectKey);
          } catch (error: any) {
            return {
              content: [{ type: 'text' as const, text: `生成下载链接失败：${error?.message || String(error)}` }]
            };
          }
          const result = {
            id: game.id,
            name: game.name,
            description: game.description,
            version: game.version,
            status: game.status,
            created_at: game.created_at,
            hasContent: false,
            isFileOnly: true,
            downloadUrl
          };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }]
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
      ),

      // ---- Blender / 建模工具（仅 engineer 可用）----

      tool(
        'blender_create_project',
        '创建建模 project（仅 engineer 可用）。在 backend 数据库创建记录，然后调用 creator service 创建容器内项目目录，返回 blender_project_id。建议在完成建模工作后调用 blender_delete_project 清理资源。',
        {
          name: z.string().min(1).max(50).describe('建模 project 名称'),
        },
        async ({ name }) => {
          const opts: CreateBlenderProjectOptions = {
            projectId: scopedProjectId,
            name,
            agentId,
            logFn: log,
          };
          const { dbId, blenderProjectId } = await createBlenderProject(opts);
          return {
            content: [{
              type: 'text' as const,
              text: `建模 project 已创建 (DB ID: ${dbId.slice(0, 8)}, blender_project_id: ${blenderProjectId})，名称: ${name}`,
            }]
          };
        }
      ),

      tool(
        'blender_list_projects',
        '列出当前 studio project 下所有建模 project（仅 engineer 可用）。',
        {
          limit: z.number().min(1).max(50).optional().default(20).describe('返回条数上限'),
        },
        async ({ limit }) => {
          const records = listBlenderProjects(scopedProjectId, limit || 20);
          if (records.length === 0) {
            return { content: [{ type: 'text' as const, text: '暂无建模 project。' }] };
          }
          const lines = records.map(r =>
            `[${r.id.slice(0, 8)}] ${r.name} | blender_project_id=${r.blender_project_id} | ${r.created_at.slice(0, 10)}`
          ).join('\n');
          return { content: [{ type: 'text' as const, text: lines }] };
        }
      ),

      tool(
        'blender_delete_project',
        '删除建模 project（仅 engineer 可用）。先调用 creator service 删除远程目录（幂等），再删除 backend DB 记录。建议完成模型文件下载后主动调用以释放容器存储空间。',
        {
          blender_project_id: z.string().describe('blender_project_id（来自 blender_create_project 的返回值）'),
        },
        async ({ blender_project_id }) => {
          if (!blender_project_id || typeof blender_project_id !== 'string') {
            throw new Error('blender_project_id 不能为空');
          }
          const opts: DeleteBlenderProjectOptions = {
            projectId: scopedProjectId,
            blenderProjectId: blender_project_id.trim(),
            agentId,
            logFn: log,
          };
          await deleteBlenderProject(opts);
          return {
            content: [{ type: 'text' as const, text: `建模 project 已删除 (blender_project_id: ${blender_project_id})` }]
          };
        }
      ),

      tool(
        'blender_create_mesh',
        '在 Blender 场景中创建一个基础几何体（立方体/球体/平面/圆柱体/圆环/圆锥）（仅 engineer 可用）。',
        {
          blender_project_id: z.string().describe('blender_project_id'),
          mesh_type: z.enum(['cube', 'sphere', 'plane', 'cylinder', 'torus', 'cone']).describe('几何体类型'),
          name: z.string().min(1).max(64).describe('物体名称'),
          location: z.tuple([z.number(), z.number(), z.number()]).optional()
            .describe('位置 (x, y, z)，默认 (0, 0, 0)'),
          scale: z.tuple([z.number(), z.number(), z.number()]).optional()
            .describe('缩放 (x, y, z)，默认 (1, 1, 1)'),
        },
        async ({ blender_project_id, mesh_type, name, location, scale }) => {
          if (!blender_project_id || typeof blender_project_id !== 'string') {
            throw new Error('blender_project_id 不能为空');
          }
          const opts: BlenderCreateMeshOptions = {
            blenderProjectId: blender_project_id.trim(),
            meshType: mesh_type,
            name,
            location,
            scale,
            agentId,
            logFn: log,
          };
          const output = await blenderCreateMesh(opts);
          return {
            content: [{ type: 'text' as const, text: `已创建 ${mesh_type} "${name}"。${output}` }]
          };
        }
      ),

      tool(
        'blender_add_material',
        '为 Blender 场景中的物体添加 PBR 材质（仅 engineer 可用）。',
        {
          blender_project_id: z.string().describe('blender_project_id'),
          object_name: z.string().min(1).max(64).describe('物体名称'),
          color: z.tuple([z.number(), z.number(), z.number()]).optional()
            .describe('颜色 RGB (0-1)，默认 (0.8, 0.8, 0.8)'),
          metallic: z.number().min(0).max(1).optional().describe('金属度 0-1，默认 0'),
          roughness: z.number().min(0).max(1).optional().describe('粗糙度 0-1，默认 0.5'),
        },
        async ({ blender_project_id, object_name, color, metallic, roughness }) => {
          if (!blender_project_id || typeof blender_project_id !== 'string') {
            throw new Error('blender_project_id 不能为空');
          }
          const opts: BlenderAddMaterialOptions = {
            blenderProjectId: blender_project_id.trim(),
            objectName: object_name,
            color,
            metallic,
            roughness,
            agentId,
            logFn: log,
          };
          const output = await blenderAddMaterial(opts);
          return {
            content: [{ type: 'text' as const, text: `材质已添加到 "${object_name}"。${output}` }]
          };
        }
      ),

      tool(
        'blender_export_model',
        '将 Blender 场景中的物体导出为模型文件（GLB/FBX/OBJ/PLY/USD）（仅 engineer 可用）。',
        {
          blender_project_id: z.string().describe('blender_project_id'),
          object_name: z.string().min(1).max(64).describe('要导出的物体名称'),
          output_filename: z.string().min(1).max(128).describe('输出文件名（含扩展名，如 model.glb）'),
          format: z.enum(['glb', 'fbx', 'obj', 'ply', 'usd']).optional().default('glb').describe('导出格式'),
        },
        async ({ blender_project_id, object_name, output_filename, format }) => {
          if (!blender_project_id || typeof blender_project_id !== 'string') {
            throw new Error('blender_project_id 不能为空');
          }
          const opts: BlenderExportModelOptions = {
            blenderProjectId: blender_project_id.trim(),
            objectName: object_name,
            outputFilename: output_filename,
            format,
            agentId,
            logFn: log,
          };
          const output = await blenderExportModel(opts);
          return {
            content: [{ type: 'text' as const, text: `已导出 "${object_name}" 为 ${format || 'glb'} 格式：${output_filename}。${output}` }]
          };
        }
      ),

      tool(
        'blender_download_model_file',
        '从 creator service 下载模型文件到 backend 本地 output 目录（仅 engineer 可用）。下载完成后应主动调用 blender_delete_model_file 清理 creator 远程资源。',
        {
          blender_project_id: z.string().describe('blender_project_id'),
          filename: z.string().min(1).max(128).describe('要下载的文件名'),
        },
        async ({ blender_project_id, filename }) => {
          if (!blender_project_id || typeof blender_project_id !== 'string') {
            throw new Error('blender_project_id 不能为空');
          }
          if (!filename || typeof filename !== 'string' || !filename.trim()) {
            throw new Error('filename 不能为空');
          }
          // 使用动态 import 解析 __dirname（ESM）
          const pathModule = await import('path');
          const localOutputDir = pathModule.resolve(__dirname, '..', 'output', scopedProjectId, 'models');
          const opts: DownloadModelFileOptions = {
            blenderProjectId: blender_project_id.trim(),
            filename: filename.trim(),
            localOutputDir,
            agentId,
            logFn: log,
          };
          const { localPath, sizeBytes } = await downloadModelFile(opts);
          return {
            content: [{
              type: 'text' as const,
              text: `文件已下载到：${localPath} (${sizeBytes} bytes)`,
            }]
          };
        }
      ),

      tool(
        'blender_delete_model_file',
        '删除 creator 远程模型文件（幂等）（仅 engineer 可用）。下载到本地后应先调用此工具删除远程文件，再删除本地副本以释放容器存储空间。',
        {
          blender_project_id: z.string().describe('blender_project_id'),
          filename: z.string().min(1).max(128).describe('要删除的文件名'),
        },
        async ({ blender_project_id, filename }) => {
          if (!blender_project_id || typeof blender_project_id !== 'string') {
            throw new Error('blender_project_id 不能为空');
          }
          if (!filename || typeof filename !== 'string' || !filename.trim()) {
            throw new Error('filename 不能为空');
          }
          const pathModule = await import('path');
          const localOutputDir = pathModule.resolve(__dirname, '..', 'output', scopedProjectId, 'models');
          const opts: DeleteModelFileOptions = {
            blenderProjectId: blender_project_id.trim(),
            filename: filename.trim(),
            localOutputDir,
            agentId,
            logFn: log,
          };
          await deleteModelFile(opts);
          return {
            content: [{ type: 'text' as const, text: `已删除模型文件：${filename}（远程 + 本地）` }]
          };
        }
      ),

    ]
  });

  return server;
}

export function getMemorySummaryForPrompt(projectId: string, agentId: string): string {
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

