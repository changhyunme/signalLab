import { useRef } from 'react'
import { engine } from '../audio/engine'
import { BAR } from './Param'
import { useFrame } from './useFrame'

const FLOOR = -60

function text(peak: number) {
  const db = 20 * Math.log10(peak)
  const n = Math.round(Math.max(0, Math.min(1, (db - FLOOR) / -FLOOR)) * BAR)
  const value = db <= FLOOR ? '-inf' : `${db.toFixed(1)}dB`
  return `[${'#'.repeat(n)}${'.'.repeat(BAR - n)}] ${value.padStart(7)}`
}

export function Meters() {
  const refs = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)]
  const hold = useRef([0, 0])

  useFrame(() => {
    engine.peaks().forEach((p, i) => {
      const h = (hold.current[i] = Math.max(p, hold.current[i] * 0.9))
      const el = refs[i].current
      if (!el) return
      el.textContent = text(h)
      el.classList.toggle('clip', h >= 0.99)
    })
  })

  return (
    <>
      {['L', 'R'].map((ch, i) => (
        <div className="row" key={ch}>
          <span className="label">peak {ch}</span>
          <span ref={refs[i]} className="meter" />
        </div>
      ))}
    </>
  )
}
