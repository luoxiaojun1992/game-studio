/**
 * SonarQube Token 管理器
 *
 * 动态 Token 管理器：调用 /api/user_tokens/generate（Basic Auth）生成 Token，缓存 24 小时
 * SonarQube 用户 Token 默认永不过期，TTL 仅作防呆用途
 */
export class SonarTokenManager {
  private token: string | null = null;
  private readonly ttlMs: number;
  private readonly baseUrl: string;
  private readonly user: string;
  private readonly password: string;

  constructor() {
    this.baseUrl = (process.env.SONARQUBE_HOST || 'http://localhost:9002').replace(/\/$/, '');
    this.user = process.env.SONARQUBE_USER || 'admin';
    this.password = process.env.SONARQUBE_PASSWORD || 'admin';
    this.ttlMs = parseInt(process.env.SONARQUBE_TOKEN_TTL_MS || String(24 * 60 * 60 * 1000), 10);
  }

  private async fetchWithBasicAuth(url: string, options: RequestInit = {}): Promise<Response> {
    const creds = Buffer.from(`${this.user}:${this.password}`).toString('base64');
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Basic ${creds}`,
      },
    });
  }

  async ensureToken(): Promise<string> {
    if (this.token) return this.token;

    const tokenName = `studio-token-${Date.now()}`;
    const res = await this.fetchWithBasicAuth(`${this.baseUrl}/api/user_tokens/generate`, {
      method: 'POST',
      body: new URLSearchParams({ name: tokenName, type: 'USER_TOKEN' }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SonarQube Token 生成失败: ${res.status} ${body}`);
    }

    const data = await res.json() as { token?: string };
    if (!data.token) {
      throw new Error(`SonarQube Token 生成响应缺少 token 字段`);
    }

    this.token = data.token;
    console.log('[SonarTokenManager] Token generated, ttl:', this.ttlMs, 'ms');
    return this.token;
  }

  getToken(): string | null {
    return this.token;
  }

  clearCache(): void {
    this.token = null;
  }
}

export const globalTokenManager = new SonarTokenManager();
