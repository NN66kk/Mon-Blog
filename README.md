# Mon's Digital Garden

一个由 Obsidian 笔记持续生长而来的个人数字花园，内容涵盖技术学习、原创思考、行旅札记与优质收藏。站点使用 MkDocs Material 构建，并通过少量模板、样式和原生 JavaScript 保持轻量。

线上地址：[nn66kk.github.io/Mon-Blog](https://nn66kk.github.io/Mon-Blog/)

## 本地预览

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/mkdocs serve
```

浏览器访问终端显示的本地地址即可。Windows 使用 `.venv\Scripts\python.exe` 和 `.venv\Scripts\mkdocs.exe`。日常修改运行下方回归测试，不要求本地执行 `mkdocs build`。

## 质量检查

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.js
```

测试覆盖主题契约、文章元数据、移动目录、代码块增强和文章库筛选逻辑。

## 目录说明

- `docs/`：公开文章、首页、归档页和静态资源。
- `docs/templates/`：首页、文章页、归档页及站点框架的 Jinja 模板。
- `docs/css/00-tokens.css` 至 `60-collection.css`：当前实际加载的主题变量、页面框架、组件和各类页面样式；加载顺序见 `mkdocs.yml`。
- `docs/javascripts/`：目录、分享、文章筛选与阅读状态等渐进增强。
- `hooks/post_metadata.py`：统一解析发布日期、更新日期、标签和自动摘要，并排除草稿及私有文章。
- `tests/`：Python 与 Node.js 回归测试。
- `publisher/`：独立的网页写作后台，运行、托管和发布验收说明见 [publisher/README.md](publisher/README.md)。
- 写作室已上线版本与部署检查见 [PUBLISHER-DEPLOYMENT.md](PUBLISHER-DEPLOYMENT.md)。

## 内容约定

公开文章放在 `A-Life`、`B-Notes`、`C-Highlights` 或 `D-Orginals` 下即可自动进入首页和文章库。发布日期依次读取 front matter 中的 `published_at`、`cdate`、`date`，最后尝试从文件名解析；未填写 `description` 时，构建钩子会从正文首个有效段落生成简洁摘要。

笔记仍可在 Obsidian 中使用 Wiki Link。提交前运行回归测试，并检查引用的附件与目标笔记是否已同步。推送 `main` 后由现有 GitHub Actions 流程部署博客。
