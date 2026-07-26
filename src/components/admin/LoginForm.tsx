import { useState } from 'react'

/** Email + password sign-in for admin/super_admin/volunteer accounts. */
export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = (await response.json().catch(() => ({}))) as { error?: string; mustChangePassword?: boolean }
      if (!response.ok) {
        setError(data.error ?? 'That email and password do not match.')
        setSubmitting(false)
        return
      }
      window.location.href = data.mustChangePassword ? '/admin/change-password' : '/admin'
    } catch {
      setError('Could not reach the server. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <form className="grid max-w-[40ch] gap-5" onSubmit={submit}>
      <label className="grid gap-2">
        <span className="label">Email</span>
        <input
          type="email"
          required
          autoComplete="username"
          className="field"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="grid gap-2">
        <span className="label">Password</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          className="field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      {error && (
        <p className="m-0 text-[0.92rem] text-[#b3261e]" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
