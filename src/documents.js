import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const MAX_OUTPUT = 2 * 1024 * 1024;

// rtf-parser decodes \\u but does not consume the ANSI fallback. Honor scoped
// \\ucN before handing it the stream, so Chinese text is not followed by '?'.
export function normalizeRtfUnicode(source) {
  let output = '', fallback = 1, index = 0;
  const groups = [], control = /\\(uc|u)(-?\d+) ?/y;
  while (index < source.length) {
    const char = source[index];
    if (char === '{') { groups.push(fallback); output += char; index++; continue; }
    if (char === '}') { fallback = groups.pop() ?? 1; output += char; index++; continue; }
    if (char !== '\\') { output += char; index++; continue; }
    // Escaped braces/backslashes are text, not a new scope/control word.
    if (/[\\{}]/.test(source[index+1] || '')) { output += source.slice(index,index+2); index += 2; continue; }
    control.lastIndex = index;
    const match = control.exec(source);
    if (!match) { output += char; index++; continue; }
    index = control.lastIndex;
    if (match[1] === 'uc') { fallback = Math.max(0,Math.min(32,Number(match[2]))); output += match[0]; continue; }
    output += '\\u' + match[2] + ' ';
    for (let skip = 0; skip < fallback && index < source.length; skip++) {
      if (/[{}]/.test(source[index])) break;
      if (source[index] === '\\') {
        const token = /^\\(?:'[a-fA-F0-9]{2}|[\\{}~_-])/.exec(source.slice(index));
        if (!token) break;
        index += token[0].length;
      } else index++;
    }
  }
  return output;
}

// Parse a bounded snapshot of the already-opened file, never re-open a supplied
// path. A separate worker limits parser time and heap without blocking MCP.
export function extractDocument(bytes, extension) {
  if (!['.pdf', '.docx', '.rtf'].includes(extension) || bytes.length > 20 * 1024 * 1024) throw new Error('文档格式不支持或超过 20 MiB。');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData:{ bytes, extension }, execArgv:[], resourceLimits:{maxOldGenerationSizeMb:256} });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('文档提取超过 12 秒，请拆分文档或先导出文本。')); }, 12000);
    worker.once('message', result => {
      clearTimeout(timer); worker.terminate();
      if (result.error) reject(new Error(result.error)); else resolve(result);
    });
    worker.once('error', () => { clearTimeout(timer); reject(new Error('文档提取失败，文件可能损坏、加密或超出资源限制。')); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('文档提取已停止。')); });
  });
}

if (!isMainThread && workerData?.extension) {
  try {
    const bytes = Buffer.from(workerData.bytes);
    let text = '', meta = {};
    if (workerData.extension === '.pdf') {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = getDocument({data:new Uint8Array(bytes), isEvalSupported:false, useSystemFonts:false, useWasm:false, disableFontFace:true});
      try {
        const pdf = await task.promise;
        let extractedPages = 0;
        for (let i = 1; i <= Math.min(pdf.numPages,100); i++) {
          const page = await pdf.getPage(i), content = await page.getTextContent();
          text += content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('') + '\n';
          extractedPages++; page.cleanup();
          if (Buffer.byteLength(text) >= MAX_OUTPUT) break;
        }
        meta = {pages:pdf.numPages, extractedPages, documentTruncated:extractedPages < pdf.numPages || Buffer.byteLength(text) > MAX_OUTPUT};
      } finally { await task.destroy(); }
    } else if (workerData.extension === '.docx') {
      const { unzipSync } = await import('fflate');
      const { DOMParser } = await import('@xmldom/xmldom');
      const zip = unzipSync(bytes,{filter:file => file.name === 'word/document.xml' && file.originalSize <= 20 * 1024 * 1024});
      if (!zip['word/document.xml']) throw new Error('DOCX 正文缺失或过大。');
      const xml = new TextDecoder('utf-8',{fatal:true}).decode(zip['word/document.xml']);
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不支持带外部实体的文档。');
      const doc = new DOMParser({onError:level => { if (level === 'fatalError') throw new Error('DOCX XML 损坏。'); }}).parseFromString(xml,'application/xml');
      const namespaces = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main']);
      const read = element => {
        if (namespaces.has(element.namespaceURI)) {
          if (element.localName === 't') return element.textContent;
          if (element.localName === 'tab') return '\t';
          if (['br','cr'].includes(element.localName)) return '\n';
        }
        let value = '';
        for (let child = element.firstChild; child; child = child.nextSibling) value += read(child);
        return value + (namespaces.has(element.namespaceURI) && ['p','tr'].includes(element.localName) ? '\n' : '');
      };
      text = read(doc);
    } else {
      const { default: rtf } = await import('rtf-parser');
      const doc = await new Promise((resolve,reject) => rtf.string(normalizeRtfUnicode(bytes.toString('latin1')), (error,result) => error ? reject(error) : resolve(result)));
      const flatten = value => {
        if (typeof value?.value === 'string') return value.value;
        if (Array.isArray(value?.content)) return value.content.map(flatten).join('') + (value.constructor.name === 'RTFParagraph' ? '\n' : '');
        return '';
      };
      text = flatten(doc);
    }
    if (Buffer.byteLength(text) > MAX_OUTPUT) {
      // Avoid cutting through a UTF-8 sequence or silently losing the truncation flag.
      text = text.slice(0, MAX_OUTPUT / 4); meta.documentTruncated = true;
    }
    parentPort.postMessage({text,meta});
  } catch {
    parentPort.postMessage({error:'无法提取文档正文。请检查文件是否损坏或加密；扫描 PDF 需要先做 OCR。'});
  }
}
