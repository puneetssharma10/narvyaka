import { useEffect, useRef, useState } from 'react'

/**
 * Keeps the typed answers in localStorage so a bad connection, a closed tab or
 * an accidental back button does not cost someone twenty minutes of typing.
 *
 * Only text is saved. Recordings and photographs are held in memory: writing
 * them here would blow the 5 MB quota and silently break the draft. The form
 * tells the contributor this rather than letting them assume otherwise.
 */

export interface AutosaveState<T> {
  value: T
  setValue: (updater: T | ((previous: T) => T)) => void
  savedAt: Date | null
  clear: () => void
  /** True when a draft was found and restored on load. */
  restored: boolean
}

export function useAutosave<T>(key: string, initial: T, version = 1): AutosaveState<T> {
  const [value, setValueInner] = useState<T>(initial)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [restored, setRestored] = useState(false)
  const timer = useRef<number | null>(null)
  const loaded = useRef(false)
  const skipNextWrite = useRef(false)
  const initialJson = useRef(JSON.stringify(initial))

  // Restore once, on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw) as { version?: number; savedAt?: string; data?: T }
        if (parsed?.data && parsed.version === version) {
          setValueInner({ ...initial, ...parsed.data })
          setSavedAt(parsed.savedAt ? new Date(parsed.savedAt) : null)
          setRestored(true)
        }
      }
    } catch {
      // A corrupt draft is not worth failing over — start fresh.
    }
    loaded.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Debounced write.
  useEffect(() => {
    if (!loaded.current) return

    // clear() resets the value, which re-runs this effect. Without this guard
    // an empty draft is written straight back after a successful submit, and
    // the contributor is told on their next visit that a draft is waiting.
    if (skipNextWrite.current) {
      skipNextWrite.current = false
      return
    }

    // An untouched form has no draft. Writing one would put "Draft saved" on
    // the screen before the contributor has typed a single character, which
    // says something untrue about what we are holding.
    if (JSON.stringify(value) === initialJson.current) return

    if (timer.current) window.clearTimeout(timer.current)

    timer.current = window.setTimeout(() => {
      try {
        const now = new Date()
        window.localStorage.setItem(key, JSON.stringify({ version, savedAt: now.toISOString(), data: value }))
        setSavedAt(now)
      } catch {
        // Quota exceeded. Not fatal: the answers are still on screen.
      }
    }, 600)

    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [key, value, version])

  const setValue = (updater: T | ((previous: T) => T)) => {
    setValueInner((previous) =>
      typeof updater === 'function' ? (updater as (p: T) => T)(previous) : updater,
    )
  }

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current)
    skipNextWrite.current = true
    window.localStorage.removeItem(key)
    setValueInner(initial)
    setSavedAt(null)
    setRestored(false)
  }

  return { value, setValue, savedAt, clear, restored }
}
