# omp-profile

VS Code Profile 式的「环境档案」扩展，为 [omp（oh-my-pi）](https://github.com/can1357/oh-my-pi)
而做。把「主模型 + 工具集 + MCP + 规则」打包成命名 profile，**全部通过会话内
`/profile` slash command** 操作——不碰 omp 核心、不依赖任何外部服务。

> 当前进度：**P0 MVP**（数据模型 / 命令式创建 / `/profile` 切换 / list·show·delete /
> 优先级链 / 目录自动切 / empty profile）。导出导入、向导、模板等见 PRD 后续迭代。

## 安装

作为 omp 扩展加载。把本目录放到下列任一位置：

- 用户级：`~/.omp/agent/extensions/omp-profile/`
- 项目级：`<项目>/.omp/extensions/omp-profile/`

然后安装依赖：

```sh
bun install   # 仅需 yaml 运行时依赖
```

omp 启动时会发现 `index.ts` 入口并加载该扩展（`@oh-my-pi/pi-coding-agent`
由宿主在运行时注入，扩展自身不打包它）。

## 用法

```
/profile                      打开选单，选中即切换
/profile <name>               直接切换到指定 profile
/profile list                 列出全部 profile（● 标记当前激活）
/profile show [name]          查看 profile（省略则看当前）
/profile create <name> [flags]  命令式创建
/profile delete <name>        删除
/profile help                 帮助
```

`create` 常用 flag：

```
/profile create work \
  --model anthropic/claude-opus-4-5:high \
  --plan-model openai/gpt-5.4 \
  --tools read,edit,bash,task \
  --mcp filesystem,postgres \
  --bind-path ~/work/projectA \
  --description "项目 A 主力环境" \
  --scope user        # user(默认) | project
```

## Profile 文件

单文件 YAML，存放于 `~/.omp/agent/profiles/<name>.yml`（用户级）或
`<项目>/.omp/profiles/<name>.yml`（项目级，同名时项目级优先）。

```yaml
name: work
description: 项目 A 主力环境
modelRoles:
  default: anthropic/claude-opus-4-5:high   # 支持 :off/:minimal/:low/:medium/:high/:xhigh
  plan: openai/gpt-5.4
tools: [read, edit, bash, task]
mcp:
  enabled: [filesystem, postgres]
  disabledServers: [legacy]
rules: [house-style]
boundPaths: [~/work/projectA]
```

## 运行时能力与已知限制

切换 profile 时，基于 omp 真实 `ExtensionAPI` 能**热生效**的部分：

| 内容 | 是否热生效 | 机制 |
|---|---|---|
| 主模型（default 角色） | ✅ | `setModel` |
| thinking 档位 | ✅ | `setThinkingLevel` |
| 工具集 | ✅ | `setActiveTools` |
| 角色模型（smol/slow/plan/…） | ⚠️ 暂不 | `ExtensionAPI` 未暴露按角色覆盖 |
| MCP 启用/禁用 | ⚠️ 暂不 | 同上 |
| rules / fallbackChains | ⚠️ 暂不 | 同上 |

未能热生效的字段会被**完整保存**在 profile 文件中，并在切换时通过 `notify`
明确提示「未应用」，不会被静默丢弃。这些字段对 omp 自身配置/默认行为无副作用。

## 优先级链（PRD §4.6）

由高到低：① 会话内 `/profile` 显式切换 → ② 目录绑定自动激活 → ③ omp 全局默认配置
（`~/.omp/agent/`，本扩展从不修改它）。profile 内未设置的字段一律回落到下一级。

## 开发

```sh
bun install
bun run typecheck   # tsc --noEmit
bun test            # 单元测试
```

类型声明 `types/omp.d.ts` 摘自真实 `@oh-my-pi/pi-coding-agent` 的 `.d.ts`，
只声明用到的子集，保证编译期严格对齐宿主契约。

### 目录结构

```
index.ts            扩展入口：注册 /profile + session_start 目录自动切
src/roles.ts        角色与 thinking 档位常量
src/model-ref.ts    解析 "provider/id:thinking"
src/schema.ts       Profile 数据模型 + 校验
src/builtin.ts      内置 empty profile
src/resolve.ts      目录绑定匹配 + 优先级
src/store.ts        profile YAML 存取（用户级/项目级）
src/apply.ts        把 profile 应用到会话
src/commands.ts     /profile 命令分发与参数解析
types/omp.d.ts      宿主 API 类型声明子集
test/               单元测试
```
