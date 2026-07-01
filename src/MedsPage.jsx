import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import { colors, font } from './theme'

const statusStyle = {
  taken:  { background: colors.yellow, color: colors.black, label: 'Taken' },
  late:   { background: colors.white, color: colors.black, label: 'Late' },
  missed: { background: 'transparent', color: colors.gray, border: `1px solid ${colors.border}`, label: 'Missed' },
  skipped:{ background: 'transparent', color: colors.white, border: `1px solid ${colors.border}`, label: 'Skipped' },
}

// Precise moments are stored UTC (taken_at).
// The day a dose belongs to is always the local calendar day via localDateStr.
function localDateStr(date = new Date()) {
  return date.toLocaleDateString('en-CA') // YYYY-MM-DD in local time
}


// Formats a Postgres TIME string ("08:00:00") into "8:00 AM".
function fmtTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  const mins = m === 0 ? '' : `:${String(m).padStart(2, '0')}`
  return `${hour}${mins} ${ampm}`
}

// Returns a human-readable window label for the med row pill.
// window_start is stored and displayed but not yet used in status logic (intentional — see Fix 4 note).
function formatWindowLabel(med) {
  if (med.window_start && med.window_end)
    return `${fmtTime(med.window_start)} – ${fmtTime(med.window_end)}`
  if (med.window_end)
    return `until ${fmtTime(med.window_end)}`
  return null
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
// Returns { status, doseDate } where doseDate is the local YYYY-MM-DD of the
// dose's *anchored* day — which may differ from today if logging cross-midnight.
//
// Day-anchoring: for a window_end of 23:30, three candidate occurrences exist
// (yesterday's, today's, tomorrow's). We pick the one closest to takenAt, then
// measure the gap from that anchor — not blindly from today's 23:30.
//
// 11:30 PM window, logged at 12:15 AM Tuesday:
//   closest anchor = Monday 23:30 (45 min away, not Tuesday 23:30 at 23h 15m)
//   45 min ≤ 60 min → status='late', doseDate='Monday' ✓
//
// Outcomes:
//   taken  — at or before the anchored window end
//   late   — 0–60 min after (counts toward streak)
//   missed — >60 min after (breaks streak)
function deriveStatus(takenAt, med) {
  const takenDate = new Date(takenAt)

  if (!med.window_end) {
    // No window defined — can't be late or missed.
    return { status: 'taken', doseDate: localDateStr(takenDate) }
  }

  // window_start is intentionally unused here — it's stored and displayed but
  // status logic only needs the end. An "too early" check can be added later.
  const [endH, endM] = med.window_end.split(':').map(Number)

  // Build three candidate window-end timestamps relative to takenAt's date.
  const candidates = [-1, 0, 1].map(offset => {
    const d = new Date(takenDate)
    d.setDate(d.getDate() + offset)
    d.setHours(endH, endM, 0, 0)
    return d
  })

  // Anchor to whichever occurrence is closest to when the med was actually taken.
  const anchoredEnd = candidates.reduce((best, c) =>
    Math.abs(c - takenDate) < Math.abs(best - takenDate) ? c : best
  )

  // doseDate is the local calendar day of the anchor — this is what the log files under.
  const doseDate = localDateStr(anchoredEnd)
  const diffMs   = takenDate - anchoredEnd

  if (diffMs <= 0)               return { status: 'taken',  doseDate }
  if (diffMs <= 60 * 60 * 1000) return { status: 'late',   doseDate }
  return                                { status: 'missed', doseDate }
}

// Counts consecutive days with status taken OR late, ending today (or yesterday).
function computeStreak(dates) {
  if (dates.length === 0) return 0
  const dateSet = new Set(dates)

  const todayStr     = localDateStr()
  const yesterdayD   = new Date()
  yesterdayD.setDate(yesterdayD.getDate() - 1)
  const yesterdayStr = localDateStr(yesterdayD)

  let cursor = dateSet.has(todayStr) ? todayStr : dateSet.has(yesterdayStr) ? yesterdayStr : null
  if (!cursor) return 0

  let streak = 0
  while (dateSet.has(cursor)) {
    streak++
    const d = new Date(cursor + 'T00:00:00')
    d.setDate(d.getDate() - 1)
    cursor = localDateStr(d)
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
  const [removingId, setRemovingId] = useState(null)
  const [streaks, setStreaks] = useState({})

  const today = localDateStr()

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

    let payload, doseDate

    if (action === 'skipped') {
      // Skipped is a deliberate same-day action — no timestamp to anchor from.
      doseDate = today
      payload = { med_id: med.id, date: doseDate, status: 'skipped', taken_at: null }
    } else {
      const takenAt = new Date().toISOString()
      const derived = deriveStatus(takenAt, med)
      doseDate = derived.doseDate   // may be yesterday if logging cross-midnight
      payload  = { med_id: med.id, date: doseDate, status: derived.status, taken_at: takenAt }
    }

    // Query by the dose's actual date, not the logsToday cache (which only covers
    // today and would miss a cross-midnight case, causing a spurious INSERT).
    const { data: existing } = await supabase
      .from('med_logs')
      .select('id')
      .eq('med_id', med.id)
      .eq('date', doseDate)
      .maybeSingle()

    if (existing) {
      await supabase.from('med_logs').update(payload).eq('id', existing.id)
    } else {
      await supabase.from('med_logs').insert(payload)
    }

    await loadLogsToday()
    await loadStreaks()
    setLoggingId(null)
  }

  async function handleRemove(med) {
    setRemovingId(med.id)
    await supabase.from('meds').update({ active: false }).eq('id', med.id)
    await loadMeds()
    setRemovingId(null)
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
                      <span style={{ ...s.statusBadge, background: st.background, color: st.color, border: st.border }}>
                        {st.label}
                      </span>
                    ) : (
                      <span style={s.notLogged}>not logged yet</span>
                    )}
                    {formatWindowLabel(med) && (
                      <span style={s.timeWindow}>{formatWindowLabel(med)}</span>
                    )}
                    <button
                      onClick={() => handleRemove(med)}
                      disabled={removingId === med.id}
                      style={s.removeBtn}
                      title="Remove medication"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div style={s.logBtns}>
                  <button
                    onClick={() => handleLog(med, 'taken')}
                    disabled={isLogging}
                    style={{
                      ...s.logBtn,
                      color: takenActive ? colors.black : colors.white,
                      borderColor: takenActive ? colors.yellow : colors.border,
                      background: takenActive ? colors.yellow : 'transparent',
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
                      color: skippedActive ? colors.black : colors.white,
                      borderColor: skippedActive ? colors.white : colors.border,
                      background: skippedActive ? colors.white : 'transparent',
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
  page: { minHeight: '100vh', background: colors.bg, fontFamily: font },
  main: {
    maxWidth: '640px', margin: '0 auto', padding: '1.5rem 1rem 3rem',
    display: 'flex', flexDirection: 'column', gap: '1.5rem',
  },
  section: {
    background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: '10px', padding: '1.5rem',
  },
  sectionTitle: { margin: '0 0 1rem', fontSize: '1rem', fontWeight: '600', color: colors.white },
  form: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  row: { display: 'flex', gap: '1rem', flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 },
  label: { fontSize: '0.8rem', fontWeight: '600', color: colors.white, marginTop: '0.4rem' },
  input: {
    padding: '0.55rem 0.75rem', fontSize: '1rem',
    border: `1px solid ${colors.border}`, borderRadius: '6px',
    width: '100%', boxSizing: 'border-box', background: colors.bg, color: colors.white,
  },
  button: {
    marginTop: '0.75rem', padding: '0.65rem 1.5rem', fontSize: '1rem', fontWeight: '700',
    background: colors.yellow, color: colors.black, border: 'none',
    borderRadius: '6px', cursor: 'pointer', alignSelf: 'flex-start',
  },
  error:   { color: colors.yellow, fontWeight: '700', fontSize: '0.875rem', margin: '0.25rem 0 0' },
  success: { color: colors.white, fontWeight: '700', fontSize: '0.875rem', margin: '0.25rem 0 0' },
  muted:   { color: colors.gray, fontSize: '0.9rem', margin: 0 },
  medRow: {
    display: 'flex', flexDirection: 'column', gap: '0.65rem',
    padding: '0.9rem 0', borderBottom: `1px solid ${colors.border}`,
  },
  medTop: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
  },
  medRight: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 },
  medName:   { fontSize: '0.95rem', fontWeight: '600', color: colors.white },
  medDetail: { fontSize: '0.9rem', color: colors.gray },
  statusBadge: {
    fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: '0.05em', padding: '0.2rem 0.6rem', borderRadius: '999px',
  },
  streak: { fontSize: '0.82rem', fontWeight: '700', color: colors.yellow },
  notLogged: { fontSize: '0.78rem', color: colors.gray, fontStyle: 'italic' },
  timeWindow: {
    fontSize: '0.78rem', color: colors.white,
    background: 'transparent', border: `1px solid ${colors.border}`, padding: '0.2rem 0.6rem', borderRadius: '999px',
  },
  logBtns: { display: 'flex', gap: '0.5rem' },
  logBtn: {
    padding: '0.3rem 0.85rem', fontSize: '0.82rem',
    border: '1px solid', borderRadius: '6px', cursor: 'pointer',
  },
  removeBtn: {
    padding: '0.1rem 0.4rem', fontSize: '1rem', lineHeight: 1,
    color: colors.white, background: 'transparent',
    border: `1px solid ${colors.border}`, borderRadius: '4px', cursor: 'pointer',
    flexShrink: 0,
  },
}
