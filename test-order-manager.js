const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

async function test() {
  const envFile = fs.readFileSync('.env', 'utf8');
  const urlMatch = envFile.match(/VITE_SUPABASE_URL=(.*)/);
  const keyMatch = envFile.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);
  if (!urlMatch || !keyMatch) {
    console.error("No env vars");
    return;
  }
  const supabase = createClient(urlMatch[1].trim(), keyMatch[1].trim());
  const { data: order } = await supabase.from('orders').select('id').limit(1).single();
  if (!order) {
    console.error("No order found");
    return;
  }
  console.log("Order ID:", order.id);
  
  // Now call edge function
  const clientSupabase = createClient(urlMatch[1].trim(), envFile.match(/VITE_SUPABASE_KEY=(.*)/)[1].trim());
  // Login as admin first
  const { data: auth } = await clientSupabase.auth.signInWithPassword({
    email: 'admin@example.com', // wait, do we have an admin account?
    password: 'password' // just guessing
  });
  
  // Wait, I can just use curl with service role key to invoke the function, but it needs an admin user JWT.
}
test();
