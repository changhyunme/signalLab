import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { FX, FX_TYPES } from './audio/effects'
import { engine } from './audio/engine'
import { MASTER, SOURCE } from './audio/params'
import { runCommand, type LogLine } from './commands'
import { Console } from './components/Console'
import { FxBlock } from './components/FxBlock'
import { Keys } from './components/Keys'
import { Meters } from './components/Meters'
import { Param } from './components/Param'
import { Scope } from './components/Scope'
import { loadPatch, reducer, savePatch } from './patch'

export default function App() {
  const [patch, dispatch] = useReducer(reducer, undefined, loadPatch)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<LogLine[]>([])
  const cmdRef = useRef<HTMLInputElement>(null)

  useEffect(() => savePatch(patch), [patch])
  useEffect(() => engine.setSource(patch.src), [patch.src])
  useEffect(() => engine.setMaster(patch.master), [patch.master])
  useEffect(() => engine.setChain(patch.chain), [patch.chain])

  const toggle = useCallback(async (on: boolean) => {
    if (on) await engine.start()
    else engine.stop()
    setRunning(engine.running)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input:not([type=range]), textarea, select')) return
      if (e.key === '/') {
        e.preventDefault()
        cmdRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const run = (line: string) => {
    if (line.trim() === 'clear') return setLog([])
    const result = runCommand(line, { patch, dispatch, toggle })
    setLog((l) => [...l, { text: `$ ${line}`, kind: 'cmd' as const }, ...result].slice(-200))
  }

  const active = patch.chain.filter((fx) => fx.on).length

  return (
    <div className="app">
      <header className="top">
        <span className="brand">signalLab</span>
        <span className="dim">{running && engine.ctx ? `${engine.ctx.sampleRate / 1000}kHz` : 'idle'}</span>
        <span className="dim">
          {active}/{patch.chain.length} fx
        </span>
        <span className="spacer" />
        <button className={running ? 'run on' : 'run'} onClick={() => toggle(!running)}>
          {running ? '■ stop' : '▶ start'}
        </button>
      </header>

      <div className="route" aria-label="signal path">
        <span className="on">src</span>
        {patch.chain.map((fx) => (
          <span key={fx.id} className={fx.on ? 'on' : 'off'}>
            <span className="arrow"> → </span>
            {fx.type}
          </span>
        ))}
        <span className="arrow"> → </span>
        <span className="on">out</span>
      </div>

      <main className="grid">
        <div className="col">
          <section className="box">
            <h2 className="title">source</h2>
            {SOURCE.map((spec) => (
              <Param key={spec.key} spec={spec} value={patch.src[spec.key]} onChange={(v) => dispatch({ t: 'src', key: spec.key, v })} />
            ))}
          </section>

          <section className="box">
            <h2 className="title">output</h2>
            {MASTER.map((spec) => (
              <Param key={spec.key} spec={spec} value={patch.master[spec.key]} onChange={(v) => dispatch({ t: 'master', key: spec.key, v })} />
            ))}
            <Meters />
          </section>

          <section className="box">
            <h2 className="title">scope</h2>
            <Scope mode="wave" />
            <Scope mode="fft" />
          </section>
        </div>

        <section className="box chain">
          <h2 className="title">chain</h2>
          {patch.chain.length === 0 && <p className="dim">empty</p>}
          {patch.chain.map((fx, i) => (
            <FxBlock key={fx.id} fx={fx} index={i} count={patch.chain.length} dispatch={dispatch} />
          ))}
          <div className="add">
            <span className="dim">+ add</span>
            {FX_TYPES.map((type) => (
              <button key={type} onClick={() => dispatch({ t: 'add', type })}>
                {FX[type].label}
              </button>
            ))}
          </div>
        </section>
      </main>

      <Keys src={patch.src} keys={patch.keys} dispatch={dispatch} start={() => toggle(true)} />

      <Console log={log} onRun={run} inputRef={cmdRef} />
    </div>
  )
}
