import { describe, expect, it } from "vitest";
import { addIsoMonths, isFinanceScheduleNearEnd } from "./schedule-end";

describe("addIsoMonths", () => {
  it("adds whole months", () => {
    expect(addIsoMonths("2026-01-05", 3)).toBe("2026-04-05");
  });

  it("clamps to the last day of a shorter target month", () => {
    expect(addIsoMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("rolls over the year", () => {
    expect(addIsoMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
});

describe("isFinanceScheduleNearEnd", () => {
  const today = "2026-09-28";

  it("is false when there is no end date", () => {
    expect(isFinanceScheduleNearEnd(null, today)).toBe(false);
  });

  it("is false when the end date already passed", () => {
    expect(isFinanceScheduleNearEnd("2026-09-01", today)).toBe(false);
  });

  it("is true when the end date is within the next 3 months", () => {
    expect(isFinanceScheduleNearEnd("2026-12-20", today)).toBe(true);
  });

  it("is true right at the 3-month boundary", () => {
    expect(isFinanceScheduleNearEnd("2026-12-28", today)).toBe(true);
  });

  it("is false past the 3-month boundary", () => {
    expect(isFinanceScheduleNearEnd("2027-01-05", today)).toBe(false);
  });
});
