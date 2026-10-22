#!/usr/bin/env node
/** Isolated read coverage, pagination, module provenance and ambiguity checks. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, open, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import testPaths from './fixtures/test-paths.cjs'
import { readExtension, listEntries, listEntrySkills } from '../src/write.js'
import { listCatalog, readCatalog } from '../src/catalog.js'
import { scanBlocks, extractBlock, assembleBlocks } from '../src/blocks.js'
import { pageRead } from '../src/package-read.js'
import { renderExtensionRead } from '../src/tool-output.js'

const home = testPaths.assertTestPath(await mkdtemp(testPaths.tempPrefix('read-flow-'))), game = join(home, 'game')
const checks = [], failures = [], skipped = []
async function check(name, fn) { try { await fn(); checks.push(name) } catch (error) { failures.push({ name, message: error.stack || String(error) }) } }
async function put(folder, file, code) { const path = join(game, 'extension', folder, file); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, code); return path }
const read = (folder, opts) => readExtension(game, folder, opts)
const isJson = value => value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value) || Array.isArray(value) && value.every(isJson) || !!value && typeof value === 'object' && Object.values(value).every(isJson)
const hash = value => createHash('sha256').update(value).digest('hex')

await put('Graph', 'extension.js', "import {assembled} from './defs.js';game.import('extension',function(lib,game,ui,get,ai,_status){return assembled;});")
await put('Graph', 'defs.js', "throw new Error('never execute');export const assembled={name:'Graph',package:{character:{character:{hero:['male','wei',4,['guard']]}},skill:{skill:{guard:{content(){}}},translate:{guard:'守护',guard_info:'保留描述'}}}};")
await check('shared imported descriptor lists physical blocks', async () => { const r = await read('Graph', {listBlocks:true}); assert.equal(r.coverage.complete,true); assert.ok(r.blocks.blocks.some(b=>b.key==='skill:guard'&&b.file==='defs.js')); assert.ok(r.blocks.blocks.some(b=>b.key==='character:hero')); assert.ok(isJson(r)) })
await check('shared imported descriptor reads exact skill text', async () => { const r = await read('Graph',{block:'skill:guard'}); assert.equal(r.code,'guard:{content(){}}'); assert.equal(r.file,'defs.js') })
await check('shared imported descriptor groups translations', async () => { const r = await read('Graph',{block:'translate:guard'}); assert.equal(r.code,"guard:'守护',guard_info:'保留描述'") })
await check('physical file selection sees imported definitions', async () => { const r = await read('Graph',{listBlocks:true,file:'defs.js'}); assert.ok(r.blocks.blocks.some(b=>b.id==='guard')); assert.ok(r.blocks.blocks.every(b=>b.file==='defs.js')) })
await check('entry selection shares package graph', async () => { const r = await listEntries(game,'Graph','character'); assert.equal(r.entries[0].file,'defs.js'); assert.equal(r.entries[0].id,'hero'); const s=await listEntrySkills(game,'Graph','hero'); assert.deepEqual(s.skills,[{id:'guard',name:'守护'}]) })
await check('catalog and extension agree on physical entry', async () => { const r=await readCatalog(game,{source:'extension',kind:'character',pack:'Graph',entry:'skill:guard'}); assert.equal(r.ok,true); assert.equal(r.code,'guard:{content(){}}'); assert.equal(r.file,'extension/Graph/defs.js') })

await put('Duplicate','extension.js',"const skill={same:{n:1},same:{n:2}};const translate={same:'一',same:'二',same_info:'描述'};")
await check('same-file duplicate skill read refuses to guess',async()=>{const r=await read('Duplicate',{block:'skill:same'});assert.equal(r.code,undefined);assert.equal(r.ambiguous.sources.length,2)})
await check('same-file duplicate translation read refuses to guess',async()=>{const r=await read('Duplicate',{block:'translate:same'});assert.equal(r.code,undefined);assert.equal(r.ambiguous.sources.length,3)})
await check('pure block reader refuses duplicate IDs',()=>{assert.equal(extractBlock('const skill={s:{a:1},s:{a:2}};','skill','s'),null);assert.equal(extractBlock("const translate={s:'a',s:'b'};",'translate','s'),null)})
await check('pure block list marks physical duplicates',()=>{const r=scanBlocks('const skill={s:{a:1},s:{a:2}};');assert.equal(r.blocks.length,2);assert.ok(r.blocks.every(b=>b.ambiguous))})
await check('duplicate translation cannot acquire writable anchor',()=>{const code="const translate={\n//#noname-kit-begin translate:s\ns:'a',s:'b',\n//#noname-kit-end translate:s\n};";const r=assembleBlocks(code,[{kind:'translate',id:'s',code:"s:'x'"}]);assert.ok(r.errors.length);assert.equal(r.code,code)})

await put('Cross','extension.js',"export default {name:'Cross'};")
await put('Cross','a.js',"const skill={s:{a:1}};")
await put('Cross','b.js',"const skill={s:{a:2}};")
await check('cross-file duplicate read exposes every source',async()=>{const r=await read('Cross',{block:'skill:s'});assert.equal(r.ambiguous.sources.length,2);assert.equal(r.code,undefined)})
await check('cross-file explicit source resolves ambiguity',async()=>{const r=await read('Cross',{block:'skill:s',file:'b.js'});assert.equal(r.code,'s:{a:2}');assert.equal(r.block.file,'b.js')})

const text='// 完整原文😀\r\n'+Array.from({length:75},(_,i)=>`// 第${i}行内容\r\n`).join('')+"const skill={s:{content(){}}};\r\n"
const textPath=await put('Pages','extension.js',text), before=hash(await readFile(textPath))
await check('full source pages round-trip CRLF and Unicode',async()=>{let offset=0,code='',snapshot;do{const r=await read('Pages',{offset,limit:73,...(snapshot?{snapshot}:{})});assert.equal(r.error,undefined);code+=r.code;snapshot=r.coverage.snapshot;offset=r.pagination.nextOffset}while(offset!==null);assert.equal(code,text);assert.equal(hash(await readFile(textPath)),before)})
await check('directory query supports Chinese source names',async()=>{await put('Pages','中文.js',"const skill={中文技能:{content(){}}};");const r=await read('Pages',{listBlocks:true,query:'中文'});assert.equal(r.blocks.blocks[0].id,'中文技能')})
await check('directory pagination gives exact continuation',async()=>{const a=await read('Pages',{listBlocks:true,limit:1}),b=await read('Pages',{listBlocks:true,limit:1,offset:a.pagination.nextOffset,snapshot:a.coverage.snapshot});assert.equal(a.pagination.total,2);assert.equal(b.pagination.complete,true);assert.notEqual(a.blocks.blocks[0].key,b.blocks.blocks[0].key)})
await check('source changes reject stale continuation',async()=>{const a=await read('Pages',{listBlocks:true,limit:1});await put('Pages','changed.js','const skill={added:{}};');const b=await read('Pages',{listBlocks:true,offset:1,snapshot:a.coverage.snapshot});assert.match(b.error,/快照已变化/);assert.equal(b.blocks,undefined)})
const unicodeSource='//'+ 'x'.repeat(7997)+'😀tail\r\nconst character={h:["male","wei",4,[]]};'
await put('UnicodeBoundary','extension.js',unicodeSource)
await check('default source page does not split a supplementary character',async()=>{const r=await read('UnicodeBoundary');assert.equal(r.code.length,7999);assert.equal(r.pagination.nextOffset,7999);assert.equal(r.pagination.codePointSafe,true);assert.equal(Buffer.from(r.code,'utf8').toString('utf8'),r.code)})
await check('source renderer transport round-trips complete Unicode pages',async()=>{let offset=0,whole='',snapshot;do{const r=await read('UnicodeBoundary',{offset,...snapshot?{snapshot}:{}});assert.equal(r.error,undefined);const rendered=renderExtensionRead({},r).map(item=>item.text).join('\n'),transport=Buffer.from(rendered,'utf8').toString('utf8');assert.ok(transport.includes(r.code));assert.equal(Buffer.from(r.code,'utf8').toString('utf8'),r.code);whole+=Buffer.from(r.code,'utf8').toString('utf8');offset=r.pagination.nextOffset;snapshot=r.coverage.snapshot}while(offset!==null);assert.equal(whole,unicodeSource)})
await check('limit one advances over one complete supplementary character',()=>{const r=pageRead('😀tail',{limit:1});assert.equal(r.value,'😀');assert.equal(r.pagination.nextOffset,2);assert.equal(r.pagination.actualLength,2);assert.equal(r.pagination.limitAdjustedForCodePoint,true);assert.equal(pageRead('😀tail',{offset:r.pagination.nextOffset,limit:1}).value,'t')})
await check('source read limit one retains both surrogate units',async()=>{const r=await read('UnicodeBoundary',{offset:7999,limit:1});assert.equal(r.code,'😀');assert.equal(r.pagination.nextOffset,8001);assert.equal(r.pagination.limitAdjustedForCodePoint,true)})
await check('source offset inside a surrogate pair is explicitly refused',async()=>{const r=await read('UnicodeBoundary',{offset:8000,limit:1});assert.ok(r.error.includes('UTF-16'));assert.equal(r.code,undefined)})
await check('catalog source page also preserves Unicode boundaries',async()=>{const first=await readCatalog(game,{source:'extension',kind:'character',pack:'UnicodeBoundary'});assert.equal(first.ok,true);assert.equal(first.code.length,7999);assert.equal(first.pagination.nextOffset,7999);const last=await readCatalog(game,{source:'extension',kind:'character',pack:'UnicodeBoundary',offset:first.pagination.nextOffset,snapshot:first.coverage.snapshot});assert.equal(Buffer.from(first.code,'utf8').toString()+Buffer.from(last.code,'utf8').toString(),unicodeSource)})
await check('catalog limit one safely advances a complete code point',async()=>{const r=await readCatalog(game,{source:'extension',kind:'character',pack:'UnicodeBoundary',offset:7999,limit:1});assert.equal(r.code,'😀');assert.equal(r.pagination.nextOffset,8001);assert.equal(r.pagination.limitAdjustedForCodePoint,true);assert.equal(JSON.parse(Buffer.from(JSON.stringify(r),'utf8').toString()).code,'😀')})
await check('catalog rejects a manually split UTF-16 offset',async()=>{const r=await readCatalog(game,{source:'extension',kind:'character',pack:'UnicodeBoundary',offset:8000,limit:1});assert.equal(r.ok,false);assert.ok(r.error.includes('UTF-16'));assert.equal(r.code,undefined)})
await check('array entry pages retain their exact prior slicing contract',()=>{const values=['😀','tail'];assert.deepEqual(pageRead(values,{limit:1},'entries'),{value:['😀'],pagination:{offset:0,limit:1,total:2,nextOffset:1,complete:false,unit:'entries'}});assert.deepEqual(pageRead(values,{offset:1,limit:1},'entries'),{value:['tail'],pagination:{offset:1,limit:1,total:2,nextOffset:null,complete:true,unit:'entries'}})})
for(const options of [{offset:-1},{limit:0},{limit:16001},{offset:1.2}]) await check('invalid text page '+JSON.stringify(options),async()=>{const r=await read('Pages',options);assert.match(r.error,/offset|limit/)})

await put('Broken','extension.js','const skill={s:{content(){}}');
await check('parse failure remains explicit incomplete coverage',async()=>{const r=await read('Broken',{listBlocks:true});assert.equal(r.coverage.complete,false);assert.ok(r.coverage.gaps.some(g=>g.code==='parse-failed'));assert.equal(r.blocks.blocks.length,0)})
await check('missing block in incomplete scan is unknown, not absent',async()=>{const r=await read('Broken',{block:'skill:s'});assert.match(r.error,/不能判定不存在/)})
await check('pure block scan exposes syntax error',()=>{assert.ok(scanBlocks('const skill={').error)})
await check('missing full source returns an error',async()=>{const r=await read('Pages',{file:'missing.js'});assert.ok(r.error);assert.equal(r.code,undefined);assert.equal(r.coverage.complete,false)})
await check('missing selected source retains package coverage',async()=>{const r=await read('Pages',{file:'missing.js',listBlocks:true});assert.ok(r.error);assert.ok(r.coverage)})
const huge=await put('Huge','extension.js',''), handle=await open(huge,'r+');await handle.truncate(12*1024*1024+1);await handle.close()
await check('oversize AST source is rejected before source allocation',async()=>{const r=await read('Huge',{listBlocks:true});assert.equal(r.coverage.filesRead,0);assert.equal(r.coverage.bytesRead,0);assert.ok(r.coverage.gaps.some(g=>g.code==='resource-limit'));assert.equal(r.coverage.complete,false)})
await check('oversize full read gives independent 5GiB clarification',async()=>{const r=await read('Huge');assert.match(r.error,/5 GiB/);assert.equal(r.code,undefined);assert.equal(r.coverage.bytesRead,0)})
await put('Utf8','extension.js',Buffer.from([0xff,0xfe,0x61]))
await check('invalid UTF-8 is not silently replaced',async()=>{const r=await read('Utf8');assert.match(r.error,/UTF-8/);assert.equal(r.code,undefined)})
await put('Meta','extension.js','const skill={s:{}};');await put('Meta','info.json',' '.repeat(256*1024+1))
await check('oversized info.json cannot bypass resource cap',async()=>{const r=await read('Meta');assert.equal(r.code,'const skill={s:{}};');assert.ok(r.warnings.some(w=>w.includes('info.json')));assert.equal(r.info,undefined)})
await put('Meta','info.json','{"name":"说明"}')
await check('small valid metadata stays intact',async()=>{const r=await read('Meta');assert.deepEqual(r.info,{name:'说明'})})

await check('catalog oversized missing package retains gap',async()=>{const r=await readCatalog(game,{source:'extension',kind:'character',pack:'Huge'});assert.equal(r.ok,false);assert.equal(r.coverage.complete,false);assert.match(r.error,/不能判定/);assert.ok(r.coverage.gaps.length)})
await put('Dynamic','extension.js',"import {game} from 'noname';export default {name:'Dynamic',content(){if(probe){game.addMode('same',getA());}else{game.addMode('same',getB());}}};")
await check('dynamic duplicate mode sources stay JSON values',async()=>{const r=await listCatalog(game,{source:'extension',kind:'mode',pack:'Dynamic',includeEntries:true});assert.ok(isJson(r));assert.equal(r.packs[0].ambiguities[0].sources.length,2)})
await check('catalog Chinese query filters entries',async()=>{const r=await listCatalog(game,{source:'extension',kind:'character',pack:'Graph',query:'守护'});assert.equal(r.pagination.unit,'entries');assert.equal(r.packs[0].entries[0].kind,'skill')})
await check('catalog entry pagination continues without duplicates',async()=>{const a=await listCatalog(game,{source:'extension',kind:'character',pack:'Graph',limit:1}),b=await listCatalog(game,{source:'extension',kind:'character',pack:'Graph',limit:1,offset:1,snapshot:a.coverage.snapshot});assert.equal(a.pagination.total,b.pagination.total);assert.notEqual(a.packs[0].entries[0].id+':'+a.packs[0].entries[0].kind,b.packs[0].entries[0].id+':'+b.packs[0].entries[0].kind)})
await check('catalog whole text is paginated explicitly',async()=>{const r=await readCatalog(game,{source:'extension',kind:'character',pack:'Graph',limit:12});assert.equal(r.code.length,12);assert.equal(r.pagination.complete,false)})
await check('catalog stale snapshot fails with coverage',async()=>{const a=await listCatalog(game,{source:'extension',kind:'character',pack:'Graph'});await put('Graph','new.js','const skill={new_skill:{}};');const b=await readCatalog(game,{source:'extension',kind:'character',pack:'Graph',snapshot:a.coverage.snapshot});assert.equal(b.ok,false);assert.match(b.error,/快照已变化/);assert.ok(b.coverage)})
await put('FileBudget','extension.js',"const character={h:['male','wei',4,[]]};")
for(let i=0;i<513;i++)await put('FileBudget',`part${String(i).padStart(3,'0')}.js`,'// source fixture')
await check('package source count stops at its stated budget',async()=>{const r=await read('FileBudget',{listBlocks:true});assert.equal(r.coverage.filesRead,512);assert.equal(r.coverage.complete,false);assert.ok(r.coverage.gaps.some(g=>g.code==='file-limit'))})
await check('catalog source count stops at its stated budget',async()=>{const r=await listCatalog(game,{source:'extension',kind:'character',pack:'FileBudget'});assert.equal(r.coverage.filesRead,512);assert.equal(r.coverage.complete,false);assert.equal(r.coverage.gaps.filter(g=>g.code==='file-limit').length,1)})
let linked=false
try{await symlink(join(game,'extension','Graph'),join(game,'extension','Pages','linked'),process.platform==='win32'?'junction':'dir');linked=true}catch(error){skipped.push({name:'directory link',reason:error.code})}
if(linked)await check('package links are skipped and reported',async()=>{const r=await read('Pages',{listBlocks:true});assert.equal(r.coverage.complete,false);assert.ok(r.coverage.gaps.some(g=>g.code==='symlink-skipped'))})

console.log(JSON.stringify({suite:'read-flow',passed:checks.length,failed:failures.length,skipped,fixtureRoot:home,checks,failures}))
if(failures.length)process.exitCode=1
