import { supabase } from './_supabase.js'

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Missing email or password' })
  }

  // --- Sandbox / Mock fallback mode ---
  if (!supabase) {
    console.log('[Login API] Running in Sandbox / Mock mode')
    const mockToken = `mock-jwt-token-${Buffer.from(email).toString('base64')}`
    
    // Attempt to load from virtual sandbox storage (memory/localStorage mock)
    // For Sandbox fallback, we can just return a saved local state if they have one or DEFAULT_STATE
    return res.status(200).json({
      session: { access_token: mockToken, user: { email, id: `mock-uuid-1234` } },
      state: DEFAULT_STATE,
      sandbox: true,
      message: 'Logged in to Sandbox! (Data saved locally until Supabase is connected)'
    })
  }

  try {
    // 1. Sign in the user in Supabase auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (authError || !authData.user) {
      return res.status(400).json({ error: authError?.message || 'Invalid email or password' })
    }

    const userId = authData.user.id

    // 2. Fetch the user's saved state
    const { data: dbData, error: dbError } = await supabase
      .from('user_states')
      .select('state')
      .eq('user_id', userId)
      .maybeSingle()

    let userState = dbData?.state

    if (dbError) {
      console.error('[Login DB Fetch Error]:', dbError)
    }

    // 3. If no state exists in database, initialize a default one
    if (!userState) {
      console.log(`[Login API] State missing for user ${userId}, initializing default state.`)
      userState = DEFAULT_STATE
      await supabase
        .from('user_states')
        .upsert({
          user_id: userId,
          state: DEFAULT_STATE,
          updated_at: new Date().toISOString()
        })
    }

    return res.status(200).json({
      session: { access_token: authData.session?.access_token || '', user: authData.user },
      state: userState
    })

  } catch (err) {
    console.error('[Login Exception]:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
