export const MEDIA_BUCKET = "media";
export const REFERENCE_PAGE_SIZE = 1000;
export const DEFAULT_SAMPLE_LIMIT = 25;

export const MANAGED_MEDIA_PREFIXES = [
  "categories/",
  "products/",
  "avatars/",
  "banners/home_banner_top/",
  "banners/home_banner_bottom/",
  "settings/",
] as const;

export const MEDIA_REFERENCE_SOURCES = [
  { table: "product_images", idColumn: "id", columns: ["url"] },
  { table: "categories", idColumn: "id", columns: ["logo_url"] },
  { table: "profiles", idColumn: "id", columns: ["avatar_url"] },
  { table: "home_banners", idColumn: "id", columns: ["media_path"] },
  { table: "settings", idColumn: "id", columns: ["primary_logo_url"] },
] as const;

type ReferenceRow = Record<string, unknown>;

type QueryResult = {
  data: ReferenceRow[] | null;
  error: { message: string } | null;
};

type SupabaseQuery = {
  range: (from: number, to: number) => Promise<QueryResult>;
};

type SupabaseTableQuery = {
  select: (columns: string) => SupabaseQuery;
};

export type CleanupSupabaseClient = {
  from: (table: string) => SupabaseTableQuery;
};

export interface InvalidReference {
  table: string;
  column: string;
  rowId: string | null;
  rawValue: string;
  reason: string;
}

export interface ReferencedMediaPathsResult {
  paths: Set<string>;
  invalidReferenceCount: number;
  invalidReferences: InvalidReference[];
}

export interface CleanupRequestError {
  status: number;
  body: { error: string };
}

function isSafeStoragePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("..") && !path.includes("//");
}

function normalizeRelativeStoragePath(value: string): string | null {
  const trimmedValue = value.trim();

  if (!trimmedValue || trimmedValue.startsWith("http://") || trimmedValue.startsWith("https://")) {
    return null;
  }

  return isSafeStoragePath(trimmedValue) ? trimmedValue : null;
}

function inspectStorageReference(
  value: unknown,
  bucket: string,
): { path: string | null; reason: string | null; rawValue: string | null } {
  if (typeof value !== "string") {
    return { path: null, reason: null, rawValue: null };
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return { path: null, reason: null, rawValue: value };
  }

  if (!trimmedValue.startsWith("http://") && !trimmedValue.startsWith("https://")) {
    return {
      path: normalizeRelativeStoragePath(trimmedValue),
      reason: isSafeStoragePath(trimmedValue) ? null : "unsafe_relative_path",
      rawValue: value,
    };
  }

  let url: URL;

  try {
    url = new URL(trimmedValue);
  } catch {
    return { path: null, reason: "invalid_url", rawValue: value };
  }

  const prefixes = [
    `/storage/v1/object/public/${bucket}/`,
    `/storage/v1/object/authenticated/${bucket}/`,
    `/storage/v1/object/sign/${bucket}/`,
  ];

  for (const prefix of prefixes) {
    if (!url.pathname.startsWith(prefix)) {
      continue;
    }

    let normalizedPath: string;

    try {
      normalizedPath = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch {
      return { path: null, reason: "invalid_url_encoding", rawValue: value };
    }

    return {
      path: isSafeStoragePath(normalizedPath) ? normalizedPath : null,
      reason: isSafeStoragePath(normalizedPath) ? null : "unsafe_storage_path",
      rawValue: value,
    };
  }

  return { path: null, reason: "unsupported_storage_url", rawValue: value };
}

export function normalizeStorageReference(value: unknown, bucket: string): string | null {
  return inspectStorageReference(value, bucket).path;
}

function buildSelectClause(idColumn: string, columns: readonly string[]): string {
  return Array.from(new Set([idColumn, ...columns])).join(", ");
}

async function loadAllRows(
  supabase: CleanupSupabaseClient,
  table: string,
  idColumn: string,
  columns: readonly string[],
): Promise<ReferenceRow[]> {
  const rows: ReferenceRow[] = [];
  let page = 0;

  while (true) {
    const from = page * REFERENCE_PAGE_SIZE;
    const to = from + REFERENCE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(table)
      .select(buildSelectClause(idColumn, columns))
      .range(from, to);

    if (error) {
      throw new Error(`Failed to load ${table} media references: ${error.message}`);
    }

    const currentPage = data ?? [];
    rows.push(...currentPage);

    if (currentPage.length < REFERENCE_PAGE_SIZE) {
      return rows;
    }

    page += 1;
  }
}

export function getCleanupRequestError(
  req: Pick<Request, "method" | "headers">,
  serviceRoleKey: string | undefined,
): CleanupRequestError | null {
  if (req.method !== "POST") {
    return {
      status: 405,
      body: { error: "Method Not Allowed" },
    };
  }

  if (!serviceRoleKey) {
    return {
      status: 500,
      body: { error: "Cleanup service is not configured" },
    };
  }

  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return {
      status: 401,
      body: { error: "Unauthorized" },
    };
  }

  return null;
}

export function filterManagedMediaPaths(paths: string[]): string[] {
  return paths.filter((path) => MANAGED_MEDIA_PREFIXES.some((prefix) => path.startsWith(prefix)));
}

export async function collectReferencedMediaPaths(
  supabase: CleanupSupabaseClient,
  bucket: string,
  options?: { sampleLimit?: number },
): Promise<ReferencedMediaPathsResult> {
  const sampleLimit = options?.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;
  const results = await Promise.all(
    MEDIA_REFERENCE_SOURCES.map(async ({ table, idColumn, columns }) => {
      const data = await loadAllRows(supabase, table, idColumn, columns);
      return { table, idColumn, columns, data };
    }),
  );

  const paths = new Set<string>();
  let invalidReferenceCount = 0;
  const invalidReferences: InvalidReference[] = [];

  for (const { table, idColumn, columns, data } of results) {
    for (const row of data) {
      const rowId = row[idColumn] == null ? null : String(row[idColumn]);

      for (const column of columns) {
        const inspection = inspectStorageReference(row[column], bucket);

        if (!inspection.rawValue) {
          continue;
        }

        if (!inspection.path) {
          invalidReferenceCount += 1;
          if (invalidReferences.length < sampleLimit) {
            invalidReferences.push({
              table,
              column,
              rowId,
              rawValue: inspection.rawValue,
              reason: inspection.reason ?? "invalid_reference",
            });
          }
          continue;
        }

        paths.add(inspection.path);
      }
    }
  }

  return {
    paths,
    invalidReferenceCount,
    invalidReferences,
  };
}
