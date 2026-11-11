'use client';

import {useRef, useState} from 'react';
import {copyText} from '../lib/client/clipboard';
import {discussionPrompt} from '../lib/client/discussion';

const statuses = {resolved: '已釐清', dismissed: '保留原設計', obsolete: '已不適用'};
const guidance = 'Agent 會在這裡提出值得討論的問題';

export default function AnnotationsPane({lesson, selection, onLocate, onCopied, onNotice}) {
  const annotations = lesson?.annotations || [];
  const history = lesson?.history || [];
  const [manualCopy, setManualCopy] = useState(null);
  const fallback = useRef(null);
  const empty = !annotations.length && !history.length;
  async function copy(text, id) {
    if (await copyText(text)) onCopied();
    else { setManualCopy({id, text}); onNotice('自動複製未成功，請手動複製下方訊息。'); }
  }
  return <aside id="annotation-pane" className="pane" aria-label="文件註解" aria-disabled={empty}>
    {empty ? <div className="empty-pane"><p>{guidance}</p></div> : <div className="annotations-scroll">
      <div aria-live="polite">
        {!annotations.length && <p className="pane-guidance">{guidance}</p>}
        {annotations.map(comment => {
          const stale = comment.documentSha256 !== lesson.documentHash;
          return <article className={`annotation-card${selection?.id === comment.id ? ' selected' : ''}`} key={comment.id}>
            <div className="annotation-head">
              <span className="annotation-id">{comment.id}</span>
              <button type="button" className="secondary copy-id" aria-label={`複製 ${comment.id}`} onClick={() => copy(comment.id, comment.id)}>複製編號</button>
            </div>
            <button type="button" className="annotation-anchor" aria-label={`查看 ${comment.id} 對應位置`}
              aria-pressed={selection?.id === comment.id} disabled={stale} onClick={() => onLocate(comment)}>
              <span className="annotation-page">第 {comment.page} 頁</span>
              {comment.anchorText}
              <span className="annotation-text">{comment.text}</span>
            </button>
            {stale && <p className="stale-note">這則問題與目前文件不符，請 Agent 重新檢視。</p>}
            <button type="button" className="secondary discuss" aria-label={`討論 ${comment.id} 這個問題`}
              onClick={() => copy(discussionPrompt(lesson, comment), comment.id)}>討論這個問題</button>
          </article>;
        })}
      </div>
      {manualCopy && <div className="copy-fallback">
        <label htmlFor="discussion-copy">{manualCopy.id} 複製內容</label>
        <textarea ref={fallback} id="discussion-copy" readOnly rows="8" value={manualCopy.text} onFocus={event => event.target.select()} />
        <button type="button" className="secondary" onClick={() => { fallback.current.focus(); fallback.current.select(); }}>選取訊息</button>
      </div>}
      {!!history.length && <details className="history"><summary>已處理的註解</summary>
        {history.toReversed().map(item => <div className="history-item" key={item.id}>
          {`${item.id} · ${statuses[item.status]}\n${item.text}${item.note ? `\n${item.note}` : ''}`}
        </div>)}
      </details>}
    </div>}
  </aside>;
}
