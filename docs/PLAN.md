# npm-atlas 方案文档

> 本机 npm 全景扫描与可视化管理工具
> 版本：v0.2 方案 / 2026-11-11（补充项目级管理）

## 1. 调研结论（GitHub CLI 实查）

### 1.1 检索范围

使用 `gh search repos` / `gh api` 检索了 npm GUI、全局包管理、Node 版本管理、package.json 依赖管理等方向，重点候选：

| 项目 | 星数 | 许可 | 技术栈 | 能覆盖什么 | 不能覆盖什么 |
| --- | --- | --- | --- | --- | --- |
| [q-nick/npm-gui](https://github.com/q-nick/npm-gui) | 672 | MIT | TypeScript + Web UI | 项目级 package.json 依赖的安装/更新/卸载；npx 启动本地 Web 服务 | 不扫描本机多个 npm；不管全局包；不识别默认 npm |
| [1111mp/nvm-desktop](https://github.com/1111mp/nvm-desktop) | 1415 | MIT | Tauri + TypeScript | 多 Node 版本安装、切换、路径识别 | 不管理 npm 全局包；不区分 npm 自身版本 |
| [07Gond/npm-global-rm-interactive](https://github.com/07Gond/npm-global-rm-interactive) | 21 | — | Node CLI | 交互式卸载全局包 | 无 GUI、无更新、无多安装扫描 |
| 其余 npm-manager / VS Code 插件 | 0–56 | 各异 | Electron / VS Code | 单项目依赖表格 | 与目标场景不匹配或长期无维护 |

### 1.2 复用策略

结论：**没有可直接使用或 fork 的完整项目**，采用「自建主体 + 借鉴交互」策略。

- 复用（思路，不复制代码）：
  - `npm-gui`：npx 启动本地 Web UI、依赖表格的批量操作交互。
  - `nvm-desktop`：多 Node 安装的路径枚举、来源识别、默认项标记。
- 自研核心：
  - 多 npm 安装发现与去重（PATH / nvm / fnm / mise / volta / asdf / Homebrew / n / 自定义）。
  - 每个安装的全局包清单、可更新状态、更新/卸载执行器。
  - 可视化总览与安装切换。
- 不采用：
  - Electron / Tauri 外壳（首版）。本地 Web 服务即可完成全部系统操作，打包成本低、AI 迭代快。
  - 直接读取 `node_modules` 目录猜测包信息。以 npm 自身输出为准，避免误判。

## 2. 需求拆解

### P0（首版必须）

1. 自动扫描本机所有 npm 可执行文件：路径、真实路径、npm 版本、Node 版本、全局 prefix / root、registry。
2. 标记默认 npm（PATH 中第一个可用项）与来源（mise / Homebrew / nvm …）。
3. 列出每个 npm 安装下的全局包：名称、当前版本、最新版本、是否可更新。
4. 对指定安装执行：单包更新、批量更新、单包卸载。
5. 可视化：安装列表、包表格、搜索/筛选/排序、操作反馈。
6. 安全：仅允许操作扫描结果中存在的安装与包；命令使用参数数组执行，不经过 shell。

### P1（后续）

- npm 安装切换 / 修改默认（涉及 PATH 与 shell 配置，风险较高）。
- 包详情（description、主页、依赖树）。
- 历史记录与回滚。
- Windows 支持。
- 导出清单 / 备份全局包。

## 3. 技术选型

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 语言 | TypeScript（strict） | 类型即文档，AI 生成代码时错误更早暴露 |
| 服务端 | Hono + @hono/node-server | 极轻、API 直观、单文件可读，适合本地工具 |
| 前端 | React 19 + Vite | 生态成熟、热更新快、AI 训练语料充足 |
| 样式 | Tailwind CSS v4（Vite 插件） | 无配置文件、类名即样式，便于快速迭代 |
| 图标 | lucide-react | 轻量、按需引入 |
| 运行 | tsx（开发）/ esbuild（构建）/ Node | 无复杂构建链，`pnpm dev` 即用 |
| 包管理 | pnpm | 安装快、本机已具备 |

明确排除：Next.js（本地工具不需要 SSR/路由约定）、Electron/Tauri（首版打包成本高）、数据库（扫描结果内存缓存即可）。

### 面向 vibe coding 的约束

- 单仓库、单 package.json，服务端/前端/共享类型三个目录，无 monorepo 工具。
- 所有 API 与数据模型集中在 `shared/types.ts`，前端不重复定义。
- 脚本固定：`pnpm dev` / `pnpm typecheck` / `pnpm build` / `pnpm start` / `pnpm scan`。
- 错误信息直接透出 npm stderr，不做模糊包装。
- 不引入状态管理库；一个 `useScan` hook + 局部 state。

## 4. 架构

```
┌────────────────────────────┐
│ React (Vite, port 5173)    │  dev 时 proxy /api → 4317
│ 安装列表 / 包表格 / 操作    │
└─────────────┬──────────────┘
              │ HTTP JSON
┌─────────────▼──────────────┐
│ Hono (port 4317)           │
│ /api/scan  扫描与缓存       │
│ /api/action 更新/卸载       │
└─────────────┬──────────────┘
              │ execFile（参数数组，无 shell）
┌─────────────▼──────────────┐
│ scanner: 发现 → 探测 → 解析  │
│ npm -v / root -g / prefix -g│
│ npm ls -g --json            │
│ npm outdated -g --json      │
└────────────────────────────┘
```

### 4.1 安装发现算法

1. 枚举 PATH 中每个目录下的 `npm`（按顺序，第一个可用者即默认候选）。
2. 枚举常见版本管理器目录：
   - nvm：`$NVM_DIR/versions/node/*/bin/npm`、`~/.nvm/versions/node/*/bin/npm`
   - fnm：`~/.fnm/node-versions/*/installation/bin/npm`、macOS Application Support 路径
   - mise：`~/.local/share/mise/installs/node/*/bin/npm`、`.../installs/npm/*/bin|package/bin/npm`
   - asdf：`~/.asdf/installs/nodejs/*/bin/npm`
   - n：`~/.n/versions/node/*/bin/npm`、`/usr/local/n/versions/node/*/bin/npm`
   - volta / Homebrew / Hermes / 系统目录
3. 按 realpath 去重候选。
4. 对每个候选使用「其所在目录优先」的 PATH 执行探测，避免 `env node` 命中别的 Node。
5. 以 `globalRoot + npm 版本` 二次去重，合并 shim 与真实安装；默认标记取并集，显示路径优先真实安装。

### 4.2 探测命令

| 目的 | 命令 |
| --- | --- |
| npm 版本 | `npm -v` |
| 全局根目录 | `npm root -g` |
| 全局 prefix | `npm prefix -g` |
| registry | `npm config get registry` |
| Node 版本 | `<prefix>/bin/node -v`（存在时），否则 `node -v` |
| 全局包 | `npm ls -g --depth=0 --json` |
| 可更新 | `npm outdated -g --json`（退出码非 0 时仍解析 stdout） |

### 4.3 执行器

- 更新：`npm install -g <name>@latest --no-audit --no-fund`
- 卸载：`npm uninstall -g <name> --no-audit --no-fund`
- 每次操作前校验 installationId 与包名均在最近一次扫描结果中。
- 包名正则：`^(@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$`（大小写不敏感）。
- 同一安装的操作串行（Promise 锁），避免 npm 并发写 prefix。
- 操作超时 5 分钟；完成后使缓存失效并重新扫描。

## 5. 数据模型

```ts
NpmInstallation {
  id, path, realPath, version, nodeVersion,
  prefix, globalRoot, registry, source, isDefault, inPath,
  packages[], packageCount, outdatedCount, error?
}

GlobalPackage { name, version, wanted?, latest?, outdated, location }

ScanResult { installations[], defaultPath, scannedAt, platform, durationMs }
```

## 6. 目录结构

```
npm-atlas/
  bin/npm-atlas.mjs        # npx / 全局安装后的启动入口
  server/
    index.ts               # Hono 服务与静态托管
    scanner.ts             # 发现、探测、解析、缓存
    executor.ts            # 更新/卸载执行器与校验
  shared/types.ts          # 前后端共享类型
  web/
    index.html
    src/
      main.tsx
      App.tsx
      api.ts
      components/          # Header / Stats / InstallationList / PackageTable / Dialog / Toast
  docs/PLAN.md
  scripts/build-server.ts  # esbuild 打包服务端（可选）
```

## 7. 里程碑与验收

### M1 脚手架 + 扫描（本次）

- [x] 方案文档
- [x] `pnpm dev` 同时启动 API 与前端
- [x] `pnpm scan` 输出本机 npm 安装 JSON
- [x] 页面展示安装列表、默认标记、包清单与可更新状态

### M2 管理动作（本次）

- [x] 单包更新 / 批量更新 / 单包卸载
- [x] 二次确认、逐项结果、失败原因透出
- [x] 操作后自动刷新

### M3 加固（后续）

- [ ] Windows 路径与 `npm.cmd`
- [ ] 权限失败时给出 sudo/prefix 修复建议
- [ ] 包详情与历史记录
- [x] 默认 npm 切换：`~/.npm-atlas/bin` 包装器 + shell PATH 标记块，带备份与一键恢复

### 验收标准

1. 本机至少识别出 mise 与 Homebrew 两类 npm 安装及真实路径。
2. 默认 npm 与 `which npm` 一致。
3. 每个安装的包数量与 `npm ls -g --depth=0` 一致。
4. 更新/卸载仅影响选中的安装，操作后列表反映新版本。
5. 前端在 1440px 与 390px 宽度下均可用。

## 8. 风险与对策

| 风险 | 对策 |
| --- | --- |
| shim 导致 npm 实际指向别的 Node | 执行时将该 npm 所在目录置于 PATH 首位；按 root+版本去重 |
| 全局包目录无写权限 | 透出 npm stderr，提示切换 prefix 或用对应版本管理器安装 |
| `npm outdated` 慢或离线 | 45s 超时；失败时包仍展示，仅缺失最新版本 |
| 同名包被多个安装共享（同一 prefix） | 视为同一安装，避免重复操作 |
| 命令注入 | 不使用 shell，包名白名单 + 正则校验 |
| 扫描结果过期 | 30s 内存缓存；操作后强制失效；UI 提供手动刷新 |

## 9. 命名

仓库 / npm 包名：**npm-atlas**（已确认 npm registry 与 GitHub 账号下均未被占用）。

## 10. 项目级管理（v0.2）

### 10.1 目标

在全局包管理之外，支持：

1. 扫描指定目录，发现包含 `package.json` 的 Node 项目，批量导入；
2. 读取每个项目的包管理器、锁文件、依赖清单、已安装版本与可更新状态；
3. 按项目使用的包管理器执行依赖更新、添加、移除与安装。

项目列表持久化在 `~/.npm-atlas/projects.json`，只记录规范化后的绝对路径与导入时间。

### 10.2 数据模型

```ts
ProjectInfo {
  id, path, displayPath, name, version, description, isPrivate,
  packageManager, packageManagerSource, lockfile,
  hasNodeModules, hasWorkspaces,
  packages[], packageCount, outdatedCount, linkedCount,
  addedAt, scannedAt, missing?, warning?, error?
}

ProjectPackage {
  name, range, type: 'prod'|'dev'|'optional'|'peer',
  installed, latest, outdated, linked, major
}
```

`linked` 表示 `workspace:`、`file:`、`link:`、`portal:`、`patch:`、`catalog:`、`npm:` 别名、git / http 地址等规格；这些依赖不会通过安装命令更新。

### 10.3 扫描与导入

- 目录支持 `~` 展开，必须是存在的绝对路径；拒绝 `/` 与系统目录。
- 广度优先遍历，默认向下 3 层（1–6 可调），跳过隐藏目录、`node_modules`、`.git`、构建产物、缓存、虚拟环境与部分系统目录；不跟随符号链接。
- 上限：8000 个目录 / 300 个候选；超出标记 `truncated`。
- 发现 `package.json` 后读取名称、版本、private、依赖数量与包管理器；仍继续向下遍历以覆盖 monorepo 子包。
- 导入时再次校验路径、目录与 `package.json` 存在，按 realpath 去重；单次最多 100 个。

### 10.4 包管理器识别

1. `package.json` 的 `packageManager` 字段（如 `pnpm@9.0.0`）；
2. 锁文件优先级：`pnpm-lock.yaml` → `yarn.lock` → `bun.lock` / `bun.lockb` → `package-lock.json` / `npm-shrinkwrap.json`；
3. `node_modules` 特征：`.pnp.cjs` → yarn、`node_modules/.pnpm` → pnpm、`node_modules/.package-lock.json` → npm；
4. 兜底 npm。

`workspaces` 字段或 `pnpm-workspace.yaml` 存在时视为 workspace 根，添加 / 移除依赖时使用 `--workspace-root`（pnpm）或 `-W`（yarn）。

### 10.5 依赖读取与可更新

- 依赖来源：`dependencies`、`devDependencies`、`optionalDependencies`、`peerDependencies`，同名以先出现的类型为准。
- 已安装版本：读取 `node_modules/<name>/package.json`，不存在时使用 `outdated` 命令返回的 `current`。
- 最新版本：在项目目录执行对应管理器的 `outdated`：
  - npm / pnpm：`outdated --json`；
  - yarn：`outdated --json`，解析 NDJSON table 事件，必要时解析表格文本；
  - bun：解析 `outdated` 表格。
- 失败回退：非 npm 项目若管理器缺失或无法读取锁文件，回退到 `npm outdated --json`（只读，不写文件）；仍失败时仅展示已安装版本并给出 warning。
- `outdated = installed && latest && installed !== latest`；跨主版本单独标记 `major`，用于确认提示。
- 项目级缓存 60 秒；操作后强制重读该项目，手动刷新读取全部。

### 10.6 执行器

| 操作 | npm | pnpm | yarn | bun |
| --- | --- | --- | --- | --- |
| 更新 / 添加 | `npm install <pkg>@latest` | `pnpm add <pkg>@latest` | `yarn add <pkg>@latest` | `bun add <pkg>@latest` |
| 移除 | `npm uninstall <pkg>` | `pnpm remove <pkg>` | `yarn remove <pkg>` | `bun remove <pkg>` |
| 安装全部 | `npm install` | `pnpm install` | `yarn install` | `bun install` |

- dev / optional 依赖使用对应的保存参数（`--save-dev` / `-D` / `-d`，`--save-optional` / `-O` / `--optional`）。
- 更新与添加按依赖类型分组，一组执行一次命令；结果按包展开返回。
- 目标包必须在最新解析出的 `package.json` 中声明；peer 依赖不能更新，`linked` 依赖不能更新或重新添加。
- 同一项目的操作串行执行；超时 5 分钟；输出截断 4000 字符；完成后重新读取项目。
- 命令以参数数组执行，不经过 shell；包名使用与全局执行器相同的正则校验。

### 10.7 安全

- 扫描只接受本机请求（沿用 `/api/*` 的本机 Host / Origin 校验），拒绝系统根目录并可限制深度与数量。
- 导入路径必须 realpath 后仍是目录，且存在 `package.json`；移除记录不触碰磁盘文件。
- 项目动作只作用于已导入项目；依赖名必须同时通过正则与项目清单校验。
- 工具不会自动处理跨主版本兼容性，更新前在确认对话框中明确提示；会改写项目 `package.json` 与锁文件。

### 10.8 验收

1. 能从 `~/DevSpace` 扫描出包含 `package.json` 的项目，并跳过 `node_modules` 与构建目录。
2. npm / pnpm 项目能读取正确的已安装版本与可更新版本；yarn / bun 缺失时给出可读的回退信息。
3. 导入后重启服务，项目列表仍在；移除记录不影响磁盘文件。
4. 更新 / 添加 / 移除 / 安装全部依赖分别执行对应包管理器命令，并同步刷新项目数据。
5. 项目视图在 1440px 与 390px 宽度下可用，深 / 浅色主题与全局视图均无回归。