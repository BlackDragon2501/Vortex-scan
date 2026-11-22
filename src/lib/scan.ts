// Vórtex Scan - procesamiento de imagen 100% local.
// Homografia para aplanar documentos, filtros (grises, B/N adaptativo, realce),
// utilidades de camara y generacion de PDF con jsPDF.

export type FilterMode = 'original' | 'grises' | 'byn' | 'realce'

export interface Corner {
  x: number
  y: number
}

export interface ScanPage {
  id: string
  dataUrl: string // imagen original (JPEG base64)
  rot: number // grados: 0, 90, 180, 270
  filter: FilterMode
  corners: Corner[] | null // 4 esquinas en coords de la imagen ya rotada; null = sin recorte
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ---------- Camara ----------

export async function openCamera(video: HTMLVideoElement, facing: 'environment' | 'user'): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  })
  video.srcObject = stream
  await video.play()
}

export function closeCamera(video: HTMLVideoElement | null): void {
  const s = video?.srcObject as MediaStream | null
  s?.getTracks().forEach((t) => t.stop())
  if (video) video.srcObject = null
}

// Captura un fotograma del video a un canvas (limita a maxPx el lado mayor).
export function grabFrame(video: HTMLVideoElement, maxPx = 2000): HTMLCanvasElement {
  const vw = video.videoWidth || 1280
  const vh = video.videoHeight || 720
  const scale = Math.min(1, maxPx / Math.max(vw, vh))
  const c = document.createElement('canvas')
  c.width = Math.round(vw * scale)
  c.height = Math.round(vh * scale)
  c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height)
  return c
}

export function fileToCanvas(file: File, maxPx = 2600): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(img.width * scale))
        c.height = Math.max(1, Math.round(img.height * scale))
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        URL.revokeObjectURL(img.src)
        resolve(c)
      }
      img.onerror = () => reject(new Error('Archivo de imagen no valido'))
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

// ---------- Homografia (aplanar documento) ----------

// Resuelve la matriz 3x3 H que mapea los 4 puntos destino (rect) a los 4 puntos
// origen (esquinas marcadas) mediante DLT. Devuelve H inversa lista para muestrear:
// para cada pixel destino (x,y) se recupera su coordenada en la foto original.
function solveHomography(dst: Corner[], src: Corner[]): number[] {
  // Sistema 8x8 A*h = b con h = [h11..h32] (h33=1)
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i]
    const { x: u, y: v } = src[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }
  // Eliminacion de Gauss con pivoteo parcial
  for (let col = 0; col < 8; col++) {
    let piv = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    ;[A[col], A[piv]] = [A[piv], A[col]]
    ;[b[col], b[piv]] = [b[piv], b[col]]
    const d = A[col][col] || 1e-12
    for (let r = col + 1; r < 8; r++) {
      const f = A[r][col] / d
      if (!f) continue
      for (let k = col; k < 8; k++) A[r][k] -= f * A[col][k]
      b[r] -= f * b[col]
    }
  }
  const h = new Array(8).fill(0)
  for (let r = 7; r >= 0; r--) {
    let s = b[r]
    for (let k = r + 1; k < 8; k++) s -= A[r][k] * h[k]
    h[r] = s / (A[r][r] || 1e-12)
  }
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

// Aplica H a un punto (x,y) y devuelve (u,v) en la foto original.
function applyH(H: number[], x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8]
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]
}

// Aplanar: recorta el cuadrilatero de las 4 esquinas hacia un rectangulo recto,
// con muestreo bilinear. outW/outH se derivan del tamano medio de los lados.
export function flatten(src: HTMLCanvasElement, corners: Corner[], maxSide = 2200): HTMLCanvasElement {
  // Orden: [arriba-izq, arriba-der, abajo-der, abajo-izq]
  const [tl, tr, br, bl] = corners
  const wTop = Math.hypot(tr.x - tl.x, tr.y - tl.y)
  const wBot = Math.hypot(br.x - bl.x, br.y - bl.y)
  const hLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y)
  const hRight = Math.hypot(br.x - tr.x, br.y - tr.y)
  let outW = Math.max(32, Math.round((wTop + wBot) / 2))
  let outH = Math.max(32, Math.round((hLeft + hRight) / 2))
  const scale = Math.min(1, maxSide / Math.max(outW, outH))
  outW = Math.round(outW * scale)
  outH = Math.round(outH * scale)

  const ctx = src.getContext('2d')!
  const img = ctx.getImageData(0, 0, src.width, src.height)
  const S = img.data
  const out = new ImageData(outW, outH)
  const D = out.data

  // dst rect -> src quad
  const dst = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ]
  const H = solveHomography(dst, corners)

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [u, v] = applyH(H, x, y)
      const x0 = Math.floor(u)
      const y0 = Math.floor(v)
      const dx = u - x0
      const dy = v - y0
      const di = (y * outW + x) * 4
      if (x0 < -1 || y0 < -1 || x0 >= src.width || y0 >= src.height) {
        D[di] = D[di + 1] = D[di + 2] = 255
        D[di + 3] = 255
        continue
      }
      const cx = Math.min(Math.max(x0, 0), src.width - 1)
      const cy = Math.min(Math.max(y0, 0), src.height - 1)
      const nx = Math.min(x0 + 1, src.width - 1)
      const ny = Math.min(y0 + 1, src.height - 1)
      for (let ch = 0; ch < 4; ch++) {
        const p00 = S[(cy * src.width + cx) * 4 + ch]
        const p10 = S[(cy * src.width + nx) * 4 + ch]
        const p01 = S[(ny * src.width + cx) * 4 + ch]
        const p11 = S[(ny * src.width + nx) * 4 + ch]
        D[di + ch] =
          p00 * (1 - dx) * (1 - dy) + p10 * dx * (1 - dy) + p01 * (1 - dx) * dy + p11 * dx * dy
      }
      D[di + 3] = 255
    }
  }
  const c = document.createElement('canvas')
  c.width = outW
  c.height = outH
  c.getContext('2d')!.putImageData(out, 0, 0)
  return c
}

// ---------- Filtros ----------

// B/N adaptativo: umbral local con imagen integral (ventana = lado/12).
// Ideal para texto de documentos con iluminacion irregular.
function binarize(d: Uint8ClampedArray, w: number, h: number): void {
  const gray = new Float32Array(w * h)
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]
  }
  // imagen integral
  const W = w + 1
  const integral = new Float64Array(W * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x]
      integral[(y + 1) * W + (x + 1)] = integral[y * W + (x + 1)] + rowSum
    }
  }
  const win = Math.max(8, Math.floor(Math.max(w, h) / 12)) | 1
  const half = win >> 1
  const k = 0.88 // factor de umbral sobre la media local
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half)
    const y1 = Math.min(h - 1, y + half)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half)
      const x1 = Math.min(w - 1, x + half)
      const area = (x1 - x0 + 1) * (y1 - y0 + 1)
      const sum =
        integral[(y1 + 1) * W + (x1 + 1)] -
        integral[y0 * W + (x1 + 1)] -
        integral[(y1 + 1) * W + x0] +
        integral[y0 * W + x0]
      const mean = sum / area
      const i = y * w + x
      const p = i * 4
      const v = gray[i] < mean * k ? 0 : 255
      d[p] = d[p + 1] = d[p + 2] = v
    }
  }
}

export function applyFilter(canvas: HTMLCanvasElement, mode: FilterMode): HTMLCanvasElement {
  if (mode === 'original') return canvas
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  if (mode === 'grises') {
    for (let p = 0; p < d.length; p += 4) {
      const g = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]
      d[p] = d[p + 1] = d[p + 2] = g
    }
  } else if (mode === 'byn') {
    binarize(d, canvas.width, canvas.height)
  } else if (mode === 'realce') {
    // estiramiento de contraste sobre luminancia con leve saturacion
    let lo = 255
    let hi = 0
    for (let p = 0; p < d.length; p += 4) {
      const g = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]
      if (g < lo) lo = g
      if (g > hi) hi = g
    }
    const range = Math.max(1, hi - lo)
    const s = 255 / range
    for (let p = 0; p < d.length; p += 4) {
      for (let ch = 0; ch < 3; ch++) {
        const v = (d[p + ch] - lo) * s
        d[p + ch] = v < 0 ? 0 : v > 255 ? 255 : v
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

// ---------- Pipeline de una pagina ----------

// Rota, aplan segun esquinas y aplica filtro. Devuelve canvas listo para ver/exportar.
export function renderPage(img: HTMLImageElement, page: ScanPage): HTMLCanvasElement {
  // 1) rotacion
  const rot = ((page.rot % 360) + 360) % 360
  const rw = rot === 90 || rot === 270 ? img.height : img.width
  const rh = rot === 90 || rot === 270 ? img.width : img.height
  const rc = document.createElement('canvas')
  rc.width = rw
  rc.height = rh
  const rctx = rc.getContext('2d')!
  rctx.translate(rw / 2, rh / 2)
  rctx.rotate((rot * Math.PI) / 180)
  rctx.drawImage(img, -img.width / 2, -img.height / 2)
  // 2) aplanar
  let out = rc
  if (page.corners && page.corners.length === 4) {
    try {
      out = flatten(rc, page.corners)
    } catch {
      out = rc
    }
  }
  // 3) filtro
  return applyFilter(out, page.filter)
}

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Imagen no valida'))
    img.src = dataUrl
  })
}

// ---------- Exportar ----------

export function canvasToDataUrl(c: HTMLCanvasElement, format: 'png' | 'jpeg', quality = 0.9): string {
  return c.toDataURL(format === 'png' ? 'image/png' : 'image/jpeg', quality)
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// PDF multi-pagina A4 con jsPDF (carga dinamica, solo en el navegador).
export async function exportPdf(dataUrls: string[], filename: string): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = 210
  const pageH = 297
  const margin = 6
  dataUrls.forEach((url, i) => {
    if (i > 0) pdf.addPage('a4', 'portrait')
    const img = new Image()
    img.src = url
    // jsPDF calcula el tama;o con dimensiones conocidas; obtenemos props via callback
    const props = pdf.getImageProperties(url)
    const maxW = pageW - margin * 2
    const maxH = pageH - margin * 2
    const r = Math.min(maxW / props.width, maxH / props.height)
    const w = props.width * r
    const h = props.height * r
    pdf.addImage(url, 'JPEG', (pageW - w) / 2, (pageH - h) / 2, w, h)
  })
  pdf.save(filename)
}

// ---------- QR / Codigos de barras ----------

export interface DetectResult {
  text: string
  format: string
}

// Deteccion con BarcodeDetector nativo (Chrome/Edge/Android) y fallback jsQR.
export function barcodeSupported(): boolean {
  return typeof (globalThis as any).BarcodeDetector !== 'undefined'
}

export async function detectFromCanvas(c: HTMLCanvasElement): Promise<DetectResult | null> {
  const native = barcodeSupported()
  if (native) {
    try {
      const formats = [
        'qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'code_93', 'upc_a', 'upc_e',
        'itf', 'codabar', 'pdf417', 'aztec', 'data_matrix',
      ]
      let detector: any
      try {
        detector = new (globalThis as any).BarcodeDetector({ formats })
      } catch {
        detector = new (globalThis as any).BarcodeDetector()
      }
      const results = await detector.detect(c)
      if (results && results.length > 0) {
        return { text: results[0].rawValue, format: results[0].format || 'codigo' }
      }
    } catch {
      // cae al fallback
    }
  }
  // fallback jsQR (solo QR)
  try {
    const mod = await import('jsqr')
    const jsQR = (mod as any).default || mod
    const ctx = c.getContext('2d')!
    const img = ctx.getImageData(0, 0, c.width, c.height)
    const res = jsQR(img.data, c.width, c.height)
    if (res && res.data) return { text: res.data, format: 'qr_code' }
  } catch {
    // sin deteccion
  }
  return null
}

export function downscaleForDetect(src: HTMLCanvasElement | HTMLVideoElement, sw: number, sh: number, maxPx = 720): HTMLCanvasElement {
  const scale = Math.min(1, maxPx / Math.max(sw, sh))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(sw * scale))
  c.height = Math.max(1, Math.round(sh * scale))
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height)
  return c
}

export function looksLikeUrl(t: string): boolean {
  return /^(https?:\/\/|www\.)\S+$/i.test(t.trim()) || /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(t.trim())
}

export async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = t
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
      return true
    } catch {
      return false
    }
  }
}
