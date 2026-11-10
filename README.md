# npm-atlas

扫描本机所有 npm 安装，查看各自的路径、版本、默认项与全局包，并在一个可视化面板里更新或卸载。

> 本机 npm 全景 · 全局包管理

## 为什么

一台开发机上通常不止一个 npm：nvm / fnm / mise / Volta / asdf 各装一份，Homebrew 和 Node 安装包里也各带一份。`npm ls -g` 只能看到当前 PATH 命中的那个，其余的全局包散落在不同 prefix 下。npm-atlas 把这些安装全部找出来，并明确告诉你：

- 本机有哪些 npm、真实路径是什么、默认是哪个；
- 每个 npm 对应哪个 Node、registry、prefix 和全局目录；
- 每个安装下装了哪些全局包、哪些可以更新；
- 选中任意安装后，直接更新 / 卸载它的全局包。

## 快速开始

要求：Node.js >= 20、npm 或 pnpm。

```bash
pnpm install
pnpm dev
```

打开 http://localhost:5173（前端）即可。API 在 http://127.0.0.1:4317。

生产模式：

```bash
pnpm build
pnpm start          # http://127.0.0.1:4317
```

命令行查看扫描结果：

```bash
pnpm scan           # 可读摘要
pnpm scan --json    # 完整 JSON
```

## 功能

- **安装发现**：PATH（按顺序，第一项标记为默认）+ nvm / fnm / mise / Volta / asdf / n / Homebrew / Hermes / 自定义目录。
- **精确探测**：`npm -v`、`npm root -g`、`npm prefix -g`、`npm config get registry`，并用该 npm 同目录的 Node 读取版本。
- **全局包清单**：`npm ls -g --depth=0 --json` + `npm outdated -g --json`。
- **共享目录识别**：不同 npm 版本指向同一全局目录时标记「共享全局目录」，统计按目录去重。
- **两种视图**：逐个 npm 查看，或开启「按全局目录折叠」把共享目录合并成一条，并在详情里列出该目录下的所有 npm 版本；选择会记忆在浏览器中。
- **切换默认 npm**：在任意版本旁点「设为默认」，npm-atlas 会创建自己的 `npm`/`npx` 包装器，并在 shell 启动文件末尾追加带标记的 PATH 配置（修改前自动备份）。新开终端生效，可一键移除恢复系统默认。
- **管理操作**：单包更新、批量更新、单包卸载；二次确认、逐项结果、失败原因原样透出。
- **安全防护**：
  - 不使用 shell，所有命令以参数数组执行；
  - 安装 ID 与包名必须存在于最近一次扫描结果；
  - 禁止卸载 npm 自身；批量更新时 npm 排在最后；
  - 仅接受来自本机的请求，拒绝跨站 Origin 与非本机 Host；
  - 切换默认 npm 时会先展示将修改的文件，确认后才写入，并保留带时间戳的备份。
- **界面**：深/浅色主题、搜索、仅看可更新、排序、桌面与移动端自适应。

## 脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 同时启动 API（4317）与 Vite（5173） |
| `pnpm scan` | 终端输出扫描摘要 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm build` | 构建前端 + 打包服务端到 `dist/` |
| `pnpm start` | 运行生产构建（单进程托管静态页面与 API） |

环境变量：`ATLAS_PORT`（默认 4317）、`ATLAS_HOST`（默认 127.0.0.1）。

## 工作方式

```
web (React + Vite)
   │  /api/*
server (Hono)
   ├─ scanner: 发现候选 → 探测 → 解析 → 缓存 30s
   └─ executor: 校验 → 串行执行 npm → 重新扫描
```

每个 npm 的探测命令都在「该 npm 所在目录优先」的 PATH 下执行，避免 `#!/usr/bin/env node` 命中另一个 Node。安装按 `全局目录 + npm 版本` 分组：同一份全局包被多个 npm 版本共享时，会显示多个条目并标记共享。

## API

- `GET /api/scan`，`GET /api/scan?refresh=1`
- `POST /api/scan`
- `POST /api/action`
  ```json
  { "type": "update", "installationId": "a92cbe264634", "packages": ["typescript"] }
  ```
  `type` 为 `update` 或 `uninstall`。返回逐包结果与刷新后的完整扫描。
- `POST /api/default`
  ```json
  { "installationId": "2670ed6c1223" }
  ```
  写入 npm-atlas 包装器与 shell PATH 配置，返回刷新后的扫描与提示。
- `POST /api/default/reset`：移除包装器与 PATH 配置。

## 目录

```
bin/npm-atlas.mjs     启动入口（构建后）
server/scanner.ts     发现、探测、解析、缓存
server/executor.ts    更新/卸载与安全校验
server/defaultNpm.ts  默认 npm 包装器、shell 集成与恢复
server/settings.ts    PATH/shell/状态文件与备份
server/index.ts       Hono 服务、静态托管、本机访问保护
shared/types.ts       前后端共享类型
web/src/              React 界面
docs/PLAN.md          调研、选型与设计文档
```

状态文件与包装器默认位于 `~/.npm-atlas/`（可用 `ATLAS_STATE_DIR` 覆盖），shell 文件可用 `ATLAS_RC_FILE` 覆盖（主要用于测试）。

## 已知限制

- 目前主要支持 macOS / Linux；Windows 的 `npm.cmd` 需要额外处理（roadmap）。
- 切换默认 npm 后需要新开终端（或 `source` 对应配置文件）才生效；当前已运行的进程不会自动更新 PATH。
- shell 自动集成支持 zsh / bash / fish；其他 shell 会给出需要手动添加的 PATH 片段。
- 全局目录无写权限时，操作会失败并原样显示 npm stderr；可改用对应版本管理器安装，或调整 prefix。
- 离线或 registry 不可达时，包清单仍可读，但「可更新」信息可能缺失。

## Roadmap

- Windows 支持
- 包详情（描述、主页、依赖树）
- 操作历史与回滚

## 调研与设计

见 [docs/PLAN.md](docs/PLAN.md)。

## License

MIT