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
- `space` start/stop, `/` focus the command line.
- Effects can be reordered, bypassed, reset and removed; the patch is saved in localStorage.

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
