import { useState, useEffect } from 'react'
import { supabase } from './supabase'

const statusStyle = {
  taken:  { background: '#f0fdf4', color: '#16a34a', label: 'Taken' },
  skipped:{ background: '#fef2f2', color: '#dc2626', label: 'Skipped' },
  late:   { background: '#fffbeb', color: '#d97706', label: 'Late' },
}

// Counts consecutive "taken" days ending today (or yesterday if today isn't taken yet).
// dates: array of YYYY-MM-DD strings, any order.
function computeStreak(dates) {
  if (dates.length === 0) return 0
  const dateSet = new Set(dates)

  const todayD = new Date()
  const todayStr = todayD.toLocaleDateString('en-CA')
  const yesterdayD = new Date(todayD)
  yesterdayD.setDate(yesterdayD.getDate() - 1)
  const yesterdayStr = yesterdayD.toLocaleDateString('en-CA')

  // Start counting from today if taken, otherwise from yesterday (preserves streak overnight).
  let cursor = dateSet.has(todayStr) ? todayStr : dateSet.has(yesterdayStr) ? yesterdayStr : null
  if (!cursor) return 0

  let streak = 0
  while (dateSet.has(cursor)) {
    streak++
    const d = new Date(cursor + 'T00:00:00')
    d.setDate(d.getDate() - 1)
    cursor = d.toLocaleDateString('en-CA')
  }
  return streak
}

// Base and active colours for each log button.
const btnColors = {
  taken:   { color: '#16a34a', border: '#bbf7d0', activeBg: '#f0fdf4' },
  skipped: { color: '#dc2626', border: '#fecaca', activeBg: '#fef2f2' },
  late:    { color: '#d97706', border: '#fde68a', activeBg: '#fffbeb' },
}

export default function MedsPage() {
  // ── Add-med form ──
  const [name, setName] = useState('')
  const [dose, setDose] = useState('')
  const [timeWindow, setTimeWindow] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  // ── Data ──
  const [meds, setMeds] = useState([])
  const [loadingMeds, setLoadingMeds] = useState(true)
  const [logsToday, setLogsToday] = useState({})
  const [loggingId, setLoggingId] = useState(null) // med.id currently being saved
  const [streaks, setStreaks] = useState({})         // med.id → streak count

  const today = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD

  async function loadMeds() {
    const { data, error } = await supabase
      .from('meds').select('*').eq('active', true).order('name')
    if (!error) setMeds(data)
    setLoadingMeds(false)
  }

  // One query fetches every taken log for all meds — no per-med queries.
  // We group by med_id client-side, then run computeStreak on each group.
  async function loadStreaks() {
    const { data, error } = await supabase
      .from('med_logs')
      .select('med_id, date')
      .eq('status', 'taken')

    if (!error) {
      const byMed = {}
      data.forEach(({ med_id, date }) => {
        if (!byMed[med_id]) byMed[med_id] = []
        byMed[med_id].push(date)
      })
      const result = {}
      for (const medId in byMed) result[medId] = computeStreak(byMed[medId])
      setStreaks(result)
    }
  }

  async function loadLogsToday() {
    const { data, error } = await supabase
      .from('med_logs').select('*').eq('date', today)
    if (!error) {
      const map = {}
      data.forEach(log => { map[log.med_id] = log })
      setLogsToday(map)
    }
  }

  useEffect(() => { loadMeds(); loadLogsToday(); loadStreaks() }, [])

  async function handleAddMed(e) {
    e.preventDefault()
    setError(null); setSuccess(false); setSubmitting(true)
    const { error } = await supabase
      .from('meds').insert({ name, dose, time_window: timeWindow, active: true })
    if (error) { setError(error.message) }
    else { setName(''); setDose(''); setTimeWindow(''); setSuccess(true); loadMeds() }
    setSubmitting(false)
  }

  // Insert or update today's log for this med.
  // If a row already exists (logsToday has it), update it — avoids duplicates.
  // taken_at is only set when the status is 'taken'; otherwise cleared.
  async function handleLog(med, status) {
    setLoggingId(med.id)

    const existing = logsToday[med.id]
    const payload = {
      med_id: med.id,
      date: today,
      status,
      taken_at: status === 'taken' ? new Date().toISOString() : null,
    }

    if (existing) {
      await supabase.from('med_logs').update(payload).eq('id', existing.id)
    } else {
      await supabase.from('med_logs').insert(payload)
    }

    await loadLogsToday()
    await loadStreaks() // recompute after every log so the number updates live
    setLoggingId(null)
  }

  return (
    <div style={s.page}>
      <main style={s.main}>

        {/* ── Add a medication ── */}
        <section style={s.section}>
          <h2 style={s.sectionTitle}>Add a medication</h2>
          <form onSubmit={handleAddMed} style={s.form}>
            <label style={s.label}>Name</label>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Sertraline" required style={s.input}
            />
            <div style={s.row}>
              <div style={s.field}>
                <label style={s.label}>Dose</label>
                <input type="text" value={dose} onChange={e => setDose(e.target.value)}
                  placeholder="e.g. 50mg" style={s.input} />
              </div>
              <div style={s.field}>
                <label style={s.label}>Time window</label>
                <input type="text" value={timeWindow} onChange={e => setTimeWindow(e.target.value)}
                  placeholder="e.g. 8–9am" style={s.input} />
              </div>
            </div>
            {error && <p style={s.error}>{error}</p>}
            {success && <p style={s.success}>Medication added!</p>}
            <button type="submit" disabled={submitting} style={s.button}>
              {submitting ? 'Adding…' : 'Add medication'}
            </button>
          </form>
        </section>

        {/* ── Today's medications ── */}
        <section style={s.section}>
          <h2 style={s.sectionTitle}>Today's medications</h2>

          {loadingMeds && <p style={s.muted}>Loading…</p>}
          {!loadingMeds && meds.length === 0 && (
            <p style={s.muted}>No medications added yet.</p>
          )}

          {meds.map(med => {
            const log = logsToday[med.id]
            const st = log ? statusStyle[log.status] : null
            const isLogging = loggingId === med.id
            const streak = streaks[med.id] || 0

            return (
              <div key={med.id} style={s.medRow}>

                {/* Top line: name + status */}
                <div style={s.medTop}>
                  <div>
                    <span style={s.medName}>{med.name}</span>
                    {med.dose && <span style={s.medDetail}> · {med.dose}</span>}
                  </div>
                  <div style={s.medRight}>
                    {streak > 0 && (
                      <span style={s.streak}>🔥 {streak}</span>
                    )}
                    {st ? (
                      <span style={{ ...s.statusBadge, background: st.background, color: st.color }}>
                        {st.label}
                      </span>
                    ) : (
                      <span style={s.notLogged}>not logged yet</span>
                    )}
                    {med.time_window && <span style={s.timeWindow}>{med.time_window}</span>}
                  </div>
                </div>

                {/* Bottom line: log buttons */}
                <div style={s.logBtns}>
                  {['taken', 'skipped', 'late'].map(status => {
                    const c = btnColors[status]
                    const isActive = log?.status === status
                    return (
                      <button
                        key={status}
                        onClick={() => handleLog(med, status)}
                        disabled={isLogging}
                        style={{
                          ...s.logBtn,
                          color: c.color,
                          borderColor: c.border,
                          background: isActive ? c.activeBg : '#fff',
                          fontWeight: isActive ? '700' : '500',
                          opacity: isLogging ? 0.5 : 1,
                        }}
                      >
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </button>
                    )
                  })}
                </div>

              </div>
            )
          })}
        </section>

      </main>
    </div>
  )
}

const s = {
  page: { minHeight: '100vh', background: '#f5f5f5', fontFamily: 'system-ui, sans-serif' },
  main: {
    maxWidth: '640px', margin: '0 auto', padding: '1.5rem 1rem 3rem',
    display: 'flex', flexDirection: 'column', gap: '1.5rem',
  },
  section: {
    background: '#fff', borderRadius: '10px', padding: '1.5rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
  },
  sectionTitle: { margin: '0 0 1rem', fontSize: '1rem', fontWeight: '600', color: '#374151' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  row: { display: 'flex', gap: '1rem' },
  field: { display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 },
  label: { fontSize: '0.8rem', fontWeight: '600', color: '#6b7280', marginTop: '0.4rem' },
  input: {
    padding: '0.55rem 0.75rem', fontSize: '1rem',
    border: '1px solid #d1d5db', borderRadius: '6px',
    width: '100%', boxSizing: 'border-box',
  },
  button: {
    marginTop: '0.75rem', padding: '0.65rem 1.5rem', fontSize: '1rem',
    background: '#4f46e5', color: '#fff', border: 'none',
    borderRadius: '6px', cursor: 'pointer', alignSelf: 'flex-start',
  },
  error:   { color: '#dc2626', fontSize: '0.875rem', margin: '0.25rem 0 0' },
  success: { color: '#16a34a', fontSize: '0.875rem', margin: '0.25rem 0 0' },
  muted:   { color: '#9ca3af', fontSize: '0.9rem', margin: 0 },

  medRow: {
    display: 'flex', flexDirection: 'column', gap: '0.65rem',
    padding: '0.9rem 0', borderBottom: '1px solid #f3f4f6',
  },
  medTop: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
  },
  medRight: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 },
  medName:  { fontSize: '0.95rem', fontWeight: '600', color: '#111827' },
  medDetail:{ fontSize: '0.9rem', color: '#6b7280' },
  statusBadge: {
    fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: '0.05em', padding: '0.2rem 0.6rem', borderRadius: '999px',
  },
  streak: {
    fontSize: '0.82rem',
    fontWeight: '700',
    color: '#d97706',
  },
  notLogged: { fontSize: '0.78rem', color: '#9ca3af', fontStyle: 'italic' },
  timeWindow: {
    fontSize: '0.78rem', color: '#6b7280',
    background: '#f3f4f6', padding: '0.2rem 0.6rem', borderRadius: '999px',
  },
  logBtns: { display: 'flex', gap: '0.5rem' },
  logBtn: {
    padding: '0.3rem 0.85rem', fontSize: '0.82rem',
    border: '1px solid', borderRadius: '6px',
    cursor: 'pointer', transition: 'opacity 0.1s',
  },
}
