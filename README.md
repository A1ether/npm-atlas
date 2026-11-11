# npm-atlas

扫描本机所有 npm 安装与 Node 项目：查看全局包、项目依赖与可更新版本，并在一个可视化面板里扫描、导入、更新或移除。

> 本机 npm 全景 · 全局包与项目依赖管理

## 为什么

一台开发机上通常不止一个 npm：nvm / fnm / mise / Volta / asdf 各装一份，Homebrew 和 Node 安装包里也各带一份。`npm ls -g` 只能看到当前 PATH 命中的那个，其余的全局包散落在不同 prefix 下。npm-atlas 把这些安装全部找出来，并明确告诉你：

- 本机有哪些 npm、真实路径是什么、默认是哪个；
- 每个 npm 对应哪个 Node、registry、prefix 和全局目录；
- 每个安装下装了哪些全局包、哪些可以更新；
- 选中任意安装后，直接更新 / 卸载它的全局包。

项目里的依赖又分散在各自的 `package.json` 中。npm-atlas 也支持把一个目录下的项目扫描出来并导入，统一查看每个项目的包管理器、依赖、已安装版本和可更新状态，并按项目执行更新、添加、移除或安装依赖。

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
- **两种视图**：顶部切换「全局包 / 项目」，视图与选中的项目会记忆在浏览器中。
- **按全局目录折叠（默认）**：把共享目录合并成一条，并在详情里列出该目录下的所有 npm 版本；可随时切换并记忆选择。
- **切换默认 npm**：在任意版本旁点「设为默认」，npm-atlas 会创建自己的 `npm`/`npx` 包装器，并在 shell 启动文件末尾追加带标记的 PATH 配置（修改前自动备份）。新开终端生效，可一键移除恢复系统默认。
- **全局包管理**：单包更新、批量更新、单包卸载；二次确认、逐项结果、失败原因原样透出。
- **项目扫描与导入**：输入目录（支持 `~`），递归查找包含 `package.json` 的项目，自动跳过 node_modules / .git / 构建产物与系统目录；可批量选择导入，记录持久化在 `~/.npm-atlas/projects.json`。
- **项目依赖读取**：解析 dependencies / devDependencies / optionalDependencies / peerDependencies，读取 node_modules 中的已安装版本，并结合锁文件或 registry 给出可更新状态；自动识别 npm / pnpm / yarn / bun（`packageManager` 字段优先，其次锁文件）。
- **项目级管理**：更新到最新、添加依赖、移除依赖、安装全部依赖。命令按项目使用的包管理器执行，并按依赖类型使用对应的保存参数；workspace / file / link / git 等本地或外部规格与 peer 依赖有保护，不会误更新。
- **安全防护**：
  - 不使用 shell，所有命令以参数数组执行；
  - 安装 ID、项目 ID 与包名必须存在于最近一次扫描 / 读取结果；
  - 禁止卸载 npm 自身；批量更新时 npm 排在最后；
  - 项目操作只允许已导入项目与 `package.json` 中声明的依赖；扫描有深度与数量上限，并拒绝系统根目录；
  - 仅接受来自本机的请求，拒绝跨站 Origin 与非本机 Host；
  - 切换默认 npm 时会先展示将修改的文件，确认后才写入，并保留带时间戳的备份。
- **界面**：深/浅色主题、搜索、依赖类型筛选、仅看可更新、排序、桌面与移动端自适应。

## 桌面 App（macOS）

```bash
pnpm app:build
rm -rf /Applications/npm-atlas.app
ditto dist-app/mac-arm64/npm-atlas.app /Applications/npm-atlas.app
open /Applications/npm-atlas.app
```

- 替换已安装版本前请先退出正在运行的 App。

- App 内嵌现有服务端，用随机本机端口启动，并在原生窗口中打开界面。
- 从 Finder 启动时会读取登录 shell 的 PATH，因此能识别 mise / nvm / Homebrew 等安装；默认 npm 以登录 shell 的解析结果为准。
- 产物为未公证的本地 ad-hoc 签名 App，仅用于本机；首次从 Finder 打开如被拦截，可右键「打开」。
- `pnpm app:dev` 可用本机 `pnpm dev` 的 Vite 页面调试桌面外壳。
- 若 Electron 二进制未下载，可先执行 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm exec install-electron`。

## 脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 同时启动 API（4317）与 Vite（5173） |
| `pnpm scan` | 终端输出扫描摘要 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm build` | 构建前端 + 打包服务端到 `dist/` |
| `pnpm start` | 运行生产构建（单进程托管静态页面与 API） |
| `pnpm app:build` | 构建 macOS `.app` 到 `dist-app/mac-arm64/` |
| `pnpm app:dev` | 调试 Electron 外壳（需先运行 `pnpm dev`） |

环境变量：`ATLAS_PORT`（默认 4317）、`ATLAS_HOST`（默认 127.0.0.1）。

## 工作方式

```
web (React + Vite)
   │  /api/*
server (Hono)
   ├─ scanner: 发现候选 → 探测 → 解析 → 缓存 30s
   ├─ projects: 目录发现 → 读取 package.json / node_modules → 检查可更新 → 缓存 60s
   ├─ executor: 校验 → 串行执行 npm → 重新扫描
   └─ projectExecutor: 校验 → 按包管理器执行 → 重新读取项目
```

每个 npm 的探测命令都在「该 npm 所在目录优先」的 PATH 下执行，避免 `#!/usr/bin/env node` 命中另一个 Node。安装按 `全局目录 + npm 版本` 分组：同一份全局包被多个 npm 版本共享时，会显示多个条目并标记共享。项目操作在项目目录下执行，并优先使用项目自身声明的包管理器。

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
- `GET /api/projects`，`GET /api/projects?refresh=1`：读取已导入项目及其依赖。
- `GET /api/projects/roots`：返回本机可用的常用扫描目录。
- `POST /api/projects/discover`
  ```json
  { "root": "~/DevSpace", "depth": 3 }
  ```
  在目录中查找包含 `package.json` 的项目；`depth` 为向下扫描层数（1–6）。
- `POST /api/projects/import`
  ```json
  { "paths": ["/Users/me/DevSpace/my-app"] }
  ```
  校验并导入项目，返回新增的项目 ID 与完整列表。
- `POST /api/projects/remove`
  ```json
  { "ids": ["a92cbe264634"] }
  ```
  仅移除导入记录，不删除磁盘文件。
- `POST /api/projects/refresh`：`{ "id": "..." }` 重新读取单个项目；省略 `id` 刷新全部。
- `POST /api/projects/action`
  ```json
  { "type": "update", "projectId": "a92cbe264634", "packages": ["zod"] }
  ```
  `type` 为 `update`、`uninstall`、`install` 或 `install-all`；`install` 可带 `dev: true`。返回逐包结果与刷新后的项目列表。

## 目录

```
bin/npm-atlas.mjs     启动入口（构建后）
electron/main.mjs     macOS 桌面外壳（内嵌服务端）
scripts/build-app-server.ts  打包用单文件服务端 bundle
electron-builder.yml  桌面 App 打包配置
server/scanner.ts     全局 npm 发现、探测、解析、缓存
server/executor.ts    全局包更新/卸载与安全校验
server/projects.ts    项目发现、依赖读取、可更新检查与缓存
server/projectStore.ts 导入项目持久化
server/projectExecutor.ts 项目级更新/卸载/添加/安装执行器
server/defaultNpm.ts  默认 npm 包装器、shell 集成与恢复
server/settings.ts    PATH/shell/状态文件与备份
server/index.ts       Hono 服务、静态托管、本机访问保护
shared/types.ts       前后端共享类型
web/src/              React 界面
docs/PLAN.md          调研、选型与设计文档
```

状态文件、导入项目列表与包装器默认位于 `~/.npm-atlas/`（可用 `ATLAS_STATE_DIR` 覆盖），shell 文件可用 `ATLAS_RC_FILE` 覆盖（主要用于测试）。

## 已知限制

- 目前主要支持 macOS / Linux；Windows 的 `npm.cmd` / `pnpm.cmd` 需要额外处理（roadmap）。
- 切换默认 npm 后需要新开终端（或 `source` 对应配置文件）才生效；当前已运行的进程不会自动更新 PATH。
- shell 自动集成支持 zsh / bash / fish；其他 shell 会给出需要手动添加的 PATH 片段。
- 全局目录无写权限时，操作会失败并原样显示 npm stderr；可改用对应版本管理器安装，或调整 prefix。
- 离线或 registry 不可达时，包清单仍可读，但「可更新」信息可能缺失。
- 项目「最新版本」依赖对应包管理器（npm / pnpm / yarn / bun）的 `outdated` 命令；命令缺失或项目没有锁文件时会尝试回退到 npm 查询，仍失败则只显示已安装版本。Yarn PnP 项目没有 node_modules，已安装版本可能无法读取。
- 项目操作会执行包管理器的安装流程，可能触发依赖的安装脚本；跨主版本更新不会自动判断兼容性，确认前请自行评估。
- 项目扫描会跳过隐藏目录、node_modules、构建产物与部分系统目录；导入列表保存在 `~/.npm-atlas/projects.json`，移动项目后需移除旧记录并重新导入。

## Roadmap

- Windows 支持
- 包详情（描述、主页、依赖树）
- 项目脚本运行与依赖树
- 操作历史与回滚

## 调研与设计

见 [docs/PLAN.md](docs/PLAN.md)。

## License

MIT