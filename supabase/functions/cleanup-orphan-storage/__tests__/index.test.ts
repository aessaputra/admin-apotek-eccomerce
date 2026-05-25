import { describe, expect, it, vi } from "vitest";
import {
  createCleanupHandler,
  type CleanupAdminClient,
  type CleanupEnvironment,
  type CleanupRunQuery,
  type CleanupCandidate,
  type CleanupStorageClient,
  type CleanupRunTable,
} from "../handler.ts";

const TEST_ENV: CleanupEnvironment = {
  get: (key: string) => {
    if (key === "SUPABASE_SERVICE_ROLE_KEY") {
      return "service-role";
    }

    if (key === "SUPABASE_URL") {
      return "https://demo.supabase.co";
    }

    return undefined;
  },
};

function createStorageCleanupRunsTable() {
  const insertedRows: Record<string, unknown>[] = [];
  const updatedRows: Array<{ id: string; values: Record<string, unknown> }> = [];
  let activeRunId: string | null = null;

  const table: CleanupRunTable = {
    select: () => {
      const query = {} as CleanupRunQuery;
      query.eq = () => query;
      query.gte = () => query;
      query.limit = () => query;
      query.range = async () => ({ data: [], error: null });
      query.maybeSingle = async <T,>() => ({
        data: (activeRunId ? ({ id: activeRunId } as T) : null),
        error: null,
      });
      query.single = async <T,>() => ({
        data: { id: "run-1" } as T,
        error: null,
      });

      return query;
    },
    insert: (values: Record<string, unknown>) => {
      insertedRows.push(values);
      return {
        select: () => {
          const query = {} as CleanupRunQuery;
          query.eq = () => query;
          query.gte = () => query;
          query.limit = () => query;
          query.range = async () => ({ data: [], error: null });
          query.maybeSingle = async () => ({ data: null, error: null });
          query.single = async <T,>() => ({ data: { id: "run-1" } as T, error: null });

          return query;
        },
      };
    },
    update: (values: Record<string, unknown>) => ({
      eq: async (_column: string, id: string) => {
        updatedRows.push({ id, values });
        return { error: null };
      },
    }),
  };

  return {
    table,
    insertedRows,
    updatedRows,
    setActiveRunId(value: string | null) {
      activeRunId = value;
    },
  };
}

function createClientMock(options?: { remove?: CleanupStorageClient["remove"]; runsTable?: CleanupRunTable }): CleanupAdminClient {
  return {
    from: (table: string) => {
      if (table === "storage_cleanup_runs" && options?.runsTable) {
        return options.runsTable;
      }

      throw new Error(`Unexpected table ${table}`);
    },
    rpc: async () => ({ data: [], error: null }),
    storage: {
      from: () => ({
        remove: options?.remove ?? vi.fn(async () => ({ error: null })),
        move: vi.fn(async () => ({ error: null })),
      }),
    },
  };
}

describe("createCleanupHandler", () => {
  it("returns a dry-run report without deleting objects", async () => {
    const runs = createStorageCleanupRunsTable();
    const removeSpy = vi.fn(async (_paths: string[]) => ({ error: null }));
    const remove: CleanupStorageClient["remove"] = (paths) => removeSpy(paths);

    const handler = createCleanupHandler({
      createClientFn: () => createClientMock({ remove, runsTable: runs.table }),
      env: TEST_ENV,
      collectReferencedMediaPathsFn: vi.fn(async () => ({
        paths: new Set(["products/keep.png"]),
        invalidReferenceCount: 1,
        invalidReferences: [
          {
            table: "settings",
            column: "primary_logo_url",
            rowId: "1",
            rawValue: "../unsafe.png",
            reason: "unsafe_relative_path",
          },
        ],
      })),
      listAllPathsFn: vi.fn<() => Promise<CleanupCandidate[]>>(async () => [
        { path: "products/keep.png", createdAt: "2026-04-14T00:00:00.000Z" },
        { path: "products/orphan.png", createdAt: "2026-04-14T00:00:00.000Z" },
        { path: "misc/ignored.txt", createdAt: "2026-04-14T00:00:00.000Z" },
      ]),
      now: () => new Date("2026-04-16T12:00:00.000Z"),
      log: vi.fn(),
    });

    const response = await handler(
      new Request("https://example.test/functions/v1/cleanup-orphan-storage", {
        method: "POST",
        headers: {
          Authorization: "Bearer service-role",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: "dry-run", triggerSource: "test" }),
      }),
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      mode: "dry-run",
      orphanCount: 1,
      orphanSamples: ["products/orphan.png"],
      invalidReferenceCount: 1,
      deleted: 0,
    });
    expect(removeSpy).not.toHaveBeenCalled();
    expect(runs.insertedRows[0]).toMatchObject({ mode: "dry-run", status: "running", trigger_source: "test" });
    expect(runs.updatedRows.at(-1)?.values).toMatchObject({ status: "succeeded", orphan_count: 1, deleted_count: 0 });
  });

  it("aborts delete mode when invalid references exist", async () => {
    const runs = createStorageCleanupRunsTable();
    const removeSpy = vi.fn(async (_paths: string[]) => ({ error: null }));
    const remove: CleanupStorageClient["remove"] = (paths) => removeSpy(paths);

    const handler = createCleanupHandler({
      createClientFn: () => createClientMock({ remove, runsTable: runs.table }),
      env: TEST_ENV,
      collectReferencedMediaPathsFn: vi.fn(async () => ({
        paths: new Set<string>(),
        invalidReferenceCount: 2,
        invalidReferences: [
          { table: "home_banners", column: "media_path", rowId: "banner-1", rawValue: "../bad.png", reason: "unsafe_relative_path" },
          { table: "profiles", column: "avatar_url", rowId: "user-1", rawValue: "../avatar.png", reason: "unsafe_relative_path" },
        ],
      })),
      listAllPathsFn: vi.fn<() => Promise<CleanupCandidate[]>>(async () => [
        { path: "products/orphan.png", createdAt: "2026-04-14T00:00:00.000Z" },
      ]),
      now: () => new Date("2026-04-16T12:00:00.000Z"),
      log: vi.fn(),
    });

    const response = await handler(
      new Request("https://example.test/functions/v1/cleanup-orphan-storage", {
        method: "POST",
        headers: {
          Authorization: "Bearer service-role",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: "delete" }),
      }),
    );

    const payload = await response.json();
    const payloadText = JSON.stringify(payload);

    expect(response.status).toBe(409);
    expect(payload).toMatchObject({
      error: "Cleanup aborted because invalid storage references were detected",
      invalidReferenceCount: 2,
      invalidReferenceCategories: { unsafe_relative_path: 2 },
    });
    expect(payload).not.toHaveProperty("invalidReferences");
    expect(payloadText).not.toContain("home_banners");
    expect(payloadText).not.toContain("media_path");
    expect(payloadText).not.toContain("banner-1");
    expect(payloadText).not.toContain("../bad.png");
    expect(removeSpy).not.toHaveBeenCalled();
    expect(runs.updatedRows.at(-1)?.values).toMatchObject({ status: "failed", invalid_reference_count: 2 });
  });

  it("redacts cleanup execution failures from caller responses", async () => {
    const runs = createStorageCleanupRunsTable();
    const log = vi.fn();
    const handler = createCleanupHandler({
      createClientFn: () => createClientMock({ runsTable: runs.table }),
      env: TEST_ENV,
      collectReferencedMediaPathsFn: vi.fn(async () => {
        throw new Error("Failed to load home_banners media references: permission denied for table storage.objects");
      }),
      listAllPathsFn: vi.fn(),
      now: () => new Date("2026-04-16T12:00:00.000Z"),
      log,
    });

    const response = await handler(
      new Request("https://example.test/functions/v1/cleanup-orphan-storage", {
        method: "POST",
        headers: {
          Authorization: "Bearer service-role",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: "dry-run" }),
      }),
    );

    const payload = await response.json();
    const payloadText = JSON.stringify(payload);

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Cleanup failed", runId: "run-1" });
    expect(payloadText).not.toContain("home_banners");
    expect(payloadText).not.toContain("storage.objects");
    expect(payloadText).not.toContain("permission denied");
    const loggedText = JSON.stringify(log.mock.calls);
    expect(loggedText).toContain("cleanup_orphan_storage_failed");
    expect(loggedText).toContain("execution_failed");
    expect(loggedText).not.toContain("home_banners");
    expect(loggedText).not.toContain("storage.objects");
    expect(loggedText).not.toContain("permission denied");
    expect(loggedText).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    const finalRunValues = runs.updatedRows.at(-1)?.values;
    expect(finalRunValues).toMatchObject({
      status: "failed",
      error_message: "cleanup_execution_failed",
    });
    const persistedText = JSON.stringify(finalRunValues);
    expect(persistedText).not.toContain("home_banners");
    expect(persistedText).not.toContain("storage.objects");
    expect(persistedText).not.toContain("permission denied");
    expect(persistedText).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("skips execution when another run is still active", async () => {
    const runs = createStorageCleanupRunsTable();
    runs.setActiveRunId("run-active");

    const handler = createCleanupHandler({
      createClientFn: () => createClientMock({ runsTable: runs.table }),
      env: TEST_ENV,
      collectReferencedMediaPathsFn: vi.fn(),
      listAllPathsFn: vi.fn(),
      now: () => new Date("2026-04-16T12:00:00.000Z"),
      log: vi.fn(),
    });

    const response = await handler(
      new Request("https://example.test/functions/v1/cleanup-orphan-storage", {
        method: "POST",
        headers: {
          Authorization: "Bearer service-role",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: "dry-run" }),
      }),
    );

    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toMatchObject({ error: expect.stringContaining("still active"), runningRunId: "run-active" });
    expect(runs.insertedRows).toHaveLength(0);
  });

  it("quarantines old orphan files instead of deleting them in delete mode", async () => {
    const runs = createStorageCleanupRunsTable();
    const moveSpy = vi.fn(async (_from: string, _to: string) => ({ error: null }));
    const client = createClientMock({ runsTable: runs.table });
    client.storage.from = () => ({
      remove: vi.fn(async () => ({ error: null })),
      move: (from, to) => moveSpy(from, to),
    });

    const handler = createCleanupHandler({
      createClientFn: () => client,
      env: TEST_ENV,
      collectReferencedMediaPathsFn: vi.fn(async () => ({
        paths: new Set<string>(),
        invalidReferenceCount: 0,
        invalidReferences: [],
      })),
      listAllPathsFn: vi.fn<() => Promise<CleanupCandidate[]>>(async () => [
        { path: "products/orphan.png", createdAt: "2026-04-14T00:00:00.000Z" },
      ]),
      now: () => new Date("2026-04-16T12:00:00.000Z"),
      log: vi.fn(),
    });

    const response = await handler(
      new Request("https://example.test/functions/v1/cleanup-orphan-storage", {
        method: "POST",
        headers: {
          Authorization: "Bearer service-role",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: "delete", minimumOrphanAgeHours: 24 }),
      }),
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(moveSpy).toHaveBeenCalledWith(
      "products/orphan.png",
      "__orphan_quarantine/2026-04-16T12-00-00.000Z/products/orphan.png",
    );
    expect(payload).toMatchObject({ quarantined: 1, deleted: 0, orphanCount: 1 });
    expect(runs.updatedRows.at(-1)?.values).toMatchObject({ quarantined_count: 1 });
  });

  it("passes an orphan age threshold to the candidate lister", async () => {
    const runs = createStorageCleanupRunsTable();
    const listAllPathsFn = vi.fn<() => Promise<CleanupCandidate[]>>(async () => []);

    const handler = createCleanupHandler({
      createClientFn: () => createClientMock({ runsTable: runs.table }),
      env: TEST_ENV,
      collectReferencedMediaPathsFn: vi.fn(async () => ({
        paths: new Set<string>(),
        invalidReferenceCount: 0,
        invalidReferences: [],
      })),
      listAllPathsFn,
      now: () => new Date("2026-04-16T12:00:00.000Z"),
      log: vi.fn(),
    });

    await handler(
      new Request("https://example.test/functions/v1/cleanup-orphan-storage", {
        method: "POST",
        headers: {
          Authorization: "Bearer service-role",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: "dry-run", minimumOrphanAgeHours: 48 }),
      }),
    );

    expect(listAllPathsFn).toHaveBeenCalledWith(
      expect.anything(),
      "media",
      "2026-04-14T12:00:00.000Z",
    );
  });
});
