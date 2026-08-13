# dsh-jina

DeepSeek Harness 的 [Jina AI](https://jina.ai/) 插件（bundle）：把 jina-cli 的全部 API 能力以模型工具的形式装进 dsh，并在 Web 设置的**插件 → 配置**页（与 终端 / Agent 循环 / 网页搜索 相同的标准插件配置位置）提供 **Jina Tools** 卡片来配置 API key。

## 功能

安装后所有会话（所有 agent preset）都会获得 10 个 `jina_*` 工具：

| 工具 | 对应 jina-cli 命令 | 说明 |
| --- | --- | --- |
| `jina_search` | `jina search` | 网页搜索（web / arxiv / ssrn / images / blog），支持时间过滤与地区/语言提示 |
| `jina_read` | `jina read` | 把网页读成干净的 markdown |
| `jina_screenshot` | `jina screenshot` | 网页截图，返回托管图片 URL（支持整页截图） |
| `jina_datetime` | `jina datetime` | 推测网页的发布/更新时间 |
| `jina_expand` | `jina expand` | 把搜索词扩展成一组相关查询 |
| `jina_embed` | `jina embed` | 文本向量化（默认 jina-embeddings-v5-text-small） |
| `jina_rerank` | `jina rerank` | 按相关性重排文档（默认 jina-reranker-v3.5） |
| `jina_classify` | `jina classify` | 文本分类 |
| `jina_pdf` | `jina pdf` | 从 PDF 提取图表/公式（支持 arXiv ID） |
| `jina_primer` | `jina primer` | 获取当前时间/位置/网络上下文信息 |

## 安装

插件按 [bundle](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/publish.md) 方式分发，用 `dsh plugin` 安装进 profile（从源码 checkout 运行时用 `pnpm dsh` 代替 `dsh`）：

```sh
# 从 GitHub 安装（本项目无 build 脚本，无需 allowBuilds 授权）
dsh plugin --profile web add github:<you>/jina-dsh-plugin

# 或本地文件夹安装（开发调试用）
dsh plugin --profile web add ./jina-dsh-plugin
```

安装完成后**重启** dsh（新 bundle 在下次启动时生效）：

```sh
dsh --profile web
```

然后打开 Web 界面 → 设置 → **插件** → **配置** 选项卡 → 展开 **Jina Tools** 卡片 → 粘贴 API key → 保存。免费 key 在 https://jina.ai/?sui=apikey 获取。

卡片中的 **API key 检测** 区域会实时显示当前 key 的身份（Jina 账号）与余额（credits），并标注 key 的来源（本页保存 / key 文件 / 匿名配额），用于确认 key 是否真正生效；点击「刷新」重新检测（保存/清除 key 后也会自动重检）。该数据由主机端插件通过 `/api/dsh-jina/primer` 路由提供（与 `jina_primer` 工具同一接口），**key 明文永不离开主机**。

## API key 解析顺序

每次工具调用按以下顺序找 key（任一命中即用）：

1. 工具调用参数 `apiKey`
2. 设置页保存的 key（credential 引用 `JINA_API_KEY`，由 dsh 凭据存储持久化，如 `~/.dsh/.credentials.yaml`）
3. 会话工作区的 `jina-api-key.txt`
4. dsh 主目录（`$DSH_HOME`，默认 `~/.dsh`）下的 `jina-api-key.txt`

设置页保存新 key 后立即生效（无需重启，每次调用即时解析）；HTTP 401 时也会自动重读文件并重试一次。凭据值只通过 `credentials.set` 上行，任何读取接口都不会回传明文。同时支持在页面上一键清除。

## 网络与代理（中国大陆用户）

Jina 域名被直连网络屏蔽，需要 VPN。插件通过系统代理访问 Jina：每次调用前从 WinINET 注册表发现系统代理地址，传输失败时自动重新发现并重试一次——VPN 重启换了端口也能自愈。VPN 未开时工具会返回带提示的错误信息。

## 卸载

```sh
dsh plugin --profile web remove dsh-jina
```

## 仓库结构

```
jina-dsh-plugin/
├── package.json       # manifest: "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
├── cordis.patch.yml   # 组合层：插入 dsh-jina（主机工具行）与 dsh-jina/ui（客户端 UI 行）
├── index.js           # 主机插件：10 个工具 + 网络传输 + JINA_API_KEY 凭据解析
├── ui/
│   ├── package.json   # dsh.client 声明（platform: web）
│   ├── index.js       # 空主机半身（保证 loader 行可用）
│   └── client.js      # 预构建浏览器 bundle：设置 → 插件 → 配置 的 "Jina Tools" 卡片
└── README.md
```

## 开发说明

- 主机插件只依赖 Node 内置模块与 dsh 主机服务（`fs`、`subprocess`、`tools`、`credentials`），无第三方 npm 依赖；凭据走 dsh 原生的 credential seam（引用 `JINA_API_KEY`），任何 profile 组合都可以直接使用。
- 客户端 bundle 直接提交（`ui/client.js`），无构建步骤，git 安装开箱即用。改 UI 后直接改该文件并重启即可。卡片注册进 Web 设置包声明的 `settings.plugin.item` 插槽（设置 → 插件 → 配置），这是第三方插件配置的标准位置；key 通过标准的 `credentials.describe/set/unset` RPC 管理（这是唯一对第三方插件开放的配置通道——settings 命名空间对浏览器有白名单限制）。
- 组合层遵循 dsh 约定：主机行 `dsh-jina` 注册模型工具；客户端行 `dsh-jina/ui` 由 host 的 client-modules 服务通过 `ui/package.json` 的 `dsh.client` 声明发现并接入 Web boot graph。
