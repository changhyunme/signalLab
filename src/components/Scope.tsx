import { useRef } from 'react'
import { engine } from '../audio/engine'
import { useFrame } from './useFrame'

type Mode = 'wave' | 'fft'

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export function Scope({ mode }: { mode: Mode }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const buf = useRef<Float32Array<ArrayBuffer> | null>(null)
  const colors = useRef<{ line: string; grid: string; dim: string } | null>(null)

  useFrame(() => {
    const canvas = ref.current
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    colors.current ??= { line: css('--accent'), grid: css('--line'), dim: css('--dim') }
    const c = colors.current
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    g.lineWidth = 1
    g.strokeStyle = c.grid
    g.fillStyle = c.dim
    g.font = '10px "JetBrains Mono", ui-monospace, monospace'

    const a = engine.analyser
    const live = a && engine.running
    if (mode === 'wave') drawWave(g, w, h, live ? a : null, buf, c.line)
    else drawSpectrum(g, w, h, live ? a : null, buf, c.line)
  })

  return <canvas ref={ref} className="scope" aria-label={mode === 'wave' ? 'oscilloscope' : 'spectrum'} />
}

type Buf = { current: Float32Array<ArrayBuffer> | null }

function samples(buf: Buf, n: number) {
  if (buf.current?.length !== n) buf.current = new Float32Array(n)
  return buf.current
}

function hline(g: CanvasRenderingContext2D, w: number, y: number) {
  g.beginPath()
  g.moveTo(0, Math.round(y) + 0.5)
  g.lineTo(w, Math.round(y) + 0.5)
  g.stroke()
}

function drawWave(g: CanvasRenderingContext2D, w: number, h: number, a: AnalyserNode | null, buf: Buf, color: string) {
  hline(g, w, h / 2)
  hline(g, w, h / 4)
  hline(g, w, (h * 3) / 4)
  g.strokeStyle = color
  g.beginPath()
  if (!a) {
    hline(g, w, h / 2)
    return
  }
  const data = samples(buf, a.fftSize)
  a.getFloatTimeDomainData(data)
  // Start on a rising zero crossing so periodic signals stand still.
  const span = data.length / 2
  let start = 0
  for (let i = 1; i < span; i++) {
    if (data[i - 1] < 0 && data[i] >= 0) {
      start = i
      break
    }
  }
  for (let x = 0; x < w; x++) {
    const v = data[start + Math.floor((x / w) * span)]
    const y = h / 2 - v * (h / 2) * 0.95
    if (x === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.stroke()
}

const MIN_DB = -110
const MAX_DB = -10

function drawSpectrum(g: CanvasRenderingContext2D, w: number, h: number, a: AnalyserNode | null, buf: Buf, color: string) {
  const fx = (f: number) => (Math.log(f / 20) / Math.log(1000)) * w
  for (const f of [100, 1000, 10000]) {
    const x = Math.round(fx(f)) + 0.5
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x, h)
    g.stroke()
    g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 3, h - 3)
  }
  if (!a) return
  const data = samples(buf, a.frequencyBinCount)
  a.getFloatFrequencyData(data)
  const nyquist = a.context.sampleRate / 2
  g.strokeStyle = color
  g.beginPath()
  for (let x = 0; x < w; x++) {
    const f = 20 * 1000 ** (x / w)
    const db = data[Math.min(data.length - 1, Math.round((f / nyquist) * data.length))]
    const u = Math.max(0, Math.min(1, (db - MIN_DB) / (MAX_DB - MIN_DB)))
    const y = h - u * h
    if (x === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.stroke()
}
