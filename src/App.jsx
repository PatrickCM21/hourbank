import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ChevronUp, ChevronDown, ArrowRight, ArrowLeft,
  Play, Pause, X, ArrowLeftRight, Landmark, ShieldCheck, RotateCcw,
  Sliders, CheckCircle2, Clock, Layers, Receipt, Check, AlertCircle,
  History
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
function calcWeeklyDisposable(wakeHours, sleepHours, meals, classes, work) {
  const totalActive = DAYS.reduce((sum, d) => {
    const wake = wakeHours?.[d] ?? 9
    const sleep = sleepHours?.[d] ?? 23
    return sum + Math.max(0, sleep - wake)
  }, 0)
  return Math.max(0, totalActive - meals * 7 - classes - work)
}
function distributeProjectWeeklyToDaily(allocatedCash) {
  const base = Math.floor((allocatedCash / 50) / 7) * 50
  const rem = allocatedCash - base * 7
  const result = {}
  DAYS.forEach((d, i) => {
    result[d] = base + (i < Math.round(rem / 50) ? 50 : 0)
  })
  return result
}
function getWeekNumber(d) {
  const date = new Date(d)
  date.setHours(0, 0, 0, 0)
  const day = (date.getDay() + 6) % 7 // Monday = 0, Sunday = 6
  date.setDate(date.getDate() - day + 3)
  const firstThursday = date.getTime()
  date.setMonth(0, 1)
  if (date.getDay() !== 4) {
    date.setMonth(0, 1 + ((4 - date.getDay() + 7) % 7))
  }
  return 1 + Math.ceil((firstThursday - date) / 604800000)
}
function isNewWeek(lastResetStr) {
  if (!lastResetStr) return false
  const now = new Date()
  const last = new Date(lastResetStr)
  
  const nowYear = now.getFullYear()
  const lastYear = last.getFullYear()
  const nowWeek = getWeekNumber(now)
  const lastWeek = getWeekNumber(last)
  
  return nowYear !== lastYear || nowWeek !== lastWeek
}
function performWeeklyRollover(s) {
  const now = new Date()
  const last = s.lastResetDate ? new Date(s.lastResetDate) : new Date()
  const day = (last.getDay() + 6) % 7
  const mon = new Date(last)
  mon.setDate(last.getDate() - day)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  
  const weekStartStr = mon.toISOString().split('T')[0]
  const weekEndStr = sun.toISOString().split('T')[0]

  const totalSpent = s.projects?.reduce((a, p) => a + (p.spentCash ?? 0), 0) ?? 0
  const overdrafted = s.ledger?.some(e => e.desc?.includes('OVERDRAFT')) ?? false
  const totalBudget = s.totalCash ?? 0
  const completionPct = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 100

  const mood = overdrafted
    ? 'sad'
    : completionPct === 0
      ? 'sad'
      : completionPct < 50
        ? 'curious'
        : completionPct < 100
          ? 'happy'
          : 'ecstatic'

  const historyEntry = {
    id: `w-${Date.now()}`,
    weekStart: weekStartStr,
    weekEnd: weekEndStr,
    totalBudget: s.totalCash ?? 0,
    totalSpent,
    mood,
    projects: s.projects?.map(p => ({
      name: p.name,
      allocated: p.allocatedCash,
      spent: p.spentCash,
      color: p.color
    })) ?? [],
    ledgerCount: s.ledger?.length ?? 0
  }

  const rolledProjects = s.projects?.map(p => ({
    ...p,
    spentCash: 0,
    dailySpent: { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 }
  })) ?? []

  const nextHistory = [...(s.history ?? []), historyEntry]

  return {
    ...s,
    history: nextHistory,
    projects: rolledProjects,
    dailySpent: { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 },
    ledger: [{
      ts: now.toLocaleTimeString(),
      desc: `Automated weekly rollover — new fiscal week started`,
      amt: s.totalCash ?? 0,
      type: 'pos'
    }],
    lastResetDate: now.toISOString()
  }
}
function getTimerSeconds(t) {
  if (!t) return 0
  if (!t.running) return t.seconds ?? t.accumulatedSeconds ?? 0
  const accumulated = t.accumulatedSeconds ?? t.seconds ?? 0
  const startTime = t.startTime ?? Date.now()
  return accumulated + Math.max(0, Math.floor((Date.now() - startTime) / 1000))
}

function migrateState(s) {
  if (!s) return s
  let migrated = false
  const updated = { ...s }

  if (updated.timer && updated.timer.running) {
    if (updated.timer.startTime === undefined) {
      updated.timer.startTime = Date.now() - ((updated.timer.seconds ?? 0) * 1000)
      updated.timer.accumulatedSeconds = 0
      migrated = true
    }
  }

  if (!updated.wakeHours) {
    const w = updated.wakeH ?? 9
    updated.wakeHours = { Mon: w, Tue: w, Wed: w, Thu: w, Fri: w, Sat: w, Sun: w }
    migrated = true
  }
  if (!updated.sleepHours) {
    const sl = updated.sleepH ?? 23
    updated.sleepHours = { Mon: sl, Tue: sl, Wed: sl, Thu: sl, Fri: sl, Sat: sl, Sun: sl }
    migrated = true
  }

  if (updated.projects) {
    updated.projects = updated.projects.map(p => {
      let pChanged = false
      const newP = { ...p }
      if (!newP.dailyAllocations) {
        newP.dailyAllocations = distributeProjectWeeklyToDaily(newP.allocatedCash ?? 0)
        pChanged = true
      }
      if (!newP.dailySpent) {
        newP.dailySpent = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 }
        if (newP.spentCash > 0) {
          const activeDay = s.selectedDay ?? 'Mon'
          newP.dailySpent[activeDay] = newP.spentCash
        }
        pChanged = true
      }
      if (pChanged) migrated = true
      return newP
    })
  }

  if (!updated.lastResetDate) {
    updated.lastResetDate = new Date().toISOString()
    migrated = true
  }
  if (!updated.history) {
    updated.history = []
    migrated = true
  }

  // Auto rollover on load if it is a new week!
  if (isNewWeek(updated.lastResetDate)) {
    return performWeeklyRollover(updated)
  }

  return updated
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
  return projects.map(orig => {
    const s = sorted.find(item => item.id === orig.id) ?? {}
    const allocatedCash = s.allocatedCash ?? orig.allocatedCash ?? 0
    const dailyAllocations = orig.dailyAllocations ?? distributeProjectWeeklyToDaily(allocatedCash)
    const dailySpent = orig.dailySpent ?? { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 }
    return {
      ...orig,
      ...s,
      dailyAllocations,
      dailySpent
    }
  })
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
    sad: 'M 36 63 Q 44 56 52 63',
    curious: 'M 38 59 Q 44 58 50 59',
    happy: 'M 36 58 Q 44 65 52 58',
    ecstatic: 'M 35 56 Q 44 69 53 56'
  }
  const browL = {
    sad: 'M 26 35 Q 32 39 38 37',
    curious: 'M 26 31 Q 32 29 38 33',
    happy: 'M 26 36 Q 32 33 38 36',
    ecstatic: 'M 26 34 Q 32 29 38 34'
  }
  const browR = {
    sad: 'M 50 37 Q 56 39 62 35',
    curious: 'M 50 36 Q 56 37 62 36',
    happy: 'M 50 36 Q 56 33 62 36',
    ecstatic: 'M 50 34 Q 56 29 62 34'
  }
  const colors = { 
    sad: '#FF453A', 
    curious: '#FF9500', 
    happy: '#0071E3', 
    ecstatic: '#30D158' 
  }
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
  const wakeHours = { Mon: 9, Tue: 9, Wed: 9, Thu: 9, Fri: 9, Sat: 9, Sun: 9 }
  const sleepHours = { Mon: 23, Tue: 23, Wed: 23, Thu: 23, Fri: 23, Sat: 23, Sun: 23 }
  return {
    step: 1, done: false,
    wakeH: 9, sleepH: 23, meals: 3, classes: 6, work: 0,
    wakeHours, sleepHours,
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
    refreshToken: null,
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
      setState(s => {
        const w = s.wakeH ?? 9
        const sl = s.sleepH ?? 23
        const wakeHours = { Mon: w, Tue: w, Wed: w, Thu: w, Fri: w, Sat: w, Sun: w }
        const sleepHours = { Mon: sl, Tue: sl, Wed: sl, Thu: sl, Fri: sl, Sat: sl, Sun: sl }
        const updatedProjects = s.projects.map(p => ({
          ...p,
          dailyAllocations: p.dailyAllocations ?? distributeProjectWeeklyToDaily(p.allocatedCash),
          dailySpent: p.dailySpent ?? { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 }
        }))
        return {
          ...s,
          wakeHours,
          sleepHours,
          projects: updatedProjects,
          done: true,
          dailySpent: { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 },
          ledger: [entry]
        }
      })
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
            {/* Redundant login trigger removed as auth is forced at startup */}
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
  const [wakeHours, setWakeHours] = useState({ ...state.wakeHours })
  const [sleepHours, setSleepHours] = useState({ ...state.sleepHours })
  const [meals, setMeals] = useState(state.meals)
  const [classes, setClasses] = useState(state.classes)
  const [work, setWork] = useState(state.work)
  const [projects, setProjects] = useState(state.projects.map(p => ({ ...p })))

  const disposable = calcWeeklyDisposable(wakeHours, sleepHours, meals, classes, work)
  const totalCash = disposable * 100

  const updateDailyTimes = (day, type, value) => {
    const nextWakeHours = { ...wakeHours }
    const nextSleepHours = { ...sleepHours }
    if (type === 'wake') nextWakeHours[day] = value
    else nextSleepHours[day] = value
    
    const nextDisp = calcWeeklyDisposable(nextWakeHours, nextSleepHours, meals, classes, work)
    const nextTotal = nextDisp * 100
    
    setWakeHours(nextWakeHours)
    setSleepHours(nextSleepHours)
    setProjects(distributeByPriority(projects.map(p => ({ ...p })), nextTotal))
  }

  const updateCommitments = (patch) => {
    const next = { meals, classes, work, ...patch }
    const nextDisp = calcWeeklyDisposable(wakeHours, sleepHours, next.meals, next.classes, next.work)
    const nextTotal = nextDisp * 100
    
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
      // Rebuild projects dailyAllocations so they match the new allocatedCash
      const updatedProjects = projects.map(p => {
        const oldP = s.projects.find(item => item.id === p.id)
        
        // If the allocated cash changed, or if it doesn't have dailyAllocations:
        // We redistribute it, otherwise we preserve its existing daily allocations!
        const nextAllocations = (oldP && oldP.allocatedCash === p.allocatedCash && oldP.dailyAllocations)
          ? oldP.dailyAllocations
          : distributeProjectWeeklyToDaily(p.allocatedCash)
          
        return {
          ...p,
          dailyAllocations: nextAllocations,
          dailySpent: p.dailySpent ?? oldP?.dailySpent ?? { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 }
        }
      })
      
      const newDaily = DAYS.reduce((acc, d) => {
        acc[d] = updatedProjects.reduce((sum, pr) => sum + (pr.dailyAllocations?.[d] ?? 0), 0)
        return acc
      }, {})

      const newCards = rebuildCardsPreservingSpent(updatedProjects, newDaily, s.cards)
      const entry = { ts: new Date().toLocaleTimeString(), desc: `Vault settings updated — $${totalCash.toLocaleString()} vault`, amt: totalCash - s.totalCash, type: 'neutral' }
      
      return {
        ...s,
        wakeHours,
        sleepHours,
        meals,
        classes,
        work,
        disposable,
        totalCash,
        projects: updatedProjects,
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

        {/* Section 1: Active Hours per Day */}
        <div className="settings-section">
          <div className="settings-section-title">Active Hours per Day</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '190px', overflowY: 'auto', paddingRight: '4px', marginBottom: '1rem' }}>
            {DAYS.map(d => (
              <div key={d} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '10px', alignItems: 'center', background: 'var(--surface)', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-1)' }}>{DAYS_FULL[d]}</span>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Wake:</span>
                  <select 
                    value={wakeHours[d] ?? 9} 
                    onChange={e => updateDailyTimes(d, 'wake', +e.target.value)}
                    style={{ flex: 1, height: '28px', padding: '0 4px', fontSize: '12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    {hourItems(5, 11).map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Sleep:</span>
                  <select 
                    value={sleepHours[d] ?? 23} 
                    onChange={e => updateDailyTimes(d, 'sleep', +e.target.value)}
                    style={{ flex: 1, height: '28px', padding: '0 4px', fontSize: '12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    {hourItems(12, 24).map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
            <div className="modal-row" style={{ margin: 0 }}>
              <label>Meals</label>
              <select value={meals} onChange={e => updateCommitments({ meals: +e.target.value })}>
                {numItems(1, 5).map(n => <option key={n.value} value={n.value}>{n.label}h/d</option>)}
              </select>
            </div>
            <div className="modal-row" style={{ margin: 0 }}>
              <label>Classes</label>
              <select value={classes} onChange={e => updateCommitments({ classes: +e.target.value })}>
                {numItems(0, 30).map(n => <option key={n.value} value={n.value}>{n.label}h/w</option>)}
              </select>
            </div>
            <div className="modal-row" style={{ margin: 0 }}>
              <label>Work</label>
              <select value={work} onChange={e => updateCommitments({ work: +e.target.value })}>
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

function HistoryModal({ state, setState, onClose }) {
  const { history } = state
  return (
    <div className="overlay">
      <div className="modal-sheet" style={{ maxWidth: '640px', width: '90%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: '2rem 2rem 1.5rem' }}>
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History size={18} style={{ color: 'var(--accent)' }} />
            Weekly Investment History
          </h3>
          <button className="btn btn-icon btn-sm" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="modal-desc" style={{ marginBottom: '1.2rem' }}>
          Look back at your previous weeks' time allocations, spent focus hours, and Banker Tim's mood retrospective.
        </p>

        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', marginBottom: '1rem' }}>
          {!history || history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1.5rem', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', border: '1.5px dashed var(--border)' }}>
              <Clock size={36} style={{ color: 'var(--text-3)', marginBottom: '1rem' }} />
              <h4 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-2)', marginBottom: '6px' }}>No history recorded yet</h4>
              <p style={{ fontSize: '13px', color: 'var(--text-3)', maxWidth: '320px', margin: '0 auto', lineHeight: '1.5' }}>
                "Immaculate ledgers are built day by day, week by week. Complete your current week, and your legacy will appear here." — Banker Tim
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {history.slice().reverse().map((h) => {
                const completionRate = h.totalBudget > 0 ? Math.round((h.totalSpent / h.totalBudget) * 100) : 0
                
                let timQuote = ""
                if (h.mood === 'anxious') {
                  timQuote = `"An overdraft? Outrageous! You borrowed time from the future and incurred heavy emotional interest. Keep a clean ledger!"`
                } else if (completionRate >= 85) {
                  timQuote = `"Magnificent! ${completionRate}% completion is a stellar investment. Your life equity has soared. Banker Tim is immensely pleased!"`
                } else if (completionRate >= 50) {
                  timQuote = `"Decent work. You completed ${completionRate}% of your budget, though some precious gold remains uninvested. Let's aim for perfection next week."`
                } else {
                  timQuote = `"A sluggish week (${completionRate}%). Time slipped like sand through your fingers. Banker Tim expects a far more robust ledger next time."`
                }

                return (
                  <div key={h.id} style={{ 
                    background: 'var(--surface-2)', 
                    borderRadius: 'var(--r-md)', 
                    border: '1px solid var(--border)', 
                    padding: '1.2rem',
                    boxShadow: 'var(--shadow-sm)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-1)' }}>
                          Week: {h.weekStart} to {h.weekEnd}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ 
                          fontSize: '11px', 
                          fontWeight: '600', 
                          padding: '4px 8px', 
                          borderRadius: '980px',
                          background: (h.mood === 'happy' || h.mood === 'ecstatic') ? 'var(--green-soft)' : h.mood === 'curious' ? 'var(--accent-soft)' : 'var(--red-soft)',
                          color: (h.mood === 'happy' || h.mood === 'ecstatic') ? '#1A7A33' : h.mood === 'curious' ? 'var(--accent)' : 'var(--red)'
                        }}>
                          {h.mood === 'ecstatic' ? '🤩 Ecstatic' : h.mood === 'happy' ? '😌 Happy' : h.mood === 'curious' ? '🤔 Curious' : h.mood === 'sad' ? '😔 Sad' : '😬 Anxious'}
                        </span>
                        <span style={{ 
                          fontSize: '11px', 
                          fontWeight: '600', 
                          padding: '4px 8px', 
                          borderRadius: '980px',
                          background: 'var(--accent-soft)',
                          color: 'var(--accent)'
                        }}>
                          {completionRate}% Complete
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-2)', marginBottom: '0.6rem' }}>
                      <span>Total Budgeted: <strong>${h.totalBudget.toLocaleString()}</strong> ({h.totalBudget / 100}h)</span>
                      <span>Invested Focus: <strong>${h.totalSpent.toLocaleString()}</strong> ({h.totalSpent / 100}h)</span>
                    </div>

                    <div style={{ width: '100%', height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden', marginBottom: '1rem' }}>
                      <div style={{ width: `${Math.min(100, completionRate)}%`, height: '100%', background: 'var(--accent)', borderRadius: '3px', transition: 'width 0.3s ease' }} />
                    </div>

                    {h.projects && h.projects.length > 0 && (
                      <div style={{ background: 'var(--surface)', padding: '0.8rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', marginBottom: '1rem' }}>
                        <div style={{ fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', marginBottom: '8px' }}>Project Allocation Breakdown</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {h.projects.map((p, idx) => {
                            const pAlloc = p.allocated ?? 0
                            const pSpent = p.spent ?? 0
                            const pPercent = pAlloc > 0 ? Math.round((pSpent / pAlloc) * 100) : 0
                            const cTheme = COLORS[p.color] || COLORS.blue
                            return (
                              <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: '500' }}>
                                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: cTheme.hex }} />
                                    {p.name}
                                  </span>
                                  <span style={{ color: 'var(--text-2)', fontSize: '11px' }}>
                                    ${pSpent} of ${pAlloc} ({pPercent}%)
                                  </span>
                                </div>
                                <div style={{ width: '100%', height: '4px', background: 'var(--surface-2)', borderRadius: '2px', overflow: 'hidden' }}>
                                  <div style={{ width: `${Math.min(100, pPercent)}%`, height: '100%', backgroundColor: cTheme.hex, borderRadius: '2px' }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <div style={{ 
                      background: 'rgba(255, 204, 0, 0.04)', 
                      borderLeft: '3px solid #FFCC00', 
                      padding: '8px 12px', 
                      borderRadius: '0 var(--r-sm) var(--r-sm) 0',
                      fontSize: '12px',
                      fontStyle: 'italic',
                      color: 'var(--text-2)',
                      lineHeight: '1.4'
                    }}>
                      <strong style={{ fontStyle: 'normal', color: 'var(--text-1)', marginRight: '4px' }}>Banker Tim says:</strong> 
                      {timQuote}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0' }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function LoginModal({ state, setState, onClose, forced = false }) {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [shouldShake, setShouldShake] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) { setError('Please enter both email and password.'); return }
    setError(null)
    setInfo(null)
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

      if (isSignUp && !data.session) {
        setInfo(data.message || 'Signup successful! Please check your email for a confirmation link.')
        return
      }

      // Success! Update global state with session & fetched cloud state
      setState(s => ({
        ...s,
        ...data.state, // Load the synced state from cloud
        token: data.session.access_token,
        refreshToken: data.session.refresh_token,
        user: data.session.user,
        loginOpen: false,
        syncStatus: 'synced'
      }))
    } catch (err) {
      setError(err.message)
      setShouldShake(true)
      setTimeout(() => setShouldShake(false), 500)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="overlay">
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-6px); }
          20%, 40%, 60%, 80% { transform: translateX(6px); }
        }
        .shake-element {
          animation: shake 0.5s ease-in-out;
        }
      `}</style>
      <div className={`modal-sheet ${shouldShake ? 'shake-element' : ''}`} style={{ maxWidth: '380px' }}>
        <div className="modal-header" style={{ marginBottom: '1.25rem' }}>
          <h3>🔑 HourBank Vault ID</h3>
          {!forced && <button className="btn btn-icon btn-sm" onClick={onClose}><X size={16} /></button>}
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
            onClick={() => { setIsSignUp(false); setError(null); setInfo(null) }}
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
            onClick={() => { setIsSignUp(true); setError(null); setInfo(null) }}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {info && (
            <div className="feedback-pill ok" style={{ fontSize: '12px', lineHeight: '1.4', marginBottom: '1rem', backgroundColor: 'rgba(48, 176, 199, 0.08)', color: 'var(--accent)', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(48, 176, 199, 0.2)' }}>
              ℹ️ {info}
            </div>
          )}

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
                background: 'var(--surface-2)',
                border: error ? '1.5px solid var(--red, #FF453A)' : '1.5px solid transparent',
                boxShadow: error ? '0 0 0 2px rgba(255, 69, 58, 0.15)' : 'none',
                borderRadius: 'var(--r-sm)', fontSize: '15px', outline: 'none',
                color: 'var(--text-1)',
                transition: 'all 0.2s ease'
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
                background: 'var(--surface-2)',
                border: error ? '1.5px solid var(--red, #FF453A)' : '1.5px solid transparent',
                boxShadow: error ? '0 0 0 2px rgba(255, 69, 58, 0.15)' : 'none',
                borderRadius: 'var(--r-sm)', fontSize: '15px', outline: 'none',
                color: 'var(--text-1)',
                transition: 'all 0.2s ease'
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

        {!forced && (
          <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
            <button
              className="timer-cheat"
              onClick={onClose}
              style={{ fontSize: '12px', border: 'none', background: 'none' }}
            >
              Run as Guest (Local Only)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function FlowingTimeCity({ overdrafted, dayBudget, daySpent }) {
  const pct = dayBudget > 0 ? (daySpent / dayBudget) * 100 : 0;
  
  let activeStage = 1;
  if (pct >= 100) {
    activeStage = 4;
  } else if (pct >= 30) {
    activeStage = 3;
  } else if (pct > 0) {
    activeStage = 2;
  }

  const stages = [
    { id: 1, emoji: '🌱', label: 'Sprout' },
    { id: 2, emoji: '🏠', label: 'Cozy House' },
    { id: 3, emoji: '🏘️', label: 'Neighborhood' },
    { id: 4, emoji: '🏙️', label: 'Metropolis' }
  ];

  return (
    <div 
      className="surface" 
      style={{ 
        marginTop: '2rem', 
        padding: '2.5rem 2rem', 
        border: '1px solid var(--border)', 
        background: 'linear-gradient(135deg, #E0F2FE 0%, #DCFCE7 100%)', 
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: '700', letterSpacing: '-0.02em', color: 'var(--text-1)', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <Landmark size={20} style={{ color: 'var(--accent)' }} /> 
          Time City Panorama
        </h3>
        <p style={{ fontSize: '13px', color: 'var(--text-2)', marginTop: '4px', margin: 0, fontWeight: '500' }}>
          Your daily focus progression represented in minimal stages of construction.
        </p>
      </div>

      <div style={{ 
        position: 'relative', 
        display: 'flex', 
        justifyContent: 'space-around', 
        alignItems: 'center', 
        width: '100%', 
        maxWidth: '680px', 
        padding: '0 1rem',
        margin: '1rem 0'
      }}>
        {stages.map((stage) => {
          const isActive = activeStage === stage.id;
          const isPassed = activeStage > stage.id;
          
          return (
            <div 
              key={stage.id} 
              style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                position: 'relative',
                zIndex: 3,
                width: '100px'
              }}
            >
              {/* White Square Emoji Tile */}
              <div 
                style={{ 
                  width: '90px', 
                  height: '90px', 
                  borderRadius: '24px', 
                  background: '#FFFFFF', 
                  border: isActive 
                    ? `2px solid ${overdrafted ? 'var(--text-2)' : 'rgba(255, 214, 10, 0.6)'}` 
                    : isPassed 
                      ? `2px solid ${overdrafted ? 'var(--text-3)' : 'rgba(0, 113, 227, 0.15)'}`
                      : '2px solid var(--border)',
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  fontSize: '40px',
                  boxShadow: isActive 
                    ? '0 0 20px rgba(255, 214, 10, 0.45), 0 4px 12px rgba(255, 214, 10, 0.15)' 
                    : 'var(--shadow-xs)',
                  userSelect: 'none',
                  filter: overdrafted 
                    ? 'grayscale(90%) opacity(0.5)' 
                    : isActive 
                      ? 'none' 
                      : isPassed 
                        ? 'opacity(0.8)' 
                        : 'opacity(0.25)',
                  transition: 'all 0.3s ease',
                  cursor: 'default'
                }}
              >
                {stage.emoji}
              </div>

              {/* Label */}
              <div style={{ 
                marginTop: '12px', 
                fontSize: '12px', 
                fontWeight: isActive ? '700' : '600', 
                color: isActive 
                  ? 'var(--text-1)' 
                  : isPassed 
                    ? 'var(--text-2)' 
                    : 'var(--text-2)',
                textAlign: 'center'
              }}>
                {stage.label}
              </div>
            </div>
          );
        })}
      </div>

      {overdrafted && (
        <div style={{
          marginTop: '2rem',
          padding: '6px 16px',
          background: '#FF453A',
          color: '#FFFFFF',
          fontSize: '11px',
          fontWeight: '800',
          borderRadius: '980px',
          boxShadow: '0 2px 8px rgba(255, 69, 58, 0.25)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase'
        }}>
          ⚠️ CITY DECAY / MORTGAGED
        </div>
      )}
    </div>
  );
}


/* ─────────────────────────────────────────────────────
   Dashboard
   ───────────────────────────────────────────────────── */
function Dashboard({ state, setState }) {
  const { totalCash, projects, cards, ledger, selectedDay,
          timer, tradeOpen, borrowOpen, excuseOpen, settingsOpen,
          loginOpen, user, token, syncStatus } = state
  const [openDropdownProjId, setOpenDropdownProjId] = useState(null)
  // Calculate dailyCash dynamically based on daily project allocations
  const dailyCash = DAYS.reduce((acc, d) => {
    acc[d] = projects.reduce((sum, p) => sum + (p.dailyAllocations?.[d] ?? 0), 0)
    return acc
  }, {})

  const activeProj = state.timer ? projects.find(p => p.id === state.timer.projectId) : null
  const activeTheme = activeProj ? (COLORS[activeProj.color] || COLORS.blue) : COLORS.blue

  function logStopwatchTime(projId, elapsedSeconds) {
    setState(s => {
      const proj = s.projects.find(p => p.id === projId)
      if (!proj) return s
      const day = s.selectedDay
      const currentSpent = proj.dailySpent?.[day] ?? 0
      
      const cashDelta = Math.round((elapsedSeconds / 1800) * 50)
      const newSpent = Math.max(0, currentSpent + cashDelta)
      const actualDelta = newSpent - currentSpent
      
      const minutesStr = Math.floor(elapsedSeconds / 60)
      const secondsStr = (elapsedSeconds % 60) < 10 ? '0' : ''
      const timeFormatted = `${minutesStr}:${secondsStr}${elapsedSeconds % 60}`

      let nextProjects = s.projects
      let nextDailySpent = s.dailySpent
      let nextLedger = s.ledger

      if (actualDelta !== 0) {
        nextProjects = s.projects.map(p => {
          if (p.id === projId) {
            const nextDailySpentMap = {
              ...p.dailySpent,
              [day]: newSpent
            }
            const nextWeeklySpent = Object.values(nextDailySpentMap).reduce((a, b) => a + b, 0)
            return {
              ...p,
              dailySpent: nextDailySpentMap,
              spentCash: nextWeeklySpent
            }
          }
          return p
        })

        nextDailySpent = {
          ...s.dailySpent,
          [day]: (s.dailySpent[day] ?? 0) + actualDelta
        }

        const absMins = Math.floor(Math.abs(elapsedSeconds) / 60)
        const absSecs = Math.abs(elapsedSeconds) % 60
        const timeFormattedAbs = `${absMins}:${absSecs < 10 ? '0' : ''}${absSecs}`

        const desc = actualDelta > 0
          ? `Focused for ${timeFormattedAbs} on "${proj.name}"!`
          : `Removed ${timeFormattedAbs} Focus on "${proj.name}"`
        const entry = { ts: new Date().toLocaleTimeString(), desc, amt: -actualDelta, type: actualDelta > 0 ? 'neg' : 'pos' }
        nextLedger = [entry, ...s.ledger]
      }

      return {
        ...s,
        projects: nextProjects,
        dailySpent: nextDailySpent,
        ledger: nextLedger,
        timer: null
      }
    })
  }

  function payDownDebt(projId) {
    setState(s => {
      const proj = s.projects.find(p => p.id === projId)
      if (!proj) return s
      const day = s.selectedDay
      const currentSpent = proj.dailySpent?.[day] ?? 0
      
      const cashDelta = 50 // 30 mins = $50
      const newSpent = currentSpent + cashDelta
      
      const nextProjects = s.projects.map(p => {
        if (p.id === projId) {
          const nextDailySpentMap = {
            ...p.dailySpent,
            [day]: newSpent
          }
          const nextWeeklySpent = Object.values(nextDailySpentMap).reduce((a, b) => a + b, 0)
          return {
            ...p,
            dailySpent: nextDailySpentMap,
            spentCash: nextWeeklySpent
          }
        }
        return p
      })

      const nextDailySpent = {
        ...s.dailySpent,
        [day]: (s.dailySpent[day] ?? 0) + cashDelta
      }

      const wasInDebt = proj.spentCash < proj.allocatedCash
      const desc = wasInDebt
        ? `Paid down debt: +30m Focus on "${proj.name}"`
        : `Overpaid budget: +30m Focus on "${proj.name}"`

      const entry = { ts: new Date().toLocaleTimeString(), desc, amt: -cashDelta, type: 'neg' }

      return {
        ...s,
        projects: nextProjects,
        dailySpent: nextDailySpent,
        ledger: [entry, ...s.ledger]
      }
    })
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
  const todayKeyName = todayKey()
  const todayBudget = dailyCash[todayKeyName] ?? 0
  const todaySpent = state.dailySpent?.[todayKeyName] ?? 0
  const todayProgressPct = todayBudget > 0 ? (todaySpent / todayBudget) * 100 : 100

  const mood = overdrafted
    ? 'sad'
    : (todayBudget > 0 && todayProgressPct === 0)
      ? 'sad'
      : (todayProgressPct > 0 && todayProgressPct < 50)
        ? 'curious'
        : (todayProgressPct >= 50 && todayProgressPct < 100)
          ? 'happy'
          : 'ecstatic'

  // Selected Day Standing Calculations
  const selectedIdx = DAYS.indexOf(selectedDay)
  const daysUpToSelected = DAYS.slice(0, selectedIdx + 1)
  const overallBudgetSoFar = daysUpToSelected.reduce((sum, d) => sum + (dailyCash[d] ?? 0), 0)
  const overallSpentSoFar = daysUpToSelected.reduce((sum, d) => sum + (state.dailySpent?.[d] ?? 0), 0)
  const overallVarianceSoFar = overallSpentSoFar - overallBudgetSoFar

  const moodQuotes = {
    sad: overdrafted
      ? '"We\'ve entered overdraft! Please exercise restraint and balance the ledger!"'
      : '"No time cards spent today yet. The vault awaits your focus, partner!"',
    curious: `"A solid start! $${todaySpent} invested today. The ledger is progressing well. What are we studying next?"`,
    happy: `"Splendid momentum! You've invested $${todaySpent} ($${todayBudget - todaySpent} left). Keep going!"`,
    ecstatic: todayBudget === 0 
      ? '"Ah, a rest day! Today\'s vault is locked. Enjoy your time off!"'
      : '"Magnificent! Today\'s budget is fully secured and accounted for. A perfect day!"'
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '12px', color: syncStatus === 'error' ? 'var(--red)' : syncStatus === 'syncing' ? 'var(--text-2)' : '#1A7A33', fontWeight: '500' }}>
              {syncStatus === 'syncing' ? '🔄' : '☁️'} {syncStatus === 'syncing' ? 'Syncing...' : syncStatus === 'error' ? 'Sync Error' : 'Cloud Synced'}
            </span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* User Auth control */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-2)', background: 'var(--surface-2)', padding: '6px 12px', borderRadius: '980px', border: '1px solid var(--border)' }}>
              👤 {user?.email}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (confirm('Log out? Your local storage will remain, but cloud syncing will be suspended.')) {
                  setState(s => ({ ...s, user: null, token: null, refreshToken: null, syncStatus: 'synced' }))
                }
              }}
            >
              Log Out
            </button>
          </div>

          <button className="btn btn-secondary btn-sm" onClick={() => setState(s => ({ ...s, historyOpen: true }))}><History size={13} style={{ marginRight: '4px' }} /> History</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setState(s => ({ ...s, tradeOpen: true, tradeFeedback: null }))}><ArrowLeftRight size={13} /> Trade</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setState(s => ({ ...s, borrowOpen: true }))}><Landmark size={13} /> Overdraft</button>
          <button className="btn btn-icon btn-sm" style={{ fontSize: 13 }} onClick={resetWeek} title="Reset week"><RotateCcw size={14} /></button>
          <button className="btn btn-icon btn-sm" style={{ fontSize: 13 }} onClick={() => setState(s => ({ ...s, settingsOpen: true }))} title="Adjust"><Sliders size={14} /></button>
        </div>
      </div>

      {/* Hero */}
      <div className="dashboard-hero">
        <div className="hero-bg" />
        <div style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', marginBottom: 8 }}>Today's Balance</div>
        <div className="hero-amount">{dayRemaining / 100} {dayRemaining / 100 === 1 ? 'Hour' : 'Hours'}</div>
        <div className="hero-sub">${daySpent} invested of ${dayBudget} allocated today</div>
        <div className="hero-tag">
          {dayBudget > 0 
            ? `${Math.round((daySpent / dayBudget) * 100)}% complete today` 
            : 'Rest day — no time cards allocated'
          }
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Weekly Balance</div>
          <div className="stat-val blue">${weekRemaining.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Today's Budget</div>
          <div className="stat-val blue">${dayBudget}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Tim's Mood</div>
          <div 
            className="stat-val" 
            style={{ 
              fontSize: '1.1rem', 
              marginTop: 2,
              color: mood === 'ecstatic' ? 'var(--green)' : mood === 'happy' ? 'var(--accent)' : mood === 'curious' ? '#FF9500' : 'var(--red)'
            }}
          >
            {mood === 'ecstatic' ? '🤩 Ecstatic' : mood === 'happy' ? '😌 Happy' : mood === 'curious' ? '🤔 Curious' : '😔 Sad'}
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Focus Cards */}
          <div className="surface" style={{ padding: '1.5rem', position: 'relative', zIndex: 10 }}>
          <div className="section-header">
            <span className="section-title"><Layers size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Your Focus Projects</span>
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{projects.length} Active Targets</span>
          </div>
      {state.timer && (
        <div style={{
          background: `linear-gradient(135deg, ${activeTheme.bg} 0%, rgba(255, 255, 255, 0.65) 100%)`,
          border: `1.5px solid ${activeTheme.border}`,
          borderRadius: 'var(--r)',
          padding: '1.25rem',
          marginBottom: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxShadow: 'var(--shadow-xs)',
          backdropFilter: 'blur(10px)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: activeTheme.hex, letterSpacing: '0.05em' }}>
                ⏱️ Active Focus Stopwatch
              </div>
              <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-1)', marginTop: '2px' }}>
                {activeProj?.name || 'Focus Project'}
              </div>
            </div>
            <div style={{ fontSize: '24px', fontWeight: '800', fontFamily: 'monospace', color: 'var(--text-1)' }}>
              {Math.floor(getTimerSeconds(state.timer) / 60)}:{(getTimerSeconds(state.timer) % 60) < 10 ? '0' : ''}{getTimerSeconds(state.timer) % 60}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setState(s => {
                if (!s.timer) return s;
                const wasRunning = s.timer.running;
                if (wasRunning) {
                  const currentSecs = getTimerSeconds(s.timer);
                  return {
                    ...s,
                    timer: {
                      ...s.timer,
                      running: false,
                      seconds: currentSecs,
                      accumulatedSeconds: currentSecs,
                      startTime: null
                    }
                  };
                } else {
                  return {
                    ...s,
                    timer: {
                      ...s.timer,
                      running: true,
                      startTime: Date.now()
                    }
                  };
                }
              })}
              style={{ flex: 1, minWidth: '80px' }}
            >
              {state.timer.running ? '⏸️ Pause' : '▶️ Resume'}
            </button>

            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                const currentTimer = state.timer;
                if (!currentTimer) return;
                logStopwatchTime(currentTimer.projectId, getTimerSeconds(currentTimer));
              }}
              style={{ flex: 2, background: 'var(--green)', minWidth: '130px' }}
            >
              ⏹️ Stop & Invest Cash
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (confirm('Discard stopwatch session? Elapsed time will not be logged.')) {
                  setState(s => ({ ...s, timer: null }));
                }
              }}
              style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
            >
              Discard
            </button>
          </div>
        </div>
      )}

          {projects.length === 0
            ? <div className="deck-empty">No projects active. Open Settings to add some!</div>
            : <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
                {projects.map(p => {
                  const theme = COLORS[p.color] ?? COLORS.blue
                  const dailyAlloc = p.dailyAllocations?.[selectedDay] ?? 0
                  const dailySp = p.dailySpent?.[selectedDay] ?? 0
                  const dailyRem = Math.max(0, dailyAlloc - dailySp)
                  const isDeactivated = dailyAlloc === 0
                  
                  // Weekly metrics for summary
                  const weeklyAlloc = p.allocatedCash ?? 0
                  const weeklySp = p.spentCash ?? 0
                  
                  const dailyPct = dailyAlloc > 0 ? (dailySp / dailyAlloc) * 100 : 0
                  const isDailyCompleted = dailySp >= dailyAlloc && dailyAlloc > 0

                  const handleAdjust = (delta) => {
                    setState(s => {
                      const updatedProjects = s.projects.map(item => {
                        if (item.id === p.id) {
                          const currentAlloc = item.dailyAllocations?.[selectedDay] ?? 0
                          const newAlloc = Math.max(0, currentAlloc + delta)
                          const nextAllocations = { ...item.dailyAllocations, [selectedDay]: newAlloc }
                          const newWeeklyAlloc = Object.values(nextAllocations).reduce((a, b) => a + b, 0)
                          return {
                            ...item,
                            dailyAllocations: nextAllocations,
                            allocatedCash: newWeeklyAlloc
                          }
                        }
                        return item
                      })
                      return {
                        ...s,
                        projects: updatedProjects
                      }
                    })
                  }

                  const toggleActive = () => {
                    if (isDeactivated) {
                      handleAdjust(100) // Default to 1 hour ($100) when turning on
                    } else {
                      handleAdjust(-dailyAlloc) // Go down to 0
                    }
                  }

                  if (isDeactivated) {
                    return (
                      <div
                        key={p.id}
                        className="focus-card deactivated"
                        style={{
                          backgroundColor: 'var(--surface-2)',
                          borderColor: 'var(--border)',
                          borderWidth: '1.5px',
                          borderStyle: 'dashed',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '12px',
                          padding: '18px',
                          minHeight: '180px',
                          opacity: 0.65,
                          transition: 'all 0.25s ease',
                          background: 'repeating-linear-gradient(45deg, var(--surface-2), var(--surface-2) 10px, rgba(0,0,0,0.01) 10px, rgba(0,0,0,0.01) 20px)',
                          position: 'relative',
                          overflow: 'visible'
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                            <span
                              className="card-project-tag"
                              style={{
                                backgroundColor: 'var(--text-3)',
                                color: '#FFFFFF',
                                fontSize: '10px',
                                fontWeight: '700',
                                padding: '3px 9px'
                              }}
                            >
                              Rank {p.priority}
                            </span>
                            
                            {/* Top Right Allocation Dropdown */}
                            <div style={{ position: 'relative' }}>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setOpenDropdownProjId(openDropdownProjId === p.id ? null : p.id)
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  fontSize: '11px',
                                  fontWeight: '700',
                                  color: 'var(--text-2)',
                                  background: 'var(--surface-3)',
                                  border: '1px solid var(--border)',
                                  borderRadius: '6px',
                                  padding: '4px 8px',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s',
                                  outline: 'none'
                                }}
                                title="Set today's budget"
                              >
                                <Sliders size={10} /> Rest
                              </button>
                              
                              {openDropdownProjId === p.id && (
                                <div 
                                  style={{
                                    position: 'absolute',
                                    top: '28px',
                                    right: '0',
                                    background: 'var(--surface)',
                                    border: '1px solid var(--border-strong)',
                                    borderRadius: 'var(--r-sm)',
                                    boxShadow: 'var(--shadow-md)',
                                    padding: '6px',
                                    zIndex: 100,
                                    minWidth: '130px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '2px'
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-3)', padding: '4px 8px', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>Today's Budget</div>
                                  {[0, 50, 100, 150, 200, 250, 300, 400, 500].map(amt => {
                                    const hours = amt / 100
                                    const label = amt === 0 ? '0h (Rest)' : `${hours}h ($${amt})`
                                    return (
                                      <button
                                        key={amt}
                                        onClick={() => {
                                          setOpenDropdownProjId(null)
                                          handleAdjust(amt - dailyAlloc)
                                        }}
                                        style={{
                                          textAlign: 'left',
                                          border: 'none',
                                          background: dailyAlloc === amt ? 'var(--accent-soft)' : 'none',
                                          color: dailyAlloc === amt ? 'var(--accent)' : 'var(--text-1)',
                                          padding: '5px 8px',
                                          fontSize: '12px',
                                          borderRadius: '4px',
                                          cursor: 'pointer',
                                          fontWeight: dailyAlloc === amt ? '600' : '400',
                                          transition: 'all 0.15s',
                                          width: '100%'
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface-2)'}
                                        onMouseLeave={e => e.currentTarget.style.backgroundColor = dailyAlloc === amt ? 'var(--accent-soft)' : 'transparent'}
                                      >
                                        {label}
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                          
                          <h3 className="card-name" style={{ marginTop: '10px', fontSize: '16px', fontWeight: '700', color: 'var(--text-3)' }}>
                            {p.name}
                          </h3>
                        </div>

                        <div style={{ fontSize: '12px', color: 'var(--text-3)', fontStyle: 'italic', margin: '8px 0' }}>
                          Rest Day. No time scheduled.
                        </div>

                        <div className="card-footer" style={{ zIndex: 1 }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={toggleActive}
                            style={{ width: '100%', fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', height: '34px' }}
                          >
                            + Schedule 1 Hour
                          </button>
                        </div>
                      </div>
                    )
                  }

                  const isDropdownOpen = openDropdownProjId === p.id;

                  return (
                    <div
                      key={p.id}
                      className="focus-card"
                      style={{
                        backgroundColor: isDailyCompleted ? 'rgba(52, 199, 89, 0.06)' : theme.bg,
                        borderColor: isDailyCompleted ? 'rgba(52, 199, 89, 0.3)' : theme.border,
                        borderWidth: '1.5px',
                        borderStyle: 'solid',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '12px',
                        padding: '18px',
                        minHeight: '180px',
                        transition: 'all 0.25s ease',
                        position: 'relative',
                        overflow: 'visible',
                        opacity: isDailyCompleted ? (isDropdownOpen ? 1 : 0.6) : 1,
                        zIndex: isDropdownOpen ? 50 : 1
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
                          
                          {/* Top Right Allocation Dropdown */}
                          <div style={{ position: 'relative' }}>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation()
                                setOpenDropdownProjId(openDropdownProjId === p.id ? null : p.id)
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '11px',
                                fontWeight: '700',
                                color: theme.hex,
                                background: '#FFFFFF',
                                border: `1.5px solid ${theme.border}`,
                                borderRadius: '6px',
                                padding: '4px 8px',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                outline: 'none'
                              }}
                              title="Set today's budget"
                            >
                              <Sliders size={10} /> {(dailyAlloc / 100).toFixed(1)}h
                            </button>
                            
                            {openDropdownProjId === p.id && (
                              <div 
                                style={{
                                  position: 'absolute',
                                  top: '28px',
                                  right: '0',
                                  background: 'var(--surface)',
                                  border: '1px solid var(--border-strong)',
                                  borderRadius: 'var(--r-sm)',
                                  boxShadow: 'var(--shadow-md)',
                                  padding: '6px',
                                  zIndex: 100,
                                  minWidth: '130px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '2px'
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-3)', padding: '4px 8px', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>Today's Budget</div>
                                {[0, 50, 100, 150, 200, 250, 300, 400, 500].map(amt => {
                                  const hours = amt / 100
                                  const label = amt === 0 ? '0h (Rest)' : `${hours}h ($${amt})`
                                  return (
                                    <button
                                      key={amt}
                                      onClick={() => {
                                        setOpenDropdownProjId(null)
                                        handleAdjust(amt - dailyAlloc)
                                      }}
                                      style={{
                                        textAlign: 'left',
                                        border: 'none',
                                        background: dailyAlloc === amt ? 'var(--accent-soft)' : 'none',
                                        color: dailyAlloc === amt ? 'var(--accent)' : 'var(--text-1)',
                                        padding: '5px 8px',
                                        fontSize: '12px',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontWeight: dailyAlloc === amt ? '600' : '400',
                                        transition: 'all 0.15s',
                                        width: '100%'
                                      }}
                                      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface-2)'}
                                      onMouseLeave={e => e.currentTarget.style.backgroundColor = dailyAlloc === amt ? 'var(--accent-soft)' : 'transparent'}
                                    >
                                      {label}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                        <h3 className="card-name" style={{ marginTop: '10px', fontSize: '16px', fontWeight: '700', color: 'var(--text-1)' }}>
                          {p.name}
                        </h3>
                      </div>
                      
                      <div>
                        {/* Custom Progress Bar */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: '600', color: 'var(--text-2)' }}>
                          <span>Today remaining:</span>
                          <span style={{ color: dailyRem === 0 ? 'var(--green)' : 'var(--text-1)', fontWeight: '700' }}>
                            {dailyRem === 0 ? '✓ Completed' : `$${dailyRem} left`}
                          </span>
                        </div>
                        
                        <div className="proj-progress-wrap" style={{ margin: '8px 0 6px' }}>
                          <div
                            className="proj-progress-fill"
                            style={{
                              width: `${Math.min(100, dailyPct)}%`,
                              backgroundColor: theme.hex
                            }}
                          />
                        </div>
                        
                      </div>

                      {/* Dynamic Stopwatch & Quick log Group */}
                      <div style={{ display: 'flex', gap: '8px', zIndex: 1, marginTop: '8px' }}>
                        {!(state.timer && state.timer.projectId === p.id) && (
                          <button
                            onClick={() => logStopwatchTime(p.id, -1800)} // Instantly remove 30 minutes focus (-1800 seconds)
                            disabled={state.timer !== null}
                            style={{
                              width: '50px',
                              height: '38px',
                              background: 'rgba(255, 255, 255, 0.7)',
                              border: `1.5px solid ${theme.border}`,
                              color: theme.hex,
                              borderRadius: '980px',
                              fontSize: '12px',
                              fontWeight: '700',
                              cursor: state.timer !== null ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.2s',
                              opacity: state.timer !== null ? 0.5 : 1
                            }}
                            onMouseEnter={e => { if (state.timer === null) e.currentTarget.style.background = '#FFFFFF' }}
                            onMouseLeave={e => { if (state.timer === null) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.7)' }}
                            title="Instantly remove 30 minutes focus"
                          >
                            -30
                          </button>
                        )}

                        <button
                          onClick={() => {
                            const isCurrentStopwatch = state.timer && state.timer.projectId === p.id;
                            if (isCurrentStopwatch) {
                              logStopwatchTime(p.id, getTimerSeconds(state.timer));
                            } else {
                              setState(s => ({
                                ...s,
                                timer: {
                                  projectId: p.id,
                                  seconds: 0,
                                  running: true,
                                  accumulatedSeconds: 0,
                                  startTime: Date.now()
                                }
                              }));
                            }
                          }}
                          disabled={state.timer !== null && state.timer.projectId !== p.id}
                          style={{
                            flex: 1,
                            height: '38px',
                            background: (state.timer && state.timer.projectId === p.id) ? 'var(--red)' : theme.hex,
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '980px',
                            fontSize: '12px',
                            fontWeight: '700',
                            cursor: (state.timer !== null && state.timer.projectId !== p.id) ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            boxShadow: (state.timer && state.timer.projectId === p.id) ? '0 2px 8px rgba(255, 69, 58, 0.25)' : `0 2px 6px ${theme.border}`,
                            transition: 'all 0.2s',
                            opacity: (state.timer !== null && state.timer.projectId !== p.id) ? 0.5 : 1
                          }}
                          onMouseEnter={e => { if (state.timer === null || state.timer.projectId === p.id) e.currentTarget.style.opacity = 0.9 }}
                          onMouseLeave={e => { if (state.timer === null || state.timer.projectId === p.id) e.currentTarget.style.opacity = 1 }}
                        >
                          {state.timer && state.timer.projectId === p.id
                            ? `⏹️ Stop & Invest ($${Math.round((getTimerSeconds(state.timer) / 1800) * 50)}) [${Math.floor(getTimerSeconds(state.timer) / 60)}:${(getTimerSeconds(state.timer) % 60) < 10 ? '0' : ''}${getTimerSeconds(state.timer) % 60}]`
                            : 'Start Focus'
                          }
                        </button>
                        
                        {!(state.timer && state.timer.projectId === p.id) && (
                          <button
                            onClick={() => logStopwatchTime(p.id, 1800)} // Instantly log 30 minutes (1800 seconds)
                            disabled={state.timer !== null}
                            style={{
                              width: '50px',
                              height: '38px',
                              background: 'rgba(255, 255, 255, 0.7)',
                              border: `1.5px solid ${theme.border}`,
                              color: theme.hex,
                              borderRadius: '980px',
                              fontSize: '12px',
                              fontWeight: '700',
                              cursor: state.timer !== null ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.2s',
                              opacity: state.timer !== null ? 0.5 : 1
                            }}
                            onMouseEnter={e => { if (state.timer === null) e.currentTarget.style.background = '#FFFFFF' }}
                            onMouseLeave={e => { if (state.timer === null) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.7)' }}
                            title="Instantly log 30 minutes focus"
                          >
                            30
                          </button>
                        )}
                      </div>

                    </div>
                  )
                })}
              </div>
          }
        </div>
      

          {/* Focus Debt & Statistics Ledger */}
          <div className="surface" style={{ padding: '1.5rem', border: '1.5px solid rgba(255, 69, 58, 0.15)', background: 'linear-gradient(180deg, rgba(255, 69, 58, 0.06) 0%, rgba(255, 69, 58, 0.02) 100%)', backdropFilter: 'blur(10px)' }}>
            <div className="section-header" style={{ marginBottom: '1.25rem' }}>
              <span className="section-title">
                <Sliders size={16} style={{ verticalAlign: 'middle', marginRight: 6, color: 'var(--red)' }} />
                Non-Investment
              </span>
              <span style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-3)' }}>Real-time Audit Ledger</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', marginBottom: '2px' }}>
                Project Balances (up to {selectedDay})
              </div>
              
              {projects.map(p => {
                const pBudgetSoFar = daysUpToSelected.reduce((sum, d) => sum + (p.dailyAllocations?.[d] ?? 0), 0)
                const pSpentSoFar = daysUpToSelected.reduce((sum, d) => sum + (p.dailySpent?.[d] ?? 0), 0)
                const variance = pSpentSoFar - pBudgetSoFar
                const isDebt = variance < 0
                const isSurplus = variance > 0
                const cTheme = COLORS[p.color] || COLORS.blue
                const pct = pBudgetSoFar > 0 ? Math.min(100, Math.round((pSpentSoFar / pBudgetSoFar) * 100)) : 0

                return (
                  <div key={p.id} style={{ 
                    background: 'var(--surface-2)', 
                    border: '1px solid var(--border)', 
                    borderRadius: 'var(--r-sm)', 
                    padding: '8px 12px',
                    display: 'grid',
                    gridTemplateColumns: '1.4fr 1fr 1fr',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    {/* Project Title */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '600', fontSize: '12px', color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: cTheme.hex, display: 'inline-block' }} />
                        {p.name}
                      </div>
                    </div>

                    {/* Variance */}
                    <div>
                      {isDebt ? (
                        <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--red)' }}>
                          🚨 −${Math.abs(variance)}
                        </span>
                      ) : isSurplus ? (
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#1A7A33' }}>
                          ⚡ +${variance}
                        </span>
                      ) : (
                        <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--accent)' }}>
                          ✓ Balanced
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ textAlign: 'right' }}>
                      <button 
                        onClick={() => payDownDebt(p.id)}
                        style={{
                          width: '100%',
                          height: '26px',
                          borderRadius: '980px',
                          background: isDebt ? 'linear-gradient(135deg, var(--red) 0%, #E03E3E 100%)' : 'var(--surface)',
                          border: isDebt ? 'none' : '1px solid var(--border-strong)',
                          color: isDebt ? '#FFFFFF' : 'var(--text-1)',
                          fontSize: '10px',
                          fontWeight: '700',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '2px',
                          boxShadow: isDebt ? '0 1px 4px rgba(239,68,68,0.15)' : 'none',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={e => {
                          if (isDebt) {
                            e.currentTarget.style.opacity = '0.9'
                            e.currentTarget.style.transform = 'translateY(-0.5px)'
                          } else {
                            e.currentTarget.style.background = cTheme.bg
                            e.currentTarget.style.borderColor = cTheme.hex
                            e.currentTarget.style.color = cTheme.hex
                          }
                        }}
                        onMouseLeave={e => {
                          if (isDebt) {
                            e.currentTarget.style.opacity = '1'
                            e.currentTarget.style.transform = 'none'
                          } else {
                            e.currentTarget.style.background = 'var(--surface)'
                            e.currentTarget.style.borderColor = 'var(--border-strong)'
                            e.currentTarget.style.color = 'var(--text-1)'
                          }
                        }}
                        title={isDebt ? 'Log 30m focus to pay down this project\'s time debt!' : 'Overpay focus (+30m) to boost this project beyond budget!'}
                      >
                        {isDebt ? '⚡ Pay Down' : '➕ Overpay'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
      </div>

      {/* Unified Flowing Time City Landscape Breakout */}
      <FlowingTimeCity overdrafted={overdrafted} dayBudget={dayBudget} daySpent={daySpent} />

      {/* Horizontal Audit Log Ledger Deck */}
      <div 
        className="surface" 
        style={{ 
          marginTop: '1.5rem', 
          padding: '1.5rem', 
          border: '1px solid var(--border)', 
          background: 'rgba(255, 255, 255, 0.75)', 
          backdropFilter: 'blur(10px)',
          boxShadow: 'var(--shadow-sm)'
        }}
      >
        <div className="section-header" style={{ marginBottom: '1.25rem' }}>
          <span className="section-title" style={{ fontSize: '16px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Receipt size={18} style={{ color: 'var(--accent)' }} /> 
            Audit Log Ledger Statements
          </span>
          <span style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-3)' }}>Last 20 active time transactions</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px', maxHeight: '240px', overflowY: 'auto', paddingRight: '4px' }}>
          {ledger.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-3)', padding: '1rem 0', gridColumn: '1/-1', textAlign: 'center' }}>
              No time transactions recorded yet.
            </p>
          ) : (
            ledger.slice(0, 20).map((e, i) => (
              <div 
                key={i} 
                className="ledger-entry" 
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  padding: '12px 16px', 
                  background: 'var(--surface-2)', 
                  borderRadius: '12px',
                  border: '1px solid var(--border)',
                  margin: 0
                }}
              >
                <div>
                  <div className="ledger-desc" style={{ fontWeight: '600', fontSize: '13px', color: 'var(--text-1)' }}>{e.desc}</div>
                  <div className="ledger-time" style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>{e.ts}</div>
                </div>
                <div 
                  style={{ 
                    fontSize: '14px', 
                    fontWeight: '700',
                    color: e.type === 'neg' ? 'var(--green)' : e.type === 'pos' ? 'var(--red)' : 'var(--text-3)'
                  }}
                >
                  {e.type === 'pos' ? '+' : e.type === 'neg' ? '−' : ''}${Math.abs(e.amt)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modals */}

      {tradeOpen && <TradeModal state={state} setState={setState} onClose={() => setState(s => ({ ...s, tradeOpen: false }))} onExecute={executeTrade} />}
      {borrowOpen && <BorrowModal state={state} setState={setState} onClose={() => setState(s => ({ ...s, borrowOpen: false }))} onExecute={executeBorrow} />}
      {settingsOpen && <SettingsModal state={state} setState={setState} onClose={() => setState(s => ({ ...s, settingsOpen: false }))} />}
      {state.historyOpen && <HistoryModal state={state} setState={setState} onClose={() => setState(s => ({ ...s, historyOpen: false }))} />}
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
      if (saved) {
        const parsed = JSON.parse(saved)
        const migrated = migrateState(parsed)
        migrated.selectedDay = todayKey()
        return migrated
      }
    } catch (_) {}
    return makeDefault()
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  // Global Focus Stopwatch ticking effect
  useEffect(() => {
    if (!state.timer || !state.timer.running) return;

    const interval = setInterval(() => {
      setState(s => {
        if (!s.timer || !s.timer.running) return s;
        const currentSeconds = getTimerSeconds(s.timer);
        return {
          ...s,
          timer: {
            ...s.timer,
            seconds: currentSeconds
          }
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [state.timer?.running]);


  const refreshSession = async (refreshToken) => {
    try {
      const res = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      })
      if (res.ok) {
        const data = await res.json()
        return data.session
      }
    } catch (err) {
      console.error('Error refreshing session:', err)
    }
    return null
  }

  // Startup: sync state from Supabase if logged in
  useEffect(() => {
    if (state.token && state.user) {
      const fetchLatest = async () => {
        try {
          setState(s => ({ ...s, syncStatus: 'syncing' }))
          let currentToken = state.token
          let res = await fetch('/api/get-state', {
            headers: {
              'Authorization': `Bearer ${currentToken}`
            }
          })

          if (res.status === 401 && state.refreshToken) {
            const newSession = await refreshSession(state.refreshToken)
            if (newSession) {
              currentToken = newSession.access_token
              res = await fetch('/api/get-state', {
                headers: {
                  'Authorization': `Bearer ${currentToken}`
                }
              })
              setState(s => ({
                ...s,
                token: newSession.access_token,
                refreshToken: newSession.refresh_token,
                user: newSession.user
              }))
            }
          }

          if (res.ok) {
            const data = await res.json()
            if (data.state) {
              setState(s => {
                const migrated = migrateState({ ...s, ...data.state })
                migrated.selectedDay = todayKey()
                return {
                  ...migrated,
                  syncStatus: 'synced'
                }
              })
            }
          } else {
            // Token might be invalid or expired and refresh failed
            setState(s => ({
              ...s,
              token: null,
              refreshToken: null,
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

  // Auto rollover on new week while app is active
  useEffect(() => {
    const checkRollover = () => {
      setState(s => {
        if (s.lastResetDate && isNewWeek(s.lastResetDate)) {
          return performWeeklyRollover(s)
        }
        return s
      })
    }
    const mountTimer = setTimeout(checkRollover, 2000)
    const interval = setInterval(checkRollover, 60000)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkRollover()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      clearTimeout(mountTimer)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
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
      wakeHours: state.wakeHours,
      sleepHours: state.sleepHours,
      meals: state.meals,
      classes: state.classes,
      work: state.work,
      disposable: state.disposable,
      totalCash: state.totalCash,
      dailyCash: state.dailyCash,
      projects: state.projects,
      dailySpent: state.dailySpent,
      ledger: state.ledger,
      selectedDay: state.selectedDay,
      history: state.history,
      lastResetDate: state.lastResetDate
    }

    setState(s => ({ ...s, syncStatus: 'syncing' }))

    const timer = setTimeout(async () => {
      try {
        let currentToken = state.token
        let res = await fetch('/api/update-state', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentToken}`
          },
          body: JSON.stringify({ state: payload })
        })

        if (res.status === 401 && state.refreshToken) {
          const newSession = await refreshSession(state.refreshToken)
          if (newSession) {
            currentToken = newSession.access_token
            res = await fetch('/api/update-state', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
              },
              body: JSON.stringify({ state: payload })
            })
            setState(s => ({
              ...s,
              token: newSession.access_token,
              refreshToken: newSession.refresh_token,
              user: newSession.user
            }))
          }
        }

        if (res.ok) {
          setState(s => ({ ...s, syncStatus: 'synced' }))
        } else {
          setState(s => ({ ...s, syncStatus: 'error' }))
          if (res.status === 401) {
            setState(s => ({
              ...s,
              token: null,
              refreshToken: null,
              user: null
            }))
          }
        }
      } catch (_) {
        setState(s => ({ ...s, syncStatus: 'error' }))
      }
    }, 1000) // 1-second debounce

    return () => clearTimeout(timer)
  }, [
    state.token,
    state.refreshToken,
    state.user,
    state.step,
    state.done,
    state.wakeH,
    state.sleepH,
    JSON.stringify(state.wakeHours),
    JSON.stringify(state.sleepHours),
    state.meals,
    state.classes,
    state.work,
    state.disposable,
    state.totalCash,
    JSON.stringify(state.dailyCash),
    JSON.stringify(state.projects),
    JSON.stringify(state.dailySpent),
    JSON.stringify(state.ledger),
    state.selectedDay,
    JSON.stringify(state.history),
    state.lastResetDate
  ])

  if (!state.token || !state.user) {
    return <LoginModal state={state} setState={setState} onClose={null} forced={true} />
  }

  if (!state.done) return <Onboarding state={state} setState={setState} />
  return <Dashboard state={state} setState={setState} />
}
