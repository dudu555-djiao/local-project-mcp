import { PDFDocument, StandardFonts } from 'pdf-lib';
import { zipSync, strToU8 } from 'fflate';

export async function documentFixtures() {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('Windows PDF text fixture', {font,size:14,x:40,y:700});
  const docx = zipSync({
    '[Content_Types].xml':strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml':strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>中文 Word 测试 &amp; 文本</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格正文</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>')
  });
  return {'sample.pdf':Buffer.from(await pdf.save()),'sample.docx':Buffer.from(docx),'sample.rtf':Buffer.from('{\\rtf1\\ansi\\uc1 RTF text\\par Unicode \\u20013?\\u25991?}')};
}
