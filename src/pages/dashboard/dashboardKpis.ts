import type { MonthlyOperationalTrendTotals } from "./monthlyOperationalTrends";

export type DashboardKpiAlertKind =
  | "no-risk"
  | "fulfillment-risk"
  | "low-stock-risk"
  | "metrics-error"
  | "low-stock-error";

export type DashboardKpiAlertSeverity = "success" | "warning" | "error";

export interface DashboardOperationalRiskTotals {
  lowStockProductCount?: number;
  lowStockErrorCount?: number;
  metricsErrorCount?: number;
}

export interface DashboardKpiAlert {
  kind: DashboardKpiAlertKind;
  severity: DashboardKpiAlertSeverity;
  active: boolean;
  value: number;
  sortOrder: number;
}

export interface DashboardKpiViewModel {
  revenue: number;
  orderCount: number;
  paidOrderCount: number;
  completedOrderCount: number;
  paymentSuccessRate: number;
  averageOrderValue: number;
  fulfillmentRisk: number;
  lowStockErrorCount: number;
  lowStockRisk: number;
  metricsErrorCount: number;
  alerts: DashboardKpiAlert[];
}

export const buildDashboardKpiViewModel = (
  totals: MonthlyOperationalTrendTotals,
  operationalTotals: DashboardOperationalRiskTotals = {},
): DashboardKpiViewModel => {
  const revenue = normalizeMetricValue(totals.revenue);
  const orderCount = normalizeMetricValue(totals.orderCount);
  const paidOrderCount = normalizeMetricValue(totals.paidOrderCount);
  const completedOrderCount = normalizeMetricValue(totals.completedOrderCount);
  const fulfillmentRisk = Math.max(paidOrderCount - completedOrderCount, 0);
  const lowStockErrorCount = normalizeMetricValue(operationalTotals.lowStockErrorCount);
  const lowStockRisk = normalizeMetricValue(operationalTotals.lowStockProductCount);
  const metricsErrorCount = normalizeMetricValue(operationalTotals.metricsErrorCount);

  return {
    revenue,
    orderCount,
    paidOrderCount,
    completedOrderCount,
    paymentSuccessRate: roundToOneDecimal(safePercentage(paidOrderCount, orderCount)),
    averageOrderValue: safeDivide(revenue, paidOrderCount),
    fulfillmentRisk,
    lowStockErrorCount,
    lowStockRisk,
    metricsErrorCount,
    alerts: buildDashboardKpiAlerts({ fulfillmentRisk, lowStockErrorCount, lowStockRisk, metricsErrorCount }),
  };
};

const buildDashboardKpiAlerts = ({
  fulfillmentRisk,
  lowStockErrorCount,
  lowStockRisk,
  metricsErrorCount,
}: Pick<DashboardKpiViewModel, "fulfillmentRisk" | "lowStockErrorCount" | "lowStockRisk" | "metricsErrorCount">): DashboardKpiAlert[] => {
  const hasAnyRisk = fulfillmentRisk > 0 || lowStockErrorCount > 0 || lowStockRisk > 0 || metricsErrorCount > 0;

  return [
    {
      kind: "metrics-error",
      severity: "error",
      active: metricsErrorCount > 0,
      value: metricsErrorCount,
      sortOrder: 10,
    },
    {
      kind: "low-stock-error",
      severity: "error",
      active: lowStockErrorCount > 0,
      value: lowStockErrorCount,
      sortOrder: 15,
    },
    {
      kind: "fulfillment-risk",
      severity: "warning",
      active: fulfillmentRisk > 0,
      value: fulfillmentRisk,
      sortOrder: 20,
    },
    {
      kind: "low-stock-risk",
      severity: "warning",
      active: lowStockRisk > 0,
      value: lowStockRisk,
      sortOrder: 30,
    },
    {
      kind: "no-risk",
      severity: "success",
      active: !hasAnyRisk,
      value: 0,
      sortOrder: 40,
    },
  ];
};

const safePercentage = (numerator: number, denominator: number): number => safeDivide(numerator, denominator) * 100;

const safeDivide = (numerator: number, denominator: number): number => {
  if (denominator === 0) {
    return 0;
  }

  const result = numerator / denominator;

  return Number.isFinite(result) ? result : 0;
};

const roundToOneDecimal = (value: number): number => Math.round(value * 10) / 10;

const normalizeMetricValue = (value: number | null | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return value;
};
