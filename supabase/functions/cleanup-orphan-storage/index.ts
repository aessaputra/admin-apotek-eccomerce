import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  collectReferencedMediaPaths,
  getCleanupRequestError,
  MEDIA_BUCKET,
} from "../_shared/cleanup-orphan-storage.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

async function listAllPaths(
  supabase: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string
): Promise<string[]> {
  const paths: string[] = [];

  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset });

    if (error) {
      throw error;
    }

    for (const item of data ?? []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id != null) paths.push(path);
      else paths.push(...(await listAllPaths(supabase, bucket, path)));
    }

    if ((data ?? []).length < 1000) {
      return paths;
    }
  }
}

Deno.serve(async (req: Request) => {
  const requestError = getCleanupRequestError(req, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (requestError) {
    return jsonResponse(requestError.body, requestError.status);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { paths: referencedPaths, invalidReferenceCount } = await collectReferencedMediaPaths(
    supabase,
    MEDIA_BUCKET,
  );

  if (invalidReferenceCount > 0) {
    return jsonResponse({
      error: "Cleanup aborted because invalid storage references were detected",
      invalidReferenceCount,
      referencedCount: referencedPaths.size,
    }, 409);
  }

  let deletedCount = 0;

  // List all paths in the media bucket
  const allPaths = await listAllPaths(supabase, MEDIA_BUCKET, "");
  const orphans = allPaths.filter((path) => !referencedPaths.has(path));

  for (let i = 0; i < orphans.length; i += 100) {
    const batch = orphans.slice(i, i + 100);
    const { error } = await supabase.storage.from(MEDIA_BUCKET).remove(batch);

    if (error) {
      throw error;
    }

    deletedCount += batch.length;
  }

  return jsonResponse({
      deleted: deletedCount,
      invalidReferenceCount,
      orphanCount: orphans.length,
      referencedCount: referencedPaths.size,
      message: "Orphan cleanup completed",
    });
});
