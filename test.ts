import { createClient } from "npm:@supabase/supabase-js@2";
const url = Deno.env.get("VITE_SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const adminClient = createClient(url, key);
adminClient.from("order_read_model").select("id, currency").limit(1).then(console.log);
