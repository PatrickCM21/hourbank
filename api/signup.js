import { supabase, validateSupabaseConfig } from './_supabase.js'

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
    const mockRefreshToken = `mock-refresh-token-${Buffer.from(email).toString('base64')}`
    return res.status(200).json({
      session: {
        access_token: mockToken,
        refresh_token: mockRefreshToken,
        user: { email, id: `mock-uuid-${Date.now()}` }
      },
      state: DEFAULT_STATE,
      sandbox: true,
      message: 'Signed up in Sandbox mode! (Connect Supabase env variables to save to actual database)'
    })
  }

  if (supabase && !validateSupabaseConfig(res)) {
    return
  }

  try {
    // Determine redirect URL from request headers (so confirmation links open the website URL instead of localhost)
    const protocol = req.headers['x-forwarded-proto'] || 'https'
    const host = req.headers['x-forwarded-host'] || req.headers.host
    const emailRedirectTo = `${protocol}://${host}`

    // 1. Register the user in Supabase auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo
      }
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

    if (!authData.session) {
      return res.status(200).json({
        session: null,
        message: 'Signup successful! Please check your email for a confirmation link to activate your account.'
      })
    }

    return res.status(200).json({
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
        user: authData.user
      },
      state: DEFAULT_STATE
    })

  } catch (err) {
    console.error('[Signup Exception]:', err)
    let errorMsg = err.message || 'Internal server error'
    if (errorMsg.includes('expected pattern') || errorMsg.includes('atob') || errorMsg.includes('decode')) {
      errorMsg = 'Supabase configuration error: The API key format is invalid (must be a 3-part JWT). Please check your environment variables.'
    }
    return res.status(500).json({ error: errorMsg })
  }
}
