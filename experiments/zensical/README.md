# Zensical 隔离可行性试验

结论：**当前项目不能直接替换构建命令迁移到 Zensical。保留现有 MkDocs 生产方案。** 在固定版本的隔离试验中，原配置因自定义模板缺少 hook 注入的数据而构建失败，并且未执行草稿过滤。先运行现有 MkDocs 输入处理、再由 Zensical 渲染的桥接方案能够保留内容路径、附件、静态 Dataview、RSS 和主题/系列数据，但还依赖 MkDocs，且未移植现有站点设计；这证明内容具有可迁移性，不代表已经完成迁移。

## 固定输入与版本

- 核验日期：2026-10-22。
- 项目输入：第二阶段完成后的 `1bd61019c635cb6771b538e5d1aeed6fd0be57c6`，不读取工作区后续的共享配置重构。脚本有意拒绝带 `INHERIT` 的新配置。
- Zensical：`0.0.71`，运行于独立 Python `3.12.14` 虚拟环境；该版本于 2026-10-16 发布，PyPI 要求 Python ≥ 3.11，分类仍为 Alpha。[PyPI 版本信息](https://pypi.org/project/zensical/)
- 基线与桥接预处理：项目既有 `.venv`，Python `3.9.6`、MkDocs `1.6.1`、Material `9.7.4`、roamlinks `0.3.2`。没有替换项目依赖。
- 真实基线为 **259 个 HTML 页面**。四个栏目下的 **254 条路径**由 249 篇文章、4 个栏目索引、1 个旧链接兼容页组成；另有首页、关于、归档、主题页和 404。
- 另在临时副本加入 draft/private/hidden 三个测试页面。符合当前发布规则的 hidden 页面增加 1 个 HTML，因此下表基线和桥接均为 260。测试内容不会写回文章源文件。

官方迁移文档确认目前不支持 MkDocs `hooks`，模板引擎是 MiniJinja，无法直接调用任意 Python 函数；迁移自定义 Material 主题时建议先使用 classic 变体。[迁移兼容说明](https://zensical.org/docs/compatibility/mkdocs/migration/) 未支持的插件会被忽略，不能把“配置可读取”理解为插件行为已经保留。[插件兼容表](https://zensical.org/docs/compatibility/mkdocs/plugins/)

## 实验方法与结果

`run_probe.py` 通过 `git archive` 只提取指定提交的 `docs`、`hooks`、Mermaid 公共资源、MkDocs 配置和依赖清单。每次运行新建临时目录，不读取 `.env`、CI 文件、Git 凭据或发布后台私有数据，也不会清理已有目录。

| 项目 | MkDocs 基线 | Zensical 原配置 | 原生主题诊断 | 预处理桥接 |
| --- | --- | --- | --- | --- |
| 严格构建 | 通过 | 失败 | 失败；另用非严格模式生成诊断产物 | 通过 |
| HTML 数量（含探针） | 260 | 258，构建中断后的不完整产物 | 266 | 260 |
| 254 条栏目路径 | 全部 | 缺 4 个索引，额外生成 4 个真实草稿路径 | 全部保留，但额外生成 4 个真实草稿路径 | 全部保留，无额外路径 |
| draft/private 探针 | HTML 和搜索均排除 | HTML 和搜索均出现 | HTML 和搜索均出现 | HTML 和搜索均排除 |
| 静态 Dataview 任务块 | 28 | 0 | 0 | 28 |
| RSS 条目 | 180 | 无 feed | 无 feed | 180 |
| 主题/系列数据 | 51 / 8 | hook 模型未生成 | 未生成 | 51 / 8 |
| HTML/搜索本地链接与锚点 | 0 错误 | 不完整产物，不作为验收结果 | 17 错误 | 0 错误 |
| 原生搜索索引项 | 1820 | 1826 | 1826 | 1881 |

**原配置失败点**是 `RuntimeError: undefined value (in collection.html:4)`：模板读取的博客模型未由 hook 注入。即使移除项目模板、改为原生主题，仍有 17 处无法解析的内容链接，严格构建失败。非严格诊断只是为了检查完整输出，不能视为通过。直接迁移还会把 4 篇既有草稿写入输出；这些临时诊断产物只留在本机，不能部署。

桥接方案在临时副本中调用现有 MkDocs `on_config`、`on_files`、`on_nav`、`on_page_markdown` 等输入事件，沿用草稿过滤、双链解析、附件处理与 Dataview 静态转换。然后把结果写成普通 Markdown，由 Zensical 严格构建。它把主题/系列模型输出为静态索引与文章前后篇链接，并在构建后沿用现有 RSS 生成器。这个实验使用原生 classic 主题和一个只负责 RSS 自动发现的最小模板，不移植全部自定义模板。

额外核验：

- 298 份 `docs/assets` 源附件在基线和桥接产物中的 SHA-256 全部相同。
- 桥接与基线的 180 个 RSS 条目逐项比较，`title`、`link`、`guid`、`pubDate`、`description` 一致；没有用试验时间填补文章日期。
- draft/private 不进入桥接 HTML、搜索和 RSS。当前 `hidden` 的语义是公开但不列入文章列表，因此与基线一致保留 HTML/搜索，但不进入 RSS；它不是私密访问控制。
- 2008 年 Text 2 的系列入口正确指向 Text 1 / Text 3，系列全篇标题可见。8 个系列对应 2002–2009 年英语一真题。
- 原始 Dataview 查询的页面残留数为 2、双链样式残留数为 1，与基线相同；这些计数包含文章中的语法示例，不能单凭字符串残留判定故障。
- `/Mon-Blog/` 基路径下的 HTML 链接、资源 `src`/`poster`、片段锚点、搜索目标均有文件级检查；未访问外链。
- 在 Edge 浏览器对最终桥接产物搜索“英语”，显示 **432 个章节/索引命中**，不是 432 篇文章。页面标签筛选可见，搜索结果中的系列标题不再出现空值。

## 尚未解决的迁移缺口

1. **自定义页面尚未迁移。** 现有首页、栏目卡片、归档、文章模板、SEO JSON-LD、快捷键和站点 JavaScript 需要逐项适配 MiniJinja。当前桥接首页仅显示原 Markdown 中的介绍，保留 URL 不等于保留这些页面行为。旧链接兼容页的路径已保留，但重定向行为没有完成浏览器验收。
2. **桥接仍需要两套依赖。** 它复用了现有 MkDocs hooks/plugins；若以减少依赖为迁移动机，该实现尚未实现目标。未来应先抽离共享内容模型，再考虑薄适配器，不应复制两份业务规则。
3. **搜索产物协议不同。** Zensical 使用根目录 `search.json` 的 `items`，原项目检查器使用 MkDocs `search/search_index.json` 的 `docs`。本实验单独检查两种格式，未修改生产检查器。索引数量因原生章节索引及桥接主题页而变化，不能作为文章数量或搜索质量排名。搜索界面仍有部分英文文本，符合当前官方说明。[搜索文档](https://zensical.org/docs/setup/search/)
4. **数学与图表尚未验收。** 配置保留 Python-Markdown 扩展和数学标记，但没有接入全部现有 MathJax/Mermaid 前端初始化与交互，因此不宣称渲染效果相同。[Markdown 扩展兼容说明](https://zensical.org/docs/compatibility/markdown/python-markdown-extensions/)
5. **原生 RSS 需要另行映射规则。** Zensical 自 0.0.65 已有 RSS 能力，支持 `date_from_meta` 等配置；本试验未启用它，表中的“无 feed”不代表 Zensical 不支持 RSS。迁移时仍需验证本站真实日期、无日期跳过、排序、排除规则和 GUID 一致性，桥接目前直接复用现有实现。[原生插件兼容表](https://zensical.org/docs/compatibility/mkdocs/plugins/)

本次没有进行完整可访问性、性能、外链、所有数学公式或所有浏览器的测试。日志中的耗时来自不同 Python 环境、缓存状态及同时运行的本机任务，不应当作引擎性能对比。

## 复现

在仓库根目录运行。项目 `.venv` 应已安装该基线所需的 `requirements.txt`；以下命令只新建隔离 Zensical 环境。安装命令使用 PyPI 的固定版本，不修改生产依赖文件。

```sh
zensical_lab=$(mktemp -d /private/tmp/mon-blog-zensical-env-XXXXXX)
python3.12 -m venv "$zensical_lab/venv"
"$zensical_lab/venv/bin/python" -m pip install zensical==0.0.71
"$zensical_lab/venv/bin/python" -m pip freeze > "$zensical_lab/environment.txt"
.venv/bin/python experiments/zensical/run_probe.py \
  --ref 1bd61019c635cb6771b538e5d1aeed6fd0be57c6 \
  --zensical "$zensical_lab/venv/bin/zensical" \
  --temp-parent /private/tmp
```

脚本会打印本次临时目录。该目录包含原配置副本、原生主题配置、桥接配置、预处理 Markdown、各轮日志和 `report.json`。原配置/诊断构建失败是本次兼容性结果的一部分；判断桥接通过应查看 `runs.bridge.exit_code == 0`，同时核验 `artifacts.bridge` 中路径、隐私探针和引用错误，不能只看脚本本身的退出码。

## 本次证据路径

以下为本机绝对路径，临时文件不加入仓库：

```text
/private/tmp/mon-blog-zensical-probe-i2tiyhu6/report.json
/private/tmp/mon-blog-zensical-probe-i2tiyhu6/baseline.plain.log
/private/tmp/mon-blog-zensical-probe-i2tiyhu6/direct.plain.log
/private/tmp/mon-blog-zensical-probe-i2tiyhu6/stock-strict.plain.log
/private/tmp/mon-blog-zensical-probe-i2tiyhu6/stock-diagnostic.plain.log
/private/tmp/mon-blog-zensical-probe-i2tiyhu6/bridge.plain.log
/private/tmp/mon-blog-zensical-probe-i2tiyhu6/bridge/mkdocs.yml
/private/tmp/mon-blog-zensical-probe-i2tiyhu6/search-zh.png
/private/tmp/mon-blog-zensical-n4mlnypa/environment.txt
/private/tmp/mon-blog-zensical-n4mlnypa/install-network.log
```

实验当时的最终桥接预览服务仅监听 `127.0.0.1`，用于本机验收；以下地址不保证跨会话可用：

```text
http://127.0.0.1:8772/Mon-Blog/
http://127.0.0.1:8772/Mon-Blog/topics/
```

本实验仅将脚本和报告纳入版本管理；未改生产构建、依赖清单、CI 或部署，未把第三方源码、虚拟环境或构建产物加入仓库。
