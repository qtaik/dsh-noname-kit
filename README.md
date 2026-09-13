# dsh-noname-kit

无名杀(Noname)扩展开发工坊:一个 DeepSeek Harness 插件,让 AI 按规范写无名杀的
武将技能/卡牌扩展,并在底层约束它的行为——**先校验,后写入**,扩展目录只认专用通道。

## 它解决什么

| 你以前的流程 | 插件化之后 |
|---|---|
| 每次新对话手动喂知识库/提示词 | 无名杀规范常驻注入 AI 上下文 |
| 手动翻官方代码找相似实现 | `noname_search_reference` 自动搜本地游戏源码 |
| 生成代码手动粘贴进游戏 | `noname_write_extension` 校验通过后直接写入(或选手动复制) |
| F12/game.log 报错来回贴 | 校验器在进游戏前拦掉大部分错误;Web 工坊「问题反馈」继续迭代 |
| 改崩了没有后悔药 | 每次覆盖前自动备份,历史面板一键回滚 |

## 安装

```sh
dsh plugin --profile web add ./dsh-noname-kit      # 本地目录
dsh plugin --profile web add github:you/dsh-noname-kit   # 或 git 仓库(纯 JS,无需构建)
```

## 配置游戏目录

编辑你 profile 的 `cordis.patch.yml`(覆盖整行 config):

```yaml
- id: noname-kit
  name: dsh-noname-kit
  config:
    nonameDir: 'D:/games/noname/resources/app'   # 你的无名杀本体目录(含 extension/)
```

重启 `dsh web` 生效。**不配置 = 仅生成模式**:AI 能生成和校验代码,但不能写文件。

## 使用

打开 Web UI,顶部标签栏(「轨迹」旁边)有「**无名杀工坊**」页签:

- **新建任务**:填类型(武将技能/卡牌)、写法(老版 game.import / 新版 ES Module)、
  写入方式(自动/手动复制)、武将信息与技能描述 → 发给 AI。
- **问题反馈**:游戏里发现问题后,把现象/报错贴回来,AI 会先读当前文件再修复。
- **历史**:任务列表、返工轮次、踩坑注意点、备份一键回滚。

聊天里 AI 调用校验/写入工具时,会显示结构化卡片(错误清单/写入结果/一键复制)。

## 工具一览

| 工具 | 作用 |
|---|---|
| `noname_search_reference` | 在本地游戏目录官方源码里搜相似实现(纯读) |
| `noname_validate` | 语法编译检查 + 静态规则校验(不执行代码) |
| `noname_read_extension` | 读扩展当前代码(反馈循环"先读后改") |
| `noname_write_extension` | 唯一写入通道:先校验,error 拒写,覆盖前备份 |
| `noname_skills_written` | 标记技能「已写入待测试」;全技能确认+图片就位后任务自动收口 |
| `noname_copy_images` | 把用户选好的本地图片复制进扩展包 image/ 子目录 |

普通 `write`/`edit`/`bash` 对 `<nonameDir>/extension/**` 的写入会被守卫拒绝。

## Agent 模式:「无名杀开发模式」

`presets/noname-dev/` 是一个 Zero-Anchored 架构的 agent preset(参考 xiaobright/dsh-anchored-standard,MIT):

- **首轮 0 工具锚定** → 之后常驻集只保留 shell + 编辑器 + 发现工具 + **非名 5 工具**,重工具按需解锁(实测:工具太多会稀释 V4 Pro 注意力)
- **完整规范走 skill**(`noname-extension-dev`),`skill_search`/`skill_load` 按需加载,不占 system prompt
- **不注册** workflow/subagent/goals/plan 等重工具行

安装:

```sh
node noname-kit/scripts/install-preset.mjs
```

重启 dsh web 后,新建会话时选择「无名杀开发模式」即可。也可在 设置 → Agent 预设 里查看/复制。

## 空白会话说明

新建的会话在发送第一条消息前处于 Hero 大标题页,顶部页签栏(对话/轨迹/无名杀工坊)**不显示**——这是 DSH 的官方设计(空白会话让位给工作区选择页),不是插件问题。发任意一条消息后页签即出现。

## 卸载

```sh
dsh plugin --profile web remove dsh-noname-kit
```

## 注意

- HTTP API(`/noname-kit-api/*`)随 Web 服务器暴露,只建议本机使用。
- 本插件不模拟游戏运行时:运行期错误仍需在游戏里验证后通过「问题反馈」回传。
