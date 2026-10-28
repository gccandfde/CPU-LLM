import { useEffect, useRef, useState } from 'react'

// Tiny hash router: "#/runs/abc" -> { tab: 'runs', parts: ['abc'] }
function parse() {
  const [tab = 'overview', ...parts] = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  return { tab, parts }
}

export function useHashRoute() {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const onChange = () => setRoute(parse())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export const go = (path) => { window.location.hash = `/${path}` }

// Calls fn now and then every `ms` (until `active` is false). Returns {data, error, reload}.
export function usePoll(fn, ms, deps = [], active = true) {
  const [state, setState] = useState({ data: null, error: null })
  const fnRef = useRef(fn)
  fnRef.current = fn
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let stop = false, timer
    const run = async () => {
      try {
        const data = await fnRef.current()
        if (!stop) setState({ data, error: null })
      } catch (e) {
        if (!stop) setState((s) => ({ ...s, error: e.message }))
      }
      if (!stop && active && ms) timer = setTimeout(run, ms)
    }
    run()
    return () => { stop = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, active, tick])
  return { ...state, reload: () => setTick((t) => t + 1) }
}
