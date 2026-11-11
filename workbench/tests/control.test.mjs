import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFile} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {stopWorkspace,resetWorkspace} from '../../.agents/skills/lesson-review-workspace/scripts/workspace_control.mjs';

const execute=promisify(execFile);
const cli=new URL('../../.agents/skills/lesson-review-workspace/scripts/workbench.mjs',import.meta.url).pathname;
async function project(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lesson-reset-'));
  await fs.mkdir(path.join(root,'workbench'));
  await fs.mkdir(path.join(root,'.runtime'));
  await fs.mkdir(path.join(root,'lessons','test-lesson','originals'),{recursive:true});
  await fs.writeFile(path.join(root,'AGENTS.md'),'project instructions');
  await fs.writeFile(path.join(root,'workbench/package.json'),JSON.stringify({name:'lesson-review-workbench'}));
  await fs.writeFile(path.join(root,'lessons/test-lesson/originals/lesson.docx'),'original lesson');
  await fs.writeFile(path.join(root,'.runtime/build.json'),'preserve installed environment');
  return root;
}
async function server(root,serverRoot=root,{ignoreStop=false}={}){
  const child=spawn(process.execPath,['--input-type=module','-e',`
    import http from 'node:http';
    if(process.env.TEST_IGNORE_TERM==='1')process.on('SIGTERM',()=>{});
    const server=http.createServer((request,response)=>{
      response.setHeader('Content-Type','application/json');
      response.end(JSON.stringify({app:'lesson-review-workspace',projectRoot:process.env.TEST_PROJECT_ROOT,pid:process.pid}));
    });
    server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({url:'http://127.0.0.1:'+server.address().port})));
  `],{env:{...process.env,TEST_PROJECT_ROOT:serverRoot,TEST_IGNORE_TERM:ignoreStop?'1':'0'},stdio:['ignore','pipe','ignore']});
  const [chunk]=await once(child.stdout,'data');
  const state={app:'lesson-review-workspace',projectRoot:root,pid:child.pid,url:JSON.parse(chunk.toString()).url};
  await fs.writeFile(path.join(root,'.runtime/workbench.json'),JSON.stringify(state));
  return {child,state};
}
async function cleanup(root,child){
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}
  await fs.rm(root,{recursive:true,force:true});
}

test('停止保留資料，重設停止伺服器並清空資料，重複重設可正常執行',async()=>{
  const root=await project();let child;
  try{
    let running=await server(root);child=running.child;
    await assert.rejects(resetWorkspace(root),/confirm-reset/);
    assert.equal((await fetch(running.state.url)).status,200);
    assert.equal((await stopWorkspace(root)).stopped,true);
    assert.equal(await fs.readFile(path.join(root,'lessons/test-lesson/originals/lesson.docx'),'utf8'),'original lesson');
    running=await server(root);child=running.child;
    await fs.writeFile(path.join(root,'keep.txt'),'outside lessons');
    await fs.symlink(path.join(root,'keep.txt'),path.join(root,'lessons','outside-link'));
    const result=await resetWorkspace(root,{confirmed:true});
    assert.equal(result.reset,true);assert.equal(result.serverStopped,true);assert.equal(result.removedLessons,1);
    assert.deepEqual(await fs.readdir(path.join(root,'lessons')),[]);
    await assert.rejects(fetch(running.state.url,{signal:AbortSignal.timeout(1000)}));
    assert.equal(await fs.readFile(path.join(root,'keep.txt'),'utf8'),'outside lessons');
    assert.equal(await fs.readFile(path.join(root,'.runtime/build.json'),'utf8'),'preserve installed environment');
    assert.equal(await fs.readFile(path.join(root,'AGENTS.md'),'utf8'),'project instructions');
    const repeated=await execute(process.execPath,[cli,'reset','--confirm-reset','--project-root',root]);
    assert.equal(JSON.parse(repeated.stdout).removedLessons,0);
  }finally{await cleanup(root,child);}
});

test('服務身份不符時不停止程序，也不刪除教案',async()=>{
  const root=await project();let child;
  try{
    const running=await server(root,root+'-another-project');child=running.child;
    await assert.rejects(resetWorkspace(root,{confirmed:true}),/不是本專案/);
    assert.equal((await fetch(running.state.url)).status,200);
    assert.equal(await fs.readFile(path.join(root,'lessons/test-lesson/originals/lesson.docx'),'utf8'),'original lesson');
    await fs.writeFile(path.join(root,'.runtime/workbench.json'),JSON.stringify({...running.state,pid:process.pid}));
    await assert.rejects(stopWorkspace(root),/不是本專案/);
    assert.equal((await fetch(running.state.url)).status,200);
  }finally{await cleanup(root,child);}
});

test('拒絕跨出專案的資料夾連結與啟停鎖定衝突',async()=>{
  const root=await project();
  try{
    const outside=path.join(root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep.txt'),'keep');
    await fs.rm(path.join(root,'lessons'),{recursive:true});await fs.symlink(outside,path.join(root,'lessons'),'dir');
    await assert.rejects(resetWorkspace(root,{confirmed:true}),/非一般資料夾/);
    assert.equal(await fs.readFile(path.join(outside,'keep.txt'),'utf8'),'keep');
    await fs.unlink(path.join(root,'lessons'));await fs.mkdir(path.join(root,'lessons'));
    await fs.mkdir(path.join(root,'.runtime/start.lock'));
    await assert.rejects(resetWorkspace(root,{confirmed:true}),/啟停操作/);
    await fs.access(path.join(root,'lessons'));
    await fs.writeFile(path.join(root,'.runtime/start.lock/owner.json'),JSON.stringify({pid:process.pid}));
    await assert.rejects(resetWorkspace(root,{confirmed:true}),/啟停操作/);
    await fs.access(path.join(root,'.runtime/start.lock'));
    await fs.rm(path.join(root,'.runtime'),{recursive:true});await fs.symlink(outside,path.join(root,'.runtime'),'dir');
    await assert.rejects(resetWorkspace(root,{confirmed:true}),/非一般資料夾/);
    assert.equal(await fs.readFile(path.join(outside,'keep.txt'),'utf8'),'keep');
  }finally{await cleanup(root);}
});

test('伺服器已停止但留下紀錄時仍可恢復初始狀態',async()=>{
  const root=await project();let child;
  try{
    const running=await server(root);child=running.child;
    const exited=once(child,'exit');child.kill();await exited;
    const result=await resetWorkspace(root,{confirmed:true});
    assert.equal(result.serverStopped,true);assert.equal(result.removedLessons,1);
    await assert.rejects(fs.access(path.join(root,'.runtime/workbench.json')),{code:'ENOENT'});
  }finally{await cleanup(root,child);}
});

test('啟停程序已結束時會自動清除殘留鎖定',async()=>{
  const root=await project();
  try{
    const previous=await execute(process.execPath,['-e','process.stdout.write(String(process.pid))']);
    await fs.mkdir(path.join(root,'.runtime/start.lock'));
    await fs.writeFile(path.join(root,'.runtime/start.lock/owner.json'),JSON.stringify({pid:Number(previous.stdout)}));
    assert.equal((await resetWorkspace(root,{confirmed:true})).removedLessons,1);
    await assert.rejects(fs.access(path.join(root,'.runtime/start.lock')),{code:'ENOENT'});
  }finally{await cleanup(root);}
});

test('伺服器沒有停止時不刪除教案',async()=>{
  const root=await project();let child;
  try{
    const running=await server(root,root,{ignoreStop:true});child=running.child;
    await assert.rejects(resetWorkspace(root,{confirmed:true}),/尚未停止/);
    assert.equal((await fetch(running.state.url)).status,200);
    assert.equal(await fs.readFile(path.join(root,'lessons/test-lesson/originals/lesson.docx'),'utf8'),'original lesson');
  }finally{await cleanup(root,child);}
});
