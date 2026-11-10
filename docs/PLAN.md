# npm-atlas 方案文档

> 本机 npm 全景扫描与可视化管理工具
> 版本：v0.1 方案 / 2026-11-10

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
- [ ] 默认 npm 切换方案（需修改 shell 配置，单独设计）

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