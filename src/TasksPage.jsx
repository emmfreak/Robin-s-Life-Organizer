import { useState, useEffect } from 'react'
import { supabase } from './supabase'

const importanceBadge = {
  high:   { background: '#fef2f2', color: '#dc2626' },
  medium: { background: '#fffbeb', color: '#d97706' },
  low:    { background: '#f0fdf4', color: '#16a34a' },
}

const IMPORTANCE_RANK = { high: 3, medium: 2, low: 1 }

function pickNextTask(tasks) {
  if (tasks.length === 0) return null
  return [...tasks].sort((a, b) => {
    const rankDiff = IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance]
    if (rankDiff !== 0) return rankDiff
    if (!a.due_date && !b.due_date) return 0
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return new Date(a.due_date) - new Date(b.due_date)
  })[0]
}

// Turns a UTC timestamp into something like "Jun 29, 2026, 12:53 AM".
function formatCompleted(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export default function TasksPage() {
  const [title, setTitle] = useState('')
  const [importance, setImportance] = useState('medium')
  const [dueDate, setDueDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  const [tasks, setTasks] = useState([])
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [markingDone, setMarkingDone] = useState(null)

  const [wins, setWins] = useState([])
  const [loadingWins, setLoadingWins] = useState(true)

  const nextTask = pickNextTask(tasks)

  async function loadTasks() {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
    if (!error) setTasks(data)
    setLoadingTasks(false)
  }

  // Same table, different filter: status = 'done', newest completion first.
  async function loadWins() {
    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, completed_at, importance')
      .eq('status', 'done')
      .order('completed_at', { ascending: false })
    if (!error) setWins(data)
    setLoadingWins(false)
  }

  useEffect(() => {
    loadTasks()
    loadWins()
  }, [])

  async function handleMarkDone(taskId) {
    setMarkingDone(taskId)
    await supabase
      .from('tasks')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', taskId)
    setMarkingDone(null)
    loadTasks()
    loadWins() // the completed task should appear here immediately
  }

  async function handleAddTask(e) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setSubmitting(true)

    const task = { title, importance, status: 'open' }
    if (dueDate) task.due_date = dueDate

    const { error } = await supabase.from('tasks').insert(task)

    if (error) {
      setError(error.message)
    } else {
      setTitle('')
      setImportance('medium')
      setDueDate('')
      setSuccess(true)
      loadTasks()
    }

    setSubmitting(false)
  }

  return (
    <div style={s.page}>
      <main style={s.main}>
        {/* ── What's Next hero card ── */}
        <section style={s.hero}>
          <p style={s.heroLabel}>What's next</p>
          {loadingTasks ? (
            <p style={s.heroEmpty}>Loading…</p>
          ) : nextTask ? (
            <>
              <p style={s.heroTitle}>{nextTask.title}</p>
              <div style={s.heroMeta}>
                <span style={{ ...s.badge, ...importanceBadge[nextTask.importance] }}>
                  {nextTask.importance}
                </span>
                {nextTask.due_date && (
                  <span style={s.heroDueDate}>
                    Due {new Date(nextTask.due_date + 'T00:00:00').toLocaleDateString()}
                  </span>
                )}
              </div>
            </>
          ) : (
            <p style={s.heroEmpty}>No open tasks — you're clear!</p>
          )}
        </section>

        {/* ── Add task ── */}
        <section style={s.section}>
          <h2 style={s.sectionTitle}>Add a task</h2>
          <form onSubmit={handleAddTask} style={s.form}>
            <label style={s.label}>Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What needs doing?"
              required
              style={s.input}
            />

            <div style={s.row}>
              <div style={s.field}>
                <label style={s.label}>Importance</label>
                <select
                  value={importance}
                  onChange={e => setImportance(e.target.value)}
                  style={s.select}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              <div style={s.field}>
                <label style={s.label}>Due date (optional)</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  style={s.input}
                />
              </div>
            </div>

            {error && <p style={s.error}>{error}</p>}
            {success && <p style={s.success}>Task added!</p>}

            <button type="submit" disabled={submitting} style={s.button}>
              {submitting ? 'Adding…' : 'Add task'}
            </button>
          </form>
        </section>

        {/* ── Open tasks list ── */}
        <section style={s.section}>
          <h2 style={s.sectionTitle}>Open tasks ({tasks.length})</h2>

          {loadingTasks && <p style={s.muted}>Loading…</p>}

          {!loadingTasks && tasks.length === 0 && (
            <p style={s.muted}>No open tasks. Add one above!</p>
          )}

          {tasks.map(task => (
            <div key={task.id} style={s.taskRow}>
              <div style={s.taskInfo}>
                <span style={s.taskTitle}>{task.title}</span>
                <div style={s.taskMeta}>
                  <span style={{ ...s.badge, ...importanceBadge[task.importance] }}>
                    {task.importance}
                  </span>
                  {task.due_date && (
                    <span style={s.dueDate}>
                      Due {new Date(task.due_date + 'T00:00:00').toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleMarkDone(task.id)}
                disabled={markingDone === task.id}
                style={s.doneBtn}
              >
                {markingDone === task.id ? '…' : 'Done'}
              </button>
            </div>
          ))}
        </section>

        {/* ── Wins archive ── */}
        <section style={s.wins}>
          <h2 style={s.winsTitle}>Wins</h2>

          {loadingWins && <p style={s.winsMuted}>Loading…</p>}

          {!loadingWins && wins.length === 0 && (
            <p style={s.winsMuted}>Nothing here yet — mark a task done and it'll appear.</p>
          )}

          {wins.map(win => (
            <div key={win.id} style={s.winRow}>
              <span style={s.winCheck}>✓</span>
              <div style={s.winInfo}>
                <span style={s.winName}>{win.title}</span>
                <span style={s.winDate}>{formatCompleted(win.completed_at)}</span>
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}

const s = {
  page: {
    minHeight: '100vh',
    background: '#f5f5f5',
    fontFamily: 'system-ui, sans-serif',
  },
  main: {
    maxWidth: '640px',
    margin: '0 auto',
    padding: '1.5rem 1rem 3rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  hero: {
    background: '#4f46e5',
    borderRadius: '12px',
    padding: '1.75rem',
    boxShadow: '0 4px 16px rgba(79,70,229,0.3)',
    color: '#fff',
  },
  heroLabel: {
    margin: '0 0 0.5rem',
    fontSize: '0.75rem',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    opacity: 0.7,
  },
  heroTitle: {
    margin: '0 0 0.75rem',
    fontSize: '1.5rem',
    fontWeight: '700',
    lineHeight: 1.3,
  },
  heroMeta: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
  },
  heroEmpty: {
    margin: 0,
    fontSize: '1rem',
    opacity: 0.8,
  },
  heroDueDate: {
    fontSize: '0.85rem',
    opacity: 0.75,
  },
  section: {
    background: '#fff',
    borderRadius: '10px',
    padding: '1.5rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
  },
  sectionTitle: {
    margin: '0 0 1rem',
    fontSize: '1rem',
    fontWeight: '600',
    color: '#374151',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  row: {
    display: 'flex',
    gap: '1rem',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    flex: 1,
  },
  label: {
    fontSize: '0.8rem',
    fontWeight: '600',
    color: '#6b7280',
    marginTop: '0.4rem',
  },
  input: {
    padding: '0.55rem 0.75rem',
    fontSize: '1rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    width: '100%',
    boxSizing: 'border-box',
  },
  select: {
    padding: '0.55rem 0.75rem',
    fontSize: '1rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    background: '#fff',
    width: '100%',
  },
  button: {
    marginTop: '0.75rem',
    padding: '0.65rem',
    fontSize: '1rem',
    background: '#4f46e5',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    alignSelf: 'flex-start',
    paddingLeft: '1.5rem',
    paddingRight: '1.5rem',
  },
  error: {
    color: '#dc2626',
    fontSize: '0.875rem',
    margin: '0.25rem 0 0',
  },
  success: {
    color: '#16a34a',
    fontSize: '0.875rem',
    margin: '0.25rem 0 0',
  },
  muted: {
    color: '#9ca3af',
    fontSize: '0.9rem',
    margin: 0,
  },
  taskRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.75rem 0',
    borderBottom: '1px solid #f3f4f6',
  },
  taskInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
  },
  taskTitle: {
    fontSize: '0.95rem',
    color: '#111827',
  },
  taskMeta: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
  },
  badge: {
    fontSize: '0.7rem',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: '0.15rem 0.5rem',
    borderRadius: '999px',
  },
  dueDate: {
    fontSize: '0.8rem',
    color: '#6b7280',
  },
  doneBtn: {
    flexShrink: 0,
    padding: '0.35rem 0.85rem',
    fontSize: '0.85rem',
    fontWeight: '600',
    color: '#16a34a',
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '6px',
    cursor: 'pointer',
  },

  // ── Wins archive ── dark card so it reads as a different kind of list
  wins: {
    background: '#0f172a',
    borderRadius: '10px',
    padding: '1.5rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.2)',
  },
  winsTitle: {
    margin: '0 0 1rem',
    fontSize: '1rem',
    fontWeight: '700',
    color: '#fbbf24',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  winsMuted: {
    color: '#475569',
    fontSize: '0.9rem',
    margin: 0,
  },
  winRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
    padding: '0.65rem 0',
    borderBottom: '1px solid #1e293b',
  },
  winCheck: {
    color: '#22c55e',
    fontWeight: '700',
    fontSize: '1rem',
    flexShrink: 0,
    marginTop: '1px',
  },
  winInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem',
  },
  winName: {
    fontSize: '0.95rem',
    color: '#e2e8f0',
  },
  winDate: {
    fontSize: '0.78rem',
    color: '#64748b',
  },
}
