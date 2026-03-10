---
cdate: 2025-03-16 13:52
tags: 原创文章 
---

# GitHub Actions 连环报错修复实录：从 Actions 缓存失效到权限升级的完整排查
## 1 📌 事件背景

在为个人博客网站配置持续集成时，我经历了两个阶段的报错排查。以下是完整的故障复现与修复过程：

## 2 🔥 第一阶段：部署失败（Actions 缓存失效）

### 2.1 初始配置与表现

```yaml

# 原工作流片段 (.github/workflows/ci.yml)
- name: Cache dependencies

  uses: actions/cache@v2  # 使用旧版缓存组件

```

**推送表现**：代码可正常推送到 GitHub 仓库

**报错现象**：仓库 Actions 面板显示红色警告 `Missing download info for actions/cache@v2`

**后果影响**：博客网站部署流程中断

### 2.2 原因分析

GitHub 的缓存后端服务将升级到新的缓存服务 API（v2），预计于 2025 年 2 月 1 日开始推出，同时旧版本将被淘汰，建议用户升级到 v4 或 v3 版本。

![dd91f1d591e1f90e159b52f32e6841d.png](https://s2.loli.net/2025/03/16/RJnEaurQSKcZbq7.png)

## 3 💥 第二阶段：升级引发的权限阻断

### 3.1 尝试修复措施

将缓存组件升级至推荐版本：

```yaml
- name: Cache dependencies

  uses: actions/cache@v4  # 升级至新版

```

**推送表现**：执行 `git push` 时触发阻断性报错  

  ```plaintext

  [remote rejected] (refusing to allow a Personal Access Token to create 

  or update workflow `.github/workflows/ci.yml` without `workflow` scope)

  ```

**问题本质**：GitHub 加强安全策略，修改工作流文件需显式授权

### 3.2 深层机制解析

| 操作行为                | v 2 版本时期          | v 4 版本时期          |
|----------------------|------------------|------------------|
| 修改工作流文件            | 仅需基础写入权限       | 需 `workflow` 作用域权限 |
| 执行工作流              | 依赖仓库基础权限       | 新增双重校验机制       |
| 第三方 Actions 组件调用     | 宽松策略           | 强制版本锁定         |

## 4 🛠 终极解决方案

### 4.1 步骤一：修复工作流文件

```diff

# github/workflows/ci.yml
- uses: actions/cache@v2

+ uses: actions/cache@v4  # 强制版本升级

```

### 4.2 步骤二：配置 Personal Access Token

1、访问 [GitHub令牌管理页](https://github.com/settings/tokens)

2、点击带有 `This token has no expiration date.` 黄色错误提示的仓库名称，进入令牌权限配置页面。

![001.png](https://s2.loli.net/2025/03/16/QMeYRqKFDo27rlx.png)

3、勾选 `workflow` 选项。

![002.png](https://s2.loli.net/2025/03/16/7uzSd2WnyXHGsmt.png)

4、点击 `Update token` 完成更新。

![003.png](https://s2.loli.net/2025/03/16/sjCUBc869Xhmbg7.png)


**预期结果**：代码推送成功 → Actions 执行无报错 → 博客网站完成部署

---


```
参考链接：

https://github.com/marketplace/actions/cache

```