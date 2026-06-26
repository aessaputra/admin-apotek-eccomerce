import { SupabaseClient } from "npm:@supabase/supabase-js@2.44.0"
type InviteParams = Parameters<SupabaseClient["auth"]["admin"]["inviteUserByEmail"]>[1];
console.log("Types available.");
