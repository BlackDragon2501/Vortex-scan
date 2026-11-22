'use client'

// Vortex Scan - Escaner de documentos y lector de QR / codigos de barras.
// Camara (getUserMedia), importacion desde el almacen del dispositivo,
// aplanado por homografia, filtros de documento y exportacion a PDF/PNG/JPG.
// Todo el procesamiento ocurre localmente en el navegador.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ScanLine,
  QrCode,
  Camera,
  CameraOff,
  SwitchCamera,
  Upload,
  RotateCcw,
  RotateCw,
  Crop,
  Check,
  X,
  Trash2,
  ArrowUp,
  ArrowDown,
  FileDown,
  ImageDown,
  Copy,
  Globe,
  History,
  ChevronLeft,
  ScanText,
} from 'lucide-react'
import {
  ScanPage,
  Corner,
  FilterMode,
  DetectResult,
  newId,
  openCamera,
  closeCamera,
  grabFrame,
  fileToCanvas,
  loadImage,
  renderPage,
  flatten,
  canvasToDataUrl,
  downloadDataUrl,
  exportPdf,
  barcodeSupported,
  detectFromCanvas,
  downscaleForDetect,
  looksLikeUrl,
  copyText,
} from '@/lib/scan'

type Tab = 'escanear' | 'qr'
const SUPPORT_EMAIL = 'vortexmusic.soporte.app@gmail.com'
const QR_HISTORY_KEY = 'vortex-scan-qr-history'

const FILTERS: { value: FilterMode; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'grises', label: 'Escala de grises' },
  { value: 'byn', label: 'Blanco y negro (documento)' },
  { value: 'realce', label: 'Realce de contraste' },
]

function VortexLogo({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <rect width="48" height="48" rx="10" fill="#161616" />
      <circle cx="24" cy="24" r="17" fill="none" stroke="#10b981" strokeWidth="3.5" />
      <path d="M24 10a14 14 0 1 1-9.9 4.1" fill="none" stroke="#34d399" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M24 17a7 7 0 1 0 7 7" fill="none" stroke="#34d399" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="24" cy="24" r="3" fill="#34d399" />
    </svg>
  )
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-[#2b2b31] bg-[#141416] px-6 py-4">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-1 text-center">
        <p className="text-[11px] text-[#9b9ba4]">
          Vórtex Scan · Derechos Reservados © 2026 Vortex Company ·{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#34d399] hover:underline">
            {SUPPORT_EMAIL}
          </a>
        </p>
        <p className="text-[11px] text-[#9b9ba4]">Gratis · Sin anuncios · 100% local en tu navegador</p>
      </div>
    </footer>
  )
}

const btn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#2b2b31] bg-[#1e1e22] px-3 py-2 text-xs font-medium text-[#ececf1] hover:bg-[#26262b] disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#10b981] px-3.5 py-2 text-xs font-semibold text-[#052e22] hover:bg-[#34d399] disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

export default function ScanApp() {
  const [tab, setTab] = useState<Tab>('escanear')

  // ---------- estado del escaner ----------
  const [pages, setPages] = useState<ScanPage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingCorners, setEditingCorners] = useState(false)
  const [draftCorners, setDraftCorners] = useState<Corner[]>([])
  const [camOn, setCamOn] = useState(false)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [camError, setCamError] = useState<string | null>(null)
  const [busyPdf, setBusyPdf] = useState(false)
  const imgCache = useRef<Map<string, HTMLImageElement>>(new Map())
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const displayScale = useRef(1)
  const dragIndex = useRef<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const selected = pages.find((p) => p.id === selectedId) || null

  const showToast = useCallback((m: string) => {
    setToast(m)
    window.setTimeout(() => setToast(null), 2200)
  }, [])

  // camara: encender / apagar / cambiar lado
  const startCam = useCallback(
    async (f: 'environment' | 'user') => {
      setCamError(null)
      try {
        closeCamera(videoRef.current)
        await openCamera(videoRef.current!, f)
        setCamOn(true)
        setFacing(f)
      } catch {
        setCamError('No se pudo acceder a la cámara. Revisa permisos o usa Importar.')
        setCamOn(false)
      }
    },
    []
  )
  const stopCam = useCallback(() => {
    closeCamera(videoRef.current)
    setCamOn(false)
  }, [])
  useEffect(() => () => closeCamera(videoRef.current), [])

  const addPage = useCallback((dataUrl: string) => {
    const p: ScanPage = { id: newId(), dataUrl, rot: 0, filter: 'original', corners: null }
    setPages((prev) => [...prev, p])
    setSelectedId(p.id)
  }, [])

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !videoRef.current.videoWidth) return
    const c = grabFrame(videoRef.current)
    addPage(canvasToDataUrl(c, 'jpeg', 0.92))
    showToast('Página capturada')
  }, [addPage, showToast])

  const importFiles = useCallback(
    async (files: FileList | null) => {
      if (!files) return
      const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'))
      for (const f of imgs) {
        try {
          const c = await fileToCanvas(f)
          addPage(canvasToDataUrl(c, 'jpeg', 0.92))
        } catch {
          showToast('No se pudo importar: ' + f.name)
        }
      }
      stopCam()
    },
    [addPage, showToast, stopCam]
  )

  // carga de imagen en cache
  const ensureImg = useCallback(async (p: ScanPage): Promise<HTMLImageElement | null> => {
    let img = imgCache.current.get(p.id)
    if (!img) {
      try {
        img = await loadImage(p.dataUrl)
        imgCache.current.set(p.id, img)
      } catch {
        return null
      }
    }
    return img
  }, [])

  // render del preview de la pagina seleccionada
  useEffect(() => {
    let alive = true
    async function draw() {
      if (!previewRef.current) return
      if (!selected) return
      const img = await ensureImg(selected)
      if (!alive || !img) return
      const editing = editingCorners
      const proc = renderPage(img, editing ? { ...selected, corners: null, filter: 'original' } : selected)
      const disp = previewRef.current
      disp.width = proc.width
      disp.height = proc.height
      disp.getContext('2d')!.drawImage(proc, 0, 0)
    }
    draw()
    return () => {
      alive = false
    }
  }, [selected, editingCorners, ensureImg])

  // esquinas por defecto cuando se entra al modo recorte
  useEffect(() => {
    if (editingCorners && selected && previewRef.current) {
      setDraftCorners([
        { x: 0, y: 0 },
        { x: previewRef.current.width - 1, y: 0 },
        { x: previewRef.current.width - 1, y: previewRef.current.height - 1 },
        { x: 0, y: previewRef.current.height - 1 },
      ])
    }
  }, [editingCorners, selected])

  // conversion pantalla -> coords imagen
  const toImgCoords = useCallback((e: React.PointerEvent): Corner | null => {
    const c = previewRef.current
    if (!c) return null
    const r = c.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    }
  }, [])

  const onOverlayDown = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    dragIndex.current = i
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onOverlayMove = (e: React.PointerEvent) => {
    if (dragIndex.current === null) return
    const pt = toImgCoords(e)
    if (!pt) return
    setDraftCorners((prev) => prev.map((c, i) => (i === dragIndex.current ? pt : c)))
  }
  const onOverlayUp = () => {
    dragIndex.current = null
  }

  const acceptCorners = () => {
    if (!selected || draftCorners.length !== 4) return
    const area = Math.abs(
      (draftCorners[1].x - draftCorners[0].x) * (draftCorners[2].y - draftCorners[0].y) -
        (draftCorners[2].x - draftCorners[0].x) * (draftCorners[1].y - draftCorners[0].y)
    )
    const full = previewRef.current ? previewRef.current.width * previewRef.current.height : 0
    if (area < full * 0.02) {
      showToast('El recorte es demasiado pequeño')
      return
    }
    setPages((prev) => prev.map((p) => (p.id === selected.id ? { ...p, corners: draftCorners } : p)))
    setEditingCorners(false)
    showToast('Documento aplanado')
  }

  const updateSelected = (patch: Partial<ScanPage>) => {
    if (!selected) return
    setPages((prev) => prev.map((p) => (p.id === selected.id ? { ...p, ...patch } : p)))
  }

  const movePage = (id: string, dir: -1 | 1) => {
    setPages((prev) => {
      const i = prev.findIndex((p) => p.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  const deletePage = (id: string) => {
    imgCache.current.delete(id)
    setPages((prev) => prev.filter((p) => p.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  // exportaciones
  const exportCurrent = async (format: 'png' | 'jpeg') => {
    if (!selected) return
    const img = await ensureImg(selected)
    if (!img) return
    const c = renderPage(img, selected)
    downloadDataUrl(canvasToDataUrl(c, format, 0.92), `vortex-scan-${Date.now()}.${format === 'png' ? 'png' : 'jpg'}`)
  }

  const exportAllPdf = async () => {
    if (!pages.length || busyPdf) return
    setBusyPdf(true)
    try {
      const urls: string[] = []
      for (const p of pages) {
        const img = await ensureImg(p)
        if (img) {
          const c = renderPage(img, p)
          urls.push(canvasToDataUrl(c, 'jpeg', 0.9))
        }
      }
      if (!urls.length) return
      await exportPdf(urls, `vortex-scan-${Date.now()}.pdf`)
      showToast('PDF generado')
    } finally {
      setBusyPdf(false)
    }
  }

  // ---------- estado del lector QR ----------
  const [qrCamOn, setQrCamOn] = useState(false)
  const [qrResult, setQrResult] = useState<DetectResult | null>(null)
  const [qrHistory, setQrHistory] = useState<DetectResult[]>([])
  const qrVideoRef = useRef<HTMLVideoElement>(null)
  const qrLoop = useRef<number>(0)
  const qrPaused = useRef(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(QR_HISTORY_KEY)
      if (raw) setQrHistory(JSON.parse(raw).slice(0, 12))
    } catch {}
  }, [])

  const pushHistory = useCallback((r: DetectResult) => {
    setQrHistory((prev) => {
      const next = [{ ...r }, ...prev.filter((x) => x.text !== r.text)].slice(0, 12)
      try {
        localStorage.setItem(QR_HISTORY_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }, [])

  const startQrCam = useCallback(async () => {
    setQrError(null)
    try {
      await openCamera(qrVideoRef.current!, 'environment')
      setQrCamOn(true)
      qrPaused.current = false
    } catch {
      setQrError('No se pudo acceder a la cámara. Revisa los permisos del navegador.')
    }
  }, [])
  const stopQrCam = useCallback(() => {
    closeCamera(qrVideoRef.current)
    setQrCamOn(false)
  }, [])
  const [qrError, setQrError] = useState<string | null>(null)

  // bucle de deteccion en vivo
  useEffect(() => {
    if (!qrCamOn) return
    let alive = true
    let last = 0
    const tick = async (ts: number) => {
      if (!alive) return
      if (ts - last > 250 && !qrPaused.current && qrVideoRef.current && qrVideoRef.current.videoWidth) {
        last = ts
        const c = downscaleForDetect(qrVideoRef.current, qrVideoRef.current.videoWidth, qrVideoRef.current.videoHeight, 640)
        const r = await detectFromCanvas(c)
        if (r && alive) {
          setQrResult((prev) => {
            if (!prev || prev.text !== r.text) {
              pushHistory(r)
              return r
            }
            return prev
          })
        }
      }
      qrLoop.current = requestAnimationFrame(tick)
    }
    qrLoop.current = requestAnimationFrame(tick)
    return () => {
      alive = false
      cancelAnimationFrame(qrLoop.current)
    }
  }, [qrCamOn, pushHistory])

  useEffect(() => () => closeCamera(qrVideoRef.current), [])

  const detectFromImage = async (files: FileList | null) => {
    if (!files || !files[0]) return
    try {
      const c = await fileToCanvas(files[0], 1400)
      const r = await detectFromCanvas(c)
      if (r) {
        setQrResult(r)
        pushHistory(r)
      } else {
        showToast('No se detectó ningún código en la imagen')
      }
    } catch {
      showToast('Imagen no válida')
    }
  }

  const [copied, setCopied] = useState(false)
  const doCopy = async (t: string) => {
    const ok = await copyText(t)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col bg-[#0f0f10] text-[#ececf1]">
      <header className="border-b border-[#2b2b31] bg-[#141416] px-4 sm:px-6 h-12 flex items-center gap-2.5 shrink-0">
        <VortexLogo className="w-6 h-6" />
        <span className="text-sm font-semibold tracking-wide">
          <span className="text-[#34d399]">Vórtex</span> Scan
        </span>
        <span className="text-[11px] text-[#9b9ba4] hidden sm:inline">· Escáner de documentos y códigos</span>
        <span className="ml-auto text-[11px] text-[#9b9ba4] hidden md:inline">Gratis · Sin anuncios · 100% local</span>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
        {/* pestañas */}
        <div className="flex gap-2">
          <button className={tab === 'escanear' ? btnPrimary : btn} onClick={() => setTab('escanear')}>
            <ScanLine className="w-4 h-4" aria-hidden /> Escáner de documentos
          </button>
          <button className={tab === 'qr' ? btnPrimary : btn} onClick={() => setTab('qr')}>
            <QrCode className="w-4 h-4" aria-hidden /> QR y códigos de barras
          </button>
        </div>

        {toast && (
          <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-[#1e1e22] border border-[#34d399]/40 px-4 py-2 text-xs text-[#34d399] shadow-lg">
            {toast}
          </div>
        )}

        {/* ================= ESCANER ================= */}
        {tab === 'escanear' && (
          <>
            <section className="rounded-xl border border-[#2b2b31] bg-[#17171a] p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {!camOn ? (
                  <button className={btnPrimary} onClick={() => startCam(facing)}>
                    <Camera className="w-4 h-4" aria-hidden /> Usar cámara
                  </button>
                ) : (
                  <>
                    <button className={btn} onClick={stopCam}>
                      <CameraOff className="w-4 h-4" aria-hidden /> Apagar cámara
                    </button>
                    <button
                      className={btn}
                      onClick={() => startCam(facing === 'environment' ? 'user' : 'environment')}
                    >
                      <SwitchCamera className="w-4 h-4" aria-hidden /> Cambiar cámara
                    </button>
                    <button className={btnPrimary} onClick={captureFrame}>
                      <ScanText className="w-4 h-4" aria-hidden /> Capturar página
                    </button>
                  </>
                )}
                <label className={btn + ' cursor-pointer'}>
                  <Upload className="w-4 h-4" aria-hidden /> Importar del dispositivo
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      importFiles(e.target.files)
                      e.currentTarget.value = ''
                    }}
                  />
                </label>
              </div>
              {camError && <p className="text-xs text-red-400">{camError}</p>}
              <div className="relative rounded-lg overflow-hidden border border-[#2b2b31] bg-black min-h-[220px]">
                <video ref={videoRef} playsInline muted className={'w-full max-h-[380px] object-contain ' + (camOn ? '' : 'hidden')} />
                {!camOn && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[#9b9ba4] text-xs">
                    <ScanLine className="w-8 h-8 opacity-50" aria-hidden />
                    <span>Activa la cámara o importa una imagen del almacén del dispositivo</span>
                  </div>
                )}
              </div>
            </section>

            {pages.length > 0 && (
              <section className="rounded-xl border border-[#2b2b31] bg-[#17171a] p-4 flex flex-col gap-3">
                <h2 className="text-xs font-semibold text-[#9b9ba4] uppercase tracking-wider">
                  Páginas ({pages.length})
                </h2>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {pages.map((p, i) => (
                    <div
                      key={p.id}
                      className={
                        'relative shrink-0 rounded-lg border p-1.5 cursor-pointer ' +
                        (p.id === selectedId ? 'border-[#10b981] bg-[#1e2a25]' : 'border-[#2b2b31] bg-[#1e1e22]')
                      }
                      onClick={() => {
                        setSelectedId(p.id)
                        setEditingCorners(false)
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.dataUrl} alt={`Página ${i + 1}`} className="h-20 w-auto rounded" />
                      <span className="absolute top-0.5 left-0.5 text-[10px] bg-black/70 rounded px-1">{i + 1}</span>
                      <div className="flex gap-0.5 mt-1">
                        <button
                          className="p-0.5 text-[#9b9ba4] hover:text-white disabled:opacity-30"
                          disabled={i === 0}
                          title="Mover arriba"
                          onClick={(e) => {
                            e.stopPropagation()
                            movePage(p.id, -1)
                          }}
                        >
                          <ArrowUp className="w-3.5 h-3.5" aria-hidden />
                        </button>
                        <button
                          className="p-0.5 text-[#9b9ba4] hover:text-white disabled:opacity-30"
                          disabled={i === pages.length - 1}
                          title="Mover abajo"
                          onClick={(e) => {
                            e.stopPropagation()
                            movePage(p.id, 1)
                          }}
                        >
                          <ArrowDown className="w-3.5 h-3.5" aria-hidden />
                        </button>
                        <button
                          className="p-0.5 text-[#9b9ba4] hover:text-red-400"
                          title="Eliminar"
                          onClick={(e) => {
                            e.stopPropagation()
                            deletePage(p.id)
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {selected && (
              <section className="rounded-xl border border-[#2b2b31] bg-[#17171a] p-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button className={btn} onClick={() => updateSelected({ rot: (selected.rot + 270) % 360 })}>
                    <RotateCcw className="w-4 h-4" aria-hidden /> Girar izquierda
                  </button>
                  <button className={btn} onClick={() => updateSelected({ rot: (selected.rot + 90) % 360 })}>
                    <RotateCw className="w-4 h-4" aria-hidden /> Girar derecha
                  </button>
                  <select
                    className="rounded-lg border border-[#2b2b31] bg-[#1e1e22] px-2.5 py-2 text-xs text-[#ececf1]"
                    value={selected.filter}
                    disabled={editingCorners}
                    onChange={(e) => updateSelected({ filter: e.target.value as FilterMode })}
                  >
                    {FILTERS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  {!editingCorners ? (
                    <button className={btn} onClick={() => setEditingCorners(true)}>
                      <Crop className="w-4 h-4" aria-hidden /> Aplanar (marcar 4 esquinas)
                    </button>
                  ) : (
                    <>
                      <button className={btnPrimary} onClick={acceptCorners}>
                        <Check className="w-4 h-4" aria-hidden /> Aplicar
                      </button>
                      <button className={btn} onClick={() => setEditingCorners(false)}>
                        <X className="w-4 h-4" aria-hidden /> Cancelar
                      </button>
                      {selected.corners && (
                        <button
                          className={btn}
                          onClick={() => {
                            updateSelected({ corners: null })
                            setEditingCorners(false)
                          }}
                        >
                          Quitar recorte
                        </button>
                      )}
                    </>
                  )}
                </div>

                <div ref={overlayRef} className="relative rounded-lg overflow-hidden border border-[#2b2b31] bg-black">
                  <canvas ref={previewRef} className="w-full max-h-[440px] object-contain" />
                  {editingCorners && previewRef.current && (
                    <svg
                      className="absolute inset-0 w-full h-full touch-none"
                      viewBox={`0 0 ${previewRef.current.width} ${previewRef.current.height}`}
                      preserveAspectRatio="xMidYMid meet"
                      onPointerMove={onOverlayMove}
                      onPointerUp={onOverlayUp}
                    >
                      <polygon
                        points={draftCorners.map((c) => `${c.x},${c.y}`).join(' ')}
                        fill="rgba(16,185,129,0.18)"
                        stroke="#34d399"
                        strokeWidth={Math.max(2, previewRef.current.width / 400)}
                      />
                      {draftCorners.map((c, i) => (
                        <circle
                          key={i}
                          cx={c.x}
                          cy={c.y}
                          r={Math.max(10, previewRef.current.width / 60)}
                          fill="#10b981"
                          stroke="#fff"
                          strokeWidth={Math.max(2, previewRef.current.width / 500)}
                          className="cursor-grab"
                          onPointerDown={onOverlayDown(i)}
                        />
                      ))}
                    </svg>
                  )}
                </div>
                {editingCorners && (
                  <p className="text-[11px] text-[#9b9ba4]">
                    Arrastra las 4 esquinas verdes a los bordes del documento (papel), luego pulsa Aplicar. Se endereza
                    la perspectiva automáticamente.
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button className={btnPrimary} onClick={() => exportAllPdf()} disabled={busyPdf}>
                    <FileDown className="w-4 h-4" aria-hidden /> {busyPdf ? 'Generando…' : `Exportar PDF (${pages.length})`}
                  </button>
                  <button className={btn} onClick={() => exportCurrent('png')} disabled={editingCorners}>
                    <ImageDown className="w-4 h-4" aria-hidden /> Descargar PNG
                  </button>
                  <button className={btn} onClick={() => exportCurrent('jpeg')} disabled={editingCorners}>
                    <ImageDown className="w-4 h-4" aria-hidden /> Descargar JPG
                  </button>
                </div>
              </section>
            )}
          </>
        )}

        {/* ================= QR ================= */}
        {tab === 'qr' && (
          <section className="rounded-xl border border-[#2b2b31] bg-[#17171a] p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {!qrCamOn ? (
                <button className={btnPrimary} onClick={startQrCam}>
                  <Camera className="w-4 h-4" aria-hidden /> Abrir cámara
                </button>
              ) : (
                <>
                  <button className={btn} onClick={stopQrCam}>
                    <CameraOff className="w-4 h-4" aria-hidden /> Cerrar cámara
                  </button>
                  <button className={btn} onClick={() => (qrPaused.current = !qrPaused.current)}>
                    {qrPaused.current ? 'Reanudar' : 'Pausar detección'}
                  </button>
                </>
              )}
              <label className={btn + ' cursor-pointer'}>
                <Upload className="w-4 h-4" aria-hidden /> Detectar desde imagen
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    detectFromImage(e.target.files)
                    e.currentTarget.value = ''
                  }}
                />
              </label>
              {barcodeSupported() && (
                <span className="text-[10px] text-[#34d399] border border-[#10b981]/40 rounded-full px-2 py-0.5">
                  Detector nativo: QR + 12 tipos de código
                </span>
              )}
            </div>
            {qrError && <p className="text-xs text-red-400">{qrError}</p>}
            <div className="relative rounded-lg overflow-hidden border border-[#2b2b31] bg-black min-h-[220px]">
              <video ref={qrVideoRef} playsInline muted className={'w-full max-h-[380px] object-contain ' + (qrCamOn ? '' : 'hidden')} />
              {!qrCamOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[#9b9ba4] text-xs">
                  <QrCode className="w-8 h-8 opacity-50" aria-hidden />
                  <span>Apunta la cámara al código o detecta desde una imagen</span>
                </div>
              )}
            </div>

            {qrResult && (
              <div className="rounded-lg border border-[#10b981]/40 bg-[#10231c] p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[#34d399]">
                  <Check className="w-3.5 h-3.5" aria-hidden /> Detectado · {qrResult.format}
                </div>
                <p className="text-sm break-all select-all">{qrResult.text}</p>
                <div className="flex flex-wrap gap-2">
                  <button className={btn} onClick={() => doCopy(qrResult.text)}>
                    <Copy className="w-4 h-4" aria-hidden /> {copied ? 'Copiado' : 'Copiar'}
                  </button>
                  {looksLikeUrl(qrResult.text) && (
                    <button
                      className={btnPrimary}
                      onClick={() =>
                        window.open(qrResult.text.startsWith('http') ? qrResult.text : 'https://' + qrResult.text, '_blank', 'noopener,noreferrer')
                      }
                    >
                      <Globe className="w-4 h-4" aria-hidden /> Abrir enlace
                    </button>
                  )}
                </div>
              </div>
            )}

            {qrHistory.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[#9b9ba4] uppercase tracking-wider">
                  <History className="w-3.5 h-3.5" aria-hidden /> Historial
                </h3>
                <ul className="flex flex-col gap-1">
                  {qrHistory.map((h, i) => (
                    <li key={i} className="flex items-center gap-2 rounded-lg bg-[#1e1e22] px-3 py-2">
                      <button
                        className="text-xs text-[#ececf1] hover:text-[#34d399] break-all flex-1 text-left"
                        onClick={() => setQrResult(h)}
                      >
                        {h.text}
                      </button>
                      <button className="text-[#9b9ba4] hover:text-white" onClick={() => doCopy(h.text)} title="Copiar">
                        <Copy className="w-3.5 h-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  className="text-[11px] text-[#9b9ba4] hover:text-red-400 self-start"
                  onClick={() => {
                    setQrHistory([])
                    localStorage.removeItem(QR_HISTORY_KEY)
                  }}
                >
                  Borrar historial
                </button>
              </div>
            )}
          </section>
        )}

        <p className="text-[11px] text-[#9b9ba4] text-center">
          Consejo: para mejores resultados en el modo B/N, marca las 4 esquinas del papel antes de exportar. Tus fotos
          nunca salen del navegador.
        </p>
      </main>
      <Footer />
    </div>
  )
}
