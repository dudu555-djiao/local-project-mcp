const $ = id => document.getElementById(id);
let mode = 'connection';
window.localReaderForm.load().then(value => {
  mode = value.mode;
  if (mode === 'rename') {
    $('title').textContent = '重命名资料'; $('description').textContent = '只修改显示名称，原始文件夹保持不变。';
    $('connectionFields').classList.add('hidden'); $('renameFields').classList.remove('hidden'); $('name').value = value.name;
  } else {
    for (const id of ['tunnelId','organization','proxy']) $(id).value = value[id] || '';
    $('rememberKey').checked = value.rememberKey;
    if (value.keyStored) $('runtimeKey').placeholder = '已加密保存；留空可继续使用';
  }
});
$('cancel').onclick = () => window.localReaderForm.cancel();
$('settings').onsubmit = async event => {
  event.preventDefault(); $('save').disabled = true; $('error').textContent = '';
  try {
    const value = mode === 'rename' ? {name:$('name').value} : {tunnelId:$('tunnelId').value, runtimeKey:$('runtimeKey').value, rememberKey:$('rememberKey').checked, organization:$('organization').value, proxy:$('proxy').value};
    const out = await window.localReaderForm.save(value);
    if (out.error) $('error').textContent = out.error;
    else $('runtimeKey').value = '';
  } catch { $('error').textContent = '保存失败，请重新打开配置窗口。'; }
  finally { $('save').disabled = false; }
};
