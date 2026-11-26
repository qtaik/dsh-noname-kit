#!/usr/bin/env node
/** Mechanism task state, real catalog-backed HTTP branches and file validation. */
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import assert from 'node:assert/strict'
import testPaths from './fixtures/test-paths.cjs'
const home = testPaths.assertTestPath(mkdtempSync(testPaths.tempPrefix('mechanic-tasks-')))
const nonameDir = join(home, 'fake-game')
const tasks = await import(testPaths.sourceUrl('src/tasks.js'))
let passed = 0
function ok(value, label) { assert.ok(value, label); passed++; console.log('  ✓ ' + label) }
try {
  // Mechanisms are independent tasks; their single review node never invents media needs.
  {
    const base = { folder: '机制包', type: 'mechanic', title: '连势', mechanic: { id: 'combo', kind: 'skill-type', description: '连续行动规则', rules: '连续使用同类牌时增加效果' } }
    const made = await tasks.createTask(home, { ...base, id: '机制-新建', mechanic: { ...base.mechanic, invocation: '出牌前' }, skills: [{ name: '不能覆盖', audios: ['bad.mp3'] }], image: 'bad.png', dieAudios: ['bad.mp3'] })
    assert.equal(made.task.type, 'mechanic')
    assert.deepEqual(made.task.skills.map(node => node.name), ['连势'])
    assert.deepEqual(made.task.skills[0].audios, [])
    assert.deepEqual(made.task.dieAudios, [])
    assert.equal(made.task.image, '')
    assert.equal(made.task.mechanic.rules, base.mechanic.rules)
    assert.equal((await tasks.getTask(home, '机制-新建')).mechanic.invocation, '出牌前')
    ok(made.ok && !made.task.dynamicSkills, '机制任务由服务端构造单节点并持久化需求，无素材要求')
    const completed = await tasks.setSkillStatus(home, { taskId: '机制-新建', skill: '连势', status: 'confirmed' })
    ok(completed.autoCompleted && completed.task.status === 'done', '机制节点确认即自动完成，无图无配音不阻塞')
    const second = await tasks.createTask(home, { ...base, id: '机制-另一任务' })
    ok(second.ok && (await tasks.getTask(home, '机制-新建')).status === 'done', '同一机制可有独立历史任务，不覆盖已完成记录')
    const edited = await tasks.createTask(home, { ...base, id: '机制-编辑', target: { kind: 'mechanic', id: 'combo' }, mechanic: { ...base.mechanic, kind: 'global-rule' } })
    assert.deepEqual(edited.task.target, { kind: 'mechanic', id: 'combo' })
    ok(edited.ok && edited.task.mechanic.activation === '', '机制编辑可沿用已有生效范围，包内类型一致性另由接口校验')
    let invalidNo = 0
    const invalidCases = [
      { mechanic: { ...base.mechanic, id: 'Not_lower' } },
      { mechanic: { ...base.mechanic, kind: 'unknown' } },
      { mechanic: { ...base.mechanic, description: '' } },
      { mechanic: { ...base.mechanic, rules: ' ' } },
      { mechanic: { ...base.mechanic, description: '字'.repeat(1201) } },
      { mechanic: { ...base.mechanic, rules: '字'.repeat(5001) } },
      { mechanic: { ...base.mechanic, parameters: '字'.repeat(2001) } },
      { mechanic: { ...base.mechanic, scope: {} } },
      { mechanic: { ...base.mechanic, kind: 'shared-rule' } },
      { mechanic: { ...base.mechanic, kind: 'global-rule', activation: '开始时' } },
      { title: '字'.repeat(61) },
      { title: '' },
      { target: { kind: 'mechanic', id: 'other' } },
      { target: { kind: 'character', id: 'combo' } },
    ]
    const countBefore = (await tasks.listTasks(home)).length
    for (const change of invalidCases) assert.equal((await tasks.createTask(home, { ...base, ...change, id: '机制-非法-' + (++invalidNo) })).ok, false)
    ok((await tasks.listTasks(home)).length === countBefore, '非法机制 ID/类型/必填/长度/目标全部拒绝，登记处无残留')
    const shared = await tasks.createTask(home, { ...base, id: '机制-共用', mechanic: { ...base.mechanic, kind: 'shared-rule', invocation: '主动调用' } })
    const global = await tasks.createTask(home, { ...base, id: '机制-全局', mechanic: { ...base.mechanic, kind: 'global-rule', invocation: '每轮开始', activation: '游戏开始', scope: '所有角色' } })
    assert.equal((await tasks.getTask(home, '机制-全局')).mechanic.invocation, '每轮开始')
    ok(shared.ok && global.ok, '共用规则和全局规则可各自登记调用时机')
    const linked = await tasks.createTask(home, { id: '武将-机制引用', folder: '机制包', type: 'character', skills: [{ name: '连击', mechanicIds: ['combo', ' combo ', 'helper'] }] })
    assert.deepEqual((await tasks.getTask(home, linked.task.id)).skills[0].mechanicIds, ['combo', 'helper'])
    for (const mechanicIds of ['combo', ['Bad'], [42], null]) assert.equal((await tasks.createTask(home, { id: '引用-非法', folder: '机制包', skills: [{ name: '连击', mechanicIds }] })).ok, false)
    ok(linked.ok, '武将技能机制引用去重保存，非法引用形状不落盘')
  }

  // Exercise the exact HTTP branches using real catalog discovery and a disposable registry.
  {
    const { listMechanics } = await import(testPaths.sourceUrl('src/mechanics.js'))
    const { safeFolderPath } = await import(testPaths.sourceUrl('src/write.js'))
    const { validateFileCode } = await import(testPaths.sourceUrl('src/validate.js'))
    const code = `const nnkMechanic_combo = { id: 'combo', name: '连势', kind: 'skill-type', description: '连续行动', createSkill(skill, options) { return skill } };\nconst nnkMechanic_world = { id: 'world', name: '天象', kind: 'global-rule', description: '全场规则', install() {} };`
    const packageDir = join(nonameDir, 'extension', '接口机制包')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'extension.js'), code)
    writeFileSync(join(packageDir, 'shared.js'), "export const nnkMechanic_relay = { id: 'relay', name: '接力', kind: 'shared-rule', description: '接力规则', resolve() {} };")
    const indexCode = await readFile(new URL(testPaths.sourceUrl('index.js')), 'utf8')
    const routeStart = indexCode.indexOf("        if (req.method === 'GET' && url.pathname === '/noname-kit-api/mechanics')")
    const routeEnd = indexCode.indexOf('        // 版本与一致性', routeStart)
    assert(routeStart >= 0 && routeEnd > routeStart)
    let scans = 0
    let archives = 0
    const context = {
      ...tasks, active: true, nonameDir, dshHomeDir: home, statSync, existsSync, join, safeFolderPath,
      archiveTask: async () => { archives++; return { totalTasks: archives } },
      listMechanics: async (...args) => { scans++; return listMechanics(...args) },
    }
    const handler = runInNewContext('(async function(req, url, readBody, json) {' + indexCode.slice(routeStart, routeEnd) + '})', context)
    const request = (method, url, body = {}) => handler({ method }, new URL(url, 'http://127.0.0.1'), async () => body, (status, value) => ({ status, value }))
    const base = { id: '接口-机制', folder: '接口机制包', type: 'mechanic', title: '新规则', mechanic: { id: 'fresh', kind: 'skill-type', description: '说明', rules: '具体规则' } }
    context.active = false
    assert.equal((await request('GET', '/noname-kit-api/mechanics?folder=接口机制包')).status, 503)
    const manual = { folder: '手动新包', packageMeta: {}, writeMode: 'manual' }
    for (const type of ['character', 'card', 'mode', 'mechanic']) {
      const created = await request('POST', '/noname-kit-api/tasks', { ...base, ...manual, id: '手动-' + type, type })
      assert.equal(created.status, 200, created.value.error)
      assert.equal(created.value.task.generationOnly, true)
      assert.equal(created.value.task.writeMode, 'manual')
    }
    for (const change of [
      { writeMode: 'auto', generationOnly: true },
      { packageMeta: null },
      { target: { kind: 'character', id: 'existing' } },
      { skills: [{ name: '技能', mechanicIds: ['combo'] }] },
    ]) {
      const denied = await request('POST', '/noname-kit-api/tasks', { ...manual, ...change, id: '手动-拒绝' })
      assert.equal(denied.status, 503)
      assert.equal(await tasks.getTask(home, '手动-拒绝'), null)
    }
    assert.equal(scans, 0)
    ok(true, '无目录可新建各类手动任务，自动写入、已有包和机制引用仍需目录')
    const offlineTask = (await tasks.getTask(home, '手动-mechanic'))
    const update = (action, fields = {}) => request('POST', '/noname-kit-api/tasks/' + action, { taskId: offlineTask.id, ...fields })
    const confirmed = await update('skill-status', { skill: offlineTask.skills[0].name, status: 'confirmed' })
    assert.equal(confirmed.value.autoCompleted, true)
    assert.equal(confirmed.value.archived, 0)
    assert.equal((await update('reopen')).status, 200)
    assert.equal((await update('feedback', { issue: '核对触发时机' })).status, 200)
    assert.equal((await update('complete')).value.totalTasks, 0)
    assert.equal((await update('image')).status, 503)
    assert.equal((await update('audio')).status, 503)
    assert.equal((await update('delete')).status, 200)
    assert.equal(await tasks.getTask(home, offlineTask.id), null)
    ok(archives === 0, '无目录的任务确认、重开、反馈、完成和删除仅更新登记处')
    context.active = true
    const listing = await request('GET', '/noname-kit-api/mechanics?folder=接口机制包')
    assert.equal(listing.status, 200)
    assert.equal(listing.value.mechanics.length, 3)
    assert.equal((await request('GET', '/noname-kit-api/mechanics?folder=../escape')).status, 400)
    assert.equal((await request('GET', '/noname-kit-api/mechanics?folder=不存在')).status, 400)
    ok(true, '机制列表接口复用配置与安全路径，未配置/越界/不存在如实失败')
    const beforeScans = scans
    assert.equal((await request('POST', '/noname-kit-api/tasks', { id: '接口-无引用', folder: '新包', skills: [{ name: '普通技能' }] })).status, 200)
    ok(scans === beforeScans, '普通武将无机制引用时不扫描源码')
    const linked = await request('POST', '/noname-kit-api/tasks', { id: '接口-有效引用', folder: '接口机制包', skills: [{ name: '技能', mechanicIds: ['combo', 'combo'] }] })
    assert.equal(linked.status, 200)
    assert.deepEqual(linked.value.task.skills[0].mechanicIds, ['combo'])
    const countBefore = (await tasks.listTasks(home)).length
    for (const id of ['missing', 'world']) assert.equal((await request('POST', '/noname-kit-api/tasks', { id: '接口-非法引用-' + id, folder: '接口机制包', skills: [{ name: '技能', mechanicIds: [id] }] })).status, 400)
    ok((await tasks.listTasks(home)).length === countBefore, '接口接受可用技能机制，拒绝缺失引用与全局规则且不登记任务')
    assert.equal((await request('POST', '/noname-kit-api/tasks', { ...base, mechanic: { ...base.mechanic, id: 'combo' } })).status, 400)
    assert.equal((await request('POST', '/noname-kit-api/tasks', { ...base, id: '接口-同名', title: '连势' })).status, 200)
    const goodEdit = { ...base, id: '接口-编辑', target: { kind: 'mechanic', id: 'world' }, mechanic: { ...base.mechanic, id: 'world', kind: 'global-rule' } }
    assert.equal((await request('POST', '/noname-kit-api/tasks', { ...goodEdit, mechanic: { ...goodEdit.mechanic, kind: 'skill-type' } })).status, 400)
    assert.equal((await request('POST', '/noname-kit-api/tasks', goodEdit)).status, 200)
    ok(true, '已存在包防机制 ID 重复但允许显示同名，机制编辑保留原 ID/kind并允许沿用范围')
    const editBase = (entry, suffix) => ({
      ...base, id: '接口-编辑-' + entry.id + '-' + suffix, title: ' ' + entry.name + ' ',
      target: { kind: 'mechanic', id: entry.id },
      mechanic: { id: entry.id, kind: entry.kind, description: ' ' + entry.description + ' ' },
    })
    for (const entry of listing.value.mechanics) {
      const unchanged = editBase(entry, '未改')
      const wrongKindFields = entry.kind === 'skill-type' ? { activation: '其他类别字段' } : { parameters: '其他类别字段' }
      const rejected = await request('POST', '/noname-kit-api/tasks', {
        ...unchanged, mechanic: { ...unchanged.mechanic, ...wrongKindFields, rules: ' ', invocation: ' ' },
      })
      assert.equal(rejected.status, 400)
      assert.match(rejected.value.error, /至少修改一处/)
      assert.equal(await tasks.getTask(home, unchanged.id), null)

      const timing = editBase(entry, '时机')
      const result = await request('POST', '/noname-kit-api/tasks', { ...timing, mechanic: { ...timing.mechanic, invocation: ' 新的调用时机 ' } })
      assert.equal(result.status, 200)
      const saved = await tasks.getTask(home, timing.id)
      assert.equal(saved.mechanic.invocation, '新的调用时机')
      assert.equal(saved.mechanic.rules, '')
    }
    ok(true, '三类机制可单独修改调用时机并保存，空白与不适用字段不算改动')

    const combo = listing.value.mechanics.find(entry => entry.id === 'combo')
    const world = listing.value.mechanics.find(entry => entry.id === 'world')
    const rename = editBase(combo, '改名')
    const reword = editBase(combo, '说明')
    const parameters = editBase(combo, '技能参数')
    const activation = editBase(world, '启用条件')
    const scope = editBase(world, '影响范围')
    const end = editBase(world, '结束条件')
    for (const edit of [
      { ...rename, title: '新连势' },
      { ...reword, mechanic: { ...reword.mechanic, description: '新的说明' } },
      { ...parameters, mechanic: { ...parameters.mechanic, parameters: '效果参数' } },
      { ...activation, mechanic: { ...activation.mechanic, activation: '第二轮启用' } },
      { ...scope, mechanic: { ...scope.mechanic, scope: '所有受伤的角色' } },
      { ...end, mechanic: { ...end.mechanic, end: '第四轮结束' } },
    ]) {
      const result = await request('POST', '/noname-kit-api/tasks', edit)
      assert.equal(result.status, 200)
      assert.equal(result.value.task.mechanic.rules, '')
    }
    ok(true, '名称、说明和该类机制的专属字段均可单独提交改动')

    const freshPackage = { ...base, id: '接口-新包同名', packageMeta: { author: '作者' } }
    const existingPackage = await request('POST', '/noname-kit-api/tasks', freshPackage)
    assert.equal(existingPackage.status, 400)
    assert.match(existingPackage.value.error, /编辑已有扩展包/)
    assert.equal(await tasks.getTask(home, freshPackage.id), null)
    assert.equal((await request('POST', '/noname-kit-api/tasks', { ...base, id: '接口-已有包新增' })).status, 200)
    const emptyPackage = join(nonameDir, 'extension', '预建目录')
    mkdirSync(emptyPackage, { recursive: true })
    writeFileSync(join(emptyPackage, 'rules.js'), '// Existing support module only')
    assert.equal((await request('POST', '/noname-kit-api/tasks', { ...freshPackage, id: '接口-支持模块目录', folder: '预建目录' })).status, 200)
    assert.equal((await request('POST', '/noname-kit-api/tasks', { ...freshPackage, id: '接口-新包机制', folder: '全新机制包' })).status, 200)
    ok(true, '新建机制包拒绝已存在的入口，允许向已有包添加机制和使用未注册的包目录')
    const missingRules = await request('POST', '/noname-kit-api/tasks', { ...base, id: '接口-新建缺规则', mechanic: { ...base.mechanic, rules: '' } })
    assert.equal(missingRules.status, 400)
    assert.match(missingRules.value.error, /rules/)
    ok(true, '新建机制仍必须填写判定与结算')
    const valid = validateFileCode({ file: 'rules.js', code })
    const invalid = validateFileCode({ file: 'rules.js', code: code.replace("kind: 'skill-type'", "kind: 'invalid'") })
    const malformed = validateFileCode({ file: 'rules.js', code: 'const nnkMechanic_bad = {' })
    assert(valid.ok)
    assert(!invalid.ok && invalid.errors.some(error => /kind/.test(error.message)))
    assert(!malformed.ok && malformed.errors.length === 1 && /语法/.test(malformed.errors[0].message))
    assert(validateFileCode({ file: 'ordinary.js', code: 'export const note = "nnkMechanic_ is only text"' }).ok)
    ok(true, '写入校验静态检查机制结构，语法失败优先，普通文本不误报')
    const entryCode = code + "\nexport default { name: '接口机制包', content() {} };"
    assert(validateFileCode({ file: 'extension.js', code: entryCode, folder: '接口机制包', style: 'module' }).ok)
    const wrongEntry = validateFileCode({ file: 'extension.js', code: entryCode, folder: '错误包名', style: 'module' })
    assert(!wrongEntry.ok && wrongEntry.errors.some(error => /name/.test(error.message)))
    ok(true, '入口文件先定义机制时不误认其显示名称，真实包名不一致仍拒写')
    const badFile = join(packageDir, 'bad.js')
    writeFileSync(badFile, 'const nnkMechanic_bad = {')
    const withWarning = await request('POST', '/noname-kit-api/tasks', { ...base, id: '接口-扫描不全' })
    ok(withWarning.status === 200 && withWarning.value.warnings.length > 0, '无关扫描缺口不阻断新机制任务，接口保留扫描提示')
    writeFileSync(join(packageDir, 'invalid-definition.js'), 'const nnkMechanic_taken = { id: "taken" };')
    const blocked = await request('POST', '/noname-kit-api/tasks', { ...base, id: '接口-冲突声明', mechanic: { ...base.mechanic, id: 'taken' } })
    ok(blocked.status === 400 && !(await tasks.getTask(home, '接口-冲突声明')), '明确占用候选 ID 的无效声明阻止重建，任务不落盘')
  }

  {
    const { writeExtension } = await import(testPaths.sourceUrl('src/write.js'))
    const folder = '写入机制包', packageDir = join(nonameDir, 'extension', folder)
    const definition = id => `const nnkMechanic_${id} = { id: '${id}', name: '共用规则', kind: 'shared-rule', description: '原说明', resolve(context, options) {} };`
    const first = await writeExtension(nonameDir, { folder, file: 'first.js', code: definition('one') })
    assert(first.ok && first.wrote)
    const duplicate = await writeExtension(nonameDir, { folder, file: 'second.js', code: definition('one') })
    assert(!duplicate.ok && duplicate.wrote === false && duplicate.errors.some(error => error.message.includes('one')))
    ok(!existsSync(join(packageDir, 'second.js')), '跨文件顺序写入重复机制 ID 被拒绝，首次定义保持完整')

    writeFileSync(join(packageDir, 'legacy-duplicate.js'), definition('one'))
    writeFileSync(join(packageDir, 'unreadable-syntax.js'), 'const broken = {')
    const rewrite = await writeExtension(nonameDir, { folder, file: 'first.js', edits: [{ find: "description: '原说明'", replace: "description: '更新说明'" }] })
    assert(rewrite.ok && rewrite.wrote)
    assert((await readFile(join(packageDir, 'first.js'), 'utf8')).includes('更新说明'))
    const ordinary = await writeExtension(nonameDir, { folder, file: 'ordinary.js', code: 'export const value = 1;' })
    ok(ordinary.ok && ordinary.wrote, '同文件重写和无新增机制的普通写入不被旧跨文件冲突或扫描缺口阻断')
    const unique = await writeExtension(nonameDir, { folder, file: 'unique.js', code: definition('unique') })
    ok(unique.ok && unique.wrote && unique.warnings.length > 0, '无关旧冲突与扫描缺口仅提示，新增独立 ID 可写入')

    writeFileSync(join(packageDir, 'invalid.js'), 'const nnkMechanic_reserved = { id: "reserved" };')
    const occupied = await writeExtension(nonameDir, { folder, file: 'reserved.js', code: definition('reserved') })
    ok(!occupied.ok && occupied.wrote === false && !existsSync(join(packageDir, 'reserved.js')), '其他文件无效声明占用的 ID 同样拒绝新增')
    const repair = await writeExtension(nonameDir, { folder, file: 'invalid.js', edits: [{ find: 'const nnkMechanic_reserved = { id: "reserved" };', replace: definition('reserved') }] })
    ok(repair.ok && repair.wrote, '修复当前文件坏定义时排除自身旧声明，不把修复当重复新增')

    const beforeFiles = readdirSync(packageDir).sort()
    const manualConflict = await writeExtension(nonameDir, { folder, file: 'manual-duplicate.js', code: definition('one'), writeMode: 'manual' })
    const manualUnique = await writeExtension(nonameDir, { folder, file: 'manual-unique.js', code: definition('manual_unique'), writeMode: 'manual' })
    assert(!manualConflict.ok && manualConflict.wrote === false)
    assert(manualUnique.ok && manualUnique.wrote === false && manualUnique.code === definition('manual_unique'))
    assert.deepEqual(readdirSync(packageDir).sort(), beforeFiles)
    ok(true, '手动模式执行同一冲突校验，成功或失败都不创建目标文件或备份')

    const racing = await Promise.all(['race-a.js', 'race-b.js'].map(file => writeExtension(nonameDir, { folder, file, code: definition('racing') })))
    assert.equal(racing.filter(result => result.ok && result.wrote).length, 1)
    assert.equal(racing.filter(result => !result.ok && result.wrote === false).length, 1)
    ok(['race-a.js', 'race-b.js'].filter(file => existsSync(join(packageDir, file))).length === 1, '同进程同包并发新增同 ID 经专用队列仅落盘一次')
  }

  {
    const { writeExtension } = await import(testPaths.sourceUrl('src/write.js'))
    const { hasMechanicCandidates, inspectMechanics } = await import(testPaths.sourceUrl('src/mechanics.js'))
    const { validateFileCode } = await import(testPaths.sourceUrl('src/validate.js'))
    const slash = String.fromCharCode(92)
    const prefixes = [
      'nnk' + slash + 'u004dechanic_',
      'nnk' + slash + 'u{4d}echanic_',
      [...'nnkMechanic_'].map(char => slash + 'u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join(''),
      'nnk' + slash + 'u{000000000000004d}echanic_',
    ]
    const folder = '转义机制包', packageDir = join(nonameDir, 'extension', folder)
    const definition = (id, prefix = 'nnkMechanic_') => `const ${prefix}${id} = { id: '${id}', name: '转义规则', kind: 'shared-rule', description: '说明', resolve() {} };`
    assert(!hasMechanicCandidates('export const ordinary = 1;'))
    assert(!hasMechanicCandidates('const text = "' + slash + 'u4e2d";'))
    assert((await writeExtension(nonameDir, { folder, file: 'plain.js', code: definition('occupied') })).wrote)
    for (const [i, prefix] of prefixes.entries()) {
      const code = definition('occupied', prefix)
      assert(!code.includes('nnkMechanic_') && hasMechanicCandidates(code))
      assert.equal(inspectMechanics(code).mechanics[0].id, 'occupied')
      assert(validateFileCode({ file: 'module.js', code }).ok)
      assert(validateFileCode({ file: 'extension.js', folder, code: code + `\nexport default { name: '${folder}' };`, style: 'module' }).ok)
      const invalid = code.replace("kind: 'shared-rule'", "kind: 'invalid-kind'")
      assert(!validateFileCode({ file: 'module.js', code: invalid }).ok)
      assert(!validateFileCode({ file: 'extension.js', folder, code: invalid + `\nexport default { name: '${folder}' };`, style: 'module' }).ok)
      const invalidRequest = await writeExtension(nonameDir, { folder, file: `invalid-${i}.js`, code: invalid })
      assert(!invalidRequest.ok && invalidRequest.wrote === false && !existsSync(join(packageDir, `invalid-${i}.js`)))
      const duplicate = await writeExtension(nonameDir, { folder, file: `duplicate-${i}.js`, code })
      assert(!duplicate.ok && duplicate.wrote === false && !existsSync(join(packageDir, `duplicate-${i}.js`)))
    }
    ok(true, '混合及全前缀 Unicode 转义遵守同一 AST 校验，非法类型和跨文件重复均拒写')
    assert((await writeExtension(nonameDir, { folder, file: 'escaped-owner.js', code: definition('escaped_owner', prefixes[2]) })).wrote)
    const plainDuplicate = await writeExtension(nonameDir, { folder, file: 'plain-duplicate.js', code: definition('escaped_owner') })
    assert(!plainDuplicate.ok && !existsSync(join(packageDir, 'plain-duplicate.js')))
    writeFileSync(join(packageDir, 'legacy-owner.js'), definition('escaped_owner'))
    const rewrite = await writeExtension(nonameDir, { folder, file: 'escaped-owner.js', edits: [{ find: "description: '说明'", replace: "description: '更新'" }] })
    ok(rewrite.ok && rewrite.wrote, '转义旧定义占用 ID 且可原地重写，无新增 ID 时不触发旧冲突')
    const racing = await Promise.all([
      writeExtension(nonameDir, { folder, file: 'race-plain.js', code: definition('racing_escape') }),
      writeExtension(nonameDir, { folder, file: 'race-escaped.js', code: definition('racing_escape', prefixes[0]) }),
    ])
    assert.equal(racing.filter(result => result.ok && result.wrote).length, 1)
    assert.equal(racing.filter(result => !result.ok && result.wrote === false).length, 1)
    ok(['race-plain.js', 'race-escaped.js'].filter(file => existsSync(join(packageDir, file))).length === 1, '普通与转义写法并发新增同 ID 共同进入包级队列，仅落盘一次')
  }

  console.log('\n全部通过:' + passed + ' 项')
} finally {
  testPaths.assertTestPath(home)
  rmSync(home, { recursive: true, force: true })
}
