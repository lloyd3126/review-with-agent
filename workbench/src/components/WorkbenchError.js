'use client';

import {useEffect, useRef, useState} from 'react';
import {copyText} from '../lib/client/clipboard';

export default function WorkbenchError({error}) {
  const [report, setReport] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const heading = useRef(null);
  const message = useRef(null);
  const details = useRef(null);

  useEffect(() => {
    const context = [
      `頁面：${location.href}`,
      `時間：${new Date().toISOString()}`,
      `錯誤：${error.message}`,
      error.status && `HTTP 狀態：${error.status}`,
      error.resource && `發生位置：${error.resource}`,
      error.projectRoot && `專案資料夾：${error.projectRoot}`,
      error.lessonId && `文件識別碼：${error.lessonId}`,
    ].filter(Boolean).join('\n');
    setReport(`請協助修復本專案的文件工作台。\n\n${context}\n\n請檢查本專案服務與 .runtime/workbench.log，修復後重新開啟工作台。請保留既有文件、參考資料與註解。`);
    document.title = '無法開啟工作台';
    heading.current.focus();
  }, [error]);

  async function copy() {
    if (await copyText(report)) setCopyMessage('已複製，請貼到 Agent 對話中。');
    else {
      details.current.open = true;
      message.current.focus();
      message.current.select();
      setCopyMessage('已選取錯誤訊息，請手動複製後貼到 Agent 對話中。');
    }
  }

  return <main className="error-page">
    <section className="error-content" aria-labelledby="workbench-error-title">
      <div className="error-heading">
        <span className="error-code">{error.status >= 400 ? error.status : error.kind === 'connection' ? '無法連線' : '載入失敗'}</span>
        <h1 id="workbench-error-title" tabIndex="-1" ref={heading}>無法開啟工作台</h1>
      </div>
      <p>請複製錯誤訊息，貼到 Agent 對話中，請 Agent 協助處理。</p>
      <div className="error-actions">
        <button className="primary" disabled={!report} onClick={copy}>複製錯誤訊息給 Agent</button>
        <button className="secondary" onClick={() => location.reload()}>重新載入</button>
      </div>
      <p className="error-copy-status" role="status">{copyMessage}</p>
      <details ref={details}>
        <summary>查看錯誤訊息</summary>
        <label className="visually-hidden" htmlFor="workbench-error-message">錯誤訊息</label>
        <textarea id="workbench-error-message" ref={message} value={report} rows="10" readOnly />
      </details>
    </section>
  </main>;
}
