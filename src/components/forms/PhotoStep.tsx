import { useEffect, useRef, useState } from 'react'
import { Cropper, ensureCropperStyles } from '../../lib/cropper'
import { blobToDataUrl, fileIsImage, formatBytes, MAX_UPLOAD_BYTES, readAsDataUrl } from '../../lib/image'

export interface PhotoItem {
  id: string
  blob: Blob
  previewUrl: string
  caption: string
  /** Filled in after upload. */
  url?: string
}

interface Labels {
  heading: string
  intro: string
  dropLabel: string
  dropHint: string
  captionLabel: string
  captionPlaceholder: string
  removeLabel: string
  cropLabel: string
  maxReached: string
  tooLarge: string
  wrongType: string
}

interface Props {
  photos: PhotoItem[]
  onChange: (photos: PhotoItem[]) => void
  labels: Labels
  max?: number
}

export function PhotoStep({ photos, onChange, labels, max = 5 }: Props) {
  const [error, setError] = useState('')
  const [cropping, setCropping] = useState<PhotoItem | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => ensureCropperStyles(), [])

  const accept = async (files: FileList | File[]) => {
    setError('')
    const incoming = Array.from(files)
    const room = max - photos.length

    if (room <= 0) {
      setError(labels.maxReached)
      return
    }

    const next: PhotoItem[] = []
    for (const file of incoming.slice(0, room)) {
      if (!fileIsImage(file)) {
        setError(labels.wrongType)
        continue
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(labels.tooLarge)
        continue
      }
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        blob: file,
        previewUrl: URL.createObjectURL(file),
        caption: '',
      })
    }

    if (incoming.length > room) setError(labels.maxReached)
    if (next.length) onChange([...photos, ...next])
  }

  const remove = (id: string) => {
    const target = photos.find((photo) => photo.id === id)
    if (target) URL.revokeObjectURL(target.previewUrl)
    onChange(photos.filter((photo) => photo.id !== id))
  }

  const setCaption = (id: string, caption: string) => {
    onChange(photos.map((photo) => (photo.id === id ? { ...photo, caption } : photo)))
  }

  const applyCrop = (id: string, blob: Blob) => {
    onChange(
      photos.map((photo) => {
        if (photo.id !== id) return photo
        URL.revokeObjectURL(photo.previewUrl)
        return { ...photo, blob, previewUrl: URL.createObjectURL(blob) }
      }),
    )
  }

  return (
    <div className="grid gap-6">
      <div
        className={`rounded-[12px] border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? 'border-accent bg-accent-soft' : 'border-hairline bg-surface'
        }`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragOver(false)
          if (event.dataTransfer.files.length) void accept(event.dataTransfer.files)
        }}
      >
        <button type="button" className="btn btn-secondary" onClick={() => inputRef.current?.click()}>
          {labels.dropLabel}
        </button>
        <p className="hint mt-3">{labels.dropHint}</p>
        <p className="hint mt-1">
          {photos.length} of {max}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files?.length) void accept(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      {error && (
        <p className="text-[0.9rem] text-caution" role="alert">
          {error}
        </p>
      )}

      {photos.length > 0 && (
        <ul className="grid list-none gap-4 p-0">
          {photos.map((photo) => (
            <li key={photo.id} className="card flex flex-col gap-4 p-4 sm:flex-row">
              <img
                src={photo.previewUrl}
                alt=""
                className="h-28 w-28 shrink-0 rounded-[8px] object-cover"
              />
              <div className="flex-1">
                <label className="label" htmlFor={`caption-${photo.id}`}>
                  {labels.captionLabel}
                </label>
                <input
                  id={`caption-${photo.id}`}
                  className="field"
                  value={photo.caption}
                  placeholder={labels.captionPlaceholder}
                  onChange={(event) => setCaption(photo.id, event.target.value)}
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button type="button" className="btn btn-secondary" onClick={() => setCropping(photo)}>
                    {labels.cropLabel}
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => remove(photo.id)}>
                    {labels.removeLabel}
                  </button>
                  <span className="hint">{formatBytes(photo.blob.size)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cropping && (
        <CropDialog
          photo={cropping}
          onCancel={() => setCropping(null)}
          onSave={(blob) => {
            applyCrop(cropping.id, blob)
            setCropping(null)
          }}
        />
      )}
    </div>
  )
}

function CropDialog({
  photo,
  onSave,
  onCancel,
}: {
  photo: PhotoItem
  onSave: (blob: Blob) => void
  onCancel: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const cropperRef = useRef<Cropper | null>(null)
  const [aspect, setAspect] = useState<number | null>(4 / 3)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!hostRef.current) return
    const cropper = new Cropper(hostRef.current, { aspect: 4 / 3, maxEdge: 1800 })
    cropperRef.current = cropper

    let cancelled = false
    void (async () => {
      const dataUrl = await readAsDataUrl(new File([photo.blob], 'photo', { type: photo.blob.type }))
      if (cancelled) return
      await cropper.load(dataUrl)
      requestAnimationFrame(() => cropper.reset())
    })()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)

    return () => {
      cancelled = true
      document.removeEventListener('keydown', onKey)
      cropper.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id])

  const aspects: { label: string; value: number | null }[] = [
    { label: 'Original', value: null },
    { label: 'Square', value: 1 },
    { label: '4:3', value: 4 / 3 },
    { label: '3:2', value: 3 / 2 },
  ]

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/55 p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Crop photograph"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div className="grid w-full max-w-lg gap-4 rounded-[14px] bg-surface p-5">
        <h3 className="m-0 font-heading text-[1.2rem]">Crop this photograph</h3>

        <div className="flex flex-wrap gap-2">
          {aspects.map((option) => (
            <button
              key={option.label}
              type="button"
              className={`tag cursor-pointer ${aspect === option.value ? '' : 'bg-transparent text-muted ring-1 ring-hairline'}`}
              onClick={() => {
                setAspect(option.value)
                cropperRef.current?.setAspect(option.value)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div ref={hostRef} />

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const blob = await cropperRef.current!.toBlob()
                onSave(blob)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Saving…' : 'Save crop'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Used by the review step to show what will be sent. */
export async function photoPreviewDataUrl(photo: PhotoItem): Promise<string> {
  return blobToDataUrl(photo.blob)
}
