const base = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/';
let library;

function loadAsset(tag, url) {
  return new Promise((resolve, reject) => {
    const element = document.createElement(tag);
    const timer = setTimeout(() => fail('載入 PDF 閱讀工具逾時。'), 20000);
    function fail(message) {
      clearTimeout(timer);
      element.remove();
      reject(Object.assign(new Error(message), {resource: url, kind: 'protocol'}));
    }
    if (tag === 'script') { element.type = 'module'; element.src = url; }
    else { element.rel = 'stylesheet'; element.href = url; }
    element.onload = () => { clearTimeout(timer); resolve(); };
    element.onerror = () => fail('無法載入 PDF 閱讀工具，請確認網路連線。');
    document.head.append(element);
  });
}

export function loadPdf() {
  library ??= (async () => {
    await Promise.all([
      loadAsset('script', `${base}build/pdf.mjs`),
      loadAsset('link', `${base}web/pdf_viewer.css`),
    ]);
    await loadAsset('script', `${base}web/pdf_viewer.mjs`);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${base}build/pdf.worker.mjs`;
    return {pdf: window.pdfjsLib, viewer: window.pdfjsViewer};
  })().catch(error => { library = null; throw error; });
  return library;
}

export const pdfOptions = {
  cMapUrl: `${base}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${base}standard_fonts/`,
  wasmUrl: `${base}wasm/`,
  isEvalSupported: false,
};
