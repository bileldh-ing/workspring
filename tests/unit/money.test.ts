import { describe, expect, it } from "vitest";
import { feeMinor, formatMoney, minorToDecimal, splitRelease, sumMinor, toMinor } from "@/domain/money";

describe("minor-unit money", () => {
  it("parses decimal strings to integer minor units without floats", () => {
    expect(toMinor("250", "USD")).toBe(25000);
    expect(toMinor("250.5", "USD")).toBe(25050);
    expect(toMinor("1,250.05", "EUR")).toBe(125005);
    expect(toMinor("0.1", "USD") + toMinor("0.2", "USD")).toBe(30); // no 0.30000000000000004
  });
  it("respects the currency exponent (TND has 3 decimals)", () => {
    expect(toMinor("12.345", "TND")).toBe(12345);
    expect(() => toMinor("12.345", "USD")).toThrow(/at most 2 decimal/);
  });
  it("rejects zero, negatives, junk and absurd amounts", () => {
    for (const bad of ["0", "-5", "abc", "1e3", "", "1.2.3"]) expect(() => toMinor(bad, "USD")).toThrow();
    expect(() => toMinor("1000000.01", "USD")).toThrow(/too large/);
  });
  it("formats and round-trips", () => {
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(minorToDecimal(5, "USD")).toBe("0.05");
    expect(minorToDecimal(12345, "TND")).toBe("12.345");
  });
});

describe("fees", () => {
  it("computes basis-point fees with half-up rounding", () => {
    expect(feeMinor(10000, 1000)).toBe(1000); // 10% of $100
    expect(feeMinor(5, 1000)).toBe(1); // 0.5 cent rounds up
    expect(feeMinor(4, 1000)).toBe(0);
    expect(feeMinor(0, 1000)).toBe(0);
  });
  it("never loses precision on large amounts", () => {
    expect(feeMinor(9_007_199_254_740, 1234)).toBe(1_111_488_388_035);
  });
  it("release split always sums to the gross amount", () => {
    for (const gross of [1, 3, 99, 12345, 100_000_001]) {
      const s = splitRelease(gross, 1000);
      expect(s.feeMinor + s.netMinor).toBe(gross);
      expect(s.netMinor).toBeGreaterThanOrEqual(0);
    }
  });
  it("rejects invalid inputs", () => {
    expect(() => feeMinor(1.5, 100)).toThrow();
    expect(() => feeMinor(100, 10001)).toThrow();
  });
  it("sums with BigInt", () => expect(sumMinor([1, 2, 3])).toBe(6));
});
