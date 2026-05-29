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
    console.log('[Signup API] Running in Sandbox / Mock mode')
    // Generate a mock JWT and user
    const mockToken = `mock-jwt-token-${Buffer.from(email).toString('base64')}`
    return res.status(200).json({
      session: { access_token: mockToken, user: { email, id: `mock-uuid-${Date.now()}` } },
      state: DEFAULT_STATE,
      sandbox: true,
      message: 'Signed up in Sandbox mode! (Connect Supabase env variables to save to actual database)'
    })
  }

  try {
    // 1. Register the user in Supabase auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password
    })

    if (authError || !authData.user) {
      return res.status(400).json({ error: authError?.message || 'Failed to sign up user' })
    }

    const userId = authData.user.id

    // 2. Initialize default state in 'user_states' table
    const { error: dbError } = await supabase
      .from('user_states')
      .upsert({
        user_id: userId,
        state: DEFAULT_STATE,
        updated_at: new Date().toISOString()
      })

    if (dbError) {
      console.error('[Signup DB Error]:', dbError)
      // We don't fail the signup completely since auth worked, but return error status info
    }

    return res.status(200).json({
      session: { access_token: authData.session?.access_token || '', user: authData.user },
      state: DEFAULT_STATE
    })

  } catch (err) {
    console.error('[Signup Exception]:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
