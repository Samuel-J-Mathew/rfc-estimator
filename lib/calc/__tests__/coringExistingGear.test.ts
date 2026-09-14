import { describe, expect, it } from "vitest";
import { HARDWARE_ALLOWANCE, buildQuickProject, defaultQuickInput } from "../autoplan";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";
import { CIVIL_RATES, PERIPHERAL_PRICE_KEYS, resetPeripheralPrices } from "../peripherals";
import type { Project } from "../types";

// A hotel garage job: the site keeps its switchgear, the route is EMT inside
// the building, and the conduit needs core-drilled penetrations. Coring is a
// hand count priced into the wires-and-peripherals line; the retained board
// takes the switchgear line, its pad and its bollards to zero.

function garageProject(extra: Partial<Project["peripherals"]> = {}): Project {
  const base: Project = defaultProject();
  base.peripherals = { ...base.peripherals, ...extra };
  const quick = { ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 180kW Dual", count: 4 }, { loadTypeId: "L2 Dual 40A", count: 6 }], installMethod: "surface" as const };
  return buildQuickProject(quick, base, "t", HARDWARE_ALLOWANCE);
}

const line = (p: Project, name: string) => computeEstimate(p).costs.lines.find((l) => l.name === name)!.base;

describe("concrete coring", () => {
  it("is a hardware line at the shipped rate, priced into wires and peripherals, and zero when uncounted", () => {
    const none = garageProject();
    const cored = garageProject({ coringQty: 12 });
    const row = computeEstimate(cored).peripherals.lines.hardware.find((h) => h.name.startsWith("Concrete coring"))!;
    expect(row.qty).toBe(12);
    expect(row.unitCost).toBe(CIVIL_RATES.coringPerHole);
    expect(line(cored, "Wires, Conduits & Electrical Peripherals") - line(none, "Wires, Conduits & Electrical Peripherals")).toBeCloseTo(12 * CIVIL_RATES.coringPerHole, 6);
    expect(computeEstimate(none).peripherals.lines.hardware.find((h) => h.name.startsWith("Concrete coring"))!.qty).toBe(0);
  });

  it("takes a quoted rate, which the price reset clears back to the shipped one", () => {
    const quoted = garageProject({ coringQty: 8, coringUnitCost: 210 });
    expect(line(quoted, "Wires, Conduits & Electrical Peripherals") - line(garageProject({ coringQty: 8 }), "Wires, Conduits & Electrical Peripherals")).toBeCloseTo(8 * 60, 6);
    expect(PERIPHERAL_PRICE_KEYS).toContain("coringUnitCost");
    const reset = resetPeripheralPrices(quoted.peripherals);
    expect(reset.coringUnitCost).toBeUndefined();
    expect(reset.coringQty).toBe(8); // a count, not a price
  });
});

describe("existing switchgear reused", () => {
  const fresh = garageProject();
  const kept = garageProject({ existingSwitchgear: true });
  const freshR = computeEstimate(fresh);
  const keptR = computeEstimate(kept);

  it("zeroes the Main Distribution Switchgear line and nothing else on the gear", () => {
    expect(line(fresh, "Main Distribution Switchgear")).toBeGreaterThan(0);
    expect(line(kept, "Main Distribution Switchgear")).toBe(0);
    expect(keptR.peripherals.gearOtherTotal).toBe(freshR.peripherals.gearOtherTotal);
    expect(keptR.panel.bus480?.suggestedBusA).toBe(freshR.panel.bus480?.suggestedBusA); // the frame is still sized
    expect(keptR.costs.totalCost).toBeLessThan(freshR.costs.totalCost);
  });

  it("drops the bollards at the gear on a rebuild", () => {
    expect(fresh.peripherals.bollardsQty - kept.peripherals.bollardsQty).toBe(4);
  });

  it("drops the switchgear pad from the concrete order on a trenched job", () => {
    const dig = (extra: Partial<Project["peripherals"]>) => {
      const base: Project = defaultProject();
      base.peripherals = { ...base.peripherals, ...extra };
      return buildQuickProject({ ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 180kW Dual", count: 4 }], installMethod: "trench" as const }, base, "t", HARDWARE_ALLOWANCE);
    };
    const concrete = (p: Project) => computeEstimate(p).peripherals.lines.civil.find((c) => c.name.startsWith("Concrete ("))!.qty;
    // Same bollard count on both so only the pad moves.
    const a = dig({});
    const b = dig({ existingSwitchgear: true });
    b.peripherals.bollardsQty = a.peripherals.bollardsQty;
    expect(concrete(a) - concrete(b)).toBeGreaterThanOrEqual(1);
  });
});
