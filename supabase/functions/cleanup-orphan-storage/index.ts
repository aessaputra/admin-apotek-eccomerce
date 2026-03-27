import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PRODUCT_IMAGES_BUCKET = "product-images";
const CATEGORY_LOGO_BUCKET = "category-logos";

function getStoragePathFromUrl(url: string, bucket: string): string | null {
  if (!url || typeof url !== "string") return null;
  const escaped = bucket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = url.match(new RegExp(`/storage/v1/object/public/${escaped}/(.+)`));
  return match ? match[1] : null;
}

async function listAllPaths(
  supabase: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string
): Promise<string[]> {
  const { data } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
  const paths: string[] = [];
  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id != null) paths.push(path);
    else paths.push(...(await listAllPaths(supabase, bucket, path)));
  }
  return paths;
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization. Use Bearer <service_role_key>." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const referenced: Record<string, Set<string>> = {
    [PRODUCT_IMAGES_BUCKET]: new Set(),
    [CATEGORY_LOGO_BUCKET]: new Set(),
  };

  const { data: productImages } = await supabase.from("product_images").select("url");
  for (const row of productImages ?? []) {
    const path = getStoragePathFromUrl(row.url, PRODUCT_IMAGES_BUCKET);
    if (path) referenced[PRODUCT_IMAGES_BUCKET].add(path);
  }

  const { data: categories } = await supabase.from("categories").select("logo_url");
  for (const row of categories ?? []) {
    const path = getStoragePathFromUrl(row.logo_url, CATEGORY_LOGO_BUCKET);
    if (path) referenced[CATEGORY_LOGO_BUCKET].add(path);
  }

  let deletedCount = 0;

  for (const bucket of [PRODUCT_IMAGES_BUCKET, CATEGORY_LOGO_BUCKET]) {
    const allPaths = await listAllPaths(supabase, bucket, "");
    const orphans = allPaths.filter((p) => !referenced[bucket].has(p));

    for (let i = 0; i < orphans.length; i += 100) {
      const batch = orphans.slice(i, i + 100);
      await supabase.storage.from(bucket).remove(batch);
      deletedCount += batch.length;
    }
  }

  return new Response(
    JSON.stringify({ deleted: deletedCount, message: "Orphan cleanup completed" }),
    { headers: { "Content-Type": "application/json" } }
  );
});
