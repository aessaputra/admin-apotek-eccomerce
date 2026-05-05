type SupabaseNumericValue = string | number | bigint | null | undefined;

const JAKARTA_UTC_OFFSET_IN_MILLISECONDS = 7 * 60 * 60 * 1000;
export const JAKARTA_TIME_ZONE = "Asia/Jakarta";
const MONTHS_IN_TREND_RANGE = 12;
const DAYS_IN_TREND_RANGE = 30;
const WEEKS_IN_TREND_RANGE = 12;
const YEARS_IN_TREND_RANGE = 5;
const MAX_SAFE_COUNT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_COUNT = BigInt(Number.MIN_SAFE_INTEGER);

export const operationalTrendGranularities = ["day", "week", "month", "year"] as const;

export type OperationalTrendGranularity = (typeof operationalTrendGranularities)[number];

export interface MonthlyOperationalMetricRow {
  month_start: string | null;
  order_count: SupabaseNumericValue;
  paid_order_count: SupabaseNumericValue;
  completed_order_count: SupabaseNumericValue;
  revenue: SupabaseNumericValue;
}

export interface OperationalMetricRow {
  bucket_start: string | null;
  bucket_end: string | null;
  order_count: SupabaseNumericValue;
  paid_order_count: SupabaseNumericValue;
  completed_order_count: SupabaseNumericValue;
  revenue: SupabaseNumericValue;
}

export interface OperationalTrendRequest {
  granularity: OperationalTrendGranularity;
  startDate: string;
  endDate: string;
  bucketCount: number;
}

export type MonthlyOperationalMetricKey =
  | "orderCount"
  | "paidOrderCount"
  | "completedOrderCount"
  | "revenue";

export interface MonthlyOperationalTrendDisplayRow {
  monthStart: string;
  monthLabel: string;
  orderCount: number;
  paidOrderCount: number;
  completedOrderCount: number;
  revenue: number;
}

export interface MonthlyOperationalTrendChartPoint {
  monthStart: string;
  monthLabel: string;
  metric: MonthlyOperationalMetricKey;
  value: number;
}

export interface MonthlyOperationalTrendTotals {
  orderCount: number;
  paidOrderCount: number;
  completedOrderCount: number;
  revenue: number;
}

export interface MonthlyOperationalTrendData {
  rows: MonthlyOperationalTrendDisplayRow[];
  orderCountChartPoints: MonthlyOperationalTrendChartPoint[];
  paidOrderCountChartPoints: MonthlyOperationalTrendChartPoint[];
  completedOrderCountChartPoints: MonthlyOperationalTrendChartPoint[];
  revenueChartPoints: MonthlyOperationalTrendChartPoint[];
  totals: MonthlyOperationalTrendTotals;
}

export const isValidMonthStart = (monthStart: string | null | undefined): boolean => {
  if (!monthStart) {
    return false;
  }

  return /^\d{4}-\d{2}-01$/.test(monthStart.slice(0, 10));
};

export const isValidBucketStart = (bucketStart: string | null | undefined): boolean => {
  if (!bucketStart) {
    return false;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(bucketStart.slice(0, 10));
};

export const parseSupabaseNumber = (value: SupabaseNumericValue): number => {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const parsedValue = Number(value);

  return Number.isFinite(parsedValue) ? parsedValue : 0;
};

export const parseSupabaseCount = (value: SupabaseNumericValue): number => {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  if (typeof value === "bigint") {
    assertSafeCount(value);
    return Number(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return 0;
    }

    assertSafeNumberCount(value);
    return value;
  }

  const trimmedValue = value.trim();

  if (trimmedValue === "") {
    return 0;
  }

  if (/^-?\d+$/.test(trimmedValue)) {
    const bigintValue = BigInt(trimmedValue);
    assertSafeCount(bigintValue);
    return Number(bigintValue);
  }

  const parsedValue = Number(trimmedValue);

  if (!Number.isFinite(parsedValue)) {
    return 0;
  }

  assertSafeNumberCount(parsedValue);
  return parsedValue;
};

export const getLatestTwelveJakartaMonthStarts = (referenceDate = new Date()): string[] => {
  const jakartaDate = new Date(referenceDate.getTime() + JAKARTA_UTC_OFFSET_IN_MILLISECONDS);
  const currentYear = jakartaDate.getUTCFullYear();
  const currentMonthIndex = jakartaDate.getUTCMonth();

  return Array.from({ length: MONTHS_IN_TREND_RANGE }, (_, index) => {
    const monthOffset = index - (MONTHS_IN_TREND_RANGE - 1);
    return formatMonthStart(currentYear, currentMonthIndex + monthOffset);
  });
};

export const getDefaultOperationalTrendRequest = (
  granularity: OperationalTrendGranularity,
  referenceDate = new Date(),
): OperationalTrendRequest => {
  const currentJakartaDate = getJakartaDate(referenceDate);

  if (granularity === "day") {
    const endDate = formatDate(currentJakartaDate);
    const startDate = formatDate(addDays(currentJakartaDate, -(DAYS_IN_TREND_RANGE - 1)));

    return { granularity, startDate, endDate, bucketCount: DAYS_IN_TREND_RANGE };
  }

  if (granularity === "week") {
    const currentWeekStart = getWeekStart(currentJakartaDate);
    const startDate = formatDate(addDays(currentWeekStart, -(WEEKS_IN_TREND_RANGE - 1) * 7));
    const endDate = formatDate(addDays(currentWeekStart, 6));

    return { granularity, startDate, endDate, bucketCount: WEEKS_IN_TREND_RANGE };
  }

  if (granularity === "year") {
    const currentYear = currentJakartaDate.getUTCFullYear();

    return {
      granularity,
      startDate: formatDate(new Date(Date.UTC(currentYear - (YEARS_IN_TREND_RANGE - 1), 0, 1))),
      endDate: formatDate(new Date(Date.UTC(currentYear, 11, 31))),
      bucketCount: YEARS_IN_TREND_RANGE,
    };
  }

  const currentYear = currentJakartaDate.getUTCFullYear();
  const currentMonthIndex = currentJakartaDate.getUTCMonth();

  return {
    granularity,
    startDate: formatMonthStart(currentYear, currentMonthIndex - (MONTHS_IN_TREND_RANGE - 1)),
    endDate: formatMonthEnd(currentYear, currentMonthIndex),
    bucketCount: MONTHS_IN_TREND_RANGE,
  };
};

export const zeroFillMonthlyOperationalTrendRows = (
  rows: readonly MonthlyOperationalMetricRow[],
  monthStarts: readonly string[],
): MonthlyOperationalTrendDisplayRow[] => {
  const rowsByMonthStart = new Map(
    rows
      .map((row) => [normalizeMonthStart(row.month_start), row] as const)
      .filter((entry): entry is readonly [string, MonthlyOperationalMetricRow] => entry[0] !== null),
  );

  return monthStarts.map((monthStart) => {
    const row = rowsByMonthStart.get(monthStart);

    return {
      monthStart,
      monthLabel: formatMonthLabel(monthStart),
      orderCount: parseSupabaseCount(row?.order_count),
      paidOrderCount: parseSupabaseCount(row?.paid_order_count),
      completedOrderCount: parseSupabaseCount(row?.completed_order_count),
      revenue: parseSupabaseNumber(row?.revenue),
    };
  });
};

export const buildMonthlyOperationalTrendRows = (
  rows: readonly MonthlyOperationalMetricRow[],
  referenceDate = new Date(),
): MonthlyOperationalTrendDisplayRow[] =>
  zeroFillMonthlyOperationalTrendRows(rows, getLatestTwelveJakartaMonthStarts(referenceDate));

export const formatOrderCountChartPoints = (
  rows: readonly MonthlyOperationalTrendDisplayRow[],
): MonthlyOperationalTrendChartPoint[] => formatChartPoints(rows, "orderCount");

export const formatPaidOrderCountChartPoints = (
  rows: readonly MonthlyOperationalTrendDisplayRow[],
): MonthlyOperationalTrendChartPoint[] => formatChartPoints(rows, "paidOrderCount");

export const formatCompletedOrderCountChartPoints = (
  rows: readonly MonthlyOperationalTrendDisplayRow[],
): MonthlyOperationalTrendChartPoint[] => formatChartPoints(rows, "completedOrderCount");

export const formatRevenueChartPoints = (
  rows: readonly MonthlyOperationalTrendDisplayRow[],
): MonthlyOperationalTrendChartPoint[] => formatChartPoints(rows, "revenue");

export const computeMonthlyOperationalTrendTotals = (
  rows: readonly MonthlyOperationalTrendDisplayRow[],
): MonthlyOperationalTrendTotals =>
  rows.reduce<MonthlyOperationalTrendTotals>(
    (totals, row) => ({
      orderCount: totals.orderCount + row.orderCount,
      paidOrderCount: totals.paidOrderCount + row.paidOrderCount,
      completedOrderCount: totals.completedOrderCount + row.completedOrderCount,
      revenue: totals.revenue + row.revenue,
    }),
    { orderCount: 0, paidOrderCount: 0, completedOrderCount: 0, revenue: 0 },
  );

export const buildMonthlyOperationalTrendData = (
  metricRows: readonly MonthlyOperationalMetricRow[],
  referenceDate = new Date(),
): MonthlyOperationalTrendData => {
  const rows = buildMonthlyOperationalTrendRows(metricRows, referenceDate);

  return {
    rows,
    orderCountChartPoints: formatOrderCountChartPoints(rows),
    paidOrderCountChartPoints: formatPaidOrderCountChartPoints(rows),
    completedOrderCountChartPoints: formatCompletedOrderCountChartPoints(rows),
    revenueChartPoints: formatRevenueChartPoints(rows),
    totals: computeMonthlyOperationalTrendTotals(rows),
  };
};

export const buildOperationalTrendData = (
  metricRows: readonly OperationalMetricRow[],
  granularity: OperationalTrendGranularity,
  locale = "id-ID",
): MonthlyOperationalTrendData => {
  const rows = metricRows
    .map((row) => normalizeOperationalTrendRow(row, granularity, locale))
    .filter((row): row is MonthlyOperationalTrendDisplayRow => row !== null);

  return {
    rows,
    orderCountChartPoints: formatOrderCountChartPoints(rows),
    paidOrderCountChartPoints: formatPaidOrderCountChartPoints(rows),
    completedOrderCountChartPoints: formatCompletedOrderCountChartPoints(rows),
    revenueChartPoints: formatRevenueChartPoints(rows),
    totals: computeMonthlyOperationalTrendTotals(rows),
  };
};

const formatChartPoints = (
  rows: readonly MonthlyOperationalTrendDisplayRow[],
  metric: MonthlyOperationalMetricKey,
): MonthlyOperationalTrendChartPoint[] =>
  rows.map((row) => ({
    monthStart: row.monthStart,
    monthLabel: row.monthLabel,
    metric,
    value: row[metric],
  }));

const normalizeMonthStart = (monthStart: string | null): string | null => {
  if (!monthStart) {
    return null;
  }

  const normalizedMonthStart = monthStart.slice(0, 10);

  return isValidMonthStart(monthStart) ? normalizedMonthStart : null;
};

const formatMonthStart = (year: number, monthIndex: number): string => {
  const normalizedDate = new Date(Date.UTC(year, monthIndex, 1));
  const normalizedYear = normalizedDate.getUTCFullYear();
  const normalizedMonth = String(normalizedDate.getUTCMonth() + 1).padStart(2, "0");

  return `${normalizedYear}-${normalizedMonth}-01`;
};

const formatMonthLabel = (monthStart: string): string => monthStart.slice(0, 7);

const normalizeOperationalTrendRow = (
  row: OperationalMetricRow,
  granularity: OperationalTrendGranularity,
  locale: string,
): MonthlyOperationalTrendDisplayRow | null => {
  const bucketStart = normalizeBucketStart(row.bucket_start);

  if (!bucketStart) {
    return null;
  }

  return {
    monthStart: bucketStart,
    monthLabel: formatBucketLabel(bucketStart, row.bucket_end, granularity, locale),
    orderCount: parseSupabaseCount(row.order_count),
    paidOrderCount: parseSupabaseCount(row.paid_order_count),
    completedOrderCount: parseSupabaseCount(row.completed_order_count),
    revenue: parseSupabaseNumber(row.revenue),
  };
};

const normalizeBucketStart = (bucketStart: string | null): string | null => {
  if (!bucketStart) {
    return null;
  }

  const normalizedBucketStart = bucketStart.slice(0, 10);

  return isValidBucketStart(bucketStart) ? normalizedBucketStart : null;
};

const formatBucketLabel = (
  bucketStart: string,
  bucketEnd: string | null,
  granularity: OperationalTrendGranularity,
  locale: string,
): string => {
  const startDate = new Date(`${bucketStart}T00:00:00.000Z`);

  if (granularity === "day") {
    return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", timeZone: JAKARTA_TIME_ZONE }).format(startDate);
  }

  if (granularity === "week") {
    const endDate = bucketEnd && isValidBucketStart(bucketEnd) ? new Date(`${bucketEnd.slice(0, 10)}T00:00:00.000Z`) : addDays(startDate, 6);

    const dateFormatter = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", timeZone: JAKARTA_TIME_ZONE });

    return `${dateFormatter.format(startDate)}–${dateFormatter.format(endDate)}`;
  }

  if (granularity === "year") {
    return new Intl.DateTimeFormat(locale, { timeZone: JAKARTA_TIME_ZONE, year: "numeric" }).format(startDate);
  }

  return new Intl.DateTimeFormat(locale, { month: "short", timeZone: JAKARTA_TIME_ZONE, year: "2-digit" }).format(startDate);
};

const getJakartaDate = (referenceDate: Date): Date => new Date(referenceDate.getTime() + JAKARTA_UTC_OFFSET_IN_MILLISECONDS);

const getWeekStart = (date: Date): Date => {
  const dayOfWeek = date.getUTCDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  return addDays(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())), -daysSinceMonday);
};

const addDays = (date: Date, days: number): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

const formatDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const formatMonthEnd = (year: number, monthIndex: number): string => {
  const normalizedDate = new Date(Date.UTC(year, monthIndex + 1, 0));

  return formatDate(normalizedDate);
};

const assertSafeCount = (value: bigint): void => {
  if (value > MAX_SAFE_COUNT || value < MIN_SAFE_COUNT) {
    throw new RangeError("Count value exceeds JavaScript's safe integer range");
  }
};

const assertSafeNumberCount = (value: number): void => {
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new RangeError("Count value exceeds JavaScript's safe integer range");
  }
};
