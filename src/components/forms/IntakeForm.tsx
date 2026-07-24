import { useMemo, useState } from 'react'
import { Alert, Checkbox, Field, RadioCard, TextArea, TextInput } from './fields'
import { VoiceRecorder, type Recording } from './VoiceRecorder'
import { PhotoStep, type PhotoItem } from './PhotoStep'
import { useAutosave } from './useAutosave'
import { ApiError, downloadBackup, extensionFor, submitJson, uploadFile, type SubmitResult } from './api'
import { newId } from '../../../shared/record-schema'

/* ── Types ───────────────────────────────────────────────────────────────── */

interface Question {
  id: string
  label: string
  hint?: string
  placeholder?: string
  voice?: boolean
  required?: boolean
}

interface AccessLevelOption {
  value: string
  title: string
  body: string
}

export interface IntakeCopy {
  common: Record<string, string>
  steps: { id: string; title: string; short: string }[]
  consent: {
    heading: string
    intro: string
    points: { title: string; body: string }[]
    checkReview: string
    checkAge: string
    ageWhy: string
    exceptionHeading: string
    exceptionBody: string
    exceptionPlaceholder: string
    consentRequiredError: string
  }
  about: Record<string, string>
  record: { heading: string; intro: string; questions: Question[]; progressLabel: string }
  lineage: {
    heading: string
    question: string
    hint: string
    placeholder: string
    disclaimer: string
    addGeneration: string
    removeGeneration: string
    fields: Record<string, string>
    relations: string[]
  }
  photos: {
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
  review: {
    heading: string
    accessHeading: string
    accessIntro: string
    levels: AccessLevelOption[]
    releaseDateLabel: string
    previewHeading: string
    previewIntro: string
    editStep: string
    emptyValue: string
    finalNote: string
    submit: string
  }
  onBehalf: Record<string, string>
  afterSubmit: { heading: string; body: string; reference: string }
}

interface Props {
  mode: 'self' | 'on_behalf'
  copy: IntakeCopy
  endpoints: { submissions: string; uploads: string }
  storageKey: string
}

interface Draft {
  consent: { review: boolean; age: boolean; exception: string }
  contributor: {
    name: string
    anonymous: boolean
    preferred_name: string
    location: string
    profession: string
    languages: string
    record_language: string
    contact: string
  }
  answers: Record<string, string>
  lineage: {
    summary: string
    generations: { name: string; relation: string; place: string; what_they_knew: string }[]
  }
  access: { level: string; release_date: string }
  onBehalf: {
    submitted_by_name: string
    submitted_by_contact: string
    relationship: string
    contributor_consented: boolean
    contributor_present: boolean
  }
}

const emptyDraft = (): Draft => ({
  consent: { review: false, age: false, exception: '' },
  contributor: {
    name: '',
    anonymous: false,
    preferred_name: '',
    location: '',
    profession: '',
    languages: '',
    record_language: '',
    contact: '',
  },
  answers: {},
  lineage: { summary: '', generations: [] },
  // Nothing is public by default. Publication has to be chosen, not defaulted into.
  access: { level: 'preserved_not_published', release_date: '' },
  onBehalf: {
    submitted_by_name: '',
    submitted_by_contact: '',
    relationship: '',
    contributor_consented: false,
    contributor_present: false,
  },
})

/* ── Component ───────────────────────────────────────────────────────────── */

export default function IntakeForm({ mode, copy, endpoints, storageKey }: Props) {
  const { value: draft, setValue: setDraft, savedAt, clear, restored } = useAutosave<Draft>(storageKey, emptyDraft())

  const [step, setStep] = useState(0)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [recordings, setRecordings] = useState<Record<string, Recording>>({})
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState('')
  const [failure, setFailure] = useState<{ message: string; hint?: string; recoverable: boolean } | null>(null)
  const [result, setResult] = useState<SubmitResult | null>(null)

  const steps = copy.steps
  const questions = copy.record.questions
  const recordId = useMemo(() => newId(), [])

  const patch = <K extends keyof Draft>(key: K, changes: Partial<Draft[K]>) =>
    setDraft((previous) => ({ ...previous, [key]: { ...previous[key], ...changes } }))

  const setAnswer = (id: string, text: string) =>
    setDraft((previous) => ({ ...previous, answers: { ...previous.answers, [id]: text } }))

  const answered = (id: string) => Boolean(draft.answers[id]?.trim() || recordings[id])

  /* ── Validation, per step ─────────────────────────────────────────────── */

  const validateStep = (index: number): string[] => {
    const found: string[] = []
    const stepId = steps[index]?.id

    if (stepId === 'consent') {
      if (!draft.consent.review) found.push(copy.consent.consentRequiredError)
      // The age gate routes to review, it never blocks (Part VIII.1).
      if (!draft.consent.age && !draft.consent.exception.trim()) {
        found.push('If you are under 30, tell us why this shouldn’t wait — we will read it.')
      }
      if (mode === 'on_behalf') {
        if (!draft.onBehalf.contributor_consented) found.push(copy.onBehalf.consentRequiredError)
        if (!draft.onBehalf.submitted_by_name.trim()) found.push('Please tell us your name.')
      }
    }

    if (stepId === 'record') {
      for (const question of questions) {
        if (question.required && !answered(question.id)) found.push(`“${question.label}” still needs an answer.`)
      }
    }

    if (stepId === 'review') {
      if (draft.access.level === 'publish_after_date' && !draft.access.release_date) {
        found.push('Choose the date this should be published on.')
      }
    }

    return found
  }

  const goNext = () => {
    const found = validateStep(step)
    setErrors(found)
    if (found.length) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setStep((s) => Math.min(steps.length - 1, s + 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const goBack = () => {
    setErrors([])
    setStep((s) => Math.max(0, s - 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const jumpTo = (index: number) => {
    setErrors([])
    setStep(index)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /* ── Payload ──────────────────────────────────────────────────────────── */

  const buildPayload = (media: {
    audio: Record<string, string>
    photos: { url: string; caption: string | null }[]
  }) => ({
    id: recordId,
    source: mode,
    contributor: {
      name: draft.contributor.name || null,
      display_as_anonymous: draft.contributor.anonymous,
      preferred_name: draft.contributor.preferred_name || null,
      location: draft.contributor.location,
      profession: draft.contributor.profession,
      languages: draft.contributor.languages,
      record_language: draft.contributor.record_language,
      age_confirmed_30_plus: draft.consent.age,
      exception_reason: draft.consent.exception || null,
      contact: draft.contributor.contact || null,
    },
    wisdom_record: {
      central_prompt_text: draft.answers.central_prompt ?? '',
      central_prompt_audio_url: media.audio.central_prompt ?? null,
      what_happened: draft.answers.what_happened ?? '',
      what_they_did: draft.answers.what_they_did ?? '',
      what_worked_failed: draft.answers.what_worked_failed ?? '',
      what_differently: draft.answers.what_differently ?? '',
      key_lesson_text: draft.answers.key_lesson ?? '',
      key_lesson_audio_url: media.audio.key_lesson ?? null,
      when_not_applicable: draft.answers.when_not_applicable ?? '',
      who_can_confirm: draft.answers.who_can_confirm || null,
      audio: Object.fromEntries(
        Object.entries(media.audio).filter(([id]) => id !== 'central_prompt' && id !== 'key_lesson'),
      ),
    },
    family_learning_note: {
      summary: draft.lineage.summary,
      generations: draft.lineage.generations,
    },
    photos: media.photos,
    classification: {
      primary_category: '',
      subcategory: '',
      experience_type: '',
      search_filters: { country: '', state: '', time_period: '' },
    },
    access: {
      level: draft.access.level,
      release_date: draft.access.release_date || null,
    },
    ...(mode === 'on_behalf' ? { on_behalf: draft.onBehalf } : {}),
  })

  const submit = async () => {
    const found = validateStep(step)
    setErrors(found)
    if (found.length) return

    setSubmitting(true)
    setFailure(null)

    try {
      const audio: Record<string, string> = {}
      const recordingEntries = Object.entries(recordings)

      for (const [questionId, recording] of recordingEntries) {
        setProgress(`Uploading recording ${Object.keys(audio).length + 1} of ${recordingEntries.length}…`)
        const uploaded = await uploadFile(endpoints.uploads, recording.blob, {
          filename: `${questionId}.${extensionFor(recording.mimeType)}`,
          kind: 'audio',
          recordId,
        })
        audio[questionId] = uploaded.url
      }

      const uploadedPhotos: { url: string; caption: string | null }[] = []
      for (const [index, photo] of photos.entries()) {
        setProgress(`Uploading photograph ${index + 1} of ${photos.length}…`)
        const uploaded = await uploadFile(endpoints.uploads, photo.blob, {
          filename: `photo-${index + 1}.${extensionFor(photo.blob.type)}`,
          kind: 'photo',
          recordId,
        })
        uploadedPhotos.push({ url: uploaded.url, caption: photo.caption || null })
      }

      setProgress('Sending your record…')
      const payload = buildPayload({ audio, photos: uploadedPhotos })
      const response = await submitJson<SubmitResult>(endpoints.submissions, payload)

      setResult(response)
      clear()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      const api = error instanceof ApiError ? error : null
      setFailure({
        message: api?.notConfigured
          ? 'The archive’s storage is not connected yet, so this could not be sent.'
          : (api?.message ?? 'We could not reach the server.'),
        hint: api?.hint,
        recoverable: true,
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSubmitting(false)
      setProgress('')
    }
  }

  /* ── Success ──────────────────────────────────────────────────────────── */

  if (result) {
    return (
      <div className="card p-7 md:p-9">
        <h2 className="font-heading text-[1.6rem]">{copy.afterSubmit.heading}</h2>
        <p className="mt-4 leading-[1.7] text-ink/90">{copy.afterSubmit.body}</p>
        <p className="mt-6 text-[0.9rem] text-muted">
          {copy.afterSubmit.reference}:{' '}
          <code className="rounded bg-bg px-1.5 py-0.5 text-[0.85rem]">{result.id}</code>
        </p>
        <p className="mt-1 text-[0.9rem] text-muted">
          Status: <span className="tag">pending review</span>
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="/" className="btn btn-secondary">
            Back to the homepage
          </a>
          <a href="/browse" className="btn btn-quiet">
            See the archive
          </a>
        </div>
      </div>
    )
  }

  /* ── Shell ────────────────────────────────────────────────────────────── */

  const stepId = steps[step]?.id

  return (
    <div>
      <ol className="mb-9 flex list-none flex-wrap gap-x-1 gap-y-2 p-0" aria-label="Progress">
        {steps.map((item, index) => {
          const state = index === step ? 'current' : index < step ? 'done' : 'todo'
          return (
            <li key={item.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => index <= step && jumpTo(index)}
                disabled={index > step}
                aria-current={state === 'current' ? 'step' : undefined}
                className={`rounded-[999px] px-3 py-1.5 text-[0.82rem] transition-colors ${
                  state === 'current'
                    ? 'bg-accent text-white'
                    : state === 'done'
                      ? 'bg-accent-soft text-accent-hover hover:bg-accent/20'
                      : 'text-muted'
                } ${index > step ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <span className="tabular-nums">{index + 1}</span>
                <span className="ml-1.5 hidden sm:inline">{item.short}</span>
              </button>
              {index < steps.length - 1 && <span className="text-hairline">·</span>}
            </li>
          )
        })}
      </ol>

      {restored && savedAt && step === 0 && (
        <div className="mb-6">
          <Alert kind="note">
            We found a draft you started earlier and have put it back. You can carry on where you left off, or{' '}
            <button
              type="button"
              className="underline"
              onClick={() => {
                if (confirm(copy.common.clearDraftConfirm)) clear()
              }}
            >
              start again
            </button>
            .
          </Alert>
        </div>
      )}

      {errors.length > 0 && (
        <div className="mb-6">
          <Alert kind="error">
            <ul className="m-0 list-disc space-y-1 pl-5">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      {failure && (
        <div className="mb-6">
          <Alert kind="error">
            <p className="m-0 font-medium">{failure.message}</p>
            {failure.hint && <p className="m-0 mt-1.5 text-muted">{failure.hint}</p>}
            <p className="m-0 mt-2">{copy.common.offlineNote}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => void submit()}>
                {copy.common.errorRetry}
              </button>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() =>
                  downloadBackup(`narvyaka-record-${recordId.slice(0, 8)}.json`, buildPayload({ audio: {}, photos: [] }))
                }
              >
                {copy.common.downloadBackup}
              </button>
            </div>
          </Alert>
        </div>
      )}

      <div className="grid gap-7">
        {stepId === 'consent' && <ConsentStep {...{ copy, draft, patch, mode }} />}
        {stepId === 'about' && <AboutStep {...{ copy, draft, patch, mode }} />}
        {stepId === 'record' && (
          <RecordStep
            copy={copy}
            questions={questions}
            index={questionIndex}
            setIndex={setQuestionIndex}
            answers={draft.answers}
            setAnswer={setAnswer}
            recordings={recordings}
            setRecordings={setRecordings}
          />
        )}
        {stepId === 'lineage' && <LineageStep {...{ copy, draft, setDraft }} />}
        {stepId === 'photos' && (
          <section>
            <h2 className="font-heading text-[1.5rem]">{copy.photos.heading}</h2>
            <p className="mt-3 text-muted">{copy.photos.intro}</p>
            <div className="mt-6">
              <PhotoStep photos={photos} onChange={setPhotos} labels={copy.photos} />
            </div>
          </section>
        )}
        {stepId === 'review' && (
          <ReviewStep
            copy={copy}
            draft={draft}
            patch={patch}
            questions={questions}
            recordings={recordings}
            photos={photos}
            onEdit={jumpTo}
          />
        )}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-hairline pt-6">
        {step > 0 && (
          <button type="button" className="btn btn-secondary" onClick={goBack} disabled={submitting}>
            {copy.common.back}
          </button>
        )}

        {step < steps.length - 1 ? (
          <button type="button" className="btn btn-primary" onClick={goNext}>
            {copy.common.next}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={submitting}>
            {submitting ? progress || copy.common.submitting : copy.review.submit}
          </button>
        )}

        <span className="hint ml-auto">
          {savedAt ? `${copy.common.savedAt} ${savedAt.toLocaleTimeString()}` : copy.common.saving}
        </span>
      </div>
    </div>
  )
}

/* ── Steps ───────────────────────────────────────────────────────────────── */

function ConsentStep({
  copy,
  draft,
  patch,
  mode,
}: {
  copy: IntakeCopy
  draft: Draft
  patch: <K extends keyof Draft>(key: K, changes: Partial<Draft[K]>) => void
  mode: 'self' | 'on_behalf'
}) {
  return (
    <section className="grid gap-6">
      <div>
        <h2 className="font-heading text-[1.5rem]">{copy.consent.heading}</h2>
        <p className="mt-3 text-muted">{copy.consent.intro}</p>
      </div>

      <div className="grid gap-4">
        {copy.consent.points.map((point) => (
          <div key={point.title} className="card p-5">
            <h3 className="font-heading text-[1.1rem]">{point.title}</h3>
            <p className="mt-2 text-[0.95rem] leading-[1.65] text-muted">{point.body}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3">
        <Checkbox
          id="consent-review"
          checked={draft.consent.review}
          onChange={(checked) => patch('consent', { review: checked })}
        >
          {copy.consent.checkReview}
        </Checkbox>

        <Checkbox id="consent-age" checked={draft.consent.age} onChange={(checked) => patch('consent', { age: checked })}>
          {copy.consent.checkAge}
        </Checkbox>
        <p className="hint">{copy.consent.ageWhy}</p>

        {/* Not a wall: an under-30 contributor writes a sentence and a person reads it. */}
        {!draft.consent.age && (
          <div className="rounded-[12px] border border-hairline bg-bg p-5">
            <h3 className="font-heading text-[1.05rem]">{copy.consent.exceptionHeading}</h3>
            <p className="hint mt-1.5">{copy.consent.exceptionBody}</p>
            <div className="mt-3">
              <TextArea
                id="consent-exception"
                value={draft.consent.exception}
                onChange={(value) => patch('consent', { exception: value })}
                placeholder={copy.consent.exceptionPlaceholder}
                rows={3}
              />
            </div>
          </div>
        )}
      </div>

      {mode === 'on_behalf' && (
        <div className="grid gap-4 rounded-[12px] border border-accent/30 bg-accent-soft/50 p-5">
          <h3 className="font-heading text-[1.15rem]">{copy.onBehalf.heading}</h3>

          <Field label={copy.onBehalf.yourNameLabel} htmlFor="ob-name">
            <TextInput
              id="ob-name"
              value={draft.onBehalf.submitted_by_name}
              onChange={(value) => patch('onBehalf', { submitted_by_name: value })}
            />
          </Field>

          <Field label={copy.onBehalf.yourContactLabel} htmlFor="ob-contact" optional>
            <TextInput
              id="ob-contact"
              value={draft.onBehalf.submitted_by_contact}
              onChange={(value) => patch('onBehalf', { submitted_by_contact: value })}
            />
          </Field>

          <Field label={copy.onBehalf.relationshipLabel} htmlFor="ob-rel">
            <TextInput
              id="ob-rel"
              value={draft.onBehalf.relationship}
              onChange={(value) => patch('onBehalf', { relationship: value })}
              placeholder={copy.onBehalf.relationshipPlaceholder}
            />
          </Field>

          <Checkbox
            id="ob-consent"
            checked={draft.onBehalf.contributor_consented}
            onChange={(checked) => patch('onBehalf', { contributor_consented: checked })}
          >
            {copy.onBehalf.consentCheck}
          </Checkbox>

          <Checkbox
            id="ob-present"
            checked={draft.onBehalf.contributor_present}
            onChange={(checked) => patch('onBehalf', { contributor_present: checked })}
          >
            {copy.onBehalf.presentCheck}
          </Checkbox>
        </div>
      )}
    </section>
  )
}

function AboutStep({
  copy,
  draft,
  patch,
  mode,
}: {
  copy: IntakeCopy
  draft: Draft
  patch: <K extends keyof Draft>(key: K, changes: Partial<Draft[K]>) => void
  mode: 'self' | 'on_behalf'
}) {
  const c = copy.about
  const nameLabel = mode === 'on_behalf' ? copy.onBehalf.theirNameLabel : c.name
  const anonLabel = mode === 'on_behalf' ? copy.onBehalf.theirAnonymous : c.anonymous

  return (
    <section className="grid gap-6">
      <div>
        <h2 className="font-heading text-[1.5rem]">{c.heading}</h2>
        <p className="mt-3 text-muted">{c.intro}</p>
      </div>

      <Field label={nameLabel} htmlFor="c-name" optional>
        <TextInput
          id="c-name"
          value={draft.contributor.name}
          onChange={(value) => patch('contributor', { name: value })}
          placeholder={c.namePlaceholder}
          autoComplete="name"
        />
      </Field>

      <Checkbox
        id="c-anon"
        checked={draft.contributor.anonymous}
        onChange={(checked) => patch('contributor', { anonymous: checked })}
      >
        {anonLabel}
      </Checkbox>

      <Field label={c.preferredName} htmlFor="c-preferred" optional>
        <TextInput
          id="c-preferred"
          value={draft.contributor.preferred_name}
          onChange={(value) => patch('contributor', { preferred_name: value })}
          placeholder={c.preferredNamePlaceholder}
        />
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label={c.location} htmlFor="c-location" optional>
          <TextInput
            id="c-location"
            value={draft.contributor.location}
            onChange={(value) => patch('contributor', { location: value })}
            placeholder={c.locationPlaceholder}
          />
        </Field>

        <Field label={c.profession} htmlFor="c-profession" optional>
          <TextInput
            id="c-profession"
            value={draft.contributor.profession}
            onChange={(value) => patch('contributor', { profession: value })}
            placeholder={c.professionPlaceholder}
          />
        </Field>

        <Field label={c.languages} htmlFor="c-languages" optional>
          <TextInput
            id="c-languages"
            value={draft.contributor.languages}
            onChange={(value) => patch('contributor', { languages: value })}
            placeholder={c.languagesPlaceholder}
          />
        </Field>

        <Field label={c.recordLanguage} htmlFor="c-record-language" optional>
          <TextInput
            id="c-record-language"
            value={draft.contributor.record_language}
            onChange={(value) => patch('contributor', { record_language: value })}
            placeholder={c.recordLanguagePlaceholder}
          />
        </Field>
      </div>

      <div className="rounded-[12px] border border-hairline bg-bg p-5">
        <h3 className="font-heading text-[1.05rem]">{c.contactHeading}</h3>
        <p className="hint mt-1.5">{c.contactBody}</p>
        <div className="mt-3">
          <Field label={c.contact} htmlFor="c-contact" optional>
            <TextInput
              id="c-contact"
              value={draft.contributor.contact}
              onChange={(value) => patch('contributor', { contact: value })}
              placeholder={c.contactPlaceholder}
            />
          </Field>
        </div>
      </div>
    </section>
  )
}

function RecordStep({
  copy,
  questions,
  index,
  setIndex,
  answers,
  setAnswer,
  recordings,
  setRecordings,
}: {
  copy: IntakeCopy
  questions: Question[]
  index: number
  setIndex: (index: number) => void
  answers: Record<string, string>
  setAnswer: (id: string, text: string) => void
  recordings: Record<string, Recording>
  setRecordings: (updater: (previous: Record<string, Recording>) => Record<string, Recording>) => void
}) {
  const question = questions[index]
  if (!question) return null

  const setRecording = (recording: Recording | null) =>
    setRecordings((previous) => {
      const next = { ...previous }
      if (recording) next[question.id] = recording
      else delete next[question.id]
      return next
    })

  return (
    <section>
      <h2 className="font-heading text-[1.5rem]">{copy.record.heading}</h2>
      <p className="mt-3 text-muted">{copy.record.intro}</p>

      {/* Progressive disclosure: one question at a time, so this reads like a
          conversation rather than a job application. */}
      <div className="mt-8 card p-6 md:p-7">
        <div className="flex items-center justify-between gap-4">
          <p className="m-0 text-[0.82rem] font-semibold uppercase tracking-[0.09em] text-accent">
            {copy.record.progressLabel} {index + 1} / {questions.length}
          </p>
          {!question.required && <span className="hint">{copy.common.optional}</span>}
        </div>

        <h3 className="mt-3 font-heading text-[clamp(1.15rem,2.4vw,1.4rem)] leading-[1.4]">{question.label}</h3>
        {question.hint && <p className="hint mt-2">{question.hint}</p>}

        <div className="mt-5">
          <label className="visually-hidden" htmlFor={`q-${question.id}`}>
            {question.label}
          </label>
          <TextArea
            id={`q-${question.id}`}
            value={answers[question.id] ?? ''}
            onChange={(value) => setAnswer(question.id, value)}
            placeholder={question.placeholder}
            rows={index === 0 ? 8 : 5}
          />
        </div>

        {question.voice && (
          <div className="mt-5 border-t border-hairline pt-5">
            <p className="label">{copy.common.voiceOrType}</p>
            <VoiceRecorder
              recording={recordings[question.id] ?? null}
              onChange={setRecording}
              labels={copy.common as never}
            />
          </div>
        )}

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIndex(Math.max(0, index - 1))}
            disabled={index === 0}
          >
            {copy.common.back}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setIndex(Math.min(questions.length - 1, index + 1))}
            disabled={index === questions.length - 1}
          >
            {copy.common.next}
          </button>
        </div>
      </div>

      <ol className="mt-6 flex list-none flex-wrap gap-1.5 p-0">
        {questions.map((item, i) => {
          const done = Boolean(answers[item.id]?.trim() || recordings[item.id])
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`${copy.record.progressLabel} ${i + 1}`}
                aria-current={i === index ? 'true' : undefined}
                className={`h-2 w-8 rounded-full transition-colors ${
                  i === index ? 'bg-accent' : done ? 'bg-accent/40' : 'bg-hairline'
                }`}
              />
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function LineageStep({
  copy,
  draft,
  setDraft,
}: {
  copy: IntakeCopy
  draft: Draft
  setDraft: (updater: (previous: Draft) => Draft) => void
}) {
  const c = copy.lineage

  const setGeneration = (index: number, changes: Partial<Draft['lineage']['generations'][number]>) =>
    setDraft((previous) => ({
      ...previous,
      lineage: {
        ...previous.lineage,
        generations: previous.lineage.generations.map((g, i) => (i === index ? { ...g, ...changes } : g)),
      },
    }))

  const addGeneration = () =>
    setDraft((previous) => ({
      ...previous,
      lineage: {
        ...previous.lineage,
        generations: [...previous.lineage.generations, { name: '', relation: '', place: '', what_they_knew: '' }],
      },
    }))

  const removeGeneration = (index: number) =>
    setDraft((previous) => ({
      ...previous,
      lineage: { ...previous.lineage, generations: previous.lineage.generations.filter((_, i) => i !== index) },
    }))

  return (
    /*
     * Master Reference Part IV. Deliberately visually subordinate to the record
     * itself: a smaller heading, no navigation of its own, no "tracker"
     * branding. It is one more reflective question, not a second product.
     */
    <section>
      <h2 className="font-heading text-[1.25rem] text-muted">{c.heading}</h2>

      <div className="mt-5 card p-6">
        <label className="label text-[1.02rem]" htmlFor="lineage-summary">
          {c.question}
        </label>
        <p className="hint mb-3">{c.hint}</p>
        <TextArea
          id="lineage-summary"
          value={draft.lineage.summary}
          onChange={(value) => setDraft((previous) => ({ ...previous, lineage: { ...previous.lineage, summary: value } }))}
          placeholder={c.placeholder}
          rows={5}
        />

        <p className="hint mt-4 border-l-2 border-hairline pl-3 italic">{c.disclaimer}</p>
      </div>

      {draft.lineage.generations.length > 0 && (
        <ul className="mt-5 grid list-none gap-4 p-0">
          {draft.lineage.generations.map((generation, index) => (
            <li key={index} className="card grid gap-4 p-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={c.fields.name} htmlFor={`gen-name-${index}`} optional>
                  <TextInput
                    id={`gen-name-${index}`}
                    value={generation.name}
                    onChange={(value) => setGeneration(index, { name: value })}
                  />
                </Field>

                <Field label={c.fields.relation} htmlFor={`gen-rel-${index}`} optional>
                  <select
                    id={`gen-rel-${index}`}
                    className="field"
                    value={generation.relation}
                    onChange={(event) => setGeneration(index, { relation: event.target.value })}
                  >
                    <option value="">—</option>
                    {c.relations.map((relation) => (
                      <option key={relation} value={relation}>
                        {relation}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={c.fields.place} htmlFor={`gen-place-${index}`} optional>
                  <TextInput
                    id={`gen-place-${index}`}
                    value={generation.place}
                    onChange={(value) => setGeneration(index, { place: value })}
                  />
                </Field>
              </div>

              <Field label={c.fields.whatTheyKnew} htmlFor={`gen-knew-${index}`} optional>
                <TextArea
                  id={`gen-knew-${index}`}
                  value={generation.what_they_knew}
                  onChange={(value) => setGeneration(index, { what_they_knew: value })}
                  rows={3}
                />
              </Field>

              <button type="button" className="btn btn-quiet justify-self-start" onClick={() => removeGeneration(index)}>
                {c.removeGeneration}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="btn btn-secondary mt-5" onClick={addGeneration}>
        {c.addGeneration}
      </button>
    </section>
  )
}

function ReviewStep({
  copy,
  draft,
  patch,
  questions,
  recordings,
  photos,
  onEdit,
}: {
  copy: IntakeCopy
  draft: Draft
  patch: <K extends keyof Draft>(key: K, changes: Partial<Draft[K]>) => void
  questions: Question[]
  recordings: Record<string, Recording>
  photos: PhotoItem[]
  onEdit: (step: number) => void
}) {
  const c = copy.review

  return (
    <section className="grid gap-9">
      <div>
        <h2 className="font-heading text-[1.5rem]">{c.accessHeading}</h2>
        <p className="mt-3 text-muted">{c.accessIntro}</p>

        <div className="mt-6 grid gap-3">
          {c.levels.map((level) => (
            <RadioCard
              key={level.value}
              name="access-level"
              value={level.value}
              checked={draft.access.level === level.value}
              onChange={(value) => patch('access', { level: value })}
              title={level.title}
              body={level.body}
            />
          ))}
        </div>

        {draft.access.level === 'publish_after_date' && (
          <div className="mt-5 max-w-xs">
            <Field label={c.releaseDateLabel} htmlFor="release-date">
              <input
                id="release-date"
                type="date"
                className="field"
                value={draft.access.release_date}
                onChange={(event) => patch('access', { release_date: event.target.value })}
              />
            </Field>
          </div>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-heading text-[1.5rem]">{c.previewHeading}</h2>
        </div>
        <p className="mt-3 text-muted">{c.previewIntro}</p>

        <div className="mt-6 grid gap-5">
          <PreviewBlock title={copy.about.heading} onEdit={() => onEdit(1)} editLabel={c.editStep}>
            <PreviewRow label={copy.about.name} value={draft.contributor.anonymous ? 'Anonymous Contributor' : draft.contributor.name} empty={c.emptyValue} />
            <PreviewRow label={copy.about.location} value={draft.contributor.location} empty={c.emptyValue} />
            <PreviewRow label={copy.about.profession} value={draft.contributor.profession} empty={c.emptyValue} />
            <PreviewRow label={copy.about.recordLanguage} value={draft.contributor.record_language} empty={c.emptyValue} />
          </PreviewBlock>

          <PreviewBlock title={copy.record.heading} onEdit={() => onEdit(2)} editLabel={c.editStep}>
            {questions.map((question) => (
              <PreviewRow
                key={question.id}
                label={question.label}
                value={draft.answers[question.id] ?? ''}
                empty={c.emptyValue}
                note={recordings[question.id] ? `Voice recording attached (${recordings[question.id].seconds}s)` : undefined}
              />
            ))}
          </PreviewBlock>

          <PreviewBlock title={copy.lineage.heading} onEdit={() => onEdit(3)} editLabel={c.editStep}>
            <PreviewRow label={copy.lineage.question} value={draft.lineage.summary} empty={c.emptyValue} />
            {draft.lineage.generations.map((generation, index) => (
              <PreviewRow
                key={index}
                label={[generation.relation, generation.name].filter(Boolean).join(' · ') || `Generation ${index + 1}`}
                value={generation.what_they_knew}
                empty={c.emptyValue}
              />
            ))}
          </PreviewBlock>

          <PreviewBlock title={copy.photos.heading} onEdit={() => onEdit(4)} editLabel={c.editStep}>
            {photos.length === 0 ? (
              <p className="m-0 text-muted">{c.emptyValue}</p>
            ) : (
              <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
                {photos.map((photo) => (
                  <li key={photo.id}>
                    <img src={photo.previewUrl} alt={photo.caption} className="h-20 w-20 rounded-[8px] object-cover" />
                  </li>
                ))}
              </ul>
            )}
          </PreviewBlock>
        </div>
      </div>

      <Alert kind="note">{c.finalNote}</Alert>
    </section>
  )
}

function PreviewBlock({
  title,
  onEdit,
  editLabel,
  children,
}: {
  title: string
  onEdit: () => void
  editLabel: string
  children: React.ReactNode
}) {
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-3">
        <h3 className="font-heading text-[1.1rem]">{title}</h3>
        <button type="button" className="btn btn-quiet" onClick={onEdit}>
          {editLabel}
        </button>
      </div>
      <div className="mt-4 grid gap-4">{children}</div>
    </div>
  )
}

function PreviewRow({
  label,
  value,
  empty,
  note,
}: {
  label: string
  value: string
  empty: string
  note?: string
}) {
  return (
    <div>
      <p className="m-0 text-[0.82rem] font-medium text-muted">{label}</p>
      <p className={`m-0 mt-1 whitespace-pre-wrap leading-[1.6] ${value ? '' : 'text-muted italic'}`}>
        {value || empty}
      </p>
      {note && <p className="m-0 mt-1 text-[0.82rem] text-accent">{note}</p>}
    </div>
  )
}
