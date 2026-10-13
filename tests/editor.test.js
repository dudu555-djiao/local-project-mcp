// Synthetic temporary projects only. These tests never load a real user configuration or credential.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Store } from '../src/store.js';
import { Reader } from '../src/reader.js';
import { Editor, BACKUP_LIMIT } from '../src/editor.js';
import { startServer } from '../src/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const sha = value => 'sha256:' + crypto.createHash('sha256').update(value).digest('hex');
const initial = 'const greeting = "hello";\nconst count = 1;\n';
function fixture(t, options = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'local-reader-editor-test-')));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const project = path.join(dir, 'project'), outside = path.join(dir, 'outside');
  fs.mkdirSync(project); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(project, 'app.js'), initial);
  fs.writeFileSync(path.join(outside, 'outside.txt'), 'outside fixture');
  const store = new Store(path.join(dir, 'data'));
  const folder = store.add(project, 'Synthetic project');
  const reader = new Reader(store), editor = new Editor(store, options);
  return {dir, project, outside, store, folder, reader, editor};
}
function enable(x) { x.store.update(x.folder.id, {editable:true}); return x; }
function replace(x, overrides = {}) {
  return x.editor.prepare({folderId:x.folder.id, path:'app.js', operation:'replace', expectedVersion:sha(fs.readFileSync(path.join(x.project,'app.js'))), edits:[{oldText:'const count = 1;', newText:'const count = 2;'}], ...overrides});
}
function apply(x, proposal) { return x.editor.apply({proposalId:proposal.proposalId}); }
function file(x, name = 'app.js') { return path.join(x.project, name); }

test('new and legacy project grants default to read-only and cannot authorize the private application directory', t => {
  const x = fixture(t);
  assert.equal(x.folder.editable, false);
  assert.equal(x.reader.listFolders().folders[0].editable, false);
  assert.throws(() => replace(x), /只读/);
  const old = x.store.load(); delete old.folders[0].editable; delete old.folders[0].editEpoch; delete old.accessEpoch; x.store.save(old);
  assert.equal(x.reader.listFolders().folders[0].editable, false);
  assert.throws(() => replace(x), /只读/);
  assert.throws(() => x.store.add(x.store.dir), /设置和备份/);
  assert.throws(() => x.store.add(x.dir), /设置和备份/);
  enable(x); assert.ok(apply(x, replace(x)).verified);
});

test('legacy grants overlapping private editing storage cannot expose proposals or raw backups', async t => {
  const x=enable(fixture(t)), change=apply(x,replace(x));
  const pending=replace(x,{edits:[{oldText:'const count = 2;',newText:'const count = 3;'}]});
  const proposal=path.join(x.editor.area,'proposals',pending.proposalId+'.json');
  const backup=path.join(x.editor.area,'changes',change.changeId,'before.bin');
  assert.ok(fs.existsSync(proposal));assert.deepEqual(fs.readFileSync(backup),Buffer.from(initial));
  // Simulate files written by an older release before overlap checks existed.
  // Ancestor, exact private root and nested private folders must all be rejected.
  for(const root of [x.dir,x.store.dir,path.join(x.editor.area,'proposals')]){
    const legacy={version:1,paused:false,folders:[{id:'legacy-fixture',name:'Legacy synthetic grant',path:fs.realpathSync.native(root),enabled:true,editable:true}]};
    fs.writeFileSync(x.store.file,JSON.stringify(legacy),{mode:0o600});
    const listed=x.reader.listFolders();assert.deepEqual(listed.folders,[]);assert.equal(listed.unavailableCount,1);
    assert.throws(()=>x.store.folder('legacy-fixture'),/私有设置或备份/);
    for(const privateFile of [proposal,backup]){
      const relative=path.relative(root,privateFile);
      await assert.rejects(()=>x.reader.readFile({folderId:'legacy-fixture',path:relative}),/私有设置或备份/);
      assert.throws(()=>x.editor.prepare({folderId:'legacy-fixture',path:relative,operation:'replace',expectedVersion:sha(fs.readFileSync(privateFile)),edits:[{oldText:'const',newText:'let'}]}),/私有设置或备份/);
    }
  }
  assert.deepEqual(fs.readFileSync(backup),Buffer.from(initial));
  assert.equal(fs.readFileSync(file(x),'utf8'),initial.replace('count = 1','count = 2'));
});

test('read_file version drives a preview, atomic byte-verified edit, durable original backup and readback', async t => {
  const x = enable(fixture(t)); fs.chmodSync(file(x), 0o640);
  const read = await x.reader.readFile({folderId:x.folder.id, path:'app.js'});
  assert.equal(read.version, sha(initial));
  const p = replace(x, {expectedVersion:read.version});
  assert.equal(p.requiresApply, true); assert.equal(p.beforeVersion, read.version);
  assert.deepEqual(p.preview.edits[0], {line:2, oldText:'const count = 1;', newText:'const count = 2;', truncated:false});
  assert.equal(fs.readFileSync(file(x),'utf8'), initial);
  const result = apply(x, p), expected = initial.replace('count = 1', 'count = 2');
  assert.equal(result.applied, true); assert.equal(result.verified, true);
  assert.equal(fs.readFileSync(file(x),'utf8'), expected);
  assert.equal(result.version, sha(Buffer.from(expected)));
  assert.equal((await x.reader.readFile({folderId:x.folder.id,path:'app.js'})).version, result.version);
  if(process.platform !== 'win32')assert.equal(fs.statSync(file(x)).mode & 0o777, 0o640);
  const backup = path.join(x.editor.area,'changes',result.changeId,'before.bin');
  assert.deepEqual(fs.readFileSync(backup), Buffer.from(initial)); if(process.platform !== 'win32')assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
  const history = x.editor.history(x.folder.id);
  assert.equal(history.changes.length, 1); assert.equal(history.changes[0].canRestore, true); assert.equal(history.backupBytes, Buffer.byteLength(initial));
  assert.ok(x.store.auditRows().some(row => row.tool==='edit_applied'));
});

test('new UTF-8 files create missing parents only on apply and cannot overwrite or restore-delete', t => {
  const x = enable(fixture(t)), relative = 'src/nested/message.txt';
  const p = x.editor.prepare({folderId:x.folder.id,path:relative,operation:'create',content:'你好，世界\n'});
  assert.equal(fs.existsSync(file(x,'src')), false);
  assert.deepEqual(p.preview.createsDirectories, ['src','src/nested']);
  const r = apply(x,p); assert.equal(fs.readFileSync(file(x,relative),'utf8'),'你好，世界\n');
  assert.equal(r.canRestore, false); assert.equal(x.editor.history(x.folder.id).changes[0].canRestore, false);
  assert.throws(() => x.editor.prepareRestore({folderId:x.folder.id,changeId:r.changeId}), /没有可恢复/);
  assert.throws(() => x.editor.prepare({folderId:x.folder.id,path:relative,operation:'create',content:'overwrite'}), /已经存在/);
  assert.equal(fs.readFileSync(file(x,relative),'utf8'),'你好，世界\n');
});

test('stale SHA, ambiguous matches, placeholders and invalid replacement shapes cannot generate a mutation', t => {
  const x = enable(fixture(t));
  const rejected = [
    {expectedVersion:sha('stale')},
    {edits:[{oldText:'const',newText:'let'}]},
    {edits:[{oldText:'not present',newText:'new'}]},
    {edits:[{oldText:'const count = 1;',newText:'const count = 1;'}]},
    {edits:[{oldText:'',newText:'append'}]},
    {edits:[{oldText:'[已隐藏密钥]',newText:'unsafe'}]},
    {edits:[{oldText:'const count = 1;',newText:'[已隐藏]'}]},
    {content:'whole-file overwrite'},
    {edits:Array.from({length:21},()=>({oldText:'count = 1',newText:'count = 2'}))},
    {edits:[{oldText:'const count = 1;',newText:'x'.repeat(500_001)}]}
  ];
  for (const args of rejected) assert.throws(() => replace(x,args));
  assert.equal(fs.readFileSync(file(x),'utf8'), initial); assert.equal(x.editor.history(x.folder.id).changes.length,0);
});

test('revocation, disable and pause invalidate old proposals even after access is restored', t => {
  const x = enable(fixture(t));
  for (const revoke of [
    () => {x.store.update(x.folder.id,{editable:false});x.store.update(x.folder.id,{editable:true});},
    () => {x.store.update(x.folder.id,{enabled:false});x.store.update(x.folder.id,{enabled:true});},
    () => {x.store.pause(true);x.store.pause(false);}
  ]) {
    const p = replace(x); revoke(); assert.throws(() => apply(x,p), /权限已经变化|旧提案失效/);
    assert.equal(fs.readFileSync(file(x),'utf8'),initial);
  }
  assert.ok(apply(x,replace(x)).verified);
});

test('pending proposals expire after ten minutes and expiration never changes the project', t => {
  let now = Date.now(); const x = enable(fixture(t,{now:()=>now}));
  const p = replace(x); assert.equal(Date.parse(p.expiresAt)-now,600_000);
  now += 600_001; assert.throws(() => apply(x,p), /10 分钟/);
  assert.equal(fs.readFileSync(file(x),'utf8'),initial);
  assert.ok(apply(x,replace(x)).verified);
});

test('localized edits preserve redacted secrets, UTF-8 BOM and CRLF bytes without copying redaction markers', async t => {
  const x = enable(fixture(t));
  const secret = 'sk-proj-'+'q'.repeat(30);
  const original = '\uFEFFconst count = 1;\r\nconst enabled = true;\r\napi_key = "'+secret+'";\r\n';
  fs.writeFileSync(file(x),original);
  const r = await x.reader.readFile({folderId:x.folder.id,path:'app.js'});
  assert.ok(!r.content.includes(secret)); assert.match(r.content,/已隐藏/); assert.equal(r.version,sha(original));
  assert.throws(() => replace(x,{expectedVersion:r.version,edits:[{oldText:'api_key = "'+secret+'";',newText:'api_key = "removed";'}]}), /隐藏/);
  const p = replace(x,{expectedVersion:r.version,edits:[{oldText:'const count = 1;\nconst enabled = true;',newText:'const count = 2;\nconst enabled = false;'}]});
  apply(x,p); const after=fs.readFileSync(file(x));
  assert.deepEqual(after.subarray(0,3),Buffer.from([0xef,0xbb,0xbf]));
  assert.equal(after.toString('utf8'),original.replace('count = 1','count = 2').replace('enabled = true','enabled = false'));
  assert.ok(after.includes(Buffer.from(secret))); assert.equal(/(?<!\r)\n/.test(after.toString('utf8')),false);
  assert.ok(!JSON.stringify(x.store.auditRows()).includes(secret));
});

test('symlinks, hardlinks, FIFO files and credential or case-variant Git paths cannot be edited', t => {
  const x=enable(fixture(t));
  fs.symlinkSync(file(x),file(x,'linked.js')); fs.symlinkSync(x.outside,file(x,'linked-dir'));
  fs.writeFileSync(file(x,'original.txt'),'hardlink fixture');fs.linkSync(file(x,'original.txt'),file(x,'hardlink.txt'));
  if(process.platform !== 'win32')execFileSync('/usr/bin/mkfifo',[file(x,'pipe.txt')]);
  for(const relative of ['linked.js','linked-dir/outside.txt','hardlink.txt','original.txt','pipe.txt']){
    assert.throws(()=>x.editor.prepare({folderId:x.folder.id,path:relative,operation:'replace',expectedVersion:sha('unused'),edits:[{oldText:'x',newText:'y'}]}));
  }
  for(const relative of ['../outside/outside.txt',path.join(x.outside,'outside.txt'),'/etc/hosts','nested\\escape.txt','.env','.env.local','secrets.json','.npmrc','.git-credentials','id_rsa.txt','private-key.txt','cert.pem','.GIT/config.txt','node_modules/add.js','build/output.js']){
    assert.throws(()=>x.editor.prepare({folderId:x.folder.id,path:relative,operation:'create',content:'synthetic'}));
  }
  assert.equal(fs.readFileSync(path.join(x.outside,'outside.txt'),'utf8'),'outside fixture');
  assert.equal(fs.readFileSync(file(x),'utf8'),initial);
});

test('binary, invalid UTF-8, oversized, document and database files remain uneditable', t => {
  const x=enable(fixture(t));
  const samples={'nul.txt':Buffer.from([65,0,66]),'legacy.txt':Buffer.from([0xff,0xfe,0xfd]),'large.txt':Buffer.alloc(2*1024*1024+1,65),'report.pdf':Buffer.from('document'),'data.sqlite':Buffer.from('database')};
  for(const [relative,bytes] of Object.entries(samples)){
    fs.writeFileSync(file(x,relative),bytes);
    assert.throws(()=>x.editor.prepare({folderId:x.folder.id,path:relative,operation:'replace',expectedVersion:sha(bytes),edits:[{oldText:'x',newText:'y'}]}));
    assert.deepEqual(fs.readFileSync(file(x,relative)),bytes);
  }
});

test('verified backups restore exact old bytes and preserve a new recovery record', t => {
  const x=enable(fixture(t)), edited=apply(x,replace(x));
  const preview=x.editor.prepareRestore({folderId:x.folder.id,changeId:edited.changeId});
  assert.equal(preview.operation,'restore');assert.equal(fs.readFileSync(file(x),'utf8'),initial.replace('count = 1','count = 2'));
  const result=apply(x,preview);assert.equal(result.verified,true);assert.deepEqual(fs.readFileSync(file(x)),Buffer.from(initial));
  const history=x.editor.history(x.folder.id);assert.equal(history.changes.length,2);assert.ok(history.changes.some(change=>change.operation==='restore'));
  const recoveryBackup=path.join(x.editor.area,'changes',result.changeId,'before.bin');
  assert.equal(fs.readFileSync(recoveryBackup,'utf8'),initial.replace('count = 1','count = 2'));
});

test('restoration refuses subsequent edits, cross-project records and tampered backups', t => {
  const x=enable(fixture(t)), result=apply(x,replace(x));
  fs.writeFileSync(file(x),'manual later edit\n');
  assert.throws(()=>x.editor.prepareRestore({folderId:x.folder.id,changeId:result.changeId}), /又有变化|不能覆盖/);
  assert.equal(fs.readFileSync(file(x),'utf8'),'manual later edit\n');
  fs.writeFileSync(file(x),initial.replace('count = 1','count = 2'));
  const other=x.store.add(x.outside,'Other synthetic project');x.store.update(other.id,{editable:true});
  assert.throws(()=>x.editor.prepareRestore({folderId:other.id,changeId:result.changeId}), /没有可恢复/);
  fs.writeFileSync(path.join(x.editor.area,'changes',result.changeId,'before.bin'),'tampered bytes');
  assert.throws(()=>x.editor.prepareRestore({folderId:x.folder.id,changeId:result.changeId}), /备份校验/);
  assert.equal(fs.readFileSync(file(x),'utf8'),initial.replace('count = 1','count = 2'));
});

test('proposal retries, competing writes and restarts preserve file integrity and recoverable history', t => {
  const x=enable(fixture(t)), first=replace(x), second=replace(x,{edits:[{oldText:'const count = 1;',newText:'const count = 3;'}]});
  const result=apply(x,first), inode=fs.statSync(file(x)).ino;
  const duplicate=apply(x,first);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.changeId,result.changeId);assert.equal(fs.statSync(file(x)).ino,inode);
  assert.throws(()=>apply(x,second), /文件已经变化/);
  assert.equal(fs.readFileSync(file(x),'utf8'),initial.replace('count = 1','count = 2'));assert.equal(x.editor.history(x.folder.id).changes.length,1);
  const pending=replace(x,{edits:[{oldText:'const count = 2;',newText:'const count = 4;'}]});
  const restarted=new Editor(x.store);
  assert.throws(()=>restarted.apply({proposalId:pending.proposalId}), /重启|会话/);
  assert.throws(()=>restarted.apply({proposalId:first.proposalId}), /重启|会话/);
  assert.equal(restarted.history(x.folder.id).changes.length,1);
  const recovery=restarted.prepareRestore({folderId:x.folder.id,changeId:result.changeId});
  assert.ok(restarted.apply({proposalId:recovery.proposalId}).verified);
  assert.equal(fs.readFileSync(file(x),'utf8'),initial);
});

test('audit, backup and capacity failures reject before changing project files or creating project directories', t => {
  for(const failure of ['audit','backup','capacity']){
    const x=enable(fixture(t)), p=replace(x);
    if(failure==='audit')x.store.audit=()=>{throw new Error('synthetic audit failure');};
    if(failure==='backup')fs.writeFileSync(path.join(x.editor.area,'changes',p.proposalId),'blocks directory creation');
    if(failure==='capacity'){
      const dir=path.join(x.editor.area,'changes',crypto.randomUUID());fs.mkdirSync(dir);const fd=fs.openSync(path.join(dir,'before.bin'),'w');fs.ftruncateSync(fd,BACKUP_LIMIT);fs.closeSync(fd);
    }
    assert.throws(()=>apply(x,p));assert.equal(fs.readFileSync(file(x),'utf8'),initial);
    const created=x.editor.prepare({folderId:x.folder.id,path:'new/nested/file.txt',operation:'create',content:'new file'});
    if(failure==='backup')fs.writeFileSync(path.join(x.editor.area,'changes',created.proposalId),'blocks directory creation');
    assert.throws(()=>apply(x,created));assert.equal(fs.existsSync(file(x,'new')),false);
  }
});

test('official HTTP SDK performs the edit and restore chain while MCP credentials cannot change local grants', async t => {
  const x=fixture(t), service=await startServer({store:x.store});
  t.after(()=>new Promise(resolve=>service.server.close(resolve)));
  const base=`http://127.0.0.1:${service.port}`;
  for(const headers of [{Authorization:'Bearer '+service.mcpToken},{'X-LocalReader-Token':service.mcpToken}]){
    const response=await fetch(base+'/api/folders/update',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({id:x.folder.id,editable:true})});assert.equal(response.status,401);
  }
  assert.equal(x.store.load().folders[0].editable,false);
  const client=new Client({name:'editor-http-fixture',version:'1.0'});
  await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+service.mcpToken}}}));t.after(()=>client.close());
  const tools=(await client.listTools()).tools;assert.equal(tools.length,13);
  for(const tool of tools){assert.equal(tool.annotations.readOnlyHint,tool.name!=='apply_edit');assert.equal(tool.annotations.destructiveHint,tool.name==='apply_edit');}
  const args={folderId:x.folder.id,path:'app.js',operation:'replace',expectedVersion:sha(initial),edits:[{oldText:'const count = 1;',newText:'const count = 2;'}]};
  assert.equal((await client.callTool({name:'prepare_edit',arguments:args})).isError,true);
  const authorized=await fetch(base+'/api/folders/update',{method:'POST',headers:{'Content-Type':'application/json','X-LocalReader-Token':service.adminToken},body:JSON.stringify({id:x.folder.id,editable:true})});assert.equal(authorized.status,200);
  const read=(await client.callTool({name:'read_file',arguments:{folderId:x.folder.id,path:'app.js'}})).structuredContent;assert.equal(read.version,sha(initial));
  const prepared=await client.callTool({name:'prepare_edit',arguments:{...args,expectedVersion:read.version}});assert.equal(prepared.isError,undefined);assert.equal(fs.readFileSync(file(x),'utf8'),initial);
  // A receipt-log failure after commit must report saved bytes with a warning,
  // rather than misleading the caller into retrying an already-applied edit.
  const originalAudit=x.store.audit.bind(x.store);
  x.store.audit=(tool,...args)=>{if(tool==='edit_applied')throw new Error('synthetic receipt audit failure');return originalAudit(tool,...args);};
  const result=await client.callTool({name:'apply_edit',arguments:{proposalId:prepared.structuredContent.proposalId}});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.verified,true);assert.match(result.structuredContent.warning,/文件已保存/);
  x.store.audit=originalAudit;
  const readback=(await client.callTool({name:'read_file',arguments:{folderId:x.folder.id,path:'app.js'}})).structuredContent;assert.match(readback.content,/count = 2/);assert.equal(readback.version,result.structuredContent.version);
  const changes=(await client.callTool({name:'list_changes',arguments:{folderId:x.folder.id}})).structuredContent;assert.equal(changes.changes.length,1);assert.ok(!JSON.stringify(changes).includes(x.project));
  const restoration=(await client.callTool({name:'prepare_restore',arguments:{folderId:x.folder.id,changeId:changes.changes[0].id}})).structuredContent;
  assert.equal((await client.callTool({name:'apply_edit',arguments:{proposalId:restoration.proposalId}})).isError,undefined);assert.equal(fs.readFileSync(file(x),'utf8'),initial);
  await client.close();
});

test('official stdio SDK reloads local grants and performs a genuine file edit with returned version', async t => {
  const x=fixture(t);
  const client=new Client({name:'editor-stdio-fixture',version:'1.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('src/server.js'),'--stdio'],env:{LOCALREADER_DATA_DIR:x.store.dir,PATH:process.env.PATH || '/usr/bin:/bin'},stderr:'pipe'});
  await client.connect(transport);t.after(()=>client.close());
  const before=(await client.callTool({name:'list_folders',arguments:{}})).structuredContent;assert.equal(before.folders[0].editable,false);
  enable(x);assert.equal((await client.callTool({name:'list_folders',arguments:{}})).structuredContent.folders[0].editable,true);
  const read=(await client.callTool({name:'read_file',arguments:{folderId:x.folder.id,path:'app.js'}})).structuredContent;
  const p=await client.callTool({name:'prepare_edit',arguments:{folderId:x.folder.id,path:'app.js',operation:'replace',expectedVersion:read.version,edits:[{oldText:'const count = 1;',newText:'const count = 9;'}]}});assert.equal(p.isError,undefined);
  const result=await client.callTool({name:'apply_edit',arguments:{proposalId:p.structuredContent.proposalId}});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.version,sha(fs.readFileSync(file(x))));assert.match(fs.readFileSync(file(x),'utf8'),/count = 9/);
  x.store.pause(true);assert.equal((await client.callTool({name:'read_file',arguments:{folderId:x.folder.id,path:'app.js'}})).isError,true);
  await client.close();
});
