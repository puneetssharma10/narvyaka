import { useEffect, useRef, useState } from 'react'

/**
 * Records one answer in the contributor's own voice.
 *
 * Audio is the primary record (Master Reference Part III.1), so recording is
 * offered alongside every question that gets played back — but typing is never
 * second-class, and a browser that cannot record says so plainly instead of
 * showing a broken button.
 */

export interface Recording {
  blob: Blob
  url: string
  seconds: number
  mimeType: string
}

interface Props {
  recording: Recording | null
  onChange: (recording: Recording | null) => void
  labels: {
    recordStart: string
    recordStop: string
    recordAgain: string
    recordDelete: string
    recordUnsupported: string
    recordPermission: string
  }
}

type State = 'idle' | 'recording' | 'denied' | 'unsupported'

export function VoiceRecorder({ recording, onChange, labels }: Props) {
  const [state, setState] = useState<State>('idle')
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('unsupported')
    }
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      recorderRef.current?.stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        stream.getTracks().forEach((track) => track.stop())
        if (timerRef.current) window.clearInterval(timerRef.current)

        // Replacing a recording releases the previous object URL.
        if (recording?.url) URL.revokeObjectURL(recording.url)

        onChange({
          blob,
          url: URL.createObjectURL(blob),
          seconds: Math.round((Date.now() - startedAtRef.current) / 1000),
          mimeType: type,
        })
        setState('idle')
        setElapsed(0)
      }

      recorderRef.current = recorder
      startedAtRef.current = Date.now()
      recorder.start()
      setState('recording')

      timerRef.current = window.setInterval(() => {
        setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000))
      }, 250)
    } catch {
      setState('denied')
    }
  }

  const stop = () => recorderRef.current?.stop()

  if (state === 'unsupported') {
    return <p className="hint">{labels.recordUnsupported}</p>
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {state === 'recording' ? (
        <button type="button" className="btn btn-primary" onClick={stop}>
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-[2px] bg-white" aria-hidden="true" />
          {labels.recordStop} · {formatSeconds(elapsed)}
        </button>
      ) : (
        <button type="button" className="btn btn-secondary" onClick={() => void start()}>
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-caution" aria-hidden="true" />
          {recording ? labels.recordAgain : labels.recordStart}
        </button>
      )}

      {recording && (
        <>
          <audio src={recording.url} controls className="h-9 max-w-[240px]" />
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              URL.revokeObjectURL(recording.url)
              onChange(null)
            }}
          >
            {labels.recordDelete}
          </button>
        </>
      )}

      {state === 'denied' && <p className="hint m-0 basis-full">{labels.recordPermission}</p>}
    </div>
  )
}

function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type))
}

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
