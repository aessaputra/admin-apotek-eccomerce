import { describe, expect, it } from "vitest";
import {
  expandLegacySelections,
  toggleCourierServiceSelection,
} from "..";

const availableServices = [
  {
    key: "jne:reg",
    companyCode: "jne",
    companyLabel: "JNE",
    serviceCode: "reg",
    serviceLabel: "Regular",
    description: "Regular delivery",
  },
  {
    key: "jne:yes",
    companyCode: "jne",
    companyLabel: "JNE",
    serviceCode: "yes",
    serviceLabel: "YES",
    description: "Express delivery",
  },
  {
    key: "grab:instant",
    companyCode: "grab",
    companyLabel: "GrabExpress",
    serviceCode: "instant",
    serviceLabel: "Instant",
    description: "Instant courier",
  },
];

describe("courier picker helpers", () => {
  it("expands legacy company selections into wildcard and service keys", () => {
    expect(expandLegacySelections(["jne", "grab:instant"], availableServices)).toEqual(
      new Set(["jne:*", "jne:reg", "jne:yes", "grab:instant"])
    );
  });

  it("ignores invalid legacy selections during expansion", () => {
    expect(expandLegacySelections(["   ", ":invalid"], availableServices)).toEqual(new Set());
  });

  it("removes company wildcard selection when a specific service is toggled", () => {
    const current = new Set(["jne:*", "jne:reg"]);

    expect(toggleCourierServiceSelection(current, "jne:yes")).toEqual(new Set(["jne:reg", "jne:yes"]));
  });

  it("toggles a selected service off", () => {
    const current = new Set(["grab:instant"]);

    expect(toggleCourierServiceSelection(current, "grab:instant")).toEqual(new Set());
  });

  it("returns the current selection unchanged for invalid service keys", () => {
    const current = new Set(["jne:reg"]);

    expect(toggleCourierServiceSelection(current, "   ")).toEqual(new Set(["jne:reg"]));
  });
});
