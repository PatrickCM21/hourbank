import { supabase } from './_supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { refresh_token } = req.body

  if (!refresh_token) {
    return res.status(400).json({ error: 'Missing refresh token' })
  }

  // --- Sandbox / Mock fallback mode ---
  if (!supabase) {
    console.log('[Refresh API] Running in Sandbox / Mock mode')
    let email = 'sandbox@hourbank.local'
    if (refresh_token.startsWith('mock-refresh-token-')) {
      const base64Email = refresh_token.substring('mock-refresh-token-'.length)
      try {
        email = Buffer.from(base64Email, 'base64').toString('utf-8')
      } catch (_) {}
    }
    const mockAccessToken = `mock-jwt-token-${Buffer.from(email).toString('base64')}`
    return res.status(200).json({
      session: {
        access_token: mockAccessToken,
        refresh_token: refresh_token,
        user: { email, id: `mock-uuid-1234` }
      },
      sandbox: true
    })
  }

  try {
    if (refresh_token.startsWith('mock-refresh-token-')) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' })
    }

    const { data, error } = await supabase.auth.refreshSession({ refresh_token })

    if (error || !data.session) {
      return res.status(401).json({ error: error?.message || 'Invalid or expired refresh token' })
    }

    return res.status(200).json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        user: data.session.user
      }
    })
  } catch (err) {
    console.error('[Refresh Session Exception]:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
