# 首页与搜索优化预览

已应用到本地源文件，未提交或部署。

本地预览：<http://127.0.0.1:8000/Mon-Blog/>。

- `home-applied.png`：按批准草稿应用的首页。
- `desktop.png`：搜索初始面板，包含快捷词和最近文章。
- `mobile-results.png`：手机端中文检索结果。
- `mobile-dark.png`：手机端暗色搜索面板。

检查通过：1280px 桌面、800px 中间断点、390px 手机；查询、快捷词、清空、无结果、Esc、Cmd+K、Tab、上下键与文章跳转。严格构建、30 项 Python 测试和 19 项 Node 测试通过。

已在 requirements.txt 增加 jieba==0.42.1，修复中文未分词造成的漏检。构建后浏览器查询“徒步”命中 6 篇，“心理学”命中 13 篇。
