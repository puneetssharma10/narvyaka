import { useState } from 'react'
import { Alert, Checkbox, Field, TextArea, TextInput } from './fields'
import { ApiError, downloadBackup, submitJson } from './api'
import { useAutosave } from './useAutosave'

interface Copy {
  name: string
  contact: string
  contactHint: string
  location: string
  roles: string
  languages: string
  why: string
  whyPlaceholder: string
  approach: string
  approachHint: string
  time: string
  timeOptions: string[]
  submit: string
}

interface Props {
  copy: Copy
  common: Record<string, string>
  roles: string[]
  endpoint: string
  afterSubmit: { heading: string; body: string }
}

interface Draft {
  name: string
  contact: string
  location: string
  roles: string[]
  languages: string
  why: string
  approach: string
  time_commitment: string
}

const empty = (): Draft => ({
  name: '',
  contact: '',
  location: '',
  roles: [],
  languages: '',
  why: '',
  approach: '',
  time_commitment: '',
})

export default function VolunteerForm({ copy, common, roles, endpoint, afterSubmit }: Props) {
  const { value: draft, setValue: setDraft, clear, savedAt } = useAutosave<Draft>('narvyaka.draft.volunteer.v1', empty())
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<{ message: string; hint?: string } | null>(null)
  const [done, setDone] = useState(false)

  const set = (changes: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...changes }))

  const toggleRole = (role: string) =>
    setDraft((previous) => ({
      ...previous,
      roles: previous.roles.includes(role) ? previous.roles.filter((r) => r !== role) : [...previous.roles, role],
    }))

  const submit = async () => {
    const found: string[] = []
    if (!draft.name.trim()) found.push('Please tell us your name.')
    if (!draft.contact.trim()) found.push('Please give us a way to reply to you.')
    if (draft.roles.length === 0) found.push('Choose at least one role.')
    if (!draft.approach.trim()) found.push('Please answer the question about privacy and consent.')

    setErrors(found)
    if (found.length) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    setSubmitting(true)
    setFailure(null)
    try {
      await submitJson(endpoint, draft)
      clear()
      setDone(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      const api = error instanceof ApiError ? error : null
      setFailure({
        message: api?.notConfigured
          ? 'Applications cannot be received yet — the storage for them is not connected.'
          : (api?.message ?? 'We could not reach the server.'),
        hint: api?.hint,
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="card p-7">
        <h2 className="font-heading text-[1.5rem]">{afterSubmit.heading}</h2>
        <p className="mt-4 leading-[1.7] text-ink/90">{afterSubmit.body}</p>
        <a href="/" className="btn btn-secondary mt-7">
          Back to the homepage
        </a>
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      {errors.length > 0 && (
        <Alert kind="error">
          <ul className="m-0 list-disc space-y-1 pl-5">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </Alert>
      )}

      {failure && (
        <Alert kind="error">
          <p className="m-0 font-medium">{failure.message}</p>
          {failure.hint && <p className="m-0 mt-1.5 text-muted">{failure.hint}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => void submit()}>
              {common.errorRetry}
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => downloadBackup('narvyaka-volunteer-application.json', draft)}
            >
              {common.downloadBackup}
            </button>
          </div>
        </Alert>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label={copy.name} htmlFor="v-name">
          <TextInput id="v-name" value={draft.name} onChange={(value) => set({ name: value })} autoComplete="name" />
        </Field>

        <Field label={copy.contact} hint={copy.contactHint} htmlFor="v-contact">
          <TextInput id="v-contact" value={draft.contact} onChange={(value) => set({ contact: value })} />
        </Field>

        <Field label={copy.location} htmlFor="v-location" optional>
          <TextInput id="v-location" value={draft.location} onChange={(value) => set({ location: value })} />
        </Field>

        <Field label={copy.languages} htmlFor="v-languages" optional>
          <TextInput id="v-languages" value={draft.languages} onChange={(value) => set({ languages: value })} />
        </Field>
      </div>

      <fieldset className="m-0 border-0 p-0">
        <legend className="label">{copy.roles}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {roles.map((role) => (
            <Checkbox key={role} id={`role-${role}`} checked={draft.roles.includes(role)} onChange={() => toggleRole(role)}>
              {role}
            </Checkbox>
          ))}
        </div>
      </fieldset>

      <Field label={copy.why} htmlFor="v-why" optional>
        <TextArea id="v-why" value={draft.why} onChange={(value) => set({ why: value })} placeholder={copy.whyPlaceholder} rows={4} />
      </Field>

      {/* Master Reference Part IX.3 — the question the founding review turns on. */}
      <Field label={copy.approach} hint={copy.approachHint} htmlFor="v-approach">
        <TextArea id="v-approach" value={draft.approach} onChange={(value) => set({ approach: value })} rows={6} />
      </Field>

      <Field label={copy.time} htmlFor="v-time" optional>
        <select
          id="v-time"
          className="field"
          value={draft.time_commitment}
          onChange={(event) => set({ time_commitment: event.target.value })}
        >
          <option value="">—</option>
          {copy.timeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-6">
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={submitting}>
          {submitting ? common.submitting : copy.submit}
        </button>
        <span className="hint ml-auto">
          {savedAt ? `${common.savedAt} ${savedAt.toLocaleTimeString()}` : common.saving}
        </span>
      </div>
    </div>
  )
}
