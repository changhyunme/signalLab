import { dbToGain, type ParamSpec, type Params } from './params'

export type FxModule = {
  input: AudioNode
  output: AudioNode
  set(p: Params): void
  dispose(): void
  /** Gain reduction in dB, for effects that report one. */
  meter?(): number
}

export type FxDef = {
  label: string
  params: ParamSpec[]
  create(ctx: AudioContext): FxModule
}

const glider = (ctx: BaseAudioContext) => (param: AudioParam, v: number) =>
  param.setTargetAtTime(v, ctx.currentTime, 0.015)

const drop = (nodes: AudioNode[]) => nodes.forEach((n) => n.disconnect())

/** input → dry → output, and a wet bus the effect feeds; mix is equal-power. */
function wetDry(ctx: AudioContext) {
  const input = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const output = ctx.createGain()
  input.connect(dry).connect(output)
  wet.connect(output)
  const to = glider(ctx)
  return {
    input,
    wet,
    output,
    nodes: [input, dry, wet, output] as AudioNode[],
    mix(m: number) {
      to(dry.gain, Math.cos((m * Math.PI) / 2))
      to(wet.gain, Math.sin((m * Math.PI) / 2))
    },
  }
}

function lowpass(ctx: AudioContext) {
  const f = ctx.createBiquadFilter()
  f.type = 'lowpass'
  f.Q.value = 0.5
  return f
}

const mix: ParamSpec = { key: 'mix', label: 'mix', min: 0, max: 1, value: 0.3, unit: '%', step: 0.01 }
const tone = (value: number): ParamSpec => ({ key: 'tone', label: 'tone', min: 500, max: 18000, value, unit: 'Hz', log: true })

function shaperCurve(mode: number, amount: number) {
  const n = 2048
  const curve = new Float32Array(n)
  const k = 1 + amount / 5
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1
    curve[i] =
      mode === 0
        ? Math.tanh(x * k) / Math.tanh(k)
        : mode === 1
          ? Math.max(-1, Math.min(1, x * k))
          : Math.sin(((x * k) / 2) * Math.PI)
  }
  return curve
}

function impulse(ctx: BaseAudioContext, seconds: number) {
  const rate = ctx.sampleRate
  const length = Math.max(1, Math.floor(rate * seconds))
  const buffer = ctx.createBuffer(2, length, rate)
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c)
    // Noise with an exponential decay that reaches -60 dB at the end (RT60).
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp((-6.9 * i) / length)
  }
  return buffer
}

export const FX = {
  eq: {
    label: 'eq',
    params: [
      { key: 'low', label: 'low', min: -18, max: 18, value: 0, unit: 'dB', step: 0.1 },
      { key: 'lowFreq', label: 'low f', min: 30, max: 500, value: 120, unit: 'Hz', log: true },
      { key: 'mid', label: 'mid', min: -18, max: 18, value: 0, unit: 'dB', step: 0.1 },
      { key: 'midFreq', label: 'mid f', min: 150, max: 8000, value: 1000, unit: 'Hz', log: true },
      { key: 'q', label: 'mid q', min: 0.2, max: 12, value: 1, log: true },
      { key: 'high', label: 'high', min: -18, max: 18, value: 0, unit: 'dB', step: 0.1 },
      { key: 'highFreq', label: 'high f', min: 2000, max: 16000, value: 8000, unit: 'Hz', log: true },
    ],
    create(ctx) {
      const to = glider(ctx)
      const low = ctx.createBiquadFilter()
      const mid = ctx.createBiquadFilter()
      const high = ctx.createBiquadFilter()
      const output = ctx.createGain()
      low.type = 'lowshelf'
      mid.type = 'peaking'
      high.type = 'highshelf'
      low.connect(mid).connect(high).connect(output)
      return {
        input: low,
        output,
        set(p) {
          to(low.gain, p.low)
          to(low.frequency, p.lowFreq)
          to(mid.gain, p.mid)
          to(mid.frequency, p.midFreq)
          to(mid.Q, p.q)
          to(high.gain, p.high)
          to(high.frequency, p.highFreq)
        },
        dispose: () => drop([low, mid, high, output]),
      }
    },
  },

  filter: {
    label: 'filter',
    params: [
      { key: 'mode', label: 'mode', options: ['lowpass', 'highpass', 'bandpass', 'notch'], value: 0 },
      { key: 'cutoff', label: 'cutoff', min: 20, max: 20000, value: 2000, unit: 'Hz', log: true },
      { key: 'q', label: 'reso', min: 0.1, max: 20, value: 0.7, log: true },
    ],
    create(ctx) {
      const to = glider(ctx)
      const filter = ctx.createBiquadFilter()
      const output = ctx.createGain()
      const modes: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch']
      filter.connect(output)
      return {
        input: filter,
        output,
        set(p) {
          filter.type = modes[p.mode]
          to(filter.frequency, p.cutoff)
          to(filter.Q, p.q)
        },
        dispose: () => drop([filter, output]),
      }
    },
  },

  comp: {
    label: 'comp',
    params: [
      { key: 'threshold', label: 'thresh', min: -60, max: 0, value: -24, unit: 'dB', step: 0.1 },
      { key: 'ratio', label: 'ratio', min: 1, max: 20, value: 4, unit: 'ratio', step: 0.1 },
      { key: 'knee', label: 'knee', min: 0, max: 40, value: 6, unit: 'dB', step: 0.1 },
      { key: 'attack', label: 'attack', min: 0.001, max: 1, value: 0.01, unit: 's', log: true },
      { key: 'release', label: 'release', min: 0.01, max: 1, value: 0.2, unit: 's', log: true },
      { key: 'makeup', label: 'makeup', min: 0, max: 24, value: 0, unit: 'dB', step: 0.1 },
    ],
    create(ctx) {
      const to = glider(ctx)
      const comp = ctx.createDynamicsCompressor()
      const output = ctx.createGain()
      comp.connect(output)
      return {
        input: comp,
        output,
        set(p) {
          to(comp.threshold, p.threshold)
          to(comp.ratio, p.ratio)
          to(comp.knee, p.knee)
          to(comp.attack, p.attack)
          to(comp.release, p.release)
          to(output.gain, dbToGain(p.makeup))
        },
        meter: () => comp.reduction,
        dispose: () => drop([comp, output]),
      }
    },
  },

  drive: {
    label: 'drive',
    params: [
      { key: 'mode', label: 'mode', options: ['soft', 'hard', 'fold'], value: 0 },
      { key: 'amount', label: 'drive', min: 0, max: 100, value: 20, step: 1 },
      tone(8000),
      { ...mix, value: 1 },
      { key: 'out', label: 'output', min: -24, max: 12, value: -6, unit: 'dB', step: 0.1 },
    ],
    create(ctx) {
      const to = glider(ctx)
      const m = wetDry(ctx)
      const shaper = ctx.createWaveShaper()
      const filter = lowpass(ctx)
      const out = ctx.createGain()
      shaper.oversample = '4x'
      m.input.connect(shaper).connect(filter).connect(m.wet)
      m.output.connect(out)
      let shape = ''
      return {
        input: m.input,
        output: out,
        set(p) {
          const next = `${p.mode}:${p.amount}`
          if (next !== shape) {
            shape = next
            shaper.curve = shaperCurve(p.mode, p.amount)
          }
          to(filter.frequency, p.tone)
          m.mix(p.mix)
          to(out.gain, dbToGain(p.out))
        },
        dispose: () => drop([...m.nodes, shaper, filter, out]),
      }
    },
  },

  delay: {
    label: 'delay',
    params: [
      { key: 'time', label: 'time', min: 0.01, max: 2, value: 0.35, unit: 's', log: true },
      { key: 'feedback', label: 'feedback', min: 0, max: 0.95, value: 0.35, unit: '%', step: 0.01 },
      tone(6000),
      mix,
    ],
    create(ctx) {
      const to = glider(ctx)
      const m = wetDry(ctx)
      const delay = ctx.createDelay(2)
      const filter = lowpass(ctx)
      const fb = ctx.createGain()
      m.input.connect(delay).connect(filter)
      filter.connect(fb).connect(delay)
      filter.connect(m.wet)
      return {
        input: m.input,
        output: m.output,
        set(p) {
          to(delay.delayTime, p.time)
          to(fb.gain, p.feedback)
          to(filter.frequency, p.tone)
          m.mix(p.mix)
        },
        dispose: () => drop([...m.nodes, delay, filter, fb]),
      }
    },
  },

  pingpong: {
    label: 'pingpong',
    params: [
      { key: 'time', label: 'time', min: 0.02, max: 1.5, value: 0.25, unit: 's', log: true },
      { key: 'feedback', label: 'feedback', min: 0, max: 0.95, value: 0.45, unit: '%', step: 0.01 },
      tone(5000),
      { ...mix, value: 0.35 },
    ],
    create(ctx) {
      const to = glider(ctx)
      const m = wetDry(ctx)
      // Mono in, then L → R → (feedback) → L, so echoes alternate sides.
      const mono = ctx.createGain()
      mono.channelCount = 1
      mono.channelCountMode = 'explicit'
      const left = ctx.createDelay(1.5)
      const right = ctx.createDelay(1.5)
      const filter = lowpass(ctx)
      const fb = ctx.createGain()
      const merger = ctx.createChannelMerger(2)
      m.input.connect(mono).connect(left)
      left.connect(right)
      right.connect(filter).connect(fb).connect(left)
      left.connect(merger, 0, 0)
      right.connect(merger, 0, 1)
      merger.connect(m.wet)
      return {
        input: m.input,
        output: m.output,
        set(p) {
          to(left.delayTime, p.time)
          to(right.delayTime, p.time)
          to(fb.gain, p.feedback)
          to(filter.frequency, p.tone)
          m.mix(p.mix)
        },
        dispose: () => drop([...m.nodes, mono, left, right, filter, fb, merger]),
      }
    },
  },

  reverb: {
    label: 'reverb',
    params: [
      { key: 'decay', label: 'decay', min: 0.2, max: 10, value: 2.5, unit: 's', log: true },
      { key: 'pre', label: 'predelay', min: 0, max: 0.25, value: 0.02, unit: 's', step: 0.001 },
      tone(9000),
      mix,
    ],
    create(ctx) {
      const to = glider(ctx)
      const m = wetDry(ctx)
      const pre = ctx.createDelay(0.5)
      const conv = ctx.createConvolver()
      const filter = lowpass(ctx)
      m.input.connect(pre).connect(conv).connect(filter).connect(m.wet)
      let decay = 0
      let timer = 0
      return {
        input: m.input,
        output: m.output,
        set(p) {
          if (p.decay !== decay) {
            const first = decay === 0
            decay = p.decay
            clearTimeout(timer)
            // Rebuilding the impulse is costly, so wait until the control settles.
            const build = () => (conv.buffer = impulse(ctx, decay))
            if (first) build()
            else timer = window.setTimeout(build, 120)
          }
          to(pre.delayTime, p.pre)
          to(filter.frequency, p.tone)
          m.mix(p.mix)
        },
        dispose() {
          clearTimeout(timer)
          drop([...m.nodes, pre, conv, filter])
        },
      }
    },
  },

  pan: {
    label: 'pan',
    params: [
      { key: 'pan', label: 'pan', min: -1, max: 1, value: 0, unit: 'pan', step: 0.01 },
      { key: 'shape', label: 'lfo', options: ['sine', 'triangle', 'square'], value: 0 },
      { key: 'rate', label: 'rate', min: 0.05, max: 12, value: 1, unit: 'Hz', log: true },
      { key: 'depth', label: 'depth', min: 0, max: 1, value: 0, unit: '%', step: 0.01 },
    ],
    create(ctx) {
      const to = glider(ctx)
      const panner = ctx.createStereoPanner()
      const lfo = ctx.createOscillator()
      const depth = ctx.createGain()
      const output = ctx.createGain()
      const shapes: OscillatorType[] = ['sine', 'triangle', 'square']
      lfo.connect(depth).connect(panner.pan)
      panner.connect(output)
      lfo.start()
      return {
        input: panner,
        output,
        set(p) {
          to(panner.pan, p.pan)
          lfo.type = shapes[p.shape]
          to(lfo.frequency, p.rate)
          to(depth.gain, p.depth)
        },
        dispose() {
          lfo.stop()
          drop([lfo, depth, panner, output])
        },
      }
    },
  },
} satisfies Record<string, FxDef>

export type FxType = keyof typeof FX
export const FX_TYPES = Object.keys(FX) as FxType[]
