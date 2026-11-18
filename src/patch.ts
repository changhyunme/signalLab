import { FX, type FxType } from './audio/effects'
import { defaults, KEYS, MASTER, merge, PERC, SOURCE, type Params } from './audio/params'

export type FxState = { id: string; type: FxType; on: boolean; open: boolean; p: Params }
export type Patch = { src: Params; master: Params; keys: Params; perc: Params; chain: FxState[] }

export type Action =
  | { t: 'src' | 'master' | 'keys' | 'perc'; key: string; v: number }
  | { t: 'fx'; id: string; key: string; v: number }
  | { t: 'add'; type: FxType; at?: number }
  | { t: 'remove'; id: string }
  | { t: 'move'; id: string; to: number }
  | { t: 'toggle'; id: string; on?: boolean }
  | { t: 'fold'; id: string }
  | { t: 'resetFx'; id: string }
  | { t: 'reset' }

const KEY = 'signallab.patch'

const newId = () => Math.random().toString(36).slice(2, 8)

export function makeFx(type: FxType, on = true): FxState {
  return { id: newId(), type, on, open: true, p: defaults(FX[type].params) }
}

export function initialPatch(): Patch {
  return {
    src: defaults(SOURCE),
    master: defaults(MASTER),
    keys: defaults(KEYS),
    perc: defaults(PERC),
    chain: [makeFx('eq'), makeFx('drive', false), makeFx('comp'), makeFx('pingpong', false), makeFx('reverb')],
  }
}

const mapFx = (chain: FxState[], id: string, fn: (fx: FxState) => FxState) =>
  chain.map((fx) => (fx.id === id ? fn(fx) : fx))

export function reducer(state: Patch, a: Action): Patch {
  switch (a.t) {
    case 'src':
    case 'master':
    case 'keys':
    case 'perc':
      return { ...state, [a.t]: { ...state[a.t], [a.key]: a.v } }
    case 'fx':
      return { ...state, chain: mapFx(state.chain, a.id, (fx) => ({ ...fx, p: { ...fx.p, [a.key]: a.v } })) }
    case 'add': {
      const chain = [...state.chain]
      chain.splice(a.at ?? chain.length, 0, makeFx(a.type))
      return { ...state, chain }
    }
    case 'remove':
      return { ...state, chain: state.chain.filter((fx) => fx.id !== a.id) }
    case 'move': {
      const from = state.chain.findIndex((fx) => fx.id === a.id)
      const to = Math.max(0, Math.min(state.chain.length - 1, a.to))
      if (from < 0 || from === to) return state
      const chain = [...state.chain]
      chain.splice(to, 0, ...chain.splice(from, 1))
      return { ...state, chain }
    }
    case 'toggle':
      return { ...state, chain: mapFx(state.chain, a.id, (fx) => ({ ...fx, on: a.on ?? !fx.on })) }
    case 'fold':
      return { ...state, chain: mapFx(state.chain, a.id, (fx) => ({ ...fx, open: !fx.open })) }
    case 'resetFx':
      return { ...state, chain: mapFx(state.chain, a.id, (fx) => ({ ...fx, p: defaults(FX[fx.type].params) })) }
    case 'reset':
      return initialPatch()
  }
}

export function loadPatch(): Patch {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!raw) return initialPatch()
    const chain: FxState[] = (Array.isArray(raw.chain) ? raw.chain : [])
      .filter((fx: FxState) => fx && fx.type in FX)
      .map((fx: FxState) => ({
        id: String(fx.id || newId()),
        type: fx.type,
        on: fx.on !== false,
        open: fx.open !== false,
        p: merge(FX[fx.type].params, fx.p),
      }))
    return { src: merge(SOURCE, raw.src), master: merge(MASTER, raw.master), keys: merge(KEYS, raw.keys), perc: merge(PERC, raw.perc), chain }
  } catch {
    return initialPatch()
  }
}

export function savePatch(patch: Patch) {
  try {
    localStorage.setItem(KEY, JSON.stringify(patch))
  } catch {
    // Storage can be unavailable (private mode); the patch just won't persist.
  }
}
