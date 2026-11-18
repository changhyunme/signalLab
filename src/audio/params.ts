export type NumSpec = {
  key: string
  label: string
  min: number
  max: number
  value: number
  unit?: 'Hz' | 's' | 'dB' | '%' | 'ratio' | 'ct' | 'pan'
  log?: boolean
  step?: number
}

export type OptSpec = {
  key: string
  label: string
  options: string[]
  value: number
}

export type ParamSpec = NumSpec | OptSpec
export type Params = Record<string, number>

export const isOpt = (spec: ParamSpec): spec is OptSpec => 'options' in spec

export const dbToGain = (db: number) => 10 ** (db / 20)

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function defaults(specs: ParamSpec[]): Params {
  return Object.fromEntries(specs.map((s) => [s.key, s.value]))
}

/** Fills in missing or invalid values (e.g. from an older saved patch). */
export function merge(specs: ParamSpec[], p: unknown): Params {
  const src = (p ?? {}) as Record<string, unknown>
  return Object.fromEntries(
    specs.map((s) => {
      const v = src[s.key]
      return [s.key, typeof v === 'number' && Number.isFinite(v) ? constrain(s, v) : s.value]
    }),
  )
}

export function constrain(spec: ParamSpec, v: number): number {
  if (isOpt(spec)) return clamp(Math.round(v), 0, spec.options.length - 1)
  return clamp(v, spec.min, spec.max)
}

/** Position of a value on its control, 0..1. */
export function toUnit(spec: NumSpec, v: number): number {
  const u = spec.log
    ? Math.log(v / spec.min) / Math.log(spec.max / spec.min)
    : (v - spec.min) / (spec.max - spec.min)
  return clamp(u, 0, 1)
}

export function fromUnit(spec: NumSpec, u: number): number {
  const v = spec.log
    ? spec.min * (spec.max / spec.min) ** u
    : spec.min + (spec.max - spec.min) * u
  return tidy(spec, v)
}

function tidy(spec: NumSpec, v: number): number {
  const r = spec.step ? Math.round(v / spec.step) * spec.step : Number(v.toPrecision(spec.log ? 3 : 4))
  return clamp(Number(r.toFixed(6)), spec.min, spec.max)
}

export function format(spec: ParamSpec, v: number): string {
  if (isOpt(spec)) return spec.options[v] ?? '?'
  switch (spec.unit) {
    case 'Hz':
      return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)}kHz` : `${v.toFixed(v < 100 ? 1 : 0)}Hz`
    case 's':
      return v < 1 ? `${(v * 1000).toFixed(0)}ms` : `${v.toFixed(2)}s`
    case 'dB':
      return `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`
    case '%':
      return `${Math.round(v * 100)}%`
    case 'ratio':
      return `${v.toFixed(1)}:1`
    case 'ct':
      return `${v > 0 ? '+' : ''}${Math.round(v)}ct`
    case 'pan':
      return Math.abs(v) < 0.005 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`
    default:
      return v.toFixed(spec.step && spec.step >= 1 ? 0 : 2)
  }
}

/** Parses typed input: "1.2k", "350ms", "30%", "L40", or an option name. */
export function parseValue(spec: ParamSpec, text: string): number | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  if (isOpt(spec)) {
    const exact = spec.options.indexOf(t)
    if (exact >= 0) return exact
    const prefix = spec.options.findIndex((o) => o.startsWith(t))
    if (prefix >= 0) return prefix
    const n = Number(t)
    return Number.isInteger(n) && n >= 0 && n < spec.options.length ? n : null
  }
  if (spec.unit === 'pan') {
    if (t === 'c') return 0
    const m = /^([lr])\s*(\d+(?:\.\d+)?)$/.exec(t)
    if (m) return clamp((m[1] === 'l' ? -1 : 1) * (Number(m[2]) / 100), -1, 1)
  }
  const m = /^(-?\d*\.?\d+)\s*(k|khz|hz|ms|s|%|db|ct)?$/.exec(t)
  if (!m) return null
  let v = Number(m[1])
  const suffix = m[2]
  if (suffix === 'k' || suffix === 'khz') v *= 1000
  if (suffix === 'ms') v /= 1000
  if (spec.unit === '%' && (suffix === '%' || v > 1)) v /= 100
  return clamp(v, spec.min, spec.max)
}

export const SOURCE: ParamSpec[] = [
  { key: 'wave', label: 'wave', options: ['sine', 'square', 'saw', 'tri', 'noise'], value: 2 },
  { key: 'freq', label: 'freq', min: 20, max: 20000, value: 110, unit: 'Hz', log: true },
  { key: 'detune', label: 'detune', min: -100, max: 100, value: 0, unit: 'ct', step: 1 },
  { key: 'level', label: 'level', min: -48, max: 0, value: -12, unit: 'dB', step: 0.1 },
  { key: 'gate', label: 'gate', options: ['hold', 'pulse', 'key'], value: 1 },
  { key: 'rate', label: 'rate', min: 0.25, max: 16, value: 2, unit: 'Hz', log: true },
  { key: 'duty', label: 'duty', min: 0.02, max: 0.95, value: 0.2, unit: '%', step: 0.01 },
]

export const KEYS: ParamSpec[] = [
  { key: 'mode', label: 'mapping', options: ['notes', 'piano', 'trumpet'], value: 0 },
  { key: 'a4', label: 'A4', min: 438, max: 448, value: 440, unit: 'Hz', step: 1 },
  { key: 'oct', label: 'octave', min: 1, max: 7, value: 4, step: 1 },
  { key: 'partial', label: 'partial', min: 2, max: 8, value: 4, step: 1 },
]

export const MASTER: ParamSpec[] = [
  { key: 'vol', label: 'volume', min: -48, max: 6, value: 0, unit: 'dB', step: 0.1 },
  { key: 'limit', label: 'limiter', options: ['on', 'off'], value: 0 },
]
