import { useEffect, useState } from 'react'
import { COUNTRIES } from '../../../shared/countries'

type Role = 'super_admin' | 'admin' | 'volunteer'
interface Me {
  id: string
  email: string
  role: Role
  mustChangePassword: boolean
}

interface VolunteerRow {
  id: string
  status: string
  submitted_at: string
  name: string
  contact: string
  location: string | null
  roles: string
  why: string | null
}

interface SubmissionRow {
  id: string
  status: string
  submitted_at: string
  contributor_name: string | null
  display_as_anonymous: number
  key_lesson: string | null
  access_level: string
  verification_status: string
  owner_user_id: string | null
}

interface UserRow {
  id: string
  email: string
  role: Role
  status: string
  can_download: number
  country: string | null
  created_at: string
  last_login_at: string | null
}

interface MySubmissionRow {
  id: string
  status: string
  submitted_at: string
  contributor_name: string | null
  key_lesson: string | null
}

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data: T }> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const data = (await response.json().catch(() => ({}))) as T
  return { ok: response.ok, data }
}

export default function AdminDashboard() {
  const [me, setMe] = useState<Me | null | 'loading'>('loading')
  const [tab, setTab] = useState<'volunteers' | 'submissions' | 'accounts' | 'mine'>('volunteers')
  const [tempCred, setTempCred] = useState<{ email: string; password: string } | null>(null)

  useEffect(() => {
    void api<{ user: Me | null }>('/api/auth/me').then(({ data }) => {
      setMe(data.user)
      setTab(data.user && (data.user.role === 'admin' || data.user.role === 'super_admin') ? 'volunteers' : 'mine')
    })
  }, [])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/'
  }

  if (me === 'loading') return <p className="text-muted">Loading…</p>

  if (!me) {
    return (
      <div className="card p-7">
        <p className="m-0">You need to sign in to see this.</p>
        <a href="/login" className="btn btn-primary mt-6">
          Go to sign in
        </a>
      </div>
    )
  }

  const isReviewer = me.role === 'admin' || me.role === 'super_admin'

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline pb-6">
        <div>
          <p className="m-0 text-[0.95rem]">
            Signed in as <strong>{me.email}</strong>{' '}
            <span className="rounded-[3px] border border-hairline px-2 py-0.5 text-[0.75rem] uppercase tracking-[0.08em] text-muted">
              {me.role.replace('_', ' ')}
            </span>
          </p>
          {me.mustChangePassword && (
            <p className="m-0 mt-2 text-[0.9rem] text-[#b3261e]">
              You're using a temporary password — change it below before doing anything else.
            </p>
          )}
        </div>
        <button className="btn btn-quiet" onClick={() => void logout()}>
          Sign out
        </button>
      </div>

      {me.mustChangePassword && <ChangePassword onDone={() => setMe({ ...me, mustChangePassword: false })} />}

      {tempCred && (
        <div className="card border-accent/40 p-6">
          <p className="m-0 font-medium">Account created — relay these to them once (this won't be shown again):</p>
          <p className="mt-3 font-mono text-[0.95rem]">
            {tempCred.email} / {tempCred.password}
          </p>
          <button className="btn btn-secondary mt-4" onClick={() => setTempCred(null)}>
            Done
          </button>
        </div>
      )}

      <nav className="flex flex-wrap gap-2">
        {isReviewer && (
          <TabButton active={tab === 'volunteers'} onClick={() => setTab('volunteers')}>
            Volunteer applications
          </TabButton>
        )}
        {isReviewer && (
          <TabButton active={tab === 'submissions'} onClick={() => setTab('submissions')}>
            Wisdom Records
          </TabButton>
        )}
        {isReviewer && (
          <TabButton active={tab === 'accounts'} onClick={() => setTab('accounts')}>
            Accounts
          </TabButton>
        )}
        <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>
          My records
        </TabButton>
      </nav>

      {tab === 'volunteers' && isReviewer && <VolunteerQueue onApproved={setTempCred} />}
      {tab === 'submissions' && isReviewer && <SubmissionQueue />}
      {tab === 'accounts' && isReviewer && <Accounts me={me} onCreated={setTempCred} />}
      {tab === 'mine' && <MyRecords />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={active ? 'btn btn-primary' : 'btn btn-secondary'} onClick={onClick}>
      {children}
    </button>
  )
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { ok, data } = await api<{ error?: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    })
    setBusy(false)
    if (!ok) {
      setError(data.error ?? 'Could not change your password.')
      return
    }
    onDone()
  }

  return (
    <form className="card grid gap-4 p-6" onSubmit={submit}>
      <p className="m-0 font-medium">Set a password only you know</p>
      <input
        type="password"
        placeholder="Current (temporary) password"
        className="field"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="New password (10+ characters)"
        className="field"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        required
      />
      {error && <p className="m-0 text-[0.9rem] text-[#b3261e]">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  )
}

function VolunteerQueue({ onApproved }: { onApproved: (cred: { email: string; password: string }) => void }) {
  const [rows, setRows] = useState<VolunteerRow[] | null>(null)
  const [emailDrafts, setEmailDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data } = await api<{ volunteers: VolunteerRow[] }>('/api/admin/volunteers?status=pending_review')
    setRows(data.volunteers ?? [])
  }
  useEffect(() => void load(), [])

  async function approve(id: string) {
    setBusyId(id)
    setError(null)
    const { ok, data } = await api<{ email?: string; tempPassword?: string; error?: string }>(
      `/api/admin/volunteers/${id}`,
      { method: 'PATCH', body: JSON.stringify({ action: 'approve', email: emailDrafts[id] }) },
    )
    setBusyId(null)
    if (!ok) return setError(data.error ?? 'Could not approve this application.')
    if (data.email && data.tempPassword) onApproved({ email: data.email, password: data.tempPassword })
    void load()
  }

  async function decline(id: string) {
    setBusyId(id)
    const { ok, data } = await api<{ error?: string }>(`/api/admin/volunteers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'decline' }),
    })
    setBusyId(null)
    if (!ok) setError(data.error ?? 'Could not decline this application.')
    void load()
  }

  if (!rows) return <p className="text-muted">Loading…</p>
  if (rows.length === 0) return <p className="text-muted">No applications waiting on review.</p>

  return (
    <div className="grid gap-4">
      {error && <p className="text-[0.9rem] text-[#b3261e]">{error}</p>}
      {rows.map((row) => (
        <div key={row.id} className="card grid gap-3 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="m-0 font-medium">{row.name}</p>
            <span className="text-[0.85rem] text-muted">{new Date(row.submitted_at).toLocaleDateString()}</span>
          </div>
          <p className="m-0 text-[0.9rem] text-muted">Contact: {row.contact}</p>
          {row.location && <p className="m-0 text-[0.9rem] text-muted">{row.location}</p>}
          <p className="m-0 text-[0.9rem]">Roles: {JSON.parse(row.roles || '[]').join(', ')}</p>
          {row.why && <p className="m-0 text-[0.9rem] leading-[1.6]">{row.why}</p>}

          {!row.contact.includes('@') && (
            <input
              type="email"
              placeholder="Email to create their login with"
              className="field"
              value={emailDrafts[row.id] ?? ''}
              onChange={(e) => setEmailDrafts({ ...emailDrafts, [row.id]: e.target.value })}
            />
          )}

          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busyId === row.id} onClick={() => void approve(row.id)}>
              Approve → create volunteer account
            </button>
            <button className="btn btn-quiet" disabled={busyId === row.id} onClick={() => void decline(row.id)}>
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function SubmissionQueue() {
  const [rows, setRows] = useState<SubmissionRow[] | null>(null)
  const [status, setStatus] = useState('pending_review')
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    const { data } = await api<{ submissions: SubmissionRow[] }>(`/api/admin/submissions?status=${status}`)
    setRows(data.submissions ?? [])
  }
  useEffect(() => void load(), [status])

  async function setRecordStatus(id: string, next: string) {
    setBusyId(id)
    await api(`/api/submissions/${id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) })
    setBusyId(null)
    void load()
  }

  return (
    <div className="grid gap-4">
      <select className="field max-w-[16rem]" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="pending_review">Pending review</option>
        <option value="approved">Approved</option>
        <option value="published">Published</option>
        <option value="withdrawn">Withdrawn</option>
      </select>

      {!rows && <p className="text-muted">Loading…</p>}
      {rows && rows.length === 0 && <p className="text-muted">Nothing here.</p>}

      {rows?.map((row) => (
        <div key={row.id} className="card grid gap-3 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="m-0 font-medium">
              {row.display_as_anonymous ? 'Anonymous contributor' : row.contributor_name || 'Unnamed'}
            </p>
            <span className="text-[0.85rem] text-muted">{new Date(row.submitted_at).toLocaleDateString()}</span>
          </div>
          {row.key_lesson && <p className="m-0 text-[0.9rem] leading-[1.6]">{row.key_lesson}</p>}
          <p className="m-0 text-[0.85rem] text-muted">
            {row.access_level} · {row.verification_status}
          </p>

          <div className="flex flex-wrap gap-2">
            {row.status !== 'approved' && (
              <button
                className="btn btn-secondary"
                disabled={busyId === row.id}
                onClick={() => void setRecordStatus(row.id, 'approved')}
              >
                Mark approved
              </button>
            )}
            {row.status !== 'published' && (
              <button
                className="btn btn-primary"
                disabled={busyId === row.id}
                onClick={() => void setRecordStatus(row.id, 'published')}
              >
                Publish
              </button>
            )}
            {row.status !== 'withdrawn' && (
              <button
                className="btn btn-quiet"
                disabled={busyId === row.id}
                onClick={() => void setRecordStatus(row.id, 'withdrawn')}
              >
                Withdraw
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function Accounts({ me, onCreated }: { me: Me; onCreated: (cred: { email: string; password: string }) => void }) {
  const [rows, setRows] = useState<UserRow[] | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [newCountry, setNewCountry] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data } = await api<{ users: UserRow[] }>('/api/admin/users')
    setRows(data.users ?? [])
  }
  useEffect(() => void load(), [])

  async function toggle(row: UserRow) {
    setBusyId(row.id)
    const action = row.status === 'active' ? 'revoke' : 'reactivate'
    const { ok, data } = await api<{ error?: string }>(`/api/admin/users/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    })
    setBusyId(null)
    if (!ok) setError((data as { error?: string }).error ?? 'Could not change that account.')
    void load()
  }

  async function toggleDownload(row: UserRow) {
    setBusyId(row.id)
    const action = row.can_download ? 'revoke_download' : 'grant_download'
    const { ok, data } = await api<{ error?: string }>(`/api/admin/users/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    })
    setBusyId(null)
    if (!ok) setError((data as { error?: string }).error ?? 'Could not change download permission.')
    void load()
  }

  async function createAdmin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const { ok, data } = await api<{ email?: string; tempPassword?: string; error?: string }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: newEmail, country: newCountry }),
    })
    if (!ok) return setError(data.error ?? 'Could not create that account.')
    if (data.email && data.tempPassword) onCreated({ email: data.email, password: data.tempPassword })
    setNewEmail('')
    setNewCountry('')
    void load()
  }

  return (
    <div className="grid gap-6">
      {me.role === 'super_admin' && (
        <form className="card flex flex-wrap items-end gap-3 p-6" onSubmit={createAdmin}>
          <label className="grid gap-2">
            <span className="label">New admin's email</span>
            <input
              type="email"
              required
              className="field"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </label>
          <label className="grid gap-2">
            <span className="label">Country (read/write scope)</span>
            <select required className="field" value={newCountry} onChange={(e) => setNewCountry(e.target.value)}>
              <option value="">Choose a country…</option>
              {COUNTRIES.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary">Create admin account</button>
        </form>
      )}

      {error && <p className="text-[0.9rem] text-[#b3261e]">{error}</p>}
      {!rows && <p className="text-muted">Loading…</p>}

      <div className="grid gap-3">
        {rows?.map((row) => {
          const canAct = me.role === 'super_admin' ? row.id !== me.id : row.role === 'volunteer'
          return (
            <div key={row.id} className="card flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <p className="m-0 font-medium">{row.email}</p>
                <p className="m-0 text-[0.85rem] text-muted">
                  {row.role.replace('_', ' ')} · {row.status}
                  {row.role === 'admin' && row.country ? ` · ${row.country}` : ''}
                  {row.role === 'volunteer' && row.can_download ? ' · can download' : ''}
                  {row.last_login_at ? ` · last seen ${new Date(row.last_login_at).toLocaleDateString()}` : ''}
                </p>
              </div>
              <div className="flex gap-2">
                {me.role === 'super_admin' && row.role === 'volunteer' && (
                  <button
                    className="btn btn-quiet"
                    disabled={busyId === row.id}
                    onClick={() => void toggleDownload(row)}
                  >
                    {row.can_download ? 'Revoke download' : 'Grant download'}
                  </button>
                )}
                {canAct && (
                  <button className="btn btn-quiet" disabled={busyId === row.id} onClick={() => void toggle(row)}>
                    {row.status === 'active' ? 'Revoke' : 'Reactivate'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MyRecords() {
  const [rows, setRows] = useState<MySubmissionRow[] | null>(null)

  useEffect(() => {
    void api<{ submissions: MySubmissionRow[] }>('/api/my/submissions').then(({ data }) =>
      setRows(data.submissions ?? []),
    )
  }, [])

  if (!rows) return <p className="text-muted">Loading…</p>
  if (rows.length === 0) {
    return (
      <div className="card p-6">
        <p className="m-0">You haven't submitted any records yet.</p>
        <a href="/preserve" className="btn btn-primary mt-5">
          Record a Wisdom Record
        </a>
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {rows.map((row) => (
        <div key={row.id} className="card p-5">
          <p className="m-0 font-medium">{row.contributor_name || 'Unnamed'}</p>
          {row.key_lesson && <p className="m-0 mt-2 text-[0.9rem] leading-[1.6]">{row.key_lesson}</p>}
          <p className="m-0 mt-2 text-[0.85rem] text-muted">
            {row.status} · submitted {new Date(row.submitted_at).toLocaleDateString()}
          </p>
        </div>
      ))}
    </div>
  )
}
