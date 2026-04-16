import {
  collectReferencedMediaPaths,
  DEFAULT_SAMPLE_LIMIT,
  filterManagedMediaPaths,
  getCleanupRequestError,
  MEDIA_BUCKET,
} from "../_shared/cleanup-orphan-storage.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };
const DEFAULT_DELETE_BATCH_SIZE = 100;
const DEFAULT_MAX_DELETE_COUNT = 200;
const DEFAULT_RUNNING_WINDOW_MINUTES = 30;
const DEFAULT_MINIMUM_ORPHAN_AGE_HOURS = 24;
const DEFAULT_QUARANTINE_PREFIX = "__orphan_quarantine";

type CleanupMode = "dry-run" | "delete";

interface CleanupRequestBody {
  mode?: CleanupMode;
  sampleLimit?: number;
  maxDeleteCount?: number;
  triggerSource?: string;
  abortOnInvalidReferences?: boolean;
  minimumOrphanAgeHours?: number;
}

export interface CleanupEnvironment {
  get: (key: string) => string | undefined;
}

export interface CleanupRunQuery {
  eq: (column: string, value: unknown) => CleanupRunQuery;
  gte: (column: string, value: string) => CleanupRunQuery;
  limit: (value: number) => CleanupRunQuery;
  range: (from: number, to: number) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
  maybeSingle: <T>() => Promise<{ data: T | null; error: { message: string } | null }>;
  single: <T>() => Promise<{ data: T; error: { message: string } | null }>;
}

export interface CleanupRunTable {
  select: (columns: string) => CleanupRunQuery;
  insert: (values: Record<string, unknown>) => { select: (columns: string) => CleanupRunQuery };
  update: (values: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: { message: string } | null }> };
}

export interface CleanupStorageClient {
  remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
  move: (fromPath: string, toPath: string) => Promise<{ error: { message: string } | null }>;
}

export interface CleanupAdminClient {
  from: (table: string) => CleanupRunTable;
  rpc: <T>(fn: string, args: Record<string, unknown>) => Promise<{ data: T[] | null; error: { message: string } | null }>;
  storage: {
    from: (bucket: string) => CleanupStorageClient;
  };
}

interface CleanupHandlerDependencies {
  createClientFn: (url: string, key: string) => CleanupAdminClient;
  env: CleanupEnvironment;
  collectReferencedMediaPathsFn?: typeof collectReferencedMediaPaths;
  listAllPathsFn?: typeof listAllPaths;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function clampPositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.trunc(value), max));
}

async function parseCleanupRequest(req: Request): Promise<CleanupRequestBody> {
  const contentLength = req.headers.get("Content-Length");
  if (contentLength === "0") {
    return {};
  }

  try {
    return (await req.json()) as CleanupRequestBody;
  } catch {
    return {};
  }
}

interface CleanupStorageObjectRow {
  name: string;
  created_at: string | null;
}

export interface CleanupCandidate {
  path: string;
  createdAt: string | null;
}

function toQuarantinePath(path: string, timestamp: string): string {
  const safeTimestamp = timestamp.replace(/:/g, "-");
  return `${DEFAULT_QUARANTINE_PREFIX}/${safeTimestamp}/${path}`;
}

export async function listAllPaths(
  supabase: CleanupAdminClient,
  bucket: string,
  olderThanIso: string,
): Promise<CleanupCandidate[]> {
  const paths: CleanupCandidate[] = [];

  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.rpc<CleanupStorageObjectRow>("list_cleanup_storage_objects", {
      bucketid: bucket,
      older_than: olderThanIso,
      limits: 1000,
      offsets: offset,
    });

    if (error) {
      throw error;
    }

    paths.push(
      ...(data ?? []).map((item) => ({
        path: item.name,
        createdAt: item.created_at,
      })),
    );

    if ((data ?? []).length < 1000) {
      return paths;
    }
  }
}

async function findRunningCleanupRun(
  supabase: CleanupAdminClient,
  startedAfterIso: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("storage_cleanup_runs")
    .select("id")
    .eq("status", "running")
    .gte("started_at", startedAfterIso)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) {
    throw error;
  }

  return data?.id ?? null;
}

async function createCleanupRun(
  supabase: CleanupAdminClient,
  payload: CleanupRequestBody,
  mode: CleanupMode,
  startedAt: string,
) {
  const { data, error } = await supabase
    .from("storage_cleanup_runs")
    .insert({
      mode,
      status: "running",
      trigger_source: payload.triggerSource ?? "manual",
      started_at: startedAt,
      request_payload: payload,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    throw error;
  }

  return data.id;
}

async function finalizeCleanupRun(
  supabase: CleanupAdminClient,
  runId: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabase.from("storage_cleanup_runs").update(values).eq("id", runId);

  if (error) {
    throw error;
  }
}

export function createCleanupHandler(dependencies: CleanupHandlerDependencies) {
  const collectReferencedMediaPathsFn =
    dependencies.collectReferencedMediaPathsFn ?? collectReferencedMediaPaths;
  const listAllPathsFn = dependencies.listAllPathsFn ?? listAllPaths;
  const now = dependencies.now ?? (() => new Date());
  const log = dependencies.log ?? ((entry) => console.info(JSON.stringify(entry)));

  return async (req: Request) => {
    const requestError = getCleanupRequestError(req, dependencies.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    if (requestError) {
      return jsonResponse(requestError.body, requestError.status);
    }

    const payload = await parseCleanupRequest(req);
    const mode: CleanupMode = payload.mode === "delete" ? "delete" : "dry-run";
      const sampleLimit = clampPositiveInteger(payload.sampleLimit, DEFAULT_SAMPLE_LIMIT, 100);
      const maxDeleteCount = clampPositiveInteger(payload.maxDeleteCount, DEFAULT_MAX_DELETE_COUNT, 10_000);
      const minimumOrphanAgeHours = clampPositiveInteger(
        payload.minimumOrphanAgeHours,
        DEFAULT_MINIMUM_ORPHAN_AGE_HOURS,
        24 * 30,
      );
      const abortOnInvalidReferences = payload.abortOnInvalidReferences ?? mode === "delete";
      const startedAt = now().toISOString();
      const runningWindowStart = new Date(now().getTime() - DEFAULT_RUNNING_WINDOW_MINUTES * 60_000).toISOString();
      const orphanOlderThan = new Date(now().getTime() - minimumOrphanAgeHours * 60 * 60_000).toISOString();

    const supabaseUrl = dependencies.env.get("SUPABASE_URL")!;
    const supabaseKey = dependencies.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = dependencies.createClientFn(supabaseUrl, supabaseKey);

    const runningRunId = await findRunningCleanupRun(supabase, runningWindowStart);
    if (runningRunId) {
      return jsonResponse(
        {
          error: "Cleanup skipped because another run is still active",
          runningRunId,
        },
        409,
      );
    }

    const runId = await createCleanupRun(supabase, payload, mode, startedAt);

    try {
      const referenceResult = await collectReferencedMediaPathsFn(supabase, MEDIA_BUCKET, { sampleLimit });
      const candidates = await listAllPathsFn(supabase, MEDIA_BUCKET, orphanOlderThan);
      const allPaths = filterManagedMediaPaths(candidates.map((candidate) => candidate.path));
      const orphans = allPaths.filter((path) => !referenceResult.paths.has(path));
      const orphanSamples = orphans.slice(0, sampleLimit);

      if (abortOnInvalidReferences && referenceResult.invalidReferenceCount > 0) {
        const response = {
          error: "Cleanup aborted because invalid storage references were detected",
          runId,
          invalidReferenceCount: referenceResult.invalidReferenceCount,
          invalidReferences: referenceResult.invalidReferences,
          orphanCount: orphans.length,
          referencedCount: referenceResult.paths.size,
          mode,
        };

        await finalizeCleanupRun(supabase, runId, {
          status: "failed",
          finished_at: now().toISOString(),
          referenced_count: referenceResult.paths.size,
          orphan_count: orphans.length,
          deleted_count: 0,
          invalid_reference_count: referenceResult.invalidReferenceCount,
          sample_orphans: orphanSamples,
          sample_invalid_references: referenceResult.invalidReferences,
          error_message: response.error,
        });

        return jsonResponse(response, 409);
      }

      if (mode === "dry-run") {
        const response = {
          runId,
          mode,
          deleted: 0,
          orphanCount: orphans.length,
          orphanSamples,
          referencedCount: referenceResult.paths.size,
          invalidReferenceCount: referenceResult.invalidReferenceCount,
          invalidReferences: referenceResult.invalidReferences,
          minimumOrphanAgeHours,
          message: "Orphan cleanup dry-run completed",
        };

        await finalizeCleanupRun(supabase, runId, {
          status: "succeeded",
          finished_at: now().toISOString(),
          referenced_count: referenceResult.paths.size,
          orphan_count: orphans.length,
          deleted_count: 0,
          invalid_reference_count: referenceResult.invalidReferenceCount,
          sample_orphans: orphanSamples,
          sample_invalid_references: referenceResult.invalidReferences,
        });

        log({ action: "cleanup_orphan_storage", mode, runId, orphanCount: orphans.length, deletedCount: 0 });
        return jsonResponse(response);
      }

      if (orphans.length > maxDeleteCount) {
        const response = {
          error: "Cleanup aborted because orphan count exceeded the configured safety limit",
          runId,
          orphanCount: orphans.length,
          maxDeleteCount,
          orphanSamples,
        };

        await finalizeCleanupRun(supabase, runId, {
          status: "failed",
          finished_at: now().toISOString(),
          referenced_count: referenceResult.paths.size,
          orphan_count: orphans.length,
          deleted_count: 0,
          invalid_reference_count: referenceResult.invalidReferenceCount,
          sample_orphans: orphanSamples,
          sample_invalid_references: referenceResult.invalidReferences,
          error_message: response.error,
        });

        return jsonResponse(response, 409);
      }

      let deletedCount = 0;
      const quarantineSamples: string[] = [];

      for (let i = 0; i < orphans.length; i += DEFAULT_DELETE_BATCH_SIZE) {
        const batch = orphans.slice(i, i + DEFAULT_DELETE_BATCH_SIZE);

        for (const path of batch) {
          const quarantinePath = toQuarantinePath(path, startedAt);
          const { error } = await supabase.storage.from(MEDIA_BUCKET).move(path, quarantinePath);

          if (error) {
            throw error;
          }

          if (quarantineSamples.length < sampleLimit) {
            quarantineSamples.push(quarantinePath);
          }

          deletedCount += 1;
        }
      }

      const response = {
        runId,
        mode,
        deleted: 0,
        quarantined: deletedCount,
        orphanCount: orphans.length,
        orphanSamples,
        quarantineSamples,
        referencedCount: referenceResult.paths.size,
        invalidReferenceCount: referenceResult.invalidReferenceCount,
        invalidReferences: referenceResult.invalidReferences,
        minimumOrphanAgeHours,
        message: "Orphan cleanup quarantine completed",
      };

      await finalizeCleanupRun(supabase, runId, {
        status: "succeeded",
        finished_at: now().toISOString(),
        referenced_count: referenceResult.paths.size,
        orphan_count: orphans.length,
        deleted_count: deletedCount,
        invalid_reference_count: referenceResult.invalidReferenceCount,
        sample_orphans: orphanSamples,
        sample_quarantined_paths: quarantineSamples,
        sample_invalid_references: referenceResult.invalidReferences,
        quarantined_count: deletedCount,
      });

      log({ action: "cleanup_orphan_storage", mode, runId, orphanCount: orphans.length, quarantinedCount: deletedCount });
      return jsonResponse(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected cleanup error";

      await finalizeCleanupRun(supabase, runId, {
        status: "failed",
        finished_at: now().toISOString(),
        error_message: message,
      });

      return jsonResponse({ error: message, runId }, 500);
    }
  };
}
