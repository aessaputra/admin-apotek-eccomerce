import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

async function test() {
  const envFile = fs.readFileSync('.env', 'utf8');
  const urlMatch = envFile.match(/VITE_SUPABASE_URL=(.*)/);
  const keyMatch = envFile.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);
  if (!urlMatch || !keyMatch) {
    console.error("No env vars");
    return;
  }
  const url = urlMatch[1].trim();
  const serviceKey = keyMatch[1].trim();
  const supabase = createClient(url, serviceKey);
  const { data: order } = await supabase.from('orders').select('id').limit(1).single();
  if (!order) {
    console.error("No order found");
    return;
  }
  console.log("Order ID:", order.id);
  
  // Now call edge function
  const anonKey = envFile.match(/VITE_SUPABASE_KEY=(.*)/)[1].trim();
  const clientSupabase = createClient(url, anonKey);
  const { data: auth } = await clientSupabase.auth.signInWithPassword({
    email: 'admin@example.com',
    password: 'password'
  });
  
  const { data, error } = await clientSupabase.functions.invoke("order-manager", {
    body: {
      action: "transition_status",
      orderId: order.id,
      payload: {
        to: "shipped",
        waybill_number: "RESI12345",
        waybill_source: "manual"
      }
    }
  });
  console.log("Response:", data, "Error:", error);
}
test();
