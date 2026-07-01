import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import TasksPage from './TasksPage'
import MedsPage from './MedsPage'
import SleepPage from './SleepPage'

function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div style={s.center}>
      <div style={s.card}>
        <h1 style={s.title}>Robin's Life Organizer</h1>
        <form onSubmit={handleSubmit} style={s.form}>
          <label style={s.label}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={s.input} />
          <label style={s.label}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required style={s.input} />
          {error && <p style={s.error}>{error}</p>}
          <button type="submit" disabled={loading} style={s.button}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [page, setPage] = useState('tasks') // which page is showing

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return null
  if (!session) return <LoginScreen />

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  return (
    <div>
      {/* Shared header — lives here so every page gets the same nav bar */}
      <header style={s.header}>
        <h1 style={s.appTitle}>Robin's Life Organizer</h1>
        <nav style={s.nav}>
          <button
            onClick={() => setPage('tasks')}
            style={page === 'tasks' ? s.navActive : s.navBtn}
          >
            Tasks
          </button>
          <button
            onClick={() => setPage('meds')}
            style={page === 'meds' ? s.navActive : s.navBtn}
          >
            Meds
          </button>
          <button
            onClick={() => setPage('sleep')}
            style={page === 'sleep' ? s.navActive : s.navBtn}
          >
            Sleep
          </button>
        </nav>
        <button onClick={handleSignOut} style={s.signOutBtn}>Sign out</button>
      </header>

      {page === 'tasks' && <TasksPage />}
      {page === 'meds'  && <MedsPage />}
      {page === 'sleep' && (
        <div style={s.page}>
          <main style={s.main}>
            <SleepPage />
          </main>
        </div>
      )}
    </div>
  )
}

const s = {
  // ── Page wrapper (for pages that don't own their own full-screen layout) ──
  page: { minHeight: '100vh', background: '#f5f5f5', fontFamily: 'system-ui, sans-serif' },
  main: {
    maxWidth: '640px', margin: '0 auto', padding: '1.5rem 1rem 3rem',
    display: 'flex', flexDirection: 'column', gap: '1.5rem',
  },

  // ── Login screen ──
  center: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f5f5f5',
  },
  card: {
    background: '#fff',
    borderRadius: '10px',
    padding: '2.5rem',
    width: '100%',
    maxWidth: '380px',
    boxShadow: '0 2px 16px rgba(0,0,0,0.1)',
  },
  title: { margin: '0 0 1.5rem', fontSize: '1.4rem', textAlign: 'center' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  label: { fontSize: '0.85rem', fontWeight: '600', marginTop: '0.5rem' },
  input: { padding: '0.6rem 0.8rem', fontSize: '1rem', border: '1px solid #ccc', borderRadius: '6px' },
  button: { marginTop: '1rem', padding: '0.7rem', fontSize: '1rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  error: { color: '#dc2626', fontSize: '0.875rem', margin: '0.25rem 0 0' },

  // ── Shared header ──
  header: {
    background: '#4f46e5',
    color: '#fff',
    padding: '0.75rem 1.5rem',
    display: 'flex',
    alignItems: 'center',
    gap: '1.5rem',
  },
  appTitle: {
    margin: 0,
    fontSize: '1rem',
    fontWeight: '600',
    flexShrink: 0,
  },
  nav: {
    display: 'flex',
    gap: '0.25rem',
    flex: 1,
  },
  navBtn: {
    background: 'transparent',
    color: 'rgba(255,255,255,0.65)',
    border: 'none',
    borderRadius: '6px',
    padding: '0.4rem 0.9rem',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: '500',
  },
  navActive: {
    background: 'rgba(255,255,255,0.18)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '0.4rem 0.9rem',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: '600',
  },
  signOutBtn: {
    background: 'rgba(255,255,255,0.15)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '0.4rem 0.9rem',
    cursor: 'pointer',
    fontSize: '0.85rem',
    flexShrink: 0,
  },
}
