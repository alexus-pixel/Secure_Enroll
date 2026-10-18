import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import api from '../../api/client';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const STEP = 1.25;
const PAGE_PAD = 12; // padding around PDF pages inside the stage
const MAX_CANVAS_PIXELS = 16_000_000; // keeps big zoom levels inside phone canvas limits

const clamp = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

// One PDF page drawn to a canvas. The canvas is resized immediately when
// the zoom changes (so zooming feels instant), then redrawn sharply a
// moment later at the new size.
function PdfPage({ page, cssWidth }) {
  const canvasRef = useRef(null);
  const taskRef = useRef(null);
  const base = page.getViewport({ scale: 1 });
  const cssHeight = (cssWidth * base.height) / base.width;

  useEffect(() => {
    const timer = setTimeout(() => {
      const scale = cssWidth / base.width;
      let dpr = Math.min(window.devicePixelRatio || 1, 3);
      while (dpr > 1 && cssWidth * dpr * cssHeight * dpr > MAX_CANVAS_PIXELS) dpr -= 0.25;
      const viewport = page.getViewport({ scale: scale * dpr });

      const off = document.createElement('canvas');
      off.width = Math.floor(viewport.width);
      off.height = Math.floor(viewport.height);
      taskRef.current?.cancel();
      const task = page.render({ canvasContext: off.getContext('2d'), viewport });
      taskRef.current = task;
      task.promise.then(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext('2d').drawImage(off, 0, 0);
      }).catch(() => {}); // a cancelled render is expected when zooming quickly
    }, 120);
    return () => {
      clearTimeout(timer);
      taskRef.current?.cancel();
    };
  }, [page, cssWidth, cssHeight, base.width]);

  return (
    <canvas ref={canvasRef} className="dv-page"
      style={{ width: `${cssWidth}px`, height: `${cssHeight}px` }} />
  );
}

/**
 * Full-screen viewer for a document the parent uploaded.
 * Shows images and PDFs with zoom (buttons, Ctrl+wheel, pinch, keys +/-/0)
 * and drag-to-pan. The file is fetched with the registrar's auth token and
 * shown from a temporary in-memory URL, never from a public link.
 *
 * `footer` is rendered under the viewer, which is where the Verify / Flag /
 * Reject controls go so the registrar can decide while looking at the file.
 */
export default function DocumentViewer({ title, subtitle, badge, fileUrl, onClose, footer }) {
  const stageRef = useRef(null);
  const dialogRef = useRef(null);
  const zoomRef = useRef(1);
  const pendingScroll = useRef(null);
  const pinch = useRef(null);
  const drag = useRef(null);

  const [blob, setBlob] = useState(null);
  const [blobUrl, setBlobUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [aspect, setAspect] = useState(null); // image width / height
  const [pdf, setPdf] = useState(null); // { pages }

  const isPdf = blob?.type === 'application/pdf';

  // ----- load the file -----
  useEffect(() => {
    let url = '';
    let alive = true;
    api.get(fileUrl, { responseType: 'blob' })
      .then(({ data }) => {
        if (!alive) return;
        url = URL.createObjectURL(data);
        setBlob(data);
        setBlobUrl(url);
      })
      .catch(async (err) => {
        let msg = 'Could not load this file.';
        try { msg = JSON.parse(await err.response.data.text()).message || msg; } catch { /* keep default */ }
        if (alive) setError(msg);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileUrl]);

  // ----- open the PDF -----
  useEffect(() => {
    if (!blob || blob.type !== 'application/pdf') return undefined;
    let cancelled = false;
    let task;
    (async () => {
      task = pdfjs.getDocument({ data: await blob.arrayBuffer() });
      const doc = await task.promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i += 1) pages.push(await doc.getPage(i));
      if (!cancelled) setPdf({ pages });
    })().catch(() => !cancelled && setError('This PDF could not be opened.'));
    return () => {
      cancelled = true;
      task?.destroy();
    };
  }, [blob]);

  // ----- measure the viewing area -----
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  // ----- zoom helpers -----
  const zoomTo = useCallback((next, fx, fy) => {
    const el = stageRef.current;
    const target = clamp(next);
    if (el) {
      const x = fx ?? el.clientWidth / 2;
      const y = fy ?? el.clientHeight / 2;
      const ratio = target / zoomRef.current;
      pendingScroll.current = {
        left: (el.scrollLeft + x) * ratio - x,
        top: (el.scrollTop + y) * ratio - y,
      };
    }
    zoomRef.current = target;
    setZoom(target);
  }, []);

  // Keep the point under the cursor (or the centre) fixed while zooming.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (el && pendingScroll.current) {
      el.scrollLeft = pendingScroll.current.left;
      el.scrollTop = pendingScroll.current.top;
      pendingScroll.current = null;
    }
  }, [zoom]);

  // Ctrl + wheel (and trackpad pinch) zooms; plain wheel scrolls.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // Clamp the step so one notch of a mouse wheel is a gentle zoom, while a
      // trackpad pinch (many tiny deltas) still feels continuous.
      const dy = Math.max(-40, Math.min(40, e.deltaY));
      zoomTo(zoomRef.current * Math.exp(-dy * 0.01), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [loading, zoomTo]);

  // Escape closes; + / - / 0 zoom (unless typing in the reason box).
  useEffect(() => {
    const onKey = (e) => {
      if (['TEXTAREA', 'INPUT'].includes(e.target.tagName)) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoomTo(zoomRef.current * STEP);
      else if (e.key === '-') zoomTo(zoomRef.current / STEP);
      else if (e.key === '0') zoomTo(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, zoomTo]);

  // Stop the page behind the viewer from scrolling.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ----- touch pinch + mouse drag-to-pan -----
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  function onTouchStart(e) {
    if (e.touches.length === 2) pinch.current = { d: dist(e.touches), z: zoomRef.current };
  }
  function onTouchMove(e) {
    if (!pinch.current || e.touches.length !== 2) return;
    const rect = stageRef.current.getBoundingClientRect();
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
    zoomTo(pinch.current.z * (dist(e.touches) / pinch.current.d), mx, my);
  }
  function onTouchEnd(e) {
    if (e.touches.length < 2) pinch.current = null;
  }
  function onPointerDown(e) {
    const el = stageRef.current;
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-panning');
  }
  function onPointerMove(e) {
    if (!drag.current) return;
    const el = stageRef.current;
    el.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
    el.scrollTop = drag.current.top - (e.clientY - drag.current.y);
  }
  function onPointerUp() {
    drag.current = null;
    stageRef.current?.classList.remove('is-panning');
  }

  // ----- sizes -----
  // Images: zoom 100% shows the whole picture. PDFs: 100% fits the page width.
  const imgBase = aspect && stage.w ? Math.min(stage.w, stage.h * aspect) : 0;
  const pdfBase = Math.max(0, stage.w - PAGE_PAD * 2);
  const ready = !loading && !error && (isPdf ? Boolean(pdf) : Boolean(blobUrl));

  return (
    <div className="dv-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dv-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={dialogRef}>
        <div className="dv-head">
          <div className="dv-title">
            <span>{title}</span>
            {badge}
            {subtitle && <span className="dv-sub">{subtitle}</span>}
          </div>
          <button type="button" className="dv-close" onClick={onClose} aria-label="Close viewer">
            <X size={22} />
          </button>
        </div>

        <div className="dv-toolbar" role="toolbar" aria-label="Zoom controls">
          <button type="button" className="dv-tool" onClick={() => zoomTo(zoomRef.current / STEP)}
            disabled={!ready || zoom <= MIN_ZOOM} aria-label="Zoom out" title="Zoom out (-)">
            <ZoomOut size={17} />
          </button>
          <span className="dv-zoom-label" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button type="button" className="dv-tool" onClick={() => zoomTo(zoomRef.current * STEP)}
            disabled={!ready || zoom >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in (+)">
            <ZoomIn size={17} />
          </button>
          <button type="button" className="dv-tool" onClick={() => zoomTo(1)} disabled={!ready}
            title="Fit to screen (0)">
            <Maximize2 size={15} /> Fit
          </button>
          <button type="button" className="dv-tool" onClick={() => zoomTo(2)} disabled={!ready}>
            200%
          </button>
          <button type="button" className="dv-tool" onClick={() => zoomTo(4)} disabled={!ready}>
            400%
          </button>
        </div>

        <div
          className={`dv-stage${ready && zoom > 1 ? ' can-pan' : ''}`}
          ref={stageRef}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {loading && <div className="dv-state">Loading document&hellip;</div>}
          {!loading && error && <div className="dv-state dv-state-error" role="alert">{error}</div>}
          {!loading && !error && !isPdf && blobUrl && (
            <img
              className="dv-img"
              src={blobUrl}
              alt={title}
              draggable={false}
              onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
              style={imgBase ? { width: `${Math.round(imgBase * zoom)}px` } : { visibility: 'hidden' }}
            />
          )}
          {!loading && !error && isPdf && !pdf && <div className="dv-state">Opening PDF&hellip;</div>}
          {!loading && !error && isPdf && pdf && pdfBase > 0 && (
            <div className="dv-pages" style={{ padding: PAGE_PAD }}>
              {pdf.pages.map((p, i) => (
                <PdfPage key={i} page={p} cssWidth={Math.round(pdfBase * zoom)} />
              ))}
            </div>
          )}
        </div>

        {footer && <div className="dv-foot">{footer}</div>}
      </div>
    </div>
  );
}
