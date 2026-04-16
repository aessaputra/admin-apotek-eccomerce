export const MEDIA_BUCKET = "media";
const REFERENCE_PAGE_SIZE = 1000;

export const MEDIA_REFERENCE_SOURCES = [
  { table: "product_images", columns: ["url"] },
  { table: "categories", columns: ["logo_url"] },
  { table: "profiles", columns: ["avatar_url"] },
  { table: "home_banners", columns: ["media_path"] },
  { table: "settings", columns: ["primary_logo_url", "app_icon_url"] },
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

export interface ReferencedMediaPathsResult {
  paths: Set<string>;
  invalidReferenceCount: number;
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

function extractBucketPathFromUrl(value: string, bucket: string): string | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
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
      return null;
    }

    return isSafeStoragePath(normalizedPath) ? normalizedPath : null;
  }

  return null;
}

export function normalizeStorageReference(value: unknown, bucket: string): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return extractBucketPathFromUrl(value, bucket) ?? normalizeRelativeStoragePath(value);
}

function buildSelectClause(columns: readonly string[]): string {
  return columns.join(", ");
}

async function loadAllRows(
  supabase: CleanupSupabaseClient,
  table: string,
  columns: readonly string[],
): Promise<ReferenceRow[]> {
  const rows: ReferenceRow[] = [];
  let page = 0;

  while (true) {
    const from = page * REFERENCE_PAGE_SIZE;
    const to = from + REFERENCE_PAGE_SIZE - 1;
    const { data, error } = await supabase.from(table).select(buildSelectClause(columns)).range(from, to);

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
      body: { error: "SUPABASE_SERVICE_ROLE_KEY is not configured" },
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

export async function collectReferencedMediaPaths(
  supabase: CleanupSupabaseClient,
  bucket: string,
): Promise<ReferencedMediaPathsResult> {
  const results = await Promise.all(
    MEDIA_REFERENCE_SOURCES.map(async ({ table, columns }) => {
      const data = await loadAllRows(supabase, table, columns);
      return { columns, data };
    }),
  );

  const paths = new Set<string>();
  let invalidReferenceCount = 0;

  for (const { columns, data } of results) {
    for (const row of data) {
      for (const column of columns) {
        const rawValue = row[column];

        if (rawValue == null || rawValue === "") {
          continue;
        }

        const normalizedPath = normalizeStorageReference(rawValue, bucket);

        if (!normalizedPath) {
          invalidReferenceCount += 1;
          continue;
        }

        paths.add(normalizedPath);
      }
    }
  }

  return {
    paths,
    invalidReferenceCount,
  };
}
