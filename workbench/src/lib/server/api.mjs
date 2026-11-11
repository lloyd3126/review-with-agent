import path from 'node:path';
import {
  addMaterial,
  getLesson,
  importLesson,
  listLessons,
  readCurrentDocument,
  removeMaterial,
  replaceDocument,
  withLessonLock,
} from './store.mjs';

const response = (data, status = 200) => Response.json(data, {
  status,
  headers: {'Cache-Control': 'no-store'},
});

function pdfResponse(data) {
  return new Response(data, {headers: {
    'Content-Type': 'application/pdf',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }});
}

async function readBody(request) {
  const limit = 30 * 1024 * 1024;
  if (Number(request.headers.get('content-length')) > limit) {
    throw Object.assign(new Error('檔案上限為 30 MB'), {status: 413});
  }
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let length = 0;
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw Object.assign(new Error('檔案上限為 30 MB'), {status: 413});
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function lessonView(lesson) {
  return {
    id: lesson.id,
    title: lesson.title,
    format: lesson.format,
    originalName: lesson.originalName,
    materials: lesson.materials || [],
    annotations: lesson.annotations || [],
    history: lesson.history || [],
    pageCount: lesson.pageCount,
    documentHash: lesson.documentHash,
    documentToken: lesson.documentToken,
    annotationHash: lesson.annotationHash,
    updatedAt: lesson.updatedAt,
  };
}

export async function handleRequest(request) {
  try {
    const root = process.env.LESSON_PROJECT_ROOT;
    if (!root || !path.isAbsolute(root)) throw new Error('工作台缺少專案位置，請透過 Agent 啟動。');
    const python = process.env.LESSON_PYTHON || 'python3';
    const token = process.env.LESSON_TOKEN;
    const url = new URL(request.url);
    const host = request.headers.get('host');
    if (!/^((127\.0\.0\.1)|(localhost)):\d+$/.test(host || '')) {
      return response({error: '只能由本機工作台存取'}, 403);
    }
    if (['POST', 'DELETE'].includes(request.method)) {
      if (!token || request.headers.get('x-workbench-token') !== token) {
        return response({error: '工作台已重新啟動，請重新整理頁面'}, 403);
      }
      if (request.headers.get('origin') && request.headers.get('origin') !== `http://${host}`) {
        return response({error: '來源不符'}, 403);
      }
    }

    const pathname = decodeURIComponent(url.pathname);
    if (request.method === 'GET' && pathname === '/api/health') {
      return response({
        app: 'lesson-review-workspace',
        schemaVersion: 1,
        projectRoot: root,
        pid: process.pid,
        token,
        buildFingerprint: process.env.LESSON_BUILD,
      });
    }
    if (request.method === 'GET' && pathname === '/api/lessons') {
      const lessons = await listLessons(root);
      return response({lessons: lessons.map(({id, title}) => ({id, title}))});
    }
    if (request.method === 'POST' && pathname === '/api/lessons') {
      const data = await readBody(request);
      if (!data.length) return response({error: '檔案內容為空'}, 400);
      return response(await importLesson(
        root,
        data,
        decodeURIComponent(request.headers.get('x-filename') || ''),
        decodeURIComponent(request.headers.get('x-title') || ''),
        python,
      ), 201);
    }

    const match = pathname.match(/^\/api\/lessons\/([a-z0-9-]+)(?:\/(.*))?$/);
    if (match) {
      const [, id, resource] = match;
      if (request.method === 'GET' && !resource) {
        return response(lessonView(await getLesson(root, id)));
      }
      if (request.method === 'GET' && resource === 'document') {
        const selected = await readCurrentDocument(root, id, {
          hash: url.searchParams.get('hash') || '',
          token: url.searchParams.get('token') || '',
        });
        return pdfResponse(selected.data);
      }
      if (request.method === 'POST' && resource === 'document') {
        const data = await readBody(request);
        if (!data.length) return response({error: '檔案內容為空'}, 400);
        return response(await replaceDocument(root, id, data, decodeURIComponent(request.headers.get('x-filename') || ''), python), 200);
      }
      if (request.method === 'POST' && resource === 'materials') {
        const data = await readBody(request);
        if (!data.length) return response({error: '檔案內容為空'}, 400);
        return response(await withLessonLock(root, id, () => addMaterial(
          root,
          id,
          data,
          decodeURIComponent(request.headers.get('x-filename') || ''),
          python,
        )), 201);
      }
      if (request.method === 'DELETE' && /^materials\/[a-f0-9]{8}$/.test(resource || '')) {
        return response(await removeMaterial(root, id, resource.slice('materials/'.length)));
      }
    }
    return response({error: '找不到這份資料'}, 404);
  } catch (error) {
    console.error(error.message);
    return response({error: error.message}, error.status || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 400));
  }
}
