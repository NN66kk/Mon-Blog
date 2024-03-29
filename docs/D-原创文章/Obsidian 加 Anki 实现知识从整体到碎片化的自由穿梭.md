# Obsidian 加 Anki 实现知识从整体到碎片化的自由穿梭

## 开场白

用过 anki 的都知道，这个软件是备考利器，但是其有一个致命缺点——无法组织知识点形成体系。所以说如果我们仅仅使用 anki 进行备考的话就会有很强的知识割裂感，很难理清知识点与知识点之间的关系，经过一段时间的探索我发现了 obsidian 这款笔记软件，它可以通过 Flashcards 插件将 obsidian 和 anki 串联起来，让我们可以在结构化知识和碎片化知识之间来回穿梭达到高效备考的目的，本篇文章仅仅讲述 Flashcards 的部分用法，想要了解更多可以参考插件作者的[文档](https://github.com/reuseman/flashcards-obsidian/wiki)，话不多说让我们开始配置吧！

## 配置

### Obsidian 配置

下载 Flashcard 插件，其余的按照默认设置就可以了，先讲讲图中的五个功能的使用方法：

![[pasted-image-20230606201203.png]]

1. 默认卡牌路径，即如果你不在 ob 的 yaml 区声明卡牌添加的位置（后面会讲到），所有的卡牌都会添加到默认牌组中。
2. 所有卡牌都默认会添加一个标签，如果需要添加额外的标签你也可以 yaml 区或者后面讲的 `card` 后面继续添加，最终都会在卡牌上面呈现。
3. 在问题后面打个标签 `#card` 后面 插件会识别出来自动制卡，如果想要同时制作正反两张卡，标签改为 `#card-reverse`。
4. 行内卡片，双冒号前面的是问题，后面的是答案。
5. 同样是行内卡片，不过和 3 一样，会同时生成正反两张卡片。

上面的五种标记方法都是可以自定义的，可以选择你自己喜欢的标记进行制卡~

### Anki 配置

打开 anki，依次点击工具-附加组件-获取插件，将以下数字串输入进去，点击 ok 即可安装插件。

![[pasted-image-20230606202225.png]]

鼠标右击 `AnkiConnect`，点击右下角的设置，将里面的代码全部删除，随后将下面的代码复制进去点击 ok。

```js
{
    "apiKey": null,
    "apiLogPath": null,
    "webBindAddress": "127.0.0.1",
    "webBindPort": 8765,
    "webCorsOrigin": "http://localhost",
    "webCorsOriginList": [
        "http://localhost",
        "app://obsidian.md"
    ]
}
```

好了，这样我们前期的准备工作就都完成了，让我们进入 ob 中测试一下吧，如果安装成功，在 ob 界面的右下角会出现一个 anki 加小闪电的标志，如果你还不放心的话，可以进入插件设置界面，点解 text，会显示如下提示。

![[pasted-image-20230606202852.png]]