import { createClient } from 'npm:@supabase/supabase-js@2';
import "jsr:@std/dotenv/load";

async function run() {
  const url = Deno.env.get('VITE_SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const adminClient = createClient(url, key);
  
  const { data: order, error } = await adminClient
    .from("order_read_model")
    .select("id")
    .limit(1)
    .single();
    
  console.log("Order from read model:", order, error);
}
run();
