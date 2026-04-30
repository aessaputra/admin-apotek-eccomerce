type SupabaseNumericValue = string | number | bigint | null | undefined;

const JAKARTA_UTC_OFFSET_IN_MILLISECONDS = 7 * 60 * 60 * 1000;
const MONTHS_IN_TREND_RANGE = 12;
const MAX_SAFE_COUNT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_COUNT = BigInt(Number.MIN_SAFE_INTEGER);

export interface MonthlyOperationalMetricRow {
  month_start: string | null;
  order_count: SupabaseNumericValue;
  paid_order_count: SupabaseNumericValue;
  completed_order_count: SupabaseNumericValue;
  revenue: SupabaseNumericValue;
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
