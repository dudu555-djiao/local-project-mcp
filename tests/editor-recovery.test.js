// Fault injection uses only synthetic projects in temporary directories.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Store } from '../src/store.js';
import { Editor } from '../src/editor.js';

const original='const value = "before";\n';
const changed='const value = "after";\n';
function fixture(t){
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'local-reader-recovery-test-')));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const project=path.join(dir,'project');fs.mkdirSync(project);
  const target=path.join(project,'app.js');fs.writeFileSync(target,original);
  const store=new Store(path.join(dir,'data')),folder=store.add(project,'Recovery synthetic project');store.update(folder.id,{editable:true});
  const editor=new Editor(store);
  const proposal=editor.prepare({folderId:folder.id,path:'app.js',operation:'replace',expectedVersion:'sha256:'+crypto.createHash('sha256').update(original).digest('hex'),edits:[{oldText:'"before"',newText:'"after"'}]});
  return{dir,target,store,folder,editor,proposal};
}
function failRename(destination,occurrence,action){
  const realRename=fs.renameSync;let matches=0;
  fs.renameSync=(from,to)=>{
    if(String(to)===destination&&++matches===occurrence){const error=new Error('synthetic storage full');error.code='ENOSPC';throw error;}
    return realRename(from,to);
  };
  try{return{result:action(),get matches(){return matches;}};}
  finally{fs.renameSync=realRename;}
}

test('post-write metadata ENOSPC reports saved bytes and restart reconstructs a verified recoverable record',t=>{
  const x=fixture(t),meta=path.join(x.editor.area,'changes',x.proposal.proposalId,'meta.json');
  const fault=failRename(meta,2,()=>x.editor.apply({proposalId:x.proposal.proposalId}));
  assert.equal(fault.matches,2);assert.equal(fault.result.applied,true);assert.equal(fault.result.verified,true);assert.equal(fault.result.receiptPending,true);
  assert.equal(fs.readFileSync(x.target,'utf8'),changed);assert.equal(JSON.parse(fs.readFileSync(meta,'utf8')).state,'prepared');
  const backup=path.join(path.dirname(meta),'before.bin');assert.deepEqual(fs.readFileSync(backup),Buffer.from(original));
  const restarted=new Editor(x.store),history=restarted.history(x.folder.id);
  assert.equal(history.changes.length,1);assert.equal(history.changes[0].state,'committed');assert.equal(history.changes[0].recovered,true);assert.equal(history.changes[0].canRestore,true);
  const savedMeta=JSON.parse(fs.readFileSync(meta,'utf8'));assert.equal(savedMeta.state,'committed');assert.equal(savedMeta.recovered,true);
  const recovery=restarted.prepareRestore({folderId:x.folder.id,changeId:x.proposal.proposalId});
  assert.equal(fs.readFileSync(x.target,'utf8'),changed);
  const restored=restarted.apply({proposalId:recovery.proposalId});assert.equal(restored.applied,true);assert.equal(restored.verified,true);assert.equal(fs.readFileSync(x.target,'utf8'),original);
});

test('proposal receipt ENOSPC never reports an unapplied write and retry saves the receipt without rewriting the project',t=>{
  const x=fixture(t),receipt=path.join(x.editor.area,'proposals',x.proposal.proposalId+'.json');
  const fault=failRename(receipt,1,()=>x.editor.apply({proposalId:x.proposal.proposalId}));
  assert.equal(fault.matches,1);assert.equal(fault.result.applied,true);assert.equal(fault.result.verified,true);assert.equal(fault.result.receiptPending,true);
  assert.equal(fs.readFileSync(x.target,'utf8'),changed);assert.equal(JSON.parse(fs.readFileSync(receipt,'utf8')).status,'pending');
  const beforeRetry=fs.statSync(x.target);
  const retried=x.editor.apply({proposalId:x.proposal.proposalId});assert.equal(retried.applied,true);assert.equal(retried.verified,true);assert.equal(retried.recovered,true);
  const afterRetry=fs.statSync(x.target);assert.equal(afterRetry.ino,beforeRetry.ino);assert.equal(afterRetry.mtimeMs,beforeRetry.mtimeMs);assert.equal(fs.readFileSync(x.target,'utf8'),changed);
  assert.equal(JSON.parse(fs.readFileSync(receipt,'utf8')).status,'applied');assert.equal(x.editor.history(x.folder.id).changes.length,1);
  const duplicate=x.editor.apply({proposalId:x.proposal.proposalId});assert.equal(duplicate.duplicate,true);assert.equal(fs.statSync(x.target).ino,beforeRetry.ino);
});

test('unfinished metadata plus a subsequent external edit remains visible for review and cannot force restoration',t=>{
  const x=fixture(t),meta=path.join(x.editor.area,'changes',x.proposal.proposalId,'meta.json');
  const fault=failRename(meta,2,()=>x.editor.apply({proposalId:x.proposal.proposalId}));assert.equal(fault.result.receiptPending,true);
  fs.writeFileSync(x.target,'external later edit must survive\n');
  const restarted=new Editor(x.store),history=restarted.history(x.folder.id);
  assert.equal(history.changes.length,1);assert.equal(history.changes[0].state,'needsReview');assert.equal(history.changes[0].canRestore,false);assert.ok(history.changes[0].restoreDisabledReason);
  assert.throws(()=>restarted.prepareRestore({folderId:x.folder.id,changeId:x.proposal.proposalId}),/没有可恢复/);
  assert.equal(fs.readFileSync(x.target,'utf8'),'external later edit must survive\n');
  assert.deepEqual(fs.readFileSync(path.join(path.dirname(meta),'before.bin')),Buffer.from(original));
});
