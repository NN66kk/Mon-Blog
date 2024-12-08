---
cdate: 2024-01-08 23:06
tags: 博客 push github 原创文章 
---

# 博客提交问题汇总

## 1 问题一

报错： `fatal:unbale to access xxx:The requested URL returned error:502`

原因：代理问题，去掉代理即可

解决方法：

在博客根文件夹当中 `bash`，然后将下面的代码复制进去然后回车就可以正常 `push` 了！

```git
unset http_proxy
unset https_proxy
```

## 2 问题二

报错：`Failed to connect to github.com port 443 after 21090 ms: Couldn‘t connect to server`

原因：VPN 调整导致的端口更改

解决方法：

设置中找到代理端口，然后任意位置 bash 电脑中的 git，再输入一下代码即可解决。（后面那一串数字就是前面你查到的端口值）

```git
git config--global http.proxy 127.0.0.1:10345
git config--global https.proxy 127.0.0.1:10345
```

## 问题三

报错：

```
error:bad ref for .git/logs/refs/remotes/origin/xxx
fatal:bad object refs/remotes/origin/xxx
```

解决方法：

1. 到项目的.git 目录下
2. 进入refs/remotes/origin/
3. 删除所有内容
4. 重新拉取，成功

---

```

参考链接：

https://www.cnblogs.com/along007/p/17335825.html

```