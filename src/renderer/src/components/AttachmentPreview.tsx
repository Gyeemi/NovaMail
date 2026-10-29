/**
 * Novamail - attachment preview.
 *
 * Everything is rendered from the local attachment cache. Nothing is uploaded,
 * nothing is executed, and dangerous file types are only ever offered for save.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AttachmentDetail, AttachmentPreview as PreviewData } from '@shared/types'
import { formatBytes, safetyLabel } from '@shared/attachments'
import { api, errorMessage } from '../bridge'
import { useApp } from '../state/AppProvider'
import { Icon } from './icons'
import { PdfViewer } from './PdfViewer'
import { Button, Chip, IconButton, Modal, Spinner } from './ui'

export function AttachmentPreview(): ReactNode {
  const { state, actions } = useApp()
  const target = state.preview
  const [detail, setDetail] = useState<AttachmentDetail | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [fitMode, setFitMode] = useState<'fit' | 'actual'>('fit')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [activeSheet, setActiveSheet] = useState(0)
  const [activeSlide, setActiveSlide] = useState(0)
  const [wrap, setWrap] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!target) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setPreview(null)
    setDetail(null)
    setZoom(1)
    setRotation(0)
    setFitMode('fit')
    setPage(1)
    setPageCount(0)
    setActiveSheet(0)
    setActiveSlide(0)
    void Promise.all([api.attachments.detail(target.attachmentId), api.attachments.preview(target.attachmentId)])
      .then(([attachment, previewData]) => {
        if (cancelled) return
        setDetail(attachment)
        setPreview(previewData)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(errorMessage(loadError))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [target])

  useEffect(() => {
    if (!target) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') actions.closeAttachment()
      if (event.key === 'ArrowLeft') navigate(-1)
      if (event.key === 'ArrowRight') navigate(1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const index = useMemo(() => {
    if (!target) return -1
    return target.attachments.findIndex((attachment) => attachment.id === target.attachmentId)
  }, [target])

  if (!target) return null

  const navigate = (direction: -1 | 1): void => {
    if (!target) return
    const next = target.attachments[index + direction]
    if (next) actions.openAttachment(target.messageId, next.id, target.attachments)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api.attachments.saveAs(target.attachmentId)
      if (result.ok && result.savedPath) {
        actions.pushToast({ tone: 'success', title: 'Saved to your computer', description: result.savedPath })
      } else if (result.error) {
        actions.pushToast({ tone: 'error', title: 'Not saved', description: result.error })
      }
    } catch (saveError) {
      actions.pushToast({ tone: 'error', title: 'Not saved', description: errorMessage(saveError) })
    } finally {
      setBusy(false)
    }
  }

  const openExternal = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api.attachments.openExternally(target.attachmentId)
      if (result.error) actions.pushToast({ tone: 'error', title: 'Could not open the file', description: result.error })
      else if (result.ok) {
        actions.pushToast({
          tone: 'info',
          title: 'Opening in your default application',
          description: 'Novamail wrote a temporary copy and asked Windows to open it. Please be sure you trust this file.'
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const safety = detail?.safety

  return (
    <Modal
      title={detail?.filename ?? 'Attachment'}
      size="xl"
      onClose={() => actions.closeAttachment()}
      headerExtra={
        <div className="row" style={{ gap: 6 }}>
          {safety ? (
            <Chip tone={safety.level === 'dangerous' ? 'danger' : safety.level === 'caution' ? 'warning' : 'success'}>
              {safetyLabel(safety.level)}
            </Chip>
          ) : null}
          {detail ? <span className="small muted">{formatBytes(detail.size)}</span> : null}
        </div>
      }
      footer={
        <>
          <span className="modal__footer-note">
            {preview?.type === 'unsupported' ? 'This file cannot be previewed inside Novamail.' : 'Previewed locally — nothing was uploaded.'}
          </span>
          <div className="row" style={{ gap: 6 }}>
            {index > 0 ? (
              <Button size="sm" icon="chevronLeft" onClick={() => navigate(-1)}>
                Previous
              </Button>
            ) : null}
            {index >= 0 && index < target.attachments.length - 1 ? (
              <Button size="sm" onClick={() => navigate(1)}>
                Next <Icon name="chevronRight" size={14} />
              </Button>
            ) : null}
          </div>
          <span className="spacer" />
          <Button icon="download" onClick={() => void save()} disabled={busy}>
            Save
          </Button>
          <Button icon="external" onClick={() => void openExternal()} disabled={busy || safety?.level === 'dangerous'}>
            Open in default app
          </Button>
          <Button icon="print" onClick={() => void api.attachments.print(target.attachmentId).catch(() => false)}>
            Print
          </Button>
        </>
      }
    >
      {loading ? <Spinner large label="Preparing the preview" /> : null}
      {error ? (
        <div className="banner banner--danger">
          <Icon name="error" size={16} />
          <div>{error}</div>
        </div>
      ) : null}

      {safety && safety.level !== 'safe' ? (
        <div className={`banner ${safety.level === 'dangerous' ? 'banner--danger' : 'banner--warning'}`} style={{ marginBottom: 12 }}>
          <Icon name="warning" size={16} />
          <div>
            <strong>{safetyLabel(safety.level)}.</strong> {safety.reason}
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="preview-body">
          <div className="preview-toolbar">
            {preview.type === 'pdf' || preview.type === 'image' ? (
              <>
                <IconButton icon="zoomOut" label="Zoom out" onClick={() => setZoom((value) => Math.max(0.25, value - 0.15))} />
                <span className="small muted" style={{ minWidth: 44, textAlign: 'center' }}>
                  {Math.round(zoom * 100)}%
                </span>
                <IconButton icon="zoomIn" label="Zoom in" onClick={() => setZoom((value) => Math.min(4, value + 0.15))} />
                <IconButton
                  icon="fit"
                  label={fitMode === 'fit' ? 'Show at actual size' : 'Fit to the window'}
                  onClick={() => setFitMode((value) => (value === 'fit' ? 'actual' : 'fit'))}
                />
                <IconButton icon="rotate" label="Rotate" onClick={() => setRotation((value) => (value + 90) % 360)} />
              </>
            ) : null}
            {preview.type === 'text' ? (
              <Button size="sm" variant="ghost" onClick={() => setWrap((value) => !value)}>
                {wrap ? 'No wrap' : 'Wrap lines'}
              </Button>
            ) : null}
            <span className="spacer" />
            {preview.type === 'text' ? (
              <span className="small muted">
                {preview.lines} lines {preview.truncated ? '• showing the start of a large file' : ''}
              </span>
            ) : null}
            {detail?.cached ? <span className="chip chip--muted">Cached locally</span> : null}
          </div>

          <div className="preview-stage">
            {preview.type === 'pdf' ? (
              <PdfViewer
                url={preview.url}
                zoom={zoom}
                rotation={rotation}
                fitMode={fitMode}
                page={page}
                onPageChange={setPage}
                onPageCount={setPageCount}
                onError={setError}
              />
            ) : null}

            {preview.type === 'image' ? (
              <div className="preview-image">
                <img
                  src={preview.url}
                  alt={detail?.filename ?? 'Attachment image'}
                  style={{
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                    maxWidth: fitMode === 'fit' ? '100%' : 'none'
                  }}
                />
              </div>
            ) : null}

            {preview.type === 'audio' ? (
              <div className="preview-media">
                <Icon name="audio" size={42} />
                <audio controls src={preview.url} aria-label={detail?.filename ?? 'Audio attachment'}>
                  Your browser cannot play this audio file.
                </audio>
              </div>
            ) : null}

            {preview.type === 'video' ? (
              <div className="preview-media">
                <video controls src={preview.url} aria-label={detail?.filename ?? 'Video attachment'}>
                  Your browser cannot play this video.
                </video>
              </div>
            ) : null}

            {preview.type === 'text' ? (
              <pre className={`text-preview ${wrap ? 'text-preview--wrap' : ''}`}>{preview.text}</pre>
            ) : null}

            {preview.type === 'spreadsheet' ? (
              <div className="sheet-preview">
                {preview.sheets.length > 1 ? (
                  <div className="sheet-tabs" role="tablist" aria-label="Sheets">
                    {preview.sheets.map((sheet, sheetIndex) => (
                      <button
                        key={sheet.name}
                        type="button"
                        role="tab"
                        aria-selected={sheetIndex === activeSheet}
                        className={`sheet-tab ${sheetIndex === activeSheet ? 'is-active' : ''}`}
                        onClick={() => setActiveSheet(sheetIndex)}
                      >
                        {sheet.name}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="sheet-table-wrap">
                  <table className="sheet-table">
                    <tbody>
                      {(preview.sheets[activeSheet]?.rows ?? []).map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.map((cell, cellIndex) =>
                            rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.sheets[activeSheet]?.truncatedRows || preview.sheets[activeSheet]?.truncatedCols ? (
                  <p className="small muted">
                    Only the first rows and columns are shown. Save the file to see everything.
                  </p>
                ) : null}
                {preview.warnings.map((warning) => (
                  <p key={warning} className="small muted">
                    {warning}
                  </p>
                ))}
              </div>
            ) : null}

            {preview.type === 'slides' ? (
              <div className="slide-preview">
                <div className="slide-thumbs" role="tablist" aria-label="Slides">
                  {preview.slides.map((slide, slideIndex) => (
                    <button
                      key={slide.index}
                      type="button"
                      role="tab"
                      aria-selected={slideIndex === activeSlide}
                      className={`slide-thumb ${slideIndex === activeSlide ? 'is-active' : ''}`}
                      onClick={() => setActiveSlide(slideIndex)}
                    >
                      {slide.index}
                    </button>
                  ))}
                </div>
                <div className="slide-stage">
                  <h3>{preview.slides[activeSlide]?.title || `Slide ${activeSlide + 1}`}</h3>
                  {preview.slides[activeSlide]?.imageDataUrls.map((src, imageIndex) => (
                    <img key={imageIndex} src={src} alt="" style={{ maxWidth: '100%' }} />
                  ))}
                  <ul>
                    {preview.slides[activeSlide]?.lines.map((line, lineIndex) => (
                      <li key={lineIndex}>{line}</li>
                    ))}
                  </ul>
                  {preview.warnings.length > 0 ? <p className="small muted">{preview.warnings.join(' ')}</p> : null}
                </div>
              </div>
            ) : null}

            {preview.type === 'html' || preview.type === 'email' ? (
              <iframe
                className="html-preview"
                title="Attachment preview"
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={preview.html}
              />
            ) : null}

            {preview.type === 'unsupported' ? (
              <div className="empty-state">
                <div className="empty-state__icon">
                  <Icon name="file" size={34} />
                </div>
                <h3>No preview available</h3>
                <p>{preview.reason}</p>
                <p className="small muted">{preview.suggestion}</p>
                <div className="row" style={{ gap: 8 }}>
                  <Button variant="primary" icon="download" onClick={() => void save()}>
                    Save the file
                  </Button>
                  <Button icon="external" onClick={() => void openExternal()} disabled={safety?.level === 'dangerous'}>
                    Open in the default app
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {pageCount > 1 && preview.type === 'pdf' ? (
            <div className="small muted" style={{ textAlign: 'center', paddingTop: 6 }}>
              Use the arrow keys to move between pages.
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}
