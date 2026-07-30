# Ember Tavern

Ember Tavern（炉火酒馆）是一款面向 Windows 和 iOS 的单人 AI 文字冒险应用。模型负责生成世界与叙事，本地程序负责规则、验证、状态和存档；本地 SQLite 是游戏事实的唯一数据源。

## 当前状态

项目目前仅完成 `M0-T01`：Git 仓库与基础开发规范初始化。尚未创建 pnpm/Cargo workspace，也尚未实现任何游戏功能。

完整产品规格见 [`docs/spec.md`](docs/spec.md)，任务顺序与验收标准见 [`docs/TASKS.md`](docs/TASKS.md)。

## 启动说明

当前阶段没有可运行应用或构建命令。请先阅读上述规格与任务文档；开发环境和统一命令将在后续明确执行 `M0-T02` 时建立。本仓库不会自动开始该任务。

## 开发约定

### 分支

- `main` 保持可验收状态，不在其上混入多个任务。
- 每个任务使用独立分支，命名为 `task/<任务编号>-<简短说明>`，例如 `task/M0-T01-repository-baseline`。
- 不得在当前任务分支提前实现后续任务。

### Commit

- 每个任务形成独立 commit。
- 格式为 `<type>(<scope>): <summary>`。
- 常用 `type`：`chore`、`docs`、`feat`、`fix`、`test`、`refactor`。
- `scope` 优先使用任务编号，例如 `chore(M0-T01): initialize repository standards`。
- 提交前必须按 `docs/TASKS.md` 核对当前任务验收标准并更新开发日志。

## 长期协作规则

仓库级长期规则见 [`AGENTS.md`](AGENTS.md)。
