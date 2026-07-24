import type { ReactNode } from 'react'

/** Shared form primitives. Plain, large targets, visible labels — this form is
 *  used by people who are not fluent with web forms, on phones, once. */

interface FieldProps {
  label: string
  hint?: string
  optional?: boolean
  error?: string
  children: ReactNode
  htmlFor?: string
}

export function Field({ label, hint, optional, error, children, htmlFor }: FieldProps) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {optional && <span className="ml-2 font-normal text-muted">Optional</span>}
      </label>
      {hint && <p className="hint mb-2">{hint}</p>}
      {children}
      {error && (
        <p className="mt-1.5 text-[0.85rem] text-caution" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

interface TextInputProps {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  autoComplete?: string
}

export function TextInput({ id, value, onChange, placeholder, type = 'text', autoComplete }: TextInputProps) {
  return (
    <input
      id={id}
      type={type}
      className="field"
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

interface TextAreaProps {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
}

export function TextArea({ id, value, onChange, placeholder, rows = 5 }: TextAreaProps) {
  return (
    <textarea
      id={id}
      className="field resize-y"
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

interface CheckboxProps {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
  error?: string
}

export function Checkbox({ id, checked, onChange, children, error }: CheckboxProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="flex cursor-pointer items-start gap-3 rounded-[8px] border border-hairline bg-surface p-3.5 transition-colors hover:border-accent/45"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[var(--color-accent)]"
        />
        <span className="text-[0.95rem] leading-[1.55]">{children}</span>
      </label>
      {error && (
        <p className="mt-1.5 text-[0.85rem] text-caution" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

interface RadioCardProps {
  name: string
  value: string
  checked: boolean
  onChange: (value: string) => void
  title: string
  body: string
}

export function RadioCard({ name, value, checked, onChange, title, body }: RadioCardProps) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-[12px] border p-4 transition-colors ${
        checked ? 'border-accent bg-accent-soft' : 'border-hairline bg-surface hover:border-accent/45'
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="mt-1 h-[16px] w-[16px] shrink-0 accent-[var(--color-accent)]"
      />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="mt-1 block text-[0.9rem] leading-[1.55] text-muted">{body}</span>
      </span>
    </label>
  )
}

export function Alert({ kind, children }: { kind: 'error' | 'note' | 'ok'; children: ReactNode }) {
  const styles = {
    error: 'border-caution/45 bg-caution/8 text-ink',
    note: 'border-hairline bg-bg text-ink',
    ok: 'border-verified/40 bg-verified/8 text-ink',
  }[kind]

  return (
    <div className={`rounded-[12px] border p-4 text-[0.94rem] leading-[1.6] ${styles}`} role={kind === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  )
}
