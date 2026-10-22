# 共享内容契约

`blog.json` 是站点地址、仓库、栏目顺序/标签、排除路径、RSS/Dataview 范围与公开状态规则的唯一编辑来源。它是 JSON，也是 MkDocs 可直接继承的 YAML；`mkdocs.yml` 只保留当前构建器、插件和样式配置。

Python 钩子和预览工具读取 `content_contract.py`。写作室读取生成的 `publisher/lib/blog-contract.json`，保持 `publisher/` 可独立打包，不依赖部署时访问上级目录。

`diagrams/` 是两端 Mermaid 渲染器、主题和 CSS 的源文件。MkDocs 直接读取；`publisher/public/diagrams/` 保留生成副本以维持现有 URL 和独立打包能力。

修改共享源文件后，在仓库根目录运行：

```bash
python3 scripts/sync_shared.py --write
python3 scripts/sync_shared.py --check
```

同步只更新列出的生成文件，不删除资源。Python 回归测试会检查副本是否过期；共享路径样例由 Python 与 TypeScript 同时执行。不要手工修改生成副本。

更改共享配置后重启 `mkdocs serve`，确保 Python 已重新载入规则。独立复制或打包 `publisher/` 前先同步副本；日常修改仍从仓库根目录进行。

排除规则目前只接受具体文件或文件夹；包含 `/` 的规则相对 docs 根目录，无 `/` 的名称匹配任意层级，与 MkDocs 的 Git ignore 语义一致。不支持通配符，避免不同语言与构建器解释不一致。`hidden` 仅取消列表收录，`draft/private` 排除页面构建；这些设置不能隐藏公开 Git 仓库中的原始文件。
