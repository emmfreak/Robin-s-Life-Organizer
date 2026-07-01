import { useState, useEffect } from 'react'
import { supabase } from './supabase'

// Same local-date convention as MedsPage: a night files under its wake-up date.
function localDateStr(date = new Date()) {
  return date.toLocaleDateString('en-CA') // YYYY-MM-DD in local time
}

// Current local time as "HH:MM" for pre-filling <input type="time">.
function localTimeStr(date = new Date()) {
  return date.toTimeString().slice(0, 5)
}

// Minutes-since-midnight for a "HH:MM" (or "HH:MM:SS") time string.
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

// Minutes between bedtime and wake_time, crossing midnight.
// If wake looks "earlier" than bedtime (e.g. bed 23:00, wake 07:00), the wake
// is the next day — roll it forward 24h instead of going negative.
function sleepDurationMinutes(bedtime, wakeTime) {
  const bedMins = timeToMinutes(bedtime)
  let wakeMins = timeToMinutes(wakeTime)
  if (wakeMins <= bedMins) wakeMins += 24 * 60
  return wakeMins - bedMins
}

// Formats total minutes as "7h 45m".
function formatDuration(totalMinutes) {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h}h ${m}m`
}

// Formats a Postgres TIME string ("23:00:00") into "11:00 PM".
function fmtTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

// Formats a "YYYY-MM-DD" date string into "Wed, Jul 2".
// Parsed with an explicit local time-of-day so it doesn't shift a day
// backward in timezones behind UTC.
function fmtDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

// Average duration and bedtime spread over a set of nights (most recent 7).
function computeStats(nights) {
  if (nights.length === 0) return null

  const totalMinutes = nights.reduce(
    (sum, n) => sum + sleepDurationMinutes(n.bedtime, n.wake_time), 0
  )
  const avgMinutes = Math.round(totalMinutes / nights.length)

  let earliestBedtime = nights[0].bedtime
  let latestBedtime = nights[0].bedtime
  for (const n of nights) {
    if (timeToMinutes(n.bedtime) < timeToMinutes(earliestBedtime)) earliestBedtime = n.bedtime
    if (timeToMinutes(n.bedtime) > timeToMinutes(latestBedtime)) latestBedtime = n.bedtime
  }

  return { avgMinutes, earliestBedtime, latestBedtime, count: nights.length }
}

export default function SleepPage() {
  const [bedtime, setBedtime] = useState('')
  const [wakeTime, setWakeTime] = useState(localTimeStr())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [savedDuration, setSavedDuration] = useState(null)

  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const stats = computeStats(history.slice(0, 7))

  async function loadHistory() {
    const { data, error } = await supabase
      .from('sleep_logs')
      .select('*')
      .order('date', { ascending: false })
      .limit(30)
    if (!error) setHistory(data)
    setLoadingHistory(false)
  }

  useEffect(() => { loadHistory() }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null); setSavedDuration(null); setSubmitting(true)

    const date = localDateStr() // night files under today, the wake-up date
    const payload = { date, bedtime, wake_time: wakeTime }

    const { data: existing } = await supabase
      .from('sleep_logs')
      .select('id')
      .eq('date', date)
      .maybeSingle()

    const { error } = existing
      ? await supabase.from('sleep_logs').update(payload).eq('id', existing.id)
      : await supabase.from('sleep_logs').insert(payload)

    if (error) setError(error.message)
    else {
      setSavedDuration(formatDuration(sleepDurationMinutes(bedtime, wakeTime)))
      await loadHistory()
    }

    setSubmitting(false)
  }

  return (
    <div style={s.wrapper}>
    <section style={s.section}>
      <h2 style={s.sectionTitle}>Log last night</h2>
      <form onSubmit={handleSubmit} style={s.form}>
        <div style={s.row}>
          <div style={s.field}>
            <label style={s.label}>Bedtime</label>
            <input
              type="time" value={bedtime} onChange={e => setBedtime(e.target.value)}
              required style={s.input}
            />
          </div>
          <div style={s.field}>
            <label style={s.label}>Wake time</label>
            <input
              type="time" value={wakeTime} onChange={e => setWakeTime(e.target.value)}
              required style={s.input}
            />
          </div>
        </div>
        {error && <p style={s.error}>{error}</p>}
        {savedDuration && <p style={s.success}>Sleep logged: {savedDuration}</p>}
        <button type="submit" disabled={submitting} style={s.button}>
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </form>
    </section>

    <section style={s.section}>
      <h2 style={s.sectionTitle}>Recent nights</h2>

      {stats && (
        <div style={s.stats}>
          <div style={s.statBlock}>
            <span style={s.statLabel}>Avg sleep (last {stats.count})</span>
            <span style={s.statValue}>{formatDuration(stats.avgMinutes)}</span>
          </div>
          <div style={s.statBlock}>
            <span style={s.statLabel}>Bedtime range</span>
            <span style={s.statValue}>
              {fmtTime(stats.earliestBedtime)} – {fmtTime(stats.latestBedtime)}
            </span>
          </div>
        </div>
      )}

      {loadingHistory && <p style={s.muted}>Loading…</p>}
      {!loadingHistory && history.length === 0 && (
        <p style={s.muted}>No nights logged yet.</p>
      )}

      {history.map(night => (
        <div key={night.id} style={s.nightRow}>
          <span style={s.nightDate}>{fmtDate(night.date)}</span>
          <span style={s.nightTimes}>{fmtTime(night.bedtime)} → {fmtTime(night.wake_time)}</span>
          <span style={s.nightDuration}>
            {formatDuration(sleepDurationMinutes(night.bedtime, night.wake_time))}
          </span>
        </div>
      ))}
    </section>
    </div>
  )
}

const s = {
  wrapper: { display: 'flex', flexDirection: 'column', gap: '1.5rem' },
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
  stats: {
    display: 'flex', gap: '2rem', flexWrap: 'wrap',
    padding: '0 0 1rem', marginBottom: '1rem', borderBottom: '1px solid #f3f4f6',
  },
  statBlock: { display: 'flex', flexDirection: 'column', gap: '0.15rem' },
  statLabel: { fontSize: '0.75rem', color: '#9ca3af' },
  statValue: { fontSize: '1.05rem', fontWeight: '700', color: '#111827' },
  nightRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
    padding: '0.65rem 0', borderBottom: '1px solid #f3f4f6',
  },
  nightDate:     { fontSize: '0.9rem', fontWeight: '600', color: '#111827', flex: 1 },
  nightTimes:    { fontSize: '0.85rem', color: '#6b7280', flex: 1 },
  nightDuration: { fontSize: '0.85rem', fontWeight: '700', color: '#4f46e5', flexShrink: 0 },
}
