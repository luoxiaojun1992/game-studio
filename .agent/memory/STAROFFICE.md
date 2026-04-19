# Star-Office-UI 集成

## 架构
- Star-Office-UI 项目克隆到 `game-dev-studio/star-office-ui/`
- 后端: Flask (Python)，端口 19000
- 同步服务: `server/star-office-sync.ts`
  - Agent 状态变更时自动推送到 Star-Office-UI
  - 使用 `/set_state` 和 `/agent-push` API
  - 默认推送到 `http://127.0.0.1:19000`

## Agent 状态映射
| Studio 状态 | Star-Office-UI |
|------------|----------------|
| idle      | 休息区         |
| working   | 工作区         |
| error     | Bug区          |

## 组件
- 嵌入式组件: `src/components/StarOfficeStudio.tsx`

## 启动注意
- 需要单独启动 Star-Office-UI 后端服务
- `JOIN_KEY` 用于团队标识，默认 `ocj_example_team_01`
