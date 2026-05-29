import { supabase, authenticateUser } from './_supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { state } = req.body

  if (!state) {
    return res.status(400).json({ error: 'Missing state payload' })
  }

  // --- Sandbox / Mock fallback mode ---
  if (!supabase) {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer mock-jwt-token-')) {
      return res.status(401).json({ error: 'Unauthorized: Invalid sandbox token' })
    }
    
    // Sandbox reports success (it has simulated sync)
    return res.status(200).json({
      success: true,
      sandbox: true,
      message: 'State simulated synced in Sandbox mode!'
    })
  }

  try {
    // 1. Authenticate user
    const user = await authenticateUser(req)
    const userId = user.id

    // 2. Upsert state in user_states table
    const { error: dbError } = await supabase
      .from('user_states')
      .upsert({
        user_id: userId,
        state: state,
        updated_at: new Date().toISOString()
      })

    if (dbError) {
      console.error('[Update State DB Error]:', dbError)
      return res.status(500).json({ error: dbError.message || 'Failed to update state in database' })
    }

    return res.status(200).json({ success: true })

  } catch (err) {
    console.error('[Update State Exception]:', err)
    return res.status(401).json({ error: err.message || 'Unauthorized' })
  }
}
