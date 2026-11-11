export class RequestError extends Error {
  constructor(message, {status, resource, kind = 'request'} = {}) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.resource = resource;
    this.kind = kind;
  }
}

export function isFatal(error) {
  return error.kind === 'connection' || error.kind === 'protocol' || error.status >= 500;
}

async function request(url, {timeout = 10000, signal, ...options} = {}, consume) {
  const deadline = AbortSignal.timeout(timeout);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const response = await fetch(url, {cache: 'no-store', ...options, signal: combined});
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new RequestError(result?.error || '無法讀取這份資料。', {
        status: response.status,
        resource: url,
      });
    }
    return await consume(response);
  } catch (error) {
    if (signal?.aborted || error instanceof RequestError) throw error;
    throw new RequestError(deadline.aborted ? '連線逾時，工作台沒有回應。' : '無法連線至工作台。', {
      resource: url,
      kind: 'connection',
    });
  }
}

export function readJSON(url, options) {
  return request(url, options, async response => {
    try { return await response.json(); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new RequestError('工作台傳回無法讀取的資料。', {
        resource: url,
        status: response.status,
        kind: 'protocol',
      });
    }
  });
}

export function readDocument(id, hash, token, signal) {
  return request(`/api/lessons/${id}/document?hash=${hash}&token=${token}`, {signal}, response => response.arrayBuffer());
}

export async function uploadFile(url, file, token) {
  if (file.size > 30 * 1024 * 1024) throw new Error(`${file.name} 超過 30 MB，請先縮小檔案。`);
  return readJSON(url, {
    method: 'POST',
    timeout: 60000,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name),
      'X-Workbench-Token': token,
    },
    body: file,
  });
}
