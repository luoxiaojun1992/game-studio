// Phaser Mobile 游戏工程规范（自动生成，对应 PHASER_MOBILE_GAME_ENGINEERING_FRAMEWORK.md）
export const SEED_PHASER_MOBILE_CONTENT = `# Phaser Mobile 游戏工程规范

## 概述

本文档是 \`phaser-mobile\` 游戏类型的工程规范，基于 [GAME_ENGINEERING_COMMON.md](./GAME_ENGINEERING_COMMON.md) 中的公共规范扩展。

**使用方式：**
1. Engineer Agent 先读取 \`metadata.json\` 中的 \`game_type\` 字段。
2. 若 \`game_type === "phaser-mobile"\`，同时加载本规范和公共规范。
3. 公共规范中的规则自动生效，本规范中的规则附加生效。

## 适用范围
- \`metadata.json\` 中 \`game_type\` MUST 为 \`"phaser-mobile"\`。
- 面向基于 Phaser 3 的移动端 2D 游戏（通过 Capacitor 打包 Android/iOS APK）。
- 以 **Phaser Scene 模型 + Vite 构建 + Capacitor 原生打包** 作为标准交付形态。

## 框架选型（固定边界）

| 层级 | 选型 | 最低版本 | 说明 |
|------|------|---------|------|
| 游戏引擎 | Phaser 3 | >=3.80.0 | 2D 引擎，内置物理/音频/补间，MIT 协议 |
| 移动打包 | Capacitor | >=8.0.0 | Web → 原生 App，CI 自动构建 APK/AAB |
| 语言 | TypeScript | >=5.4.0 | 强类型，ES Module |
| 构建 | Vite | >=8.0.0 | 秒级 HMR，\`base: './'\` 相对路径输出 |
| 后端 | 无 | — | 纯离线单机，不依赖服务端 |
| TTS | Web Speech API（浏览器原生） | — | 零依赖，离线可用 |
| 存档 | \`localStorage\` | — | 通过 \`SaveManager\` 封装，key 使用项目前缀作为命名规范 |

## 目录结构

### 提交产物结构（lint checker 扫描目标）
\`\`\`
dist/
  index.html          # MUST 存在。phaser-mobile 类型下 entry 固定为 dist/index.html
  metadata.json       # MUST 存在（game_type: "phaser-mobile"），其中 entry 字段须填写 "index.html"
  assets/
    ...               # Vite 构建输出的 JS/CSS/资源文件
\`\`\`

### 开发期目录结构（供 Engineer Agent 参考）
\`\`\`
game/
  index.html              # HTML 入口，加载 Phaser 脚本
  metadata.json           # 元信息
  src/
    main.ts               # Phaser.Game 实例创建入口（固定）
    config/
      game-config.ts      # Phaser.Types.Core.GameConfig
    scenes/               # Phaser Scene 目录
      BootScene.ts        # 预加载场景
      MainMenuScene.ts    # 主菜单场景
      GameScene.ts        # 核心玩法场景
      ResultScene.ts      # 结算场景
      ...                 # 更多场景按需扩展
    managers/             # 管理器层（可选）
      SaveManager.ts      # localStorage 存档封装
    data/                 # 静态数据（可选）
      config.ts           # 游戏配置数据
  public/
    assets/
      sprites/            # 精灵/角色 PNG
      backgrounds/        # 背景图
      audio/              # 音频文件（可选）
      fonts/              # 字体文件（可选）
  capacitor.config.ts     # Capacitor 原生打包配置
\`\`\`

## 生命周期契约（Phaser Scene 模型）

Phaser 游戏的生命周期由引擎原生管理，开发者通过 **Scene 类** 接入生命周期钩子。

### 必须实现的钩子

| 钩子 | 要求 | 描述 |
|------|------|------|
| \`preload()\` | **MUST** | 加载游戏资源 |
| \`create()\` | **MUST** | 初始化场景对象 |
| \`update()\` | **SHOULD** | 逐帧更新逻辑 |

### GameConfig 契约

Phaser 游戏实例 MUST 通过 \`Phaser.Game\` 构造函数创建：
\`\`\`typescript
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 480,
  height: 800,
  parent: 'game-container',
  backgroundColor: '#1a1a2e',
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scene: [BootScene, MainMenuScene, GameScene, ResultScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};
const game = new Phaser.Game(config);
\`\`\`

## Capacitor 原生打包

\`capacitor.config.ts\` MUST 包含：
- \`appId\` — 唯一标识符，反域名格式
- \`appName\` — 应用名称
- \`webDir: 'dist'\` — 指向 Vite 构建输出目录

## 美术资源规范

phaser-mobile 类型游戏 SHOULD 采用 **AI 生图 + Python 后处理** 的美术生产流程。

## 存档格式

phaser-mobile 游戏 MUST 通过 \`localStorage\` 实现持久化，并通过 \`SaveManager\` 封装读写操作。Key 格式：\`'__phaser__|{appId}|v{version}'\`。

> **隔离机制：** 每个游戏独立部署（Capacitor 打包后各 App 拥有独立 WebView），localStorage 天然隔离，无需冲突校验。key 前缀为命名规范，便于调试时识别来源。

## 非目标（明确不做）
- 不规定玩法、规则、关卡内容与复杂度。
- 不限制表现风格、主题、UI 设计。
- 不限制具体物理引擎（Arcade/Matter 均可，Phaser 内置）。
- 不规定音频格式（MP3/OGG/WAV 均可）。
- 不要求在线功能或后端服务。

---
`;
