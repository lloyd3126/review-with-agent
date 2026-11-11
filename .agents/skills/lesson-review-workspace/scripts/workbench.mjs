import fs from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {createHash,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const [command,...args]=process.argv.slice(2);
function option(name,fallback='') {const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];}
const root=path.resolve(option('project-root',sourceRoot));
const python=option('python','python3');
const application=path.join(sourceRoot,'workbench');
process.env.LESSON_APP_ROOT=application;
process.env.LESSON_PYTHONPATH=path.join(root,'.runtime/python-libs');
const {readJson,importLesson,listLessons,replaceDocument,deleteLesson,updateComment}=await import(path.join(application,'src/lib/server/store.mjs'));
async function fingerprint() {
  const digest=createHash('sha256');
  async function visit(directory){for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(['node_modules','.next','tests'].includes(entry.name))continue;const file=path.join(directory,entry.name);if(entry.isDirectory())await visit(file);else {digest.update(path.relative(application,file));digest.update(await fs.readFile(file));}}}
  await visit(application);return digest.digest('hex');
}
async function run(executable,arguments_,log,extraEnv={}) {
  await new Promise((resolve,reject)=>{
    const child=spawn(executable,arguments_,{cwd:application,env:{...process.env,...extraEnv,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore',log,log]});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('環境準備失敗，請檢查 .runtime/workbench.log')));
  });
}
async function runCapture(executable, arguments_) {
  return await new Promise((resolve, reject) => {
    const child=spawn(executable,arguments_,{cwd:sourceRoot,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
    let stdout='';
    let stderr='';
    child.stdout.on('data',chunk=>{stdout+=chunk;});
    child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.on('error',reject);
    child.on('exit',code=>code===0?resolve(stdout):reject(new Error(stderr.trim()||'環境處理失敗')));
  });
}
async function ensureApp(log,runtime) {
  await run(python,['--version'],log);
  const pythonLibs=path.join(runtime,'python-libs');
  await fs.mkdir(pythonLibs,{recursive:true});
  try { await run(python,['-c','import pypdf; print(pypdf.__version__)'],log,{PYTHONPATH:pythonLibs}); }
  catch { await run(python,['-m','pip','install','--disable-pip-version-check','--no-input','--target',pythonLibs,'pypdf==6.21.4'],log); }
  const expected=await readJson(path.join(application,'package.json'));
  let installed=false;
  try{installed=(await readJson(path.join(application,'node_modules/next/package.json'))).version===expected.dependencies.next;}catch{}
  if(!installed){
    let locked=false;try{await fs.access(path.join(application,'package-lock.json'));locked=true;}catch{}
    await run(option('npm',process.platform==='win32'?'npm.cmd':'npm'),[locked?'ci':'install','--no-audit','--no-fund'],log);
  }
  const sourceHash=await fingerprint();
  let built=false;
  try{built=(await readJson(path.join(root,'.runtime/build.json'))).fingerprint===sourceHash;await fs.access(path.join(application,'.next/BUILD_ID'));}catch{built=false;}
  if(!built){await run(process.execPath,[path.join(application,'node_modules/next/dist/bin/next'),'build'],log);await fs.writeFile(path.join(root,'.runtime/build.json'),JSON.stringify({fingerprint:sourceHash}));}
  return sourceHash;
}
async function choosePort(preferred) {
  return new Promise((resolve,reject)=>{
    const probe=net.createServer();
    probe.on('error',error=>{if(error.code==='EADDRINUSE'&&preferred!==0){choosePort(0).then(resolve,reject);}else reject(error);});
    probe.listen(preferred,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port));});
  });
}
async function status() {
  try {
    const state=await readJson(path.join(root,'.runtime/workbench.json'));
    const response=await fetch(state.url+'/api/health',{signal:AbortSignal.timeout(1500)});
    const health=await response.json();
    if(!response.ok||health.app!=='lesson-review-workspace'||health.projectRoot!==root||health.pid!==state.pid)throw new Error('服務不符');
    return {ready:true,url:state.url,projectRoot:root,pid:state.pid,buildFingerprint:health.buildFingerprint};
  }catch{return {ready:false,projectRoot:root};}
}
async function start() {
  const sourceHash=await fingerprint();
  const before=await status();
  if(before.ready&&before.buildFingerprint===sourceHash)return {...before,reused:true};
  const {withWorkspaceLock}=await import('./workspace_lifecycle.mjs');
  const {stopRegisteredServer}=await import('./workspace_control.mjs');
  return withWorkspaceLock(root,async runtime=>{
    const current=await status();
    if(current.ready&&current.buildFingerprint===sourceHash)return {...current,reused:true};
    await stopRegisteredServer(root,runtime);
    const log=openSync(path.join(runtime,'workbench.log'),'a');
    const prepared=await ensureApp(log,runtime);
    const buildFingerprint=prepared;
    const port=await choosePort(Number(option('port','8766')));
    const url='http://127.0.0.1:'+port;
    const child=spawn(process.execPath,[path.join(application,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:application,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1',LESSON_APP_ROOT:application,LESSON_PROJECT_ROOT:root,LESSON_PYTHON:python,LESSON_PYTHONPATH:path.join(runtime,'python-libs'),LESSON_TOKEN:randomBytes(24).toString('hex'),LESSON_BUILD:buildFingerprint},detached:true,stdio:['ignore',log,log]});
    child.unref();closeSync(log);
    for(let n=0;n<150;n++){
      await delay(100);
      try{
        const health=await (await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)})).json();
        if(health.app!=='lesson-review-workspace'||health.projectRoot!==root||health.buildFingerprint!==buildFingerprint)continue;
        await fs.writeFile(path.join(runtime,'workbench.json'),JSON.stringify({app:health.app,pid:health.pid,url,projectRoot:root,launcherPid:child.pid}));
        return {ready:true,url,projectRoot:root,pid:health.pid,reused:false};
      }catch{}
    }
    throw new Error('工作台未能啟動，請檢查 .runtime/workbench.log');
  },{wait:true,errorMessage:'工作台仍在準備環境，請追蹤 .runtime/workbench.log，完成後再執行 start'});
}
try {
  let result;
  if(command==='start'||command==='reopen')result=await start();
  else if(command==='status')result=await status();
  else if(command==='stop'||command==='reset'){
    const {stopWorkspace,resetWorkspace}=await import('./workspace_control.mjs');
    result=command==='stop'?await stopWorkspace(root):await resetWorkspace(root,{confirmed:args.includes('--confirm-reset')});
  }
  else if(command==='list')result={lessons:await listLessons(root)};
  else if(command==='import') {
    const file=path.resolve(option('file'));
    if(!option('file'))throw new Error('缺少 --file');
    result=await importLesson(root,await fs.readFile(file),path.basename(file),option('title'),python);
  }else if(command==='replace-document') {
    const file=path.resolve(option('file'));
    if(!option('file')||!option('lesson'))throw new Error('缺少 --lesson 或 --file');
    result=await replaceDocument(root,option('lesson'),await fs.readFile(file),path.basename(file),python);
  }
  else if(command==='delete-document') {
    if(!option('lesson'))throw new Error('缺少 --lesson');
    if(!args.includes('--confirm-delete'))throw new Error('刪除文件需要 --confirm-delete 確認');
    result=await deleteLesson(root,option('lesson'));
  }
  else if(command==='add-comment'){
    const input=option('data')?await readJson(path.resolve(option('data'))):{anchorText:option('anchor'),text:option('text')};
    result=await updateComment(root,option('lesson'),{id:option('id',input.id),anchor:input.anchorText,text:input.text,page:input.page,rects:input.rects});
  }
  else if(command==='resolve-comment')result=await updateComment(root,option('lesson'),{resolve:option('id'),status:option('status'),note:option('note')});
  else if(command==='package') {
    const packageScript=path.join(sourceRoot,'.agents/skills/lesson-review-workspace/scripts/package_student.py');
    const output=option('output',path.join(root,'dist/review-with-agent.zip'));
    result=JSON.parse(await runCapture(python,[packageScript,'--project-root',root,'--output',path.resolve(output)]));
  }
  else throw new Error('指令：start、reopen、status、stop、reset、list、import、replace-document、delete-document、add-comment、resolve-comment、package');
  console.log(JSON.stringify(result,null,2));
}catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=1;}
