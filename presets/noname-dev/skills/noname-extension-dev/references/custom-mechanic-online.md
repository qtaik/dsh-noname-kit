# 自定义机制联机实现示例

以下示例按无名杀 1.11.6 的原生事件流程编写。用于其他引擎版本或模式前，查同类官方技能，再核对目标引擎的加载方式、事件与 API。三个代码段使用扩展已有的 `lib`、`game`、`get`，可放在 ES Module 或传统 `game.import` 工厂中。示例的 `demo_` ID 应按实际包前缀替换。

先沿目标玩法追踪谁拥有事件、谁做选择、结算端拿到什么结果。在 1.11.6，`noname/init/loading.js` 分别检查扩展和武将包的 `connect`。按实际入口核对主客机能加载完整的技能、子技能和素材，包括联机房间实际启用的武将包。

## 技能类型 · 预约技

用持有者技能的 `global: "roundStart"` 给每位持有者各安排一次轮首选择。使用实际持有者的 `chooseControl`，无需自建弹窗或等待通道。阶段校验用 `filter` 收到的触发名。把预约存在结算端，按技能和当前角色隔离。示例中，轮中首次取得技能的人从下轮开始预约，原持有者本轮重新获得该技能时可继续用自己的预约。

```js
const nnkMechanic_demo_reserve = {
  id: "demo_reserve",
  name: "预约技",
  kind: "skill-type",
  description: "每轮开始时，你可以为此技能选择一个本轮的触发时机。",
  createSkill(skill, { skillId, timings }) {
    const reservations = new WeakMap();
    const reserveSkill = `${skillId}_reserveTiming`;
    return {
      ...skill,
      trigger: { player: timings.map(({ phase }) => phase) },
      filter(event, player, triggerName, indexedData) {
        const reservation = reservations.get(player);
        return reservation?.round === game.roundNumber &&
          reservation.phase === triggerName &&
          (!skill.filter || skill.filter.call(this, event, player, triggerName, indexedData));
      },
      group: [skill.group ?? [], reserveSkill].flat(),
      subSkill: {
        ...skill.subSkill,
        reserveTiming: {
          trigger: { global: "roundStart" },
          forced: true,
          popup: false,
          filter(event, player) {
            return timings.length > 0 && player.hasSkill(skillId) &&
              reservations.get(player)?.round !== game.roundNumber;
          },
          async content(event, trigger, player) {
            const round = game.roundNumber;
            const result = await player.chooseControl([...timings.map(({ label }) => label), "cancel2"])
              .set("prompt", "请选择此技能本轮的触发时机")
              .set("ai", function () { return 0; })
              .forResult();
            if (!player.isIn() || !player.hasSkill(skillId) || game.roundNumber !== round) return;
            const timing = timings.find(({ label }) => label === result?.control);
            reservations.set(player, { round, phase: timing?.phase });
          },
        },
      },
    };
  },
};

const demo_reserve_draw = nnkMechanic_demo_reserve.createSkill({
  forced: true,
  async content(event, trigger, player) {
    await player.draw();
  },
}, {
  skillId: "demo_reserve_draw",
  timings: [
    { label: "你的准备阶段开始时", phase: "phaseZhunbeiBegin" },
    { label: "你的结束阶段开始时", phase: "phaseJieshuBegin" },
  ],
});
```

将 `demo_reserve_draw` 按同名 ID 登记到技能表并补齐翻译，例如「预约技。每轮开始时，你可以选择在本轮你的准备阶段开始时或结束阶段开始时摸一张牌。」这段工厂接收由预约技决定触发时机的技能主体，传入的 `timings` 使用互不重复的标签和事件名，`cancel2` 留给取消，`reserveTiming` 留给此工厂生成的子技能。技能原有的发动条件、代价、次数和效果继续走引擎流程。`chooseControl` 以允许列表里的 `control` 为准，取消结果也可能带 `bool: true`。选择取消或未返回有效项时，本轮没有预约。若新增可见标记，按已确认的公开范围同步。

## 共用规则 · 接力

主技能等原效果结束，把受到效果的角色作为选人者传给 `resolve`。实际选人框可取消。可选名单按结算端规则计算，原生选择经 `.set` 传入名单，远端过滤器用 `get.event()` 读取。结算端按返回结果再次核对，再调用主技能传入的效果函数。

```js
const nnkMechanic_demo_relay = {
  id: "demo_relay",
  name: "接力",
  kind: "shared-rule",
  description: "受到主技能效果后，你可以选另一名符合条件的在场角色接棒。",
  async resolve({ chooser }, { isEligible, effect }) {
    if (!chooser.isIn()) return false;
    const canRelayTo = (target) => target !== chooser && target.isIn() && isEligible(chooser, target);
    const candidates = game.filterPlayer(canRelayTo);
    if (!candidates.length) return false;

    const result = await chooser.chooseTarget("你可以选择一名角色接棒", function (card, player, target) {
      return get.event().relayTargetIds.includes(target.playerid);
    }).set("relayTargetIds", candidates.map((target) => target.playerid))
      .set("ai", function (target) {
        return get.attitude(get.event().player, target);
      }).forResult();

    const target = result?.targets?.[0];
    if (!result?.bool || !chooser.isIn() || !target || !candidates.includes(target) || !canRelayTo(target)) return false;
    await effect(target);
    return true;
  },
};

const demo_relay_draw = {
  trigger: { player: "phaseZhunbeiBegin" },
  async cost(event, trigger, player) {
    event.result = await player.chooseTarget("你可以令一名角色摸一张牌").forResult();
  },
  async content(event) {
    const chooser = event.targets[0];
    if (!chooser.isIn()) return;
    await chooser.draw();
    await nnkMechanic_demo_relay.resolve({ chooser }, {
      isEligible: (from, target) => target.isDamaged(),
      effect: (target) => target.draw(),
    });
  },
};
```

将 `demo_relay_draw` 按同名 ID 登记到技能表。其规则为「准备阶段开始时，你可以令一名角色摸一张牌。然后该角色可以令另一名已受伤的角色也摸一张牌。」示例适用于可公开的候选条件。`isEligible` 和 `effect` 只由结算端调用，远端过滤器只读取通过原生选择传入的数据。无合法目标、取消、回传无效或角色离场时结束接力。断线及托管沿目标模式的原生超时处理。玩法若规定断线即取消，另查该引擎如何区分取消、超时托管与正常选择，再实现相应分支。

## 全局规则 · 轮首补给

扩展加载时登记一次，进入身份局后由轮首事件的角色代整局处理一批。登记去重与效果去重各自生效。以下使用当前对局的轮次历史记录本轮已经发起补给，写入记录后再等待第一个摸牌事件。第四轮起过滤掉轮首补给，下一局以新局历史重新判定。

```js
const nnkMechanic_demo_supply = {
  id: "demo_supply",
  name: "轮首补给",
  kind: "global-rule",
  description: "身份局的前三轮，每轮开始时，在场角色各摸一张牌。",
  install() {
    const ruleId = "demo_supply_round";
    lib.skill[ruleId] ??= {
      trigger: { player: "roundStart" },
      forced: true,
      popup: false,
      filter() {
        return get.mode() === "identity" && game.roundNumber >= 1 && game.roundNumber <= 3;
      },
      async content(event, trigger, player) {
        if (game.getRoundHistory("custom", (entry) => entry.demo_supply_started).length) return;
        game.getGlobalHistory("custom").push({ demo_supply_started: true });
        for (const target of game.filterPlayer().sortBySeat(player)) {
          if (target.isIn()) await target.draw();
        }
      },
    };
    return lib.skill.global.includes(ruleId) || game.addGlobalSkill(ruleId);
  },
};

```

在扩展现有 `content` 初始化中显式调用 `nnkMechanic_demo_supply.install()` 并检查返回结果。在 1.11.6 的 `roundStart` 触发前，引擎已标记本轮全局历史的起点。这里的存续条件由模式和轮次过滤，监听本身随扩展保留。需要动态卸载的机制还要找到实际停用和对局结束入口。`roundEnd` 取决于后续轮次推进，提前结束的对局可能跳过它。多个来源共有规则时，按源移除并保留其余来源所需的注册。

## 状态、显示与重连

- 将摸牌、扣血、数值修改和随机结算留在原生事件链中。公开的提示、动画和标记可通过已核实的引擎 API 同步。使用 `game.broadcastAll` 时考虑发送端同时执行，远端函数只使用经该机制传递的数据和各端已有的定义。
- 1.11.6 的 `syncStorage` 只写回放，`markSkill` 或 `updateMarks(skill)` 才有对应标记的实时同步路径。原生选择会携带技能状态，其中包含各玩家的 `storage`。保密状态留在结算端，远端只收规则允许知道的视图。
- 一次性显示同步与重连恢复是两个入口。验证 `get.arenaState` 对所需字段的覆盖范围。1.11.6 的 `_status.postReconnect` 在玩家重建前执行，适合恢复动态定义。依赖玩家对象的显示应查实际玩家重建后的回调，保留模式已有回调，由当前公开状态重画并清理临时界面。重连时不重新发放已经结算的效果。

实测时让主机和客机分别成为预约持有者，验证选择回传、取消和夺技后的独立状态。让客机在接力里担任选人者，验证仅选人者弹窗、他人继续等待，以及取消、确认、无目标和断线托管的结果。补给验证多人各摸一张、第四轮停用和再次开局。涉及持续显示或断线恢复时，在正在选择和效果已结算后分别重连。记下引擎版本、模式和实际覆盖场景。

## 当前引擎查证位置

| 要查的行为 | 无名杀 1.11.6 源码入口 |
| --- | --- |
| 给实际玩家选项、回传选择 | `character/jsrg.js` 的 `jsrg_new_lirang`，`character/huicui.js` 中使用 `.set("targets", targets)` 的跨玩家选择，`noname/library/element/gameEvent.js` 的 `send`，`noname/library/element/content.js` 的 `chooseTarget` 和 `chooseControl` |
| 轮首触发与整批防重 | `noname/library/element/content.js` 的 `phase` 与 `phaseLoop`，`noname/library/index.js` 的 `filterTrigger`，`noname/game/index.js` 的 `getRoundHistory`、`addGlobalSkill`、`removeGlobalSkill` |
| 客端显示与重连 | `noname/get/index.js` 的 `skillState` 和 `arenaState`，`noname/library/element/player.js` 的 `syncStorage`、`markSkill`、`updateMarks`，`noname/library/index.js` 的 `reinit` 和 `onreconnect` 调用，`character/sb.js` 的 `sbqicai` |
