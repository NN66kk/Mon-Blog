# Mon's Digital Garden

一个由 Obsidian 笔记持续生长而来的个人数字花园，内容涵盖技术学习、原创思考、山野日常与优质收藏。站点使用 MkDocs Material 构建，并通过少量模板、样式和原生 JavaScript 保持轻量。

线上地址：[nn66kk.github.io/Mon-Blog](https://nn66kk.github.io/Mon-Blog/)

## 本地预览

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/mkdocs serve
```

浏览器访问终端显示的本地地址即可。生产构建建议开启严格模式，确保不存在失效的内部链接：

```bash
.venv/bin/mkdocs build --strict
```

## 质量检查

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.js
```

测试覆盖主题契约、文章元数据、移动目录、代码块增强和文章库筛选逻辑。

## 目录说明

- `docs/`：公开文章、首页、归档页和静态资源。
- `docs/templates/`：首页、文章页、归档页及站点框架的 Jinja 模板。
- `docs/css/garden-v2.css`：明暗主题、阅读排版和响应式样式。
- `docs/javascripts/`：目录、分享、文章筛选与阅读状态等渐进增强。
- `hooks/post_metadata.py`：统一解析 `date`、`cdate`、文件名日期、标签和自动摘要。
- `tests/`：Python 与 Node.js 回归测试。

## 内容约定

文章放在 `A-Life`、`B-Notes`、`C-Highlights` 或 `D-Orginals` 下即可自动进入首页和文章库。日期优先读取 front matter 中的 `date`，其次读取 `cdate`，最后尝试从文件名解析；未填写 `description` 时，构建钩子会从正文首个有效段落生成简洁摘要。

笔记仍可在 Obsidian 中使用 Wiki Link。提交前运行严格构建，及时发现未同步的附件或目标笔记。
