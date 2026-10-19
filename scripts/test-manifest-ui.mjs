#!/usr/bin/env node
/** Render the actual manifest card/feed functions with controlled event history; no live DSH UI. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const support = client.slice(client.indexOf('function onlinePickEvent('), client.indexOf('    function OnlinePanel('))
const card = client.slice(client.indexOf('function renderManifestCard('), client.indexOf('      function leaveRoom('))
const factory = new Function('bridge', 'h', 'e', 'sendCmd', 'setNote', 'renderTransferLimit', support + card + ';return {card:renderManifestCard,text:onlineEventText,current:onlineManifestCheck}')
const h = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat() })
const e = (tag, className, ...children) => h(tag, { className }, ...children)
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : []
const text = tree => tree && typeof tree === 'object' ? tree.children.map(text).join('\n') : String(tree || '')

/** Project actual UI copy from kernel events without launching or modifying DSH. */
export function projectManifest(events, { online = true, hostFlow = false, state, inRoom = false } = {}) {
  const commands = [], impl = factory({ online, cfg: {}, state }, h, e, (...args) => commands.push(args), () => {}, () => null)
  const card = impl.card(events, hostFlow, inRoom)
  return { cardText: text(card), feedText: events.map(ev => impl.text(ev, online ? events : [])), current: impl.current(events), card, commands }
}

const binding = (peerId = 'guest-a', request = 1, role = 'guest') => ({ peerId, request, role })
const check = (b, status, reason = '') => ({ type: 'manifest_check', data: { ...b, status, reason, identity: { name: b.peerId } } })
const result = (b, fields = {}) => ({ type: 'manifest_diff', data: { ...b, verification: 'verified', exts: { missing: [], extra: [], disabled: [], changed: [], unverified: [], matching: ['same'], ...fields }, packs: { missing: [] }, guestIdentity: { name: b.peerId }, hostIdentity: { name: b.peerId } } })
const verified = (b, fields = {}) => [check(b, 'pending'), result(b, fields), check(b, 'verified')]
const success = /已体检的启用扩展内容一致|本次已核验的启用扩展内容一致|双方扩展一致/
const unverified = events => {
  const p = projectManifest(events)
  assert.match(p.cardText, /本次尚未核验/)
  assert.doesNotMatch(p.cardText + p.feedText.join('\n'), success)
  return p
}

export function runManifestUiTests() {
  let passed = 0
  const test = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name) }
  const a = binding(), b = binding('guest-b'), second = binding('guest-a', 2)
  test('no current check displays exact unverified state and permits recheck', () => {
    const p = unverified([]), button = nodes(p.card).find(n => n.tag === 'button' && text(n) === '重新体检')
    button.props.onClick(); assert.deepEqual(p.commands, [['manifest_recheck', {}]])
  })
  test('first correlated matching result displays verified content equality', () => {
    const p = projectManifest(verified(a)); assert.match(p.cardText, success); assert.match(p.feedText.join('\n'), /本次已核验的启用扩展内容一致/)
  })
  test('host can start a read-only recheck before a result exists', () => {
    const p = projectManifest([], { hostFlow: true }), button = nodes(p.card).find(n => n.tag === 'button' && text(n) === '重新体检')
    assert.ok(button); assert.equal(!!button.props.disabled, false); button.props.onClick(); assert.deepEqual(p.commands, [['manifest_recheck', {}]])
  })
  test('unavailable pre-load health reports its reason and disables a false action', () => {
    const p = projectManifest([], { state: { manifestAvailable: false, manifestUnavailableReason: '需要双方先连接插件房间' } })
    assert.match(p.cardText, /需要双方先连接插件房间/)
    assert.equal(nodes(p.card).find(n => n.tag === 'button' && text(n) === '重新体检').props.disabled, true); assert.equal(p.commands.length, 0)
  })
  test('offline and pending checks cannot enqueue duplicate rechecks', () => {
    const offline = projectManifest([], { online: false }), pending = projectManifest([check(a, 'pending')])
    assert.equal(nodes(offline.card).find(n => n.tag === 'button' && text(n) === '重新体检').props.disabled, true)
    assert.equal(nodes(pending.card).find(n => n.tag === 'button' && text(n) === '正在体检…').props.disabled, true)
    const complete = projectManifest(verified(a)); assert.equal(!!nodes(complete.card).find(n => n.tag === 'button' && text(n) === '重新体检').props.disabled, false)
  })
  test('current carrier health is readable in a plugin room after the engine has retired', () => {
    const events = verified(a).map(ev => ({ ...ev, data: { ...ev.data, scope: { carrierSessionId: 'carrier-new' } } }))
    const p = projectManifest(events, { state: { manifestScope: { carrierSessionId: 'carrier-new' }, round: { partySessionId: 'old-session', roundId: 'old-round' } } })
    assert.match(p.cardText, success)
    const old = projectManifest(events, { state: { manifestScope: { carrierSessionId: 'carrier-next' } } }); assert.doesNotMatch(old.cardText, success)
  })
  test('an absent current-scope reply cannot reuse a previous carrier success', () => {
    const events = verified(a).map(ev => ({ ...ev, data: { ...ev.data, scope: { carrierSessionId: 'carrier-old' } } }))
    const p = projectManifest(events, { state: { manifestScope: { carrierSessionId: 'carrier-new' } } }); assert.match(p.cardText, /尚未核验/); assert.doesNotMatch(p.cardText, success)
  })
  test('party epoch blocks old success within the same carrier', () => {
    const events = verified(a).map(ev => ({ ...ev, data: { ...ev.data, scope: { carrierSessionId: 'same-carrier', partyEpoch: 1 } } }))
    const p = projectManifest(events, { state: { manifestScope: { carrierSessionId: 'same-carrier', partyEpoch: 2 } } }); assert.doesNotMatch(p.cardText, success)
  })
  test('pre-load source remains a configuration snapshot and failed empty inventories stay unverified', () => {
    const events = verified(a); events[1].data.inventoryVerified = false
    const p = projectManifest(events, { state: { manifestInventorySource: '启用清单为最近游戏配置快照，文件指纹实时读取。' } })
    assert.match(p.cardText, /配置快照/); assert.match(p.cardText, /指纹实时读取/); assert.doesNotMatch(p.cardText + p.feedText.join('\n'), success)
  })
  test('legacy raw matching is only reference and never current success', () => {
    const raw = result(a); delete raw.data.peerId; delete raw.data.request; delete raw.data.verification
    const p = unverified([raw]); assert.match(p.cardText, /历史或参考记录/)
  })
  test('legacy raw missing remains labeled reference without a success claim', () => {
    const p = unverified([{ type: 'manifest_diff', data: { exts: { missing: ['old-missing'] }, packs: { missing: [] } } }])
    assert.match(p.cardText, /参考记录中缺以下扩展/); assert.match(p.cardText, /old-missing/)
  })
  test('new pending request immediately hides previous matching conclusion', () => { unverified([...verified(a), check(second, 'pending')]) })
  for (const reason of ['legacy-ambiguous', 'timeout', 'cancelled', 'disconnected']) test(reason + ' cannot reuse previous successful card or feed', () => {
    unverified([...verified(a), check(second, 'pending'), check(second, reason === 'cancelled' || reason === 'disconnected' ? 'closed' : 'unverified', reason)])
  })
  test('current diff is not verified until the corresponding completion event arrives', () => { unverified([check(a, 'pending'), result(a)]) })
  test('older request result cannot complete current request on the same peer', () => { unverified([...verified(a), check(second, 'pending'), result(a), check(a, 'verified')]) })
  test('older peer late matching cannot displace newer peer pending', () => {
    const p = unverified([check(a, 'pending'), check(b, 'pending'), result(a), check(a, 'verified')]); assert.equal(p.current.check.peerId, b.peerId)
  })
  test('newer peer missing result remains selected after older peer matching finishes', () => {
    const p = projectManifest([check(a, 'pending'), ...verified(b, { missing: ['b-missing'], matching: [] }), result(a), check(a, 'verified')])
    assert.match(p.cardText, /b-missing/); assert.doesNotMatch(p.cardText + p.feedText.join('\n'), success); assert.equal(p.current.check.peerId, b.peerId)
  })
  test('newer peer matching stays selected after older peer missing arrives', () => {
    const p = projectManifest([check(a, 'pending'), ...verified(b), result(a, { missing: ['a-missing'] }), check(a, 'verified')])
    assert.match(p.cardText, success); assert.doesNotMatch(p.cardText, /a-missing/); assert.equal(p.current.check.peerId, b.peerId)
  })
  test('current close suppresses prior matching and ignores a late verified update', () => { unverified([...verified(a), check(a, 'closed', 'disconnected'), result(a), check(a, 'verified')]) })
  test('reconnect with reused request number cannot consume the old socket identity', () => {
    const fresh = binding('new-document-guest-a'); unverified([...verified(a), check(a, 'closed'), check(fresh, 'pending'), result(a), check(a, 'verified')])
  })
  test('numbered result after ambiguous legacy reply can verify its own current request', () => {
    const p = projectManifest([...verified(a), check(second, 'pending'), check(second, 'unverified', 'legacy-ambiguous'), result(second, { missing: ['new-missing'], matching: [] }), check(second, 'verified')])
    assert.match(p.cardText, /new-missing/); assert.doesNotMatch(p.cardText + p.feedText.join('\n'), success)
  })
  for (const [field, label] of [['changed', '内容不同'], ['disabled', '尚未启用'], ['unverified', '本次尚未核验']]) test(field + ' never produces feed equality', () => {
    const p = projectManifest(verified(a, { [field]: ['different'], matching: [] })); assert.doesNotMatch(p.cardText + p.feedText.join('\n'), success); assert.match(p.feedText.join('\n'), new RegExp(label))
  })
  test('current disabled package keeps enable and restart guidance without file action', () => {
    const p = projectManifest(verified(a, { disabled: ['disabled'], matching: [] })); assert.match(p.cardText, /自行启用并重启/); assert.match(p.cardText, /无需下载/)
    assert.equal(nodes(p.card).some(n => n.tag === 'button' && /补传/.test(text(n))), false); assert.equal(p.commands.length, 0)
  })
  test('missing character package cannot produce extension consistency card', () => {
    const events = verified(a); events[1].data.packs.missing = ['pack']; const p = projectManifest(events); assert.match(p.cardText, /pack/); assert.doesNotMatch(p.cardText + p.feedText.join('\n'), success)
  })
  test('missing card packages remain visible and cannot produce a content equality claim', () => {
    const events = verified(a); events[1].data.cards = { missing: ['card-pack'] }; const p = projectManifest(events)
    assert.match(p.cardText, /缺少的卡牌包.*card-pack/); assert.doesNotMatch(p.cardText + p.feedText.join('\n'), success)
  })
  test('offline kernel cannot show a retained matching result as current success', () => {
    const p = projectManifest(verified(a), { online: false }); assert.match(p.cardText, /本次尚未核验/); assert.doesNotMatch(p.cardText + p.feedText.join('\n'), success)
  })
  test('host result uses the same task binding and stays tied to the matching guest identity', () => {
    const p = projectManifest(verified(binding('host-view-guest', 3, 'host')), { hostFlow: true }); assert.match(p.cardText, /客人.*host-view-guest/); assert.match(p.cardText, success)
  })
  test('missing start or verification metadata cannot turn retained result into current success', () => {
    unverified([result(a), check(a, 'verified')]); const events = verified(a); delete events[1].data.verification; unverified(events)
  })
  console.log(`全部通过: ${passed} 项`)
  return passed
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runManifestUiTests()
