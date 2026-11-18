import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { engine } from '../audio/engine'
import { clamp, KEYS, type NumSpec, type Params } from '../audio/params'
import type { Action } from '../patch'
import { Param } from './Param'

const NOTES = 0
const PIANO = 1
const TRUMPET = 2

const MODES = [
  { name: 'notes', keys: 'c d e f g a b' },
  { name: 'piano', keys: 'a–l white · w–p black' },
  { name: 'trumpet', keys: 'dsa · jkl valves 1-3' },
]

/** Physical key → semitones above C of the current octave. */
const NOTE_KEYS: [string, number][] = [
  ['KeyC', 0], ['KeyD', 2], ['KeyE', 4], ['KeyF', 5], ['KeyG', 7], ['KeyA', 9], ['KeyB', 11],
]
const PIANO_WHITE: [string, number][] = [
  ['KeyA', 0], ['KeyS', 2], ['KeyD', 4], ['KeyF', 5], ['KeyG', 7], ['KeyH', 9], ['KeyJ', 11], ['KeyK', 12], ['KeyL', 14],
]
/** Black keys with the index of the white key on their left. */
const PIANO_BLACK: [string, number, number][] = [
  ['KeyW', 1, 0], ['KeyE', 3, 1], ['KeyT', 6, 3], ['KeyY', 8, 4], ['KeyU', 10, 5], ['KeyO', 13, 7], ['KeyP', 15, 8],
]
const PITCH_MAPS: Record<string, number>[] = [
  Object.fromEntries(NOTE_KEYS),
  Object.fromEntries([...PIANO_WHITE, ...PIANO_BLACK.map(([code, semi]) => [code, semi] as const)]),
]

/** Both hands work the same three valves, mirrored: index fingers on d and j. */
const VALVE_OF: Record<string, number> = { KeyD: 1, KeyS: 2, KeyA: 3, KeyJ: 1, KeyK: 2, KeyL: 3 }
/** Semitones each valve lowers the pitch, as on a real trumpet. */
const VALVE_DROP: Record<number, number> = { 1: 2, 2: 1, 3: 3 }
/** Bb2, the fundamental of a Bb trumpet; partials are whole multiples of it. */
const TRUMPET_ROOT = 46
const BEND_MAX = 100
const BEND_RATE = 200

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const KEY_GATE = 2

const CHORDS = { maj: [0, 4, 7], min: [0, 3, 7], aug: [0, 4, 8], dim: [0, 3, 6] }
type Chord = keyof typeof CHORDS

const nameOf = (midi: number, flat = false) =>
  `${(flat ? FLATS : NAMES)[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
const exactFreq = (midi: number, a4: number) => a4 * 2 ** ((midi - 69) / 12)
const freqOf = (midi: number, a4: number) => Math.round(exactFreq(midi, a4) * 100) / 100
const hint = (code: string) => code.slice(3).toLowerCase()
const spec = (key: string) => KEYS.find((s) => s.key === key)!

const LETTER_SEMIS = [0, 2, 4, 5, 7, 9, 11]

/**
 * Written pitch for a Bb trumpet: a major second above concert, spelled on the
 * next letter (concert Bb = written C, G = A, B = C#).
 */
function writtenName(concert: number) {
  const letter = 'CDEFGAB'.indexOf(FLATS[((concert % 12) + 12) % 12][0])
  const next = (letter + 1) % 7
  const diff = ((concert + 2 - LETTER_SEMIS[next]) % 12 + 18) % 12 - 6
  const natural = concert + 2 - diff
  return `${'CDEFGAB'[next]}${diff > 0 ? '#'.repeat(diff) : 'b'.repeat(-diff)}${Math.floor(natural / 12) - 1}`
}

/** Concert name with its offset in cents (partials sit off the 12-TET grid), then the written note. */
function describeFreq(freq: number, a4: number) {
  const exact = 69 + 12 * Math.log2(freq / a4)
  const midi = Math.round(exact)
  const cents = Math.round((exact - midi) * 100)
  return `${nameOf(midi, true)} = ${writtenName(midi)}${cents ? ` ${cents > 0 ? '+' : ''}${cents}ct` : ''}`
}

function trumpetFreq(valves: number[], keys: Params) {
  const drop = valves.reduce((sum, v) => sum + VALVE_DROP[v], 0)
  return Math.round(exactFreq(TRUMPET_ROOT, keys.a4) * keys.partial * 2 ** (-drop / 12) * 100) / 100
}

type Props = { src: Params; keys: Params; dispatch(a: Action): void; start(): void }

/**
 * notes / piano: keys play while held; ↑/↓ semitone, ←/→ octave,
 *   shift + note = major triad (↑ aug, ↓ minor, option/alt dim), space = hold.
 * trumpet: d s a / j k l are valves 1-3 and sound while pressed, space blows the open
 *   note, ←/→ pick the partial, ↑/↓ bend the pitch while held.
 */
export function Keys({ src, keys, dispatch, start }: Props) {
  const mode = keys.mode
  const [held, setHeld] = useState<string[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [arrow, setArrow] = useState(0)
  const [mods, setMods] = useState({ shift: false, alt: false })
  const [space, setSpace] = useState(false)
  const [holdLatch, setHoldLatch] = useState(false)
  const [semiLatch, setSemiLatch] = useState(0)
  const [chordLatch, setChordLatch] = useState<Chord | null>(null)
  const [bend, setBend] = useState(0)
  const [menu, setMenu] = useState(false)
  // Read by key handlers before state updates land.
  const heldRef = useRef<string[]>([])
  const spaceDown = useRef(false)

  const sustain = space || holdLatch
  // With shift down the arrows pick the triad quality instead of shifting.
  const semis = mods.shift ? semiLatch : arrow || semiLatch
  const chord: Chord | null = mods.shift
    ? mods.alt
      ? 'dim'
      : arrow === 1
        ? 'aug'
        : arrow === -1
          ? 'min'
          : 'maj'
    : chordLatch
  const valves = [...new Set(held.map((c) => VALVE_OF[c]).filter(Boolean))].sort()
  const blowing = mode === TRUMPET && (space || valves.length > 0)

  const latest = useRef({ src, keys, holdLatch, start })
  latest.current = { src, keys, holdLatch, start }

  const sound = (freq: number, chordTones: number[]) => {
    const { src, start } = latest.current
    // Apply right away for low latency; the dispatch keeps the patch in sync.
    engine.setChord(chordTones)
    engine.setSource({ ...src, freq, gate: KEY_GATE })
    engine.hold(true)
    dispatch({ t: 'src', key: 'freq', v: freq })
    if (src.gate !== KEY_GATE) dispatch({ t: 'src', key: 'gate', v: KEY_GATE })
    if (!engine.running) start()
  }

  const rootMidi = (code: string) => 12 * (keys.oct + 1) + PITCH_MAPS[mode][code] + semis

  // notes / piano
  useEffect(() => {
    if (mode === TRUMPET) return
    if (!current) return engine.hold(false)
    sound(freqOf(rootMidi(current), keys.a4), chord ? CHORDS[chord] : [0])
  }, [mode, current, semis, chord, keys.a4, keys.oct])

  // trumpet
  const valveKey = valves.join('')
  useEffect(() => {
    if (mode !== TRUMPET) return
    if (!blowing) return engine.hold(false)
    sound(trumpetFreq(valves, keys), [0])
  }, [mode, blowing, valveKey, keys.partial, keys.a4])

  // Trumpet slide: ↑/↓ bend while held, springing back on release.
  useEffect(() => {
    if (mode !== TRUMPET || !arrow) {
      engine.setBend(0, 0.06)
      setBend(0)
      return
    }
    let value = 0
    let last = performance.now()
    let id = requestAnimationFrame(function step(now) {
      value = clamp(value + (arrow * BEND_RATE * (now - last)) / 1000, -BEND_MAX, BEND_MAX)
      last = now
      engine.setBend(value, 0.01)
      setBend(Math.round(value))
      id = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(id)
  }, [mode, arrow])

  // A new mapping starts from silence.
  useEffect(() => {
    heldRef.current = []
    setHeld([])
    setCurrent(null)
    engine.hold(false)
  }, [mode])

  const setHeldKeys = (next: string[]) => {
    heldRef.current = next
    setHeld(next)
  }

  const playable = (code: string) => (mode === TRUMPET ? code in VALVE_OF : code in PITCH_MAPS[mode])

  const press = (code: string) => {
    if (!playable(code)) return false
    setHeldKeys([...heldRef.current.filter((c) => c !== code), code])
    if (mode !== TRUMPET) setCurrent(code)
    return true
  }

  /** Falls back to a still-held key; otherwise sustain keeps the last note. */
  const settle = (sustained: boolean) => {
    if (mode === TRUMPET) return
    const top = heldRef.current.at(-1)
    if (top) setCurrent(top)
    else if (!sustained) setCurrent(null)
  }

  const release = (code: string) => {
    if (!heldRef.current.includes(code)) return
    setHeldKeys(heldRef.current.filter((c) => c !== code))
    settle(spaceDown.current || latest.current.holdLatch)
  }

  const pressSpace = (down: boolean) => {
    spaceDown.current = down
    setSpace(down)
    if (!down) settle(latest.current.holdLatch)
  }

  const handlers = useRef({ press, release, pressSpace })
  handlers.current = { press, release, pressSpace }

  useEffect(() => {
    const ignore = (e: KeyboardEvent) =>
      e.metaKey ||
      e.ctrlKey ||
      // Sliders and buttons keep focus after a mouse tweak; only text fields and the menu take the keys.
      (e.target instanceof Element && e.target.closest('input:not([type=range]), textarea, select, [role=menu]'))

    const down = (e: KeyboardEvent) => {
      if (ignore(e)) return
      setMods({ shift: e.shiftKey, alt: e.altKey })
      if (e.key === 'Alt') e.preventDefault()
      if (e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) handlers.current.pressSpace(true)
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        setArrow(e.key === 'ArrowUp' ? 1 : -1)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        // One step per press; holding the key doesn't keep moving.
        if (e.repeat) return
        const k = latest.current.keys
        const key = k.mode === TRUMPET ? 'partial' : 'oct'
        const s = spec(key) as NumSpec
        const next = clamp(k[key] + (e.key === 'ArrowRight' ? 1 : -1), s.min, s.max)
        if (next !== k[key]) dispatch({ t: 'keys', key, v: next })
      } else if (!e.repeat && handlers.current.press(e.code)) {
        e.preventDefault()
      }
    }

    const up = (e: KeyboardEvent) => {
      setMods({ shift: e.shiftKey, alt: e.altKey })
      if (e.code === 'Space') {
        if (!spaceDown.current) return
        // Also keeps a focused button from being clicked by space.
        e.preventDefault()
        handlers.current.pressSpace(false)
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const dir = e.key === 'ArrowUp' ? 1 : -1
        setArrow((a) => (a === dir ? 0 : a))
      } else {
        handlers.current.release(e.code)
      }
    }

    const reset = () => {
      heldRef.current = []
      setHeld([])
      setArrow(0)
      setMods({ shift: false, alt: false })
      handlers.current.pressSpace(false)
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', reset)
    }
  }, [dispatch])

  const key = (code: string, active: boolean, label: string, sub?: string) => (
    <button
      key={code}
      className={active ? 'key on' : 'key'}
      onPointerDown={(e) => {
        e.preventDefault()
        press(code)
      }}
      onPointerUp={() => release(code)}
      onPointerLeave={() => release(code)}
      onPointerCancel={() => release(code)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <span className="hint">{hint(code)}</span>
      <span className="note">{label}</span>
      {sub && <span className="freq">{sub}</span>}
    </button>
  )

  const param = (name: string) => (
    <Param key={name} spec={spec(name)} value={keys[name]} onChange={(v) => dispatch({ t: 'keys', key: name, v })} />
  )

  const playing = current ? (chord ? CHORDS[chord] : [0]).map((i) => rootMidi(current) + i) : []
  const blown = blowing ? trumpetFreq(valves, keys) * 2 ** (bend / 1200) : 0

  return (
    <section
      className="box keys"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu(true)
      }}
    >
      <ModeMenu mode={mode} open={menu} setOpen={setMenu} onPick={(v) => dispatch({ t: 'keys', key: 'mode', v })} />

      {mode === NOTES && (
        <div className="keyrow notes">
          {NOTE_KEYS.map(([code]) => {
            const midi = rootMidi(code)
            return key(code, current === code, nameOf(midi), freqOf(midi, keys.a4).toFixed(2))
          })}
        </div>
      )}

      {mode === PIANO && (
        <div className="keyrow piano">
          {PIANO_BLACK.map(([code, , left]) => (
            <div key={code} className="slot black" style={{ gridColumn: `${left * 2 + 2} / span 2` }}>
              {key(code, current === code, nameOf(rootMidi(code)))}
            </div>
          ))}
          {PIANO_WHITE.map(([code], i) => (
            <div key={code} className="slot white" style={{ gridColumn: `${i * 2 + 1} / span 2` }}>
              {key(code, current === code, nameOf(rootMidi(code)))}
            </div>
          ))}
        </div>
      )}

      {mode === TRUMPET && (
        <div className="keyrow valves">
          {['KeyD', 'KeyS', 'KeyA'].map((code, i) =>
            key(code, valves.includes(i + 1), `valve ${i + 1}`, `-${VALVE_DROP[i + 1]} · ${'jkl'[i]}`),
          )}
          <button
            className={space ? 'key on' : 'key'}
            onPointerDown={(e) => {
              e.preventDefault()
              pressSpace(true)
            }}
            onPointerUp={() => pressSpace(false)}
            onPointerLeave={() => spaceDown.current && pressSpace(false)}
            onPointerCancel={() => pressSpace(false)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <span className="hint">space</span>
            <span className="note">open</span>
            <span className="freq">blow</span>
          </button>
        </div>
      )}

      <div className="keyctl">
        {param('a4')}
        {mode === TRUMPET ? (
          <>
            {param('partial')}
            <div className="row">
              <span className="label">bend</span>
              <span className="now">
                {bend > 0 ? '+' : ''}
                {bend}ct <span className="dim">↑ ↓ hold</span>
              </span>
            </div>
            <div className="row">
              <span className="label">now</span>
              <span className="now">
                {blowing
                  ? `${valves.length ? valves.join('+') : 'open'} · ${describeFreq(blown, keys.a4)} · ${blown.toFixed(2)}Hz`
                  : '—'}
              </span>
            </div>
          </>
        ) : (
          <>
            {param('oct')}
            <Options<number>
              label="shift"
              value={semis}
              options={[[-1, '♭ ↓'] as const, [0, '♮'] as const, [1, '♯ ↑'] as const]}
              onChange={setSemiLatch}
            />
            <Options
              label="triad"
              value={chord ?? 'off'}
              options={[['off', 'off'], ...(Object.keys(CHORDS) as Chord[]).map((c) => [c, c] as const)]}
              onChange={(v) => setChordLatch(v === 'off' ? null : (v as Chord))}
            />
            <div className="row">
              <span className="label">hold</span>
              <span className="opts">
                <button
                  className={sustain ? 'opt on' : 'opt'}
                  aria-pressed={sustain}
                  onClick={() => {
                    setHoldLatch(!holdLatch)
                    if (holdLatch && !space) settle(false)
                  }}
                >
                  {sustain ? 'on' : 'off'} · space
                </button>
              </span>
            </div>
            <div className="row">
              <span className="label">now</span>
              <span className="now">
                {playing.length
                  ? playing.map((m, i) => nameOf(m, chord !== null && [3, 6].includes(CHORDS[chord][i]))).join(' ') +
                    (chord ? ` · ${NAMES[((playing[0] % 12) + 12) % 12]} ${chord}` : '')
                  : '—'}
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

type MenuProps = { mode: number; open: boolean; setOpen(open: boolean): void; onPick(mode: number): void }

/** The panel title opens a menu for picking the key mapping (also on right-click). */
function ModeMenu({ mode, open, setOpen, onPick }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const items = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]') ?? [])]

  useEffect(() => {
    if (!open) return
    items()[mode]?.focus()
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open, mode, setOpen])

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const list = items()
    const i = list.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus()
    }
    if (e.key === 'Escape') {
      setOpen(false)
      ref.current?.querySelector<HTMLButtonElement>('.menu-btn')?.focus()
    }
  }

  return (
    <div className="title menu-wrap" ref={ref}>
      <button className="menu-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        keys: {MODES[mode].name} ▾
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="key mapping" onKeyDown={onKeyDown}>
          {MODES.map((m, i) => (
            <button
              key={m.name}
              role="menuitemradio"
              aria-checked={i === mode}
              onClick={() => {
                onPick(i)
                setOpen(false)
              }}
            >
              <span className="mark">{i === mode ? '>' : ' '}</span>
              <span className="name">{m.name}</span>
              <span className="dim">{m.keys}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type OptionsProps<T> = { label: string; value: T; options: (readonly [T, string])[]; onChange(v: T): void }

function Options<T extends string | number>({ label, value, options, onChange }: OptionsProps<T>) {
  return (
    <div className="row">
      <span className="label">{label}</span>
      <span className="opts" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            role="radio"
            aria-checked={value === v}
            className={value === v ? 'opt on' : 'opt'}
            onClick={() => onChange(v)}
          >
            {text}
          </button>
        ))}
      </span>
    </div>
  )
}
