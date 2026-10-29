/**
 * Novamail - embedded PDF viewer.
 *
 * The PDF is streamed from the local attachment cache through the private
 * novamail-att: protocol. PDF.js runs with scripting disabled and renders to a
 * canvas; PDF JavaScript is never executed.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { IconButton, Spinner } from './ui'

type PdfJsModule = typeof import('pdfjs-dist')

let pdfjsPromise: Promise<PdfJsModule> | null = null

/**
 * PDF.js is a large dependency that touches canvas APIs on load, so it is only
 * imported when a PDF is actually previewed. The worker is copied by Vite and
 * served from the app itself.
 */
function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((module) => {
      module.GlobalWorkerOptions.workerSrc = workerUrl
      return module
    })
  }
  return pdfjsPromise
}

export interface PdfViewerProps {
  url: string
  zoom: number
  rotation: number
  fitMode: 'fit' | 'actual'
  page: number
  onPageChange: (page: number) => void
  onPageCount: (count: number) => void
  onError: (message: string) => void
}

export function PdfViewer({
  url,
  zoom,
  rotation,
  fitMode,
  page,
  onPageChange,
  onPageCount,
  onError
}: PdfViewerProps): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [pdfjs, setPdfjs] = useState<PdfJsModule | null>(null)
  const [document, setDocument] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const renderTask = useRef<import('pdfjs-dist').RenderTask | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadPdfJs()
      .then((module) => {
        if (!cancelled) setPdfjs(module)
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error')
          onError('The PDF viewer could not start.')
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!pdfjs) return
    let cancelled = false
    setStatus('loading')
    const loadingTask = pdfjs.getDocument({ url, isEvalSupported: false, disableFontFace: false })
    loadingTask.promise
      .then((loaded) => {
        if (cancelled) {
          void loaded.destroy()
          return
        }
        setDocument(loaded)
        onPageCount(loaded.numPages)
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
        onError('This PDF could not be opened. It may be damaged or password protected.')
      })
    return () => {
      cancelled = true
      void loadingTask.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, pdfjs])

  const renderPage = useCallback(async () => {
    if (!document || !canvasRef.current) return
    try {
      const pdfPage = await document.getPage(Math.min(Math.max(page, 1), document.numPages))
      const canvas = canvasRef.current
      const containerWidth = containerRef.current?.clientWidth ?? 800
      const unscaled = pdfPage.getViewport({ scale: 1, rotation })
      const fitScale = (containerWidth - 48) / unscaled.width
      const background = getComputedStyle(documentElement()).getPropertyValue('--nm-surface').trim() || '#ffffff'
      const viewport = pdfPage.getViewport({ scale: (fitMode === 'fit' ? Math.max(0.2, fitScale) : 1) * zoom, rotation })
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      const context = canvas.getContext('2d')
      if (!context) return
      context.save()
      context.fillStyle = background || '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.restore()
      renderTask.current?.cancel()
      const task = pdfPage.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined
      })
      renderTask.current = task
      await task.promise
    } catch (error) {
      if ((error as { name?: string }).name === 'RenderingCancelledException') return
      onError('This page could not be drawn.')
    }
  }, [document, fitMode, onError, page, rotation, zoom])

  useEffect(() => {
    void renderPage()
  }, [renderPage])

  return (
    <div className="pdf-viewer" ref={containerRef}>
      {status === 'loading' ? <Spinner label="Opening the PDF" /> : null}
      {status === 'error' ? (
        <p className="muted" style={{ padding: 20 }}>
          The PDF could not be displayed. You can still save it and open it in your PDF reader.
        </p>
      ) : null}
      <canvas ref={canvasRef} style={{ display: status === 'ready' ? 'block' : 'none' }} aria-label={`Page ${page}`} />
      {status === 'ready' && document ? (
        <div className="pdf-viewer__nav">
          <IconButton
            icon="chevronLeft"
            label="Previous page"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            size={16}
          />
          <span className="small">
            Page {page} of {document.numPages}
          </span>
          <IconButton
            icon="chevronRight"
            label="Next page"
            onClick={() => onPageChange(Math.min(document.numPages, page + 1))}
            size={16}
          />
        </div>
      ) : null}
    </div>
  )
}

function documentElement(): HTMLElement {
  return window.document.documentElement
}
