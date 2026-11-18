import { useEffect, useRef, useState } from 'react'
import { engine } from '../audio/engine'
import { DRUMS, PERC, type Drum, type Params } from '../audio/params'
import type { Action } from '../patch'
import { Param } from './Param'

const KEY_OF: Record<Drum, string> = { kick: 'KeyZ', snare: 'KeyX', hat: 'KeyV' }
const DRUM_OF: Record<string, Drum> = { KeyZ: 'kick', KeyX: 'snare', KeyV: 'hat' }
const KEY_GATE = 2
/** Every drum gets as many rows as the one with the most params, so switching doesn't shift the layout. */
const ROWS = Math.max(...DRUMS.map((d) => PERC.filter((spec) => spec.key.startsWith(d)).length))

type Props = { src: Params; perc: Params; dispatch(a: Action): void; start(): Promise<void> }

/** z kick · x snare · v hi-hat. Hitting a pad also selects it for editing. */
export function Perc({ src, perc, dispatch, start }: Props) {
  const [edit, setEdit] = useState<Drum>('kick')
  const [lit, setLit] = useState<Drum | null>(null)
  const timer = useRef(0)
  const latest = useRef({ src, perc, start })
  latest.current = { src, perc, start }

  const hit = async (drum: Drum) => {
    const { src, perc, start } = latest.current
    if (!engine.running) {
      // Starting from a pad: keep the oscillator quiet until a key is played.
      engine.setSource({ ...src, gate: KEY_GATE })
      dispatch({ t: 'src', key: 'gate', v: KEY_GATE })
      await start()
    }
    engine.hit(drum, perc)
    setEdit(drum)
    setLit(drum)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setLit(null), 120)
  }

  const specs = PERC.filter((spec) => spec.key.startsWith(edit))

  const hitRef = useRef(hit)
  hitRef.current = hit

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.repeat) return
      if (e.target instanceof Element && e.target.closest('input:not([type=range]), textarea, select, [role=menu]')) return
      const drum = DRUM_OF[e.code]
      if (!drum) return
      e.preventDefault()
      hitRef.current(drum)
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])

  return (
    <section className="box perc">
      <h2 className="title">perc</h2>
      <div className="keyrow pads">
        {DRUMS.map((drum) => (
          <button
            key={drum}
            className={lit === drum ? 'key on' : edit === drum ? 'key sel' : 'key'}
            onPointerDown={(e) => {
              e.preventDefault()
              hit(drum)
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="hint">{KEY_OF[drum].slice(3).toLowerCase()}</span>
            <span className="note">{drum}</span>
          </button>
        ))}
      </div>
      <div className="keyctl">
        {specs.map((spec) => (
          <Param key={spec.key} spec={spec} value={perc[spec.key]} onChange={(v) => dispatch({ t: 'perc', key: spec.key, v })} />
        ))}
        {Array.from({ length: ROWS - specs.length }, (_, i) => (
          <div key={i} className="row" aria-hidden />
        ))}
      </div>
    </section>
  )
}
