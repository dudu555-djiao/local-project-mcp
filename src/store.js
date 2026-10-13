import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const dataDir = process.env.LOCALREADER_DATA_DIR || path.join(os.homedir(), 'Library/Application Support/LocalReaderMCP');
export class Store {
  constructor(dir = dataDir) {
    this.dir = dir;
    this.file = path.join(dir, 'settings.json');
    this.auditFile = path.join(dir, 'access.jsonl');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(this.file)) this.save({ version: 1, paused: false, accessEpoch: crypto.randomUUID(), folders: [] });
  }
  load() {
    const c = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (c.version !== 1 || !Array.isArray(c.folders)) throw new Error('设置文件格式不正确。请恢复 settings.json 的备份。');
    return c;
  }
  save(c) {
    const temp = this.file + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
  add(folderPath, name) {
    if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) throw new Error('请选择一个绝对路径文件夹。');
    const root = fs.realpathSync(folderPath);
    if (!fs.statSync(root).isDirectory()) throw new Error('选择的路径不是文件夹。');
    if (root === '/' || root === os.homedir() || /(^|\/)(\.ssh|\.aws|\.gnupg|\.codex|Keychains)(\/|$)/i.test(root)) throw new Error('请选择具体的资料或项目文件夹，不能选择整块磁盘、用户主目录或凭据目录。');
    const privateDir = fs.realpathSync(this.dir);
    if (root === privateDir || root.startsWith(privateDir + path.sep) || privateDir.startsWith(root + path.sep)) throw new Error('应用设置和备份目录不能作为项目授权。');
    const c = this.load();
    if (c.folders.some(f => f.path === root)) throw new Error('这个文件夹已经添加。');
    const folder = { id: crypto.randomUUID().slice(0, 8), name: (name || path.basename(root)).trim().slice(0, 80), path: root, enabled: true, editable: false, editEpoch: crypto.randomUUID(), createdAt: new Date().toISOString() };
    c.folders.push(folder); this.save(c);
    this.audit('folder_added', { folderId: folder.id }, 'ok');
    return folder;
  }
  update(id, change) {
    const c = this.load(), f = c.folders.find(f => f.id === id);
    if (!f) throw new Error('未找到文件夹。');
    if ((typeof change.enabled === 'boolean' && f.enabled !== change.enabled) || (typeof change.editable === 'boolean' && !!f.editable !== change.editable)) f.editEpoch = crypto.randomUUID();
    if (typeof change.enabled === 'boolean') f.enabled = change.enabled;
    if (typeof change.editable === 'boolean') f.editable = change.editable;
    if (typeof change.name === 'string' && change.name.trim()) f.name = change.name.trim().slice(0, 80);
    this.save(c); this.audit('folder_updated', { folderId: id }, 'ok'); return f;
  }
  remove(id) {
    const c = this.load(); c.folders = c.folders.filter(f => f.id !== id); this.save(c);
    this.audit('folder_removed', { folderId: id }, 'ok');
  }
  pause(paused) {
    const c = this.load(); if (c.paused !== !!paused) c.accessEpoch = crypto.randomUUID(); c.paused = !!paused; this.save(c); this.audit(paused ? 'paused' : 'resumed', {}, 'ok');
  }
  folder(id) {
    const c = this.load();
    if (c.paused) throw new Error('本地读取已暂停，请在本地资料助手中恢复。');
    const f = c.folders.find(f => f.id === id && f.enabled);
    if (!f) throw new Error('文件夹未授权、已停用或已移除。先调用 list_folders 获取可用 ID。');
    if (fs.realpathSync(f.path) !== f.path) throw new Error('文件夹路径已变化，请移除后重新添加。');
    const privateDir = fs.realpathSync(this.dir);
    if (f.path === privateDir || f.path.startsWith(privateDir + path.sep) || privateDir.startsWith(f.path + path.sep)) throw new Error('此旧授权包含应用私有设置或备份，已停止访问。请移除后选择具体项目。');
    return f;
  }
  audit(tool, input = {}, status = 'ok', durationMs = 0, errorCode = '') {
    // Record identifiers, not file contents, queries, API keys, or credential values.
    const row = { time: new Date().toISOString(), tool, folderId: input.folderId || '', path: String(input.path || '').slice(0, 300), status, durationMs, ...(errorCode ? { errorCode } : {}) };
    try {
      if (fs.existsSync(this.auditFile) && fs.statSync(this.auditFile).size > 2_000_000) {
        for (let n = 2; n >= 1; n--) if (fs.existsSync(this.auditFile + '.' + n)) fs.renameSync(this.auditFile + '.' + n, this.auditFile + '.' + (n + 1));
        fs.renameSync(this.auditFile, this.auditFile + '.1');
      }
      fs.appendFileSync(this.auditFile, JSON.stringify(row) + '\n', { mode: 0o600 });
    } catch { throw new Error('访问记录无法保存，读取结果已停止返回。请检查磁盘空间和应用资料目录权限。'); }
  }
  auditRows(limit = 100) {
    if (!fs.existsSync(this.auditFile)) return [];
    return fs.readFileSync(this.auditFile, 'utf8').trim().split('\n').filter(Boolean).slice(-limit).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean).reverse();
  }
}
