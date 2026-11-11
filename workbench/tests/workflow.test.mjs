import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const execute = promisify(execFile);
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const python = process.env.LESSON_TEST_PYTHON || 'python3';
const cli = path.join(sourceRoot, '.agents/skills/lesson-review-workspace/scripts/workbench.mjs');

test('PDF 教案替換、註解重置、參考資料保留與檔案邊界', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lesson-pdf-workbench-'));
  process.env.LESSON_PROJECT_ROOT = root;
  process.env.LESSON_APP_ROOT = path.join(sourceRoot, 'workbench');
  process.env.LESSON_PYTHON = python;
  process.env.LESSON_TOKEN = 'test-token';
  const {handleRequest} = await import('../src/lib/server/api.mjs');
  const {getLesson, hash, replaceDocument} = await import('../src/lib/server/store.mjs');
  async function api(route, options = {}) {
    return handleRequest(new Request(`http://127.0.0.1:9999${route}`, {
      ...options,
      headers: {host: '127.0.0.1:9999', 'x-workbench-token': 'test-token', ...options.headers},
    }));
  }
  const run = async (...args) => JSON.parse((await execute(process.execPath, [cli, ...args, '--project-root', root, '--python', python])).stdout);
  try {
    const pdfBytes = Buffer.from('JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgKHB5cGRmKQo+PgplbmRvYmoKMiAwIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDEKL0tpZHMgWyA0IDAgUiBdCj4+CmVuZG9iagozIDAgb2JqCjw8Ci9UeXBlIC9DYXRhbG9nCi9QYWdlcyAyIDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8Cj4+Ci9NZWRpYUJveCBbIDAuMCAwLjAgNjEyIDc5MiBdCi9QYXJlbnQgMiAwIFIKPj4KZW5kb2JqCnhyZWYKMCA1CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDU0IDAwMDAwIG4gCjAwMDAwMDAxMTMgMDAwMDAgbiAKMDAwMDAwMDE2MiAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDUKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKPj4Kc3RhcnR4cmVmCjI1NgolJUVPRgo=', 'base64');
    const secondData = Buffer.concat([pdfBytes, Buffer.from('\n')]);
    const bad = await api('/api/lessons', {method: 'POST', headers: {'x-filename': 'lesson.docx'}, body: pdfBytes});
    assert.equal(bad.status, 400);
    const invalid = await api('/api/lessons', {method: 'POST', headers: {'x-filename': 'broken.pdf'}, body: Buffer.from('%PDF-1.7\nnot a document')});
    assert.equal(invalid.status, 400);
    const {stdout: rejectedPdfs} = await execute(python, ['-c', 'import base64,io,json\nfrom pypdf import PdfWriter\nresult=[]\nfor encrypted in (False,True):\n writer=PdfWriter()\n if encrypted:\n  writer.add_blank_page(width=612,height=792)\n  writer.encrypt("test-password")\n output=io.BytesIO()\n writer.write(output)\n result.append(base64.b64encode(output.getvalue()).decode())\nprint(json.dumps(result))'], {env: {...process.env, PYTHONPATH: path.join(sourceRoot, '.runtime/python-libs')}});
    for (const encoded of JSON.parse(rejectedPdfs)) {
      const rejected = await api('/api/lessons', {method: 'POST', headers: {'x-filename': 'unreadable.pdf'}, body: Buffer.from(encoded, 'base64')});
      assert.equal(rejected.status, 400);
    }
    const imported = await api('/api/lessons', {method: 'POST', headers: {'x-filename': encodeURIComponent('教案.pdf')}, body: pdfBytes});
    assert.equal(imported.status, 201);
    const metadata = await imported.json();
    const lessonId = metadata.id;
    assert.equal(metadata.format, 'pdf');
    assert.match(metadata.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(metadata.pageCount, 1);
    assert.match(metadata.documentToken, /^[0-9a-f-]{36}$/);
    assert.equal(metadata.documentHash, hash(pdfBytes));
    assert.equal('versions' in metadata, false);
    assert.equal('currentVersion' in metadata, false);
    const dir = path.join(root, 'lessons', lessonId);
    assert.deepEqual(await fs.readdir(dir), ['document.pdf', 'lesson.json', 'materials', 'review']);
    assert.deepEqual(await fs.readFile(path.join(dir, 'document.pdf')), pdfBytes);
    const lock = path.join(dir, '.write-lock');
    const storeUrl = new URL('../src/lib/server/store.mjs', import.meta.url).href;
    const holderCode = `import {withLessonLock} from ${JSON.stringify(storeUrl)}; await withLessonLock(${JSON.stringify(root)}, ${JSON.stringify(lessonId)}, async()=>{setInterval(()=>{},1000); await new Promise(()=>{});});`;
    const holder = spawn(process.execPath, ['--input-type=module', '-e', holderCode], {stdio: 'ignore'});
    let ownerReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await fs.access(path.join(lock, 'owner.json'));
        ownerReady = true;
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    assert.equal(ownerReady, true);
    const holderExit = new Promise(resolve => holder.once('exit', resolve));
    holder.kill('SIGKILL');
    await holderExit;
    const listed = await (await api('/api/lessons')).json();
    assert.deepEqual(listed.lessons.map(item => item.id), [lessonId]);
    let lesson = await (await api(`/api/lessons/${lessonId}`)).json();
    assert.equal(lesson.pageCount, 1);
    assert.equal(lesson.documentHash, hash(pdfBytes));
    assert.equal(lesson.documentToken, metadata.documentToken);
    assert.equal(lesson.annotations.length, 0);
    const document = await api(`/api/lessons/${lessonId}/document?hash=${lesson.documentHash}&token=${lesson.documentToken}`);
    assert.equal(document.status, 200);
    assert.equal(document.headers.get('content-type'), 'application/pdf');
    assert.equal(document.headers.get('content-disposition'), null);
    assert.deepEqual(Buffer.from(await document.arrayBuffer()), pdfBytes);
    const missingFile = path.join(root, 'missing.json');
    await fs.writeFile(missingFile, JSON.stringify({anchorText: '沒有座標', text: '應該失敗'}));
    await assert.rejects(execute(process.execPath, [cli, 'add-comment', '--lesson', lessonId, '--data', missingFile, '--project-root', root, '--python', python]));
    const commentFile = path.join(root, 'comment.json');
    await fs.writeFile(commentFile, JSON.stringify({anchorText: '教學目標', text: '請說明這個目標如何被觀察。', page: 1, rects: [{x: 0.1, y: 0.2, width: 0.4, height: 0.05}]}));
    const record = await run('add-comment', '--lesson', lessonId, '--data', commentFile);
    assert.equal(record.annotations[0].id, '#001');
    assert.equal(record.annotations[0].documentSha256, hash(pdfBytes));
    const updateFile = path.join(root, 'update.json');
    await fs.writeFile(updateFile, JSON.stringify({anchorText: '新的位置', text: '更新問題', page: 1, rects: [{x: 0.2, y: 0.3, width: 0.2, height: 0.04}]}));
    const updated = await run('add-comment', '--lesson', lessonId, '--id', '#001', '--data', updateFile);
    assert.equal(updated.annotations.length, 1);
    assert.equal(updated.annotations[0].id, '#001');
    assert.equal(updated.annotations[0].anchorText, '新的位置');
    const materialDirectory = path.join(dir, 'materials');
    const materialData = {file: '課本.pdf'};
    const metadataBeforeMaterials = await fs.readFile(path.join(dir, 'lesson.json'));
    const beforeMaterials = await getLesson(root, lessonId);
    await fs.writeFile(path.join(materialDirectory, materialData.file), pdfBytes);
    await fs.writeFile(path.join(materialDirectory, '要求.md'), '# 文件要求');
    await fs.writeFile(path.join(materialDirectory, '補充.custom'), 'Any format');
    await fs.writeFile(path.join(materialDirectory, '.draft'), 'Hidden work in progress');
    await fs.mkdir(path.join(materialDirectory, 'folder'));
    const outsideMaterial = path.join(root, 'outside-material.txt');
    await fs.writeFile(outsideMaterial, 'outside');
    await fs.symlink(outsideMaterial, path.join(materialDirectory, 'link.txt'));
    const withMaterials = await (await api(`/api/lessons/${lessonId}`)).json();
    assert.deepEqual(new Set(withMaterials.materials.map(item => item.name)), new Set(['課本.pdf', '要求.md', '補充.custom']));
    assert.notEqual(withMaterials.materialHash, beforeMaterials.materialHash);
    assert.deepEqual(await fs.readFile(path.join(dir, 'lesson.json')), metadataBeforeMaterials);
    await fs.writeFile(path.join(materialDirectory, '要求.md'), '# Agent 更新的文件要求');
    const editedMaterials = await getLesson(root, lessonId);
    assert.notEqual(editedMaterials.materialHash, withMaterials.materialHash);
    await fs.unlink(path.join(materialDirectory, '補充.custom'));
    const removedMaterials = await getLesson(root, lessonId);
    assert.equal(removedMaterials.materials.some(item => item.name === '補充.custom'), false);
    assert.notEqual(removedMaterials.materialHash, editedMaterials.materialHash);
    assert.equal((await api(`/api/lessons/${lessonId}/materials`, {method: 'POST', headers: {'x-filename': 'extra.pdf'}, body: pdfBytes})).status, 404);
    assert.equal((await api(`/api/lessons/${lessonId}/materials/12345678`, {method: 'DELETE'})).status, 404);
    assert.equal((await api(`/api/lessons/${lessonId}/materials/12345678`)).status, 404);
    const previousToken = lesson.documentToken;
    const replaced = await api(`/api/lessons/${lessonId}/document`, {method: 'POST', headers: {'x-filename': encodeURIComponent('新版.pdf')}, body: secondData});
    assert.equal(replaced.status, 200);
    const replacement = await replaced.json();
    assert.equal(replacement.originalName, '新版.pdf');
    assert.equal(replacement.documentHash, hash(secondData));
    assert.notEqual(replacement.documentToken, previousToken);
    assert.equal('versions' in replacement, false);
    assert.equal('currentVersion' in replacement, false);
    lesson = await (await api(`/api/lessons/${lessonId}`)).json();
    assert.equal(lesson.annotations.length, 0);
    assert.equal(lesson.history.length, 0);
    assert.equal(lesson.documentHash, hash(secondData));
    assert.equal(lesson.originalName, '新版.pdf');
    assert.deepEqual(await fs.readFile(path.join(dir, 'materials', materialData.file)), pdfBytes);
    assert.deepEqual(lesson.materials, removedMaterials.materials);
    const replacedDocument = await api(`/api/lessons/${lessonId}/document?hash=${lesson.documentHash}&token=${lesson.documentToken}`);
    assert.deepEqual(Buffer.from(await replacedDocument.arrayBuffer()), secondData);
    assert.equal((await api(`/api/lessons/${lessonId}/document?hash=${hash(pdfBytes)}`)).status, 409);
    assert.equal((await api(`/api/lessons/${lessonId}/document?token=${previousToken}`)).status, 409);
    const secondComment = await run('add-comment', '--lesson', lessonId, '--data', commentFile);
    assert.equal(secondComment.annotations[0].id, '#001');
    assert.equal((await run('resolve-comment', '--lesson', lessonId, '--id', '#001', '--status', 'resolved')).history[0].status, 'resolved');
    const sameBytes = await api(`/api/lessons/${lessonId}/document`, {method: 'POST', headers: {'x-filename': encodeURIComponent('同內容.pdf')}, body: secondData});
    assert.equal(sameBytes.status, 200);
    const sameBytesData = await sameBytes.json();
    assert.notEqual(sameBytesData.documentToken, replacement.documentToken);
    lesson = await (await api(`/api/lessons/${lessonId}`)).json();
    assert.deepEqual(lesson.annotations, []);
    assert.deepEqual(lesson.history, []);
    await run('add-comment', '--lesson', lessonId, '--data', commentFile);
    const beforeCommitFailure = {
      document: await fs.readFile(path.join(dir, 'document.pdf')),
      metadata: await fs.readFile(path.join(dir, 'lesson.json')),
      review: await fs.readFile(path.join(dir, 'review', 'annotations.json')),
    };
    const originalRename = fs.rename;
    let failMetadataCommit = true;
    fs.rename = async (from, to) => {
      if (failMetadataCommit && path.basename(to) === 'lesson.json' && from.endsWith('.tmp')) {
        failMetadataCommit = false;
        throw new Error('注入 metadata commit 失敗');
      }
      return originalRename(from, to);
    };
    try {
      await assert.rejects(replaceDocument(root, lessonId, pdfBytes, 'commit-failure.pdf', python), /注入 metadata commit 失敗/);
    } finally {
      fs.rename = originalRename;
    }
    assert.deepEqual(await fs.readFile(path.join(dir, 'document.pdf')), beforeCommitFailure.document);
    assert.deepEqual(await fs.readFile(path.join(dir, 'lesson.json')), beforeCommitFailure.metadata);
    assert.deepEqual(await fs.readFile(path.join(dir, 'review', 'annotations.json')), beforeCommitFailure.review);
    assert.deepEqual((await fs.readdir(dir)).filter(name => name.startsWith('.document-backup-')), []);
    let failMetadataAndRollback = true;
    let failBackupRestore = true;
    fs.rename = async (from, to) => {
      if (failMetadataAndRollback && path.basename(to) === 'lesson.json' && from.endsWith('.tmp')) {
        failMetadataAndRollback = false;
        throw new Error('注入 metadata commit 失敗');
      }
      if (failBackupRestore && path.basename(from).startsWith('.document-backup-') && path.basename(to) === 'document.pdf') {
        failBackupRestore = false;
        throw new Error('注入 backup rollback 失敗');
      }
      return originalRename(from, to);
    };
    try {
      await assert.rejects(replaceDocument(root, lessonId, pdfBytes, 'rollback-failure.pdf', python), /復原不完整/);
    } finally {
      fs.rename = originalRename;
    }
    const backupNames = (await fs.readdir(dir)).filter(name => name.startsWith('.document-backup-') && name.endsWith('.pdf'));
    assert.equal(backupNames.length, 1);
    assert.deepEqual(await fs.readFile(path.join(dir, backupNames[0])), beforeCommitFailure.document);
    await fs.rename(path.join(dir, backupNames[0]), path.join(dir, 'document.pdf'));
    const beforeInvalid = {hash: lesson.documentHash, token: lesson.documentToken, materials: lesson.materials};
    const invalidReplacement = await api(`/api/lessons/${lessonId}/document`, {method: 'POST', headers: {'x-filename': encodeURIComponent('壞檔.pdf')}, body: Buffer.from('%PDF-1.7\nnot a document')});
    assert.equal(invalidReplacement.status, 400);
    lesson = await (await api(`/api/lessons/${lessonId}`)).json();
    assert.equal(lesson.documentHash, beforeInvalid.hash);
    assert.equal(lesson.documentToken, beforeInvalid.token);
    assert.deepEqual(lesson.materials, beforeInvalid.materials);
    assert.deepEqual(await fs.readFile(path.join(dir, 'document.pdf')), secondData);
    assert.equal((await api(`/api/lessons/${lessonId}/original`)).status, 404);
    assert.equal((await api(`/api/lessons/${lessonId}/versions/v001.pdf`)).status, 404);
    assert.equal((await api(`/api/lessons/${lessonId}/versions`, {method: 'POST', body: secondData, headers: {'x-filename': encodeURIComponent('新版.pdf')}})).status, 404);
    const outside = path.join(root, 'outside.pdf');
    await fs.writeFile(outside, secondData);
    await fs.unlink(path.join(dir, 'document.pdf'));
    await fs.symlink(outside, path.join(dir, 'document.pdf'));
    assert.equal((await api(`/api/lessons/${lessonId}/document`)).status, 400);
    await fs.unlink(path.join(dir, 'document.pdf'));
    await fs.copyFile(outside, path.join(dir, 'document.pdf'));
    const stored = await getLesson(root, lessonId);
    assert.equal(stored.documentHash, hash(secondData));
    const otherImport = await api('/api/lessons', {method: 'POST', headers: {'x-filename': encodeURIComponent('另一份教案.pdf')}, body: pdfBytes});
    assert.equal(otherImport.status, 201);
    const otherLesson = await otherImport.json();
    await assert.rejects(execute(process.execPath, [cli, 'delete-document', '--lesson', lessonId, '--project-root', root, '--python', python]));
    await fs.access(dir);
    const outsideLesson = path.join(root, 'outside-lesson');
    const outsideMarker = path.join(outsideLesson, 'marker.txt');
    await fs.mkdir(outsideLesson);
    await fs.writeFile(outsideMarker, 'outside');
    const externalId = '20990101-external';
    const externalLink = path.join(root, 'lessons', externalId);
    await fs.symlink(outsideLesson, externalLink, 'dir');
    await assert.rejects(execute(process.execPath, [cli, 'delete-document', '--lesson', externalId, '--confirm-delete', '--project-root', root, '--python', python]));
    assert.equal(await fs.readFile(outsideMarker, 'utf8'), 'outside');
    assert.equal((await fs.lstat(externalLink)).isSymbolicLink(), true);
    const deleted = await run('delete-document', '--lesson', lessonId, '--confirm-delete');
    assert.deepEqual(deleted, {id: lessonId, deleted: true});
    await assert.rejects(fs.access(dir));
    await fs.access(path.join(root, 'lessons', otherLesson.id, 'document.pdf'));
    const remaining = await run('list');
    assert.deepEqual(remaining.lessons.map(item => item.id), [otherLesson.id]);
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});
