const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, clipboard, safeStorage, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { validateConnection, assessConnection, healthURL } = require('./host-utils.cjs');

const sourceRoot = path.resolve(__dirname, '..');
const serviceDir = app.isPackaged ? path.join(process.resourcesPath,'service') : sourceRoot;
const runtimeDir = app.isPackaged ? path.join(process.resourcesPath,'runtime') : path.join(sourceRoot,'.cache','windows-runtime');
const dataDir = path.join(app.getPath('appData'), '..', 'Local', 'LocalReaderMCP');
// LOCALAPPDATA is the Windows platform data location; no installed Mac profile is imported.
const profile = path.resolve(process.env.LOCALREADER_DATA_DIR || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA,'LocalReaderMCP') : dataDir));
const configPath = path.join(profile,'connection.json'), keyPath = path.join(profile,'runtime-key.dat'), healthFile = path.join(profile,'tunnel-health.url');
const formURL = pathToFileURL(path.join(__dirname,'form.html')).href;
const adminToken = crypto.randomBytes(32).toString('hex'), mcpToken = crypto.randomBytes(32).toString('hex');
let mainWindow, formWindow, formInfo, tray, backend, tunnel, serviceURL, diagnosticsURL, healthTimer, healthBusy = false, quitting = false;
let config = {tunnelId:'',organization:'',proxy:'',rememberKey:false}, runtimeKey = '';
let connection = {state:'unconfigured',detail:''};

function atomicWrite(file, bytes) {
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(temporary, bytes, {mode:0o600,flag:'wx'}); fs.renameSync(temporary,file); }
  finally { fs.rmSync(temporary,{force:true}); }
}

function prepareProfile() {
  fs.mkdirSync(profile,{recursive:true});
  if (fs.lstatSync(profile).isSymbolicLink() || !fs.lstatSync(profile).isDirectory()) throw new Error('应用资料目录不安全。');
  if (process.platform === 'win32') {
    const sid = execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}).match(/S-1-5-\d+(?:-\d+)+/)?.[0];
    if (!sid) throw new Error('无法确认当前 Windows 用户。');
    // chmod modes do not provide Windows ACL isolation. Fail closed if the ACL
    // cannot be restricted to the current account and the SYSTEM account.
    execFileSync('icacls.exe',[profile,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true,stdio:'pipe'});
  }
}

function childEnvironment() {
  const env = {...process.env};
  for (const name of ['OPENAI_API_KEY','OPENAI_ADMIN_KEY','CONTROL_PLANE_API_KEY','LOCALREADER_MCP_AUTH','NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE']) delete env[name];
  return env;
}

function emit(value) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('localreader:event',value); }
function toast(message,error=false) { emit({type:'toast',message,error}); }
function status() { emit({type:'connection',...connection,tunnelId:config.tunnelId,clientAvailable:fs.existsSync(path.join(runtimeDir,'tunnel-client.exe'))}); }
function mainSender(event) { return mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame && new URL(event.senderFrame.url).origin === serviceURL && new URL(event.senderFrame.url).pathname === '/'; }
function formSender(event) { return formWindow && event.sender === formWindow.webContents && event.senderFrame === formWindow.webContents.mainFrame && event.senderFrame.url === formURL; }

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}

async function api(route, data) {
  const response = await fetch(serviceURL+'/api/'+route,{method:data === undefined ? 'GET' : 'POST',headers:{'X-LocalReader-Token':adminToken,'Content-Type':'application/json'},body:data === undefined ? undefined : JSON.stringify(data),signal:AbortSignal.timeout(15000)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '本地服务请求失败。');
  return result;
}

async function folderRecord(id) {
  if (typeof id !== 'string') throw new Error('文件夹 ID 不正确。');
  const state = await api('state'), folder = state.folders.find(value => value.id === id);
  if (!folder) throw new Error('项目已移除，请刷新列表。');
  return {state,folder};
}

function savedKey() {
  if (runtimeKey) return runtimeKey;
  if (!config.rememberKey || !fs.existsSync(keyPath)) return '';
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 加密存储不可用，请重新输入运行密钥。');
  try { return safeStorage.decryptString(fs.readFileSync(keyPath)); }
  catch { throw new Error('无法解密保存的密钥，请在当前 Windows 账户中重新填写。'); }
}

async function openForm(info) {
  if (formWindow && !formWindow.isDestroyed()) { formWindow.focus(); return; }
  formInfo = info;
  formWindow = new BrowserWindow({parent:mainWindow,modal:true,width:600,height:info.mode === 'connection' ? 730 : 380,resizable:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'form-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  secureWindow(formWindow);
  formWindow.on('closed',() => {formWindow = null; formInfo = null;});
  await formWindow.loadURL(formURL);
}

async function saveConnection(value) {
  const next = validateConnection(value), key = String(value.runtimeKey || '').trim() || savedKey();
  if (!/^sk-[A-Za-z0-9_-]{14,}$/.test(key)) throw new Error('请输入有效的运行 API 密钥。');
  if (next.rememberKey && !safeStorage.isEncryptionAvailable()) throw new Error('Windows 加密存储不可用；请取消保存密钥后再试。');
  const encrypted = next.rememberKey ? safeStorage.encryptString(key) : null;
  await stopTunnel();
  if (encrypted) atomicWrite(keyPath,encrypted); else fs.rmSync(keyPath,{force:true});
  atomicWrite(configPath,JSON.stringify(next,null,2));
  config = next; runtimeKey = key;
  connection = {state:'configured',detail:'连接信息已保存。点击启动连接，再在 ChatGPT 中选择此 Tunnel。'}; status();
}

async function killChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit',resolve));
  if (process.platform === 'win32' && child.pid) {
    await new Promise(resolve => {
      const killer = spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      killer.once('error',resolve); killer.once('exit',resolve);
    });
  } else child.kill('SIGTERM');
  await Promise.race([exited,new Promise(resolve => setTimeout(resolve,3000))]);
}

async function stopTunnel() {
  const old = tunnel; tunnel = null; diagnosticsURL = null; healthBusy = false;
  await killChild(old);
  connection = {state:config.tunnelId ? 'stopped' : 'unconfigured',detail:'连接已停止。'}; status();
}

async function startTunnel() {
  if (tunnel) return;
  const key = savedKey();
  if (!key || !config.tunnelId) { await openForm({mode:'connection'}); return; }
  runtimeKey = key;
  fs.rmSync(healthFile,{force:true});
  const args = ['run','--control-plane.tunnel-id',config.tunnelId,'--control-plane.api-key','env:CONTROL_PLANE_API_KEY','--mcp.server-url',`url=${serviceURL}/mcp,channel=main`,'--mcp.extra-headers','Authorization: env:LOCALREADER_MCP_AUTH','--health.listen-addr','127.0.0.1:0','--health.url-file',healthFile,'--log.format','json'];
  if (config.proxy) args.push('--control-plane.http-proxy',config.proxy);
  const env = {...childEnvironment(),CONTROL_PLANE_API_KEY:key,LOCALREADER_MCP_AUTH:'Bearer '+mcpToken};
  if (config.organization) env.CONTROL_PLANE_ORGANIZATION_ID = config.organization; else delete env.CONTROL_PLANE_ORGANIZATION_ID;
  // No secrets in command lines or persistent log files. Diagnostics remain local.
  const child = spawn(path.join(runtimeDir,'tunnel-client.exe'),args,{cwd:profile,env,windowsHide:true,stdio:'ignore'});
  tunnel = child; connection = {state:'starting',detail:'正在等待官方连接客户端就绪…'}; status();
  const failed = () => {
    if (tunnel !== child || quitting) return;
    tunnel = null; diagnosticsURL = null; connection = {state:'error',detail:'连接客户端已停止，请检查代理、运行密钥及 Tunnel 权限。'}; status();
  };
  child.once('error',failed); child.once('exit',failed);
}

async function checkHealth() {
  const child = tunnel;
  if (!child || healthBusy) return;
  healthBusy = true;
  try {
    const base = healthURL(fs.readFileSync(healthFile,'utf8'));
    if (!base) return;
    diagnosticsURL = base;
    const [ready,metrics] = await Promise.all([
      fetch(new URL('readyz',base),{signal:AbortSignal.timeout(2000)}).then(result => result.ok).catch(() => false),
      fetch(new URL('metrics',base),{signal:AbortSignal.timeout(2000)}).then(result => result.ok ? result.text() : '').catch(() => '')
    ]);
    if (tunnel === child) { connection = assessConnection(ready,metrics); status(); }
  } catch { /* Client has not written its health address yet. */ }
  finally { if (tunnel === child) healthBusy = false; }
}

async function handleAction(message) {
  if (!message || typeof message.action !== 'string') throw new Error('操作格式不正确。');
  const {action,id} = message;
  if (action === 'status') { status(); return; }
  if (action === 'chooseFolder') {
    const result = await dialog.showOpenDialog(mainWindow,{title:'选择允许 ChatGPT 读取的项目或资料文件夹',properties:['openDirectory'],buttonLabel:'添加资料'});
    if (!result.canceled && result.filePaths.length === 1) emit({type:'folderSelected',path:result.filePaths[0]});
  } else if (action === 'renameFolder') {
    const {folder} = await folderRecord(id); await openForm({mode:'rename',id,name:folder.name});
  } else if (action === 'setEditing') {
    if (typeof message.editable !== 'boolean') throw new Error('编辑权限格式不正确。');
    const {folder} = await folderRecord(id);
    if (message.editable) {
      const result = await dialog.showMessageBox(mainWindow,{type:'warning',title:'允许 ChatGPT 编辑这个项目？',message:folder.name,detail:folder.path+'\n\n开启后，ChatGPT 可以创建或修改此目录内的 UTF-8 文本和源码。每次修改须先预览，再应用；这是持续编辑授权。修改前内容会保存在本机备份中。你可随时关闭编辑、停用项目或暂停访问。',buttons:['允许编辑','取消'],defaultId:1,cancelId:1,noLink:true});
      if (result.response !== 0) return;
    }
    emit({type:'editing',id,editable:message.editable});
  } else if (action === 'restoreChange') {
    const {state,folder} = await folderRecord(id);
    if (state.paused || !folder.enabled || !folder.editable) throw new Error('请先恢复访问并允许此项目编辑。');
    const history = await api('changes',{id}), change = history.changes.find(value => value.id === message.changeId);
    if (!change?.canRestore) throw new Error('此记录没有可恢复的旧内容，或需要人工核对。');
    const result = await dialog.showMessageBox(mainWindow,{type:'warning',title:'恢复到这次修改前？',message:folder.name,detail:change.path+'\n\n恢复会替换文件当前内容，并保留恢复记录。文件版本不匹配时会拒绝恢复。',buttons:['恢复文件','取消'],defaultId:1,cancelId:1,noLink:true});
    if (result.response === 0) {
      const restored = await api('restore',{id,changeId:message.changeId});
      toast(restored.warning || (restored.verified ? '文件已恢复，并通过读回核验。' : '恢复已执行，请核对原文件与备份。'),!!restored.warning || !restored.verified);
      emit({type:'restored',id});
    }
  } else if (action === 'exportFolder') {
    await folderRecord(id);
    const result = await api('export',{id});
    const chosen = await dialog.showSaveDialog(mainWindow,{title:'导出项目资料',defaultPath:result.name || '项目资料.md',filters:[{name:'Markdown',extensions:['md']}]});
    if (!chosen.canceled && chosen.filePath) { atomicWrite(chosen.filePath,result.text); toast('资料已导出。'); }
  } else if (action === 'configureTunnel') await openForm({mode:'connection'});
  else if (action === 'startTunnel') await startTunnel();
  else if (action === 'stopTunnel') await stopTunnel();
  else if (action === 'openLink') {
    const links = {tunnels:'https://platform.openai.com/settings/organization/tunnels',chatgpt:'https://chatgpt.com/plugins'};
    if (!Object.hasOwn(links,message.which)) throw new Error('链接不被允许。');
    await shell.openExternal(links[message.which]);
  } else if (action === 'openDiagnostics') {
    if (!tunnel || !diagnosticsURL) throw new Error('连接启动后才会提供诊断页面。');
    await shell.openExternal(new URL('ui',diagnosticsURL).href);
  } else if (action === 'copy') {
    if (typeof message.text !== 'string' || message.text.length > 10000) throw new Error('复制内容超过上限。');
    clipboard.writeText(message.text); toast('已复制。');
  } else throw new Error('没有这个本机操作。');
}

function startBackend() {
  return new Promise((resolve,reject) => {
    const env = {...childEnvironment(),LOCALREADER_DATA_DIR:profile,LOCALREADER_ADMIN_TOKEN:adminToken,LOCALREADER_MCP_TOKEN:mcpToken,LOCALREADER_PORT:'0',LOCALREADER_GIT:path.join(runtimeDir,'git','cmd','git.exe')};
    backend = spawn(path.join(runtimeDir,'node.exe'),[path.join(serviceDir,'src','server.js')],{cwd:serviceDir,env,windowsHide:true,stdio:['ignore','pipe','ignore']});
    let output = '', settled = false;
    const timer = setTimeout(() => { if (!settled) reject(new Error('本地服务启动超时。')); },15000);
    backend.stdout.on('data',chunk => {
      output = (output + chunk.toString('utf8')).slice(-8000);
      for (const line of output.split('\n')) {
        let record; try { record = JSON.parse(line); } catch { continue; }
        if (!settled && record.ready && Number.isInteger(record.port) && record.port > 0 && record.port < 65536) { settled = true; clearTimeout(timer); serviceURL = 'http://127.0.0.1:'+record.port; resolve(); }
      }
    });
    backend.once('error',() => { clearTimeout(timer); reject(new Error('无法启动内置 Node 运行环境，请重新安装。')); });
    backend.once('exit',() => {
      clearTimeout(timer);
      if (!settled) reject(new Error('本地服务已停止，应用资料目录可能不可写。'));
      else if (!quitting) { stopTunnel(); connection = {state:'error',detail:'本地资料服务已停止。请退出并重新打开软件。'}; status(); }
    });
  });
}

app.setName('本地项目助手');
if (process.platform === 'win32') app.setAppUserModelId('io.localreader.mcp.windows');
app.setPath('userData',path.join(profile,'desktop'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',() => {if (mainWindow) {mainWindow.show(); mainWindow.focus();}});
  app.on('before-quit',event => {
    if (quitting) return;
    event.preventDefault(); quitting = true; clearInterval(healthTimer);
    Promise.all([killChild(tunnel),killChild(backend)]).finally(() => { runtimeKey = ''; app.exit(0); });
  });
  app.whenReady().then(async () => {
    prepareProfile();
    if (fs.existsSync(configPath)) config = validateConnection(JSON.parse(fs.readFileSync(configPath,'utf8')));
    connection = {state:config.tunnelId ? 'configured' : 'unconfigured',detail:''};
    session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    await startBackend();
    mainWindow = new BrowserWindow({width:1280,height:880,minWidth:980,minHeight:650,autoHideMenuBar:true,icon:path.join(__dirname,'assets','icon.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    secureWindow(mainWindow);
    mainWindow.on('close',event => {if (!quitting) {event.preventDefault(); mainWindow.hide();}});
    ipcMain.handle('localreader:action',async (event,message) => {
      if (!mainSender(event)) throw new Error('本机操作来源不被允许。');
      try { await handleAction(message); return {ok:true}; }
      catch (error) { toast(error.message,true); return {error:error.message}; }
    });
    ipcMain.handle('localreader:form-load',event => {
      if (!formSender(event)) throw new Error('配置窗口来源不被允许。');
      return formInfo.mode === 'rename' ? {mode:'rename',name:formInfo.name} : {mode:'connection',...config,keyStored:config.rememberKey && fs.existsSync(keyPath)};
    });
    ipcMain.handle('localreader:form-save',async (event,value) => {
      if (!formSender(event)) throw new Error('配置窗口来源不被允许。');
      try {
        if (formInfo.mode === 'rename') {
          const name = String(value.name || '').trim().slice(0,80);
          if (!name) throw new Error('请输入文件夹名称。');
          await api('folders/update',{id:formInfo.id,name}); emit({type:'refresh'});
        } else await saveConnection(value);
        formWindow.close(); return {ok:true};
      } catch (error) { return {error:error.message}; }
    });
    ipcMain.handle('localreader:form-cancel',event => {if (formSender(event)) formWindow.close();});
    tray = new Tray(path.join(__dirname,'assets','tray.png'));
    tray.setToolTip('本地项目助手');
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:'打开本地项目助手',click:() => {mainWindow.show(); mainWindow.focus();}},
      {label:'关于',click:() => dialog.showMessageBox(mainWindow,{message:'本地项目助手 '+app.getVersion(),detail:'默认只读，按项目授权编辑。关闭窗口后仍在托盘运行；退出会停止连接。',buttons:['确定']})},
      {type:'separator'},{label:'退出',click:() => app.quit()}
    ]));
    tray.on('double-click',() => {mainWindow.show(); mainWindow.focus();});
    await mainWindow.loadURL(serviceURL+'/#token='+adminToken);
    status(); healthTimer = setInterval(checkHealth,3000);
  }).catch(async () => {
    await dialog.showMessageBox({type:'error',title:'启动失败',message:'本地项目助手无法启动。',detail:'请检查安装是否完整、当前用户资料目录是否可写，并确认正在本机磁盘运行。不要关闭系统安全保护。',buttons:['退出']});
    app.quit();
  });
}
