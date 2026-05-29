import { describe, expect, it } from "vitest";
import idCommon from "../id/common.json";
import enCommon from "../en/common.json";

function getValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

const REQUIRED_AUTH_KEYS = [
  "auth.accessDenied",
  "auth.oauthNotAllowed",
  "auth.registerDisabled",
  "auth.checkFailed",
  "auth.sessionNotFound",
  "auth.unexpectedError",
  "auth.loginFailed",
  "auth.invalidEmailOrPassword",
  "auth.forgotPasswordFailed",
  "auth.invalidEmail",
  "auth.updatePasswordFailed",
  "auth.invalidPassword",
  "auth.email",
  "auth.password",
  "auth.login.title",
  "auth.login.description",
  "auth.login.submit",
  "auth.login.forgotPassword",
];

const REQUIRED_PAGES_KEYS = [
  "pages.login.signin",
  "pages.register.buttons.haveAccount",
  "pages.forgotPassword.title",
  "pages.forgotPassword.fields.email",
  "pages.forgotPassword.errors.requiredEmail",
  "pages.forgotPassword.errors.validEmail",
  "pages.forgotPassword.buttons.haveAccount",
  "pages.forgotPassword.buttons.submit",
  "pages.forgotPassword.signin",
  "pages.updatePassword.title",
  "pages.updatePassword.fields.password",
  "pages.updatePassword.fields.confirmPassword",
  "pages.updatePassword.errors.requiredPassword",
  "pages.updatePassword.errors.requiredConfirmPassword",
  "pages.updatePassword.errors.confirmPasswordNotMatch",
  "pages.updatePassword.buttons.submit",
];

const REQUIRED_DASHBOARD_KEYS = [
  "dashboard.dashboard",
  "dashboard.overview.title",
  "dashboard.overview.subtitle",
  "dashboard.kpis.revenue30d",
  "dashboard.kpis.orders30d",
  "dashboard.kpis.paymentSuccessRate",
  "dashboard.kpis.averageOrderValue",
  "dashboard.kpis.fulfillmentRisk",
  "dashboard.kpis.lowStockSkus",
  "dashboard.kpis.unavailable",
  "dashboard.kpis.periodNote",
  "dashboard.kpis.revenue30dContext",
  "dashboard.kpis.orders30dContext",
  "dashboard.kpis.paymentSuccessRateContext",
  "dashboard.kpis.averageOrderValueContext",
  "dashboard.kpis.fulfillmentRiskContext",
  "dashboard.alerts.title",
  "dashboard.alerts.metricsError.message",
  "dashboard.alerts.metricsError.description",
  "dashboard.alerts.lowStockError.message",
  "dashboard.alerts.lowStockError.description",
  "dashboard.alerts.recentOrdersError.message",
  "dashboard.alerts.recentOrdersError.description",
  "dashboard.alerts.fulfillmentRisk.message",
  "dashboard.alerts.fulfillmentRisk.description",
  "dashboard.alerts.lowStockRisk.message",
  "dashboard.alerts.lowStockRisk.description",
  "dashboard.alerts.noRisk.message",
  "dashboard.alerts.noRisk.description",
  "dashboard.alerts.loading.message",
  "dashboard.alerts.loading.description",
  "dashboard.recentOrders",
  "dashboard.lowStockAlerts",
  "dashboard.noRecentOrders",
  "dashboard.noLowStock",
  "dashboard.viewAll",
  "dashboard.viewAllOrders",
  "dashboard.viewAllProducts",
  "dashboard.orderId",
  "dashboard.fullOrderId",
  "dashboard.orderDate",
  "dashboard.orderTotal",
  "dashboard.orderStatus",
  "dashboard.productName",
  "dashboard.currentStock",
  "dashboard.tables.recentOrdersAriaLabel",
  "dashboard.tables.lowStockAriaLabel",
  "dashboard.monthlyTrends.title",
  "dashboard.monthlyTrends.revenue",
  "dashboard.monthlyTrends.orderCount",
  "dashboard.monthlyTrends.paidOrders",
  "dashboard.monthlyTrends.completedOrders",
  "dashboard.monthlyTrends.dataTableLabel",
  "dashboard.monthlyTrends.periodColumn",
  "dashboard.monthlyTrends.incomingColumn",
  "dashboard.monthlyTrends.paidColumn",
  "dashboard.monthlyTrends.completedColumn",
  "dashboard.monthlyTrends.revenueColumn",
  "dashboard.monthlyTrends.latest12Months",
  "dashboard.monthlyTrends.period.day",
  "dashboard.monthlyTrends.period.week",
  "dashboard.monthlyTrends.period.month",
  "dashboard.monthlyTrends.period.year",
  "dashboard.monthlyTrends.granularity.day",
  "dashboard.monthlyTrends.granularity.week",
  "dashboard.monthlyTrends.granularity.month",
  "dashboard.monthlyTrends.granularity.year",
  "dashboard.monthlyTrends.granularityAriaLabel",
  "dashboard.monthlyTrends.loading",
  "dashboard.monthlyTrends.emptyDescription",
  "dashboard.monthlyTrends.errorMessage",
  "dashboard.monthlyTrends.zeroValueSummary",
  "dashboard.monthlyTrends.chartAriaLabel",
  "dashboard.monthlyTrends.chartDescription",
  "dashboard.monthlyTrends.revenueTrendTitle",
  "dashboard.monthlyTrends.revenueTrendAriaLabel",
  "dashboard.monthlyTrends.revenueTrendDescription",
  "dashboard.retry",
];

const REQUIRED_ORDER_KEYS = [
  "orders.quickFilters.all",
  "orders.actionGuide.syncOnlyDescription",
];

const REQUIRED_SETTINGS_KEYS = [
  "settings.tabs.storeProfile",
  "settings.tabs.shippingSettings",
  "settings.tabs.paymentSettings",
  "settings.tabs.integrationConfig",
  "settings.integration.summary.loading",
  "settings.integration.summary.empty",
  "settings.integration.summary.error",
  "settings.integration.audit.actions.runtimeRead",
  "settings.integration.audit.actions.secretRotated",
  "settings.integration.audit.actions.valueUpdated",
  "settings.integration.audit.fallback.technical",
  "settings.integration.audit.fields.action",
  "settings.integration.audit.fields.actorId",
  "settings.integration.audit.fields.actorRole",
  "settings.integration.audit.fields.key",
  "settings.integration.audit.fields.newValue",
  "settings.integration.audit.fields.oldValue",
  "settings.integration.audit.fields.reason",
  "settings.integration.audit.fields.request",
  "settings.integration.audit.fields.source",
  "settings.integration.audit.fields.timestamp",
  "settings.integration.audit.fields.version",
  "settings.integration.audit.fields.versionId",
  "settings.integration.technical.description",
  "settings.payment.description",
  "settings.payment.summary.loading",
  "settings.payment.summary.error",
  "settings.payment.serverKey.label",
  "settings.payment.serverKey.description",
  "settings.payment.serverKey.placeholder",
  "settings.payment.serverKey.saveSuccess",
  "settings.payment.serverKey.saveError",
  "settings.payment.mode.label",
  "settings.payment.mode.description",
  "settings.payment.mode.sandbox",
  "settings.payment.mode.production",
  "settings.payment.mode.saveSuccess",
  "settings.payment.mode.saveError",
  "settings.shipping.description",
];

const REQUIRED_KEYS = [...REQUIRED_AUTH_KEYS, ...REQUIRED_PAGES_KEYS, ...REQUIRED_DASHBOARD_KEYS, ...REQUIRED_ORDER_KEYS, ...REQUIRED_SETTINGS_KEYS];

describe("locale files", () => {
  it.each(REQUIRED_KEYS)("has key %s in both id and en locales", (key) => {
    const idValue = getValue(idCommon, key);
    const enValue = getValue(enCommon, key);

    expect(idValue, `missing in id/common.json: ${key}`).toBeTypeOf("string");
    expect(enValue, `missing in en/common.json: ${key}`).toBeTypeOf("string");
    expect(String(idValue).trim().length, `empty in id/common.json: ${key}`).toBeGreaterThan(0);
    expect(String(enValue).trim().length, `empty in en/common.json: ${key}`).toBeGreaterThan(0);
  });

  it("uses the approved dashboard page and overview labels", () => {
    expect(getValue(idCommon, "resources.dashboard")).toBe("Dasbor");
    expect(getValue(idCommon, "dashboard.dashboard")).toBe("Dasbor");
    expect(getValue(idCommon, "dashboard.overview.title")).toBe("Performa Toko");
    expect(getValue(enCommon, "resources.dashboard")).toBe("Dashboard");
    expect(getValue(enCommon, "dashboard.dashboard")).toBe("Dashboard");
    expect(getValue(enCommon, "dashboard.overview.title")).toBe("Store Performance");
  });
});
