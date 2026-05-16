import { describe, expect, it } from "vitest";
import {
  getExpectedPurchaseMode,
  getOfficialPurchasePath,
  shouldRedirectPurchaseMode,
} from "@/lib/purchaseRoute";

describe("purchase route policy", () => {
  it("routes assigned seating events to seat selection", () => {
    expect(getOfficialPurchasePath("event-1", true)).toBe("/evento/event-1/asientos");
    expect(getExpectedPurchaseMode(true)).toBe("seats");
  });

  it("routes general admission events to ticket purchase", () => {
    expect(getOfficialPurchasePath("event-2", false)).toBe("/evento/event-2/boletas");
    expect(getExpectedPurchaseMode(false)).toBe("official");
  });

  it("detects direct URL mismatches", () => {
    expect(shouldRedirectPurchaseMode("official", true)).toBe(true);
    expect(shouldRedirectPurchaseMode("seats", false)).toBe(true);
    expect(shouldRedirectPurchaseMode("official", false)).toBe(false);
    expect(shouldRedirectPurchaseMode("seats", true)).toBe(false);
  });
});
