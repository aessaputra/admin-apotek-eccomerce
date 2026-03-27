/**
 * CORS headers for Supabase Edge Functions.
 *
 * SECURITY NOTE: Wildcard (*) is the recommended approach per Supabase docs.
 * - CORS is a browser security mechanism, NOT a mobile security mechanism
 * - React Native (mobile) ignores CORS entirely - requests go through OS-level HTTP stack
 * - Real security comes from JWT token validation + Row Level Security (RLS)
 * - See: https://supabase.com/docs/guides/functions/cors
 *
 * This app is React Native Expo (mobile-first) with optional web support.
 * Wildcard is acceptable and officially recommended by Supabase.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT',
};
