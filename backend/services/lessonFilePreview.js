const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { PDFDocument } = require('pdf-lib');

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const OFFICE = new Set(['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx']);
const ALLOWED = new Set(['.pdf', '.jpg', '.jpeg', '.png', ...OFFICE]);
const failure = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });

function validateLessonFile(file) {
  const ext = path.extname(file?.originalname || '').toLowerCase();
  const buffer = file?.buffer;
  if (!ALLOWED.has(ext) || !Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_FILE_BYTES) {
    throw failure(400, 'Pumili ng PDF, Word, PowerPoint, Excel, JPG o PNG na may laman at hanggang 50 MB.');
  }
  const starts = bytes => buffer.subarray(0, bytes.length).equals(Buffer.from(bytes));
  let valid;
  if (ext === '.pdf') valid = starts([37, 80, 68, 70, 45]);
  else if (ext === '.png') valid = starts([137, 80, 78, 71, 13, 10, 26, 10]);
  else if (ext === '.jpg' || ext === '.jpeg') valid = starts([255, 216, 255]);
  else if (['.doc', '.ppt', '.xls'].includes(ext)) valid = starts([208, 207, 17, 224, 161, 177, 26, 225]);
  else {
    const entry = { '.docx': 'word/document.xml', '.pptx': 'ppt/presentation.xml', '.xlsx': 'xl/workbook.xml' }[ext];
    valid = starts([80, 75, 3, 4]) && buffer.includes(Buffer.from('[Content_Types].xml')) && buffer.includes(Buffer.from(entry));
  }
  if (!valid) throw failure(400, 'Hindi tugma ang laman at uri ng file. Pumili ng wastong dokumento o larawan.');
  return ext;
}

async function imagePdf(buffer, ext) {
  const pdf = await PDFDocument.create();
  // JPEG parsing expects a standalone ArrayBuffer; pooled Node buffers may
  // have a nonzero byteOffset and include unrelated bytes before the image.
  const bytes = Uint8Array.from(buffer);
  const image = ext === '.png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const landscape = image.width > image.height;
  const [width, height] = landscape ? [842, 595] : [595, 842];
  const scaled = image.scaleToFit(width - 48, height - 48);
  const page = pdf.addPage([width, height]);
  page.drawImage(image, { x: (width - scaled.width) / 2, y: (height - scaled.height) / 2, ...scaled });
  return Buffer.from(await pdf.save());
}

async function prepareLessonPdf(file, { run = promisify(execFile), binary = process.env.LIBREOFFICE_BIN || 'libreoffice', signal } = {}) {
  const ext = validateLessonFile(file);
  if (ext === '.pdf') return file.buffer;
  if (!OFFICE.has(ext)) {
    try {
      const result = await imagePdf(file.buffer, ext);
      if (result.length > MAX_FILE_BYTES) throw new Error('Preview too large');
      return result;
    }
    catch { throw failure(400, 'Hindi mabasa ang larawan. I-save muli bilang JPG o PNG.'); }
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linaw-lesson-'));
  try {
    const input = path.join(directory, `lesson${ext}`);
    const profile = path.join(directory, 'profile');
    await fs.mkdir(path.join(profile, 'user'), { recursive: true });
    // Separate profile for each request prevents cross-request document state.
    // Very-high macro security also applies to legacy Office documents.
    await fs.writeFile(path.join(profile, 'user', 'registrymodifications.xcu'), `<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>`);
    await fs.writeFile(input, file.buffer);
    try {
      await run(binary, [`-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--nologo', '--nodefault', '--norestore', '--convert-to', 'pdf', '--outdir', directory, input], {
        timeout: 60000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, windowsHide: true, ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error.code === 'ENOENT') throw failure(503, 'Pansamantalang hindi handa ang document preview. Subukan muli mamaya.');
      throw failure(422, 'Hindi makagawa ng PDF preview. Tiyaking walang password at hindi sira ang dokumento.');
    }
    const output = path.join(directory, 'lesson.pdf');
    const stat = await fs.stat(output).catch(() => null);
    if (!stat || !stat.size || stat.size > MAX_FILE_BYTES) throw failure(422, 'Hindi makagawa ng PDF preview na hanggang 50 MB. I-export muna ang dokumento bilang PDF.');
    const result = await fs.readFile(output);
    try {
      const pdf = await PDFDocument.load(result);
      if (!pdf.getPageCount()) throw new Error('Empty document');
    } catch { throw failure(422, 'Hindi mabasa ang ginawang preview. I-export muna ang dokumento bilang PDF.'); }
    return result;
  } finally {
    // Only remove our own temporary directory; filenames never select a path.
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(directory));
    if (relative.startsWith('linaw-lesson-') && !relative.includes(path.sep)) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }
}
module.exports = { prepareLessonPdf, validateLessonFile, MAX_FILE_BYTES };
