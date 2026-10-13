import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Store } from './store.js';
import { Reader } from './reader.js';
import { Editor } from './editor.js';
import { makeMcp, readableError } from './mcp.js';

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function startServer({ store = new Store(), reader, port = Number(process.env.LOCALREADER_PORT || 0), adminToken = process.env.LOCALREADER_ADMIN_TOKEN || crypto.randomBytes(32).toString('hex'), mcpToken = process.env.LOCALREADER_MCP_TOKEN || crypto.randomBytes(32).toString('hex') } = {}) {
  reader ||= new Reader(store);
  const editor = new Editor(store);
  let activeMcp = 0;
  const equals = (a,b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
  const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const body = async req => {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('仅接受 JSON 请求。');
    let size=0, chunks=[];
    for await (const c of req) { size+=c.length; if(size>3*1024*1024) throw new Error('请求超过 3 MiB 上限，请缩小编辑范围。'); chunks.push(c); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  };
  const server = http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    const host = req.headers.host || '';
    if (!/^127\.0\.0\.1:\d+$/.test(host)) return json(res,403,{error:'Host 不被允许。'});
    const origin = req.headers.origin;
    if (origin && origin !== 'http://'+host) return json(res,403,{error:'跨站请求不被允许。'});
    const u = new URL(req.url,'http://'+host);
    try {
      if (u.pathname === '/health' && req.method === 'GET') return json(res,200,{ok:true,version:'0.2.0-beta.1'});
      if (u.pathname === '/mcp') {
        if (!equals(req.headers.authorization || '', 'Bearer '+mcpToken)) return json(res,401,{error:'未授权的 MCP 请求。'});
        if (req.method !== 'POST') { res.setHeader('Allow','POST'); return json(res,405,{error:'此服务使用无状态 MCP POST。'}); }
        if (activeMcp >= 4) return json(res,429,{error:'同时读取请求过多，请稍后重试。'});
        const parsed = await body(req);
        if (Array.isArray(parsed)) return json(res,400,{error:'不支持批量请求。'});
        activeMcp++;
        const mcp = makeMcp(reader,store,editor), transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        let closed=false;
        const close = async () => { if(closed)return; closed=true; activeMcp--; await transport.close().catch(()=>{}); await mcp.close().catch(()=>{}); };
        res.on('close',close);
        try { await mcp.connect(transport); await transport.handleRequest(req,res,parsed); }
        catch (e) { if (!res.headersSent) json(res,500,{error:readableError(e)}); await close(); }
        return;
      }
      if (u.pathname.startsWith('/api/')) {
        if (!equals(req.headers['x-localreader-token'] || '',adminToken)) return json(res,401,{error:'管理会话未授权。请重新打开应用。'});
        if (req.method === 'GET' && u.pathname === '/api/state') return json(res,200,{...store.load(),audit:store.auditRows(40),activeReads:activeMcp});
        if (req.method === 'GET' && u.pathname === '/api/audit') return json(res,200,{rows:store.auditRows(200)});
        if (req.method !== 'POST') return json(res,405,{error:'方法不被允许。'});
        const a = await body(req);
        if (u.pathname === '/api/folders/add') return json(res,200,{folder:store.add(a.path,a.name)});
        if (u.pathname === '/api/folders/update') return json(res,200,{folder:store.update(a.id,a)});
        if (u.pathname === '/api/folders/remove') { store.remove(a.id); return json(res,200,{ok:true}); }
        if (u.pathname === '/api/pause') { store.pause(a.paused); return json(res,200,{ok:true}); }
        if (u.pathname === '/api/changes') return json(res,200,editor.history(a.id));
        if (u.pathname === '/api/restore') {
          const preview = editor.prepareRestore({folderId:a.id,changeId:a.changeId});
          return json(res,200,editor.apply({proposalId:preview.proposalId}));
        }
        if (u.pathname === '/api/preview') {
          const start=Date.now();
          try { const result=await reader.listDirectory({folderId:a.id}); store.audit('local_preview',{folderId:a.id},'ok',Date.now()-start); return json(res,200,result); }
          catch(e){store.audit('local_preview',{folderId:a.id},'denied',Date.now()-start); throw e;}
        }
        if (u.pathname === '/api/export') {
          const out=await reader.exportFolder(a.id); store.audit('local_export',{folderId:a.id},'ok'); return json(res,200,out);
        }
        return json(res,404,{error:'没有这个操作。'});
      }
      const files = {'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
      if (req.method === 'GET' && files[u.pathname]) {
        const content=await fs.readFile(path.join(appDir,'ui',files[u.pathname]));
        const type=u.pathname.endsWith('.js')?'application/javascript':u.pathname.endsWith('.css')?'text/css':'text/html';
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
        res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});res.end(content);return;
      }
      json(res,404,{error:'页面不存在。'});
    } catch(e) { if(!res.headersSent) json(res,400,{error:readableError(e)}); else res.end(); }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,port:server.address().port,adminToken,mcpToken,store,reader};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--stdio')) {
    const store=new Store();
    const mcp=makeMcp(new Reader(store),store);
    await mcp.connect(new StdioServerTransport());
    const stop=async()=>{await mcp.close();process.exit(0);};
    process.on('SIGTERM',stop);process.on('SIGINT',stop);
  } else {
    const service=await startServer();
    // Only the native parent sees this startup record. It contains no API keys.
    console.log(JSON.stringify({ready:true,port:service.port}));
    const stop=()=>{service.server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1500).unref();};
    process.on('SIGTERM',stop);process.on('SIGINT',stop);
  }
}
