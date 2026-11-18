import { FX, FX_TYPES, type FxType } from './audio/effects'
import { format, MASTER, parseValue, SOURCE, type ParamSpec, type Params } from './audio/params'
import type { Action, Patch } from './patch'

export type LogLine = { text: string; kind?: 'cmd' | 'err' | 'dim' }

type Env = {
  patch: Patch
  dispatch(a: Action): void
  toggle(on: boolean): void
}

const HELP = [
  'start | stop                      audio on/off (space)',
  'wave <sine|square|saw|tri|noise>',
  'freq <hz>                         e.g. freq 440, freq 1.2k',
  'add <type> [pos]                  ' + FX_TYPES.join(' '),
  'rm <n> | mv <n> <pos> | on <n> | off <n>',
  'set <src|out|n> <param> <value>   e.g. set 3 ratio 8',
  'ls                                chain and values',
  'reset | clear',
]

const out = (...lines: string[]): LogLine[] => lines.map((text) => ({ text }))
const err = (text: string): LogLine[] => [{ text, kind: 'err' }]

const pad = (n: number) => String(n).padStart(2, '0')

function describe(specs: ParamSpec[], p: Params) {
  return specs.map((s) => `${s.key}=${format(s, p[s.key])}`).join(' ')
}

function findSpec(specs: ParamSpec[], name: string) {
  const n = name.toLowerCase()
  return (
    specs.find((s) => s.key.toLowerCase() === n || s.label === n) ??
    specs.find((s) => s.key.toLowerCase().startsWith(n) || s.label.startsWith(n))
  )
}

export function runCommand(line: string, env: Env): LogLine[] {
  const [cmd, ...args] = line.trim().split(/\s+/)
  const { patch, dispatch } = env
  const chain = patch.chain

  const fxAt = (arg: string | undefined) => {
    const i = Number(arg) - 1
    return Number.isInteger(i) && chain[i] ? chain[i] : null
  }

  const setParam = (specs: ParamSpec[], name: string | undefined, value: string | undefined, apply: (key: string, v: number) => void) => {
    const spec = name && findSpec(specs, name)
    if (!spec) return err(`unknown param: ${name ?? ''} (${specs.map((s) => s.key).join(' ')})`)
    const v = value === undefined ? null : parseValue(spec, value)
    if (v === null) return err(`bad value for ${spec.key}: ${value ?? ''}`)
    apply(spec.key, v)
    return out(`${spec.key} = ${format(spec, v)}`)
  }

  switch (cmd?.toLowerCase()) {
    case undefined:
    case '':
      return []
    case 'help':
    case '?':
      return HELP.map((text) => ({ text, kind: 'dim' as const }))
    case 'start':
    case 'stop':
      env.toggle(cmd === 'start')
      return out(cmd === 'start' ? 'running' : 'stopped')
    case 'wave':
    case 'freq':
      return setParam(SOURCE, cmd, args[0], (key, v) => dispatch({ t: 'src', key, v }))
    case 'add': {
      const type = FX_TYPES.find((t) => t.startsWith(args[0]?.toLowerCase() ?? '-')) as FxType | undefined
      if (!type) return err(`unknown effect: ${args[0] ?? ''} (${FX_TYPES.join(' ')})`)
      const at = args[1] ? Math.max(0, Number(args[1]) - 1) : chain.length
      if (!Number.isFinite(at)) return err(`bad position: ${args[1]}`)
      dispatch({ t: 'add', type, at })
      return out(`added ${type} at ${pad(Math.min(at, chain.length) + 1)}`)
    }
    case 'rm':
    case 'on':
    case 'off': {
      const fx = fxAt(args[0])
      if (!fx) return err(`no effect at ${args[0] ?? ''}`)
      if (cmd === 'rm') dispatch({ t: 'remove', id: fx.id })
      else dispatch({ t: 'toggle', id: fx.id, on: cmd === 'on' })
      return out(`${fx.type} ${cmd === 'rm' ? 'removed' : cmd}`)
    }
    case 'mv': {
      const fx = fxAt(args[0])
      const to = Number(args[1]) - 1
      if (!fx) return err(`no effect at ${args[0] ?? ''}`)
      if (!Number.isInteger(to)) return err(`bad position: ${args[1] ?? ''}`)
      dispatch({ t: 'move', id: fx.id, to })
      return out(`${fx.type} → ${pad(Math.max(0, Math.min(chain.length - 1, to)) + 1)}`)
    }
    case 'set': {
      const [target, name, value] = args
      if (target === 'src') return setParam(SOURCE, name, value, (key, v) => dispatch({ t: 'src', key, v }))
      if (target === 'out' || target === 'master')
        return setParam(MASTER, name, value, (key, v) => dispatch({ t: 'master', key, v }))
      const fx = fxAt(target)
      if (!fx) return err(`no target: ${target ?? ''} (src, out or 1-${chain.length})`)
      return setParam(FX[fx.type].params, name, value, (key, v) => dispatch({ t: 'fx', id: fx.id, key, v }))
    }
    case 'ls':
      return out(
        `src  ${describe(SOURCE, patch.src)}`,
        ...chain.map((fx, i) => `${pad(i + 1)}   ${fx.type.padEnd(9)}${fx.on ? 'on ' : 'off'}  ${describe(FX[fx.type].params, fx.p)}`),
        `out  ${describe(MASTER, patch.master)}`,
      )
    case 'reset':
      dispatch({ t: 'reset' })
      return out('patch reset')
    default:
      return err(`command not found: ${cmd} (help)`)
  }
}
