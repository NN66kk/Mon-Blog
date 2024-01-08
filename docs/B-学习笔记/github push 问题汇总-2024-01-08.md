---
cdate: 2024-01-08 23:06
tags: 博客 push github
---

# github push 问题汇总

## 问题一

报错： `fatal:unbale to access xxx:The requested URL returned error:502`

原因：代理问题，去掉代理即可

解决方法：

在博客根文件夹当中 `bash`，然后将下面的代码复制里面去就可以正常 `push` 了！

```js

unset http_proxy
unset https_proxy

```