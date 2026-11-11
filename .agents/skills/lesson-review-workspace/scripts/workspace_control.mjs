import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {withWorkspaceLock,processExists} from './workspace_lifecycle.mjs';
export async function stopRegisteredServer(root,runtime){
  const stateFile=path.join(runtime,'workbench.json');
  let state;
  try{state=JSON.parse(await fs.readFile(stateFile,'utf8'));}catch(error){if(error.code==='ENOENT')return {stopped:true,alreadyStopped:true};throw error;}
  if(state.app!=='lesson-review-workspace'||state.projectRoot!==root||!Number.isSafeInteger(state.pid)||state.pid<=1||!/^http:\/\/127\.0\.0\.1:\d+$/.test(state.url||''))throw new Error('伺服器紀錄無法核對，未停止任何程序');
  let health;
  try{
    const response=await fetch(state.url+'/api/health',{signal:AbortSignal.timeout(1500)});
    if(response.ok)health=await response.json();
  }catch{}
  if(health&&(health.app!=='lesson-review-workspace'||health.projectRoot!==root||health.pid!==state.pid))throw new Error('連線不是本專案的伺服器，未停止任何程序');
  if(!health){
    if(processExists(state.pid))throw new Error('無法核對仍在執行的伺服器，未停止程序或清空資料');
    await fs.unlink(stateFile);
    return {stopped:true,alreadyStopped:true};
  }
  try{process.kill(state.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
  for(let attempt=0;attempt<50;attempt++){
    if(!processExists(state.pid)){
      await fs.unlink(stateFile);
      return {stopped:true,alreadyStopped:false,pid:state.pid};
    }
    await delay(100);
  }
  throw new Error('伺服器尚未停止，保留文件資料');
}
export async function stopWorkspace(projectRoot){
  const root=path.resolve(projectRoot);
  return withWorkspaceLock(root,async runtime=>({...await stopRegisteredServer(root,runtime),projectRoot:root}));
}
export async function resetWorkspace(projectRoot,{confirmed=false}={}){
  if(!confirmed)throw new Error('清空會移除所有文件與相關資料，需明確授權後使用 --confirm-reset');
  const root=path.resolve(projectRoot);
  return withWorkspaceLock(root,async runtime=>{
    const lessons=path.join(root,'lessons');
    await fs.mkdir(lessons,{recursive:true});
    const stopped=await stopRegisteredServer(root,runtime);
    const entries=await fs.readdir(lessons,{withFileTypes:true});
    for(const entry of entries)await fs.rm(path.join(lessons,entry.name),{recursive:true,force:true});
    if((await fs.readdir(lessons)).length)throw new Error('資料夾仍有新增資料，尚未恢復初始狀態');
    return {reset:true,serverStopped:stopped.stopped,removedLessons:entries.filter(entry=>entry.isDirectory()&&!entry.name.startsWith('.')).length,projectRoot:root};
  });
}
