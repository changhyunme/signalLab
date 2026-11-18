import { useEffect, useRef, useState, type RefObject } from 'react'
import type { LogLine } from '../commands'

type Props = { log: LogLine[]; onRun(line: string): void; inputRef: RefObject<HTMLInputElement | null> }

export function Console({ log, onRun, inputRef }: Props) {
  const [line, setLine] = useState('')
  const history = useRef<string[]>([])
  const cursor = useRef(0)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  const recall = (step: number) => {
    const h = history.current
    if (!h.length) return
    cursor.current = Math.max(0, Math.min(h.length, cursor.current + step))
    setLine(h[cursor.current] ?? '')
  }

  return (
    <div className="console">
      {log.length > 0 && (
        <div className="log" ref={logRef} aria-live="polite">
          {log.map((l, i) => (
            <div key={i} className={l.kind}>
              {l.text}
            </div>
          ))}
        </div>
      )}
      <form
        className="prompt"
        onSubmit={(e) => {
          e.preventDefault()
          if (line.trim()) history.current.push(line)
          cursor.current = history.current.length
          onRun(line)
          setLine('')
        }}
      >
        <label htmlFor="cmd">
          <span className="accent">signal@lab</span>:~$
        </label>
        <input
          id="cmd"
          ref={inputRef}
          value={line}
          autoComplete="off"
          spellCheck={false}
          placeholder="help"
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              recall(-1)
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              recall(1)
            }
            if (e.key === 'Escape') inputRef.current?.blur()
          }}
        />
      </form>
    </div>
  )
}
