import { useRef } from 'react'
import { FX } from '../audio/effects'
import { engine } from '../audio/engine'
import type { Action, FxState } from '../patch'
import { Param } from './Param'
import { useFrame } from './useFrame'

type Props = { fx: FxState; index: number; count: number; dispatch(a: Action): void }

export function FxBlock({ fx, index, count, dispatch }: Props) {
  const def = FX[fx.type]
  const id = fx.id

  return (
    <div className={fx.on ? 'fx' : 'fx off'}>
      <div className="fx-head">
        <button className="fold" aria-expanded={fx.open} onClick={() => dispatch({ t: 'fold', id })}>
          {fx.open ? '▾' : '▸'}
        </button>
        <span className="idx">{String(index + 1).padStart(2, '0')}</span>
        <span className="name">{def.label}</span>
        {fx.type === 'comp' && <Reduction id={id} />}
        <span className="spacer" />
        <button className={fx.on ? 'tag on' : 'tag'} aria-pressed={fx.on} onClick={() => dispatch({ t: 'toggle', id })}>
          {fx.on ? '[on ]' : '[byp]'}
        </button>
        <button title="move up" disabled={index === 0} onClick={() => dispatch({ t: 'move', id, to: index - 1 })}>
          ↑
        </button>
        <button title="move down" disabled={index === count - 1} onClick={() => dispatch({ t: 'move', id, to: index + 1 })}>
          ↓
        </button>
        <button title="reset params" onClick={() => dispatch({ t: 'resetFx', id })}>
          ↺
        </button>
        <button title="remove" className="rm" onClick={() => dispatch({ t: 'remove', id })}>
          ×
        </button>
      </div>
      {fx.open && (
        <div className="params">
          {def.params.map((spec) => (
            <Param
              key={spec.key}
              spec={spec}
              value={fx.p[spec.key]}
              onChange={(v) => dispatch({ t: 'fx', id, key: spec.key, v })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Reduction({ id }: { id: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useFrame(() => {
    const el = ref.current
    if (!el) return
    const gr = engine.reduction(id)
    el.textContent = `gr ${gr.toFixed(1).padStart(5)}dB`
    el.classList.toggle('active', gr < -0.5)
  })
  return <span ref={ref} className="gr" />
}
