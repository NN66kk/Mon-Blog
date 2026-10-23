# Quartz 隔离构建实验

结论：继续使用 MkDocs。Quartz 的双链、反链、图谱和中文搜索适合知识花园，但本项目目前的 URL、发布状态、RSS、主题/系列模板都需要专门迁移。实际构建已通过，不等于可以直接替换生产。

本实验只导出公开内容到 `/private/tmp`，不修改 `docs/`、发布状态、生产配置或部署流程，不上传内容。仓库只保留两个实验脚本和本报告；第三方源码、依赖、生成站点与日志均留在临时目录。

## 版本与范围

核验日期：2026-10-22。官方当前文档为 Quartz 5，要求 Node.js 22+、npm 10.9.2+；此次固定官方 `v5` 分支提交 `97a2d05f80c4c50534959b1d0d41cc4b3895625e`，包版本为 `5.0.0`。这不是 `v5.0.0` 标签提交（标签对应 `ab346fa66a895e12d63a308e70ce330ba795822a`）。官方说明见 [Quartz 文档](https://quartz.jzhao.xyz/)、[该固定提交的 package.json](https://github.com/jackyzha0/quartz/blob/97a2d05f80c4c50534959b1d0d41cc4b3895625e/package.json)。

实际环境：macOS，Node.js `v24.13.0`、npm `11.6.2`、Python `3.9.6`、MkDocs `1.6.1`、Material `9.7.4`。原始公开内容基于本项目提交 `1bd61019c635cb6771b538e5d1aeed6fd0be57c6`，实验时共享配置重构处于工作区；每个输入文件的 SHA-256 已记入 `manifest.json`。

`prepare.py` 使用 MkDocs `load_config` 和 `get_files`，因此识别 `INHERIT: shared/blog.json` 和现有排除规则，再显式过滤 `draft`、`private` 状态。最终输入为 258 篇 Markdown、29 个公开媒体文件；4 篇真实草稿和 2 篇配置排除文档未进入 Quartz 内容目录。没有把完整笔记库交给 Quartz 后再依赖其过滤器。媒体按现有 MkDocs 可发布范围导出，并不建立新的附件私密规则。

两组输入：

- `raw`：原始公开 Markdown，保持源内容。
- `adapted`：只在临时副本中补标题、部分日期、标签数组、`hidden/redirect → unlisted`，并调用本项目现有 Dataview 静态转换。它用于验证最小桥接成本，不是完整迁移器。

实验配置沿用 Quartz 默认主题及主要插件，关闭统计、远程字体、OG 图片等非必要功能；不复制 Git 历史，日期来源仅为 frontmatter 和文件系统。两组分别约 6 秒、5 秒完成构建。日志仍有原文公式包含 Unicode 空格/破折号的 KaTeX 警告，未进行逐篇公式视觉验收。

## 实际对照结果

| 检查项 | raw | adapted | 含义 |
| --- | ---: | ---: | --- |
| 公开 Markdown | 258 | 258 | 相同内容集合 |
| 生成 HTML | 330 | 338 | 包含额外目录、标签和别名页 |
| 搜索索引条目 | 328 | 335 | 包含生成的索引页 |
| 开启 Dataview 静态适配的路径 | 32 | 32 | 其中 28 页实际含受支持查询 |
| 正文仍显示 Dataview 查询代码的页面 | 28 | 0 | 现有静态转换可复用 |
| 源页面中有多个 H1 的页面 | 237 | 237 | Quartz 标题与正文首标题重复 |
| 缺少旧 MkDocs 目录式落盘目标的页面 | 257 | 257 | 旧 `.../index.html` 结构没有保留 |
| slug 与源路径去扩展名后不同 | 254 | 254 | 主要来自目录/文件名大小写归一 |
| 站内文件/锚点引用错误 | 0 | 0 | 按 Quartz 扩展名省略路由解析 |
| 被排除真实文档进入搜索索引 | 0 | 0 | 由导出阶段先行排除 |
| RSS 条目 | 10 | 10 | 默认数量；本项目 MkDocs 基线为 180 |
| RSS 中对应源文章的条目 | 0 | 0 | 此次 10 条全为生成的目录页 |

检查器对文件名按精确大小写匹配，解析生成 HTML 中的 `href/src/poster`、锚点和 RSS，检查范围是本次本地产物；不请求生产站点，不验证外链、所有交互或未来部署重写。`legacy_directory_url_missing = 257` 表示落盘结构不兼容，不能直接推断线上一定出现 257 个 404；部署端重写可能改变结果，需要单独验证。

### URL 必须有明确兼容层

例如源文件 `B-Notes/BM25算法_20251012115917.md`，旧目录式地址为 `B-Notes/BM25算法_20251012115917/`，Quartz 生成 `b-notes/bm25算法_20251012115917.html`，内部导航采用省略扩展名的地址。

Quartz 5 默认 URL 改为小写和连字符，并通过 AliasRedirects 尝试保留旧大小写入口，见 [官方迁移说明](https://github.com/jackyzha0/quartz/blob/97a2d05f80c4c50534959b1d0d41cc4b3895625e/docs/getting-started/migrating.md)。但它不是 MkDocs 目录式 URL 的迁移器；本机大小写不敏感文件系统上，插件还会主动跳过会冲突的大小写别名。正式迁移前需要明确的旧 URL 映射、静态跳转或托管平台重写，并在 Linux 大小写敏感环境验收。RSS GUID、canonical 和正文链接也要一起处理。

### 发布状态不能只交给默认 RemoveDrafts

直接调用当前安装版本的 `RemoveDrafts.shouldPublish`，得到：

| frontmatter | Quartz 默认是否发布 |
| --- | --- |
| `draft: true` | 否 |
| `draft: "true"` | 否 |
| `status: draft` | 是 |
| `status: private` | 是 |
| `status: hidden` | 是 |
| `status: published` 加 `draft: true` | 否 |

本项目显式 `status` 的优先级及 `draft/private/hidden/redirect` 语义与其不同。真实私有内容未用于上述探针。迁移必须继续复用本项目共享发布契约，并分别控制页面、搜索、反链/图谱、RSS；`unlisted` 不是文件访问控制。证据保存在临时目录的 `publication-contract.json`。

### 双链、附件、Dataview

现有公开内容的双链、相对图片链接和站内锚点在构建产物中通过检查；Quartz 自带反链和图谱，浏览器中可见。官方支持 wikilinks、别名、标题/块引用、嵌入、callout、Mermaid 等 Obsidian 语法，但 Dataview 的官方路径是先由 Quartz Syncer 导出静态结果，并非核心引擎执行查询，见 [Obsidian compatibility](https://quartz.jzhao.xyz/features/obsidian-compatibility)。

本项目现有的 28 个“当前页未完成任务”查询可用既有 hook 在导出时转成普通 Markdown；本实验保留原来的 opt-in 范围，教学示例不被当成待执行查询。不能据此声称任意 Dataview、跨笔记查询或 DataviewJS 已兼容。适配时还移除了 Python Markdown 专用 `markdown="1"` 包裹，避免生成的列表继续作为原始 HTML 处理。

### RSS、栏目系列与自定义模板

两组默认 `index.xml` 都仅有 10 条，而且本次全是目录页，时间为本次构建时间；对照本项目已验证的 180 篇文章 RSS，语义明显不一致。部分日期映射不能解决完整问题：还需要本项目发布日期/修订时间的优先级和文件名兜底、生成页与隐藏/跳转页排除、排序及条数策略、旧 `feed.xml` 订阅入口和稳定 GUID。

Quartz 默认目录/标签索引已生成，但不认识本项目 `template: topics.html` 等 Material/Jinja 模板。主题聚合卡片、系列顺序、系列前后篇和当前首页布局没有自动迁移。需要重新实现 Quartz 组件/插件及样式；不是复制 `overrides/` 即可。当前 237 页重复 H1，首页还有 `{#home-title}` 属性列表字面量，这些都是实际可见差异。

### 中文搜索

官方使用 FlexSearch，并提供中日韩分词支持，见 [Full-text search](https://quartz.jzhao.xyz/features/full-text-search)。浏览器在本机真实产物搜索“信息茧房”，首条结果匹配同名文章，中文高亮和跳转目标正常；也试过“信息检索”。这证明基本可用，没有完成大规模相关性、混合中英文召回或移动端性能基准。

## 复现步骤

在本项目根目录运行，使用已安装项目依赖的 `.venv`。所有生成内容放进一个新临时目录，固定上游提交，不复用旧输出目录。Quartz 构建命令会清理指定输出位置，因此这里每组第一次构建前确保 `public` 不存在；不要把 `--output` 指向仓库或已有资料目录。

```sh
PROJECT_DIR="$PWD"
QUARTZ_TRIAL="$(mktemp -d /private/tmp/mon-blog-quartz.XXXXXX)"
git clone --no-checkout https://github.com/jackyzha0/quartz.git "$QUARTZ_TRIAL/quartz"
git -C "$QUARTZ_TRIAL/quartz" checkout --detach 97a2d05f80c4c50534959b1d0d41cc4b3895625e
cd "$QUARTZ_TRIAL/quartz"
npm ci --ignore-scripts --no-audit --no-fund --userconfig=/dev/null --registry=https://registry.npmjs.org --cache "$QUARTZ_TRIAL/npm-cache"
cd "$PROJECT_DIR"
.venv/bin/python experiments/quartz/prepare.py --quartz "$QUARTZ_TRIAL/quartz" --output "$QUARTZ_TRIAL/raw" --variant raw
.venv/bin/python experiments/quartz/prepare.py --quartz "$QUARTZ_TRIAL/quartz" --output "$QUARTZ_TRIAL/adapted" --variant adapted
cp "$QUARTZ_TRIAL/raw/quartz.config.yaml" "$QUARTZ_TRIAL/quartz/quartz.config.yaml"
cd "$QUARTZ_TRIAL/quartz"
test ! -e "$QUARTZ_TRIAL/raw/public" && npx --no-install quartz build --directory "$QUARTZ_TRIAL/raw/content" --output "$QUARTZ_TRIAL/raw/public" > "$QUARTZ_TRIAL/raw/build.log" 2>&1
test ! -e "$QUARTZ_TRIAL/adapted/public" && npx --no-install quartz build --directory "$QUARTZ_TRIAL/adapted/content" --output "$QUARTZ_TRIAL/adapted/public" > "$QUARTZ_TRIAL/adapted/build.log" 2>&1
cd "$PROJECT_DIR"
.venv/bin/python experiments/quartz/inspect_build.py --quartz "$QUARTZ_TRIAL/quartz" --trial "$QUARTZ_TRIAL/raw"
.venv/bin/python experiments/quartz/inspect_build.py --quartz "$QUARTZ_TRIAL/quartz" --trial "$QUARTZ_TRIAL/adapted"
```

`prepare.py` 不读取 `.env`、用户 npm 凭据或服务器配置，不执行部署；若输出目录已存在则拒绝执行。上述 `npm ci` 使用固定提交的 lockfile 和空用户配置，不改全局 npm 设置。本次实际安装使用 `npm install --ignore-scripts --no-audit --no-fund`，确认 lockfile 没有变化。最初尝试的 `v5.0.0` 标签引用 Git 依赖，其安装在本机网络代理/TLS 环境失败，失败目录已保留；后续固定当前提交，去掉该进程的代理环境并使用公共 npm registry 后成功。这是本机安装环境记录，不作为 Quartz 功能缺陷。

发布契约探针可在临时 Quartz 目录复现（只构造内存对象）：

```sh
node --input-type=module <<'JS'
import { RemoveDrafts } from '@quartz-community/remove-draft'
const plugin = RemoveDrafts()
const examples = [{ draft: true }, { draft: 'true' }, { status: 'draft' }, { status: 'private' }, { status: 'hidden' }, { status: 'published', draft: true }]
console.log(JSON.stringify(examples.map(frontmatter => ({ frontmatter, publish: plugin.shouldPublish({}, [{}, { data: { frontmatter } }]) })), null, 2))
JS
```

## 本次证据和本机验收

完整根目录：`/private/tmp/mon-blog-quartz-20261022.wQkhjR`。

- `raw/build.log`、`adapted/build.log`：实际成功构建日志。
- 两组 `manifest.json`：公开输入、源文件哈希、排除原因和上游提交。
- 两组 `inspection.json`、`inspection-summary.json`：逐页检查和汇总，包含 RSS 实际标题/链接/日期。
- `publication-contract.json`：默认发布过滤器的内存探针。
- `quartz-search.png`：真实浏览器中文搜索截图，仅含已公开内容。
- `quartz-v5-current/`：此次固定提交源码和本地依赖；失败的标签尝试也保留在同级目录，未清理。

实验当时的原始版预览只监听 `127.0.0.1`，含 `/Mon-Blog/` 基路径和扩展名省略路由，并在浏览器保留中文搜索结果供验收。以下地址不保证跨会话可用：

```text
http://127.0.0.1:8767/Mon-Blog/
```

若继续迁移，下一阶段应只补齐四项验收契约：旧 URL、发布状态、RSS、栏目/系列模板，再决定是否值得转移生产；本阶段没有实现这些迁移功能。
