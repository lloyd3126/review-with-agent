import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const appRoot = process.env.LESSON_APP_ROOT || path.resolve(moduleDirectory, '../../..');
const pdfInspector = path.resolve(appRoot, '../.agents/skills/lesson-review-workspace/scripts/pdf_tools.py');

export const hash = data => createHash('sha256').update(data).digest('hex');
export const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

export async function atomicJson(file, data) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`);
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, {force: true}).catch(() => {});
    throw error;
  }
}

export function lessonDir(root, id) {
  if (!/^[a-z0-9][a-z0-9-]{0,90}$/.test(id || '')) throw new Error('文件識別碼無效');
  return path.join(root, 'lessons', id);
}

export function safeName(name) {
  const candidate = String(name || 'document.pdf');
  return path.basename(candidate.replaceAll('\\', '/')).replace(/[\x00-\x1f<>:"|?*]/g, '_').slice(-180) || 'document.pdf';
}

async function inspectFile(script, file, python, message) {
  try {
    const pythonPath = process.env.LESSON_PYTHONPATH || '';
    const env = {...process.env, PYTHONPATH: pythonPath || process.env.PYTHONPATH || ''};
    const {stdout} = await execute(python, [script, 'inspect', file], {env, timeout: 30000, maxBuffer: 32 * 1024 * 1024});
    return JSON.parse(stdout);
  } catch (error) {
    let detail = '';
    try { detail = JSON.parse(error.stdout).error || ''; } catch {}
    throw new Error(detail || message);
  }
}

export function inspectPdf(file, python = 'python3') {
  return inspectFile(pdfInspector, file, python, '無法讀取 PDF，請確認檔案未損壞、未加密且 Python 環境可用');
}

export async function checkedFile(dir, relative) {
  const parent = await fs.realpath(path.dirname(dir));
  const folder = await fs.realpath(dir);
  if (!folder.startsWith(`${parent}${path.sep}`)) throw new Error('檔案位置無效');
  const target = await fs.realpath(path.join(dir, relative));
  if (!target.startsWith(`${folder}${path.sep}`)) throw new Error('檔案位置無效');
  return target;
}

export async function getMetadata(root, id) {
  const dir = lessonDir(root, id);
  return readJson(await checkedFile(dir, 'lesson.json'));
}

export async function importLesson(root, data, filename, title, python = 'python3') {
  filename = safeName(filename);
  if (!filename.toLowerCase().endsWith('.pdf')) throw new Error('請上傳 .pdf 格式的文件');
  const parent = path.join(root, 'lessons');
  const id = `${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8)}`;
  const staging = path.join(parent, `.import-${randomUUID()}`);
  await fs.mkdir(staging, {recursive: true});
  try {
    for (const directory of ['review', 'materials']) await fs.mkdir(path.join(staging, directory));
    const file = path.join(staging, 'document.pdf');
    await fs.writeFile(file, data);
    const inspected = await inspectPdf(file, python);
    const createdAt = new Date().toISOString();
    const documentHash = hash(data);
    const metadata = {
      schemaVersion: 3,
      format: 'pdf',
      id,
      title: (title || filename.replace(/\.pdf$/i, '')).trim().slice(0, 120),
      originalName: filename,
      createdAt,
      updatedAt: createdAt,
      pageCount: inspected.pageCount,
      documentHash,
      documentToken: randomUUID(),
      materials: [],
    };
    await fs.chmod(file, 0o444);
    await atomicJson(path.join(staging, 'lesson.json'), metadata);
    await atomicJson(path.join(staging, 'review/annotations.json'), {nextNumber: 1, annotations: [], history: []});
    await fs.rename(staging, lessonDir(root, id));
    return metadata;
  } catch (error) {
    await fs.rm(staging, {recursive: true, force: true});
    throw error;
  }
}

function conflict(message) {
  return Object.assign(new Error(message), {status: 409});
}

async function restoreFile(file, data) {
  await fs.writeFile(file, data);
}

export async function replaceDocument(root, id, data, filename, python = 'python3') {
  filename = safeName(filename);
  if (!filename.toLowerCase().endsWith('.pdf')) throw new Error('請上傳 .pdf 格式的文件');
  const lessons = path.join(root, 'lessons');
  const temporary = path.join(lessons, `.replace-${randomUUID()}.pdf`);
  await fs.mkdir(lessons, {recursive: true});
  await fs.writeFile(temporary, data);
  let inspected;
  try {
    inspected = await inspectPdf(temporary, python);
  } catch (error) {
    await fs.rm(temporary, {force: true});
    throw error;
  }
  try {
    return await withLessonLock(root, id, async () => {
      const dir = lessonDir(root, id);
      const metadataFile = await checkedFile(dir, 'lesson.json');
      const reviewFile = await checkedFile(dir, 'review/annotations.json');
      const documentFile = await checkedFile(dir, 'document.pdf');
      const previousMetadata = await fs.readFile(metadataFile);
      const previousReview = await fs.readFile(reviewFile);
      const meta = JSON.parse(previousMetadata.toString('utf8'));
      if (meta.format !== 'pdf') throw new Error('只有 PDF 文件可以更換 PDF');
      const updatedAt = new Date().toISOString();
      const documentHash = hash(data);
      const next = {...meta};
      Object.assign(next, {
        schemaVersion: 3,
        originalName: filename,
        updatedAt,
        pageCount: inspected.pageCount,
        documentHash,
        documentToken: randomUUID(),
      });
      const backup = path.join(dir, `.document-backup-${randomUUID()}.pdf`);
      let moved = false;
      let installed = false;
      let backupExists = false;
      try {
        await fs.rename(documentFile, backup);
        moved = true;
        backupExists = true;
        await fs.rename(temporary, documentFile);
        installed = true;
        await fs.chmod(documentFile, 0o444);
        await atomicJson(metadataFile, next);
        await atomicJson(reviewFile, {nextNumber: 1, annotations: [], history: []});
        backupExists = false;
        return {...next, annotationsCleared: true};
      } catch (error) {
        const rollbackErrors = [];
        if (installed) {
          try { await fs.rm(documentFile, {force: true}); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
        }
        if (moved) {
          try {
            await fs.rename(backup, documentFile);
            backupExists = false;
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        try { await restoreFile(metadataFile, previousMetadata); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
        try { await restoreFile(reviewFile, previousReview); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
        if (rollbackErrors.length) {
          if (!backupExists) {
            try {
              await fs.copyFile(documentFile, backup);
              await fs.chmod(backup, 0o444);
              backupExists = true;
            } catch (rollbackError) {
              rollbackErrors.push(rollbackError);
            }
          }
          const rollbackMessage = rollbackErrors.map(rollbackError => rollbackError.message).join('。');
          const rollbackFailure = new AggregateError([error, ...rollbackErrors], `PDF 替換失敗，復原不完整：${rollbackMessage}`);
          rollbackFailure.status = 500;
          throw rollbackFailure;
        }
        throw error;
      } finally {
        if (!backupExists) await fs.rm(backup, {force: true});
      }
    });
  } finally {
    await fs.rm(temporary, {force: true});
  }
}

export async function readCurrentDocument(root, id, expected = {}) {
  await getMetadata(root, id);
  return withLessonLock(root, id, async () => {
    const dir = lessonDir(root, id);
    const meta = await getMetadata(root, id);
    if (meta.format !== 'pdf') throw Object.assign(new Error('找不到這份 PDF 文件'), {status: 404});
    if (expected.hash && expected.hash !== meta.documentHash) throw conflict('文件已更新，請重新讀取');
    if (expected.token && expected.token !== meta.documentToken) throw conflict('文件已更新，請重新讀取');
    const data = await fs.readFile(await checkedFile(dir, 'document.pdf'));
    const documentHash = hash(data);
    if (documentHash !== meta.documentHash) throw conflict('文件已更新，請重新讀取');
    return {meta, data, documentHash};
  });
}

export async function getLesson(root, id) {
  return withLessonLock(root, id, async () => {
    const dir = lessonDir(root, id);
    const [meta, comments] = await Promise.all([
      getMetadata(root, id),
      readJson(await checkedFile(dir, 'review/annotations.json')),
    ]);
    if (meta.format !== 'pdf') throw Object.assign(new Error('找不到這份 PDF 文件'), {status: 404});
    const documentHash = meta.documentHash;
    return {
      id: meta.id,
      title: meta.title,
      format: 'pdf',
      originalName: meta.originalName,
      materials: meta.materials || [],
      annotations: comments.annotations || [],
      history: comments.history || [],
      pageCount: meta.pageCount,
      documentHash,
      documentToken: meta.documentToken,
      annotationHash: hash(JSON.stringify(comments)),
      updatedAt: meta.updatedAt,
    };
  });
}

export async function listLessons(root) {
  const directory = path.join(root, 'lessons');
  await fs.mkdir(directory, {recursive: true});
  const entries = await fs.readdir(directory, {withFileTypes: true});
  const result = await Promise.all(entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(async entry => {
    try { return await getMetadata(root, entry.name); } catch (error) { throw new Error(`無法讀取文件 ${entry.name}：${error.message}`); }
  }));
  return result.filter(item => item.format === 'pdf').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function deletionTarget(root, id) {
  const dir = lessonDir(root, id);
  const projectRoot = await fs.realpath(root);
  const lessonsPath = path.join(root, 'lessons');
  const lessonsStat = await fs.lstat(lessonsPath).catch(error => {
    if (error.code === 'ENOENT') throw Object.assign(new Error('找不到文件資料夾'), {status: 404});
    throw error;
  });
  if (lessonsStat.isSymbolicLink() || !lessonsStat.isDirectory()) throw new Error('文件資料夾位置無效');
  const lessonsDirectory = await fs.realpath(lessonsPath);
  if (!lessonsDirectory.startsWith(`${projectRoot}${path.sep}`)) throw new Error('文件資料夾位置無效');
  const targetStat = await fs.lstat(dir).catch(error => {
    if (error.code === 'ENOENT') throw Object.assign(new Error('找不到這份文件'), {status: 404});
    throw error;
  });
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) throw new Error('文件檔案位置無效');
  const target = await fs.realpath(dir);
  if (target !== path.join(lessonsDirectory, id) || !target.startsWith(`${lessonsDirectory}${path.sep}`)) throw new Error('文件檔案位置無效');
  const metadata = await getMetadata(root, id);
  if (metadata.id !== id) throw new Error('文件識別碼與資料不符');
  return {dir, target};
}

export async function deleteLesson(root, id) {
  await deletionTarget(root, id);
  return withLessonLock(root, id, async () => {
    const {dir, target} = await deletionTarget(root, id);
    const tombstone = path.join(path.dirname(target), `.delete-${id}-${randomUUID()}`);
    let moved = false;
    let tombstoneExists = false;
    try {
      await fs.rename(target, tombstone);
      moved = true;
      tombstoneExists = true;
      await fs.rm(tombstone, {recursive: true, force: false});
      tombstoneExists = false;
      return {id, deleted: true};
    } catch (error) {
      if (moved) {
        try {
          await fs.rename(tombstone, dir);
          tombstoneExists = false;
        } catch (rollbackError) {
          const rollbackFailure = new AggregateError([error, rollbackError], `文件刪除失敗，復原不完整：${rollbackError.message}`);
          rollbackFailure.status = 500;
          throw rollbackFailure;
        }
      }
      throw error;
    } finally {
      if (!tombstoneExists) await fs.rm(tombstone, {recursive: true, force: true});
    }
  });
}

export async function addMaterial(root, id, data, filename, python = 'python3') {
  const dir = lessonDir(root, id);
  const metadataFile = await checkedFile(dir, 'lesson.json');
  const meta = await readJson(metadataFile);
  filename = safeName(filename);
  const extension = path.extname(filename).toLowerCase();
  if (extension !== '.pdf') throw new Error('參考資料僅支援 .pdf 格式');
  const materialId = randomUUID().slice(0, 8);
  const stored = `${materialId}-${filename}`;
  const materialDirectory = await checkedFile(dir, 'materials');
  const destination = path.join(materialDirectory, stored);
  try {
    const existing = await fs.lstat(destination);
    if (existing.isSymbolicLink()) throw new Error('參考資料檔案位置無效');
    throw new Error('參考資料檔案已存在');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let created = false;
  try {
    await fs.writeFile(destination, data, {flag: 'wx'});
    created = true;
    await inspectPdf(destination, python);
    const material = {id: materialId, file: stored, name: filename, type: extension.slice(1), size: data.length, createdAt: new Date().toISOString()};
    meta.materials = [...(meta.materials || []), material];
    meta.updatedAt = material.createdAt;
    await fs.chmod(destination, 0o444);
    await atomicJson(metadataFile, meta);
    return material;
  } catch (error) {
    const rollbackErrors = [];
    if (created) {
      try { await fs.rm(destination, {force: true}); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) {
      const message = rollbackErrors.map(rollbackError => rollbackError.message).join('。');
      const rollbackFailure = new AggregateError([error, ...rollbackErrors], `參考資料新增失敗，復原不完整：${message}`);
      rollbackFailure.status = 500;
      throw rollbackFailure;
    }
    throw error;
  }
}

async function lockOwner(lock) {
  try {
    const owner = await readJson(path.join(lock, 'owner.json'));
    const pid = Number(owner.pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export async function withLessonLock(root, id, action) {
  const lock = path.join(lessonDir(root, id), '.write-lock');
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.mkdir(lock);
      await atomicJson(path.join(lock, 'owner.json'), {pid: process.pid, createdAt: new Date().toISOString()});
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        await fs.rm(lock, {recursive: true, force: true}).catch(() => {});
        throw error;
      }
      const owner = await lockOwner(lock);
      if (owner && !processAlive(owner)) {
        await fs.rm(lock, {recursive: true, force: true});
        continue;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  if (!acquired) throw new Error('這份文件正在保存，請稍後再試');
  try { return await action(); } finally { await fs.rm(lock, {recursive: true, force: true}); }
}

export async function removeMaterial(root, id, materialId) {
  return withLessonLock(root, id, async () => {
    const dir = lessonDir(root, id);
    const metadataFile = await checkedFile(dir, 'lesson.json');
    const meta = await readJson(metadataFile);
    const material = (meta.materials || []).find(item => item.id === materialId);
    if (!material) throw Object.assign(new Error('找不到參考資料'), {status: 404});
    const materialDirectory = path.join(dir, 'materials');
    const file = await checkedFile(materialDirectory, path.basename(material.file));
    const temporary = path.join(materialDirectory, `.delete-${randomUUID()}`);
    const previousMetadata = await fs.readFile(metadataFile);
    let moved = false;
    let temporaryExists = false;
    try {
      await fs.rename(file, temporary);
      moved = true;
      temporaryExists = true;
      await atomicJson(metadataFile, {...meta, materials: meta.materials.filter(item => item.id !== materialId), updatedAt: new Date().toISOString()});
      await fs.unlink(temporary);
      temporaryExists = false;
    } catch (error) {
      const rollbackErrors = [];
      try { await restoreFile(metadataFile, previousMetadata); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      if (moved) {
        try {
          await fs.rename(temporary, file);
          temporaryExists = false;
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length) {
        const message = rollbackErrors.map(rollbackError => rollbackError.message).join('。');
        const rollbackFailure = new AggregateError([error, ...rollbackErrors], `參考資料刪除失敗，復原不完整：${message}`);
        rollbackFailure.status = 500;
        throw rollbackFailure;
      }
      throw error;
    } finally {
      if (!temporaryExists) await fs.rm(temporary, {force: true});
    }
    return {id: materialId};
  });
}

function annotationGeometry(page, rects, pageCount) {
  const pageNumber = Number(page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) throw new Error('註解頁碼超出 PDF 範圍');
  if (!Array.isArray(rects) || !rects.length) throw new Error('註解需要至少一個框選區域');
  const normalized = rects.map(rect => {
    const values = ['x', 'y', 'width', 'height'].map(key => Number(rect?.[key]));
    if (values.some(value => !Number.isFinite(value))) throw new Error('註解框選區域格式無效');
    const [x, y, width, height] = values;
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) throw new Error('註解框選區域超出頁面範圍');
    return {x, y, width, height};
  });
  return {page: pageNumber, rects: normalized};
}

export async function updateComment(root, id, options) {
  return withLessonLock(root, id, async () => {
    const dir = lessonDir(root, id);
    const file = await checkedFile(dir, 'review/annotations.json');
    const record = await readJson(file);
    record.annotations ??= [];
    record.history ??= [];
    const meta = await readJson(await checkedFile(dir, 'lesson.json'));
    if (meta.format !== 'pdf') throw Object.assign(new Error('找不到這份 PDF 文件'), {status: 404});
    const current = {pageCount: meta.pageCount, documentHash: meta.documentHash};
    if (options.resolve) {
      if (!['resolved', 'dismissed', 'obsolete'].includes(options.status)) throw new Error('status 必須為 resolved、dismissed 或 obsolete');
      const index = record.annotations.findIndex(annotation => annotation.id === options.resolve);
      if (index < 0) throw new Error('找不到指定註解');
      const [comment] = record.annotations.splice(index, 1);
      record.history.push({...comment, status: options.status, note: options.note || '', resolvedAt: new Date().toISOString()});
    } else {
      if (!options.anchor || !options.text) throw new Error('需提供 anchor 和 text');
      const geometry = annotationGeometry(options.page, options.rects, current.pageCount);
      const existing = options.id ? record.annotations.find(annotation => annotation.id === options.id) : null;
      if (options.id && !existing) throw new Error('找不到指定註解');
      const annotation = {
        ...(existing || {}),
        anchorText: options.anchor,
        text: options.text,
        page: geometry.page,
        rects: geometry.rects,
        documentSha256: current.documentHash,
      };
      if (existing) Object.assign(existing, annotation);
      else {
        const highest = Math.max(0, ...[...record.annotations, ...record.history].map(item => Number(item.id?.replace('#', '')) || 0));
        const number = Math.max(Number(record.nextNumber || 1), highest + 1);
        record.annotations.push({...annotation, id: `#${String(number).padStart(3, '0')}`});
        record.nextNumber = number + 1;
      }
    }
    await atomicJson(file, record);
    return record;
  });
}
