import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { denied, fileKind, redact } from './reader.js';

const MAX_FILE = 2 * 1024 * 1024, MAX_INPUT = 500_000, TTL = 10 * 60 * 1000;
export const BACKUP_LIMIT = 200 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = bytes => 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.nlink === b.nlink;
const stamp = s => ({ dev:s.dev, ino:s.ino, size:s.size, mtimeMs:s.mtimeMs, nlink:s.nlink, mode:s.mode });
const marker = /\[已隐藏[^\]]*\]/;
function privateDirectory(dir) {
  fs.mkdirSync(dir, {recursive:true, mode:0o700});
  const s = fs.lstatSync(dir);
  if (!s.isDirectory() || s.isSymbolicLink()) throw new Error('编辑存储目录不安全，请检查本地应用资料。');
  fs.chmodSync(dir, 0o700);
}
function privateWrite(file, bytes, exclusive = true) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | (exclusive ? fs.constants.O_EXCL : fs.constants.O_TRUNC), 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function privateRead(file, max = MAX_FILE * 3) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const s = fs.fstatSync(fd);
    if (!s.isFile() || s.nlink !== 1 || s.size > max) throw new Error('编辑存储文件不安全或超过上限。');
    const bytes = fs.readFileSync(fd);
    if (bytes.length > max) throw new Error('编辑存储文件超过上限。');
    return bytes;
  } finally { fs.closeSync(fd); }
}
function jsonRead(file) { return JSON.parse(privateRead(file).toString('utf8')); }
function jsonSave(file, data) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try { privateWrite(temp, JSON.stringify(data)); fs.renameSync(temp, file); }
  finally { try { fs.unlinkSync(temp); } catch {} }
}

export class Editor {
  constructor(store, {now = () => Date.now()} = {}) {
    this.store = store; this.now = now; this.sessionId = crypto.randomUUID();
    this.privateRoot = fs.realpathSync(store.dir);
    this.area = path.join(this.privateRoot, 'editing');
    for (const d of [this.area, this.area+'/proposals', this.area+'/changes', this.area+'/locks']) privateDirectory(d);
  }
  grant(folderId) {
    const root = this.store.folder(folderId), c = this.store.load();
    if (root.editable !== true) throw new Error('此文件夹为只读。请先在本地资料助手中开启“允许编辑”。');
    return {root, epoch:(c.accessEpoch || '') + ':' + (root.editEpoch || '')};
  }
  parents(root, relative, allowMissing) {
    const chain = [{path:root.path, ...stamp(fs.lstatSync(root.path))}], missing = [];
    let current = root.path;
    for (const part of relative.split('/').slice(0,-1)) {
      current = path.join(current, part);
      const s = fs.lstatSync(current, {throwIfNoEntry:false});
      if (!s) { if (!allowMissing) throw new Error('父目录不存在。'); missing.push(current); continue; }
      if (missing.length || !s.isDirectory() || s.isSymbolicLink() || fs.realpathSync(current) !== current) throw new Error('编辑路径包含符号链接或非普通目录。');
      chain.push({path:current, ...stamp(s)});
    }
    return {chain, missing};
  }
  checkParents(chain) {
    for (const p of chain) {
      const s = fs.lstatSync(p.path);
      if (!s.isDirectory() || s.isSymbolicLink() || s.dev !== p.dev || s.ino !== p.ino || fs.realpathSync(p.path) !== p.path) throw new Error('父目录已经变化，请重新读取并预览。');
    }
  }
  inspect(folderId, relative, {allowMissing = false, requireEdit = true} = {}) {
    const {root, epoch} = requireEdit ? this.grant(folderId) : {root:this.store.folder(folderId),epoch:null};
    if (typeof relative !== 'string' || !relative || relative.includes('\0') || relative.includes('\\') || path.isAbsolute(relative) || relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('编辑路径必须是规范的项目内相对文件路径。');
    if (denied(relative) || fileKind(path.basename(relative)) !== 'text') throw new Error('仅编辑源码与文本；凭据、依赖、构建、文档和数据库路径不可编辑。');
    const target = path.join(root.path, relative);
    if (target === this.privateRoot || target.startsWith(this.privateRoot + path.sep)) throw new Error('不允许编辑应用设置、提案或备份。');
    const {chain, missing} = this.parents(root, relative, allowMissing);
    const s = fs.lstatSync(target, {throwIfNoEntry:false});
    if (!s) {
      if (!allowMissing) throw new Error('文件不存在。新建文件请使用 create 操作。');
      this.checkParents(chain);
      return {root, epoch, target, chain, missing, version:'missing', bytes:null, text:null, stat:null};
    }
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > MAX_FILE) throw new Error('不编辑符号链接、硬链接、特殊文件或超过 2 MiB 的文件。');
    const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    let bytes, current;
    try {
      current = fs.fstatSync(fd);
      if (!sameFile(s,current) || !current.isFile() || current.nlink !== 1) throw new Error('读取前文件已经变化。');
      bytes = fs.readFileSync(fd);
      if (!sameFile(current,fs.fstatSync(fd)) || bytes.length > MAX_FILE || bytes.includes(0)) throw new Error('文件变化、过大或包含二进制内容。');
    } finally { fs.closeSync(fd); }
    let text;
    try { text = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes); }
    catch { throw new Error('编辑只支持 UTF-8 文本；其他编码可读取，但请先在本机转换。'); }
    this.checkParents(chain);
    if (!sameFile(current,fs.lstatSync(target))) throw new Error('读取后文件已经变化。');
    return {root, epoch, target, chain, missing, version:hash(bytes), bytes, text, stat:stamp(current)};
  }
  pruneProposals() {
    let pending = 0;
    for (const name of fs.readdirSync(this.area+'/proposals')) {
      if (!name.endsWith('.json') || !uuid.test(name.slice(0,-5))) continue;
      const file = this.area+'/proposals/'+name, p = jsonRead(file);
      if ((p.status === 'pending' && p.expiresAt < this.now()) || (p.status === 'applied' && p.createdAtMs + 86400000 < this.now())) fs.unlinkSync(file);
      else if (p.status === 'pending' && p.sessionId === this.sessionId) pending++;
    }
    if (pending >= 20) throw new Error('待应用提案已达到 20 个，请应用现有提案或等待其过期。');
  }
  proposal(snapshot, folderId, relative, nextText, operation, preview, extra = {}) {
    if (Buffer.byteLength(nextText) > MAX_FILE || nextText.includes('\0')) throw new Error('修改后文件超过 2 MiB 或包含二进制内容。');
    this.pruneProposals();
    const id = crypto.randomUUID(), time = this.now();
    const p = {id, sessionId:this.sessionId, folderId, path:relative, root:snapshot.root.path, epoch:snapshot.epoch, chain:snapshot.chain, beforeVersion:snapshot.version, beforeStat:snapshot.stat, afterVersion:hash(Buffer.from(nextText)), nextText, operation, status:'pending', createdAtMs:time, expiresAt:time+TTL, ...extra};
    privateWrite(this.area+'/proposals/'+id+'.json',JSON.stringify(p));
    return {proposalId:id, folderId, path:relative, operation, beforeVersion:p.beforeVersion, afterVersion:p.afterVersion, expiresAt:new Date(p.expiresAt).toISOString(), preview, requiresApply:true, guidance:'预览尚未修改项目。确认此差异后调用 apply_edit；不要替换含脱敏占位符的整份文件。'};
  }
  prepare({folderId, path:relative, operation, expectedVersion, edits, content}) {
    if (!['replace','create'].includes(operation)) throw new Error('仅支持 replace 或 create 操作。');
    const s = this.inspect(folderId, relative, {allowMissing:operation === 'create'});
    if (operation === 'create') {
      if (s.version !== 'missing') throw new Error('文件已经存在；create 不会覆盖已有文件。');
      if (typeof content !== 'string' || content.length > MAX_INPUT || edits !== undefined || marker.test(content)) throw new Error('新建文件需要 content，不能含脱敏占位符，也不能同时提供 edits。');
      return this.proposal(s,folderId,relative,content,operation,{content:redact(content).slice(0,24000),truncated:content.length>24000,createsDirectories:s.missing.map(p=>path.relative(s.root.path,p))});
    }
    if (expectedVersion !== s.version) throw new Error('文件版本不一致。请先 read_file 获取最新 version，再生成预览。');
    if (content !== undefined || !Array.isArray(edits) || !edits.length || edits.length > 20) throw new Error('replace 需要 1–20 个精确旧新片段 edits，不接受整文件 content。');
    let next = s.text, chars = 0, preview = [], previewBudget = 24000;
    const crlf = s.text.includes('\r\n') && !/(?<!\r)\n/.test(s.text);
    for (const edit of edits) {
      if (typeof edit.oldText !== 'string' || !edit.oldText || typeof edit.newText !== 'string') throw new Error('每处编辑必须有非空 oldText 和字符串 newText。');
      chars += edit.oldText.length + edit.newText.length;
      if (chars > MAX_INPUT || marker.test(edit.oldText) || marker.test(edit.newText) || redact(edit.oldText) !== edit.oldText) throw new Error('编辑内容过大或涉及被隐藏的字段，请缩小到可见的代码片段。');
      const oldText = crlf ? edit.oldText.replace(/\r?\n/g,'\r\n') : edit.oldText;
      const newText = crlf ? edit.newText.replace(/\r?\n/g,'\r\n') : edit.newText;
      const at = next.indexOf(oldText);
      if (at < 0 || next.indexOf(oldText,at+1) >= 0) throw new Error('oldText 必须在当前文件中精确匹配一次，请扩大唯一上下文后重试。');
      if (oldText === newText) throw new Error('新旧内容相同，没有需要保存的修改。');
      const before = redact(oldText), after = redact(newText), half = Math.floor(previewBudget/2);
      preview.push({line:next.slice(0,at).split('\n').length, oldText:before.slice(0,half), newText:after.slice(0,half), truncated:before.length>half||after.length>half});
      previewBudget -= Math.min(before.length,half)+Math.min(after.length,half);
      next = next.slice(0,at) + newText + next.slice(at+oldText.length);
    }
    return this.proposal(s,folderId,relative,next,operation,{edits:preview});
  }
  metadata(changeId) {
    if (!uuid.test(changeId)) throw new Error('修改记录 ID 格式不正确。');
    return jsonRead(this.area+'/changes/'+changeId+'/meta.json');
  }
  recoverMetadata(m) {
    if (m.state !== 'prepared') return m;
    try {
      const s = this.inspect(m.folderId,m.path,{requireEdit:false,allowMissing:true});
      const validBackup = m.beforeVersion === 'missing' || hash(privateRead(this.area+'/changes/'+m.id+'/before.bin',MAX_FILE)) === m.beforeVersion;
      if (s.version === m.afterVersion && validBackup) {
        m.state = 'committed'; m.recovered = true;
        try { jsonSave(this.area+'/changes/'+m.id+'/meta.json',m); } catch { /* Keep a visible, verifiable recovery entry even when storage remains full. */ }
      } else if (s.version !== m.beforeVersion) m.state = 'needsReview';
    } catch { m.state = 'needsReview'; }
    return m;
  }
  history(folderId) {
    this.store.folder(folderId);
    const changes = [];
    let backupBytes = 0;
    for (const id of fs.readdirSync(this.area+'/changes')) {
      if (!uuid.test(id)) continue;
      const backup = this.area+'/changes/'+id+'/before.bin';
      const backupStat = fs.lstatSync(backup,{throwIfNoEntry:false});
      if (backupStat) backupBytes += backupStat.size;
      if (!fs.existsSync(this.area+'/changes/'+id+'/meta.json')) continue;
      let m = this.metadata(id);
      if (m.folderId === folderId) m = this.recoverMetadata(m);
      if (m.folderId === folderId && ['committed','needsReview'].includes(m.state)) {
        const {path,operation,createdAt,beforeVersion,afterVersion} = m;
        changes.push({id,path,operation,createdAt,beforeVersion,afterVersion,state:m.state,recovered:!!m.recovered,canRestore:m.state==='committed'&&beforeVersion!=='missing',...(m.state==='needsReview'?{restoreDisabledReason:'保存结果或后续文件变化需要核对，备份仍保留；不要强制覆盖。'}:{})});
      }
    }
    return {changes:changes.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100),backupBytes,backupLimitBytes:BACKUP_LIMIT,note:'保留旧文件完整内容的私有备份，不自动清理。达到 200 MiB 后拒绝新写入。新建文件没有旧内容，本版不通过恢复删除文件。'};
  }
  prepareRestore({folderId, changeId}) {
    const m = this.recoverMetadata(this.metadata(changeId));
    if (m.folderId !== folderId || m.state !== 'committed' || m.beforeVersion === 'missing') throw new Error('这条记录没有可恢复的旧文件内容。');
    const s = this.inspect(folderId,m.path);
    if (s.version !== m.afterVersion) throw new Error('文件在这次修改后又有变化，不能覆盖。请先读取当前文件，合并所需内容。');
    const before = privateRead(this.area+'/changes/'+changeId+'/before.bin',MAX_FILE);
    if (hash(before) !== m.beforeVersion) throw new Error('备份校验失败，停止恢复。');
    const text = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(before);
    return this.proposal(s,folderId,m.path,text,'restore',{fromChangeId:changeId,before:redact(s.text).slice(0,12000),after:redact(text).slice(0,12000),truncated:s.text.length>12000||text.length>12000},{restoresChangeId:changeId});
  }
  lock(target) {
    const file = this.area+'/locks/'+crypto.createHash('sha256').update(target).digest('hex')+'.lock';
    try { privateWrite(file,JSON.stringify({pid:process.pid})); }
    catch(e) {
      if (e.code !== 'EEXIST') throw e;
      const old = jsonRead(file); let dead = false;
      try { process.kill(old.pid,0); } catch(error) { dead = error.code === 'ESRCH'; }
      if (!dead) throw new Error('另一个编辑操作正在保存此文件，请稍后重试。');
      fs.unlinkSync(file); privateWrite(file,JSON.stringify({pid:process.pid}));
    }
    return () => { try { fs.unlinkSync(file); } catch {} };
  }
  apply({proposalId}) {
    if (!uuid.test(proposalId)) throw new Error('提案 ID 格式不正确。');
    const proposalFile = this.area+'/proposals/'+proposalId+'.json', p = jsonRead(proposalFile);
    if (p.sessionId !== this.sessionId) throw new Error('服务已经重启或此提案属于其他会话，请重新生成预览。');
    const grant = this.grant(p.folderId);
    if (grant.epoch !== p.epoch || grant.root.path !== p.root) throw new Error('访问权限已经变化，旧提案失效。请重新读取并生成预览。');
    if (p.status === 'applied') {
      const current = this.inspect(p.folderId,p.path,{allowMissing:true});
      return {...p.result,duplicate:true,currentVersion:current.version,changedSinceApply:current.version!==p.afterVersion,guidance:'此 ID 已应用；本次没有再次写入。请读取当前文件核对后续变化。'};
    }
    if (p.expiresAt < this.now()) throw new Error('提案已超过 10 分钟，请重新读取并生成预览。');
    const unlock = this.lock(path.join(p.root,p.path));
    let temp, createdDirs = [], written = false, writtenMeta;
    try {
      const s = this.inspect(p.folderId,p.path,{allowMissing:p.operation==='create'});
      this.checkParents(p.chain);
      const changeDir = this.area+'/changes/'+p.id, metaFile = changeDir+'/meta.json';
      const previous = fs.existsSync(metaFile) ? this.metadata(p.id) : null;
      if (previous?.state === 'committed' && previous.afterVersion === p.afterVersion && previous.beforeVersion === p.beforeVersion) {
        const result = this.complete(p,proposalFile,previous,true);
        return {...result,duplicate:true,currentVersion:s.version,changedSinceApply:s.version!==p.afterVersion,guidance:'此修改已有完成记录；本次没有再次写入，请核对当前文件。'};
      }
      if (previous?.afterVersion === s.version && previous.beforeVersion === p.beforeVersion) return this.complete(p,proposalFile,previous,true);
      if (s.version !== p.beforeVersion || (p.beforeStat && !sameFile(s.stat,p.beforeStat))) throw new Error('文件已经变化，提案未应用。请重新读取并生成预览。');
      if (hash(Buffer.from(p.nextText)) !== p.afterVersion) throw new Error('提案内容校验失败。');
      const usage = this.history(p.folderId).backupBytes;
      if (usage >= BACKUP_LIMIT || usage + (s.bytes?.length || 0) > BACKUP_LIMIT) throw new Error('私有备份已达到 200 MiB 上限，请在本机归档备份后再编辑。');
      // Audit and durable backup must succeed before any project mutation.
      this.store.audit('edit_started',{folderId:p.folderId,path:p.path},'ok');
      privateDirectory(changeDir);
      if (s.bytes) {
        const backupFile = changeDir+'/before.bin';
        if (!fs.existsSync(backupFile)) privateWrite(backupFile,s.bytes);
        if (hash(privateRead(backupFile,MAX_FILE)) !== p.beforeVersion) throw new Error('旧文件备份校验失败。');
      }
      const meta = {id:p.id,folderId:p.folderId,path:p.path,operation:p.operation,createdAt:new Date(this.now()).toISOString(),beforeVersion:p.beforeVersion,afterVersion:p.afterVersion,backupBytes:s.bytes?.length || 0,state:'prepared'};
      jsonSave(metaFile,meta);
      writtenMeta = meta;
      for (const d of s.missing) { this.checkParents(s.chain); fs.mkdirSync(d,{mode:0o755}); createdDirs.push(d); s.chain.push({path:d,...stamp(fs.lstatSync(d))}); }
      this.checkParents(s.chain);
      temp = path.join(path.dirname(s.target),'.local-reader-'+crypto.randomUUID()+'.tmp');
      const fd = fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,s.stat ? s.stat.mode & 0o777 : 0o644);
      try { fs.writeFileSync(fd,p.nextText,'utf8'); fs.fsyncSync(fd); if (s.stat) fs.fchmodSync(fd,s.stat.mode & 0o777); } finally { fs.closeSync(fd); }
      // Synchronous validation/commit keeps our HTTP and stdio callbacks from interleaving.
      const final = this.inspect(p.folderId,p.path,{allowMissing:p.operation==='create'});
      if (final.epoch !== p.epoch || final.version !== p.beforeVersion || (p.beforeStat && !sameFile(final.stat,p.beforeStat))) throw new Error('保存前文件或权限发生变化，已停止。');
      this.checkParents(s.chain);
      if (p.operation === 'create') { fs.linkSync(temp,s.target); written = true; fs.unlinkSync(temp); }
      else { fs.renameSync(temp,s.target); written = true; }
      temp = null;
      const verify = this.inspect(p.folderId,p.path);
      if (verify.version !== p.afterVersion) throw new Error('写入后的内容校验失败；请检查修改记录和备份，不要重复覆盖。');
      return this.complete(p,proposalFile,meta,false);
    } catch (error) {
      if (written) return this.complete(p,proposalFile,writtenMeta,false,false);
      throw error;
    } finally {
      if (temp) { try { fs.unlinkSync(temp); } catch {} }
      for (const dir of createdDirs.reverse()) { try { fs.rmdirSync(dir); } catch {} }
      unlock();
    }
  }
  complete(p,proposalFile,meta,recovered,verified = true) {
    const result = {applied:true,verified,changeId:p.id,folderId:p.folderId,path:p.path,operation:p.operation,beforeVersion:p.beforeVersion,version:p.afterVersion,recovered,canRestore:verified&&p.beforeVersion!=='missing',guidance:verified?'本机文件已保存并通过 SHA256 读回核验。可再调用 read_file 检查；本工具没有执行测试或上线。':'文件已执行写入，但读回检查未完成。请核对当前文件与备份，不要重复覆盖；本工具没有执行测试或上线。'};
    meta.state = verified ? 'committed' : 'prepared';
    if (!verified) result.warning = '保存结果尚未核验，修改历史会重新检查当前文件；存在后续变化时需人工核对。';
    try { jsonSave(this.area+'/changes/'+p.id+'/meta.json',meta); }
    catch { result.receiptPending = true; result.warning = '文件已写入，但完成记录暂未保存。修改历史会依据文件与备份校验恢复记录。'; }
    delete p.nextText; p.status = 'applied'; p.result = result;
    try { jsonSave(proposalFile,p); }
    catch { result.receiptPending = true; result.warning = '文件已写入，但提案回执暂未保存。请检查修改历史；不要重复生成相同修改。'; }
    try { this.store.audit('edit_applied',{folderId:p.folderId,path:p.path},'ok'); }
    catch { result.warning = '文件已保存，但完成日志无法写入。请检查本机磁盘。'; }
    return result;
  }
}
