---
name: noname-extension-dev
description: 无名杀(Noname)扩展开发完整规范:扩展骨架(老式/新式)、技能三段式、武将与卡牌结构、translate 规则、常见错误清单与工作流。写扩展代码前加载本技能。
whenToUse: 需要编写、修改或审查无名杀扩展代码(武将技能/卡牌)时加载。
---

# 无名杀扩展开发规范

你在为开源三国杀游戏 Noname 编写扩展。严格遵守以下规范与工作流。

## 任务粒度(重要)
**一个任务 = 一个完整武将(含全部技能)、一张卡牌,或一个完整的自定义游戏模式(mode 类型,见下节)。**首次实现武将任务时,确认与实现覆盖全部技能;全部完成后一次性写入并收口。后续反馈只修复对应技能,其他技能的确认状态保持不变。

## 🎲 自定义模式(玩法)任务(mode 类型)
类型为 mode 时,交付物是**一个可用 game.addMode 注册的独立游戏模式**(主菜单独立入口、选将开局、规则生效、终局结算)。除通用工作流外额外遵守:

**第 0 步:先探测引擎版本**(读游戏目录 version 文件或 noname 源码特征)并报告给用户;版本相关 API 写法先查下表或读引擎源码核实,禁止凭固定版本经验猜测。

**1.9.0 实测对照表**(其他版本先探测再核实):
- 模式注册:game.addMode 必须在扩展 **precontent** 里调(content 里调时序错乱);**content(){} 空函数不可省**(引擎以它决定 package.skill 是否注册)。
- 选将:game.chooseCharacter 不是引擎方法,须模式在自身 game 字段自定义(照 mode/brawl.js 千里单骑范式:dialog + chooseButton,AI 用 randomGets 分将)。
- AI 态度:模式 **get 字段必须定义 rawAttitude**(混战=全员敌对),否则 AI 出牌选目标即崩。
- 先手:game.zhu 引擎不管,模式 start 里自行赋值。
- 分步函数:start/技能 content 被 StepCompiler 重新编译,模块闭包变量丢失——只用注入参数、内联字面量、_status/game 挂载。
- 摸牌修正:无 playerDraw mod;用 phaseDrawBegin2 触发改 trigger.num(官方 olyouji 同款;配合 storage 标记,用掉即删)。
- 技能挂载:常驻规则技逐人**普通 addSkill**;hidden: 分组与 addTempSkill("x","phaseChange") 都会废掉触发/时机。
- 触发门:非 forced 技能必须有 check 才会自动触发。
- 距离视为 X:globalFrom/To 返回 **-Infinity**(返回 1 会被坐骑顶掉)。
- 技能名显示:若目标十周年UI 的 gainSkill 竖排误显示内部规则技，可按实际展示需要省略其 translate 名；面向玩家展示的技能仍提供名称与描述。
- 换座:交换两人不改变行动次序;必须打破环形线性重排 + game.zhu 指向新 1 号位 + seatNum 同步 + playerMap 按 playerid 重建。
- 选将前:逐人 getId()(注册 game.playerMap)。

**模式骨架**:需求确认单(见下)→ start:prepareArena(读模式配置 get.config)→ 定先手 → 自定义 chooseCharacter(选将+选座)→ syncState + gameStart + 挂规则技能 → gameDraw → phaseLoop(先手)→ 胜负终局判定(按用户确认的胜负条件、终局时机及相关规则实现)。

**确认单结构(mode 版)**:玩法一句话复述 / 人数与先手规则 / 胜利条件 / **逐条规则复述(触发时机/数值/边界)** / 明确不做什么 / 实现骨架自查(按对照表选定)。确认后**每条规则一个节点名**,skills_written 带回(规则节点动态登记,用户逐条确认后自动收口)。

**游戏内 UI 规范**:自绘界面一律用引擎标准 ui.create.dialog,禁止自绘 DOM 覆盖层(缩放错乱);弹窗标题留白防出框;内部规则技的 translate 按实际展示需要设置;UI 兼容性需在用户所用皮肤(如十周年UI)下实测。

## 工作流(不可跳步)
1. **需求理解确认(硬门禁)**:只读询问按用户要求答复；需要制作或修改代码时（既有问题反馈修复例外不变），逐技能输出【需求理解确认】——名称/类型、触发时机、频率、目标、数值、不做什么、交互;卡牌复述牌名/类型/效果/牌堆。**输出后停下等用户确认**;有歧义先用 ask_user_question 问清;**回答只消除歧义、不算确认**——澄清后给出最终确认单,仍须等到用户明确回复「确认」;未确认前禁止写代码。
2. **ID 前缀约定**:任务带「内部 ID 前缀」时,新增内部 ID = 前缀 + 拼音/英文(如 cs_tianfa),显示名写入 translate。
3. **找官方参考**:用 `noname_search_reference` 直接搜官方相似实现(中文名/ID/效果关键词;整句描述按相似度列候选)。按本次所需机制寻找参考，可组合已实际读到的不同实现，不要求找到完全相同的机制组合。已有足够参考支持当前方案时停止扩查，无需穷举候选或等 coverage 完整；未搜完仍不能声称内容不存在。参考仍不足时，仅针对缺少依据的机制调整关键词或定位源码。确认前的只读调研不受确认门限制;用户已给参考代码或改动极简单时可跳过;编辑已有扩展先 `noname_read_extension` 读当前代码。
4. **源码核验与检索**：noname_search_reference 用于查找相似技能、武将和卡牌实现；引擎 API 用通用只读工具查当前游戏源码，包括相关 .js/.ts、类型与必要文档，按实际项目结构定位。
   - **核对实际用法**：对 API 参数或行为有疑问，或准备判为不支持、参数无效时，先读当前定义、参数处理和直接相关分支，给出依据位置。使用参考前读相应实现，不把翻译、注释或相邻条目当作该技能。搜索未命中不等于不支持，不据此删除参数或功能。
   - **完成当前任务**：参考和证据足够后继续完成当前武将、卡牌或模式；可组合不同机制的参考，复用源码未变的已核实结论，不要求穷举候选或审计整个引擎。证据不足、读取失败或存在冲突时，说明具体未决问题与限制，不猜测。遵守宿主权限、预算、超时与取消。
   - **范围与写入**：从已配置的游戏路径定位所需源码，按需读取，避免重复或无关检索；不在盘符根、整个用户目录或 DSH 安装目录盲目寻找游戏。游戏源码保持只读，扩展修改仍经 noname_write_extension 校验及原有写入门禁。未配置游戏目录时请用户先在工坊设置中配置。卡牌参考检索用 type:'card'。
读取与发现采用明确分页：仅按当前问题需要续读目录/工具/技能列表或源码，分别使用 offset/limit 与字符 offset/limit，并复用 coverage.snapshot 作为 snapshot；源码变化时重新查询，不混合页面。coverage 未完成、资源上限、解析失败、歧义都不能解释为条目不存在。搜索 5 GiB 上限只适用于分块检索；静态解析有独立上限。手动写入较长成品返回 draftId，用 noname_read_extension 在同一会话中分页读取，直到 pagination.complete=true；草稿闲置15分钟过期，不写入游戏文件。

5. **生成代码(区块化读写,防抄错)**:扩展文件按锚点区块(//#noname-kit-begin/end 注释)管理,块种类四种:**skill / card / character / translate**。改已有条目:`noname_read_extension` 传 `listBlocks` 看区块目录 → 传 `block:'skill:ID'`(card/character/translate 同理)只读该块 → `noname_write_extension` 用 `blocks` 参数提交完整新块(未提交的区块由工具从旧文件逐字节保留);零星小改动(牌堆条目、一处数值)用 `edits` 精确补丁(find 必须唯一命中);删条目用 `deletes` 声明。**全文模式(code)仅用于新包首写或未建索引的存量包兜底;全文修改存量包必须带 `editScope`,范围外改动一律拒写**。新包首写按骨架模板给每个技能/翻译条目包锚点。任务消息若带「编辑目标条目: kind:id」行,本次是**单条目修改任务**:第 0 步直接 `block:'kind:id'` 读该块原文,确认单按「改动前→改动后」逐项列(不按新技能模板);写入只提交该区块(blocks/edits),严禁全文重写、严禁改动其他区块。此类消息若另带「新增技能」区块,新技能作为新区块插入(锚点包裹、照走完整流程、ID 遵守前缀规则),但其余既有区块依然禁动。**多文件包**(条目在子目录模块,如 character/character.js 的 `const character = {…}`):listBlocks 目录每项带 file 归属,read/write 必须传对应的 file 参数(消息里会给出所在文件);「所在文件」为 extension.js 时不传。**子目录模块的内容不要单独过 `noname_validate`**(没有 name 字段,必报「没有找到 name」)——模块文件由 `noname_write_extension` 的内置语法检查兜底,`noname_validate` 用于入口 extension.js 或老式单文件包。
   **存量全文限制**:自动或手动任务都必须显式给 `editScope`;仅允许唯一的既有 ID(可用 `kind:id` 限定)。imports/precontent/骨架/注释/CRLF/尾空白等未授权原文完全保留,不做行尾归一。新增/删除用区块,其他区域用唯一原文 `edits`(未建索引也支持)。正则、除法、模板插值或区间歧义导致全文拒写时,改用精确补丁,不要扩大授权重写文件。
6. **必须校验**:`noname_validate`,有 error 修复重验。
7. **落盘前自查**:写入前对照【需求理解确认】逐技能自查(触发/频率/目标/数值/边界/不做什么,逐条能在代码里指出来),发现偏差先改再写。
8. **写入**:自查通过后 `noname_write_extension`(或手动模式由用户复制)。
9. **收口**:本轮实现或修复的技能完成后调用 `noname_skills_written` 原样带回任务ID,`skills` 只填本轮实际改动的任务技能名称,提示用户进游戏测试;实测出引擎级可复用结论(API 行为/全局坑)时用 notes 参数一并提交,禁止写本任务实现细节。
10. **问题反馈**:先读代码、说明根因,直接修复(校验→写入)。

## 图片/素材约定
- 图片(立绘/卡面图)统一**平铺**放扩展文件夹的 image/ 子目录,文件名 = `<内部ID>.jpg`(用 noname_copy_images 复制;其目标只能是纯文件名,不支持子目录);不要散放根目录。
- **引擎默认立绘路径是扩展根目录**(extension/<包名>/<武将ID>.jpg),不会自动找 image/ 子目录——图片复制进 image/ 后,武将条目必须显式写 `img: "extension/<包名>/image/<武将ID>.jpg"`;卡面图在卡牌定义里同理显式写 `image: "extension/<包名>/image/<卡牌ID>.jpg"`(配 fullimage: true),否则游戏里显示默认图。
- 没有图片时,交付说明必须提醒用户补图(mode 任务交付的是玩法不是立绘,无图是常态,不需提醒)。

## 配音约定(音频只放扩展包内,绝不放游戏本体 audio/ 目录)
- **技能配音**:新增自带技能配音时，技能对象写 `audio: "ext:<包名>/audio/skill:<句数>"`(两句就是 :2,一个技能任意多句),文件放 extension/<包名>/audio/skill/<技能内部ID>1.mp3、<ID>2.mp3……(mp3,内部ID+从 1 连号,句数与 audio 数字一致)。复用已有配音时，先核对当前引擎支持的引用方式及目标资源；已有音频引用不一概要求带 ext:。audio: 2 / audio: true 等写法会触发校验 warning，应核实资源来源；新增音频仍只放扩展包内，不向游戏本体 audio/ 写入。
- **阵亡语音:零代码**——引擎对扩展武将默认自动找 extension/<包名>/audio/die/<武将内部ID>.mp3(可多句),武将条目不用写任何字段。
- 复制配音用 `noname_copy_audio`:target 必须是 `skill/<内部ID><序号>.mp3` 或 `die/<武将ID><序号>.mp3`;技能配音条目带 `skill` 参数(任务里的技能显示名),交付才计入任务收口。任务消息带「配音/阵亡语音」区块时按列出的句数与路径逐条复制。

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
  audio: "ext:包名/audio/skill:2",  // 自带配音示例:两句,文件 audio/skill/<内部ID>1.mp3、<ID>2.mp3；复用已有配音先核实引用方式
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

## 联机兼容写法(扩展要在联机房间里正常,必须知道这四条)
引擎联机模式对扩展有额外规则(源码实证);违反时单机正常、一进联机房就出怪现象:
1. **包要声明 connect**:`package.character.connect` / `package.card.connect`(包对象级)。
   不写的包不进联机池,别人房间里看不到(工坊内核会自动补齐,但自己写是明确契约)。
2. **技能默认只在主机加载**:联机模式下,技能定义没写 `connect` 的会被替换成"影子"
   (只留 nopop/derivation)——客人发动时由**主机执行效果、广播结果**。这是设计而非 bug。
   **`forceLoad: true` 的技能例外**:客人本机也完整加载,跨机同步要自己负责,默认别用。
3. **卡牌的 `derivation` / `derivationpack` 是"条件卡"标记**(卡牌独有,武将没有):
   引擎会维护 mode_derivation 清单,并在开局前过滤——
   `derivation` 指向的武将不在本机(客人没装该武将包)、或 `derivationpack` 指向的卡牌包
   本局没启用时,**那张卡会被剔除**。表现=同一张派生的牌"有时候能用有时候消失"。
   写派生卡前先明确:这张牌依赖哪个武将/包?若依赖方可能缺席,就不要用 derivation 机制。
4. **牌堆在联机走另一条路**:联机模式不组装 `lib.cardPile`,牌堆走 `cardPackList`——
   单机的"禁牌堆/加牌堆"设置**不会带进联机房间**;`package.card.list` 的牌堆条目
   在联机下是"包自带牌堆",进不进房间由包启用与否决定。

## 武将结构
```js
character: { zhaoyun: { sex: "male", group: "qun", hp: 3, skills: ["skillId"] } }
translate: { zhaoyun: "赵云", skillId: "技能名", skillId_info: "技能描述" }
```
面向玩家展示的技能 id 必须有 `<id>` 与 `<id>_info` 两条 translate；内部规则技的名称和描述按实际展示需要设置。

## 卡牌结构
```js
card: { myCard: { fullskin: true, type: "basic", enable: true, content: function(){} } }
translate: { myCard: "牌名", myCard_info: "效果" }
```
package.card.list 牌堆条目也要给,否则游戏里摸不到这张牌。

## 常见问题(静态检查与游戏验证)
校验返回 error 时必须修复并重验，写入工具会拒写；warning 是需结合当前源码和需求判断的提示。触发、效果、AI 与联机等语义仍需游戏内验证，静态检查通过不代表没有 bug。
1. 代码区全角标点/引号(字符串内中文标点没事)
2. name 与文件夹名不一致(新式直接不加载)
3. 面向玩家展示的条目缺少所需的名称或描述 translate
4. content 漏 await;主动技缺 ai 字段;result.target 正负写反
5. 新旧写法混用

## 诊断与反馈循环
- content 关键步骤插临时 `game.log(...)` 供用户游戏内查看;稳定后移除。
- 用户反馈问题:先 `noname_read_extension` 读当前真实代码,再定位修复;不要凭对话记忆改。
- 每轮反馈自动累加轮次;完成后 `noname_skills_written` 原样带回任务ID,`skills` 只填本轮实际修复的技能,不得回传整组未改技能。已确认技能默认保留;如果本轮确实修改了某个已确认技能且需要重新测试,将其名称同时列入 `skills` 与 `retestSkills`,未修改的技能不得列入 `retestSkills`。
