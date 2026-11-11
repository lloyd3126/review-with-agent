import fs from 'node:fs/promises';
import path from 'node:path';

export function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

export async function checkDirectory(directory) {
  try {
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('拒絕處理非一般資料夾：' + directory);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function validateProject(projectRoot, {ensureRuntime = false, requireLessons = false} = {}) {
  const root = path.resolve(projectRoot);
  if (root === path.parse(root).root) throw new Error('專案位置無效');
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'workbench/package.json'), 'utf8'));
  if (metadata.name !== 'lesson-review-workbench') throw new Error('這不是文件工作台專案');
  await fs.access(path.join(root, 'AGENTS.md'));
  await checkDirectory(path.join(root, '.runtime'));
  await checkDirectory(path.join(root, 'lessons'));
  if (ensureRuntime) await fs.mkdir(path.join(root, '.runtime'), {recursive: true});
  if (requireLessons) await fs.mkdir(path.join(root, 'lessons'), {recursive: true});
  return root;
}

export async function withWorkspaceLock(projectRoot, action, {wait = false, errorMessage = '工作台正在處理其他啟停操作，請稍後再試'} = {}) {
  const root = await validateProject(projectRoot, {ensureRuntime: true});
  const runtime = path.join(root, '.runtime');
  const lock = path.join(runtime, 'start.lock');
  while (true) {
    try {
      await fs.mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try {
        owner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'));
      } catch {}
      if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 1) throw new Error(errorMessage);
      if (processExists(owner.pid)) {
        if (!wait) throw new Error(errorMessage);
        for (let attempt = 0; attempt < 50; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
          try {
            await fs.access(lock);
          } catch (accessError) {
            if (accessError.code === 'ENOENT') break;
            throw accessError;
          }
          if (attempt === 49) throw new Error(errorMessage);
        }
        continue;
      }
      await fs.rm(lock, {recursive: true, force: true});
    }
  }
  try {
    await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({pid: process.pid}));
    return await action(runtime, root);
  } finally {
    await fs.rm(lock, {recursive: true, force: true});
  }
}
