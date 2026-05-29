import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ChevronUp, ChevronDown, ArrowRight, ArrowLeft,
  Play, Pause, X, ArrowLeftRight, Landmark, ShieldCheck, RotateCcw,
  Sliders, CheckCircle2, Clock, Layers, Receipt, Check, AlertCircle
} from 'lucide-react'

/* ─────────────────────────────────────────────────────
   Constants
───────────────────────────────────────────────────── */
const STORAGE_KEY = 'hourbank_v4'
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAYS_FULL = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' }
const ITEM_H = 48   // px height per wheel item

/* ─────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────── */
function todayKey() {
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()]
}
function calcDisposable(wakeH, sleepH, meals, classes, work) {
  return Math.max(0, (sleepH - wakeH) * 7 - meals * 7 - classes - work)
}
function distributeByPriority(projects, totalCash) {
  const n = projects.length
  if (n === 0) return []
  const totalWeight = (n * (n + 1)) / 2
  const sorted = [...projects].sort((a, b) => a.priority - b.priority)
  let allocated = 0
  sorted.forEach((p, i) => {
    const w = (n - i) / totalWeight
    p.allocatedCash = Math.floor((totalCash * w) / 50) * 50
    allocated += p.allocatedCash
  })
  if (sorted.length > 0) sorted[0].allocatedCash += totalCash - allocated
  return projects.map(orig => ({ ...orig, ...(sorted.find(s => s.id === orig.id) ?? {}) }))
}
function defaultDailyCash(total) {
  const base = Math.floor((total / 50) / 7) * 50
  const rem = total - base * 7
  const result = {}
  DAYS.forEach((d, i) => { result[d] = base + (i < Math.round(rem / 50) ? 50 : 0) })
  return result
}
function buildCards(projects, dailyCash) {
  return DAYS.flatMap(day =>
    Array.from({ length: Math.floor((dailyCash[day] ?? 0) / 50) }, (_, i) => ({
      id: `${day}-${i}-${Date.now()}`,
      day, projectId: projects[i % projects.length]?.id ?? '',
      value: 50, spent: false,
    }))
  )
}
function rebuildCardsPreservingSpent(newProjects, newDailyCash, existingCards) {
  return DAYS.flatMap(day => {
    const spentCardsForDay = existingCards.filter(c => c.day === day && c.spent)
    const spentValue = spentCardsForDay.length * 50
    const remainingBudget = Math.max(0, (newDailyCash[day] ?? 0) - spentValue)
    const freshCount = Math.floor(remainingBudget / 50)
    
    const freshCards = Array.from({ length: freshCount }, (_, i) => ({
      id: `${day}-f-${Date.now()}-${i}`,
      day,
      projectId: newProjects[i % newProjects.length]?.id ?? '',
      value: 50,
      spent: false,
    }))
    
    return [...spentCardsForDay, ...freshCards]
  })
}

/* ─────────────────────────────────────────────────────
   Wheel Picker
───────────────────────────────────────────────────── */
function WheelPicker({ items, value, onChange, width = 80, label, unit }) {
  const initIdx = Math.max(0, items.findIndex(i => i.value === value))
  const [selIdx, setSelIdx] = useState(initIdx)
  const [liveOffset, setLiveOffset] = useState(0)
  const dragging = useRef(false)
  const startY = useRef(0)
  const selIdxRef = useRef(selIdx)
  const liveRef = useRef(0)
  const [isAnimating, setIsAnimating] = useState(false)

  selIdxRef.current = selIdx
  liveRef.current = liveOffset

  // Sync if value changes externally
  useEffect(() => {
    const idx = items.findIndex(i => i.value === value)
    if (idx >= 0 && idx !== selIdxRef.current) {
      setSelIdx(idx)
      setLiveOffset(0)
    }
  }, [value])

  const snap = useCallback((rawDelta) => {
    const steps = -Math.round(rawDelta / ITEM_H)
    const newIdx = Math.max(0, Math.min(items.length - 1, selIdxRef.current + steps))
    setIsAnimating(true)
    setSelIdx(newIdx)
    setLiveOffset(0)
    onChange(items[newIdx].value)
    setTimeout(() => setIsAnimating(false), 260)
  }, [items, onChange])

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return
      const y = e.clientY ?? e.touches?.[0]?.clientY
      if (y == null) return
      setLiveOffset(y - startY.current)
    }
    const onUp = (e) => {
      if (!dragging.current) return
      dragging.current = false
      const y = e.clientY ?? e.changedTouches?.[0]?.clientY ?? startY.current
      snap(y - startY.current)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [snap])

  const handleDown = (e) => {
    dragging.current = true
    startY.current = e.clientY ?? e.touches?.[0]?.clientY
    setLiveOffset(0)
    setIsAnimating(false)
  }

  // virtualIdx: fractional position (for 3D tilt calc)
  const virtualIdx = selIdx - liveOffset / ITEM_H
  const listTranslateY = liveOffset - selIdx * ITEM_H + (ITEM_H * 2) // center = offset 2

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {label && <span className="wheel-label">{label}</span>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          className="wheel-wrapper"
          style={{ width, height: ITEM_H * 5 }}
          onMouseDown={handleDown}
          onTouchStart={handleDown}
        >
          {/* Selection highlight */}
          <div className="wheel-selection-band" style={{ top: ITEM_H * 2, height: ITEM_H }} />
          {/* Fade masks */}
          <div className="wheel-fade-top" style={{ height: ITEM_H * 1.5 }} />
          <div className="wheel-fade-bottom" style={{ height: ITEM_H * 1.5 }} />
          {/* Scrolling track */}
          <div
            className="wheel-track"
            style={{
              transform: `translateY(${listTranslateY}px)`,
              transition: isAnimating ? `transform 0.25s cubic-bezier(0.25,0.1,0.25,1)` : 'none',
            }}
          >
            {items.map((item, i) => {
              const dist = i - virtualIdx
              const absDist = Math.abs(dist)
              const opacity = Math.max(0.15, 1 - absDist * 0.38)
              const scale = Math.max(0.72, 1 - absDist * 0.07)
              const rotX = Math.sign(dist) * Math.min(55, absDist * 22)
              const isCenter = absDist < 0.6
              return (
                <div
                  key={i}
                  className="wheel-item"
                  style={{
                    height: ITEM_H,
                    fontSize: isCenter ? 22 : 17,
                    fontWeight: isCenter ? 600 : 400,
                    color: isCenter ? 'var(--accent)' : 'var(--text-1)',
                    opacity,
                    transform: `scale(${scale}) perspective(600px) rotateX(${rotX}deg)`,
                    transition: isAnimating ? 'all 0.25s ease' : 'none',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    if (Math.abs(dist) < 0.1) return
                    setIsAnimating(true)
                    const newIdx = Math.max(0, Math.min(items.length - 1, i))
                    setSelIdx(newIdx)
                    setLiveOffset(0)
                    onChange(items[newIdx].value)
                    setTimeout(() => setIsAnimating(false), 260)
                  }}
                >
                  {item.label}
                </div>
              )
            })}
          </div>
        </div>
        {unit && <span className="wheel-unit">{unit}</span>}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────
   Banker Tim (minimal modern SVG)
───────────────────────────────────────────────────── */
function Tim({ mood = 'happy' }) {
  const mouths = {
    happy: 'M 36 58 Q 44 65 52 58',
    anxious: 'M 36 60 Q 44 60 52 60',
    sad: 'M 36 63 Q 44 56 52 63',
  }
  const browL = {
    happy: 'M 26 36 Q 32 33 38 36',
    anxious: 'M 26 34 Q 32 38 38 36',
    sad: 'M 26 35 Q 32 39 38 37',
  }
  const browR = {
    happy: 'M 50 36 Q 56 33 62 36',
    anxious: 'M 50 36 Q 56 38 62 34',
    sad: 'M 50 37 Q 56 39 62 35',
  }
  const colors = { happy: '#30D158', anxious: '#FF9F0A', sad: '#FF453A' }
  return (
    <svg viewBox="0 0 88 88" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background circle */}
      <circle cx="44" cy="44" r="42" fill="#F5F5F7" />
      {/* Mood ring */}
      <circle cx="44" cy="44" r="42" fill="none" stroke={colors[mood]} strokeWidth="3" opacity="0.5" />
      {/* Face */}
      <circle cx="44" cy="48" r="28" fill="white" />
      {/* Hat */}
      <rect x="20" y="22" width="48" height="5" rx="2" fill="#1D1D1F" />
      <rect x="26" y="10" width="36" height="14" rx="3" fill="#1D1D1F" />
      <rect x="22" y="21" width="44" height="3" rx="1" fill={colors[mood]} />
      {/* Eyes */}
      <circle cx="35" cy="47" r="3.5" fill="#1D1D1F" />
      <circle cx="53" cy="47" r="3.5" fill="#1D1D1F" />
      <circle cx="36.5" cy="45.5" r="1.2" fill="white" />
      <circle cx="54.5" cy="45.5" r="1.2" fill="white" />
      {/* Monocle */}
      <circle cx="53" cy="47" r="7" stroke="#FFD60A" strokeWidth="1.8" />
      <line x1="59" y1="53" x2="68" y2="70" stroke="#FFD60A" strokeWidth="1.5" strokeLinecap="round" />
      {/* Eyebrows */}
      <path d={browL[mood]} stroke="#1D1D1F" strokeWidth="2" strokeLinecap="round" />
      <path d={browR[mood]} stroke="#1D1D1F" strokeWidth="2" strokeLinecap="round" />
      {/* Moustache */}
      <path d="M 30 57 Q 44 52 58 57 Q 62 50 57 61 Q 44 55 31 61 Q 26 50 30 57 Z" fill="#6E6E73" />
      {/* Mouth */}
      <path d={mouths[mood]} stroke="#1D1D1F" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/* ─────────────────────────────────────────────────────
   Default State
───────────────────────────────────────────────────── */
const COLORS = {
  blue: { name: 'Ocean Blue', hex: '#0071E3', bg: 'rgba(0, 113, 227, 0.08)', border: 'rgba(0, 113, 227, 0.20)' },
  purple: { name: 'Royal Purple', hex: '#AF52DE', bg: 'rgba(175, 82, 222, 0.08)', border: 'rgba(175, 82, 222, 0.20)' },
  pink: { name: 'Rose Pink', hex: '#FF2D55', bg: 'rgba(255, 45, 85, 0.08)', border: 'rgba(255, 45, 85, 0.20)' },
  orange: { name: 'Sunset Orange', hex: '#FF9500', bg: 'rgba(255, 149, 0, 0.08)', border: 'rgba(255, 149, 0, 0.20)' },
  green: { name: 'Mint Green', hex: '#34C759', bg: 'rgba(52, 199, 89, 0.08)', border: 'rgba(52, 199, 89, 0.20)' },
  teal: { name: 'Teal Blue', hex: '#30B0C7', bg: 'rgba(48, 176, 199, 0.08)', border: 'rgba(48, 176, 199, 0.20)' },
  yellow: { name: 'Sun Yellow', hex: '#FFCC00', bg: 'rgba(255, 204, 0, 0.08)', border: 'rgba(255, 204, 0, 0.20)' },
  indigo: { name: 'Deep Indigo', hex: '#5856D6', bg: 'rgba(88, 86, 214, 0.08)', border: 'rgba(88, 86, 214, 0.20)' }
}
const COLORS_LIST = ['blue', 'purple', 'pink', 'orange', 'green', 'teal', 'yellow', 'indigo']

function makeDefault() {
  const d = calcDisposable(9, 23, 3, 6, 0)
  const totalCash = d * 100
  const projects = distributeByPriority([
    { id: 'p1', name: 'Computer Science', priority: 1, color: 'blue', allocatedCash: 0, spentCash: 0 },
    { id: 'p2', name: 'Arts & Reading',   priority: 2, color: 'purple', allocatedCash: 0, spentCash: 0 },
    { id: 'p3', name: 'Gym & Fitness',    priority: 3, color: 'pink', allocatedCash: 0, spentCash: 0 },
    { id: 'p4', name: 'Side Project',     priority: 4, color: 'orange', allocatedCash: 0, spentCash: 0 },
  ], totalCash)
  const dailyCash = defaultDailyCash(totalCash)
  return {
    step: 1, done: false,
    wakeH: 9, sleepH: 23, meals: 3, classes: 6, work: 0,
    disposable: d, totalCash, dailyCash, projects,
    dailySpent: { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 },
    cards: [], ledger: [], selectedDay: todayKey(),
    timer: null,
    tradeOpen: false, tradeFrom: 'Mon', tradeTo: 'Tue', tradeAmt: 100, tradeFeedback: null,
    borrowOpen: false, borrowAmt: 100,
    excuseOpen: false, excuseText: '',
    settingsOpen: false,
    loginOpen: false,
    user: null,
    token: null,
    syncStatus: 'synced'
  }
}

/* ─────────────────────────────────────────────────────
   Range generators
───────────────────────────────────────────────────── */
const hourItems = (min, max) =>
  Array.from({ length: max - min + 1 }, (_, i) => {
    const h = min + i
    const label = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`
    return { value: h, label }
  })
const numItems = (min, max) =>
  Array.from({ length: max - min + 1 }, (_, i) => ({ value: min + i, label: String(min + i) }))

/* ─────────────────────────────────────────────────────
   Onboarding
───────────────────────────────────────────────────── */
function Onboarding({ state, setState }) {
  const { step, wakeH, sleepH, meals, classes, work, totalCash, projects, dailyCash } = state

  const recalc = (patch) => {
    setState(prev => {
      const next = { ...prev, ...patch }
      const d = calcDisposable(next.wakeH, next.sleepH, next.meals, next.classes, next.work)
      const total = d * 100
      const projs = distributeByPriority(next.projects.map(p => ({ ...p })), total)
      const daily = defaultDailyCash(total)
      return { ...next, disposable: d, totalCash: total, projects: projs, dailyCash: daily }
    })
  }

  const reorder = (idx, dir) => {
    const projs = [...projects]
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= projs.length) return
    const tmp = projs[idx]
    projs[idx] = projs[swapIdx]
    projs[swapIdx] = tmp
    projs.forEach((p, i) => { p.priority = i + 1 })
    setState(s => ({ ...s, projects: distributeByPriority(projs, totalCash) }))
  }

  const addProject = () => {
    if (projects.length >= 8) return
    const nextId = `p-${Date.now()}`
    const newProj = { id: nextId, name: `Project ${projects.length + 1}`, priority: projects.length + 1, color: COLORS_LIST[projects.length % COLORS_LIST.length], allocatedCash: 0, spentCash: 0 }
    const newProjs = [...projects, newProj]
    setState(s => ({ ...s, projects: distributeByPriority(newProjs, totalCash) }))
  }

  const removeProject = (id) => {
    if (projects.length <= 1) return
    const filtered = projects.filter(p => p.id !== id)
    filtered.forEach((p, i) => { p.priority = i + 1 })
    setState(s => ({ ...s, projects: distributeByPriority(filtered, totalCash) }))
  }

  const allocSum = projects.reduce((a, p) => a + p.allocatedCash, 0)
  const balanced = allocSum === totalCash

  const proceed = () => {
    if (step === 5) {
      if (!balanced) return
      const entry = { ts: new Date().toLocaleTimeString(), desc: `Vault opened — $${totalCash.toLocaleString()} deposited`, amt: totalCash, type: 'pos' }
      setState(s => ({ ...s, done: true, dailySpent: { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 }, ledger: [entry] }))
    } else {
      setState(s => ({ ...s, step: s.step + 1 }))
    }
  }
  const back = () => setState(s => ({ ...s, step: Math.max(1, s.step - 1) }))

  const titles = ['', 'Welcome to HourBank', 'Your Active Hours', 'Fixed Commitments', 'Your Projects', 'Approve Budget']
  const subs = [
    '',
    'Your time is finite — treat it like money. 30-minute Focus Cards = $50 each.',
    'Set when your day begins and ends. Everything in between is potential income.',
    `Subtract the hours that aren't yours to spend freely.`,
    'Name and rank your weekly priorities. Higher rank = bigger budget.',
    'Fine-tune your allocation. Total must equal your weekly vault.',
  ]

  return (
    <div className="ob-shell">
      <div className="ob-card">
        {/* Progress */}
        <div className="ob-progress">
          <div className="ob-progress-fill" style={{ width: `${((step - 1) / 4) * 100}%` }} />
        </div>

        <div className="ob-step-label">Step {step} of 5</div>
        <h2>{titles[step]}</h2>
        <p>{subs[step]}</p>

        {step === 1 && (
          <div style={{ textAlign: 'center', paddingTop: '1rem' }}>
            <div className="tim-avatar" style={{ width: 120, height: 120 }}>
              <Tim mood="happy" />
            </div>
            <p style={{ marginTop: '1rem', fontSize: 15 }}>
              "A pleasure to have you at the vault. I am <strong>Banker Tim</strong> —
              your personal time accountant. Together we shall ensure every minute
              earns its keep."
            </p>
            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'center' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setState(s => ({ ...s, loginOpen: true }))}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                🔑 Already have a Vault ID? Sign In
              </button>
            </div>
            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'center', gap: 24, flexWrap: 'wrap' }}>
              {['30 min = $50', '1 hr = $100', 'Spend cards = grow'].map(t => (
                <div key={t} style={{ background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 'var(--r-sm)', padding: '6px 14px', fontSize: 13, fontWeight: 600 }}>{t}</div>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 2: Hours (two wheels) ── */}
        {step === 2 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '3rem', paddingTop: '0.5rem', flexWrap: 'wrap' }}>
            <WheelPicker
              label="Wake Up"
              items={hourItems(5, 11)}
              value={wakeH}
              onChange={v => recalc({ wakeH: v })}
              width={110}
            />
            <WheelPicker
              label="Sleep"
              items={hourItems(17, 24)}
              value={sleepH}
              onChange={v => recalc({ sleepH: v })}
              width={110}
            />
          </div>
        )}

        {/* ── Step 3: Deductions (wheels) ── */}
        {step === 3 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', paddingTop: '0.5rem', flexWrap: 'wrap' }}>
            <WheelPicker label="Meals / day" unit="hrs" items={numItems(1, 5)} value={meals} onChange={v => recalc({ meals: v })} width={80} />
            <WheelPicker label="Classes / week" unit="hrs" items={numItems(0, 30)} value={classes} onChange={v => recalc({ classes: v })} width={80} />
            <WheelPicker label="Work / week" unit="hrs" items={numItems(0, 50)} value={work} onChange={v => recalc({ work: v })} width={80} />
          </div>
        )}

        {/* Disposable banner for step 2 & 3 */}
        {(step === 2 || step === 3) && (
          <div style={{ textAlign: 'center', marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--accent)' }}>
              ${totalCash.toLocaleString()}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
              weekly vault ({state.disposable} disposable hours)
            </div>
          </div>
        )}

        {/* ── Step 4: Projects ── */}
        {step === 4 && (
          <div className="project-list" style={{ paddingTop: '0.5rem' }}>
            {projects.map((p, i) => (
              <div key={p.id} className="project-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px', padding: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="rank-num">{i + 1}</div>
                  <input
                    value={p.name}
                    placeholder={`Project ${i + 1}`}
                    onChange={e => setState(s => ({ ...s, projects: s.projects.map(pr => pr.id === p.id ? { ...pr, name: e.target.value } : pr) }))}
                    style={{ flex: 1 }}
                  />
                  <div className="reorder-btns">
                    <button className="reorder-btn" disabled={i === 0} onClick={() => reorder(i, 'up')}><ChevronUp size={11} /></button>
                    <button className="reorder-btn" disabled={i === projects.length - 1} onClick={() => reorder(i, 'down')}><ChevronDown size={11} /></button>
                  </div>
                  {projects.length > 1 && (
                    <button className="remove-proj-btn" onClick={() => removeProject(p.id)} title="Remove project">
                      <X size={14} />
                    </button>
                  )}
                </div>
                {/* Color swatches picker */}
                <div className="color-picker" style={{ paddingLeft: '32px' }}>
                  {COLORS_LIST.map(colorKey => {
                    const c = COLORS[colorKey]
                    return (
                      <button
                        key={colorKey}
                        className={`color-swatch ${p.color === colorKey ? 'active' : ''}`}
                        style={{ backgroundColor: c.hex }}
                        onClick={() => setState(s => ({ ...s, projects: s.projects.map(pr => pr.id === p.id ? { ...pr, color: colorKey } : pr) }))}
                        title={c.name}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
            {projects.length < 8 && (
              <button className="add-proj-btn" onClick={addProject}>
                + Add Project
              </button>
            )}
          </div>
        )}

        {/* ── Step 5: Allocate ── */}
        {step === 5 && (
          <>
            <div className={`balance-pill ${balanced ? 'ok' : 'bad'}`}>
              {balanced ? <Check size={13} /> : <AlertCircle size={13} />}
              {balanced ? `Balanced — $${totalCash.toLocaleString()} allocated` : `$${allocSum.toLocaleString()} of $${totalCash.toLocaleString()} — adjust to match`}
            </div>
            <div className="alloc-list">
              {projects.map(p => {
                const pct = totalCash > 0 ? (p.allocatedCash / totalCash) * 100 : 0
                return (
                  <div key={p.id} className="alloc-item">
                    <div className="alloc-header">
                      <span className="alloc-name">{p.name}</span>
                      <span className="alloc-val">${p.allocatedCash} <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>({p.allocatedCash / 100}h)</span></span>
                    </div>
                    <input
                      type="range" min={0} max={totalCash} step={50}
                      value={p.allocatedCash}
                      style={{ '--pct': `${pct}%` }}
                      onChange={e => setState(s => ({ ...s, projects: s.projects.map(pr => pr.id === p.id ? { ...pr, allocatedCash: +e.target.value } : pr) }))}
                    />
                  </div>
                )
              })}
            </div>
          </>
        )}

        <div className="ob-footer">
          <button className="btn btn-secondary" onClick={back} disabled={step === 1}>
            <ArrowLeft size={15} /> Back
          </button>
          <button className="btn btn-primary" onClick={proceed} disabled={step === 5 && !balanced}>
            {step === 5 ? 'Open Vault' : 'Continue'} <ArrowRight size={15} />
          </button>
        </div>
      </div>
      {state.loginOpen && <LoginModal state={state} setState={setState} onClose={() => setState(s => ({ ...s, loginOpen: false }))} />}
    </div>
  )
}

/* ─────────────────────────────────────────────────────
   Timer Overlay
───────────────────────────────────────────────────── */
function TimerOverlay({ timer, projects, onStart, onPause, onCancel, onCheat }) {
  const project = projects.find(p => p.id === timer?.projectId)
  const total = 1800
  const secs = timer?.seconds ?? total
  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')

  const r = 80
  const circ = 2 * Math.PI * r
  const pct = secs / total
  const offset = circ * (1 - pct)

  return (
    <div className="overlay">
      <div className="timer-sheet">
        <div className="timer-project">{project?.name ?? 'Focus Session'}</div>
        <div className="timer-sub">30-min card · worth $50</div>
        <div className="timer-ring-wrap">
          <svg viewBox="0 0 200 200">
            <circle className="timer-track" cx="100" cy="100" r={r} />
            <circle
              className="timer-fill"
              cx="100" cy="100" r={r}
              strokeDasharray={circ}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="timer-text-wrap">
            <div className="timer-countdown">{mm}:{ss}</div>
            <div className="timer-val">$50</div>
          </div>
        </div>
        <div className="timer-btns">
          {timer?.running
            ? <button className="btn btn-secondary" onClick={onPause}><Pause size={15} /> Pause</button>
            : <button className="btn btn-primary" onClick={onStart}><Play size={15} /> Start</button>
          }
          <button className="btn btn-icon" onClick={onCancel}><X size={18} /></button>
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <button className="timer-cheat" onClick={onCheat}>⚡ Skip (dev)</button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────
   Modals
───────────────────────────────────────────────────── */
function TradeModal({ state, setState, onClose, onExecute }) {
  const { tradeFrom, tradeTo, tradeAmt, tradeFeedback, dailyCash } = state
  return (
    <div className="overlay">
      <div className="modal-sheet">
        <div className="modal-header">
          <h3><ArrowLeftRight size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Day Trading</h3>
          <button className="btn btn-icon btn-sm" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="modal-desc">Swap allowance between days. Your weekly total stays the same.</p>
        {tradeFeedback && <div className={`feedback-pill ${tradeFeedback.ok ? 'ok' : 'err'}`}>{tradeFeedback.msg}</div>}
        <div className="modal-row">
          <label>From</label>
          <select value={tradeFrom} onChange={e => setState(s => ({ ...s, tradeFrom: e.target.value }))}>
            {DAYS.map(d => <option key={d} value={d}>{d} — ${dailyCash[d] ?? 0}</option>)}
          </select>
        </div>
        <div className="modal-row">
          <label>To</label>
          <select value={tradeTo} onChange={e => setState(s => ({ ...s, tradeTo: e.target.value }))}>
            {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="modal-row">
          <label>Amount</label>
          <select value={tradeAmt} onChange={e => setState(s => ({ ...s, tradeAmt: +e.target.value }))}>
            {[50, 100, 150, 200, 300].map(v => <option key={v} value={v}>${v} ({v / 100}h)</option>)}
          </select>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={onExecute}>Swap</button>
        </div>
      </div>
    </div>
  )
}

function BorrowModal({ state, setState, onClose, onExecute }) {
  return (
    <div className="overlay">
      <div className="modal-sheet">
        <div className="modal-header">
          <h3><Landmark size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Emergency Overdraft</h3>
          <button className="btn btn-icon btn-sm" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="modal-desc">Adds budget to today. <span style={{ color: 'var(--red)', fontWeight: 600 }}>Creates time debt</span> — Tim gets anxious and your city gets mortgaged until the week resets.</p>
        <div className="modal-row">
          <label>Amount</label>
          <select value={state.borrowAmt} onChange={e => setState(s => ({ ...s, borrowAmt: +e.target.value }))}>
            {[50, 100, 200].map(v => <option key={v} value={v}>${v}</option>)}
          </select>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger btn-sm" onClick={onExecute}>Authorize</button>
        </div>
      </div>
    </div>
  )
}

function ExcuseModal({ state, setState, onClose, onExecute }) {
  return (
    <div className="overlay">
      <div className="modal-sheet">
        <div className="modal-header">
          <h3><ShieldCheck size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Submit Pardon</h3>
          <button className="btn btn-icon btn-sm" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="modal-desc">Explain unspent cards. A valid reason protects your city from decay.</p>
        <div className="field">
          <label className="field-label">Reason</label>
          <input type="text" value={state.excuseText}
            onChange={e => setState(s => ({ ...s, excuseText: e.target.value }))}
            placeholder="e.g. Sick day, wedding, hospital visit…" />
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={onExecute}>Submit</button>
        </div>
      </div>
    </div>
  )
}

function SettingsModal({ state, setState, onClose }) {
  const [wakeH, setWakeH] = useState(state.wakeH)
  const [sleepH, setSleepH] = useState(state.sleepH)
  const [meals, setMeals] = useState(state.meals)
  const [classes, setClasses] = useState(state.classes)
  const [work, setWork] = useState(state.work)
  const [projects, setProjects] = useState(state.projects.map(p => ({ ...p })))

  const disposable = calcDisposable(wakeH, sleepH, meals, classes, work)
  const totalCash = disposable * 100

  const updateTimes = (patch) => {
    const next = { wakeH, sleepH, meals, classes, work, ...patch }
    const nextDisp = calcDisposable(next.wakeH, next.sleepH, next.meals, next.classes, next.work)
    const nextTotal = nextDisp * 100
    setWakeH(next.wakeH)
    setSleepH(next.sleepH)
    setMeals(next.meals)
    setClasses(next.classes)
    setWork(next.work)
    setProjects(distributeByPriority(projects.map(p => ({ ...p })), nextTotal))
  }

  const addProject = () => {
    if (projects.length >= 8) return
    const nextId = `p-${Date.now()}`
    const newProj = { id: nextId, name: `Project ${projects.length + 1}`, priority: projects.length + 1, color: COLORS_LIST[projects.length % COLORS_LIST.length], allocatedCash: 0, spentCash: 0 }
    setProjects(distributeByPriority([...projects, newProj], totalCash))
  }

  const removeProject = (id) => {
    if (projects.length <= 1) return
    const filtered = projects.filter(p => p.id !== id)
    filtered.forEach((p, i) => { p.priority = i + 1 })
    setProjects(distributeByPriority(filtered, totalCash))
  }

  const reorder = (idx, dir) => {
    const nextProjs = [...projects]
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= nextProjs.length) return
    const tmp = nextProjs[idx]
    nextProjs[idx] = nextProjs[swapIdx]
    nextProjs[swapIdx] = tmp
    nextProjs.forEach((p, i) => { p.priority = i + 1 })
    setProjects(distributeByPriority(nextProjs, totalCash))
  }

  const handleNameChange = (id, newName) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name: newName } : p))
  }

  const handleAllocChange = (id, amt) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, allocatedCash: amt } : p))
  }

  const allocSum = projects.reduce((a, p) => a + p.allocatedCash, 0)
  const balanced = allocSum === totalCash

  const handleSave = () => {
    if (!balanced) return
    setState(s => {
      const newDaily = defaultDailyCash(totalCash)
      const newCards = rebuildCardsPreservingSpent(projects, newDaily, s.cards)
      const entry = { ts: new Date().toLocaleTimeString(), desc: `Vault settings updated — $${totalCash.toLocaleString()} vault`, amt: totalCash - s.totalCash, type: 'neutral' }
      return {
        ...s,
        wakeH, sleepH, meals, classes, work,
        disposable, totalCash,
        projects,
        dailyCash: newDaily,
        cards: newCards,
        ledger: [entry, ...s.ledger],
        settingsOpen: false
      }
    })
  }

  return (
    <div className="overlay">
      <div className="settings-sheet">
        <div className="modal-header" style={{ marginBottom: '1.5rem' }}>
          <h3>⚙️ Vault Settings</h3>
          <button className="btn btn-icon btn-sm" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Section 1: Active Hours & Commitment */}
        <div className="settings-section">
          <div className="settings-section-title">Active Hours & Commitment</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
            <div className="modal-row" style={{ margin: 0 }}>
              <label>Wake Up</label>
              <select value={wakeH} onChange={e => updateTimes({ wakeH: +e.target.value })}>
                {hourItems(5, 11).map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select>
            </div>
            <div className="modal-row" style={{ margin: 0 }}>
              <label>Sleep</label>
              <select value={sleepH} onChange={e => updateTimes({ sleepH: +e.target.value })}>
                {hourItems(17, 24).map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
            <div className="modal-row" style={{ margin: 0 }}>
              <label>Meals</label>
              <select value={meals} onChange={e => updateTimes({ meals: +e.target.value })}>
                {numItems(1, 5).map(n => <option key={n.value} value={n.value}>{n.label}h/d</option>)}
              </select>
            </div>
            <div className="modal-row" style={{ margin: 0 }}>
              <label>Classes</label>
              <select value={classes} onChange={e => updateTimes({ classes: +e.target.value })}>
                {numItems(0, 30).map(n => <option key={n.value} value={n.value}>{n.label}h/w</option>)}
              </select>
            </div>
            <div className="modal-row" style={{ margin: 0 }}>
              <label>Work</label>
              <select value={work} onChange={e => updateTimes({ work: +e.target.value })}>
                {numItems(0, 50).map(n => <option key={n.value} value={n.value}>{n.label}h/w</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Section 2: Vault Summary */}
        <div className="settings-vault-tag">
          Weekly Vault Balance: <strong>${totalCash.toLocaleString()}</strong>
          <span>({disposable} disposable hours)</span>
        </div>

        {/* Section 3: Projects */}
        <div className="settings-section" style={{ marginTop: '1.5rem' }}>
          <div className="settings-section-title">Projects & Priorities</div>
          <div className="project-list">
            {projects.map((p, i) => (
              <div key={p.id} className="project-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px', padding: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="rank-num">{i + 1}</div>
                  <input
                    value={p.name}
                    placeholder={`Project ${i + 1}`}
                    onChange={e => handleNameChange(p.id, e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <div className="reorder-btns">
                    <button className="reorder-btn" disabled={i === 0} onClick={() => reorder(i, 'up')}><ChevronUp size={11} /></button>
                    <button className="reorder-btn" disabled={i === projects.length - 1} onClick={() => reorder(i, 'down')}><ChevronDown size={11} /></button>
                  </div>
                  {projects.length > 1 && (
                    <button className="remove-proj-btn" onClick={() => removeProject(p.id)} title="Remove project">
                      <X size={14} />
                    </button>
                  )}
                </div>
                {/* Color swatches picker */}
                <div className="color-picker" style={{ paddingLeft: '32px' }}>
                  {COLORS_LIST.map(colorKey => {
                    const c = COLORS[colorKey]
                    return (
                      <button
                        key={colorKey}
                        className={`color-swatch ${p.color === colorKey ? 'active' : ''}`}
                        style={{ backgroundColor: c.hex }}
                        onClick={() => setProjects(prev => prev.map(pr => pr.id === p.id ? { ...pr, color: colorKey } : pr))}
                        title={c.name}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
            {projects.length < 8 && (
              <button className="add-proj-btn" onClick={addProject}>
                + Add Project
              </button>
            )}
          </div>
        </div>

        {/* Section 4: Budget Allocation */}
        <div className="settings-section">
          <div className="settings-section-title">Budget Allocation</div>
          <div className={`balance-pill ${balanced ? 'ok' : 'bad'}`} style={{ width: '100%', justifyContent: 'center' }}>
            {balanced ? <Check size={13} /> : <AlertCircle size={13} />}
            {balanced ? `Balanced — $${totalCash.toLocaleString()} allocated` : `$${allocSum.toLocaleString()} of $${totalCash.toLocaleString()} — adjust to match`}
          </div>
          <div className="alloc-list">
            {projects.map(p => {
              const pct = totalCash > 0 ? (p.allocatedCash / totalCash) * 100 : 0
              return (
                <div key={p.id} className="alloc-item">
                  <div className="alloc-header">
                    <span className="alloc-name">{p.name}</span>
                    <span className="alloc-val">${p.allocatedCash} <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>({p.allocatedCash / 100}h)</span></span>
                  </div>
                  <input
                    type="range" min={0} max={totalCash} step={50}
                    value={p.allocatedCash}
                    style={{ '--pct': `${pct}%` }}
                    onChange={e => handleAllocChange(p.id, +e.target.value)}
                  />
                </div>
              )
            })}
          </div>
        </div>

        <div className="modal-footer" style={{ marginTop: '2rem' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!balanced}>Save & Apply</button>
        </div>
      </div>
    </div>
  )
}

function LoginModal({ state, setState, onClose }) {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) { setError('Please enter both email and password.'); return }
    setError(null)
    setLoading(true)

    const endpoint = isSignUp ? '/api/signup' : '/api/login'

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to authenticate')
      }

      // Success! Update global state with session & fetched cloud state
      setState(s => ({
        ...s,
        ...data.state, // Load the synced state from cloud
        token: data.session.access_token,
        user: data.session.user,
        loginOpen: false,
        syncStatus: 'synced'
      }))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="overlay">
      <div className="modal-sheet" style={{ maxWidth: '380px' }}>
        <div className="modal-header" style={{ marginBottom: '1.25rem' }}>
          <h3>🔑 HourBank Vault ID</h3>
          <button className="btn btn-icon btn-sm" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Tab Selection */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', padding: '4px', marginBottom: '1.5rem' }}>
          <button
            className="btn btn-sm"
            type="button"
            style={{
              background: !isSignUp ? 'var(--surface)' : 'none',
              color: 'var(--text-1)',
              border: 'none',
              boxShadow: !isSignUp ? 'var(--shadow-xs)' : 'none',
              fontWeight: 600
            }}
            onClick={() => { setIsSignUp(false); setError(null) }}
          >
            Sign In
          </button>
          <button
            className="btn btn-sm"
            type="button"
            style={{
              background: isSignUp ? 'var(--surface)' : 'none',
              color: 'var(--text-1)',
              border: 'none',
              boxShadow: isSignUp ? 'var(--shadow-xs)' : 'none',
              fontWeight: 600
            }}
            onClick={() => { setIsSignUp(true); setError(null) }}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="feedback-pill err" style={{ fontSize: '12px', lineHeight: '1.4', marginBottom: '1rem', backgroundColor: 'var(--red-soft)', color: 'var(--red)', padding: '8px 12px', borderRadius: '8px' }}>
              ⚠️ {error}
            </div>
          )}

          <div className="modal-row" style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', color: 'var(--text-3)', display: 'block', marginBottom: '6px' }}>Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="name@email.com"
              style={{
                width: '100%', height: '44px', padding: '0 12px',
                background: 'var(--surface-2)', border: '1.5px solid transparent',
                borderRadius: 'var(--r-sm)', fontSize: '15px', outline: 'none',
                color: 'var(--text-1)'
              }}
            />
          </div>

          <div className="modal-row" style={{ marginBottom: '1.5rem' }}>
            <label style={{ fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', color: 'var(--text-3)', display: 'block', marginBottom: '6px' }}>Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: '100%', height: '44px', padding: '0 12px',
                background: 'var(--surface-2)', border: '1.5px solid transparent',
                borderRadius: 'var(--r-sm)', fontSize: '15px', outline: 'none',
                color: 'var(--text-1)'
              }}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {loading ? 'Verifying...' : isSignUp ? 'Create Vault ID' : 'Open Vault'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          <button
            className="timer-cheat"
            onClick={onClose}
            style={{ fontSize: '12px', border: 'none', background: 'none' }}
          >
            Run as Guest (Local Only)
          </button>
        </div>
      </div>
    </div>
  )
}


function ConstructionSiteSVG({ colorHex }) {
  return (
    <svg viewBox="0 0 80 80" width="60" height="60" style={{ overflow: 'visible' }}>
      <path d="M 5 65 L 75 65 L 70 75 L 10 75 Z" fill="#8B5A2B" />
      <rect x="5" y="62" width="70" height="3" rx="1.5" fill="#5C4033" />
      <line x1="20" y1="30" x2="20" y2="62" stroke="#AEAEB2" strokeWidth="2.5" />
      <line x1="45" y1="30" x2="45" y2="62" stroke="#AEAEB2" strokeWidth="2.5" />
      <line x1="15" y1="38" x2="50" y2="38" stroke="#AEAEB2" strokeWidth="2" />
      <line x1="15" y1="50" x2="50" y2="50" stroke="#AEAEB2" strokeWidth="2" />
      <line x1="20" y1="38" x2="45" y2="50" stroke="#E8E8ED" strokeWidth="1.5" strokeDasharray="2,2" />
      <line x1="45" y1="38" x2="20" y2="50" stroke="#E8E8ED" strokeWidth="1.5" strokeDasharray="2,2" />
      <line x1="55" y1="15" x2="55" y2="62" stroke="#FF9500" strokeWidth="3" />
      <line x1="35" y1="20" x2="70" y2="20" stroke="#FF9500" strokeWidth="2.5" />
      <path d="M 35 20 L 55 12 Z" stroke="#FF9500" strokeWidth="2" />
      <line x1="40" y1="20" x2="40" y2="32" stroke="#6E6E73" strokeWidth="1" />
      <rect x="38" y="32" width="4" height="4" fill="#FF9500" />
      <rect x="18" y="52" width="22" height="8" fill="#FFCC00" rx="1" stroke="#FF9500" strokeWidth="1" />
      <line x1="22" y1="56" x2="36" y2="56" stroke="#1D1D1F" strokeWidth="1.5" />
      <polygon points="10,62 13,62 11.5,55" fill="#FF9500" />
      <polygon points="70,62 73,62 71.5,55" fill="#FF9500" />
    </svg>
  )
}

function CottageSVG({ colorHex }) {
  return (
    <svg viewBox="0 0 80 80" width="60" height="60" style={{ overflow: 'visible' }}>
      <path d="M 5 65 Q 40 60 75 65 L 70 75 L 10 75 Z" fill="#30D158" opacity="0.85" />
      <rect x="52" y="24" width="6" height="14" fill="#6E6E73" rx="1" />
      <circle cx="55" cy="16" r="3" fill="#AEAEB2" opacity="0.6" />
      <circle cx="57" cy="10" r="4.5" fill="#AEAEB2" opacity="0.4" />
      <rect x="22" y="34" width="36" height="28" fill="#F5F5F7" stroke="#E8E8ED" strokeWidth="1.5" rx="3" />
      <polygon points="18,36 58,36 38,18" fill={colorHex} />
      <rect x="28" y="40" width="8" height="8" rx="1.5" fill="#FFD60A" stroke="#E8E8ED" strokeWidth="1" />
      <line x1="32" y1="40" x2="32" y2="48" stroke="#FF9500" strokeWidth="0.8" />
      <line x1="28" y1="44" x2="36" y2="44" stroke="#FF9500" strokeWidth="0.8" />
      <rect x="42" y="44" width="10" height="18" fill="#8B5A2B" rx="1" />
      <circle cx="45" cy="53" r="1" fill="#FFD60A" />
    </svg>
  )
}

function ApartmentSVG({ colorHex }) {
  return (
    <svg viewBox="0 0 80 80" width="60" height="60" style={{ overflow: 'visible' }}>
      <path d="M 5 65 L 75 65 L 72 75 L 8 75 Z" fill="#AEAEB2" />
      <rect x="24" y="16" width="32" height="49" fill="#FFFFFF" stroke="#E8E8ED" strokeWidth="1.5" rx="4" />
      <rect x="22" y="12" width="36" height="4" fill={colorHex} rx="2" />
      <path d="M 28 12 Q 26 6 29 6 C 32 6 30 12 30 12" stroke="#30D158" strokeWidth="1.5" fill="none" />
      <rect x="29" y="20" width="6" height="7" rx="1" fill="#FFD60A" />
      <rect x="45" y="20" width="6" height="7" rx="1" fill="#E8E8ED" />
      
      <rect x="29" y="32" width="6" height="7" rx="1" fill="#E8E8ED" />
      <rect x="45" y="32" width="6" height="7" rx="1" fill="#FFD60A" />
      
      <rect x="29" y="44" width="6" height="7" rx="1" fill="#FFD60A" />
      <rect x="45" y="44" width="6" height="7" rx="1" fill="#FFD60A" />
      <rect x="27" y="36" width="10" height="4" fill="none" stroke="#6E6E73" strokeWidth="1" />
      <rect x="36" y="53" width="8" height="12" fill="#1D1D1F" rx="1" />
      <rect x="38" y="55" width="4" height="10" fill="#FFD60A" opacity="0.8" />
    </svg>
  )
}

function SkyscraperSVG({ colorHex }) {
  return (
    <svg viewBox="0 0 80 80" width="60" height="60" style={{ overflow: 'visible' }}>
      <path d="M 5 65 L 75 65 L 73 75 L 7 75 Z" fill="#1D1D1F" />
      <rect x="26" y="10" width="28" height="55" fill="#FFFFFF" stroke="#E8E8ED" strokeWidth="1.5" rx="3" />
      <rect x="23" y="12" width="3" height="51" fill={colorHex} rx="1" />
      <rect x="54" y="12" width="3" height="51" fill={colorHex} rx="1" />
      <line x1="40" y1="10" x2="40" y2="2" stroke="#AEAEB2" strokeWidth="1.5" />
      <circle cx="40" cy="2" r="1.8" fill={colorHex} />
      <rect x="29" y="14" width="22" height="5" rx="0.5" fill="#FFD60A" opacity="0.9" />
      
      <rect x="30" y="23" width="4" height="4" fill="#FFD60A" rx="0.5" />
      <rect x="38" y="23" width="4" height="4" fill="#E8E8ED" rx="0.5" />
      <rect x="46" y="23" width="4" height="4" fill="#FFD60A" rx="0.5" />
      
      <rect x="30" y="31" width="4" height="4" fill="#E8E8ED" rx="0.5" />
      <rect x="38" y="31" width="4" height="4" fill="#FFD60A" rx="0.5" />
      <rect x="46" y="31" width="4" height="4" fill="#FFD60A" rx="0.5" />
      
      <rect x="30" y="39" width="4" height="4" fill="#FFD60A" rx="0.5" />
      <rect x="38" y="39" width="4" height="4" fill="#E8E8ED" rx="0.5" />
      <rect x="46" y="39" width="4" height="4" fill="#FFD60A" rx="0.5" />

      <rect x="30" y="47" width="4" height="4" fill="#FFD60A" rx="0.5" />
      <rect x="38" y="47" width="4" height="4" fill="#FFD60A" rx="0.5" />
      <rect x="46" y="47" width="4" height="4" fill="#E8E8ED" rx="0.5" />
      
      <rect x="36" y="57" width="8" height="8" fill="#1D1D1F" rx="1" />
      <line x1="40" y1="57" x2="40" y2="65" stroke="#FFCC00" strokeWidth="1" />
    </svg>
  )
}

function TimeCityBuilding({ project, overdrafted }) {
  const pct = project.allocatedCash > 0 ? (project.spentCash / project.allocatedCash) * 100 : 0
  const colorHex = COLORS[project.color]?.hex ?? '#0071E3'
  
  let BuildingComponent = ConstructionSiteSVG
  
  if (pct >= 100) {
    BuildingComponent = SkyscraperSVG
  } else if (pct >= 70) {
    BuildingComponent = ApartmentSVG
  } else if (pct >= 30) {
    BuildingComponent = CottageSVG
  }

  return (
    <div className="city-bar-wrap" style={{ opacity: overdrafted ? 0.55 : 1, transition: 'all 0.3s ease', position: 'relative' }}>
      <div style={{ position: 'relative', width: '100%', height: '64px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', filter: overdrafted ? 'grayscale(80%)' : 'none' }}>
        <BuildingComponent colorHex={colorHex} />
        {overdrafted && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '9px', color: 'var(--red)', fontWeight: '700',
            backgroundColor: 'rgba(255, 69, 58, 0.08)', borderRadius: '6px',
            border: '1px dashed var(--red)', height: '60px', pointerEvents: 'none'
          }}>
            MORTGAGED
          </div>
        )}
      </div>
      <span className="city-bar-lbl" title={`${project.name} (${Math.round(pct)}%)`} style={{ marginTop: '8px' }}>
        {project.name.split(' ')[0]} ({Math.round(pct)}%)
      </span>
    </div>
  )
}

/* ─────────────────────────────────────────────────────
   Dashboard
───────────────────────────────────────────────────── */
function Dashboard({ state, setState }) {
  const { totalCash, dailyCash, projects, cards, ledger, selectedDay,
          timer, tradeOpen, borrowOpen, excuseOpen, settingsOpen,
          loginOpen, user, token, syncStatus } = state
  const timerRef = useRef(null)

  // Timer tick
  useEffect(() => {
    if (timer?.running) {
      timerRef.current = setInterval(() => {
        setState(s => {
          if (!s.timer) return s
          const secs = s.timer.seconds - 1
          if (secs <= 0) { clearInterval(timerRef.current); return completeCard(s) }
          return { ...s, timer: { ...s.timer, seconds: secs } }
        })
      }, 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [timer?.running])

  function completeCard(s) {
    const projId = s.timer?.projectId
    if (!projId) return { ...s, timer: null }
    const proj = s.projects.find(p => p.id === projId)
    const entry = { ts: new Date().toLocaleTimeString(), desc: `30m Focus on "${proj?.name ?? '—'}"`, amt: -50, type: 'neg' }
    const nextDailySpent = {
      ...s.dailySpent,
      [s.selectedDay]: (s.dailySpent[s.selectedDay] ?? 0) + 50
    }
    return {
      ...s, timer: null,
      projects: s.projects.map(p => p.id === projId ? { ...p, spentCash: Math.min(p.allocatedCash, p.spentCash + 50) } : p),
      dailySpent: nextDailySpent,
      ledger: [entry, ...s.ledger],
    }
  }

  // Metrics
  const totalSpent = projects.reduce((a, p) => a + p.spentCash, 0)
  const weekRemaining = Math.max(0, totalCash - totalSpent)
  const dayBudget = dailyCash[selectedDay] ?? 0
  const daySpent = state.dailySpent?.[selectedDay] ?? 0
  const dayRemaining = Math.max(0, dayBudget - daySpent)
  const todayIdx = DAYS.indexOf(todayKey())
  const pastUnspentCash = DAYS.slice(0, todayIdx).reduce((sum, d) => sum + Math.max(0, (dailyCash[d] ?? 0) - (state.dailySpent?.[d] ?? 0)), 0)
  const pastUnspent = pastUnspentCash / 50
  const overdrafted = ledger.some(e => e.desc?.includes('OVERDRAFT'))
  const mood = overdrafted ? 'anxious' : pastUnspent > 2 ? 'sad' : 'happy'

  const moodQuotes = {
    happy: '"Your ledger is immaculate. I am most pleased."',
    anxious: '"We\'ve entered overdraft! Please exercise restraint!"',
    sad: '"Several cards remain unspent. Most troubling…"',
  }

  // Actions
  function startTimer(projectId) {
    setState(s => ({ ...s, timer: { projectId, seconds: 1800, running: false } }))
  }
  function executeTrade() {
    const { tradeFrom, tradeTo, tradeAmt, dailyCash, ledger } = state
    if (tradeFrom === tradeTo) { setState(s => ({ ...s, tradeFeedback: { ok: false, msg: 'Source and target must differ.' } })); return }
    const avail = dailyCash[tradeFrom] ?? 0
    if (avail < tradeAmt) { setState(s => ({ ...s, tradeFeedback: { ok: false, msg: `${tradeFrom} only has $${avail}.` } })); return }
    const newDaily = { ...dailyCash, [tradeFrom]: avail - tradeAmt, [tradeTo]: (dailyCash[tradeTo] ?? 0) + tradeAmt }
    const entry = { ts: new Date().toLocaleTimeString(), desc: `Swap $${tradeAmt}: ${tradeFrom}→${tradeTo}`, amt: 0, type: 'neutral' }
    setState(s => ({ ...s, dailyCash: newDaily, ledger: [entry, ...ledger], tradeOpen: false, tradeFeedback: null }))
  }
  function executeBorrow() {
    const { borrowAmt, selectedDay, dailyCash, ledger } = state
    const newDaily = { ...dailyCash, [selectedDay]: (dailyCash[selectedDay] ?? 0) + borrowAmt }
    const entry = { ts: new Date().toLocaleTimeString(), desc: `OVERDRAFT +$${borrowAmt} on ${selectedDay}`, amt: borrowAmt, type: 'pos' }
    setState(s => ({ ...s, dailyCash: newDaily, ledger: [entry, ...ledger], borrowOpen: false }))
  }
  function executeExcuse() {
    if (!state.excuseText.trim()) return
    const entry = { ts: new Date().toLocaleTimeString(), desc: `Pardon: "${state.excuseText}"`, amt: 0, type: 'neutral' }
    setState(s => ({ ...s, ledger: [entry, ...s.ledger], excuseOpen: false, excuseText: '' }))
  }
  function resetWeek() {
    if (!confirm('Reset week? Spent cash clears, your setup stays.')) return
    setState(s => ({
      ...s,
      projects: s.projects.map(p => ({ ...p, spentCash: 0 })),
      dailySpent: { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 },
      ledger: [{ ts: new Date().toLocaleTimeString(), desc: 'Weekly reset — new fiscal week', amt: totalCash, type: 'pos' }],
    }))
  }

  return (
    <div className="dashboard">
      {/* Header */}
      <div className="dashboard-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', letterSpacing: '-0.03em' }}>HourBank</h1>
          <p style={{ fontSize: 13, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>Time is money. Spend it wisely.</span>
            <span style={{ color: 'var(--text-3)' }}>·</span>
            {user ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '12px', color: syncStatus === 'error' ? 'var(--red)' : syncStatus === 'syncing' ? 'var(--text-2)' : '#1A7A33', fontWeight: '500' }}>
                {syncStatus === 'syncing' ? '🔄' : '☁️'} {syncStatus === 'syncing' ? 'Syncing...' : syncStatus === 'error' ? 'Sync Error' : 'Cloud Synced'}
              </span>
            ) : (
              <span style={{ fontSize: '12px', color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                ☁️ Local Guest
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* User Auth control */}
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-2)', background: 'var(--surface-2)', padding: '6px 12px', borderRadius: '980px', border: '1px solid var(--border)' }}>
                👤 {user.email}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  if (confirm('Log out? Your local storage will remain, but cloud syncing will be suspended.')) {
                    setState(s => ({ ...s, user: null, token: null, syncStatus: 'synced' }))
                  }
                }}
              >
                Log Out
              </button>
            </div>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => setState(s => ({ ...s, loginOpen: true }))}>
              🔑 Sign In
            </button>
          )}

          <button className="btn btn-secondary btn-sm" onClick={() => setState(s => ({ ...s, tradeOpen: true, tradeFeedback: null }))}><ArrowLeftRight size={13} /> Trade</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setState(s => ({ ...s, borrowOpen: true }))}><Landmark size={13} /> Overdraft</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setState(s => ({ ...s, excuseOpen: true }))}><ShieldCheck size={13} /> Pardon</button>
          <button className="btn btn-icon btn-sm" style={{ fontSize: 13 }} onClick={resetWeek} title="Reset week"><RotateCcw size={14} /></button>
          <button className="btn btn-icon btn-sm" style={{ fontSize: 13 }} onClick={() => setState(s => ({ ...s, settingsOpen: true }))} title="Adjust"><Sliders size={14} /></button>
        </div>
      </div>

      {/* Hero */}
      <div className="dashboard-hero">
        <div className="hero-bg" />
        <div style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', marginBottom: 8 }}>Weekly Balance</div>
        <div className="hero-amount">${weekRemaining.toLocaleString()}</div>
        <div className="hero-sub">of ${totalCash.toLocaleString()} total · ${totalSpent} invested</div>
        <div className="hero-tag">{Math.round((totalSpent / Math.max(1, totalCash)) * 100)}% complete this week</div>
      </div>

      {/* Stats */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Today's Budget</div>
          <div className="stat-val blue">${dayBudget}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Today Remaining</div>
          <div className={`stat-val ${dayRemaining === 0 ? 'green' : 'muted'}`}>{dayRemaining === 0 && dayBudget > 0 ? '✓ Done' : `$${dayRemaining}`}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Tim's Mood</div>
          <div className={`stat-val ${mood === 'happy' ? 'green' : mood === 'anxious' ? '' : 'red'}`} style={{ fontSize: '1.1rem', marginTop: 2 }}>
            {mood === 'happy' ? '😌 Happy' : mood === 'anxious' ? '😬 Anxious' : '😔 Sad'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Unspent Past</div>
          <div className={`stat-val ${pastUnspent === 0 ? 'green' : 'red'}`}>{pastUnspent} cards</div>
        </div>
      </div>

      {/* Day strip */}
      <div className="day-strip">
        {DAYS.map(d => {
          const db = dailyCash[d] ?? 0
          const ds = state.dailySpent?.[d] ?? 0
          const done = db > 0 && ds >= db
          return (
            <button key={d} className={`day-btn ${d === selectedDay ? 'active' : ''}`}
              onClick={() => setState(s => ({ ...s, selectedDay: d }))}>
              <span className="day-btn-name">{d}</span>
              <span className="day-btn-amt">${db}</span>
              {done && <div className="day-dot" />}
            </button>
          )
        })}
      </div>

      {/* Main content */}
      <div className="main-grid">
        {/* Focus Cards */}
        <div className="surface" style={{ padding: '1.5rem' }}>
          <div className="section-header">
            <span className="section-title"><Layers size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Your Focus Projects</span>
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{projects.length} Active Targets</span>
          </div>
          {projects.length === 0
            ? <div className="deck-empty">No projects active. Open Settings to add some!</div>
            : <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
                {projects.map(p => {
                  const theme = COLORS[p.color] ?? COLORS.blue
                  const isCompleted = p.spentCash >= p.allocatedCash && p.allocatedCash > 0
                  const pct = p.allocatedCash > 0 ? (p.spentCash / p.allocatedCash) * 100 : 0
                  const remaining = Math.max(0, p.allocatedCash - p.spentCash)
                  
                  return (
                    <div
                      key={p.id}
                      className="focus-card"
                      style={{
                        backgroundColor: theme.bg,
                        borderColor: theme.border,
                        borderWidth: '1.5px',
                        borderStyle: 'solid',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '12px',
                        padding: '18px',
                        minHeight: '160px',
                        transition: 'all 0.25s ease'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                          <span
                            className="card-project-tag"
                            style={{
                              backgroundColor: theme.hex,
                              color: '#FFFFFF',
                              fontSize: '10px',
                              fontWeight: '700',
                              padding: '3px 9px'
                            }}
                          >
                            Rank {p.priority}
                          </span>
                          <span style={{ fontSize: '13px', fontWeight: '600', color: theme.hex }}>
                            ${remaining} left
                          </span>
                        </div>
                        <h3 className="card-name" style={{ marginTop: '10px', fontSize: '16px', fontWeight: '700', color: 'var(--text-1)' }}>
                          {p.name}
                        </h3>
                      </div>
                      
                      <div>
                        {/* Custom Progress Bar */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: '600', color: 'var(--text-2)' }}>
                          <span>${p.spentCash} / ${p.allocatedCash}</span>
                          <span>{Math.round(pct)}%</span>
                        </div>
                        <div className="proj-progress-wrap">
                          <div
                            className="proj-progress-fill"
                            style={{
                              width: `${Math.min(100, pct)}%`,
                              backgroundColor: theme.hex
                            }}
                          />
                        </div>
                      </div>
                      
                      <div className="card-footer" style={{ marginTop: '4px' }}>
                        {isCompleted
                          ? <span className="card-done-badge" style={{ color: 'var(--green)', fontWeight: '700', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <CheckCircle2 size={14} /> Completed
                            </span>
                          : <button
                              className="card-start-btn"
                              onClick={() => startTimer(p.id)}
                              style={{
                                backgroundColor: theme.hex,
                                color: '#FFFFFF',
                                padding: '6px 14px',
                                fontSize: '12px',
                                fontWeight: '600',
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                                transition: 'opacity 0.2s'
                              }}
                            >
                              <Clock size={12} /> Focus Session
                            </button>
                        }
                      </div>
                    </div>
                  )
                })}
              </div>
          }
        </div>

        {/* Sidebar */}
        <div>
          {/* Tim */}
          <div className="sidebar-section">
            <div className={`tim-mood-label ${mood}`}>{mood}</div>
            <div className="tim-avatar"><Tim mood={mood} /></div>
            <div className="tim-quote">{moodQuotes[mood]}</div>
          </div>

          {/* City */}
          <div className="sidebar-section">
            <div className="sidebar-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Landmark size={12} /> Time City</span>
              <span style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-3)' }}>0% 🌱 30% 🏡 70% 🏢 100% 🏙️</span>
            </div>
            <div className="city-bars" style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', height: '90px', paddingBottom: '5px' }}>
              {projects.map(p => (
                <TimeCityBuilding key={p.id} project={p} overdrafted={overdrafted} />
              ))}
            </div>
          </div>

          {/* Ledger */}
          <div className="sidebar-section">
            <div className="sidebar-label"><Receipt size={12} /> Audit Log</div>
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {ledger.length === 0
                ? <p style={{ fontSize: 13, textAlign: 'center', padding: '1rem 0' }}>No transactions yet.</p>
                : ledger.slice(0, 20).map((e, i) => (
                    <div key={i} className="ledger-entry">
                      <div>
                        <div className="ledger-desc">{e.desc}</div>
                        <div className="ledger-time">{e.ts}</div>
                      </div>
                      <div className={`ledger-amt ${e.type}`}>
                        {e.type === 'pos' ? '+' : e.type === 'neg' ? '−' : ''}${Math.abs(e.amt)}
                      </div>
                    </div>
                  ))
              }
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {timer && (
        <TimerOverlay
          timer={timer} projects={projects}
          onStart={() => setState(s => ({ ...s, timer: { ...s.timer, running: true } }))}
          onPause={() => setState(s => ({ ...s, timer: { ...s.timer, running: false } }))}
          onCancel={() => setState(s => ({ ...s, timer: null }))}
          onCheat={() => setState(s => completeCard(s))}
        />
      )}
      {tradeOpen && <TradeModal state={state} setState={setState} onClose={() => setState(s => ({ ...s, tradeOpen: false }))} onExecute={executeTrade} />}
      {borrowOpen && <BorrowModal state={state} setState={setState} onClose={() => setState(s => ({ ...s, borrowOpen: false }))} onExecute={executeBorrow} />}
      {excuseOpen && <ExcuseModal state={state} setState={setState} onClose={() => setState(s => ({ ...s, excuseOpen: false }))} onExecute={executeExcuse} />}
      {settingsOpen && <SettingsModal state={state} setState={setState} onClose={() => setState(s => ({ ...s, settingsOpen: false }))} />}
      {loginOpen && <LoginModal state={state} setState={setState} onClose={() => setState(s => ({ ...s, loginOpen: false }))} />}
    </div>
  )
}

/* ─────────────────────────────────────────────────────
   Root
───────────────────────────────────────────────────── */
export default function App() {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch (_) {}
    return makeDefault()
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  // Startup: sync state from Supabase if logged in
  useEffect(() => {
    if (state.token && state.user) {
      const fetchLatest = async () => {
        try {
          setState(s => ({ ...s, syncStatus: 'syncing' }))
          const res = await fetch('/api/get-state', {
            headers: {
              'Authorization': `Bearer ${state.token}`
            }
          })
          if (res.ok) {
            const data = await res.json()
            if (data.state) {
              setState(s => ({
                ...s,
                ...data.state,
                syncStatus: 'synced'
              }))
            }
          } else {
            // Token might be invalid or expired
            setState(s => ({
              ...s,
              token: null,
              user: null,
              syncStatus: 'synced'
            }))
          }
        } catch (_) {
          setState(s => ({ ...s, syncStatus: 'error' }))
        }
      }
      fetchLatest()
    }
  }, [])

  // Auto-sync debounced trigger
  useEffect(() => {
    if (!state.token || !state.user) return

    const payload = {
      step: state.step,
      done: state.done,
      wakeH: state.wakeH,
      sleepH: state.sleepH,
      meals: state.meals,
      classes: state.classes,
      work: state.work,
      disposable: state.disposable,
      totalCash: state.totalCash,
      dailyCash: state.dailyCash,
      projects: state.projects,
      dailySpent: state.dailySpent,
      ledger: state.ledger,
      selectedDay: state.selectedDay
    }

    setState(s => ({ ...s, syncStatus: 'syncing' }))

    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/update-state', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.token}`
          },
          body: JSON.stringify({ state: payload })
        })
        if (res.ok) {
          setState(s => ({ ...s, syncStatus: 'synced' }))
        } else {
          setState(s => ({ ...s, syncStatus: 'error' }))
        }
      } catch (_) {
        setState(s => ({ ...s, syncStatus: 'error' }))
      }
    }, 1000) // 1-second debounce

    return () => clearTimeout(timer)
  }, [
    state.token,
    state.user,
    state.step,
    state.done,
    state.wakeH,
    state.sleepH,
    state.meals,
    state.classes,
    state.work,
    state.disposable,
    state.totalCash,
    JSON.stringify(state.dailyCash),
    JSON.stringify(state.projects),
    JSON.stringify(state.dailySpent),
    JSON.stringify(state.ledger),
    state.selectedDay
  ])

  if (!state.done) return <Onboarding state={state} setState={setState} />
  return <Dashboard state={state} setState={setState} />
}
