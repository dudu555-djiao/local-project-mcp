const { URL } = require('node:url');

function validateConnection(input) {
  const out = {tunnelId:String(input.tunnelId || '').trim(), organization:String(input.organization || '').trim(), proxy:String(input.proxy || '').trim(), rememberKey:input.rememberKey === true};
  if (!/^tunnel_[A-Za-z0-9_-]{8,128}$/.test(out.tunnelId)) throw new Error('Tunnel ID 格式不正确。');
  if (out.organization && !/^org[-_][A-Za-z0-9_-]{1,128}$/.test(out.organization)) throw new Error('组织 ID 格式不正确。');
  if (out.proxy) {
    let url; try { url = new URL(out.proxy); } catch { throw new Error('代理地址格式不正确。'); }
    if (!['http:','https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('代理地址需要是不含账号密码的 HTTP / HTTPS 地址。');
  }
  return out;
}

function assessConnection(ready, metrics, now = Date.now()/1000) {
  if (!ready) return {state:'starting',detail:'本地连接客户端尚未就绪，正在等待启动。'};
  const metric = name => {
    for (const line of String(metrics || '').split('\n')) {
      if (line.startsWith(name+' ') || line.startsWith(name+'{')) {
        const number = Number(line.trim().split(/\s+/).at(-1));
        if (Number.isFinite(number)) return number;
      }
    }
    return null;
  };
  const last = metric('commands_poll_last_successful_timestamp_seconds');
  if (last > 0 && now >= last && now - last <= 90) return {state:'connected',detail:'已确认近期成功连接 OpenAI 通道。请在 ChatGPT 中调用插件，完成读取验证。'};
  return {state:'starting',detail:(metric('commands_poll_errors_total') || 0) > 0 ? '本地 MCP 正常，但 OpenAI 通道未连通。请检查代理、运行密钥及 Tunnel 权限。' : '本地客户端已就绪，正在等待成功连接 OpenAI 通道。'};
}

function healthURL(value) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/') return url;
  } catch {}
  return null;
}

module.exports = {validateConnection, assessConnection, healthURL};
