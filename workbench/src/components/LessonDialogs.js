'use client';

import {useRef, useState} from 'react';
import Modal from './Modal';
import {copyText} from '../lib/client/clipboard';
import {deletionPrompt, reviewPrompt} from '../lib/client/discussion';

export function UploadDialog({onClose, onUpload, busy, replace = false}) {
  const fileInput = useRef(null);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    const file = fileInput.current.files[0];
    if (!file) return;
    setError('');
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('請選擇 PDF 文件。'); return; }
    try { await onUpload(file); }
    catch (failure) { setError(failure.message); }
  }
  return <Modal id="upload-modal" title={replace ? '上傳新版' : '上傳文件'} busy={busy} onClose={onClose} footer={<>
    <button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button>
    <button type="submit" form="upload-form" className="primary" disabled={busy}>{busy ? '正在保存' : replace ? '更換並開啟' : '上傳並開啟'}</button>
  </>}>
    <form id="upload-form" onSubmit={submit}>
      <input ref={fileInput} id="lesson-file" type="file" accept=".pdf,application/pdf" aria-label="選擇文件檔案" aria-describedby="upload-help" disabled={busy} required />
      <p id="upload-help" className="help">僅支援 PDF，每個檔案最多 30 MB。</p>
      {replace && <p className="help">更換後會清空註解與討論紀錄，參考資料會保留。</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  </Modal>;
}

function onboardingText(title) {
  return `我已上傳文件「${title}」。請先簡短說明接下來如何使用工作台，目前先不要檢視或修改文件。

請說明：
1. 如何透過「參考文件」加入 PDF 參考資料，以及這一步可以略過。
2. 加入或更新參考資料後，如何在對話中請你檢視文件並指出問題。
3. 如何在工作台查看問題，並在對話中依 #001 等編號逐一或一次討論。
4. 如何自行修改原稿並匯出 PDF，再用「上傳新版」替換文件。更換時會清空註解與討論紀錄，保留參考資料，之後可複製重新檢視提示交給你。`;
}

function PromptDialog({heading, description, text, copyLabel = '複製訊息', onClose, onCopied}) {
  const message = useRef(null);
  const [status, setStatus] = useState('');
  async function copy() {
    if (await copyText(text)) { setStatus('已複製，請貼到 Agent 對話中。'); onCopied(); }
    else {
      message.current.focus();
      message.current.select();
      setStatus('已選取訊息，請手動複製後貼到 Agent 對話中。');
    }
  }
  return <Modal id="prompt-modal" wide title={heading} onClose={onClose} footer={<>
    <button className="secondary" type="button" onClick={onClose}>關閉</button>
    <button className="primary" type="button" onClick={copy}>{copyLabel}</button>
  </>}>
    <p>{description}</p>
    <label htmlFor="handoff-text">交給 Agent 的訊息</label>
    <textarea id="handoff-text" ref={message} rows="11" value={text} readOnly />
    {status && <p className="help" role="status">{status}</p>}
  </Modal>;
}

export function OnboardingDialog({title, onClose, onCopied}) {
  return <PromptDialog heading="下一步：請 Agent 說明使用方式"
    description="複製下面的訊息並貼回 Agent 對話，請 Agent 說明接下來如何使用工作台。"
    text={onboardingText(title)} onClose={onClose} onCopied={onCopied} />;
}

export function ReviewDialog({title, onClose, onCopied}) {
  return <PromptDialog heading="重新檢視文件"
    description="PDF 已更換。複製下面的訊息並貼回 Agent 對話，請 Agent 依目前文件重新檢視。"
    text={reviewPrompt(title)} onClose={onClose} onCopied={onCopied} />;
}

export function DeleteDialog({lesson, onClose, onCopied}) {
  return <PromptDialog heading="刪除文件"
    description={`將刪除「${lesson.title}」及其參考文件、註解與討論紀錄，其他文件會保留。請複製提示並貼回 Agent 對話執行刪除。`}
    text={deletionPrompt(lesson)} copyLabel="複製刪除提示" onClose={onClose} onCopied={onCopied} />;
}
