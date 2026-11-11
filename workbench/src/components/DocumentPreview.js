'use client';

import {useEffect, useRef, useState} from 'react';
import {readDocument} from '../lib/client/api';
import {loadPdf, pdfOptions} from '../lib/client/pdf';

export default function DocumentPreview({lesson, selection, onRefresh, onError}) {
  const container = useRef(null);
  const pages = useRef(null);
  const instance = useRef(null);
  const selected = useRef(selection);
  const pendingScroll = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function drawSelection(viewer) {
    pages.current?.querySelectorAll('.review-region').forEach(node => node.remove());
    const comment = selected.current;
    if (!comment || comment.documentSha256 !== lesson?.documentHash) return;
    const page = viewer.getPageView(comment.page - 1)?.div;
    if (!page) return;
    for (const rect of comment.rects) {
      const region = document.createElement('div');
      region.className = 'review-region';
      region.dataset.id = comment.id;
      region.setAttribute('role', 'img');
      region.setAttribute('aria-label', `${comment.id} 對應區域`);
      Object.assign(region.style, {
        left: `${rect.x * 100}%`, top: `${rect.y * 100}%`,
        width: `${rect.width * 100}%`, height: `${rect.height * 100}%`,
      });
      page.append(region);
    }
  }

  const draw = useRef(drawSelection);
  draw.current = drawSelection;

  useEffect(() => {
    if (!lesson) return;
    const controller = new AbortController();
    const host = pages.current;
    let task;
    let viewer;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const [data, library] = await Promise.all([
          readDocument(lesson.id, lesson.documentHash, lesson.documentToken, controller.signal), loadPdf(),
        ]);
        if (controller.signal.aborted) return;
        const eventBus = new library.viewer.EventBus();
        const linkService = new library.viewer.PDFLinkService({eventBus});
        viewer = new library.viewer.PDFViewer({
          container: container.current, viewer: host, eventBus, linkService,
          abortSignal: controller.signal, annotationMode: library.pdf.AnnotationMode.ENABLE,
          annotationEditorMode: library.pdf.AnnotationEditorType.DISABLE,
          enableAutoLinking: false,
        });
        linkService.setViewer(viewer);
        instance.current = viewer;
        eventBus.on('pagesinit', () => {
          if (controller.signal.aborted) return;
          viewer.currentScaleValue = 'page-width';
          setLoading(false);
          draw.current(viewer);
          if (selected.current?.documentSha256 === lesson.documentHash) {
            pendingScroll.current = true;
            viewer.scrollPageIntoView({pageNumber: selected.current.page});
            viewer.getPageView(selected.current.page - 1)?.div.querySelector('.review-region')?.scrollIntoView({block: 'center', behavior: 'instant'});
          }
        });
        eventBus.on('pagerendered', event => {
          if (controller.signal.aborted) return;
          if (event.error) setError('這一頁無法顯示，請確認 PDF 可正常開啟後重新上傳。');
          draw.current(viewer);
          if (pendingScroll.current && event.pageNumber === selected.current?.page) {
            viewer.getPageView(event.pageNumber - 1)?.div.querySelector('.review-region')?.scrollIntoView({block: 'center', behavior: 'instant'});
            pendingScroll.current = false;
          }
        });
        const resize = new ResizeObserver(() => {
          if (!controller.signal.aborted && viewer.pagesCount) viewer.currentScaleValue = 'page-width';
        });
        resize.observe(container.current);
        controller.signal.addEventListener('abort', () => resize.disconnect(), {once: true});
        task = library.pdf.getDocument({data: new Uint8Array(data), ...pdfOptions});
        const document = await task.promise;
        if (controller.signal.aborted) return;
        viewer.setDocument(document);
        linkService.setDocument(document);
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure.status === 409) { onRefresh(); return; }
        setLoading(false);
        setError(failure.message || '無法顯示 PDF。');
        if (failure.kind || failure.status) onError(failure);
      }
    })();
    return () => {
      controller.abort();
      instance.current = null;
      viewer?.setDocument(null);
      task?.destroy();
      host.replaceChildren();
    };
  }, [lesson?.id, lesson?.documentToken, lesson?.documentHash, onRefresh, onError]);

  useEffect(() => {
    selected.current = selection;
    pendingScroll.current = false;
    const viewer = instance.current;
    if (!viewer) return;
    draw.current(viewer);
    if (selection?.documentSha256 === lesson?.documentHash) {
      pendingScroll.current = true;
      viewer.scrollPageIntoView({pageNumber: selection.page});
      const region = viewer.getPageView(selection.page - 1)?.div.querySelector('.review-region');
      if (region) region.scrollIntoView({block: 'center', behavior: 'instant'});
    }
  }, [selection, lesson?.documentHash]);

  return <section id="document-pane" className="pane document-pane" aria-label="文件預覽" aria-disabled={!lesson}>
    {lesson ? <>
      <div className="document-body">
        <div ref={container} className="pdf-container" tabIndex="0" aria-label="文件 PDF 文件">
          <div ref={pages} className="pdfViewer" />
        </div>
        {loading && <p className="preview-status" role="status">正在載入 PDF</p>}
        {error && <p className="preview-status" role="alert">{error}</p>}
      </div>
    </> : <div className="empty-pane"><p>選擇上傳的文件在此預覽</p></div>}
  </section>;
}
