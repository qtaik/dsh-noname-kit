# dsh-noname-kit

无名杀扩展开发工坊,一个 DeepSeek Harness 插件。

让 AI 按规范写无名杀(Noname)的武将技能和卡牌扩展:规范注入、官方源码搜索、
静态校验、任务管理都有插件兜底;游戏扩展目录只认专用写入通道,AI 抄错或删错
代码会被工具层拦下,覆盖前自动备份。

![工坊:任务表单与任务列表](https://cdn.jsdelivr.net/npm/dsh-noname-kit/docs/screenshots/workshop.png)

![历史页:备份回滚与注意点清单](https://cdn.jsdelivr.net/npm/dsh-noname-kit/docs/screenshots/history.png)

## 安装

需要 DeepSeek Harness 和 pnpm。

```sh
dsh plugin --profile web add dsh-noname-kit
```

装完**重启 dsh**。重启后点输入框左边的「🛠 工坊」→ 进「⚙ 设置」页 → 点一下「♻️ 重装 preset」,AI 的「无名杀开发模式」人格与规范就装好了。**不用开终端。**

想用命令行也行(脚本在插件目录里,路径是 `C:\Users\<你的用户名>\.dsh\profiles\web\node_modules\dsh-noname-kit`):

```sh
node scripts/install-preset.mjs
```

从 GitHub 装(与 npm 等价):

```sh
dsh plugin --profile web add https://github.com/qtaik/dsh-noname-kit.git
```

## 配置

重启 `dsh web` 后打开 Web UI。工坊页里没配游戏目录会先出初始化向导:填无名杀
本体目录(含 extension/ 的那层,比如 `D:\Games\noname\resources\app`),或者点
「自动扫描」。配置保存在 `~/.dsh/noname-kit.json`,之后随时可以在工坊「⚙ 设置」
页改。

不配置也能用:写入方式选「手动复制」,AI 只生成代码不落盘。

## 使用

新建会话时建议选「无名杀开发模式」preset:六个无名杀工具在该模式下常驻可用,
开发规范(确认协议、区块化读写、检索纪律)也随之注入。普通会话默认没有这些
工具——技术上可以通过 dev_tool_search 按需解锁,但规范不会跟着来,所以还是
建议挂对模式。

「无名杀工坊」页签里建任务:选类型(武将/卡牌)、写法(老版 game.import /
新版 ES Module)、填技能描述。提交后 AI 会先给需求理解确认,有歧义会先提问;收到明确的「确认」回复后才会动笔——写完自动校验、写入,并提醒进游戏测试。

游戏里发现问题就在任务列表点「🔁 反馈」,把现象或报错发给 AI;每轮反馈自动
累计轮次,逐技能确认无误、图片也就位后,任务自动归档。

已有的扩展包不用从零开始:任务模式选「📂 编辑已有扩展包」,选中扩展包后照常
走确认协议。老文件可以先点「🔨 建立区块索引」,给 extension.js 插入锚点注释
(只加注释行、自动备份),之后 AI 按区块读写,不必每次翻整个文件;新式 ES
Module 多文件包暂不支持,点击会明确报错。

编辑已有武将/卡牌时,选中目标就会列出它关联的技能:勾选要修改的技能、在旁边
写清改成什么,每个勾选的技能都是一个独立的任务节点,可以单独确认和反馈;
「改动描述」留给武将本身的变化(体力、护甲、名称等)。编辑任务不强制补图,
技能全部确认后任务即自动完成。

### 六个 AI 工具

| 工具 | 作用 |
|---|---|
| noname_search_reference | 在本地游戏源码里搜官方相似实现(纯读) |
| noname_validate | 语法编译检查 + 静态规则校验(不执行代码) |
| noname_read_extension | 读扩展当前代码(先读后改) |
| noname_write_extension | 唯一写入通道:先校验,error 拒写,覆盖前自动备份 |
| noname_skills_written | 标记技能「已写入待测试」,全确认+图片就位后自动收口 |
| noname_copy_images | 把本地图片复制进扩展包 image/ 目录 |

普通 write/edit/bash 对游戏 extension 目录的写入会被守卫拒绝,不用担心
AI 绕过校验直接改文件。

## 「无名杀开发模式」preset

presets/noname-dev 是一个 Zero-Anchored 架构的 agent preset(参考
xiaobright/dsh-anchored-standard,MIT):首轮不开放任何工具,之后常驻集只保留
shell、编辑器和上述工具,web 等重工具按需解锁;完整开发规范走 skill 按需
加载,不占 system prompt。

## 更新

工坊「⚙ 设置」页顶部是「版本与一致性」,两块各管一件事:

- **插件**:显示当前版本,有新版本时给出升级命令(只提示,不自动更新)。git/npm
  安装用 `dsh plugin --profile web update dsh-noname-kit`;link 方式加载的插件不参与
  版本检测(加载的就是源码目录本身)。
- **开发模式 preset**:preset 是插件行为的第二份副本(人格、常驻工具名单、技能文档),
  插件更新后不重装它会拿到自相矛盾的指令,而且不报错——所以单独盯一行。发现不一致
  点「♻️ 重装 preset」即可(覆盖前自动备份成 `noname-dev.bak-<时间戳>`);装完对
  新建会话生效。

任一项有问题时,输入条上的 🛠 按钮会带一个小红点。版本信息从 npm registry 和
GitHub tag 取,查不通只显示一行「检查失败」,不影响使用;「启动时自动检查」可以在
设置页关掉,改成手动点。

## 已知限制

- 新建会话发第一条消息前,顶部页签栏不显示——这是 DSH 空白会话的官方设计,
  发一条消息就出来了。
- 插件的 HTTP API 随 Web 服务暴露,只建议本机使用。
- 运行期错误(逻辑对不对)插件管不了,仍要进游戏验证后走「问题反馈」。
- 引擎默认不去扩展的 image/ 子目录找立绘,武将/卡牌定义里要显式写 img 字段,
  工坊的任务流程和规范文本里都有说明。
- 新式 ES Module 多文件扩展包(条目分散在子目录模块里,如懒人包预装的英雄杀)
  暂不支持读写——工具只针对单文件的 extension.js;对这类包建立区块索引会得到
  明确报错,不会误写。

## 测试

```sh
node scripts/test-tasks.mjs    # 任务状态机,46 项
node scripts/test-blocks.mjs   # 区块读写,78 项
node scripts/test-update.mjs   # 版本比较与更新检查,104 项
node scripts/test-preset.mjs   # preset 自检与安装,59 项
```

## 反馈

插件有问题欢迎提 [issue](https://github.com/qtaik/dsh-noname-kit/issues),附上复现步骤和报错更好。

## 杂谈

其实在 agent 这个概念兴起之前,就已经在用 AI 写复杂代码了——从 ChatGPT-3 一路用到
4.5。那时候的办法:建一个自定义智能体,把代码规范传进知识库,写之前再去官方源码里
找类似的实现粘进对话当参考,AI 写出来的东西才像样。这个插件,本质上是把那套网页版
习惯搬了过来:知识库变成了常驻注入的规范文本,手动粘参考变成了 noname_search_reference
自动搜索,每次手动调教变成了确认门禁和写入守卫——强制执行的那种。

之所以选 DSH,一是它可塑性高,能自定义地强制约束 AI 的行为;二是不像网页版那样
每次开新会话都得重新教一遍规矩,规范和工具由 preset 和插件常驻注入,上下文不浪费。
测试模型用的是 deepseek-v4.1-flash。
如果你也在玩无名杀、也在用 DeepSeek Harness,欢迎装上试试——把想要的武将或卡牌
用一句话描述给 AI,剩下的交给流程。用得顺手点个 star;遇到问题欢迎提 issue;
写出了有趣的扩展,更欢迎回来说一声。写扩展这件事,从翻代码、粘对话,到动动嘴
就行——工具已经准备好了,就等你了。

## 卸载

```sh
dsh plugin --profile web remove dsh-noname-kit
```

MIT License
