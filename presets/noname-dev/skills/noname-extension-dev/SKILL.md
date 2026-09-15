---
name: noname-extension-dev
description: 无名杀(Noname)扩展开发完整规范:扩展骨架(老式/新式)、技能三段式、武将与卡牌结构、translate 规则、常见错误清单与工作流。写扩展代码前加载本技能。
whenToUse: 需要编写、修改或审查无名杀扩展代码(武将技能/卡牌)时加载。
---

# 无名杀扩展开发规范

你在为开源三国杀游戏 Noname 编写扩展。严格遵守以下规范与工作流。

## 任务粒度(重要)
**一个任务 = 一个完整武将(含全部技能)或一张卡牌。**武将任务的确认与实现覆盖全部技能;全部完成后一次性写入并收口。

## 工作流(不可跳步)
1. **需求理解确认(硬门禁)**:逐技能输出【需求理解确认】——名称/类型、触发时机、频率、目标、数值、不做什么、交互;卡牌复述牌名/类型/效果/牌堆。**输出后停下等用户确认**;有歧义先用 ask_user_question 问清;**回答只消除歧义、不算确认**——澄清后给出最终确认单,仍须等到用户明确回复「确认」;未确认前禁止写代码。
2. **ID 前缀约定**:任务带「内部 ID 前缀」时,新增内部 ID = 前缀 + 拼音/英文(如 cs_tianfa),显示名写入 translate。
3. **找官方参考**:用 `noname_search_reference` 直接搜官方相似实现(中文名/ID/效果关键词;整句描述按相似度列候选)。确认前的只读调研不受确认门限制;用户已给参考代码或改动极简单时可跳过;编辑已有扩展先 `noname_read_extension` 读当前代码。
4. **调研纪律(控上下文成本)**:优先用 `noname_search_reference`(结果有界);确需 bash 抽查引擎源码时用**窄窗口**命令(`grep -A5`/`sed -n 起止,p` 小范围/`head`),禁止大段倾倒整段文件;同一结论(注意点/搜索结果/参考代码里已有的)不重复验证。**检索的红线:禁止从系统根目录、盘符根目录(`C:\` `D:\` `/`)、用户目录或 DSH 目录发起任何递归检索(`grep -r`/`rg`/`findstr /s`/`dir /s` 都算)**——有用户实测从系统根目录翻,几分钟都出不来结果。**游戏与扩展的路径已在系统提示的「当前环境」小节给出(Windows 与 bash 两种形式)**:核对引擎源码直接在给出的目录下 grep `noname/` 源码;用 `ls`/`dir`/`find` 列盘符根、用户目录等无关位置来找引擎/扩展同样禁止(无论是否递归)——实测只会把无关目录倒进上下文。官方实现的检索只用 `noname_search_reference`(它已限定在引擎源码目录并跳过素材);确需 bash 时,路径必须写明且只能落在 `noname/library`、`character`、`card`、`gnc`、`extension` 这些源码目录里。未配置游戏目录时不要自己找,直接让用户去工坊「⚙ 设置」页配置。做卡牌的参考检索用 `type:'card'`。
5. **生成代码(区块化读写,防抄错)**:扩展文件按锚点区块(//#noname-kit-begin/end 注释)管理,块种类四种:**skill / card / character / translate**。改已有条目:`noname_read_extension` 传 `listBlocks` 看区块目录 → 传 `block:'skill:ID'`(card/character/translate 同理)只读该块 → `noname_write_extension` 用 `blocks` 参数提交完整新块(未提交的区块由工具从旧文件逐字节保留);零星小改动(牌堆条目、一处数值)用 `edits` 精确补丁(find 必须唯一命中);删条目用 `deletes` 声明。**全文模式(code)仅用于新包首写或未建索引的存量包兜底;全文修改存量包必须带 `editScope`,范围外改动一律拒写**。新包首写按骨架模板给每个技能/翻译条目包锚点。任务消息若带「编辑目标条目: kind:id」行,本次是**单条目修改任务**:第 0 步直接 `block:'kind:id'` 读该块原文,确认单按「改动前→改动后」逐项列(不按新技能模板);写入只提交该区块(blocks/edits),严禁全文重写、严禁改动其他区块。此类消息若另带「新增技能」区块,新技能作为新区块插入(锚点包裹、照走完整流程、ID 遵守前缀规则),但其余既有区块依然禁动。**多文件包**(条目在子目录模块,如 character/character.js 的 `const character = {…}`):listBlocks 目录每项带 file 归属,read/write 必须传对应的 file 参数(消息里会给出所在文件);「所在文件」为 extension.js 时不传。
6. **必须校验**:`noname_validate`,有 error 修复重验。
7. **落盘前自查**:写入前对照【需求理解确认】逐技能自查(触发/频率/目标/数值/边界/不做什么,逐条能在代码里指出来),发现偏差先改再写。
8. **写入**:自查通过后 `noname_write_extension`(或手动模式由用户复制)。
9. **收口**:全部技能完成后调用 `noname_skills_written` 原样带回任务ID,提示用户进游戏测试;实测出引擎级可复用结论(API 行为/全局坑)时用 notes 参数一并提交,禁止写本任务实现细节。
10. **问题反馈**:先读代码、说明根因,直接修复(校验→写入)。

## 图片/素材约定
- 图片(立绘/卡面图)统一**平铺**放扩展文件夹的 image/ 子目录,文件名 = `<内部ID>.jpg`(用 noname_copy_images 复制;其目标只能是纯文件名,不支持子目录);不要散放根目录。
- **引擎默认立绘路径是扩展根目录**(extension/<包名>/<武将ID>.jpg),不会自动找 image/ 子目录——图片复制进 image/ 后,武将条目必须显式写 `img: "extension/<包名>/image/<武将ID>.jpg"`;卡面图在卡牌定义里同理显式写 `image: "extension/<包名>/image/<卡牌ID>.jpg"`(配 fullimage: true),否则游戏里显示默认图。
- 没有图片时,交付说明必须提醒用户补图。
## 扩展骨架(两种,绝不混用;检测:含 game.import( 为老式,含 export default 为新式)

锚点格式(区块化读写与防抄错依赖它,每个技能与其名称/描述条目都这样包):

```js
//#noname-kit-begin skill:cs_tianfa
  cs_tianfa: { /* 三段式 */ },
//#noname-kit-end skill:cs_tianfa
//#noname-kit-begin translate:cs_tianfa
  "cs_tianfa": "天罚",
  "cs_tianfa_info": "效果描述……",
//#noname-kit-end translate:cs_tianfa
```

### 老式 game.import
```js
game.import("extension", function (lib, game, ui, get, ai, _status) {
  return {
    name: "扩展名", // 必须与 extension/ 下文件夹同名
    content: function (config, pack) { /* 注册技能/武将/卡牌 */ },
    precontent: function () { /* lib.element 补丁、AI 注入 */ },
    arenaReady: function () {},
    help: {}, config: {},
    package: {
      character: { character: {}, translate: {} },
      card: { card: {}, translate: {}, list: [] },
      skill: { skill: {}, translate: {} },
      author: "作者", version: "1.0",
    },
  };
});
```

### 新式 ES Module(官方现行)
```js
import { lib, game, ui, get, ai, _status } from "../../noname.js";
export const type = "extension";
export default function () {
  return {
    name: "扩展名", // 必须与文件夹同名
    content (config, pack) {},
    precontent () {},
    arenaReady () {},
    config: {}, help: {},
    package: { /* 同上 */ },
    editable: false, connect: false,
  };
}
```
可选字段(按需添加): `prepare(){}`(所有扩展加载后)、`onremove(){}`(扩展删除时)、`files`(资源清单)。

## 技能三段式(filter → cost → content)
```js
{
  audio: 2,
  enable: "phaseUse",        // 主动技;或 trigger: { player: "phaseBegin" }
  usable: 1,
  forced: false, locked: false, frequent: false,
  filter: function (event, player) { return true },
  filterTarget: function (card, player, target) { return target != player },
  selectTarget: 1,
  cost: function (event, trigger, player) { /* 可选段:发动代价/前置选择;其 event.result.bool 为 true 才执行 content */ },
  content: function (event, trigger, player) { /* 新式用 async 并 await 每步 */ },
  ai: { order: 6, result: { player: 1, target: function (p, t) { return get.attitude(p, t) > 0 ? 1 : -1 } }, expose: 0.2 },
}
```
- 主动技(enable)必须写 ai 字段,否则 AI 不会用。
- result.target 正值倾向友方、负值敌方,别写反。
- content 里异步动作(draw/useCard/damage/chooseToUse)必须 await。
- 改 lib/_status 全局状态要考虑联机(game.broadcastAll)。

## 武将结构
```js
character: { zhaoyun: { sex: "male", group: "qun", hp: 3, skills: ["skillId"] } }
translate: { zhaoyun: "赵云", skillId: "技能名", skillId_info: "技能描述" }
```
每个技能 id 必须有 `<id>` 与 `<id>_info` 两条 translate。

## 卡牌结构
```js
card: { myCard: { fullskin: true, type: "basic", enable: true, content: function(){} } }
translate: { myCard: "牌名", myCard_info: "效果" }
```
package.card.list 牌堆条目也要给,否则游戏里摸不到这张牌。

## 常见错误(校验器会拦)
1. 代码区全角标点/引号(字符串内中文标点没事)
2. name 与文件夹名不一致(新式直接不加载)
3. 缺 translate 的 `<id>` / `<id>_info`
4. content 漏 await;主动技缺 ai 字段;result.target 正负写反
5. 新旧写法混用

## 诊断与反馈循环
- content 关键步骤插临时 `game.log(...)` 供用户游戏内查看;稳定后移除。
- 用户反馈问题:先 `noname_read_extension` 读当前真实代码,再定位修复;不要凭对话记忆改。
- 每轮反馈自动累加轮次;完成后 `noname_skills_written` 原样带回任务ID。
