const $=id=>document.getElementById(id);
let token=new URLSearchParams(location.hash.slice(1)).get('token') || '';
history.replaceState(null,'',location.pathname);
let state={folders:[],paused:false,audit:[]}, native={state:'unconfigured',tunnelId:'',clientAvailable:false}, toastTimer, lastState='', historyFolderId='';
const tabs={folders:'资料文件夹',connection:'连接 ChatGPT',activity:'访问记录',guide:'使用指南'};
const operations={server_info:'连接检查',list_folders:'列出文件夹',list_directory:'查看目录',search_files:'搜索文件名',search_content:'搜索内容',read_file:'读取文件',git_summary:'Git 摘要',database_schema:'数据库结构',database_rows:'数据库样例',prepare_edit:'预览修改',apply_edit:'应用修改',list_changes:'查看修改历史',prepare_restore:'预览恢复',local_restore:'本地恢复',folder_added:'添加资料',folder_updated:'调整资料',folder_removed:'移除资料',paused:'暂停访问',resumed:'恢复访问',local_preview:'本地预览',local_export:'导出资料'};
function node(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function toast(text,error=false){const e=$('toast');e.textContent=text;e.className='toast'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.add('hidden'),4500);}
async function api(url,data){const res=await fetch('/api/'+url,{method:data===undefined?'GET':'POST',headers:{'X-LocalReader-Token':token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});const out=await res.json();if(!res.ok)throw new Error(out.error || '请求失败');return out;}
function bridge(action,data={}){if(window.webkit?.messageHandlers?.localReader){window.webkit.messageHandlers.localReader.postMessage({action,...data});return true;}toast('此操作需要在本地资料助手 Mac 应用内使用。',true);return false;}
function button(text,cls,fn){const b=node('button',cls,text);b.addEventListener('click',async()=>{b.disabled=true;try{await fn();}catch(e){toast(e.message,true);}finally{b.disabled=false;}});return b;}
function showTab(tab){for(const name of Object.keys(tabs))$(name+'Page').classList.toggle('hidden',name!==tab);document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));$('breadcrumb').textContent=tabs[tab];if(tab==='activity')refreshAudit();}
function render(){
  $('folderBadge').textContent=state.folders.length;$('folderCount').textContent=state.folders.length;
  $('enabledCount').textContent=state.paused?'0':state.folders.filter(f=>f.enabled).length;
  $('pausedNotice').classList.toggle('hidden',!state.paused);$('pauseButton').textContent=state.paused?'恢复全部访问':'暂停全部访问';
  $('localStatus').textContent=state.paused?'本地访问已暂停':'本地服务运行中';$('localDot').className='dot'+(state.paused?' amber':'');
  const editing=state.folders.some(f=>f.enabled&&f.editable);$('accessMode').textContent=state.paused?'全部访问已暂停':editing?'按项目授权编辑':'默认只读访问';
  $('emptyState').classList.toggle('hidden',state.folders.length>0);$('folderList').replaceChildren();
  for(const f of state.folders){
    const card=node('div','folder-card'),info=node('div','folder-info'),actions=node('div','folder-actions');
    const title=node('div','folder-title');title.append(node('div','folder-name',f.name),node('span','mode-badge'+(f.editable?' editable':''),f.editable?'允许编辑':'只读'));
    info.append(title,node('div','folder-path',f.path));
    const toggle=button('', 'toggle'+(f.enabled?' on':''),async()=>{await api('folders/update',{id:f.id,enabled:!f.enabled});await refresh();});toggle.setAttribute('role','switch');toggle.setAttribute('aria-checked',String(f.enabled));toggle.setAttribute('aria-label','允许访问 '+f.name);toggle.title=f.enabled?'停用访问':'启用访问';
    const editButton=button(f.editable?'关闭编辑':'允许编辑',f.editable?'editing-button active':'editing-button',()=>bridge('setEditing',{id:f.id,editable:!f.editable}));editButton.setAttribute('aria-pressed',String(!!f.editable));
    actions.append(toggle,editButton,button('修改历史','subtle',()=>showChanges(f)),button('预览','subtle',()=>preview(f)),button('导出','subtle',()=>bridge('exportFolder',{id:f.id})),button('重命名','subtle',()=>bridge('renameFolder',{id:f.id,name:f.name})),button('移除','subtle',async()=>{await api('folders/remove',{id:f.id});toast('已移除访问授权，原始文件保留。');await refresh();}));
    card.append(node('div','folder-symbol','▱'),info,actions);$('folderList').append(card);
  }
  renderNative();renderAudit(state.audit);
}
function renderNative(){
  const names={unconfigured:'待配置',configured:'未连接',starting:'正在连接',connected:'通道已连通',error:'连接失败',stopped:'已断开'};
  const label=names[native.state] || '未连接';$('connectionText').textContent=label;$('tunnelBadge').textContent=label;$('tunnelBadge').className='badge'+(native.state==='connected'?' connected':'');
  $('tunnelTitle').textContent=native.state==='connected'?'OpenAI 通道已连通':native.state==='starting'?'正在建立连接':native.tunnelId?'连接尚未就绪':'尚未配置连接';
  $('tunnelDetail').textContent=native.detail || '本地资料服务已准备好。完成下面的设置后，可在 ChatGPT 中使用。';
  $('configuredId').textContent=native.tunnelId?'当前 Tunnel：'+native.tunnelId:'';
  $('nativeDetails').textContent=native.clientAvailable?'官方 Tunnel 客户端已随应用提供。连接就绪后，诊断页可以检查健康状态。':'正在检查官方 Tunnel 客户端。';
  $('startTunnel').disabled=!native.tunnelId || ['starting','connected'].includes(native.state);
  $('stopTunnel').disabled=!['starting','connected'].includes(native.state);
}
function renderAudit(rows){$('auditBody').replaceChildren();$('auditEmpty').classList.toggle('hidden',rows.length>0);for(const r of rows){const f=state.folders.find(f=>f.id===r.folderId),tr=node('tr');tr.append(node('td','',new Date(r.time).toLocaleString('zh-CN',{hour12:false})),node('td','',operations[r.tool]||r.tool),node('td','',[(f?.name||r.folderId),r.path].filter(Boolean).join(' / ')||'—'),node('td',r.status==='ok'?'audit-ok':'audit-denied',r.status==='ok'?'完成':'已拒绝'));$('auditBody').append(tr);}}
async function refresh(){try{const next=await api('state'),serialized=JSON.stringify(next);state=next;if(serialized!==lastState){lastState=serialized;render();}else{$('localStatus').textContent=state.paused?'本地访问已暂停':'本地服务运行中';$('localDot').className='dot'+(state.paused?' amber':'');}}catch(e){$('localStatus').textContent='本地服务未响应';$('localDot').className='dot amber';if(e.message.includes('未授权'))toast(e.message,true);}}
async function refreshAudit(){try{const a=await api('audit');renderAudit(a.rows);}catch(e){toast(e.message,true);}}
async function preview(f){const out=await api('preview',{id:f.id});$('previewTitle').textContent=f.name;$('previewList').replaceChildren();for(const e of out.entries){const r=node('div','preview-row');r.append(node('span','',(e.kind==='directory'?'▱ ':'')+e.name),node('small','',({directory:'文件夹',text:'文本 / 源码',document:'文档',database:'数据库',unsupported:'暂不支持'})[e.kind]||e.kind));$('previewList').append(r);}if(!out.entries.length)$('previewList').append(node('p','muted-small','此目录没有可展示的文件。'));if(out.nextOffset!==null)$('previewList').append(node('p','muted-small','目录超过 100 项，此处仅展示第一批。'));$('previewDialog').showModal();}
async function showChanges(f){historyFolderId=f.id;$('historyTitle').textContent=f.name+' · 修改历史';$('historyList').replaceChildren(node('p','muted-small','正在读取本地修改记录…'));$('historyDialog').showModal();await refreshChanges();}
async function refreshChanges(){
  if(!historyFolderId)return;
  const folderId=historyFolderId;
  try{
    const out=await api('changes',{id:folderId}),f=state.folders.find(f=>f.id===folderId);
    if(historyFolderId!==folderId)return;
    const mb=bytes=>(Number(bytes || 0)/1024/1024).toFixed(1);
    $('backupUsage').textContent=out.backupLimitBytes?'本机备份占用 '+mb(out.backupBytes)+' / '+mb(out.backupLimitBytes)+' MiB。满后拒绝继续修改，不自动清理。'+(out.note?' '+out.note:''):(out.note || '');
    $('historyList').replaceChildren();
    for(const change of out.changes || []){
      const row=node('article','change-row'),info=node('div','change-info');
      const label=({create:'新建文件',edit:'修改文件',replace:'替换文本',restore:'恢复文件'})[change.operation] || change.operation;
      info.append(node('strong','change-path',change.path),node('p','change-meta',new Date(change.createdAt).toLocaleString('zh-CN',{hour12:false})+' · '+label));
      const versions=node('p','change-version');versions.textContent='版本 '+String(change.beforeVersion || '新建前不存在').slice(0,18)+' → '+String(change.afterVersion || '不存在').slice(0,18);info.append(versions);
      if(change.state==='needsReview')info.append(node('p','change-meta',change.restoreDisabledReason||'保存结果需人工核对，备份仍保留。'));
      const canRestore=change.canRestore===true;
      const restore=button(canRestore?'恢复到修改前':change.state==='needsReview'?'需核对文件':'无旧内容可恢复','secondary',()=>bridge('restoreChange',{id:folderId,changeId:change.id}));
      restore.disabled=!canRestore||state.paused||!f?.enabled||!f?.editable;
      restore.title=change.restoreDisabledReason||(!canRestore?'新建文件没有旧内容，本版不删除文件':restore.disabled?'请先恢复访问并允许此项目编辑':'先确认，再恢复修改前的文件内容');
      row.append(info,restore);$('historyList').append(row);
    }
    if(!(out.changes || []).length)$('historyList').append(node('p','muted-small','还没有通过本助手应用的修改。'));
  }catch(e){$('historyList').replaceChildren(node('p','muted-small',e.message));toast(e.message,true);}
}
window.nativeEvent=async data=>{if(data.type==='connection'){native={...native,...data};renderNative();}else if(data.type==='folderSelected'){try{await api('folders/add',{path:data.path});await refresh();toast('文件夹已添加，默认只读；允许编辑需要单独确认。');}catch(e){toast(e.message,true);}}else if(data.type==='rename'){try{await api('folders/update',{id:data.id,name:data.name});await refresh();}catch(e){toast(e.message,true);}}else if(data.type==='editing'){try{await api('folders/update',{id:data.id,editable:!!data.editable});await refresh();toast(data.editable?'已允许此项目编辑。请在 ChatGPT 中先预览修改，再应用。':'已关闭此项目编辑，恢复只读。');}catch(e){toast(e.message,true);}}else if(data.type==='restored'){await refresh();if(historyFolderId===data.id)await refreshChanges();}else if(data.type==='toast'){toast(data.message,!!data.error);}else if(data.type==='refresh'){await refresh();}};
document.querySelectorAll('.nav').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
$('addFolder').onclick=$('addFirst').onclick=()=>bridge('chooseFolder');
$('pauseButton').onclick=async()=>{try{await api('pause',{paused:!state.paused});await refresh();}catch(e){toast(e.message,true);}};
$('configureTunnel').onclick=()=>bridge('configureTunnel');$('startTunnel').onclick=()=>bridge('startTunnel');$('stopTunnel').onclick=()=>bridge('stopTunnel');
$('openTunnelSettings').onclick=()=>bridge('openLink',{which:'tunnels'});$('openChatGPT').onclick=()=>bridge('openLink',{which:'chatgpt'});$('openTunnelDiagnostics').onclick=()=>bridge('openDiagnostics');
$('copyTunnelId').onclick=()=>native.tunnelId?bridge('copy',{text:native.tunnelId}):toast('请先配置 Tunnel ID。');
$('copyPrompt').onclick=()=>bridge('copy',{text:$('samplePrompt').textContent});$('refreshAudit').onclick=refreshAudit;
$('closePreview').onclick=$('closePreviewBottom').onclick=()=>$('previewDialog').close();
$('closeHistory').onclick=$('closeHistoryBottom').onclick=()=>$('historyDialog').close();$('refreshChanges').onclick=refreshChanges;
refresh();bridge('status');setInterval(()=>{refresh();if(window.webkit?.messageHandlers?.localReader)window.webkit.messageHandlers.localReader.postMessage({action:'status'});},4000);
