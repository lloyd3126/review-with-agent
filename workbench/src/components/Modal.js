'use client';

import {useEffect, useRef} from 'react';

export default function Modal({id, title, children, footer, onClose, busy = false, wide = false, cancelFocus = false}) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element.open) element.showModal();
    if (cancelFocus) element.querySelector('[data-cancel]')?.focus();
    return () => element.close();
  }, [cancelFocus]);

  return <dialog id={id} ref={dialog} className={wide ? 'wide-dialog' : undefined}
    aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-heading">
      <h2 id={`${id}-title`}>{title}</h2>
      <button className="close" type="button" aria-label="關閉" disabled={busy} onClick={onClose}>×</button>
    </div>
    <div className="dialog-content">{children}</div>
    <div className="dialog-footer">{footer}</div>
  </dialog>;
}
