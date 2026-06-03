# Phaser Mobile 游戏工程规范

> **SPEC-010** | 状态：设计中

## 概述

本文档是 `phaser-mobile` 游戏类型的工程规范，基于 [GAME_ENGINEERING_COMMON.md](./GAME_ENGINEERING_COMMON.md) 中的公共规范扩展。

**使用方式：**
1. Engineer Agent 先读取 `metadata.json` 中的 `game_type` 字段。
2. 若 `game_type === "phaser-mobile"`，同时加载本规范和公共规范。
3. 公共规范中的规则自动生效，本规范中的规则附加生效。

## 适用范围
- `metadata.json` 中 `game_type` MUST 为 `"phaser-mobile"`。
- 面向基于 Phaser 3 的移动端 2D 游戏（通过 Capacitor 打包 Android/iOS APK）。
- 以 **Phaser Scene 模型 + Vite 构建 + Capacitor 原生打包** 作为标准交付形态。
- 本文档中 **MUST** / **MUST NOT** / **SHOULD** 遵循 RFC 2119 定义。

## 框架选型（固定边界）

| 层级 | 选型 | 最低版本 | 说明 |
|------|------|---------|------|
| 游戏引擎 | Phaser 3 | >=3.80.0 | 2D 引擎，内置物理/音频/补间，MIT 协议 |
| 移动打包 | Capacitor | >=8.0.0 | Web → 原生 App，CI 自动构建 APK/AAB |
| 语言 | TypeScript | >=5.4.0 | 强类型，ES Module |
| 构建 | Vite | >=8.0.0 | 秒级 HMR，`base: './'` 相对路径输出 |
| 后端 | 无 | — | 纯离线单机，不依赖服务端 |
| TTS | Web Speech API（浏览器原生） | — | 零依赖，离线可用。或 Phaser 内置音频播放预生成 MP3 |
| 存档 | `localStorage` | — | 通过 `SaveManager` 封装，key 使用项目前缀防冲突 |

> **说明**：Phaser 3 已内置 Arcade Physics、Tweens 补间动画、Web Audio 音频管理，**不需要**单独引入 Matter.js、Howler.js、@tweenjs/tween.js 等外部库。

## 目录结构

### 提交产物结构（lint checker 扫描目标）
```
dist/
  index.html          # MUST 存在。phaser-mobile 类型下 entry 固定为 dist/index.html
  metadata.json       # MUST 存在（game_type: "phaser-mobile"），其中 entry 字段须填写 "index.html"
  assets/
    ...               # Vite 构建输出的 JS/CSS/资源文件
```

> **说明**：metadata.json 中的 `entry` 字段在 phaser-mobile 类型下语义为**相对提交产物根目录**的入口路径。由于 phaser-mobile 框架规范固定入口为 `dist/index.html`，checker 实际检查 `{submitDir}/dist/index.html`。但 `entry` 作为公共必填字段仍须填写，值为 `"index.html"`。

### 开发期目录结构（供 Engineer Agent 参考）
```
game/
  index.html              # HTML 入口，加载 Phaser 脚本
  metadata.json           # 元信息
  src/
    main.ts               # Phaser.Game 实例创建入口（固定）
    config/
      game-config.ts      # Phaser.Types.Core.GameConfig（画布尺寸、物理引擎、场景列表）
    scenes/               # Phaser Scene 目录
      BootScene.ts        # 预加载场景（preload 加载所有贴图/音频/精灵表）
      MainMenuScene.ts    # 主菜单场景
      GameScene.ts        # 核心玩法场景
      ResultScene.ts      # 结算场景
      ...                 # 更多场景按需扩展
    managers/             # 管理器层（可选）
      SaveManager.ts      # localStorage 存档封装
    data/                 # 静态数据（可选）
      config.ts           # 游戏配置数据（关卡、道具、角色等，按游戏类型自行命名）
  public/
    assets/
      sprites/            # 精灵/角色 PNG
      backgrounds/        # 背景图
      audio/              # 音频文件（可选）
      fonts/              # 字体文件（可选）
  capacitor.config.ts     # Capacitor 原生打包配置
```

## 生命周期契约（Phaser Scene 模型）

Phaser 游戏的生命周期由引擎原生管理，开发者通过 **Scene 类** 接入生命周期钩子。Engineer Agent MUST 遵循以下契约：

```typescript
import Phaser from 'phaser';

// 每个 Scene MUST extend Phaser.Scene
class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });  // MUST 提供唯一 scene key
  }

  /**
   * 资源加载钩子 — MUST 实现
   * 加载图片、音频、精灵表、JSON 等游戏资源。
   * 加载完成后 Phaser 自动调用 create()。
   */
  preload(): void {
    // 加载游戏所需的图片、音频、精灵表、JSON 等资源（键名与路径按游戏自行定义）
    this.load.image('bg', 'assets/backgrounds/bg.png');
    this.load.image('hero', 'assets/sprites/hero.png');
    // ...
  }

  /**
   * 场景初始化钩子 — MUST 实现
   * 创建游戏对象、设置物理世界、绑定输入事件。
   */
  create(): void {
    // 初始化场景内容（游戏对象、UI 元素、事件绑定等，按游戏类型自行实现）
    this.add.image(240, 400, 'bg');
    // ...
  }

  /**
   * 帧更新钩子 — SHOULD 实现（游戏有实时逻辑时）
   * 每帧调用，用于移动、碰撞检测等实时逻辑。
   */
  update(time: number, delta: number): void {
    // 逐帧逻辑
  }
}
```

### 必须实现的钩子

| 钩子 | 要求 | 描述 |
|------|------|------|
| `preload()` | **MUST** | 加载游戏资源。Checker 校验：index.html 加载的 JS bundle 中 MUST 出现 `preload` 方法定义 |
| `create()` | **MUST** | 初始化场景对象。Checker 校验：JS bundle 中 MUST 出现 `create` 方法定义 |
| `update()` | **SHOULD** | 逐帧更新逻辑。纯静态 UI 场景（如菜单）可不实现。Checker 不强制校验但 SHOULD 存在 |

### GameConfig 契约

Phaser 游戏实例 MUST 通过 `Phaser.Game` 构造函数创建，并传入符合规范的 `GameConfig`：

```typescript
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,                    // 渲染器：AUTO (WebGL 优先，fallback Canvas)
  width: 480,                           // MUST 与 metadata.resolution.width 一致
  height: 800,                          // MUST 与 metadata.resolution.height 一致
  parent: 'game-container',             // 挂载 DOM 元素 ID
  backgroundColor: '#1a1a2e',           // 背景色
  physics: {
    default: 'arcade',                  // 物理引擎：arcade（内置，适合大多数 2D 游戏）
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scene: [BootScene, MainMenuScene, GameScene, ResultScene],  // 场景列表
  scale: {
    mode: Phaser.Scale.FIT,             // 缩放模式：FIT 保持比例适配屏幕
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

const game = new Phaser.Game(config);   // MUST 存在此行
```

### 场景流转

Phaser Scene 之间的切换通过内置方法：

```typescript
this.scene.start('TargetScene', data);   // 切换场景，传递数据
this.scene.pause('CurrentScene');        // 暂停当前场景
this.scene.resume('CurrentScene');       // 恢复暂停场景
this.scene.stop('CurrentScene');         // 停止当前场景
this.scene.launch('OverlayScene', data); // 叠加场景（如暂停菜单）
```

**典型流转链（示例，具体场景按游戏设计自行扩展）：**
```
BootScene (preload 加载资源)
  → MainMenuScene (主菜单)
    → [可选中间场景，如选关、教程、设置]
      → GameScene (核心玩法)
        → ResultScene (结算/结果)
```

> **说明**：具体场景数量和流转方式完全由游戏设计决定。简单游戏可只有 BootScene → GameScene → ResultScene；复杂游戏可按需增加选关、世界地图、剧情等场景。

## Capacitor 原生打包

### 配置文件

`capacitor.config.ts` MUST 包含以下关键字段：

```typescript
const config: CapacitorConfig = {
  appId: 'com.example.app',        // MUST 唯一标识符，反域名格式
  appName: 'App Name',             // MUST 应用名称
  webDir: 'dist',                  // MUST 'dist'，指向 Vite 构建输出目录
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,    // 启动屏显示时长 (ms)
      backgroundColor: '#1a1a2e',  // 启动屏背景色
    },
  },
};
```

### 构建流程

```bash
# 1. 构建 Web 产物
npm run build                        # tsc && vite build → dist/

# 2. 同步到原生项目
npx cap sync                         # 复制 dist/ 到 android/app/src/main/assets/

# 3. 构建 APK（CI 自动或手动）
cd android && ./gradlew assembleDebug   # → android/app/build/outputs/apk/debug/
```

### CI/CD（GitHub Actions）

MUST 在 `.github/workflows/build-apk.yml` 中配置自动构建流程：
1. `checkout` 代码
2. 安装 Node.js + Java + Android SDK
3. `npm ci && npm run build`
4. `npx cap sync`
5. `./gradlew assembleDebug`
6. Upload APK artifact

## 美术资源规范

### 资源生成范式

phaser-mobile 类型游戏 SHOULD 采用 **AI 生图 + Python 后处理** 的美术生产流程：

```
AI 生成原始 PNG (256×256)
  → Python/Pillow 边缘检测去背景 (容差 60)
  → 去除绿色/青色 AI 伪影
  → 去除纯白/浅灰残留
  → 圆形遮罩裁切（可选，角色/图标类）
  → 放入 public/assets/sprites/
```

### 资源尺寸约定

以下为通用参考基准，适用于任何类型的 phaser-mobile 游戏。Engineer Agent SHOULD 按游戏实际需求选择合适的尺寸，并在 `preload()` 中用 `setScale()` 或 `setDisplaySize()` 控制最终可见尺寸。

| 素材类别 | 推荐原始尺寸 | 典型 Phaser 内缩放范围 | 典型可见尺寸 | 格式 |
|---------|------------|-------------------|------------|------|
| 角色 / 主体精灵（大） | 256×256 | 0.15–0.25 | ~40–65px | PNG, RGBA |
| 角色 / 主体精灵（小） | 128×128 | 0.25–0.40 | ~32–51px | PNG, RGBA |
| 道具 / 元素 / 小物件 | 128×128 | 0.15–0.25 | ~19–32px | PNG, RGBA |
| UI 图标 / 按钮 | 128×128 | 0.40–0.60 | ~51–77px | PNG, RGBA |
| 关卡 / 卡片 / 缩略图 | 256×256 | 0.20–0.35 | ~51–90px | PNG, RGBA（可加圆形遮罩） |
| 背景图（竖屏） | 1024×1024 或 512×896 | setDisplaySize(480, 800) | 全屏 480×800 | PNG/JPG |
| 背景图（横屏） | 1024×512 | setDisplaySize(800, 480) | 全屏 800×480 | PNG/JPG |
| 特效 / 粒子 | 64×64 或 128×128 | 0.05–0.20 | ~3–26px | PNG, RGBA |
| 精灵表（动画帧） | 帧尺寸 48×48 或 64×64 | — | 按帧尺寸 | PNG, RGBA |

> **通用原则**：
> - 源图统一使用 2 的幂次尺寸（64/128/256/512/1024），有利于 GPU 纹理缓存。
> - 透明通道素材（角色、道具、UI 元素）MUST 使用 PNG RGBA；不需要透明度的背景可使用 JPG 减小体积。
> - 具体尺寸和缩放值以实际游戏视觉效果为准，上表仅作参考起点。

### Phaser 资源加载方式

所有美术资源在 `BootScene.preload()` 中统一加载（键名与路径按游戏自行定义）：

```typescript
// 加载单帧图片（背景、UI 元素、静态精灵等）
this.load.image('bg', 'assets/backgrounds/bg.png');
this.load.image('hero', 'assets/sprites/hero.png');

// 加载精灵表（多帧动画）
this.load.spritesheet('hero_run', 'assets/sprites/hero_run.png', {
  frameWidth: 64, frameHeight: 64,  // 单帧尺寸按实际素材填写
});

// 加载音频
this.load.audio('bgm', 'assets/audio/bgm.mp3');
this.load.audio('sfx_hit', 'assets/audio/hit.mp3');

// 加载 JSON 数据（如关卡配置、对话数据等，可选）
this.load.json('level_data', 'assets/data/levels.json');

// 启动加载场景后，Phaser 自动调用 create()
```

## 存档格式

phaser-mobile 游戏 MUST 通过 `localStorage` 实现持久化，并通过 `SaveManager` 封装读写操作。

存档数据结构由**游戏自行定义**，规范仅约定以下最低必要字段：

```typescript
interface SaveData {
  version: number;          // 存档版本（用于迁移，MUST 存在）
  settings: {
    bgmVolume: number;      // 背景音乐音量 0.0–1.0
    sfxVolume: number;      // 音效音量 0.0–1.0
  };
  // 游戏特有数据由各游戏自行扩展，例如：
  // progress?: Record<string, unknown>;   // 进度数据
  // stats?: Record<string, number>;       // 统计数据
  // unlockedItems?: string[];             // 已解锁内容
  [key: string]: unknown;   // 允许扩展任意游戏特有字段
}
```

> **说明**：`settings`（音量控制）是所有游戏的公共字段，MUST 保留。其余字段完全由游戏需求决定，不做强制规定。

- `SaveManager` MUST 提供 `load()` 和 `save(data)` 方法。
- 首次运行时（无存档）MUST 返回默认初始状态，不报错。

### localStorage Key 命名规则

Key 格式：`'__phaser__|{appId}|v{version}'`，由三部分组成：

| 段 | 说明 | 示例 |
|----|------|------|
| 固定前缀 | `__phaser__`（MUST，标识所有 phaser-mobile 框架产出的存档） | `__phaser__` |
| appId | Capacitor appId，反域名格式（MUST） | `com.example.mygame` |
| 版本 | `v{数字}`，存档 schema 版本（MUST） | `v1` |

示例：`'__phaser__|com.example.mygame|v1'`

### Key 冲突检测

`SaveManager.save()` 写入前 MUST 全匹配检测：若 `this.storageKey` 已存在于 `localStorage`，直接 `throw new Error` 阻断保存，避免数据覆盖。

```typescript
const KEY_PREFIX = '__phaser__';

class SaveManager {
  private readonly storageKey: string;
  private readonly appId: string;
  private readonly version: number;

  constructor(appId: string, version: number) {
    this.appId = appId;
    this.version = version;
    this.storageKey = `${KEY_PREFIX}|${appId}|v${version}`;
  }

  save(data: SaveData): void {
    if (localStorage.getItem(this.storageKey) !== null) {
      throw new Error(
        `[SaveManager] Key conflict: "${this.storageKey}" already exists. ` +
        `Ensure appId uniqueness. Existing data will not be overwritten.`
      );
    }
    localStorage.setItem(this.storageKey, JSON.stringify(data));
  }

  load(): SaveData | null {
    const raw = localStorage.getItem(this.storageKey);
    return raw ? JSON.parse(raw) as SaveData : null;
  }
}
```

## 非目标（明确不做）
- 不规定玩法、规则、关卡内容与复杂度。
- 不限制表现风格、主题、UI 设计。
- 不限制具体物理引擎（Arcade/Matter 均可，Phaser 内置）。
- 不规定音频格式（MP3/OGG/WAV 均可）。
- 不要求在线功能或后端服务。
- 不限制 TTS 实现方式（Web Speech API / 预生成 MP3 均可）。

---

## 附录 A：Phaser Mobile 特有可验证规则清单

以下规则仅在 `game_type === "phaser-mobile"` 时生效。

### A.1 游戏框架契约规则组（lifecycle- 前缀）

#### A.1.1 lifecycle-phaser-game

| 属性 | 值 |
|------|-----|
| ruleId | `lifecycle-phaser-game` |
| level | `error` |
| 规则组 | lifecycle |
| 描述 | 游戏脚本 MUST 创建 `new Phaser.Game(...)` 实例 |

**判定逻辑：** `/new\s+Phaser\s*\.\s*Game\s*\(/`

**通过示例：**
```javascript
const game = new Phaser.Game(config);
```
```javascript
new Phaser.Game({type: Phaser.AUTO, ...});
```

**失败示例：** 无任何 `new Phaser.Game(` 调用。

**错误消息：** `缺少 new Phaser.Game() 实例创建。phaser-mobile 游戏 MUST 通过 new Phaser.Game(config) 启动。`

---

#### A.1.2 lifecycle-phaser-scene-preload

| 属性 | 值 |
|------|-----|
| ruleId | `lifecycle-phaser-scene-preload` |
| level | `error` |
| 规则组 | lifecycle |
| 描述 | 至少一个 Scene 类 MUST 定义 `preload()` 方法 |

**判定逻辑：**
```typescript
// 匹配 preload() 方法定义（对象方法、class 方法、箭头函数属性）
// 不锚定行首，允许缩进
const RE_PRELOAD = /(?<![\\w$])preload\s*\(/;
const passed = RE_PRELOAD.test(jsContent);
```

**通过示例：**
```javascript
preload() { this.load.image(...); }
```
```javascript
class BootScene extends Phaser.Scene { preload() {} }
```

**失败示例：** JS bundle 中无 `preload(` 出现。

**边界：**
- 仅做文本匹配，不做 AST。
- 不要求所有 Scene 都有 preload，至少一个即可。
- 通过 `(?<![\\w$])` 负向后顾防止变量名误匹配（如 `_preload`）。

**错误消息：** `缺少 preload() 方法定义。phaser-mobile 游戏至少一个 Scene MUST 定义 preload() 加载资源。`

---

#### A.1.3 lifecycle-phaser-scene-create

| 属性 | 值 |
|------|-----|
| ruleId | `lifecycle-phaser-scene-create` |
| level | `error` |
| 规则组 | lifecycle |
| 描述 | 至少一个 Scene 类 MUST 定义 `create()` 方法 |

**判定逻辑：**
```typescript
const RE_CREATE = /(?<![\\w$])create\s*\(/;
const passed = RE_CREATE.test(jsContent);
```

**通过示例：** `create() { this.add.image(...); }`

**失败示例：** JS bundle 中无 `create(` 出现。

**错误消息：** `缺少 create() 方法定义。phaser-mobile 游戏至少一个 Scene MUST 定义 create() 初始化场景。`

---

#### A.1.4 lifecycle-phaser-script-tag

| 属性 | 值 |
|------|-----|
| ruleId | `lifecycle-phaser-script-tag` |
| level | `error` |
| 规则组 | lifecycle |
| 描述 | index.html MUST 包含 `<script>` 标签加载游戏 JS bundle |

**判定逻辑：** `/<script[\s>]/i.test(htmlContent)`

**通过示例：** `<script type="module" src="/assets/index.js"></script>`

**错误消息：** `缺少 <script> 标签。index.html MUST 包含 <script> 标签加载 Phaser 游戏脚本。`

---

### A.2 资源与配置规则组（asset- 前缀）— Phaser Mobile 扩展

> **说明**：phaser-mobile 不要求 `assets/manifest.json`，资源通过 Phaser `preload()` 声明式加载。因此不定义 `asset-manifest-*` 规则。

#### A.2.1 asset-resource-relative-path

| 属性 | 值 |
|------|-----|
| ruleId | `asset-resource-relative-path` |
| level | `error` |
| 规则组 | asset |
| 描述 | index.html 中引用的资源路径 MUST 使用相对路径（不使用外部 CDN） |

**判定逻辑：** `/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi`

**通过示例：** `<script type="module" src="/assets/index.js">`、`<link rel="stylesheet" href="/assets/style.css">`

**失败示例：** `<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.0/dist/phaser.min.js">`

**错误消息：** `检测到绝对路径资源引用：{url}。phaser-mobile 游戏 MUST 离线可运行，所有资源 MUST 使用相对路径或打包到产物中。`

---

#### A.2.2 asset-capacitor-config

| 属性 | 值 |
|------|-----|
| ruleId | `asset-capacitor-config` |
| level | `warning` |
| 规则组 | asset |
| 描述 | Capacitor 配置 SHOULD 存在且 `webDir` 为 `"dist"` |

**判定逻辑：**
```typescript
// 检查 capacitor.config.ts 或 capacitor.config.json
const configPath = path.join(submitDir, '..', 'capacitor.config.ts');
const altConfigPath = path.join(submitDir, '..', 'capacitor.config.json');
const configExists = fs.existsSync(configPath) || fs.existsSync(altConfigPath);
if (!configExists) return [{ level: 'warning', message: '...' }];
```

**通过示例：** `capacitor.config.ts` 存在且 `webDir: 'dist'`

**错误消息：** `缺少 capacitor.config.ts/json。phaser-mobile 游戏 SHOULD 包含 Capacitor 配置用于原生打包。`

---

## 附录 B：规则总览表

| ruleId | 规则组 | level | 来源 | 描述 |
|--------|-------|-------|------|------|
| `html-doctype` | html | error | 公共 | MUST 包含 `<!DOCTYPE html>` |
| `html-root` | html | error | 公共 | MUST 包含 `<html>` 根标签 |
| `html-head` | html | error | 公共 | MUST 包含 `<head>` 标签 |
| `html-body` | html | error | 公共 | MUST 包含 `<body>` 标签 |
| `html-charset` | html | error | 公共 | `<head>` 中 MUST 包含 `<meta charset="utf-8">` |
| `html-body-not-empty` | html | error | 公共 | `<body>` MUST 有可见内容 |
| `asset-metadata-exists` | asset | error | 公共 | MUST 存在 `metadata.json` |
| `asset-metadata-schema` | asset | error | 公共 | metadata.json MUST 完整且 game_type 已注册 |
| `lifecycle-phaser-game` | lifecycle | error | phaser-mobile | MUST 创建 `new Phaser.Game()` 实例 |
| `lifecycle-phaser-scene-preload` | lifecycle | error | phaser-mobile | MUST 定义 `preload()` 方法 |
| `lifecycle-phaser-scene-create` | lifecycle | error | phaser-mobile | MUST 定义 `create()` 方法 |
| `lifecycle-phaser-script-tag` | lifecycle | error | phaser-mobile | index.html MUST 加载 `<script>` |
| `asset-resource-relative-path` | asset | error | phaser-mobile | 资源路径 MUST 使用相对路径 |
| `asset-capacitor-config` | asset | warning | phaser-mobile | SHOULD 包含 capacitor.config |

---

## 附录 C：与 H5 类型的差异对照

| 维度 | H5 (`game_type: "h5"`) | Phaser Mobile (`game_type: "phaser-mobile"`) |
|------|------------------------|---------------------------------------------|
| 游戏引擎 | PixiJS 7.4+ | Phaser 3.80+ |
| 生命周期模型 | `GameApp` 接口（6 方法 + `window.__GAME__`） | Phaser Scene 模型（`preload/create/update`） |
| 打包目标 | 浏览器 | 浏览器 + Capacitor → Android/iOS APK |
| 资源清单 | `assets/manifest.json`（MUST） | `preload()` 内联加载（无 manifest） |
| 资源加载方式 | 声明式 JSON 清单 | Phaser `this.load.*()` API |
| 音频方案 | Howler.js | Phaser Audio / Web Speech API |
| 存档方案 | 未强制规定 | localStorage + SaveManager 封装 |
| 美术生产 | 未强制规定 | AI 生图 + Python 后处理（推荐） |

## UI Test 验收规则

提交代码前必须跑通 ui test。
如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。

## 主动补全 UI Test 规范

新增前端交互功能（按钮、表单、弹窗、面板等）时，必须同步编写对应的 E2E 测试用例，并更新以下文档：
1. `tests/ui/e2e/studio.spec.ts` — 添加测试用例（分配下一个 UI-XXX 编号）
2. `.agent/memory/E2E_TESTING.md` — 更新测试矩阵、testid 对照表、测试经验
3. `.agent/specs/` 下对应的 spec 文档 — 更新测试策略章节
4. `.agent/specs/INDEX.md` — 如有新 spec 则更新索引

## 主动更新所有相关文档规范

实现新功能或做重大修改后，必须主动检查并更新所有受影响的文档，而非仅更新直接相关文件。完整检查清单：
1. `README.md` + `README.zh-CN.md` — 功能概览、API 概览、目录结构
2. `docs/ARCHITECTURE.md` + `docs/ARCHITECTURE.zh-CN.md` — 业务域、数据模型、运行时组件
3. `.agent/memory/ARCHITECTURE.md` — 架构关键点、关键模块详解
4. `.agent/memory/INDEX.md` — 快速参考
5. `.agent/memory/E2E_TESTING.md` — 测试矩阵、testid 对照表（如有新测试）
6. `.agent/memory/CONVENTIONS.md` — 工作约定（如有新规范）
7. `.agent/memory/MEMORY.md` — 长期记忆（工程决策记录）
8. `.agent/specs/` 下相关 spec 文档 — 状态、测试策略
9. `.agent/specs/INDEX.md` — spec 索引状态
10. `.agent/AI_AGENT_COMMON_INSTRUCTIONS.md` — 关键文件位置、API 概览
- **文档更新禁止添加日期和敏感信息**
- **不相关的文档不需要修改**（如 LINT.md 与本功能无关则不更新）

## 详细 Debug 日志规范

新增前端交互功能、后端 API 路由、E2E 测试用例时，必须同步添加 `console.log` / `process.stderr.write` debug 日志，方便测试失败时快速定位问题：

1. **后端 API 路由**：在路由入口、校验步骤（PASS/FAIL）、关键操作（DB 写入、SSE 广播）处添加 `console.log('[DEBUG:路由名] stepN: ...')` 格式日志
2. **前端组件**：在关键生命周期（mount）、用户操作（表单填写、校验、提交）、API 请求/响应处添加 `console.log('[DEBUG:ComponentName] ...')` 格式日志
3. **SSE 事件处理**：在 `handleSSEEvent` 的 case 分支中添加日志，记录事件类型和关键数据
4. **E2E 测试用例**：参照 UI-007/008 的 `log()` helper 模式，每个操作步骤添加 `process.stderr.write('[UI-XXX] step: ...')` 日志，包含结构化 extra 数据
   - **日志格式统一**：`[DEBUG:模块名] stepN: 描述` 或 `[UI-XXX] stepN: 描述`，关键数据以 JSON extra 输出
   - **日志粒度**：关键路径全覆盖，但避免在循环/高频回调中输出日志
