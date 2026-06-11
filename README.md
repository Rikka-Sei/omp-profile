# omp-profile

omp 的环境 profile 扩展。将一套配置（主模型、工具、MCP、规则）保存为一个命名
profile，在会话中通过 `/profile` 切换。功能类似 VS Code 的 Profile。

## 用途

omp 本身可以配置模型、工具和 MCP，但没有将整套配置打包切换的机制，切换项目时
需要手动修改配置。profile 将这套配置保存为一个文件，按名称切换。例如项目 A
使用 Opus 并启用数据库 MCP，实验目录使用低成本模型且不启用 MCP，通过
`/profile` 即可切换。

## 安装

通过 omp 的插件命令安装，依赖会自动处理：

```sh
omp plugin install github:Rikka-Sei/omp-profile
```

也可使用其他来源：

```sh
omp plugin install omp-profile                              # 发布到 npm 后
omp plugin install https://github.com/Rikka-Sei/omp-profile # 完整 git URL
omp plugin install ./omp-profile                            # 本地目录，等同 omp plugin link，用于开发
```

安装后重启 omp 生效。

## 用法

```
/profile              打开选单切换
/profile work         切换到 work
/profile list         列出全部 profile
/profile show [name]  查看内容，省略 name 时查看当前 profile
/profile create <name> [flags]
/profile delete <name>
/profile help         查看帮助
```

创建示例：

```
/profile create work \
  --model anthropic/claude-opus-4-5:high \
  --tools read,edit,bash,task \
  --mcp filesystem,postgres \
  --bind-path ~/work/projectA
```

`--bind-path` 将 profile 绑定到目录，之后在该目录下启动 omp 会自动切换到它。

## 配置文件

profile 是单个 YAML 文件，位于 `~/.omp/agent/profiles/<name>.yml`（全局）或
`<项目>/.omp/profiles/<name>.yml`（项目级，同名时覆盖全局）。也可手动编写：

```yaml
name: work
modelRoles:
  default: anthropic/claude-opus-4-5:high   # :high 为思考档位
  plan: openai/gpt-5.4
tools: [read, edit, bash, task]
mcp:
  enabled: [filesystem, postgres]
boundPaths: [~/work/projectA]
```

未设置的字段沿用 omp 的现有配置。

## 切换时的生效范围

切换 profile 时立即生效的部分：主模型、思考档位、工具集。

角色模型、MCP 开关、规则目前不会立即生效，因为 omp 尚未向扩展开放这些项的运行
时切换接口。它们仍会完整保存在 profile 文件中，切换时会提示哪些项未应用，不会
被丢弃。相关接口开放后再补充支持。

## 优先级

由高到低：会话内 `/profile` 手动切换、目录绑定、omp 全局配置。本扩展不修改 omp
自身的配置（`~/.omp/agent/`）。

## 开发

```sh
bun install
bun run typecheck
bun test
```

`types/omp.d.ts` 是 omp 真实类型声明的子集，仅包含本扩展用到的部分，用于编译时
对照宿主接口进行检查，避免引入完整的宿主包。
