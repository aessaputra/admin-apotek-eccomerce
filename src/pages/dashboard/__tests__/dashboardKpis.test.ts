import { describe, expect, it } from "vitest";
import { buildDashboardKpiViewModel, type DashboardOperationalRiskTotals } from "../dashboardKpis";
import type { MonthlyOperationalTrendTotals } from "../monthlyOperationalTrends";

const createTotals = (values: Partial<MonthlyOperationalTrendTotals> = {}): MonthlyOperationalTrendTotals => ({
  orderCount: 0,
  paidOrderCount: 0,
  completedOrderCount: 0,
  revenue: 0,
  ...values,
});

const createOperationalTotals = (values: DashboardOperationalRiskTotals = {}): DashboardOperationalRiskTotals => ({
  lowStockProductCount: 0,
  metricsErrorCount: 0,
  ...values,
});

describe("dashboard KPI view model", () => {
  it("returns zero-safe KPI values and a no-risk alert for zero orders", () => {
    const viewModel = buildDashboardKpiViewModel(createTotals(), createOperationalTotals());

    expect(viewModel).toMatchObject({
      revenue: 0,
      orderCount: 0,
      paidOrderCount: 0,
      completedOrderCount: 0,
      paymentSuccessRate: 0,
      averageOrderValue: 0,
      fulfillmentRisk: 0,
      lowStockErrorCount: 0,
      lowStockRisk: 0,
      metricsErrorCount: 0,
    });
    expect(Number.isNaN(viewModel.paymentSuccessRate)).toBe(false);
    expect(Number.isFinite(viewModel.paymentSuccessRate)).toBe(true);
    expect(Number.isNaN(viewModel.averageOrderValue)).toBe(false);
    expect(Number.isFinite(viewModel.averageOrderValue)).toBe(true);
    expect(viewModel.alerts).toEqual([
      { kind: "metrics-error", severity: "error", active: false, value: 0, sortOrder: 10 },
      { kind: "low-stock-error", severity: "error", active: false, value: 0, sortOrder: 15 },
      { kind: "fulfillment-risk", severity: "warning", active: false, value: 0, sortOrder: 20 },
      { kind: "low-stock-risk", severity: "warning", active: false, value: 0, sortOrder: 30 },
      { kind: "no-risk", severity: "success", active: true, value: 0, sortOrder: 40 },
    ]);
  });

  it("computes one-decimal payment success when paid orders are lower than total orders", () => {
    const viewModel = buildDashboardKpiViewModel(
      createTotals({ orderCount: 3, paidOrderCount: 2, completedOrderCount: 1, revenue: 100_000 }),
    );

    expect(viewModel.paymentSuccessRate).toBe(66.7);
    expect(viewModel.averageOrderValue).toBe(50_000);
    expect(viewModel.fulfillmentRisk).toBe(1);
    expect(viewModel.alerts.find((alert) => alert.kind === "fulfillment-risk")).toMatchObject({ active: true, value: 1 });
    expect(viewModel.alerts.find((alert) => alert.kind === "no-risk")).toMatchObject({ active: false });
  });

  it("computes a 100 percent payment success rate when every order is paid", () => {
    const viewModel = buildDashboardKpiViewModel(
      createTotals({ orderCount: 4, paidOrderCount: 4, completedOrderCount: 4, revenue: 120_000 }),
    );

    expect(viewModel.paymentSuccessRate).toBe(100);
    expect(viewModel.averageOrderValue).toBe(30_000);
    expect(viewModel.fulfillmentRisk).toBe(0);
  });

  it("keeps average order value at zero when revenue is zero", () => {
    const viewModel = buildDashboardKpiViewModel(
      createTotals({ orderCount: 5, paidOrderCount: 2, completedOrderCount: 2, revenue: 0 }),
    );

    expect(viewModel.paymentSuccessRate).toBe(40);
    expect(viewModel.averageOrderValue).toBe(0);
  });

  it("surfaces paid versus completed order difference as fulfillment risk", () => {
    const viewModel = buildDashboardKpiViewModel(
      createTotals({ orderCount: 8, paidOrderCount: 6, completedOrderCount: 2, revenue: 300_000 }),
    );

    expect(viewModel.fulfillmentRisk).toBe(4);
    expect(viewModel.alerts.find((alert) => alert.kind === "fulfillment-risk")).toEqual({
      kind: "fulfillment-risk",
      severity: "warning",
      active: true,
      value: 4,
      sortOrder: 20,
    });
  });

  it("clamps fulfillment risk to zero when completed orders exceed paid orders", () => {
    const viewModel = buildDashboardKpiViewModel(
      createTotals({ orderCount: 6, paidOrderCount: 4, completedOrderCount: 5, revenue: 200_000 }),
    );

    expect(viewModel.fulfillmentRisk).toBe(0);
    expect(viewModel.alerts.find((alert) => alert.kind === "fulfillment-risk")).toMatchObject({ active: false, value: 0 });
  });

  it("returns deterministic alert severities for stock and metrics errors", () => {
    const viewModel = buildDashboardKpiViewModel(
      createTotals({ orderCount: 2, paidOrderCount: 2, completedOrderCount: 2, revenue: 60_000 }),
      createOperationalTotals({ lowStockErrorCount: 1, lowStockProductCount: 3, metricsErrorCount: 1 }),
    );

    expect(viewModel.alerts).toEqual([
      { kind: "metrics-error", severity: "error", active: true, value: 1, sortOrder: 10 },
      { kind: "low-stock-error", severity: "error", active: true, value: 1, sortOrder: 15 },
      { kind: "fulfillment-risk", severity: "warning", active: false, value: 0, sortOrder: 20 },
      { kind: "low-stock-risk", severity: "warning", active: true, value: 3, sortOrder: 30 },
      { kind: "no-risk", severity: "success", active: false, value: 0, sortOrder: 40 },
    ]);
  });
});
