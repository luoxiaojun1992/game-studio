/**
 * SonarQube 代码质量扫描检查器
 *
 * 通过 SonarQube REST API 对游戏内容进行静态质量分析。
 *
 * 工作流程：
 * 1. 创建/获取 SonarQube 项目（projectKey 来自 context 或自动生成）
 * 2. 上传游戏 ZIP 包作为分析源码
 * 3. 触发扫描任务并轮询直到完成
 * 4. 从 SonarQube 问题列表中提取 LintIssue
 *
 * 依赖 SonarQube 服务运行于 http://localhost:9002（.env SONARQUBE_PORT=9002）
 * 认证凭证：.env SONARQUBE_DB_PASSWORD（默认 sonarpass）
 */
import type { LintChecker } from '../types.js';
export declare const sonarqubeChecker: LintChecker;
