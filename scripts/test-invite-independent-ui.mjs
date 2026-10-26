// Render the actual OnlinePanel with deterministic React hooks and API replies.
// This checks UI state/clicks, not native DSH, signaling or P2P connectivity.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const begin = source.indexOf('    var ONLINE_MODES = [');
const end = source.indexOf('    // ── 工坊页', begin);
assert.ok(begin >= 0 && end > begin);
const body = source.slice(begin, end);
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.children) : value == null || value === false ? '' : String(value);
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.children)] : [];
const h = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity) });
const e = (tag, className, ...children) => h(tag, { className }, ...children);
const status = (state = {}, role = '', online = true, events = []) => ({
  active: true, kernel: { state: 'ok' }, batchRecovery: { status: 'none' },
  bridge: { online, role, state: { phase: 'idle', ...state }, events, cfg: {} },
});
const members = mode => ({ type: 'room_members', ts: Date.now(), data: {
  mode, nextMode: mode, capacity: mode === 'single' ? 2 : 8,
  list: [{ name: 'Host', role: 'host' }, { name: 'Guest', role: 'guest' }],
} });
async function mount(initial) {
  let current = initial, cursor = 0, dirty = false, tree;
  let now = Date.now();
  class FixtureDate extends Date { static now() { return now; } }
  const hooks = [], effects = [], intervals = [], commands = [], copied = [], confirms = [], errors = [];
  let commandReply = { ok: true };
  const React = {
    useState(initialValue) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { value: typeof initialValue === 'function' ? initialValue() : initialValue };
      const slot = hooks[index];
      return [slot.value, value => { const next = typeof value === 'function' ? value(slot.value) : value; if (!Object.is(next, slot.value)) { slot.value = next; dirty = true; } }];
    },
    useRef(value) { return this.useState(() => ({ current: value }))[0]; },
    useId() { return this.useState('invite-ui-fixture')[0]; },
    useEffect(fn, deps) {
      const index = cursor++, previous = hooks[index];
      if (!previous || !deps || !previous.deps || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        hooks[index] = { deps: deps && deps.slice() }; effects.push(fn);
      }
    },
  };
  const fetch = async (url, options) => {
    if (url.endsWith('/online/status')) return { ok: true, json: async () => current };
    if (url.endsWith('/online/avatars')) return { ok: true, status: 200, json: async () => ({ ok: true, avatars: [] }) };
    if (url.endsWith('/online/command')) { commands.push(JSON.parse(options.body)); return { ok: commandReply.ok, json: async () => commandReply }; }
    throw Error('Unexpected UI fixture request: ' + url);
  };
  const OnlinePanel = new Function('React', 'fetch', 'h', 'e', 'ModalFrame', 'window', 'navigator', 'location', 'setInterval', 'clearInterval', 'console', 'Date', body + '\nreturn OnlinePanel;')(
    React, fetch, h, e, function ModalFrame() {},
    { confirm(message) { confirms.push(message); return true; } },
    { clipboard: { writeText(value) { copied.push(value); return Promise.resolve(); } } },
    { protocol: 'http:', port: '12345' }, fn => { intervals.push(fn); return intervals.length; }, () => {},
    { error: (...values) => errors.push(values), log() {} }, FixtureDate,
  );
  async function flush() {
    for (let i = 0; i < 30; i++) {
      await Promise.resolve(); await Promise.resolve();
      if (!dirty && !effects.length && i > 5) break;
      if (dirty || i === 0) { dirty = false; cursor = 0; tree = OnlinePanel(); }
      effects.splice(0).forEach(fn => fn());
    }
    assert.equal(errors.length, 0, 'Actual renderer should not fall back to a caught render error');
    return tree;
  }
  dirty = true; await flush();
  const all = () => nodes(tree);
  const find = label => all().find(node => node.tag === 'button' && text(node) === label);
  return {
    commands, copied, confirms, all, text: () => text(tree), button: find,
    async click(label) { const button = find(label); assert.ok(button, 'Button exists: ' + label); if (button.props.disabled) return false; button.props.onClick(); await flush(); return true; },
    async change(predicate, value) { const node = all().find(predicate); assert.ok(node, 'Editable field exists'); node.props.onChange({ target: { value } }); await flush(); },
    async update(next) { current = next; intervals.forEach(fn => fn()); await flush(); },
    async advance(ms) { now += ms; dirty = true; await flush(); },
    async openSignaling() { const fold = all().find(node => node.props.role === 'button' && text(node).includes('信令服务器')); assert.ok(fold); fold.props.onClick(); await flush(); },
    reply(next) { commandReply = next; },
    async openRoom() { const opener = all().find(node => node.tag === 'button' && text(node).startsWith('🏛 插件房间(')); assert.ok(opener, 'Room opener exists without requiring a public code'); opener.props.onClick(); await flush(); },
  };
}
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); } }

await test('Fresh invite creation sends the chosen mode without requiring public-room creation', async () => {
  const panel = await mount(status({}, '', true, [members('single')]));
  assert.equal(await panel.click('邀请码建房'), true);
  assert.deepEqual(panel.commands, [{ action: 'create_room', args: { mode: 'single', signaling: 'invite' } }]);
});
await test('A failed public attempt leaves invite creation reachable and preserves typed text', async () => {
  const panel = await mount(status());
  await panel.click('📨 收到邀请码?从这里加入…');
  await panel.change(node => node.tag === 'textarea' && node.props.placeholder === '粘贴房主的邀请码…', 'NNK1.keep-my-input');
  await panel.change(node => node.tag === 'input' && node.props.maxLength === 6, 'AB2C9X');
  panel.reply({ ok: false, error: '信令服务器连接失败' });
  await panel.click('🏛 创建 P2P 房间');
  await panel.update(status({ phase: 'failed', lobbyOpen: false, roomCodeAvailable: false, roomCode: null }, 'host'));
  panel.reply({ ok: true });
  assert.equal(await panel.click('邀请码建房'), true);
  assert.equal(panel.commands.at(-1).args.signaling, 'invite');
  assert.equal(panel.all().find(node => node.tag === 'textarea' && node.props.placeholder === '粘贴房主的邀请码…').props.value, 'NNK1.keep-my-input');
  assert.equal(panel.all().find(node => node.tag === 'input' && node.props.maxLength === 6).props.value, 'AB2C9X');
});
await test('Private host opens a real renderer lobby without exposing or copying the internal code', async () => {
  const panel = await mount(status({ phase: 'room_open', lobbyOpen: true, roomCodeAvailable: false, roomCode: 'INNER1' }, 'host', true, [members('single')]));
  await panel.openRoom();
  assert.match(panel.text(), /通过邀请码加入/);
  assert.equal(panel.text().includes('INNER1'), false);
  assert.equal(panel.button('📋 复制'), undefined);
  assert.equal(await panel.click('📨 生成邀请码'), true);
  assert.deepEqual(panel.commands.at(-1), { action: 'invite_refresh', args: { kind: 'invite' } });
  assert.equal(panel.button('邀请码建房').props.disabled, true);
  await panel.click('启用房号');
  assert.deepEqual(panel.commands.at(-1), { action: 'create_room', args: { mode: 'single', signaling: 'mqtt' } });
});
await test('An open private host with null wire code retains mode/load and session termination', async () => {
  const panel = await mount(status({ phase: 'room_open', lobbyOpen: true, roomCodeAvailable: false, roomCode: null }, 'host', true, [members('single')]));
  await panel.openRoom();
  await panel.change(node => node.tag === 'input' && node.props.type === 'radio' && !node.props.checked, '');
  assert.equal(panel.commands.at(-1).action, 'set_mode');
  const mode = panel.commands.at(-1).args.mode;
  await panel.click('🚀 载入到游戏(按所选模式)');
  assert.deepEqual(panel.commands.at(-1), { action: 'restart_room', args: { mode } });
  await panel.click('🗑 解散房间');
  assert.equal(panel.commands.at(-1).action, 'cancel');
  assert.match(panel.confirms.at(-1), /原连接/);
  assert.match(panel.text(), /正在退出，等待内核确认/);
});
await test('Private host invite receipt remains editable and submits only the selected invite row', async () => {
  const at = Date.now();
  const panel = await mount(status({ phase: 'invite_ready', lobbyOpen: true, roomCodeAvailable: false, roomCode: 'INNER2', invites: [{ id: 7, at, status: 'pending' }] }, 'host', true, [members('identity'), { type: 'invite_ready', ts: at, data: { id: 7, code: 'NNK1.offer' } }]));
  await panel.openRoom();
  await panel.click('📨 粘回执码');
  await panel.change(node => node.tag === 'textarea' && node.props.placeholder === '粘贴这位朋友的回执码…', 'NNK1.answer');
  await panel.click('🔗 连接');
  assert.deepEqual(panel.commands.at(-1), { action: 'accept_answer', args: { id: 7, code: 'NNK1.answer' } });
  assert.equal(panel.text().includes('INNER2'), false);
});
await test('Private guest opens the lobby, sees no false room number and can leave', async () => {
  const panel = await mount(status({ phase: 'lobby_waiting', lobbyOpen: true, roomCodeAvailable: false, roomCode: 'INNER3' }, 'guest', true, [members('identity')]));
  await panel.openRoom();
  assert.match(panel.text(), /通过邀请码加入/);
  assert.equal(panel.text().includes('INNER3'), false);
  assert.equal(panel.button('📋 复制'), undefined);
  assert.equal(panel.all().some(node => node.tag === 'input' && node.props.type === 'radio'), false);
  assert.equal(panel.button('启用房号'), undefined);
  await panel.click('🚪 退出房间');
  assert.equal(panel.commands.at(-1).action, 'cancel');
});
await test('Private guest answer generation and copying remain independent of a public number', async () => {
  const panel = await mount(status());
  await panel.click('📨 收到邀请码?从这里加入…');
  await panel.change(node => node.tag === 'textarea' && node.props.placeholder === '粘贴房主的邀请码…', 'NNK1.offer');
  await panel.click('生成回执码');
  assert.deepEqual(panel.commands.at(-1), { action: 'join_invite', args: { code: 'NNK1.offer' } });
  await panel.update(status({ phase: 'answer_ready', roomCodeAvailable: false }, 'guest', true, [{ type: 'answer_ready', ts: Date.now(), data: { code: 'NNK1.receipt' } }]));
  await panel.click('📋 复制回执码');
  assert.equal(panel.copied.at(-1), 'NNK1.receipt');
});
await test('Explicit private state clears an earlier public code cache across subsequent incomplete snapshots', async () => {
  const panel = await mount(status({ phase: 'room_open', roomCode: 'ABC234', lobbyOpen: true, roomCodeAvailable: true }, 'host'));
  assert.match(panel.text(), /ABC234/);
  await panel.update(status({ phase: 'room_open', roomCode: 'INNER4', lobbyOpen: true, roomCodeAvailable: false }, 'host'));
  assert.equal(panel.text().includes('ABC234'), false);
  assert.equal(panel.text().includes('INNER4'), false);
  await panel.update(status({ phase: 'room_open', lobbyOpen: true }, 'host'));
  assert.equal(panel.text().includes('ABC234'), false);
});
await test('Public rooms and older kernels still display/copy published codes and generate extra invites', async () => {
  for (const available of [true, undefined]) {
    const state = { phase: 'mqtt_waiting', roomCode: 'ABC234', lobbyOpen: true };
    if (available !== undefined) state.roomCodeAvailable = available;
    const panel = await mount(status(state, 'host', true, [members('identity')]));
    await panel.openRoom();
    await panel.click('📋 复制');
    assert.equal(panel.copied.at(-1), 'ABC234');
    await panel.click('📨 生成邀请码');
    assert.equal(panel.commands.at(-1).action, 'invite_refresh');
  }
});
await test('An original-connection completed room remains reachable for both roles after public closure', async () => {
  for (const role of ['host', 'guest']) {
    const panel = await mount(status({ phase: 'plugin-room', lobbyOpen: false, roomCode: null, roomCodeAvailable: false, continuation: { room: { complete: true } } }, role, true, [members('single')]));
    await panel.openRoom();
    assert.match(panel.text(), /原连接房间/);
    assert.equal(panel.button('📋 复制'), undefined);
    assert.ok(panel.button(role === 'host' ? '🗑 解散房间' : '🚪 退出房间'));
  }
});
await test('Offline and in-progress host/guest states disable both fresh creation paths', async () => {
  const cases = [status({}, '', false), status({ phase: 'host_booting' }, 'host'), status({ phase: 'waiting_host' }, 'guest'), status({ phase: 'loading', round: { phase: 'loading' } }, 'host')];
  for (const value of cases) {
    const panel = await mount(value);
    assert.equal(panel.button('邀请码建房')?.props.disabled, true);
    assert.equal(Boolean(panel.button('🏛 创建 P2P 房间')?.props.disabled), true);
    await panel.click('邀请码建房');
    assert.equal(panel.commands.length, 0);
  }
});
await test('Private lobby controls cannot bypass an active round load restriction', async () => {
  const panel = await mount(status({ phase: 'playing', lobbyOpen: true, roomCodeAvailable: false, roomCode: 'INNER5', round: { phase: 'playing' } }, 'host', true, [members('single')]));
  await panel.openRoom();
  assert.equal(Boolean(panel.button('🚀 载入到游戏(按所选模式)')?.props.disabled), true);
  assert.equal(panel.button('启用房号')?.props.disabled, true);
});
await test('Public-number activation respects the retained round guard and failed-round exception', async () => {
  for (const failed of [false, true]) {
    const panel = await mount(status({ phase: failed ? 'failed' : 'plugin-room', lobbyOpen: true, roomCodeAvailable: false, roomCode: 'INNER6', round: { phase: failed ? 'failed' : 'plugin-room', failed } }, 'host', true, [members('single')]));
    const button = panel.button('启用房号');
    assert.equal(button.props.disabled, !failed);
    if (!failed) assert.match(button.props.title, /结束会话.*重新建房.*邀请码.*原连接/);
    await panel.click('启用房号');
    assert.equal(panel.commands.length, failed ? 1 : 0);
  }
});
const signalingStatus = ({ online = true, url = 'wss://old.example/mqtt', name = 'Before', events = [] } = {}) => {
  const value = status({}, '', online, events); value.bridge.cfg = { mqttUrl: url, onlineName: name }; return value;
};
const sigInput = node => node.tag === 'input' && node.props.placeholder === '默认 wss://broker.emqx.io:8084/mqtt';
const savedEvent = (requestId, value) => ({ type: 'config_applied', ts: Date.now(), data: { key: 'mqttUrl', requestId, value } });
await test('Signaling drafts survive nickname changes and unrelated saved-config snapshots', async () => {
  const panel = await mount(signalingStatus()); await panel.openSignaling();
  await panel.change(sigInput, 'wss://draft.example/mqtt');
  await panel.update(signalingStatus({ name: 'After' }));
  assert.equal(panel.all().find(sigInput).props.value, 'wss://draft.example/mqtt');
  await panel.update(signalingStatus({ name: 'After', url: 'wss://another.example/mqtt' }));
  assert.equal(panel.all().find(sigInput).props.value, 'wss://draft.example/mqtt');
  assert.match(panel.text(), /当前配置地址.*another\.example/);
});
await test('HTTP queue success, cfg echoes and old events never substitute for this save acknowledgement', async () => {
  const panel = await mount(signalingStatus()); await panel.openSignaling();
  await panel.change(sigInput, 'wss://new.example/mqtt'); await panel.click('💾 保存信令地址');
  const request = panel.commands.at(-1).args;
  assert.equal(request.key, 'mqttUrl'); assert.equal(request.value, 'wss://new.example/mqtt');
  assert.ok(request.requestId.length <= 160 && !/[\x00-\x1f\x7f]/.test(request.requestId));
  assert.match(panel.text(), /等待内核确认/); assert.equal(panel.text().includes('信令地址已保存'), false);
  await panel.update(signalingStatus({ url: request.value, events: [savedEvent('old-request', request.value), { type: 'config_applied', data: { requestId: request.requestId, key: 'transferLimitMB', value: 300 } }] }));
  assert.equal(panel.text().includes('信令地址已保存'), false);
  await panel.update(signalingStatus({ url: request.value, events: [savedEvent(request.requestId, request.value)] }));
  assert.match(panel.text(), /信令地址已保存/);
  assert.match(panel.text(), /现有连接保持/);
});
await test('HTTP persistence failure is visible near signaling controls and retains the draft', async () => {
  const panel = await mount(signalingStatus()); await panel.openSignaling();
  await panel.change(sigInput, 'wss://new.example/mqtt'); panel.reply({ ok: false, error: '设置文件写入失败' });
  await panel.click('💾 保存信令地址');
  assert.equal(panel.all().find(sigInput).props.value, 'wss://new.example/mqtt');
  assert.match(panel.text(), /信令地址保存失败：设置文件写入失败/);
  assert.equal(panel.text().includes('信令地址已保存'), false);
  assert.equal(panel.button('💾 保存信令地址').props.disabled, false);
});
await test('A failed native save may echo its new in-memory URL without being labeled persisted', async () => {
  const panel = await mount(signalingStatus()); await panel.openSignaling();
  const url = 'wss://memory-only.example/mqtt';
  await panel.change(sigInput, url); await panel.click('💾 保存信令地址');
  const requestId = panel.commands.at(-1).args.requestId;
  await panel.update(signalingStatus({ url, events: [{ type: 'error', data: { cmd: 'set_config', key: 'mqttUrl', requestId, message: '持久化失败，内存已更新' } }] }));
  assert.equal(panel.text().includes('已保存地址'), false);
  assert.match(panel.text(), /当前配置地址:.*memory-only\.example/);
  assert.match(panel.text(), /信令地址保存失败：持久化失败，内存已更新/);
  assert.equal(panel.all().find(sigInput).props.value, url);
});
await test('Matching backend failure and bounded unconfirmed state allow retry without accepting stale success', async () => {
  const panel = await mount(signalingStatus()); await panel.openSignaling();
  await panel.change(sigInput, 'wss://new.example/mqtt'); await panel.click('💾 保存信令地址');
  const first = panel.commands.at(-1).args.requestId;
  await panel.update(signalingStatus({ events: [{ type: 'error', data: { cmd: 'set_config', key: 'mqttUrl', requestId: first, message: '游戏配置写入失败' } }] }));
  assert.match(panel.text(), /信令地址保存失败：游戏配置写入失败/);
  await panel.click('💾 保存信令地址'); const second = panel.commands.at(-1).args.requestId; assert.notEqual(second, first);
  await panel.advance(20001);
  assert.match(panel.text(), /尚未收到本次保存确认/);
  assert.equal(panel.all().find(sigInput).props.value, 'wss://new.example/mqtt');
  await panel.click('💾 保存信令地址'); const third = panel.commands.at(-1).args.requestId; assert.notEqual(third, second);
  await panel.update(signalingStatus({ events: [savedEvent(first, 'wss://new.example/mqtt'), savedEvent(second, 'wss://new.example/mqtt')] }));
  assert.equal(panel.text().includes('信令地址已保存'), false);
  await panel.update(signalingStatus({ url: 'wss://new.example/mqtt', events: [savedEvent(third, 'wss://new.example/mqtt')] }));
  assert.match(panel.text(), /信令地址已保存/);
});
await test('Offline saves explicitly wait for the kernel instead of reporting persistence', async () => {
  const panel = await mount(signalingStatus({ online: false })); await panel.openSignaling();
  await panel.change(sigInput, 'wss://new.example/mqtt'); await panel.click('💾 保存信令地址');
  assert.match(panel.text(), /已入队，等待内核上线确认；尚未确认保存/);
  assert.equal(panel.text().includes('信令地址已保存'), false);
});
await test('Reset-to-default waits for its matching acknowledgement with the actual normalized default', async () => {
  const panel = await mount(signalingStatus()); await panel.openSignaling();
  await panel.click('↩️ 恢复默认'); const request = panel.commands.at(-1).args;
  assert.equal(request.value, ''); assert.equal(panel.text().includes('已恢复默认信令地址'), false);
  const actual = 'wss://broker.emqx.io:8084/mqtt';
  await panel.update(signalingStatus({ url: actual, events: [savedEvent(request.requestId, actual)] }));
  assert.match(panel.text(), /已恢复默认信令地址/); assert.match(panel.text(), /当前配置地址.*broker\.emqx\.io/);
});
await test('A later typed draft survives acknowledgement of an earlier submitted value', async () => {
  const panel = await mount(signalingStatus()); await panel.openSignaling();
  await panel.change(sigInput, 'wss://first.example/mqtt'); await panel.click('💾 保存信令地址');
  const request = panel.commands.at(-1).args.requestId;
  await panel.change(sigInput, 'wss://second.example/mqtt');
  await panel.update(signalingStatus({ url: 'wss://first.example/mqtt', events: [savedEvent(request, 'wss://first.example/mqtt')] }));
  assert.equal(panel.all().find(sigInput).props.value, 'wss://second.example/mqtt');
  assert.match(panel.text(), /当前配置地址.*first\.example/);
  assert.match(panel.text(), /当前输入有未保存修改/);
});
await test('A fresh mount with the same React useId cannot accept a previous mount save acknowledgement', async () => {
  const first = await mount(signalingStatus()); await first.openSignaling();
  await first.change(sigInput, 'wss://new.example/mqtt'); await first.click('💾 保存信令地址');
  const oldRequest = first.commands.at(-1).args.requestId;
  const second = await mount(signalingStatus({ events: [savedEvent(oldRequest, 'wss://new.example/mqtt')] }));
  await second.openSignaling(); await second.change(sigInput, 'wss://new.example/mqtt'); await second.click('💾 保存信令地址');
  const newRequest = second.commands.at(-1).args.requestId;
  assert.equal(second.text().includes('信令地址已保存'), false, 'Historical acknowledgement must not confirm the first save after refresh');
  assert.notEqual(newRequest, oldRequest, 'Identical React useId and sequence after remount need a distinct request namespace');
  await second.update(signalingStatus({ url: 'wss://new.example/mqtt', events: [savedEvent(newRequest, 'wss://new.example/mqtt')] }));
  assert.match(second.text(), /信令地址已保存/);
});
console.log(JSON.stringify({ passed, failed, scope: 'actual extracted OnlinePanel render and click fixtures only' }));
if (failed) process.exitCode = 1;
