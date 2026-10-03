import { describe, expect, it } from "vitest";
import { isValidCronAuth, safeEqual } from "@/lib/security";

describe("security", () => {
  it("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  it("valida o header do cron", () => {
    const secret = "s".repeat(32);
    expect(isValidCronAuth(`Bearer ${secret}`, secret)).toBe(true);
    expect(isValidCronAuth(`Bearer errado`, secret)).toBe(false);
    expect(isValidCronAuth(secret, secret)).toBe(false);
    expect(isValidCronAuth(null, secret)).toBe(false);
    expect(isValidCronAuth("Bearer ", "")).toBe(false);
  });
});
