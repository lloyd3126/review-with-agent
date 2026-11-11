'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import useWorkspace from '../hooks/useWorkspace';
import AnnotationsPane from './AnnotationsPane';
import DocumentPreview from './DocumentPreview';
import {DeleteDialog, OnboardingDialog, ReviewDialog, UploadDialog} from './LessonDialogs';
import ReferenceDialog from './ReferenceDialog';
import WorkbenchError from './WorkbenchError';

export default function Workspace() {
  const workspace = useWorkspace();
  const [dialog, setDialog] = useState(null);
  const [uploadedTitle, setUploadedTitle] = useState('');
  const [selection, setSelection] = useState(null);
  const [toast, setToast] = useState(false);
  const copyTimer = useRef(null);
  const currentSelection = useMemo(() => {
    const comment = workspace.lesson?.annotations.find(item => item.id === selection?.id);
    return comment ? {...comment} : null;
  }, [workspace.lesson?.annotations, selection]);

  const copied = useCallback(() => {
    clearTimeout(copyTimer.current);
    setToast(true);
    copyTimer.current = setTimeout(() => setToast(false), 1800);
  }, []);

  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => { setSelection(null); }, [workspace.selectedId, workspace.lesson?.documentToken]);

  async function upload(file) {
    const imported = await workspace.importLesson(file);
    setUploadedTitle(imported.title);
    setDialog('onboarding');
  }

  async function replaceDocument(file) {
    await workspace.replaceDocument(file);
    setDialog('review');
    setSelection(null);
  }

  function locate(comment) {
    if (comment.documentSha256 !== workspace.lesson?.documentHash) return;
    workspace.setNotice('');
    setSelection({...comment});
  }

  if (workspace.failure) return <WorkbenchError error={workspace.failure} />;

  return <div className="workspace-page">
    <header className="app-header">
      <button className="primary" disabled={workspace.loading || workspace.busy} onClick={() => setDialog('upload')}>上傳文件</button>
      <select id="lesson-select" aria-label="選擇文件" disabled={workspace.loading || workspace.busy || !workspace.lessons.length}
        value={workspace.selectedId} onChange={event => { setDialog(null); workspace.selectLesson(event.target.value); }}>
        {!workspace.lessons.length && <option value="">{workspace.loading ? '載入中' : '尚未上傳文件'}</option>}
        {!!workspace.lessons.length && !workspace.selectedId && <option value="" disabled>選擇文件</option>}
        {workspace.lessons.map(lesson => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}
      </select>
      <button className="secondary" disabled={!workspace.lesson || workspace.busy} onClick={() => setDialog('references')}>參考文件</button>
      <button className="secondary" disabled={!workspace.lesson || workspace.busy} onClick={() => setDialog('replace')}>上傳新版</button>
      <button className="secondary" disabled={!workspace.lesson || workspace.busy} onClick={() => setDialog('delete')}>刪除文件</button>
    </header>
    <main className="workspace-main">
      {workspace.notice && <div className="notice" role="alert">{workspace.notice}</div>}
      <div className="workspace-columns">
        <DocumentPreview lesson={workspace.lesson} selection={currentSelection}
          onRefresh={workspace.refreshCurrent} onError={workspace.report} />
        <AnnotationsPane key={`${workspace.selectedId}:${workspace.lesson?.documentToken}`} lesson={workspace.lesson} selection={currentSelection}
          onLocate={locate} onCopied={copied} onNotice={workspace.setNotice} />
      </div>
    </main>
    {dialog === 'upload' && <UploadDialog busy={workspace.busy} onUpload={upload} onClose={() => setDialog(null)} />}
    {dialog === 'replace' && <UploadDialog replace busy={workspace.busy} onUpload={replaceDocument} onClose={() => setDialog(null)} />}
    {dialog === 'onboarding' && <OnboardingDialog title={uploadedTitle} onClose={() => setDialog(null)} onCopied={copied} />}
    {dialog === 'review' && workspace.lesson && <ReviewDialog title={workspace.lesson.title} onClose={() => setDialog(null)} onCopied={copied} />}
    {dialog === 'delete' && workspace.lesson && <DeleteDialog lesson={workspace.lesson} onClose={() => setDialog(null)} onCopied={copied} />}
    {dialog === 'references' && workspace.lesson && <ReferenceDialog lesson={workspace.lesson} busy={workspace.busy}
      onAdd={workspace.addReferences} onRemove={workspace.removeReference} onClose={() => setDialog(null)} />}
    {toast && <div className="toast" role="status">已複製，可以貼到 Agent 對話。</div>}
  </div>;
}
