# signalLab

Web Audio API signal chain in a terminal-style UI. React + Vite.

```
osc / noise → gate → level → [eq · filter · comp · drive · delay · pingpong · reverb · pan] → master → limiter → out
```

```sh
npm install
npm run dev
```

## Controls

- Drag a `[####....]` bar to change a value, double-click it to reset, click the number to type one (`1.2k`, `350ms`, `30%`, `L40`).
- `/` focuses the command line; start/stop is the button at the top (playing a key also starts audio).

## Keys

Click the `keys` panel title (or right-click the panel) to pick a mapping. A4 is 438–448 Hz (default 440).

**notes / piano**

| input | action |
|---|---|
| notes: `c d e f g a b` | play while held |
| piano: `a`–`l` white, `w e t y u o p` black | play while held (C to D an octave up) |
| `↑` / `↓` held | semitone up / down |
| `←` / `→` | octave down / up (one step per press) |
| `shift` + note | major triad (`↑` aug, `↓` minor, `option`/`alt` dim) |
| `space` held | hold: releasing a key keeps the note; the next key replaces it |

**trumpet** (Bb, natural partials)

| input | action |
|---|---|
| `d s a` / `j k l` | valves 1 2 3 (−2, −1, −3 semitones), mirrored for left and right hand; sound while pressed |
| `space` held | blow the open note |
| `←` / `→` | partial down / up (2–8) |
| `↑` / `↓` held | bend up / down, back to pitch on release |

## Percussion

Oscillators only, mixed into the effect chain. `z` kick (swept sine), `x` snare (triangle body + inharmonic squares), `v` hi-hat (six-square metallic cluster). Hitting a pad selects it for editing tune/tone, decay, snap and level.

## Commands

```
start | stop
wave <sine|square|saw|tri|noise>
freq <hz>
add <type> [pos]
rm <n> | mv <n> <pos> | on <n> | off <n>
set <src|out|n> <param> <value>
ls | reset | clear | help
```
