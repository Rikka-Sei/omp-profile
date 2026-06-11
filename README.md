# omp-profile

给 [omp（oh-my-pi）](https://github.com/can1357/oh-my-pi) 加一套「环境档案」，
就像 VS Code 的 Profile 一样：把你常用的一整套配置——主模型、工具集、要挂的
MCP、规则——存成一个有名字的 profile，然后在会话里用 `/profile` 一键切换。

## 为什么要它

你大概有过这种场景：

- 写项目 A 时想用 Opus 当主力、挂上数据库 MCP；
- 跑实验目录只想用便宜模型、什么 MCP 都不挂；
- 写文档又是另一套。

omp 本身能配模型、工具、MCP，但没法把「这一整套」打包起来一键切。每次手动改
配置很烦。omp-profile 就是来干这件事的：配一次，存成 profile，之后一句
`/profile work` 就切过去。

## 安装

它是一个 omp 扩展。把这个目录放到 omp 会扫描的扩展位置之一：

- 想全局用：`~/.omp/agent/extensions/omp-profile/`
- 只给某个项目用：`<项目>/.omp/extensions/omp-profile/`

然后装一下依赖（只有一个 `yaml`）：

```sh
bun install
```

下次启动 omp 就会自动加载它。

## 用起来

```
/profile                  打开选单，挑一个切过去
/profile work             直接切到名叫 work 的 profile
/profile list             看看都有哪些 profile（带 ● 的是当前这个）
/profile show             看当前 profile 的内容（也可以 /profile show work）
/profile create <name>    建一个新的
/profile delete <name>    删掉一个
/profile help             忘了命令就敲这个
```

建一个 profile，比如给项目 A：

```
/profile create work \
  --model anthropic/claude-opus-4-5:high \
  --plan-model openai/gpt-5.4 \
  --tools read,edit,bash,task \
  --mcp filesystem,postgres \
  --bind-path ~/work/projectA \
  --description "项目 A 主力环境"
```

`--bind-path` 把这个 profile 绑到一个目录：以后在 `~/work/projectA` 下面启动
omp，它会自动切到 `work`，不用你手动敲。

## profile 长什么样

就是一个 YAML 文件，放在 `~/.omp/agent/profiles/<name>.yml`（或者项目里的
`.omp/profiles/<name>.yml`，项目里的同名会盖过全局的）。你也可以直接手写：

```yaml
name: work
description: 项目 A 主力环境
modelRoles:
  default: anthropic/claude-opus-4-5:high   # 后缀 :high 是思考档位，也能用 :low/:medium 等
  plan: openai/gpt-5.4
tools: [read, edit, bash, task]
mcp:
  enabled: [filesystem, postgres]
rules: [house-style]
boundPaths: [~/work/projectA]
```

没写的字段会沿用 omp 本来的配置，不会被清空。

## 切换的时候会发生什么

切 profile 的瞬间，下面这些会**立刻生效**：

- 主模型
- 思考档位
- 启用的工具集

而**角色模型**（plan / smol / slow 这些）、**MCP 的开关**、**规则**——这些 omp
目前没有给扩展开运行时切换的口子，所以切 profile 时不会立刻改。它们仍然会**完整
存在 profile 文件里**，切换时也会明确提示你「这几项这次没应用」，不会偷偷丢掉。
（等 omp 把这些接口放开，或者走「改配置 + reload」的路子打通，这里就能补上。）

## 谁说了算（优先级）

同时有好几个来源想决定用哪个 profile 时，从高到低：

1. 你在会话里 `/profile` 手动切的
2. 当前目录绑定的（`boundPaths`）
3. omp 自己的全局配置（`~/.omp/agent/`，这套东西 omp-profile 从不去动）

## 本地开发

```sh
bun install
bun run typecheck
bun test
```

`types/omp.d.ts` 是从 omp 真实的类型声明里摘出来的一小块，只留我们用到的部分，
这样编译时能对着 omp 的真实接口检查，又不用把整个几十兆的宿主包拖进来。

代码大致是这么分的：

```
index.ts          入口：注册 /profile，挂上目录自动切的钩子
src/model-ref.ts  解析 "provider/id:thinking" 这种模型写法
src/schema.ts     profile 的结构和校验
src/store.ts      读写 profile 文件
src/resolve.ts    目录绑定的匹配
src/apply.ts      把一个 profile 套用到当前会话
src/commands.ts   /profile 各个子命令
src/roles.ts      角色和思考档位的常量
src/builtin.ts    内置的 empty profile（排障用，关掉所有 MCP 和多余工具）
```
