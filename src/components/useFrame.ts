import { useEffect, useRef } from 'react'

/** Calls `fn` on every animation frame while mounted. */
export function useFrame(fn: () => void) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    let id = 0
    const loop = () => {
      ref.current()
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [])
}
