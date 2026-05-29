import { createClient } from '@supabase/supabase-js'

// Load environment variables (Vercel will inject these)
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase credentials missing. Serverless functions will run in sandbox/mock mode.')
}

export const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey) 
  : null

/**
 * Validates the Supabase URL and Key format.
 * Returns true if valid, false if invalid (sending a 500 error response).
 */
export function validateSupabaseConfig(res) {
  if (supabaseUrl && !supabaseUrl.startsWith('http://') && !supabaseUrl.startsWith('https://')) {
    res.status(500).json({
      error: 'Supabase configuration error: The SUPABASE_URL must start with http:// or https://. Please verify your environment variables.'
    })
    return false
  }

  if (supabaseKey && (!supabaseKey.includes('.') || supabaseKey.split('.').length !== 3)) {
    res.status(500).json({
      error: 'Supabase configuration error: The Supabase API key is invalid (must be a 3-part JWT). Please verify your environment variables.'
    })
    return false
  }

  return true
}

/**
 * Validates the Authorization Bearer token against Supabase.
 * Returns the user object if valid, throws an error if invalid.
 */
export async function authenticateUser(req) {
  if (!supabase) {
    throw new Error('Supabase client not initialized')
  }

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header')
  }

  const token = authHeader.split(' ')[1]
  
  if (token.startsWith('mock-jwt-token-') || !token.includes('.') || token.split('.').length !== 3) {
    throw new Error('Unauthorized: Invalid or expired session token')
  }

  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    throw new Error('Unauthorized: Invalid or expired session token')
  }

  return user
}
