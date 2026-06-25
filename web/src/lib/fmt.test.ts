import { describe, expect, it } from "vitest";
import { fmtCost, fmtPercent, fmtTokens, trimModelName } from "./fmt";

describe("fmtCost", () => {
  it("renders zero", () => expect(fmtCost(0)).toBe("$0.00"));
  it("uses 5dp for sub-milli amounts", () => expect(fmtCost(0.000123)).toBe("$0.00012"));
  it("uses 2dp for normal amounts", () => expect(fmtCost(1.42)).toBe("$1.42"));
  it("groups thousands", () => expect(fmtCost(1234.5)).toBe("$1,234.50"));
});

describe("fmtTokens", () => {
  it("groups thousands below 1M", () => expect(fmtTokens(12345)).toBe("12,345"));
  it("suffixes M at/above 1M", () => expect(fmtTokens(1_234_567)).toBe("1.23M"));
});

describe("fmtPercent", () => {
  it("two decimals", () => expect(fmtPercent(12.3456)).toBe("12.35%"));
});

describe("trimModelName", () => {
  it("strips trailing separators", () => expect(trimModelName("Claude ·")).toBe("Claude"));
});
