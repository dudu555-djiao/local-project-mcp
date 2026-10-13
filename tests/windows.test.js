import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { validRelative, samePath, containsPath, defaultDataDir } from '../src/platform.js';
import { Store } from '../src/store.js';
import { Reader } from '../src/reader.js';
import { extractDocument } from '../src/documents.js';
import { documentFixtures } from './document-fixtures.js';
const require = createRequire(import.meta.url);
const {validateConnection,assessConnection,healthURL} = require('../windows/host-utils.cjs');

test('Windows path contracts reject ADS, device aliases, drive-relative paths and traversal', () => {
  for (const value of ['C:relative.txt','C:\\absolute.txt','\\\\server\\share','a.txt:secret','sub/NUL.txt','COM1.js','sub/aux','foo.','foo ','..\\other.txt','sub/../other.txt','\\\\?\\C:\\file']) assert.equal(validRelative(value,'win32'),false,value);
  for (const value of ['', 'README.md','src/中文 文件.js']) assert.equal(validRelative(value,'win32'),true,value);
  assert.equal(samePath('C:\\Projects\\APP','c:\\projects\\app','win32'),true);
  assert.equal(containsPath('C:\\Projects\\app','C:\\Projects\\app2','win32'),false);
  assert.equal(containsPath('C:\\Projects\\app','D:\\Projects\\app','win32'),false);
  assert.equal(containsPath('C:\\Projects\\app','c:\\projects\\app\\src','win32'),true);
  assert.equal(defaultDataDir('win32',{LOCALAPPDATA:'C:\\ExampleData'}),'C:\\ExampleData\\LocalReaderMCP');
});

test('Windows document extraction preserves real PDF, DOCX paragraphs, tables and Unicode RTF', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'local-reader-documents-'));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const project = path.join(dir,'文档 fixtures'); await fs.mkdir(project);
  const store = new Store(path.join(dir,'data')), folder = store.add(project), reader = new Reader(store);
  const docs = await documentFixtures();
  for (const [name,bytes] of Object.entries(docs)) await fs.writeFile(path.join(project,name),bytes);
  const pdf = await extractDocument(docs['sample.pdf'],'.pdf');
  assert.match(pdf.text,/Windows PDF text fixture/); assert.equal(pdf.meta.pages,1); assert.equal(pdf.meta.documentTruncated,false);
  const docx = await extractDocument(docs['sample.docx'],'.docx');
  assert.match(docx.text,/中文 Word 测试 & 文本/); assert.match(docx.text,/表格正文/);
  const rtf = await extractDocument(docs['sample.rtf'],'.rtf');
  assert.match(rtf.text,/RTF text\nUnicode 中文/);
  const before = process.env.LOCALREADER_PORTABLE_DOCUMENTS; process.env.LOCALREADER_PORTABLE_DOCUMENTS = '1';
  try {
    const out = await reader.readFile({folderId:folder.id,path:'sample.docx'}); assert.match(out.content,/中文 Word/);
    await assert.rejects(() => extractDocument(Buffer.from('invalid'),'.pdf'),/无法提取/);
  } finally { if (before === undefined) delete process.env.LOCALREADER_PORTABLE_DOCUMENTS; else process.env.LOCALREADER_PORTABLE_DOCUMENTS = before; }
});

test('Windows connection health requires a recent successful poll, not readiness alone', () => {
  assert.equal(assessConnection(true,'',1000).state,'starting');
  assert.equal(assessConnection(true,'commands_poll_last_successful_timestamp_seconds 950',1000).state,'connected');
  assert.equal(assessConnection(true,'commands_poll_last_successful_timestamp_seconds 800',1000).state,'starting');
  assert.equal(assessConnection(true,'commands_poll_last_successful_timestamp_seconds 1100',1000).state,'starting');
  assert.equal(assessConnection(false,'commands_poll_last_successful_timestamp_seconds 950',1000).state,'starting');
  assert.ok(healthURL('http://127.0.0.1:12345/'));
  for (const value of ['https://127.0.0.1:12345/','http://example.com:12345/','http://127.0.0.1:12345/?key=hidden','http://127.0.0.1:12345/other']) assert.equal(healthURL(value),null);
});

test('Windows connection validation accepts restricted runtime settings and rejects credential-bearing proxies', () => {
  const tunnelId = 'tunnel_' + 'synthetic-example';
  const value = validateConnection({tunnelId,proxy:'http://127.0.0.1:7897',rememberKey:true});
  assert.equal(value.tunnelId,tunnelId); assert.equal(value.rememberKey,true);
  for (const proxy of ['file:///tmp/x','http://user:password@127.0.0.1:7897','http://127.0.0.1:7897/?key=hidden','http://127.0.0.1:7897/path']) assert.throws(() => validateConnection({tunnelId,proxy}));
});
