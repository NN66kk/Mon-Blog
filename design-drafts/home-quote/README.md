# 首页名言排版草稿

2026-09-04 的设计草稿，已获确认并应用到首页源文件。以下保留当时的草稿预览说明。

桌面端使用两栏：左侧是「读书与行路」、简介和关于我入口；右侧是两行宋体名言与署名。沿用现有纸色、墨绿和铜色。手机端改为上下布局，卷首约 243px 高。

- `hero.html`：草稿区块；正式应用时将关于我链接恢复为 Jinja 的 `config.extra.about_url|url`。
- `hero.css`：草稿样式。
- `desktop.png`、`mobile.png`、`mobile-dark.png`：浏览器实际截图。
- `preview.py`：将草稿注入本地构建产物，不修改 `docs/`；刷新页面即可读取最新草稿文件。

预览地址：<http://127.0.0.1:8765/>。原版对照：<http://127.0.0.1:8765/original.html>。

重建预览：

```sh
.venv/bin/mkdocs build --strict --site-dir /private/tmp/mon-blog-quote-draft/site
.venv/bin/python design-drafts/home-quote/preview.py --site-dir /private/tmp/mon-blog-quote-draft/site --port 8765
```

已检查桌面、390px 手机宽度和手机暗色主题；名言分为两个完整短句，无横向溢出。基础站点严格构建通过。正式页面、关于我原文均未修改。
