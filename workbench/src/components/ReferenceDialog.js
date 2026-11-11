'use client';

import {useRef, useState} from 'react';
import Modal from './Modal';

export default function ReferenceDialog({lesson, busy, onClose, onAdd, onRemove}) {
  const input = useRef(null);
  const [pending, setPending] = useState(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  async function add(event) {
    event.preventDefault();
    const files = [...input.current.files];
    if (!files.length) return;
    setError('');
    try {
      await onAdd(files, setProgress);
      input.current.value = '';
      setProgress(`已新增 ${files.length} 份參考資料。`);
    } catch (failure) { setError(failure.message); setProgress(''); }
  }

  async function remove() {
    const material = pending;
    setPending(null);
    setError('');
    setProgress(`正在刪除 ${material.name}`);
    try {
      await onRemove(material);
      setProgress(`已刪除 ${material.name}`);
    } catch (failure) { setError(failure.message); setProgress(''); }
  }

  return <>
    <Modal id="materials-modal" title="參考文件" onClose={onClose} busy={busy} footer={
      <button type="button" className="secondary" disabled={busy} onClick={onClose}>完成</button>
    }>
      <p>管理目前文件的背景資料、要求與其他參考資料。</p>
      <h3 className="section-title">已加入的資料</h3>
      {!lesson.materials.length && <p className="help">尚未加入參考資料。</p>}
      <ul className="material-list" aria-label="參考資料清單">
        {lesson.materials.map(material => <li className="material-item" key={material.id}>
          <span className="material-name">{material.name}</span>
          <button type="button" className="secondary" aria-label={`刪除 ${material.name}`} disabled={busy} onClick={() => setPending(material)}>刪除</button>
        </li>)}
      </ul>
      <form id="materials-form" onSubmit={add}>
        <label htmlFor="material-files">新增參考資料</label>
        <input id="material-files" ref={input} type="file" accept=".pdf,application/pdf" multiple disabled={busy} required />
        <p className="help">僅支援 .pdf，每個檔案最多 30 MB。</p>
        <button className="primary" type="submit" disabled={busy}>新增資料</button>
      </form>
      <p className="help" role="status">{progress}</p>
      {error && <p className="error" role="alert">{error}</p>}
    </Modal>
    {pending && <Modal id="delete-material-modal" title="刪除參考資料" onClose={() => setPending(null)} cancelFocus footer={<>
      <button type="button" className="secondary" data-cancel onClick={() => setPending(null)}>取消</button>
      <button type="button" className="primary" onClick={remove}>確定刪除</button>
    </>}>
      <p>確定刪除「{pending.name}」？刪除後需重新上傳才能加入。</p>
    </Modal>}
  </>;
}
