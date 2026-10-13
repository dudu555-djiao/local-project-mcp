// All project contents, credentials and personal-looking values below are synthetic test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { Store } from '../src/store.js';
import { Reader, redact } from '../src/reader.js';
import { startServer } from '../src/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'local-reader-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const project=path.join(dir,'project'),other=path.join(dir,'outside');
  await fs.mkdir(project);await fs.mkdir(other);
  await fs.writeFile(path.join(project,'app.js'),'// login\nconst login = () => true;\npassword = "private-value";\nphone = "13812345678";\n');
  await fs.writeFile(path.join(project,'README.md'),'项目说明\n登录模块位于 app.js\n');
  await fs.writeFile(path.join(project,'.env'),'APP_SECRET=secret');
  await fs.mkdir(path.join(project,'node_modules'));await fs.writeFile(path.join(project,'node_modules','x.js'),'dependency');
  await fs.writeFile(path.join(other,'secret.txt'),'outside secret');
  const store=new Store(path.join(dir,'data')),folder=store.add(project,'测试项目'),reader=new Reader(store);
  return {dir,project,other,store,folder,reader};
}
test('reads actual source with stable line numbers and redacts private values',async t=>{
  const x=await fixture(t);const out=await x.reader.readFile({folderId:x.folder.id,path:'app.js',startLine:2,limit:2});
  assert.match(out.content,/2: const login/);assert.match(out.content,/已隐藏/);assert(!out.content.includes('private-value'));assert.equal(out.nextLine,4);
});
test('rejects traversal, absolute paths, sensitive paths and symlink escapes',async t=>{
  const x=await fixture(t);await fs.symlink(path.join(x.other,'secret.txt'),path.join(x.project,'link.txt'));await fs.symlink(x.other,path.join(x.project,'linked-dir'));
  for(const p of ['../outside/secret.txt',path.join(x.other,'secret.txt'),'.env','node_modules/x.js','link.txt','linked-dir/secret.txt'])await assert.rejects(()=>x.reader.readFile({folderId:x.folder.id,path:p}));
  const listing=await x.reader.listDirectory({folderId:x.folder.id});assert(!listing.entries.some(e=>['.env','node_modules','link.txt','linked-dir'].includes(e.name)));
});
test('permissions reload immediately after pause, disable, remove, and resume',async t=>{
  const x=await fixture(t),otherReader=new Reader(new Store(x.store.dir));
  x.store.pause(true);assert.deepEqual(otherReader.listFolders().folders,[]);await assert.rejects(()=>otherReader.readFile({folderId:x.folder.id,path:'app.js'}));
  x.store.pause(false);x.store.update(x.folder.id,{enabled:false});await assert.rejects(()=>otherReader.readFile({folderId:x.folder.id,path:'app.js'}));
  x.store.update(x.folder.id,{enabled:true});assert((await otherReader.readFile({folderId:x.folder.id,path:'app.js'})).content);
  x.store.remove(x.folder.id);await assert.rejects(()=>otherReader.readFile({folderId:x.folder.id,path:'app.js'}));
});
test('bounded literal content search returns relevant lines and filters dependencies',async t=>{
  const x=await fixture(t);const out=await x.reader.searchContent({folderId:x.folder.id,query:'login',limit:1});assert.equal(out.matches.length,1);assert.equal(out.matches[0].path,'app.js');assert.equal(out.truncated,true);
  assert.deepEqual((await x.reader.searchContent({folderId:x.folder.id,query:'(a+)+$',limit:5})).matches,[]);
});
test('binary, oversized, and special files cannot be read as source',async t=>{
  const x=await fixture(t);await fs.writeFile(path.join(x.project,'binary.txt'),Buffer.from([65,0,66]));await fs.writeFile(path.join(x.project,'large.log'),Buffer.alloc(2*1024*1024+1,65));
  for(const p of ['binary.txt','large.log'])await assert.rejects(()=>x.reader.readFile({folderId:x.folder.id,path:p}));
  if(process.platform !== 'win32'){execFileSync('/usr/bin/mkfifo',[path.join(x.project,'pipe.txt')]);await assert.rejects(()=>x.reader.readFile({folderId:x.folder.id,path:'pipe.txt'}));}
});
test('SQLite queries are read-only, constrained to tables, paginated, and mask columns',async t=>{
  const x=await fixture(t),p=path.join(x.project,'business.sqlite');
  const db=new DatabaseSync(p);db.exec('CREATE TABLE jobs (id INTEGER, status TEXT, phone TEXT, student_name TEXT, api_key TEXT); INSERT INTO jobs VALUES (1,\'done\',\'13812345678\',\'真实姓名\',\'secret-key\');');db.close();
  const before=crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');
  assert.equal((await x.reader.database({folderId:x.folder.id,path:'business.sqlite'})).tables[0].name,'jobs');
  const out=await x.reader.database({folderId:x.folder.id,path:'business.sqlite',table:'jobs',limit:1,offset:0},true);
  assert.deepEqual(out.rows,[{id:1,status:'done'}]);assert(out.excludedColumns.includes('student_name'));
  await assert.rejects(()=>x.reader.database({folderId:x.folder.id,path:'business.sqlite',table:'jobs; DROP TABLE jobs',limit:1,offset:0},true));
  const after=crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');assert.equal(before,after);
});
test('local Git summary does not modify source or the index',async t=>{
  const x=await fixture(t),emptyConfig=path.join(x.dir,'empty-git.config');await fs.writeFile(emptyConfig,'');const git=args=>execFileSync(process.env.LOCALREADER_GIT || 'git',args,{cwd:x.project,env:{...process.env,GIT_CONFIG_GLOBAL:emptyConfig,GIT_CONFIG_SYSTEM:emptyConfig},stdio:'pipe',windowsHide:true});
  git(['init']);git(['add','README.md']);git(['-c','user.name=Test','-c','user.email=test@example.org','commit','-m','initial']);
  const indexBefore=await fs.readFile(path.join(x.project,'.git/index'));
  const out=await x.reader.gitSummary({folderId:x.folder.id,limit:5});assert.match(out.commits,/initial/);assert.match(out.status,/app.js/);
  assert.deepEqual(await fs.readFile(path.join(x.project,'.git/index')),indexBefore);
});
test('audit never contains file contents or query strings',async t=>{
  const x=await fixture(t);x.store.audit('search_content',{folderId:x.folder.id,path:'app.js',query:'private-value'},'ok',5);
  const log=await fs.readFile(x.store.auditFile,'utf8');assert(!log.includes('private-value'));assert(!log.includes('query'));assert.equal(x.store.auditRows(1)[0].tool,'search_content');
  if(process.platform !== 'win32')assert.equal((await fs.stat(x.store.file)).mode & 0o777,0o600);
});
test('export lists omitted files and redacts retained source',async t=>{
  const x=await fixture(t);const out=await x.reader.exportFolder(x.folder.id);assert(out.text.includes('文件：app.js'));assert(!out.text.includes('private-value'));assert(!out.text.includes('APP_SECRET'));assert(out.text.includes('导出时间'));
});
test('redaction covers API credentials, JWTs and common personal identifiers',()=>{
  const secret='sk-proj-'+ 'a'.repeat(25);const out=redact(`api_key = "${secret}"\nBearer abcdefghijklmnop\ncontact test@example.com\n13812345678\n110101199001011234`);
  for(const s of [secret,'abcdefghijklmnop','test@example.com','13812345678','110101199001011234'])assert(!out.includes(s));
});
test('HTTP MCP interoperates with the official SDK client and rejects arbitrary writes / auth bypasses',async t=>{
  const x=await fixture(t),service=await startServer({store:x.store});
  t.after(()=>new Promise(r=>service.server.close(r)));
  const url=`http://127.0.0.1:${service.port}`;
  assert.equal((await fetch(url+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(url+'/api/state')).status,401);
  assert.equal((await fetch(url+'/api/folders/add',{method:'POST',headers:{'Content-Type':'application/json','X-LocalReader-Token':service.adminToken,Origin:'https://evil.example'},body:'{}'})).status,403);
  const client=new Client({name:'test',version:'1.0'}),transport=new StreamableHTTPClientTransport(new URL(url+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+service.mcpToken}}});
  await client.connect(transport);t.after(()=>client.close());
  const tools=await client.listTools();assert.equal(tools.tools.length,13);assert(tools.tools.every(t=>t.name==='apply_edit' ? !t.annotations.readOnlyHint && t.annotations.destructiveHint : t.annotations.readOnlyHint && !t.annotations.destructiveHint));
  const folders=await client.callTool({name:'list_folders',arguments:{}});assert.equal(folders.structuredContent.folders[0].id,x.folder.id);assert(!JSON.stringify(folders).includes(x.project));
  const result=await client.callTool({name:'read_file',arguments:{folderId:x.folder.id,path:'app.js'}});assert.equal(result.isError,undefined);assert.match(result.structuredContent.content,/login/);
  const denied=await client.callTool({name:'read_file',arguments:{folderId:x.folder.id,path:'../outside/secret.txt'}});assert.equal(denied.isError,true);
  const unknown=await client.callTool({name:'write_file',arguments:{path:'app.js',content:'oops'}});assert.equal(unknown.isError,true);
  // A read must not escape the audit requirement if its log cannot be written.
  await fs.rename(x.store.auditFile,x.store.auditFile+'.saved');await fs.mkdir(x.store.auditFile);
  const noAudit=await client.callTool({name:'read_file',arguments:{folderId:x.folder.id,path:'app.js'}});
  assert.equal(noAudit.isError,true);assert(!JSON.stringify(noAudit).includes('const login'));
  await fs.rmdir(x.store.auditFile);await fs.rename(x.store.auditFile+'.saved',x.store.auditFile);
  x.store.pause(true);const paused=await client.callTool({name:'read_file',arguments:{folderId:x.folder.id,path:'app.js'}});assert.equal(paused.isError,true);
  assert((await fs.readFile(path.join(x.project,'app.js'),'utf8')).includes('const login'));
  await client.close();
});
test('stdio MCP interoperates with the official SDK and shares settings with the manager',async t=>{
  const x=await fixture(t);
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('src/server.js'),'--stdio'],env:{...process.env,LOCALREADER_DATA_DIR:x.store.dir},stderr:'pipe'});
  const client=new Client({name:'stdio-test',version:'1.0'});await client.connect(transport);t.after(()=>client.close());
  const result=await client.callTool({name:'list_folders',arguments:{}});assert.equal(result.structuredContent.folders[0].name,'测试项目');
  x.store.update(x.folder.id,{enabled:false});const after=await client.callTool({name:'list_folders',arguments:{}});assert.deepEqual(after.structuredContent.folders,[]);
  await client.close();
});
