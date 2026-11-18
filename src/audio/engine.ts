import { FX, type FxModule, type FxType } from './effects'
import { dbToGain, defaults, MASTER, SOURCE, type Drum, type Params } from './params'

export type ChainItem = { id: string; type: FxType; on: boolean; p: Params }

const WAVES: OscillatorType[] = ['sine', 'square', 'sawtooth', 'triangle']
const LOOKAHEAD = 0.12
/** Oscillator voices: one for single notes, up to three for triads. */
const VOICES = 3

type Nodes = {
  oscs: OscillatorNode[]
  voices: GainNode[]
  oscGain: GainNode
  noiseGain: GainNode
  amp: GainNode
  level: GainNode
  head: GainNode
  master: GainNode
  limiter: DynamicsCompressorNode
  out: GainNode
  left: AnalyserNode
  right: AnalyserNode
}

/**
 * oscs (1–3 voices) / noise → gate → level ┐
 *                       percussion hits ──┴→ head → [effects…] → master → limiter → out
 * The graph is built on the first start (browsers need a user gesture).
 */
class Engine {
  ctx: AudioContext | null = null
  analyser: AnalyserNode | null = null
  running = false

  private n!: Nodes
  private mods = new Map<string, { type: FxType; mod: FxModule }>()
  private route = ''
  private src: Params = defaults(SOURCE)
  private master: Params = defaults(MASTER)
  private chain: ChainItem[] = []
  private gate = -1
  private held = false
  private chord: number[] = [0]
  private bend = 0
  private next = 0
  private timer = 0
  private buf = new Float32Array(1024)

  private build() {
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    const oscs = Array.from({ length: VOICES }, () => ctx.createOscillator())
    const noise = ctx.createBufferSource()
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    noise.buffer = noiseBuf
    noise.loop = true

    const n: Nodes = {
      oscs,
      voices: oscs.map(() => ctx.createGain()),
      oscGain: ctx.createGain(),
      noiseGain: ctx.createGain(),
      amp: ctx.createGain(),
      level: ctx.createGain(),
      head: ctx.createGain(),
      master: ctx.createGain(),
      limiter: ctx.createDynamicsCompressor(),
      out: ctx.createGain(),
      left: ctx.createAnalyser(),
      right: ctx.createAnalyser(),
    }
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 4096
    analyser.smoothingTimeConstant = 0.75
    n.left.fftSize = n.right.fftSize = 1024
    const split = ctx.createChannelSplitter(2)

    oscs.forEach((osc, i) => osc.connect(n.voices[i]).connect(n.oscGain))
    n.oscGain.connect(n.amp)
    noise.connect(n.noiseGain).connect(n.amp)
    n.amp.connect(n.level).connect(n.head)
    n.master.connect(n.limiter)
    n.limiter.connect(analyser)
    n.limiter.connect(split)
    split.connect(n.left, 0)
    split.connect(n.right, 1)
    n.limiter.connect(n.out).connect(ctx.destination)
    n.out.gain.value = 0
    oscs.forEach((osc) => osc.start())
    noise.start()

    this.ctx = ctx
    this.analyser = analyser
    this.n = n
    this.applySource()
    this.applyMaster()
    this.applyChain(true)
  }

  async start() {
    if (!this.ctx) this.build()
    const ctx = this.ctx!
    await ctx.resume()
    this.running = true
    this.n.out.gain.cancelScheduledValues(ctx.currentTime)
    this.n.out.gain.setTargetAtTime(1, ctx.currentTime, 0.01)
    this.gate = -1
    this.applySource()
    clearInterval(this.timer)
    this.timer = window.setInterval(this.tick, 25)
  }

  stop() {
    const ctx = this.ctx
    if (!ctx) return
    this.running = false
    clearInterval(this.timer)
    this.n.out.gain.setTargetAtTime(0, ctx.currentTime, 0.01)
    setTimeout(() => !this.running && ctx.suspend(), 80)
  }

  setSource(p: Params) {
    this.src = p
    this.applySource()
  }

  setMaster(p: Params) {
    this.master = p
    this.applyMaster()
  }

  setChain(chain: ChainItem[]) {
    this.chain = chain
    this.applyChain()
  }

  /** Peak level per channel, linear. */
  peaks(): [number, number] {
    if (!this.ctx || !this.running) return [0, 0]
    return [this.peak(this.n.left), this.peak(this.n.right)]
  }

  reduction(id: string): number {
    return this.running ? (this.mods.get(id)?.mod.meter?.() ?? 0) : 0
  }

  private peak(a: AnalyserNode) {
    a.getFloatTimeDomainData(this.buf)
    let max = 0
    for (const v of this.buf) max = Math.max(max, Math.abs(v))
    return max
  }

  private to(param: AudioParam, v: number, tc = 0.015) {
    param.setTargetAtTime(v, this.ctx!.currentTime, tc)
  }

  private applySource() {
    const ctx = this.ctx
    if (!ctx) return
    const { oscs, voices, oscGain, noiseGain, level, amp } = this.n
    const s = this.src
    const noise = s.wave === 4
    // Voices share the level so a triad is about as loud as a single note.
    const share = 1 / Math.sqrt(this.chord.length)
    oscs.forEach((osc, i) => {
      if (!noise && osc.type !== WAVES[s.wave]) osc.type = WAVES[s.wave]
      const interval = this.chord[i]
      this.to(voices[i].gain, interval === undefined ? 0 : share, 0.005)
      if (interval !== undefined) this.to(osc.frequency, s.freq * 2 ** (interval / 12), 0.01)
      this.to(osc.detune, s.detune + this.bend, 0.01)
    })
    this.to(oscGain.gain, noise ? 0 : 1, 0.005)
    this.to(noiseGain.gain, noise ? 1 : 0, 0.005)
    this.to(level.gain, dbToGain(s.level))
    if (s.gate !== this.gate) {
      this.gate = s.gate
      const now = ctx.currentTime
      amp.gain.cancelScheduledValues(now)
      amp.gain.setTargetAtTime(s.gate === 0 || (s.gate === 2 && this.held) ? 1 : 0, now, 0.005)
      this.next = now + 0.03
    }
  }

  /** Semitone offsets from the root, e.g. [0, 4, 7] for a major triad. */
  setChord(intervals: number[]) {
    this.chord = intervals.slice(0, VOICES)
    this.applySource()
  }

  /** Pitch bend in cents on top of the source detune. */
  setBend(cents: number, tc = 0.02) {
    this.bend = cents
    if (!this.ctx) return
    for (const osc of this.n.oscs) this.to(osc.detune, this.src.detune + cents, tc)
  }

  /**
   * One-shot percussion built from oscillators only: a pitch-swept sine kick,
   * a triangle body plus inharmonic squares for the snare, and the six-square
   * metallic cluster (as on analog drum machines) for the hi-hat.
   */
  hit(drum: Drum, p: Params) {
    const ctx = this.ctx
    if (!ctx || !this.running) return
    const t = ctx.currentTime + 0.005
    const out = ctx.createGain()
    const nodes: AudioNode[] = [out]
    const oscs: OscillatorNode[] = []
    const tone = (type: OscillatorType, freq: number) => {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = freq
      oscs.push(o)
      nodes.push(o)
      return o
    }
    const env = (peak: number, decay: number) => {
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.002)
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
      nodes.push(g)
      return g
    }
    const filter = (type: BiquadFilterType, freq: number, q = 0.7) => {
      const f = ctx.createBiquadFilter()
      f.type = type
      f.frequency.value = freq
      f.Q.value = q
      nodes.push(f)
      return f
    }
    /** Sums square waves at the given multiples of `base`, scaled to unit level. */
    const cluster = (base: number, ratios: number[]) => {
      const mix = ctx.createGain()
      mix.gain.value = 1 / ratios.length
      nodes.push(mix)
      for (const r of ratios) tone('square', base * r).connect(mix)
      return mix
    }

    let length: number
    if (drum === 'kick') {
      const body = tone('sine', p.kickTune * 3.5)
      body.frequency.setValueAtTime(p.kickTune * 3.5, t)
      body.frequency.exponentialRampToValueAtTime(p.kickTune, t + 0.07)
      body.connect(env(1, p.kickDecay)).connect(out)
      tone('triangle', 1800).connect(env(0.25, 0.012)).connect(out)
      out.gain.value = dbToGain(p.kickLevel)
      length = p.kickDecay
    } else if (drum === 'snare') {
      const body = tone('triangle', p.snareTune * 1.4)
      body.frequency.setValueAtTime(p.snareTune * 1.4, t)
      body.frequency.exponentialRampToValueAtTime(p.snareTune, t + 0.03)
      body.connect(env(1 - p.snareSnap * 0.5, p.snareDecay * 0.6)).connect(out)
      cluster(p.snareTune, [4.3, 5.7, 7.1, 8.9, 10.3, 12.7])
        .connect(filter('highpass', 1800))
        .connect(env(p.snareSnap * 1.6, p.snareDecay))
        .connect(out)
      out.gain.value = dbToGain(p.snareLevel)
      length = p.snareDecay
    } else {
      cluster(p.hatTone, [2, 3, 4.16, 5.43, 6.79, 8.21])
        .connect(filter('bandpass', 10000, 1))
        .connect(filter('highpass', 7000))
        .connect(env(2.5, p.hatDecay))
        .connect(out)
      out.gain.value = dbToGain(p.hatLevel)
      length = p.hatDecay
    }

    out.connect(this.n.head)
    for (const o of oscs) {
      o.start(t)
      o.stop(t + length + 0.05)
    }
    oscs[0].onended = () => nodes.forEach((node) => node.disconnect())
  }

  /** Opens or closes the gate in key mode (note on / off). */
  hold(on: boolean) {
    this.held = on
    const ctx = this.ctx
    if (!ctx || this.gate !== 2) return
    this.n.amp.gain.cancelScheduledValues(ctx.currentTime)
    this.n.amp.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, on ? 0.003 : 0.02)
  }

  /** Schedules pulse-gate envelopes slightly ahead of the audio clock. */
  private tick = () => {
    const ctx = this.ctx
    if (!ctx || !this.running || this.gate !== 1) return
    const period = 1 / this.src.rate
    const on = period * this.src.duty
    const g = this.n.amp.gain
    if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.02
    while (this.next < ctx.currentTime + LOOKAHEAD) {
      g.setTargetAtTime(1, this.next, 0.002)
      g.setTargetAtTime(0, this.next + on, 0.01)
      this.next += period
    }
  }

  private applyMaster() {
    if (!this.ctx) return
    const { master, limiter } = this.n
    const on = this.master.limit === 0
    this.to(master.gain, dbToGain(this.master.vol))
    limiter.threshold.value = on ? -1 : 0
    limiter.ratio.value = on ? 20 : 1
    limiter.knee.value = 0
    limiter.attack.value = 0.002
    limiter.release.value = 0.1
  }

  private applyChain(force = false) {
    const ctx = this.ctx
    if (!ctx) return
    const ids = new Set(this.chain.map((c) => c.id))
    for (const [id, m] of this.mods) {
      if (ids.has(id)) continue
      m.mod.dispose()
      this.mods.delete(id)
      force = true
    }
    for (const c of this.chain) {
      let m = this.mods.get(c.id)
      if (!m || m.type !== c.type) {
        m?.mod.dispose()
        m = { type: c.type, mod: FX[c.type].create(ctx) }
        this.mods.set(c.id, m)
        force = true
      }
      m.mod.set(c.p)
    }

    const route = this.chain.filter((c) => c.on).map((c) => c.id).join()
    if (!force && route === this.route) return
    this.route = route
    this.n.head.disconnect()
    for (const m of this.mods.values()) m.mod.output.disconnect()
    let tail: AudioNode = this.n.head
    for (const c of this.chain) {
      if (!c.on) continue
      const { mod } = this.mods.get(c.id)!
      tail.connect(mod.input)
      tail = mod.output
    }
    tail.connect(this.n.master)
  }
}

export const engine = new Engine()
