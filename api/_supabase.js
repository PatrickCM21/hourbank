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
  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    throw new Error('Unauthorized: Invalid or expired session token')
  }

  return user
}
