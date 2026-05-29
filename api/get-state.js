import { supabase, authenticateUser } from './_supabase.js'

const DEFAULT_STATE = {
  step: 1, done: false,
  wakeH: 9, sleepH: 23, meals: 3, classes: 6, work: 0,
  disposable: 57, totalCash: 5700,
  dailySpent: { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 },
  dailyCash: { Mon: 800, Tue: 800, Wed: 800, Thu: 800, Fri: 800, Sat: 900, Sun: 800 },
  projects: [
    { id: 'p1', name: 'Computer Science', priority: 1, color: 'blue', allocatedCash: 2200, spentCash: 0 },
    { id: 'p2', name: 'Arts & Reading',   priority: 2, color: 'purple', allocatedCash: 1650, spentCash: 0 },
    { id: 'p3', name: 'Gym & Fitness',    priority: 3, color: 'pink', allocatedCash: 1100, spentCash: 0 },
    { id: 'p4', name: 'Side Project',     priority: 4, color: 'orange', allocatedCash: 750, spentCash: 0 },
  ],
  cards: [], ledger: [], selectedDay: 'Mon', timer: null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // --- Sandbox / Mock fallback mode ---
  if (!supabase) {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer mock-jwt-token-')) {
      return res.status(401).json({ error: 'Unauthorized: Invalid sandbox token' })
    }
    
    // Sandbox just returns DEFAULT_STATE or success
    return res.status(200).json({
      state: DEFAULT_STATE,
      sandbox: true
    })
  }

  try {
    // 1. Authenticate access token
    const user = await authenticateUser(req)
    const userId = user.id

    // 2. Fetch saved state
    const { data: dbData, error: dbError } = await supabase
      .from('user_states')
      .select('state')
      .eq('user_id', userId)
      .maybeSingle()

    if (dbError) {
      return res.status(500).json({ error: dbError.message || 'Database error occurred' })
    }

    const userState = dbData?.state || DEFAULT_STATE
    return res.status(200).json({ state: userState })

  } catch (err) {
    console.error('[Get State Exception]:', err)
    return res.status(401).json({ error: err.message || 'Unauthorized' })
  }
}
