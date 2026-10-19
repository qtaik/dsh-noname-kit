// Render the production online panel with controlled responses; no running DSH or game is changed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const online = source.slice(source.indexOf('    var ONLINE_MODES ='), source.indexOf('    function WorkshopView('));
const makePanel = new Function('React', 'h', 'e', 'fetch', 'location', 'navigator', 'ModalFrame', online + ';return OnlinePanel;');
const h = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity) });
const e = (tag, className, ...children) => h(tag, { className }, ...children);
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : [];
const text = tree => tree && typeof tree === 'object' ? tree.children.map(text).join('') : String(tree ?? '');
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function snapshot({ kernel = {}, bridge = {}, recovery = 'none' } = {}) {
  return {
    active: true,
    kernel: { state: 'ok', boundApi: 'http://127.0.0.1:45678', tokenMatches: true, bridgeConfig: 'ok', ...kernel },
    bridge: { online: false, cfg: { transferLimitMB: 300 }, events: [], state: { phase: 'idle' }, ...bridge },
    batchRecovery: { status: recovery }
  };
}

function mount(initial = snapshot(), responses = [], page = { port: '45678', protocol: 'http:' }) {
  const values = [initial], refs = [], calls = [], effects = [], notes = [], states = [];
  let stateIndex = 0, refIndex = 0, dirty = false;
  const React = {
    useId: () => 'online-test',
    useState(value) {
      const index = stateIndex++;
      if (!(index in values)) values[index] = value;
      return [values[index], next => {
        const resolved = typeof next === 'function' ? next(values[index]) : next;
        if (index === 0) states.push(resolved);
        if (typeof resolved === 'string' && /绑定|状态刷新/.test(resolved)) notes.push(resolved);
        if (!Object.is(values[index], resolved)) dirty = true;
        values[index] = resolved;
      }];
    },
    useEffect(effect, dependencies) { if (!dependencies) effects.push(effect); }
  };
  // Ref indices advance even when an existing ref is reused.
  React.useRef = value => {
    const index = refIndex++;
    if (!refs[index]) refs[index] = { current: value };
    return refs[index];
  };
  const fetch = (url, options) => {
    calls.push({ url, options });
    const result = responses.shift();
    if (result instanceof Error) return Promise.reject(result);
    if (typeof result === 'function') return result(url, options);
    return Promise.resolve(result ?? reply({ ok: false, error: 'No controlled response' }, 503));
  };
  const Panel = makePanel(React, h, e, fetch, page, {}, function ModalFrame() {});
  let tree;
  function render() {
    for (let count = 0; count < 8; count++) {
      dirty = false; stateIndex = 0; refIndex = 0; effects.length = 0;
      tree = Panel();
      for (const effect of effects) effect();
      if (!dirty) break;
    }
    assert.doesNotMatch(text(tree), /联机页渲染出错/);
    return tree;
  }
  render();
  return {
    render, calls, notes, states, values,
    tree: () => tree,
    all: () => nodes(tree),
    button: label => nodes(tree).find(node => node.tag === 'button' && text(node) === label),
    update: next => { values[0] = next; render(); }
  };
}

let count = 0;
async function test(name, body) { await body(); count++; console.log('  ✓ ' + name); }

await test('a foreign binding is diagnosed before the generic enable-extension advice', () => {
  const panel = mount(snapshot({ kernel: { boundApi: 'http://127.0.0.1:54258', tokenMatches: false } }));
  assert.match(text(panel.tree()), /当前绑定到另一个 DSH（端口 54258），本页端口为 45678/);
  assert.match(text(panel.tree()), /点「绑定到此 DSH」切回本页/);
  assert.doesNotMatch(text(panel.tree()), /一直离线:|自动在线|点「升级内核」并重启游戏即切回/);
  assert.equal(panel.button('绑定到此 DSH').props.disabled, false);
});
await test('localhost and 127.0.0.1 with the same port do not appear as another DSH', () => {
  const panel = mount();
  assert.doesNotMatch(text(panel.tree()), /另一个 DSH|连接凭据与当前 DSH 不一致/);
  assert.match(text(panel.tree()), /若无名杀已打开，请确认/);
});
await test('same-port token mismatch has its own actionable diagnosis', () => {
  const panel = mount(snapshot({ kernel: { tokenMatches: false } }));
  assert.match(text(panel.tree()), /连接凭据与当前 DSH 不一致/);
  assert.doesNotMatch(text(panel.tree()), /若无名杀已打开，请确认/);
});
await test('missing and unreadable bridge configurations prompt the separate binding action', () => {
  for (const kernel of [{ bridgeConfig: 'missing', boundApi: null }, { boundApi: 'invalid' }, { bridgeConfig: 'invalid', tokenMatches: null }]) {
    const panel = mount(snapshot({ kernel }));
    assert.match(text(panel.tree()), /桥配置缺失或无法读取/);
    assert.equal(panel.button('绑定到此 DSH').props.disabled, false);
  }
});
await test('binding is a same-origin JSON request followed by an actual status refresh', async () => {
  const refreshed = snapshot({ kernel: { tokenMatches: true }, bridge: { online: false } });
  const panel = mount(snapshot({ kernel: { tokenMatches: false } }), [reply({ ok: true, bridgeBinding: { baseUrl: 'http://127.0.0.1:45678', changed: true } }), reply(refreshed)]);
  await panel.button('绑定到此 DSH').props.onClick();
  assert.deepEqual(panel.calls.map(call => call.url), ['/noname-kit-api/online/bridge/bind', '/noname-kit-api/online/status']);
  assert.equal(panel.calls[0].options.method, 'POST');
  assert.equal(panel.calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(panel.calls[0].options.body), {});
  assert.deepEqual(panel.states, [refreshed]);
  assert.equal(panel.values[0].bridge.online, false);
  assert.match(panel.notes.join('\n'), /绑定已保存，等待内核重新连接；已运行的旧内核需完全退出并重启无名杀/);
  assert.doesNotMatch(panel.calls.map(call => call.url).join(''), /kernel\/install/);
});
await test('rapid repeated binding clicks make only one write while the first is pending', async () => {
  let complete;
  const panel = mount(snapshot(), [() => new Promise(resolve => { complete = resolve; }), reply(snapshot())]);
  const button = panel.button('绑定到此 DSH'), first = button.props.onClick();
  button.props.onClick();
  assert.equal(panel.calls.length, 1);
  panel.render();
  assert.equal(panel.button('绑定到此 DSH').props.disabled, true);
  complete(reply({ ok: true }));
  await first;
  panel.render();
  assert.equal(panel.button('绑定到此 DSH').props.disabled, false);
});
for (const response of [reply({ ok: false, error: '绑定被拒绝' }, 409), reply({ ok: true }, 500), new Error('network down')]) {
  await test('a failed binding cannot show a saved binding or fabricate online status', async () => {
    const panel = mount(snapshot(), [response]);
    await panel.button('绑定到此 DSH').props.onClick();
    assert.equal(panel.calls.length, 1);
    assert.equal(panel.states.length, 0);
    assert.equal(panel.values[0].bridge.online, false);
    assert.match(panel.notes.join('\n'), /绑定失败/);
    assert.doesNotMatch(panel.notes.join('\n'), /绑定已保存/);
    panel.render();
    assert.equal(panel.button('绑定到此 DSH').props.disabled, false);
  });
}
await test('a status-refresh failure retains the saved-binding acknowledgement without going online', async () => {
  const panel = mount(snapshot(), [reply({ ok: true }), new Error('status unavailable')]);
  await panel.button('绑定到此 DSH').props.onClick();
  assert.match(panel.notes.at(-1), /绑定已保存.*状态刷新失败/);
  assert.equal(panel.states.length, 0);
  assert.equal(panel.values[0].bridge.online, false);
});
await test('missing, unknown and batch-recovery states cannot bind', () => {
  for (const options of [{ kernel: { state: 'missing' } }, { kernel: { state: 'unknown' } }, { recovery: 'required' }]) {
    const panel = mount(snapshot(options));
    const button = panel.button('绑定到此 DSH');
    assert.ok(button);
    assert.equal(button.props.disabled, true);
    if (button.props.onClick) button.props.onClick();
    assert.equal(panel.calls.length, 0);
  }
});
await test('an uninstalled kernel prompts installation before its disabled binding control', () => {
  const panel = mount(snapshot({ kernel: { state: 'missing', boundApi: null, bridgeConfig: 'missing' } }));
  assert.match(text(panel.tree()), /先点「安装内核」/);
  assert.doesNotMatch(text(panel.tree()), /点「绑定到此 DSH」重新保存/);
});
await test('an online kernel remains online based on the real bridge state', () => {
  const panel = mount(snapshot({ bridge: { online: true } }));
  assert.match(text(panel.tree()), /内核在线\(游戏运行中\)/);
  assert.doesNotMatch(text(panel.tree()), /桥配置缺失或无法读取|当前绑定到另一个 DSH/);
});
await test('the transfer-limit editor is under package health and unique without a room', () => {
  const panel = mount();
  const limits = panel.all().filter(node => node.props['data-nnk-transfer-limit']);
  assert.equal(limits.length, 1);
  const manifest = panel.all().find(node => node.props['data-nnk-manifest']);
  assert.ok(nodes(manifest).includes(limits[0]));
  const status = panel.all().find(node => node.props.className?.includes('nnk-online-status'));
  assert.equal(nodes(status).some(node => node.props['data-nnk-transfer-limit']), false);
});
await test('host and guest room modals share one editor and preserve unfinished input across close/reopen', () => {
  for (const role of ['host', 'guest']) {
    const panel = mount(snapshot({ bridge: { online: true, role, cfg: { transferLimitMB: 48 }, state: { phase: role === 'host' ? 'room_open' : 'connected', roomCode: 'ABC234', manifestAvailable: true } } }));
    let input = panel.all().find(node => node.tag === 'input' && node.props.id === 'online-test-transfer-limit');
    assert.equal(input.props.value, '48');
    input.props.onChange({ target: { value: '10' } });
    panel.render();
    const open = panel.all().find(node => node.tag === 'button' && text(node).includes('插件房间('));
    assert.ok(open);
    open.props.onClick(); panel.render();
    assert.equal(panel.all().filter(node => node.props['data-nnk-transfer-limit']).length, 1);
    input = panel.all().find(node => node.tag === 'input' && node.props.id === 'online-test-transfer-limit');
    assert.equal(input.props.value, '10');
    panel.button('收起(连接继续保持,可随时再打开)').props.onClick(); panel.render();
    assert.equal(panel.all().filter(node => node.props['data-nnk-transfer-limit']).length, 1);
    assert.equal(panel.all().find(node => node.tag === 'input' && node.props.id === 'online-test-transfer-limit').props.value, '10');
    assert.equal(panel.calls.length, 0);
  }
});
await test('both a new empty health card and a populated health record include exactly one limit editor', () => {
  const binding = { peerId: 'guest', request: 1, role: 'host' };
  const events = [
    { type: 'manifest_check', data: { ...binding, status: 'pending' } },
    { type: 'manifest_diff', data: { ...binding, verification: 'verified', exts: { missing: [], extra: [], disabled: [], changed: [], unverified: [], matching: ['same'] }, packs: { missing: [] }, cards: { missing: [] } } },
    { type: 'manifest_check', data: { ...binding, status: 'verified' } }
  ];
  for (const history of [[], events]) {
    const panel = mount(snapshot({ bridge: { online: true, events: history } }));
    const manifest = panel.all().find(node => node.props['data-nnk-manifest']);
    assert.equal(nodes(manifest).filter(node => node.props['data-nnk-transfer-limit']).length, 1);
  }
});
console.log('全部通过: ' + count + ' 项（生产界面与受控响应；不替代真实 DSH 验证）');
