import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const supabaseAuth = createClient(supabaseUrl, anonKey);

  const token = authHeader.replace("Bearer ", "");
  const { data: { user: caller }, error: authError } = await supabaseAuth.auth.getUser(token);

  if (authError || !caller) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("id", caller.id).single();

  if (profile?.role !== "admin") {
    return new Response(
      JSON.stringify({ error: "Only admin can ban/unban customers" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const body = (await req.json()) as { userId?: string; action?: string };
  const { userId, action } = body;

  if (!userId || typeof userId !== "string") {
    return new Response(
      JSON.stringify({ error: "userId is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (action !== "ban" && action !== "unban") {
    return new Response(
      JSON.stringify({ error: "action must be ban or unban" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (userId === caller.id) {
    return new Response(
      JSON.stringify({ error: "Cannot ban yourself" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: targetProfile } = await supabaseAdmin.from("profiles").select("role").eq("id", userId).single();

  if (targetProfile?.role === "admin") {
    return new Response(
      JSON.stringify({ error: "Cannot ban admin users" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (action === "ban") {
    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: "100y" });
    if (banError) {
      return new Response(
        JSON.stringify({ error: banError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    await supabaseAdmin.from("profiles").update({ is_banned: true }).eq("id", userId);
  } else {
    const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: "none" });
    if (unbanError) {
      return new Response(
        JSON.stringify({ error: unbanError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    await supabaseAdmin.from("profiles").update({ is_banned: false }).eq("id", userId);
  }

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
