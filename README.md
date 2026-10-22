# Mon's Digital Garden

一个由 Obsidian 笔记持续生长而来的个人数字花园，内容涵盖技术学习、原创思考、行旅札记与优质收藏。站点使用 MkDocs Material 构建，并通过少量模板、样式和原生 JavaScript 保持轻量。

线上地址：[nn66kk.github.io/Mon-Blog](https://nn66kk.github.io/Mon-Blog/)

## 本地预览

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/mkdocs serve
```

浏览器访问终端显示的本地地址即可。Windows 使用 `.venv\Scripts\python.exe` 和 `.venv\Scripts\mkdocs.exe`。内容和模板修改会自动更新；修改 Python 构建钩子后应重启 `mkdocs serve`，确保重新加载模块。

写作室中的未发布文章可通过「最终页面预览」导出当前编辑快照（含尚未保存的正文和私有图片），然后在本机运行：

```bash
.venv/bin/python scripts/preview_draft.py /absolute/path/to/mon-preview.zip
```

命令使用临时内容副本，按当前仓库的 MkDocs 配置严格构建并检查产物，然后输出仅 `127.0.0.1:8766` 可访问的地址。原笔记和发布状态不变；私有副本保留在终端显示的临时目录，不自动清理。修改后需重新导出快照。外链资源仍需联网，预览的首发/修订时间及尚未保存的新稿链接可能与正式发布不同。多篇备份可用 `--draft-id` 指定文章，`--build-only` 只构建不启动服务。

## 质量检查

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.js
.venv/bin/mkdocs build --strict
.venv/bin/python scripts/check_site.py --site-dir site
```

Python 依赖见 `requirements.txt`，Node.js 使用 24。测试覆盖主题契约、文章元数据、RSS/系列、正文跳转、Dataview 静态转换、私有预览、备份拆包、移动目录、代码块增强和文章库筛选逻辑。严格构建后，产物检查核对站内文件与锚点、搜索索引、站点地图、canonical、草稿/私密文章排除、Dataview 转换结果及 RSS 的日期、文章完整性与订阅发现链接；不请求外部链接。

要把构建产物放在仓库外，可以给两条命令传入相同的 `--site-dir` 绝对路径。检查工具默认读取根目录 `mkdocs.yml` 中的站点地址和内容路径。

写作室的独立检查在 `publisher/` 内运行，首次先执行 `npm ci`：

```bash
npm test
npx --no-install tsc --noEmit --incremental false
```

这些测试使用内存数据库和模拟 GitHub，不需要生产访问凭据。需要启动本地 HTTP 服务的 `test:local` / `test:mcp:local` 仍属于单独验收，不由上述命令执行。

GitHub Actions 对 PR、`main` 推送和手动触发运行博客检查与写作室检查。PR 只验证；只有 `main` 上两个检查任务都通过，才沿用 `gh-pages` 分支方式发布已经检查过的构建产物，发布阶段不重新构建。产物保留 7 天。Netlify 的备用构建入口执行相同的博客测试、严格构建和产物检查；写作室检查由 GitHub Actions 独立完成。

## 目录说明

- `docs/`：公开文章、首页、归档页和静态资源。
- `docs/templates/`：首页、文章页、归档页及站点框架的 Jinja 模板。
- `docs/css/00-tokens.css` 至 `70-discovery.css`：当前实际加载的主题变量、页面框架、组件和各类页面样式；加载顺序见 `mkdocs.yml`。
- `docs/javascripts/`：目录、分享、文章筛选与阅读状态等渐进增强。
- `hooks/post_metadata.py`：统一解析发布日期、更新日期、标签和自动摘要，并排除草稿及私有文章。
- `hooks/dataview_static.py`：将明确启用的有限 Dataview 查询转换为静态任务列表。
- `shared/`：博客与写作室共用的内容规则和 Mermaid 源文件，维护方法见 [shared/README.md](shared/README.md)。
- `scripts/check_site.py`：检查实际构建产物，在发现错误时返回非零状态。
- `scripts/preview_draft.py`：仅在本机构建写作室草稿快照。
- `scripts/split_backup.py`：离线拆分超过恢复上限的旧写作室备份。
- `tests/`：Python 与 Node.js 回归测试。
- `publisher/`：独立的网页写作后台，运行、托管和发布验收说明见 [publisher/README.md](publisher/README.md)。
- 写作室已上线版本与部署检查见 [PUBLISHER-DEPLOYMENT.md](PUBLISHER-DEPLOYMENT.md)。

## 内容约定

公开文章放在 `A-Life`、`B-Notes`、`C-Highlights` 或 `D-Orginals` 下即可自动进入首页和文章库。发布日期依次读取 front matter 中的 `published_at`、`cdate`、`date`，最后尝试从文件名解析；未填写 `description` 时，构建钩子会从正文首个有效段落生成简洁摘要。

笔记仍可在 Obsidian 中使用 Wiki Link。提交前运行回归测试，并检查引用的附件与目标笔记是否已同步。推送 `main` 后由现有 GitHub Actions 流程部署博客。

### 主题、系列与订阅

`topics/` 按有效主题标签组织文章，栏目标签和 `zettelkasten` 不作为主题。文章头部标签可以直达主题分组；有主题的文章优先推荐共享主题的内容。系列采用稳定名称与正整数顺序：

```yaml
title: 2008 考研英语一：阅读 Text 1
tags: [英语, 考研英语]
series: 2008 考研英语一
series_order: 1
```

同系列会显示目录与前后篇入口。重复或非法顺序会使严格构建失败；未填写顺序的文章稳定排列在有序文章之后。旧文章的文件路径保持不变，本轮补充了 45 篇英语真题的标题/系列及 15 篇技术、数学文章的主题。

`extra.rss_feed: feed.xml` 开启全站 RSS，顶部、文章底部和页面 head 均提供订阅入口。订阅仅包含有可靠发布日期的公开文章，并使用摘要；草稿、私密、隐藏、重定向文章不进入 RSS。日期未知的旧文仍出现在站内列表与主题页，不使用考试年份、文件修改时间或构建时间代替发表日期。

站点地址、栏目、排除路径和上述 `extra` 规则统一维护在 `shared/blog.json`，由 `mkdocs.yml` 继承。修改后运行 `python3 scripts/sync_shared.py --write` 同步写作室的生成副本；现有 Python 测试会阻止过期副本通过检查。Mermaid 也以 `shared/diagrams/` 为源，两端保留原有资源地址。

### Dataview 的网站显示

Obsidian 的原始 Markdown 保持不变。当前仅为英语一真题的 `Text1.md` 至 `Text4.md` 启用静态转换，范围在 `shared/blog.json` 的 `extra.dataview_static_paths` 中定义。其他文章默认保留 Dataview 代码示例；单篇文章可用 front matter `dataview_static: true` 启用，或用 `dataview_static: false` 显式保留示例。

目前支持的查询是：

````markdown
```dataview
task
where file.path = this.file.path and !completed
```
````

网站在构建时显示当前笔记中尚未完成的任务；没有未完成任务时显示空结果提示。这是内容快照，不会在网页上修改 Obsidian 的勾选状态，也不执行 Dataview JavaScript。当前支持普通 Markdown 任务列表，不支持引用或 callout 容器中的任务和查询；需要将它们移出容器。启用静态转换的页面如果使用不支持的查询或容器，会产生构建警告并使 `--strict` 失败，需要先调整内容；教程示例可显式设置 `dataview_static: false` 保留原样。
