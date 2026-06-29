import { useState, useEffect } from 'react'
import { supabase } from './supabase'

const statusStyle = {
  taken:  { background: '#f0fdf4', color: '#16a34a', label: 'Taken' },
  late:   { background: '#fffbeb', color: '#d97706', label: 'Late' },
  missed: { background: '#f3f4f6', color: '#9ca3af', label: 'Missed' },
  skipped:{ background: '#fef2f2', color: '#dc2626', label: 'Skipped' },
}

const btnColors = {
  taken:   { color: '#16a34a', border: '#bbf7d0', activeBg: '#f0fdf4' },
  skipped: { color: '#dc2626', border: '#fecaca', activeBg: '#fef2f2' },
}

// Parses "8-9am", "8:30–9:30am", "8am-9pm" into { start: Date, end: Date } for today.
// Returns null if the string can't be understood — callers treat null as "no window."
function parseTimeWindow(windowStr) {
  if (!windowStr) return null
  const norm = windowStr.replace(/[–—]/g, '-').trim().toLowerCase()
  const m = norm.match(
    /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/
  )
  if (!m) return null

  let [, sh, sm = '0', smer, eh, em = '0', emer] = m
  sh = parseInt(sh); eh = parseInt(eh)
  sm = parseInt(sm); em = parseInt(em)

  // If only one side has am/pm, inherit it to the other ("8-9am" → both am).
  if (!smer && emer) smer = emer
  if (!emer && smer) emer = smer
  if (!smer) smer = 'am'
  if (!emer) emer = 'am'

  // Convert to 24-hour.
  if (smer === 'pm' && sh !== 12) sh += 12
  if (smer === 'am' && sh === 12) sh = 0
  if (emer === 'pm' && eh !== 12) eh += 12
  if (emer === 'am' && eh === 12) eh = 0

  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm, 0)
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em, 0)
  return { start, end }
}

// Formats a Postgres TIME string ("08:00:00") into "8:00 AM".
function fmtTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  const mins = m === 0 ? '' : `:${String(m).padStart(2, '0')}`
  return `${hour}${mins} ${ampm}`
}

// Returns the window-end as a Date for today.
// Prefers the real window_end column; falls back to parsing the legacy text field.
function getWindowEnd(med) {
  if (med.window_end) {
    const [h, m] = med.window_end.split(':').map(Number)
    const d = new Date()
    d.setHours(h, m, 0, 0)
    return d
  }
  const parsed = parseTimeWindow(med.time_window)
  return parsed ? parsed.end : null
}

// Returns a human-readable window label for the med row pill.
function formatWindowLabel(med) {
  if (med.window_start && med.window_end)
    return `${fmtTime(med.window_start)} – ${fmtTime(med.window_end)}`
  return med.time_window || null
}

// Derives taken / late / missed by anchoring the window end to the closest
// daily occurrence of that time — not blindly today's date.
//
// For a window_end of 19:30, there are three candidates:
//   yesterday's 19:30, today's 19:30, tomorrow's 19:30.
// We pick whichever is closest to takenAt, then measure the gap from that.
//
// Example: window_end=19:30, takenAt=01:54 AM next day
//   → closest = yesterday's 19:30 (6h 24m away, not tonight's 17h 36m away)
//   → 6h 24m > 1 hour → "missed"
//
// Outcomes:
//   taken  — logged at or before the anchored window end
//   late   — logged 0–60 min after the anchored window end (counts toward streak)
//   missed — logged >60 min after the anchored window end (breaks streak)
function deriveStatus(takenAt, med) {
  // Resolve window end to hours + minutes from whichever source is available.
  let endH, endM
  if (med.window_end) {
    ;[endH, endM] = med.window_end.split(':').map(Number)
  } else {
    const parsed = parseTimeWindow(med.time_window)
    if (!parsed) return 'taken' // no window defined → can't be late
    endH = parsed.end.getHours()
    endM = parsed.end.getMinutes()
  }

  // Build three candidates (yesterday / today / tomorrow relative to takenAt).
  const takenDate = new Date(takenAt)
  const candidates = [-1, 0, 1].map(offset => {
    const d = new Date(takenDate)
    d.setDate(d.getDate() + offset)
    d.setHours(endH, endM, 0, 0)
    return d
  })

  // Anchor to the occurrence closest in time to when the med was actually taken.
  const anchoredEnd = candidates.reduce((best, c) =>
    Math.abs(c - takenDate) < Math.abs(best - takenDate) ? c : best
  )

  const diffMs = takenDate - anchoredEnd

  if (diffMs <= 0)                return 'taken'   // at or before window end
  if (diffMs <= 60 * 60 * 1000)  return 'late'    // within 1-hour grace window
  return 'missed'                                  // too late to count
}

// Counts consecutive days with status taken OR late, ending today (or yesterday).
function computeStreak(dates) {
  if (dates.length === 0) return 0
  const dateSet = new Set(dates)

  const todayD = new Date()
  const todayStr = todayD.toLocaleDateString('en-CA')
  const yesterdayD = new Date(todayD)
  yesterdayD.setDate(yesterdayD.getDate() - 1)
  const yesterdayStr = yesterdayD.toLocaleDateString('en-CA')

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

export default function MedsPage() {
  // ── Add-med form ──
  const [name, setName] = useState('')
  const [dose, setDose] = useState('')
  const [windowStart, setWindowStart] = useState('')
  const [windowEnd, setWindowEnd] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  // ── Data ──
  const [meds, setMeds] = useState([])
  const [loadingMeds, setLoadingMeds] = useState(true)
  const [logsToday, setLogsToday] = useState({})
  const [loggingId, setLoggingId] = useState(null)
  const [streaks, setStreaks] = useState({})

  const today = new Date().toLocaleDateString('en-CA')

  async function loadMeds() {
    const { data, error } = await supabase
      .from('meds').select('*').eq('active', true).order('name')
    if (!error) setMeds(data)
    setLoadingMeds(false)
  }

  async function loadStreaks() {
    // Count taken AND late — both mean you actually took the med.
    const { data, error } = await supabase
      .from('med_logs')
      .select('med_id, date')
      .in('status', ['taken', 'late'])

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
      .from('meds').insert({ name, dose, window_start: windowStart || null, window_end: windowEnd || null, active: true })
    if (error) { setError(error.message) }
    else { setName(''); setDose(''); setWindowStart(''); setWindowEnd(''); setSuccess(true); loadMeds() }
    setSubmitting(false)
  }

  async function handleLog(med, action) {
    setLoggingId(med.id)
    const existing = logsToday[med.id]

    let payload
    if (action === 'skipped') {
      payload = { med_id: med.id, date: today, status: 'skipped', taken_at: null }
    } else {
      // Stamp current time, then let the window decide whether it's on time or late.
      const takenAt = new Date().toISOString()
      const status  = deriveStatus(takenAt, med)
      payload = { med_id: med.id, date: today, status, taken_at: takenAt }
    }

    if (existing) {
      await supabase.from('med_logs').update(payload).eq('id', existing.id)
    } else {
      await supabase.from('med_logs').insert(payload)
    }

    await loadLogsToday()
    await loadStreaks()
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
                <label style={s.label}>Window start</label>
                <input type="time" value={windowStart} onChange={e => setWindowStart(e.target.value)}
                  style={s.input} />
              </div>
              <div style={s.field}>
                <label style={s.label}>Window end</label>
                <input type="time" value={windowEnd} onChange={e => setWindowEnd(e.target.value)}
                  style={s.input} />
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
            const log      = logsToday[med.id]
            const st       = log ? statusStyle[log.status] : null
            const isLogging = loggingId === med.id
            const streak   = streaks[med.id] || 0
            // Taken button lights up whether the derived status was 'taken' or 'late' —
            // both mean the user pressed Taken.
            const takenActive   = log?.status === 'taken' || log?.status === 'late' || log?.status === 'missed'
            const skippedActive = log?.status === 'skipped'

            return (
              <div key={med.id} style={s.medRow}>

                <div style={s.medTop}>
                  <div>
                    <span style={s.medName}>{med.name}</span>
                    {med.dose && <span style={s.medDetail}> · {med.dose}</span>}
                  </div>
                  <div style={s.medRight}>
                    {streak > 0 && <span style={s.streak}>🔥 {streak}</span>}
                    {st ? (
                      <span style={{ ...s.statusBadge, background: st.background, color: st.color }}>
                        {st.label}
                      </span>
                    ) : (
                      <span style={s.notLogged}>not logged yet</span>
                    )}
                    {formatWindowLabel(med) && (
                      <span style={s.timeWindow}>{formatWindowLabel(med)}</span>
                    )}
                  </div>
                </div>

                <div style={s.logBtns}>
                  <button
                    onClick={() => handleLog(med, 'taken')}
                    disabled={isLogging}
                    style={{
                      ...s.logBtn,
                      color: btnColors.taken.color,
                      borderColor: btnColors.taken.border,
                      background: takenActive ? btnColors.taken.activeBg : '#fff',
                      fontWeight: takenActive ? '700' : '500',
                      opacity: isLogging ? 0.5 : 1,
                    }}
                  >
                    Taken
                  </button>
                  <button
                    onClick={() => handleLog(med, 'skipped')}
                    disabled={isLogging}
                    style={{
                      ...s.logBtn,
                      color: btnColors.skipped.color,
                      borderColor: btnColors.skipped.border,
                      background: skippedActive ? btnColors.skipped.activeBg : '#fff',
                      fontWeight: skippedActive ? '700' : '500',
                      opacity: isLogging ? 0.5 : 1,
                    }}
                  >
                    Skipped
                  </button>
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
  row: { display: 'flex', gap: '1rem', flexWrap: 'wrap' },
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
  medName:   { fontSize: '0.95rem', fontWeight: '600', color: '#111827' },
  medDetail: { fontSize: '0.9rem', color: '#6b7280' },
  statusBadge: {
    fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: '0.05em', padding: '0.2rem 0.6rem', borderRadius: '999px',
  },
  streak: { fontSize: '0.82rem', fontWeight: '700', color: '#d97706' },
  notLogged: { fontSize: '0.78rem', color: '#9ca3af', fontStyle: 'italic' },
  timeWindow: {
    fontSize: '0.78rem', color: '#6b7280',
    background: '#f3f4f6', padding: '0.2rem 0.6rem', borderRadius: '999px',
  },
  logBtns: { display: 'flex', gap: '0.5rem' },
  logBtn: {
    padding: '0.3rem 0.85rem', fontSize: '0.82rem',
    border: '1px solid', borderRadius: '6px', cursor: 'pointer',
  },
}
