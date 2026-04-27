/**
 * SonarQube 客户端（只读 — 仅用于查询 issues）
 *
 * submitAnalysis 已迁移至 scanner 微服务（sonar-scanner-service），
 * 此处仅保留 ping / getProjectIssues / ensureProject 查询方法。
 */

export interface SonarQubeIssue {
  key: string;
  rule: string;
  severity: string;
  component: string;
  line?: number;
  message: string;
  type: string;
}

interface SonarIssuesResponse {
  issues: SonarQubeIssue[];
  total: number;
}

export class SonarQubeClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  private authHeaders(): Record<string, string> {
    const creds = Buffer.from(`${this.token}:`).toString('base64');
    return { Authorization: `Basic ${creds}` };
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/system/health`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch { return false; }
  }

  async ensureProject(projectKey: string, projectName: string): Promise<void> {
    const getRes = await fetch(
      `${this.baseUrl}/api/projects/search?projects=${encodeURIComponent(projectKey)}`,
      { headers: this.authHeaders(), signal: AbortSignal.timeout(10000) }
    );
    if (getRes.ok) {
      const data = await getRes.json() as { projects?: Array<{ key: string }> };
      if (data.projects?.some(p => p.key === projectKey)) return;
    }

    const cr = await fetch(`${this.baseUrl}/api/projects/create`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: new URLSearchParams({ name: projectName, project: projectKey, visibility: 'public' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!cr.ok) {
      const body = await cr.text();
      if (!body.includes('key already exists')) {
        throw new Error(`SonarQube 项目创建失败: ${cr.status} ${body}`);
      }
    }
  }

  async getProjectIssues(projectKey: string): Promise<SonarQubeIssue[]> {
    const all: SonarQubeIssue[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        `${this.baseUrl}/api/issues/search?projects=${encodeURIComponent(projectKey)}&ps=100&p=${page}`,
        { headers: this.authHeaders(), signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) throw new Error(`SonarQube issues 查询失败: ${res.status}`);
      const data = await res.json() as SonarIssuesResponse;
      all.push(...data.issues);
      if (all.length >= data.total) break;
      page++;
    }
    return all;
  }
}
