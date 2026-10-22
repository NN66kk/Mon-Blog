# Mon's Digital Garden

一个由 Obsidian 笔记持续生长而来的个人数字花园，内容涵盖技术学习、原创思考、行旅札记与优质收藏。站点使用 MkDocs Material 构建，并通过少量模板、样式和原生 JavaScript 保持轻量。

线上地址：[nn66kk.github.io/Mon-Blog](https://nn66kk.github.io/Mon-Blog/)

## 本地预览

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/mkdocs serve
```

浏览器访问终端显示的本地地址即可。Windows 使用 `.venv\Scripts\python.exe` 和 `.venv\Scripts\mkdocs.exe`。预览会随内容、模板和构建钩子的修改自动更新。

## 质量检查

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.js
.venv/bin/mkdocs build --strict
.venv/bin/python scripts/check_site.py --site-dir site
```

Python 依赖见 `requirements.txt`，Node.js 使用 24。测试覆盖主题契约、文章元数据、正文跳转、Dataview 静态转换、移动目录、代码块增强和文章库筛选逻辑。严格构建后，产物检查核对站内文件与锚点、搜索索引、站点地图、canonical、草稿/私密文章排除和 Dataview 转换结果；不请求外部链接。

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
- `docs/css/00-tokens.css` 至 `60-collection.css`：当前实际加载的主题变量、页面框架、组件和各类页面样式；加载顺序见 `mkdocs.yml`。
- `docs/javascripts/`：目录、分享、文章筛选与阅读状态等渐进增强。
- `hooks/post_metadata.py`：统一解析发布日期、更新日期、标签和自动摘要，并排除草稿及私有文章。
- `hooks/dataview_static.py`：将明确启用的有限 Dataview 查询转换为静态任务列表。
- `scripts/check_site.py`：检查实际构建产物，在发现错误时返回非零状态。
- `tests/`：Python 与 Node.js 回归测试。
- `publisher/`：独立的网页写作后台，运行、托管和发布验收说明见 [publisher/README.md](publisher/README.md)。
- 写作室已上线版本与部署检查见 [PUBLISHER-DEPLOYMENT.md](PUBLISHER-DEPLOYMENT.md)。

## 内容约定

公开文章放在 `A-Life`、`B-Notes`、`C-Highlights` 或 `D-Orginals` 下即可自动进入首页和文章库。发布日期依次读取 front matter 中的 `published_at`、`cdate`、`date`，最后尝试从文件名解析；未填写 `description` 时，构建钩子会从正文首个有效段落生成简洁摘要。

笔记仍可在 Obsidian 中使用 Wiki Link。提交前运行回归测试，并检查引用的附件与目标笔记是否已同步。推送 `main` 后由现有 GitHub Actions 流程部署博客。

### Dataview 的网站显示

Obsidian 的原始 Markdown 保持不变。当前仅为英语一真题的 `Text1.md` 至 `Text4.md` 启用静态转换，范围在 `mkdocs.yml` 的 `extra.dataview_static_paths` 中定义。其他文章默认保留 Dataview 代码示例；单篇文章可用 front matter `dataview_static: true` 启用，或用 `dataview_static: false` 显式保留示例。

目前支持的查询是：

````markdown
```dataview
task
where file.path = this.file.path and !completed
```
````

网站在构建时显示当前笔记中尚未完成的任务；没有未完成任务时显示空结果提示。这是内容快照，不会在网页上修改 Obsidian 的勾选状态，也不执行 Dataview JavaScript。当前支持普通 Markdown 任务列表，不支持引用或 callout 容器中的任务和查询；需要将它们移出容器。启用静态转换的页面如果使用不支持的查询或容器，会产生构建警告并使 `--strict` 失败，需要先调整内容；教程示例可显式设置 `dataview_static: false` 保留原样。
