#!/usr/bin/env node
/** Static module indexing and bounded writes against disposable, authored fixtures. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import testPaths from './fixtures/test-paths.cjs'
import * as blocks from '../src/blocks.js'
import { readExtension, listEntries, listEntrySkills, migrateAnchors, writeExtension } from '../src/write.js'

const home = testPaths.assertTestPath(await mkdtemp(testPaths.tempPrefix('module-containers-')))
const game = testPaths.assertTestPath(join(home, 'game'))
const folder = 'ModuleFixture'
const CHARACTERS = `const characters = {
  fixture_alpha: { sex: "male", group: "wei", hp: 4, skills: ["fixture_rise", "fixture_guard"] },
  fixture_beta: ["female", "wu", 3, ["fixture_guard"]],
};
export default characters;
`
const CARDS = `const cards = {
  fixture_token: { type: "basic", skill: { nested_skill: {} }, card: { nested_card: {} } },
};
export default cards;
`
const RISE = `  fixture_rise: {
    power: 1,
    chooseButton: {
      backup() {
        return {
          viewAs: { name: "sha" },
          card: {
            nature: "fire",
          },
        };
      },
    },
    content() {
      var skill = { local_skill: {} };
      const card = { local_card: {} };
      return { skill, card };
    },
  },`
const GUARD = `  fixture_guard: {
    power: 2,
    skill: { nested_skill: {} },
    card: { nested_card: {} },
    content() {},
  },`
const SKILLS = `const skills = {
${RISE}
${GUARD}
};
export default skills;
`
const TRANSLATES = `const translates = {
  fixture_alpha: "Alpha",
  fixture_beta: "Beta",
  fixture_token: "Token",
  fixture_rise: "Rise",
  fixture_rise_info: "Draw one card.",
  fixture_guard: "Guard",
  fixture_guard_info: "Keep one card.",
};
export default translates;
`
const SOURCES = {
  'extension.js': 'import "./modules/index.js";\nexport default { name: "ModuleFixture", package: {} };\n',
  'modules/index.js': 'import characters from "./characters.js";\nimport cards from "./cards.js";\nimport skills from "./skills.js";\nimport translates from "./translates.js";\nexport default { character: { ...characters }, card: { ...cards }, skill: { ...skills }, translate: { ...translates } };\n',
  'modules/characters.js': CHARACTERS,
  'modules/cards.js': CARDS,
  'modules/skills.js': SKILLS,
  'modules/translates.js': TRANSLATES,
}
const wrap = (kind, id, body) => `//#noname-kit-begin ${kind}:${id}\n${body}\n//#noname-kit-end ${kind}:${id}`
const PARTIAL = SKILLS.replace(RISE, wrap('skill', 'fixture_rise', RISE))
const FAKE = SKILLS
  .replace('          viewAs: { name: "sha" },', wrap('skill', 'viewAs', '          viewAs: { name: "sha" },'))
  .replace('            nature: "fire",', wrap('card', 'nature', '            nature: "fire",'))
const EXPECTED_KEYS = [
  'card:fixture_token', 'character:fixture_alpha', 'character:fixture_beta',
  'skill:fixture_guard', 'skill:fixture_rise', 'translate:fixture_alpha',
  'translate:fixture_beta', 'translate:fixture_guard', 'translate:fixture_rise', 'translate:fixture_token',
].sort()
const keys = code => blocks.scanBlocks(code).blocks.map(b => b.key).sort()
const effective = code => {
  assert.equal(typeof blocks.scanEffectiveAnchored, 'function', 'effective anchor scanner is exported')
  return blocks.scanEffectiveAnchored(code)
}
let serial = 0
async function fixture(skillCode = SKILLS) {
  const nonameDir = testPaths.assertTestPath(join(game, 'case-' + (++serial)))
  const base = join(nonameDir, 'extension', folder)
  await mkdir(join(base, 'modules'), { recursive: true })
  for (const [file, code] of Object.entries(SOURCES)) {
    await writeFile(join(base, file), file === 'modules/skills.js' ? skillCode : code, 'utf8')
  }
  await writeFile(join(base, 'info.json'), '{"name":"ModuleFixture","version":"1.0"}\n', 'utf8')
  return { nonameDir, base, target: join(base, 'modules/skills.js') }
}
async function unchangedSources(base, changed = new Map()) {
  for (const [file, code] of Object.entries(SOURCES)) {
    assert.equal(await readFile(join(base, file), 'utf8'), changed.get(file) ?? code, file + ' preserves its exact text')
  }
}
function rejected(result, original) {
  assert.ok(result.errors.length > 0, 'the invalid operation must report an error')
  assert.equal(result.code, original, 'rejection must preserve all original text')
}
let passed = 0
const failures = []
async function test(label, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + label) }
  catch (error) { failures.push({ label, message: error.message }); console.error('  ✗ ' + label + '\n    ' + error.message) }
}

try {
  for (const [kind, code, ids] of [
    ['character', CHARACTERS, ['fixture_alpha', 'fixture_beta']],
    ['card', CARDS, ['fixture_token']],
    ['skill', SKILLS, ['fixture_guard', 'fixture_rise']],
    ['translate', TRANSLATES, ['fixture_alpha', 'fixture_beta', 'fixture_guard', 'fixture_rise', 'fixture_token']],
  ]) {
    await test('plural default-exported ' + kind + ' container is indexed', () => {
      assert.equal(blocks.findAllSections(code, kind).length, 1)
      assert.deepEqual(blocks.scanBlocks(code).blocks.filter(b => b.kind === kind).map(b => b.id).sort(), ids)
    })
  }
  await test('singular top-level containers remain supported', () => {
    for (const kind of ['character', 'card', 'skill']) {
      const code = `const ${kind} = {\n  fixture_one: {},\n};\nexport default ${kind};\n`
      assert.deepEqual(keys(code), [kind + ':fixture_one'])
    }
    assert.deepEqual(keys('const translate = { fixture_one: "One" };\nexport default translate;\n'), ['translate:fixture_one'])
  })
  await test('legacy inline nested package containers remain supported', () => {
    const code = `game.import("extension", function () {
  return {
    package: {
      skill: {
        skill: {
          fixture_inline: {},
        },
      },
      card: {
        card: {
          fixture_card: {},
        },
      },
      character: {
        character: {
          fixture_hero: ["male", "wei", 4, []],
        },
      },
    },
  };
});`
    assert.deepEqual(keys(code), ['card:fixture_card', 'character:fixture_hero', 'skill:fixture_inline'])
  })
  await test('local variables and entry configuration are not content containers', () => {
    assert.deepEqual(keys(SKILLS), ['skill:fixture_guard', 'skill:fixture_rise'])
    assert.deepEqual(keys(CARDS), ['card:fixture_token'])
  })
  await test('strings and comments cannot introduce phantom containers', () => {
    const code = 'const text = `\nconst skills = { phantom_template: {} };\nconst skill = { phantom_singular: {} };\n`;\n'
      + '// const skills = { phantom_line: {} };\n/*\nconst cards = { phantom_block: {} };\n*/\n' + SKILLS
    assert.deepEqual(keys(code), ['skill:fixture_guard', 'skill:fixture_rise'])
  })
  await test('an empty plural card container has no card entries', () => {
    assert.deepEqual(keys('const cards = {};\nexport default cards;\n'), [])
  })
  await test('effective anchor scanning retains a genuine top-level entry', () => {
    assert.deepEqual(effective(PARTIAL).map(b => b.key), ['skill:fixture_rise'])
    assert.equal(blocks.scanAnchored(PARTIAL).length, 1, 'raw scanner remains available')
  })
  await test('partial indexing still lists genuine unanchored entries', () => {
    const result = blocks.scanBlocks(PARTIAL)
    assert.equal(result.anchored, true)
    assert.deepEqual(result.blocks.map(b => b.key).sort(), ['skill:fixture_guard', 'skill:fixture_rise'])
    assert.equal(result.blocks.find(b => b.id === 'fixture_rise').virtual, false)
    assert.equal(result.blocks.find(b => b.id === 'fixture_guard').virtual, true)
  })
  await test('nested fake anchors are visible only to the raw anchor scanner', () => {
    assert.equal(blocks.scanAnchored(FAKE).length, 2)
    assert.deepEqual(effective(FAKE), [])
  })
  await test('a file containing only fake anchors falls back to real virtual entries', () => {
    const result = blocks.scanBlocks(FAKE)
    assert.equal(result.anchored, false)
    assert.deepEqual(result.blocks.map(b => b.key).sort(), ['skill:fixture_guard', 'skill:fixture_rise'])
    assert.ok(result.blocks.every(b => b.virtual))
  })
  await test('anchor-shaped text inside a template is not an effective anchor', () => {
    const phantom = 'const example = `\n' + wrap('skill', 'phantom', 'phantom: {},') + '\n`;\n' + SKILLS
    assert.equal(blocks.scanAnchored(phantom).length, 1)
    assert.deepEqual(effective(phantom), [])
    assert.deepEqual(keys(phantom), ['skill:fixture_guard', 'skill:fixture_rise'])
  })
  await test('fake keys cannot be extracted as editable content blocks', () => {
    assert.equal(blocks.extractBlock(FAKE, 'skill', 'viewAs'), null)
    assert.equal(blocks.extractBlock(FAKE, 'card', 'nature'), null)
    assert.match(blocks.extractBlock(FAKE, 'skill', 'fixture_rise'), /power: 1/)
  })
  for (const [kind, id] of [['skill', 'viewAs'], ['card', 'nature']]) {
    await test('replacement of fake anchor ' + kind + ':' + id + ' is rejected', () => {
      rejected(blocks.assembleBlocks(FAKE, [{ kind, id, code: id + ': {},' }]), FAKE)
    })
    await test('deletion of fake anchor ' + kind + ':' + id + ' is rejected', () => {
      rejected(blocks.assembleBlocks(FAKE, [], [], [kind + ':' + id]), FAKE)
    })
  }
  await test('an unindexed real entry cannot be duplicated through block replacement', () => {
    rejected(blocks.assembleBlocks(PARTIAL, [{ kind: 'skill', id: 'fixture_guard', code: GUARD.replace('power: 2', 'power: 9') }]), PARTIAL)
  })
  await test('a genuinely new entry can still be inserted into an indexed container', () => {
    const result = blocks.assembleBlocks(PARTIAL, [{ kind: 'skill', id: 'fixture_new', code: '  fixture_new: {},' }])
    assert.deepEqual(result.errors, [])
    assert.deepEqual(keys(result.code), ['skill:fixture_guard', 'skill:fixture_new', 'skill:fixture_rise'])
  })
  await test('migration removes false anchors and indexes every genuine entry', () => {
    const result = blocks.migrateCode(FAKE)
    assert.equal(result.error, undefined)
    assert.equal(result.blocks, 2)
    assert.equal(blocks.stripAnchors(result.code), SKILLS)
    assert.deepEqual(effective(result.code).map(b => b.key).sort(), ['skill:fixture_guard', 'skill:fixture_rise'])
  })
  await test('plural migration is byte-preserving with CRLF source', () => {
    const original = SKILLS.replaceAll('\n', '\r\n')
    const result = blocks.migrateCode(original)
    assert.equal(result.error, undefined)
    assert.equal(result.blocks, 2)
    assert.equal(blocks.stripAnchors(result.code), original)
  })
  const readonly = await fixture(FAKE)
  await test('the package directory includes only real entries with their source files', async () => {
    const result = await readExtension(readonly.nonameDir, folder, { listBlocks: true })
    assert.deepEqual(result.blocks.blocks.map(b => b.key).sort(), EXPECTED_KEYS)
    assert.equal(result.blocks.blocks.find(b => b.key === 'character:fixture_alpha').file, 'modules/characters.js')
    assert.equal(result.blocks.blocks.find(b => b.key === 'skill:fixture_rise').file, 'modules/skills.js')
  })
  await test('entry names are resolved from a separate plural translation module', async () => {
    const characters = await listEntries(readonly.nonameDir, folder, 'character')
    assert.equal(characters.ok, true)
    assert.deepEqual(characters.entries.map(({ id, name, file }) => ({ id, name, file })), [
      { id: 'fixture_alpha', name: 'Alpha', file: 'modules/characters.js' },
      { id: 'fixture_beta', name: 'Beta', file: 'modules/characters.js' },
    ])
    const cards = await listEntries(readonly.nonameDir, folder, 'card')
    assert.deepEqual(cards.entries.map(({ id, name }) => ({ id, name })), [{ id: 'fixture_token', name: 'Token' }])
  })
  await test('object-form and array-form characters return their translated skill lists', async () => {
    assert.deepEqual((await listEntrySkills(readonly.nonameDir, folder, 'fixture_alpha')).skills, [
      { id: 'fixture_rise', name: 'Rise' }, { id: 'fixture_guard', name: 'Guard' },
    ])
    assert.deepEqual((await listEntrySkills(readonly.nonameDir, folder, 'fixture_beta')).skills, [{ id: 'fixture_guard', name: 'Guard' }])
  })
  await test('reading a real block finds its file and excludes unrelated entries', async () => {
    const result = await readExtension(readonly.nonameDir, folder, { block: 'skill:fixture_rise' })
    assert.equal(result.block.file, 'modules/skills.js')
    assert.match(result.code, /power: 1/)
    assert.ok(!result.code.includes('fixture_guard:'))
  })
  await test('reading fake anchored keys returns an error instead of nested configuration', async () => {
    for (const block of ['skill:viewAs', 'card:nature']) {
      const result = await readExtension(readonly.nonameDir, folder, { block })
      assert.equal(result.code, undefined)
      assert.ok(result.error)
    }
  })
  await test('writing a fake anchor is rejected without changing the file', async () => {
    const sample = await fixture(FAKE)
    const result = await writeExtension(sample.nonameDir, { folder, file: 'modules/skills.js', blocks: [{ kind: 'skill', id: 'viewAs', code: 'viewAs: {},' }] })
    assert.equal(result.ok, false)
    assert.equal(result.wrote, false)
    assert.equal(await readFile(sample.target, 'utf8'), FAKE)
  })
  await test('writing an unindexed real entry is rejected without inserting a duplicate', async () => {
    const sample = await fixture(PARTIAL)
    const result = await writeExtension(sample.nonameDir, { folder, file: 'modules/skills.js', blocks: [{ kind: 'skill', id: 'fixture_guard', code: GUARD.replace('power: 2', 'power: 9') }] })
    assert.equal(result.ok, false)
    assert.equal(result.wrote, false)
    assert.equal(await readFile(sample.target, 'utf8'), PARTIAL)
  })
  await test('migration targets the requested module and block writes preserve all other bytes', async () => {
    const sample = await fixture()
    const migrated = await migrateAnchors(sample.nonameDir, folder, 'modules/skills.js')
    assert.equal(migrated.ok, true)
    assert.equal(migrated.blocks, 2)
    const before = await readFile(sample.target, 'utf8')
    assert.equal(blocks.stripAnchors(before), SKILLS)
    const changed = RISE.replace('power: 1', 'power: 9')
    const result = await writeExtension(sample.nonameDir, { folder, file: 'modules/skills.js', blocks: [{ kind: 'skill', id: 'fixture_rise', code: changed }] })
    assert.equal(result.ok, true)
    assert.equal(result.wrote, true)
    assert.equal(result.path, 'extension/ModuleFixture/modules/skills.js')
    const after = await readFile(sample.target, 'utf8')
    assert.equal(after, before.replace(RISE, changed))
    await unchangedSources(sample.base, new Map([['modules/skills.js', after]]))
  })
  await test('an undeclared deletion through an exact edit is refused in a plural module', async () => {
    const sample = await fixture()
    assert.equal((await migrateAnchors(sample.nonameDir, folder, 'modules/skills.js')).ok, true)
    const before = await readFile(sample.target, 'utf8')
    const result = await writeExtension(sample.nonameDir, { folder, file: 'modules/skills.js', edits: [{ find: GUARD, replace: '' }] })
    assert.equal(result.ok, false)
    assert.equal(result.wrote, false)
    assert.equal(await readFile(sample.target, 'utf8'), before)
  })
  await test('an explicit deletion of a genuinely indexed entry remains available', async () => {
    const sample = await fixture()
    assert.equal((await migrateAnchors(sample.nonameDir, folder, 'modules/skills.js')).ok, true)
    const result = await writeExtension(sample.nonameDir, { folder, file: 'modules/skills.js', deletes: ['skill:fixture_guard'] })
    assert.equal(result.ok, true)
    assert.equal(result.wrote, true)
    const after = await readFile(sample.target, 'utf8')
    assert.equal(blocks.extractBlock(after, 'skill', 'fixture_guard'), null)
    assert.match(blocks.extractBlock(after, 'skill', 'fixture_rise'), /power: 1/)
  })
  await test('reading modules never executes top-level side effects or throws', async () => {
    const sample = await fixture()
    const marker = '__nonameKitModuleFixtureExecuted'
    assert.equal(Object.hasOwn(globalThis, marker), false)
    const original = `globalThis.${marker} = true;\nthrow new Error("Static fixture must never execute");\n` + CHARACTERS
    await writeFile(join(sample.base, 'modules/characters.js'), original, 'utf8')
    try {
      assert.equal((await listEntries(sample.nonameDir, folder, 'character')).entries.length, 2)
      assert.equal((await listEntrySkills(sample.nonameDir, folder, 'fixture_alpha')).skills.length, 2)
      const result = await readExtension(sample.nonameDir, folder, { block: 'character:fixture_alpha' })
      assert.equal(result.block.id, 'fixture_alpha')
      assert.equal(Object.hasOwn(globalThis, marker), false)
      assert.equal(await readFile(join(sample.base, 'modules/characters.js'), 'utf8'), original)
    } finally { delete globalThis[marker] }
  })
  const REGEX_BODY = String.raw`  fixture_regex: {
    filter(value) {
      const braces = /[}'"]/g;
      const example = /const skills = \{ phantom_regex: \{\} \};/;
      return braces.test(value) && example.test(value);
    },
  },`
  const REGEX_SOURCE = `const skills = {\n${REGEX_BODY}\n${GUARD}\n};\nexport default skills;\n`
  await test('regex braces, quotes and container-shaped text do not change static boundaries', () => {
    assert.deepEqual(keys(REGEX_SOURCE), ['skill:fixture_guard', 'skill:fixture_regex'])
    assert.equal(blocks.extractBlock(REGEX_SOURCE, 'skill', 'fixture_regex'), REGEX_BODY.trimStart().replace(/,$/, ''))
    const result = blocks.migrateCode(REGEX_SOURCE)
    assert.equal(result.error, undefined)
    assert.equal(result.blocks, 2)
    assert.equal(blocks.stripAnchors(result.code), REGEX_SOURCE)
  })
  const DUPLICATE = `const skills = {\n${wrap('skill', 'fixture_duplicate', '  fixture_duplicate: { power: 1 },')}\n  fixture_duplicate: { power: 2 },\n};\nexport default skills;\n`
  await test('a single anchor cannot authorize either occurrence of a duplicate real ID', () => {
    assert.deepEqual(effective(DUPLICATE), [])
    rejected(blocks.assembleBlocks(DUPLICATE, [{ kind: 'skill', id: 'fixture_duplicate', code: 'fixture_duplicate: { power: 9 },' }]), DUPLICATE)
    rejected(blocks.assembleBlocks(DUPLICATE, [], [], ['skill:fixture_duplicate']), DUPLICATE)
    assert.ok(blocks.migrateCode(DUPLICATE).error)
  })
  await test('duplicate real IDs remain non-writable through the file API', async () => {
    const sample = await fixture(DUPLICATE)
    const result = await writeExtension(sample.nonameDir, { folder, file: 'modules/skills.js', blocks: [{ kind: 'skill', id: 'fixture_duplicate', code: 'fixture_duplicate: {},' }] })
    assert.equal(result.ok, false)
    assert.equal(result.wrote, false)
    assert.equal(await readFile(sample.target, 'utf8'), DUPLICATE)
  })
  const GAP_BODY = '  fixture_gap: "Gap",\n  fixture_other: "Keep this entry",\n  fixture_gap_info: "Gap description",'
  const GAP_TRANSLATE = `const translates = {\n${GAP_BODY}\n};\nexport default translates;\n`
  await test('reading non-contiguous translation pairs excludes the intervening entry', () => {
    const text = blocks.extractBlock(GAP_TRANSLATE, 'translate', 'fixture_gap')
    assert.ok(text.includes('fixture_gap: "Gap"'))
    assert.ok(text.includes('fixture_gap_info: "Gap description"'))
    assert.ok(!text.includes('fixture_other'))
    assert.match(blocks.extractBlock(GAP_TRANSLATE, 'translate', 'fixture_other'), /Keep this entry/)
  })
  await test('non-contiguous translations cannot be migrated into an overlapping write region', () => {
    const result = blocks.migrateCode(GAP_TRANSLATE)
    assert.ok(result.error)
    assert.equal(result.code, undefined)
  })
  const SHARED_TRANSLATE = `game.import("extension", function () { return {
  name: "ModuleFixture",
  package: {
    character: {
      character: {
        fixture_actor: ["male", "wei", 4, ["fixture_keep"]],
      },
      translate: {
        fixture_shared: "角色名",
        fixture_actor: "角色",
      },
    },
    card: {
      card: {
        fixture_card: { type: "basic" },
      },
      translate: {
        fixture_card: "卡牌",
      },
    },
    skill: {
      skill: {
        fixture_keep: { power: 1 },
      },
      translate: {
        fixture_shared: "技能名",
        fixture_shared_info: "技能说明",
        fixture_keep: "安全技",
        fixture_keep_info: "安全说明",
      },
    },
  },
}; });
`
  await test('partial migration indexes unique entries without choosing either shared translation', () => {
    assert.ok(blocks.migrateCode(SHARED_TRANSLATE).error)
    const result = blocks.migrateCode(SHARED_TRANSLATE, { allowPartial: true })
    assert.equal(result.error, undefined)
    assert.equal(result.partial, true)
    assert.equal(result.blocks, 6)
    assert.equal(result.totalEntries, 8)
    assert.deepEqual(result.skipped.map(x => [x.key, x.reason]), [['translate:fixture_shared', 'duplicate-key'], ['translate:fixture_shared', 'duplicate-key']])
    assert.equal(blocks.stripAnchors(result.code), SHARED_TRANSLATE)
    assert.equal(effective(result.code).length, 6)
    assert.equal(blocks.extractBlock(result.code, 'translate', 'fixture_shared'), null)
    rejected(blocks.assembleBlocks(result.code, [{ kind: 'translate', id: 'fixture_shared', code: 'fixture_shared: "Changed",' }]), result.code)
    rejected(blocks.assembleBlocks(result.code, [], [], ['translate:fixture_shared']), result.code)
    const edit = blocks.assembleBlocks(result.code, [{ kind: 'skill', id: 'fixture_keep', code: 'fixture_keep: { power: 2 },' }])
    assert.deepEqual(edit.errors, [])
    assert.ok(edit.code.includes('fixture_shared: "角色名"'))
    assert.ok(edit.code.includes('fixture_shared: "技能名"'))
    assert.equal(blocks.migrateCode(result.code, { allowPartial: true }).code, result.code)
  })
  await test('partial migration leaves non-contiguous translations unindexed while preserving other entries', () => {
    const result = blocks.migrateCode(GAP_TRANSLATE, { allowPartial: true })
    assert.equal(result.blocks, 1)
    assert.equal(result.skipped.length, 1)
    assert.equal(result.skipped[0].key, 'translate:fixture_gap')
    assert.equal(result.skipped[0].reason, 'non-contiguous')
    assert.equal(blocks.stripAnchors(result.code), GAP_TRANSLATE)
    assert.deepEqual(effective(result.code).map(x => x.key), ['translate:fixture_other'])
    rejected(blocks.assembleBlocks(result.code, [{ kind: 'translate', id: 'fixture_gap', code: 'fixture_gap: "Changed",' }]), result.code)
  })
  await test('partial migration cannot report success when every entry is ambiguous', () => {
    const result = blocks.migrateCode(DUPLICATE, { allowPartial: true })
    assert.ok(result.error)
    assert.equal(result.code, undefined)
    assert.equal(result.skipped.length, 2)
  })
  await test('file migration backs up the complete input and reports partial coverage', async () => {
    const sample = await fixture(SHARED_TRANSLATE)
    const result = await migrateAnchors(sample.nonameDir, folder, 'modules/skills.js')
    assert.equal(result.ok, true)
    assert.equal(result.partial, true)
    assert.equal(result.blocks, 6)
    assert.equal(result.totalEntries, 8)
    assert.equal(result.skipped.length, 2)
    assert.equal(await readFile(join(sample.nonameDir, result.backup), 'utf8'), SHARED_TRANSLATE)
    const indexed = await readFile(sample.target, 'utf8')
    assert.equal(blocks.stripAnchors(indexed), SHARED_TRANSLATE)
    const denied = await writeExtension(sample.nonameDir, { folder, file: 'modules/skills.js', blocks: [{ kind: 'translate', id: 'fixture_shared', code: 'fixture_shared: "Wrong target",' }] })
    assert.equal(denied.ok, false)
    assert.equal(denied.wrote, false)
    assert.equal(await readFile(sample.target, 'utf8'), indexed)
  })
  await test('a translation anchor cannot swallow another real translation entry', () => {
    const code = GAP_TRANSLATE.replace(GAP_BODY, wrap('translate', 'fixture_gap', GAP_BODY))
    assert.deepEqual(effective(code), [])
    rejected(blocks.assembleBlocks(code, [{ kind: 'translate', id: 'fixture_gap', code: 'fixture_gap: "Changed",\nfixture_gap_info: "Changed description",' }]), code)
    rejected(blocks.assembleBlocks(code, [], [], ['translate:fixture_gap']), code)
    assert.ok(!blocks.extractBlock(code, 'translate', 'fixture_gap').includes('fixture_other'))
  })
  const TEMPLATE_ANCHOR = 'const example = `\n' + wrap('skill', 'phantom', 'phantom: {},') + '\n`;\n'
  await test('stripping anchor comments preserves identical marker text inside templates', () => {
    const code = TEMPLATE_ANCHOR + PARTIAL
    assert.equal(blocks.stripAnchors(code), TEMPLATE_ANCHOR + SKILLS)
  })
  await test('migration preserves template marker text while indexing only real entries', () => {
    const code = TEMPLATE_ANCHOR + SKILLS
    const result = blocks.migrateCode(code)
    assert.equal(result.error, undefined)
    assert.equal(result.blocks, 2)
    assert.equal(blocks.stripAnchors(result.code), code)
    assert.deepEqual(effective(result.code).map(b => b.key).sort(), ['skill:fixture_guard', 'skill:fixture_rise'])
  })
  const NESTED_BAD = FAKE
    .replace('const skills = {\n', 'const skills = {\n//#noname-kit-begin skill:fixture_rise\n')
    .replace('\n' + GUARD, '\n//#noname-kit-end skill:fixture_rise\n' + GUARD)
  await test('an outer real entry anchor containing legacy fake anchors is not writable', () => {
    assert.equal(blocks.scanAnchored(NESTED_BAD)[0].key, 'skill:fixture_rise')
    assert.deepEqual(effective(NESTED_BAD), [])
    rejected(blocks.assembleBlocks(NESTED_BAD, [{ kind: 'skill', id: 'fixture_rise', code: RISE.replace('power: 1', 'power: 9') }]), NESTED_BAD)
    rejected(blocks.assembleBlocks(NESTED_BAD, [], [], ['skill:fixture_rise']), NESTED_BAD)
  })
  await test('rebuilding nested legacy anchors restores safe real entry indexing', () => {
    const result = blocks.migrateCode(NESTED_BAD)
    assert.equal(result.error, undefined)
    assert.equal(result.blocks, 2)
    assert.equal(blocks.stripAnchors(result.code), SKILLS)
    assert.deepEqual(effective(result.code).map(b => b.key).sort(), ['skill:fixture_guard', 'skill:fixture_rise'])
  })
  const EMPTY_NESTED = `game.import("extension", function () {
  return {
    name: "ModuleFixture",
    package: {
      character: {
        character: {
${wrap('character', 'fixture_alpha', '          fixture_alpha: ["male", "wei", 4, []],')}
        },
        translate: {},
      },
      skill: {
        skill: {
        },
        translate: {},
      },
    },
  };
});\n`
  await test('new entries use the innermost empty same-kind container', () => {
    assert.equal(blocks.scanBlocks(EMPTY_NESTED).anchored, true, 'another kind has a valid index')
    const body = '          fixture_new: {},'
    const result = blocks.assembleBlocks(EMPTY_NESTED, [{ kind: 'skill', id: 'fixture_new', code: body }])
    assert.deepEqual(result.errors, [])
    const expected = EMPTY_NESTED.replace('        skill: {\n', '        skill: {\n' + wrap('skill', 'fixture_new', body) + '\n')
    assert.equal(result.code, expected, 'only the inner skill table receives the new entry')
    assert.deepEqual(keys(result.code), ['character:fixture_alpha', 'skill:fixture_new'])
  })
  await test('equally suitable empty leaf containers do not grant ambiguous insertion', () => {
    const code = EMPTY_NESTED.replace('        translate: {},', '        skill: {\n        },\n        translate: {},')
    assert.equal(blocks.scanBlocks(code).anchored, true)
    rejected(blocks.assembleBlocks(code, [{ kind: 'skill', id: 'fixture_new', code: 'fixture_new: {},' }]), code)
  })
  await test('a named top-level function can provide the game import descriptor', () => {
    const code = `function fixtureFactory() {
  return {
    skill: {
      fixture_named: {},
    },
    translate: {
      fixture_named: "Named",
    },
  };
}
game.import("extension", fixtureFactory);
`
    assert.deepEqual(keys(code), ['skill:fixture_named', 'translate:fixture_named'])
    assert.equal(blocks.extractBlock(code, 'skill', 'fixture_named'), 'fixture_named: {}')
  })
  const OUTER_PACK = `const pack = {
  skill: {
    fixture_outer: {},
  },
  translate: {
    fixture_outer: "Outer",
  },
};
`
  await test('a default factory can return a top-level descriptor binding', () => {
    const code = OUTER_PACK + 'export default function () { return pack; }\n'
    assert.deepEqual(keys(code), ['skill:fixture_outer', 'translate:fixture_outer'])
    const migrated = blocks.migrateCode(code)
    assert.equal(migrated.error, undefined)
    assert.equal(migrated.blocks, 2)
    assert.equal(blocks.stripAnchors(migrated.code), code)
  })
  for (const [label, factory] of [
    ['local variable', 'export default function () { const pack = { config: {} }; return pack; }'],
    ['parameter', 'export default function (pack) { return pack; }'],
    ['object destructuring', 'export default function () { const { pack } = { pack: { config: {} } }; return pack; }'],
    ['destructured default parameter', 'export default function ({ pack } = {}) { return pack; }'],
    ['catch binding', 'export default function () { try { throw null; } catch (pack) { return pack; } }'],
    ['hoisted local variable', 'export default function () { if (false) { var pack = {}; } return pack; }'],
  ]) {
    await test(label + ' cannot resolve a shadowed name to an unrelated top-level descriptor', () => {
      const code = OUTER_PACK + factory + '\n'
      assert.deepEqual(keys(code), [])
      assert.equal(blocks.extractBlock(code, 'skill', 'fixture_outer'), null)
      assert.ok(blocks.migrateCode(code).error)
    })
  }
  await test('a named function expression cannot resolve its own name to a top-level descriptor', () => {
    const code = OUTER_PACK + 'const factory = function pack() { return pack; };\nexport default factory;\n'
    assert.deepEqual(keys(code), [])
    assert.equal(blocks.extractBlock(code, 'skill', 'fixture_outer'), null)
    assert.ok(blocks.migrateCode(code).error)
  })
  for (const [label, registration] of [
    ['block-scoped', 'if (true) { const pack = { skill: { fixture_inner: {} } }; game.import("extension", pack); }'],
    ['loop-scoped', 'for (const pack of [{ skill: { fixture_inner: {} } }]) { game.import("extension", pack); }'],
  ]) {
    await test(label + ' game imports cannot resolve a shadowed name to a top-level descriptor', () => {
      const code = OUTER_PACK + registration + '\n'
      assert.deepEqual(keys(code), [])
      assert.equal(blocks.extractBlock(code, 'skill', 'fixture_outer'), null)
      assert.equal(blocks.extractBlock(code, 'skill', 'fixture_inner'), null)
    })
  }
  console.log(JSON.stringify({ passed, failed: failures.length, total: passed + failures.length, failures }, null, 2))
} finally {
  await rm(testPaths.assertTestPath(home), { recursive: true, force: true })
}
if (failures.length) process.exitCode = 1
