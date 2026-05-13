# H5 小游戏工程框架规范（Engineering Agent）

## 目标
- 为 Engineering Agent 提供**稳定、可验证、可测试**的开发边界。
- 让游戏业务逻辑在框架内自由扩展，不被强行限制。
- 便于系统对产物进行静态检查、自动化测试与验收反馈。

## 适用范围
- 面向 H5 小游戏（浏览器运行、无服务端依赖）。
- 以 **单一 HTML + 资源包** 作为提交目标。

## 框架选型（固定边界）
> 以下选型用于统一运行时与工具链，减少不确定性。

### 渲染层
- **PixiJS**（Canvas/WebGL 自动选择）
- 原因：轻量、成熟、兼容性好、适配 2D 小游戏主流需求

### 物理（可选）
- **Matter.js**
- 原因：简单、可控、易于与 PixiJS 结合

### 动画与补间
- **@tweenjs/tween.js**
- 原因：轻量、与渲染层无强耦合

### 音频
- **Howler.js**
- 原因：H5 音频兼容性好，能统一音效/背景音乐管理

### 输入与交互
- Pointer/Keyboard API（原生）
- 对外封装为统一输入层（不限制业务逻辑）

### 构建与打包
- **Vite + TypeScript**
- 产物输出为 `dist/index.html` 与资源目录

## 目录结构约定（用于验证与测试）
```
game/
  index.html
  src/
    main.ts                # 框架入口（固定）
    engine/                # 框架层（固定边界）
    gameplay/              # 业务逻辑自由区（可任意扩展）
    ui/                    # UI/Overlay（可选）
  assets/
    manifest.json          # 资源清单（固定）
```

### 规则
- **框架层**：`src/engine`，仅承载通用能力（生命周期、渲染、资源、输入、音频、调试）。
- **业务逻辑自由区**：`src/gameplay`，玩法、关卡、规则、胜负条件等均在此实现。
- **入口固定**：`src/main.ts` 只做框架初始化与业务逻辑注入。

## 生命周期与契约（强约束）
框架必须提供统一的游戏生命周期接口，供系统与业务逻辑同时使用：

```ts
GameApp
  init(config)
  start()
  pause()
  resume()
  resize(width, height)
  destroy()
```

### 要求
- 生命周期由框架掌控，业务逻辑通过注册/订阅方式扩展。
- 业务逻辑**不得**直接操作 DOM 结构（允许只在 `ui/` 中创建 Overlay）。
- `GameApp` 必须可被测试框架调用（建议挂载到 `window.__GAME__`）。

## 模块边界（不限制业务逻辑）
### 允许的自由扩展
- 任意数量的 **Scene**、**System**、**Component**、**Entity**。
- 自定义关卡配置、规则引擎、AI、难度曲线等。
- 自定义 UI、HUD、特效、音效策略。

### 强制保持的边界
- 业务逻辑只能通过框架对外暴露的 API 与渲染/输入/音频交互。
- 禁止直接修改 `engine/` 内的核心协议与生命周期签名。

## 资源与配置规范
### 资源清单（必需）
`assets/manifest.json`：
- 记录所有资源路径、类型、预加载策略。
- 便于自动化测试确认资源完整性。

### 游戏元信息（必需）
`game/manifest.json`：
- `title` / `version` / `resolution` / `orientation` / `entry`
- 用于系统验收与测试环境配置。

## 交互与输入规范
- 统一由 `InputManager` 处理（封装 Pointer/Keyboard）。
- 业务逻辑通过订阅输入事件，不直接绑定 DOM 事件。

## 状态与存档
- 使用 `StateStore` 管理局内状态。
- 存档可使用 `localStorage`，但必须有统一 key 前缀（如 `game:`）。

## 性能与稳定性约束
- 主循环帧率目标：60fps（允许降级）。
- 单帧逻辑时间 < 16ms。
- 资源预加载不得阻塞首帧超过 3 秒。
- 禁止无限制创建定时器或脱离主循环的更新逻辑。

## 安全与合规（对系统验证友好）
为保证静态检查与安全审计，必须遵守：
- 禁止 `eval`、`new Function`。
- 禁止 `javascript:` URL。
- 禁止 `innerHTML` 直接写入（UI 使用模板/DOM API）。
- 禁止 `POST/PUT/DELETE/PATCH` 等写操作请求, 仅允许 GET。
- 禁止外部远程脚本动态加载（必须随包提交）。

## 提交与验收边界
### HTML/ZIP 提交要求
- `index.html` 必须包含 DOCTYPE、html/head/body、charset。
- body 必须非空，并挂载游戏 canvas 或容器。
- 资源路径必须相对可解析。

### 系统验证预期
- 可通过静态 lint 规则（HTML 结构 + JS 安全）。
- 可被自动化测试调用生命周期。
- 可通过资源清单检查（manifest.json）。

## 非目标（明确不做）
- 不规定玩法、规则、关卡内容与复杂度。
- 不限制表现风格、主题、UI 设计。
- 不限制算法、AI、关卡生成方式。

## Engineering Agent 行为约束（执行准则）
- 只能在 **业务逻辑自由区** 实现具体玩法。
- 只使用本框架选型中的核心库；新增库需明确说明用途且不得破坏边界。
- 确保产物满足提交规范与安全约束。
