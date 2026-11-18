import { useId, useState } from 'react'
import { format, fromUnit, isOpt, parseValue, toUnit, type NumSpec, type ParamSpec } from '../audio/params'

export const BAR = 24

/** Filled span of the bar; bipolar params fill from their zero point. */
function span(spec: NumSpec, v: number): [number, number] {
  const n = Math.round(toUnit(spec, v) * BAR)
  if (spec.log || spec.min >= 0 || spec.max <= 0) return [0, n]
  const zero = Math.round(toUnit(spec, 0) * BAR)
  return n < zero ? [n, zero] : [zero, n]
}

type Props = { spec: ParamSpec; value: number; onChange(v: number): void }

export function Param({ spec, value, onChange }: Props) {
  const id = useId()

  if (isOpt(spec)) {
    return (
      <div className="row">
        <span className="label">{spec.label}</span>
        <span className="opts" role="radiogroup" aria-label={spec.label}>
          {spec.options.map((o, i) => (
            <button
              key={o}
              role="radio"
              aria-checked={i === value}
              className={i === value ? 'opt on' : 'opt'}
              onClick={() => onChange(i)}
            >
              {o}
            </button>
          ))}
        </span>
      </div>
    )
  }

  const [a, b] = span(spec, value)
  return (
    <div className="row">
      <label className="label" htmlFor={id}>
        {spec.label}
      </label>
      <span className="bar">
        <span aria-hidden>
          [{'.'.repeat(a)}
          <b>{'#'.repeat(b - a)}</b>
          {'.'.repeat(BAR - b)}]
        </span>
        <input
          id={id}
          type="range"
          min={0}
          max={1000}
          value={Math.round(toUnit(spec, value) * 1000)}
          aria-valuetext={format(spec, value)}
          onChange={(e) => onChange(fromUnit(spec, Number(e.target.value) / 1000))}
          onDoubleClick={() => onChange(spec.value)}
        />
      </span>
      <Value spec={spec} value={value} onChange={onChange} />
    </div>
  )
}

/** Shows the formatted value; click to type an exact one. */
function Value({ spec, value, onChange }: Props) {
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    return (
      <button className="value" title="type a value" onClick={() => setDraft(format(spec, value))}>
        {format(spec, value)}
      </button>
    )
  }

  const commit = () => {
    const v = parseValue(spec, draft)
    if (v !== null) onChange(v)
    setDraft(null)
  }

  return (
    <input
      className="value edit"
      autoFocus
      value={draft}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
    />
  )
}
