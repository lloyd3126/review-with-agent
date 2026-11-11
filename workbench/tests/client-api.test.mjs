import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {isFatal, readJSON, RequestError, uploadFile} from '../src/lib/client/api.js';

test('請求正確區分可繼續操作的資料錯誤與整頁服務錯誤', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/ok') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ready: true}));
    } else if (request.url === '/missing') {
      response.writeHead(404, {'Content-Type': 'application/json'});
      response.end(JSON.stringify({error: '找不到教案'}));
    } else if (request.url === '/unavailable') {
      response.writeHead(503, {'Content-Type': 'application/json'});
      response.end(JSON.stringify({error: '服務暫時無法使用'}));
    } else if (request.url === '/invalid') response.end('<html>invalid response</html>');
    else if (request.url === '/slow') setTimeout(() => response.end('{}'), 100);
    else if (request.url === '/slow-body') {
      response.writeHead(200, {'Content-Type': 'application/json'});
      response.write('{');
      setTimeout(() => response.end('}'), 100);
    }
    else { response.writeHead(404); response.end('missing'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await readJSON(`${base}/ok`), {ready: true});
    await assert.rejects(readJSON(`${base}/missing`), error => error instanceof RequestError
      && error.status === 404 && error.message === '找不到教案' && !isFatal(error));
    await assert.rejects(readJSON(`${base}/unknown`), error => error.status === 404 && !isFatal(error));
    await assert.rejects(readJSON(`${base}/unavailable`), error => error.status === 503 && isFatal(error));
    await assert.rejects(readJSON(`${base}/invalid`), error => error.kind === 'protocol' && isFatal(error));
    await assert.rejects(readJSON(`${base}/slow`, {timeout: 10}), error => error.kind === 'connection' && isFatal(error));
    await assert.rejects(readJSON(`${base}/slow-body`, {timeout: 10}), error => error.kind === 'connection' && isFatal(error));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(readJSON(`${base}/slow`, {signal: controller.signal}), error => error.name === 'AbortError' && !isFatal(error));
    await assert.rejects(uploadFile(`${base}/upload`, {name: 'too-large.docx', size: 31 * 1024 * 1024}, 'token'), /超過 30 MB/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
