# 更新日志

本文件记录 dsh-jina 的完整版本历史；[README.md](./README.md) 的「更新日志」一节只保留最新版本。

### 0.4.0（2026-08-18）

- **feat** 网页检索工具更名 `jina_search` → `jina_web_search`，工具名直接点明「web 搜索」，与内置 `web_search` 的命名信号对齐；描述重构为「任务优先 + 触发条件」：首句说明返回摘要与官方源置顶链接，`Use this whenever...` 写明何时调用（时效内容 / 新闻 / 时间过滤）及与内置 `web_search` 的分工（泛用 / 工程文档覆盖更广）；`query` 参数描述补充「配合 `time` 参数做时效检索」的指引。
- **refactor** 网页检索工具的模型可见契约（名称 / 描述 / 参数）抽为纯数据模块 `tool-contracts.js`，`index.js` 以展开方式注册；设置卡片提示文案同步更新。
- **test** 新增 `test/tools.test.js`（TDD，先红后绿）：固化 `jina_web_search` 的模型可见契约——改名、任务优先开头、触发条件、与内置 `web_search` 的分工、官方源 / 时效差异化信号、`query` 参数指引与描述长度预算。

### 0.3.1（2026-08-18）

- **fix** 适配 dsh 本体的 keyed slot 契约：设置 → 插件 → 配置 的 `settings.plugin.item` 插槽改为按「卡片编辑的设置命名空间」键控（同 `tool.call.toolview` 约定），配置区只派发主机已 serve 的命名空间对应卡片。
- **fix** 浏览器半身的 **Jina Tools** 卡片改用 `key: 'jina-tools'` 注册；主机半身新增同名 `jina-tools` 设置命名空间（空 schema、零依赖，仅用于配对；API key 仍只走 `JINA_API_KEY` 凭据通道），两侧命名空间一致时才渲染卡片。不含设置提供方的 profile 不挂载注入，其余行为不变。

### 0.3.0（2026-08-15）

- **feat** `jina_primer` 重做：返回真实上下文——主机时钟（ISO 时间 / unix / 时区 / UTC 偏移）、网络事实（公网 IP 与位置，尽力而为，失败时降级）与 Jina 账户状态（身份 / 余额）。解析与格式化抽成纯函数模块 `primer.js`，新增 17 个零依赖单元测试（`npm test`）。
- **fix** 工具描述不再把「需要 API key」列为前置条件。

### 0.2.0（2026-08-14）

- **feat** 新增 `jina_search_arxiv` / `jina_search_ssrn` 专用学术检索工具（对应 `jina search --arxiv` / `--ssrn`），工具名即用途；README 增加与内置 `web_search` 的交叉对比表。
- **feat** 设置页 **Jina Tools** 卡片实时显示当前 key 的身份与余额（经 `/api/dsh-jina/primer`，可手动刷新；保存 / 清除 key 后自动重检）。
- **feat** `jina_datetime` 返回提取出的标题 / 发布时间，不再吐原始 JSON 块。
- **fix** 工具参数改为规范的 JSON Schema；设置 UI 移入标准插件配置位置（设置 → 插件 → 配置）。
- **refactor** API key 改走 dsh 原生凭据通道（`JINA_API_KEY` credential seam）。
- **fix** 增强 `link:` 安装的 schemastery 解析；导出 `package.json` 子路径。
- **style** 设置页主题 token 增加降级颜色。
- **docs** 新增英文 README 与语言切换链接；修正 README 安装命令的仓库地址与 key 获取链接。

### 0.1.0（2026-08-14）

- **feat** 首版：dsh-jina bundle——10 个 `jina_*` 模型工具（search / read / screenshot / embed / rerank / classify / pdf / expand / datetime / primer）+ 设置页 API key 配置 UI。
