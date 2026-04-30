import { describe, expect, it } from "vitest";
import {
  buildMonthlyOperationalTrendData,
  buildMonthlyOperationalTrendRows,
  buildOperationalTrendData,
  computeMonthlyOperationalTrendTotals,
  formatCompletedOrderCountChartPoints,
  formatOrderCountChartPoints,
  formatPaidOrderCountChartPoints,
  formatRevenueChartPoints,
  getLatestTwelveJakartaMonthStarts,
  getDefaultOperationalTrendRequest,
  isValidMonthStart,
  parseSupabaseCount,
  parseSupabaseNumber,
  type MonthlyOperationalMetricRow,
  type OperationalMetricRow,
} from "../monthlyOperationalTrends";

const APRIL_2026_REFERENCE_DATE = new Date("2026-04-15T00:00:00.000Z");

const createMetricRow = (monthStart: string, values: Partial<MonthlyOperationalMetricRow> = {}): MonthlyOperationalMetricRow => ({
  month_start: monthStart,
  order_count: 0,
  paid_order_count: 0,
  completed_order_count: 0,
  revenue: 0,
  ...values,
});

const createOperationalMetricRow = (
  bucketStart: string,
  values: Partial<OperationalMetricRow> = {},
): OperationalMetricRow => ({
  bucket_start: bucketStart,
  bucket_end: bucketStart,
  order_count: 0,
  paid_order_count: 0,
  completed_order_count: 0,
  revenue: 0,
  ...values,
});

describe("monthly operational trends", () => {
  it("returns twelve zero-filled chronological months for empty rows", () => {
    const data = buildMonthlyOperationalTrendData([], APRIL_2026_REFERENCE_DATE);

    expect(data.rows).toHaveLength(12);
    expect(data.rows.map((row) => row.monthStart)).toEqual([
      "2025-05-01",
      "2025-06-01",
      "2025-07-01",
      "2025-08-01",
      "2025-09-01",
      "2025-10-01",
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
    ]);
    expect(data.rows.every((row) => row.orderCount === 0 && row.paidOrderCount === 0 && row.completedOrderCount === 0 && row.revenue === 0)).toBe(true);
    expect(data.totals).toEqual({ orderCount: 0, paidOrderCount: 0, completedOrderCount: 0, revenue: 0 });
  });

  it("zero-fills a missing middle month without mutating input rows", () => {
    const sourceRows = [
      createMetricRow("2026-02-01", { order_count: 2, paid_order_count: 1, completed_order_count: 1, revenue: 10000 }),
      createMetricRow("2026-04-01", { order_count: 4, paid_order_count: 3, completed_order_count: 2, revenue: 30000 }),
    ] as const;
    const originalRows = sourceRows.map((row) => ({ ...row }));

    const rows = buildMonthlyOperationalTrendRows(sourceRows, APRIL_2026_REFERENCE_DATE);

    expect(rows.find((row) => row.monthStart === "2026-02-01")).toMatchObject({ orderCount: 2, paidOrderCount: 1, completedOrderCount: 1, revenue: 10000 });
    expect(rows.find((row) => row.monthStart === "2026-03-01")).toMatchObject({ orderCount: 0, paidOrderCount: 0, completedOrderCount: 0, revenue: 0 });
    expect(rows.find((row) => row.monthStart === "2026-04-01")).toMatchObject({ orderCount: 4, paidOrderCount: 3, completedOrderCount: 2, revenue: 30000 });
    expect(sourceRows).toEqual(originalRows);
  });

  it("parses numeric strings and bigint-like values from Supabase serialization", () => {
    const rows = buildMonthlyOperationalTrendRows(
      [
        createMetricRow("2026-04-01", {
          order_count: "12",
          paid_order_count: 10n,
          completed_order_count: "8",
          revenue: "123456.75",
        }),
      ],
      APRIL_2026_REFERENCE_DATE,
    );

    expect(rows.at(-1)).toMatchObject({
      monthStart: "2026-04-01",
      orderCount: 12,
      paidOrderCount: 10,
      completedOrderCount: 8,
      revenue: 123456.75,
    });
    const unsafeCountString = (BigInt(Number.MAX_SAFE_INTEGER) + 2n).toString();
    const roundedUnsafeNumber = Number((BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString());

    expect([null, undefined, "", "not-a-number", 0, "0", 0n].map(parseSupabaseCount).every((value) => !Number.isNaN(value))).toBe(true);
    expect(parseSupabaseNumber(unsafeCountString)).toBe(roundedUnsafeNumber);
    expect(() => parseSupabaseCount(unsafeCountString)).toThrow(RangeError);
    expect(() =>
      buildMonthlyOperationalTrendRows(
        [createMetricRow("2026-04-01", { order_count: unsafeCountString })],
        APRIL_2026_REFERENCE_DATE,
      ),
    ).toThrow(RangeError);
  });

  it("recognizes only normalized YYYY-MM-01 month starts as aggregate months", () => {
    expect(isValidMonthStart("2026-04-01")).toBe(true);
    expect(isValidMonthStart("2026-04-01T00:00:00.000Z")).toBe(true);
    expect(isValidMonthStart("2026-04-02")).toBe(false);
    expect(isValidMonthStart("bad-date")).toBe(false);
    expect(isValidMonthStart(null)).toBe(false);
  });

  it("preserves zero values for counts and revenue", () => {
    const rows = buildMonthlyOperationalTrendRows(
      [createMetricRow("2026-04-01", { order_count: "0", paid_order_count: 0, completed_order_count: 0n, revenue: "0" })],
      APRIL_2026_REFERENCE_DATE,
    );

    expect(rows.at(-1)).toMatchObject({ orderCount: 0, paidOrderCount: 0, completedOrderCount: 0, revenue: 0 });
    expect(computeMonthlyOperationalTrendTotals(rows)).toEqual({ orderCount: 0, paidOrderCount: 0, completedOrderCount: 0, revenue: 0 });
  });

  it("uses already-aggregated operational columns without status filtering", () => {
    const rows = buildMonthlyOperationalTrendRows(
      [createMetricRow("2026-04-01", { order_count: 9, paid_order_count: 6, completed_order_count: 4, revenue: 600000 })],
      APRIL_2026_REFERENCE_DATE,
    );
    const aprilRow = rows.at(-1);

    expect(aprilRow).toMatchObject({ orderCount: 9, paidOrderCount: 6, completedOrderCount: 4, revenue: 600000 });
    expect(formatOrderCountChartPoints(rows).at(-1)).toMatchObject({ metric: "orderCount", value: 9 });
    expect(formatPaidOrderCountChartPoints(rows).at(-1)).toMatchObject({ metric: "paidOrderCount", value: 6 });
    expect(formatCompletedOrderCountChartPoints(rows).at(-1)).toMatchObject({ metric: "completedOrderCount", value: 4 });
    expect(formatRevenueChartPoints(rows).at(-1)).toMatchObject({ metric: "revenue", value: 600000 });
  });

  it("includes the partial current month using Asia/Jakarta month boundaries", () => {
    const jakartaMayReferenceDate = new Date("2026-04-30T18:30:00.000Z");

    expect(getLatestTwelveJakartaMonthStarts(jakartaMayReferenceDate)).toEqual([
      "2025-06-01",
      "2025-07-01",
      "2025-08-01",
      "2025-09-01",
      "2025-10-01",
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
    ]);

    const rows = buildMonthlyOperationalTrendRows(
      [
        createMetricRow("2025-05-01", { order_count: 99, revenue: 990000 }),
        createMetricRow("2026-05-01", { order_count: 1, paid_order_count: 1, completed_order_count: 0, revenue: 25000 }),
      ],
      jakartaMayReferenceDate,
    );

    expect(rows.at(0)).toMatchObject({ monthStart: "2025-06-01", orderCount: 0, revenue: 0 });
    expect(rows.at(-1)).toMatchObject({ monthStart: "2026-05-01", orderCount: 1, paidOrderCount: 1, completedOrderCount: 0, revenue: 25000 });
  });

  it("builds default trend requests for each dashboard granularity", () => {
    expect(getDefaultOperationalTrendRequest("day", APRIL_2026_REFERENCE_DATE)).toEqual({
      granularity: "day",
      startDate: "2026-03-17",
      endDate: "2026-04-15",
      bucketCount: 30,
    });
    expect(getDefaultOperationalTrendRequest("week", APRIL_2026_REFERENCE_DATE)).toEqual({
      granularity: "week",
      startDate: "2026-01-26",
      endDate: "2026-04-19",
      bucketCount: 12,
    });
    expect(getDefaultOperationalTrendRequest("month", APRIL_2026_REFERENCE_DATE)).toEqual({
      granularity: "month",
      startDate: "2025-05-01",
      endDate: "2026-04-30",
      bucketCount: 12,
    });
    expect(getDefaultOperationalTrendRequest("year", APRIL_2026_REFERENCE_DATE)).toEqual({
      granularity: "year",
      startDate: "2022-01-01",
      endDate: "2026-12-31",
      bucketCount: 5,
    });
  });

  it("builds granularity-aware operational trend data from RPC bucket rows", () => {
    const data = buildOperationalTrendData(
      [
        createOperationalMetricRow("2026-04-13", {
          bucket_end: "2026-04-19",
          order_count: "7",
          paid_order_count: "5",
          completed_order_count: "2",
          revenue: "750000",
        }),
      ],
      "week",
    );

    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]).toMatchObject({ orderCount: 7, paidOrderCount: 5, completedOrderCount: 2, revenue: 750000 });
    expect(data.rows[0].monthLabel).toContain("13 Apr");
    expect(data.rows[0].monthLabel).toContain("19 Apr");
    expect(data.totals).toEqual({ orderCount: 7, paidOrderCount: 5, completedOrderCount: 2, revenue: 750000 });
  });

  it("formats bucket labels in Jakarta time instead of browser-local time", () => {
    const data = buildOperationalTrendData(
      [createOperationalMetricRow("2026-04-01", { bucket_end: "2026-04-01", order_count: 1 })],
      "day",
    );

    expect(data.rows[0].monthLabel).toBe("01 Apr");
  });
});
