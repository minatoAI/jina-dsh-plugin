# dsh-jina

DeepSeek Harness 的 [Jina AI](https://jina.ai/) 插件（bundle）：把 jina-cli 的全部 API 能力以模型工具的形式装进 dsh，并在 Web 设置面板提供 **Jina Tools** 页面来配置 API key。

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

然后打开 Web 界面 → 左下角 设置 → **Jina Tools** → 粘贴 API key → 保存。免费 key 在 https://jina.ai/?sui=apikey 获取。

## API key 解析顺序

每次工具调用按以下顺序找 key（任一命中即用）：

1. 工具调用参数 `apiKey`
2. 设置页保存的 key（settings 命名空间 `jina-tools`，持久化于 dsh 主目录的 settings 文件）
3. 会话工作区的 `jina-api-key.txt`
4. dsh 主目录（`$DSH_HOME`，默认 `~/.dsh`）下的 `jina-api-key.txt`

设置页保存新 key 后立即生效（无需重启）；HTTP 401 时也会自动重读文件并重试一次。

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
├── index.js           # 主机插件：10 个工具 + 网络传输 + settings 命名空间
├── ui/
│   ├── package.json   # dsh.client 声明（platform: web）
│   ├── index.js       # 空主机半身（保证 loader 行可用）
│   └── client.js      # 预构建浏览器 bundle：设置面板 "Jina Tools" 页
└── README.md
```

## 开发说明

- 主机插件只依赖 Node 内置模块与 dsh 主机服务（`fs`、`subprocess`、`tools`、`settings`），无第三方 npm 依赖；`@deepseek-ai/schemastery` 通过 dsh 的 profile 回退 node_modules 动态解析，缺失时自动降级为仅文件配置。
- 客户端 bundle 直接提交（`ui/client.js`），无构建步骤，git 安装开箱即用。改 UI 后直接改该文件并重启即可。
- 组合层遵循 dsh 约定：主机行 `dsh-jina` 注册模型工具；客户端行 `dsh-jina/ui` 由 host 的 client-modules 服务通过 `ui/package.json` 的 `dsh.client` 声明发现并接入 Web boot graph。
