import { describe, expect, it } from "vitest";
import {
  formatKoreaTime,
  isValidSecretCode,
  isStudentNumber,
  isValidSchedule,
  normalizeStudentNumber,
  scheduleLabel,
  validateRosterRows,
} from "./validation";
import { koreaLocalToIso } from "./time";

describe("student roster validation", () => {
  it("preserves leading zeroes for numeric Excel cells", () => {
    expect(normalizeStudentNumber(123)).toBe("00123");
    expect(normalizeStudentNumber("00123")).toBe("00123");
    expect(isStudentNumber("00123")).toBe(true);
    expect(isStudentNumber("123")).toBe(false);
  });

  it("reports actual spreadsheet row numbers and duplicate students", () => {
    const errors = validateRosterRows([
      { rowNumber: 2, studentNumber: "01234", name: "가", studentCode: "code" },
      { rowNumber: 8, studentNumber: "01234", name: "나", studentCode: "code" },
      { rowNumber: 11, studentNumber: "12", name: "", studentCode: "" },
    ]);
    expect(errors).toEqual(expect.arrayContaining([
      { rowNumber: 8, reason: "학번이 중복되었습니다." },
      { rowNumber: 11, reason: "학번은 숫자 5자리여야 합니다." },
    ]));
  });

  it("limits secret codes by UTF-8 bytes to match bcrypt's input limit", () => {
    expect(isValidSecretCode("a".repeat(72))).toBe(true);
    expect(isValidSecretCode("a".repeat(73))).toBe(false);
    expect(isValidSecretCode("가".repeat(24))).toBe(true);
    expect(isValidSecretCode("가".repeat(25))).toBe(false);
    expect(isValidSecretCode("")).toBe(false);
  });
});

describe("schedule validation and Korea time", () => {
  it("requires a start strictly before the end", () => {
    expect(isValidSchedule("2026-01-01T00:00:00+09:00", "2026-01-01T00:00:01+09:00")).toBe(true);
    expect(isValidSchedule("2026-01-01T00:00:00+09:00", "2026-01-01T00:00:00+09:00")).toBe(false);
  });

  it("classifies future, open and ended windows", () => {
    const start = "2026-01-01T00:00:00+09:00";
    const end = "2026-01-02T00:00:00+09:00";
    expect(scheduleLabel(start, end, Date.parse("2025-12-31T23:59:59+09:00"))).toBe("신청 예정");
    expect(scheduleLabel(start, end, Date.parse("2026-01-01T12:00:00+09:00"))).toBe("신청 가능");
    expect(scheduleLabel(start, end, Date.parse("2026-01-02T00:00:01+09:00"))).toBe("마감");
  });

  it("formats timestamps in Asia/Seoul", () => {
    expect(formatKoreaTime("2026-01-01T00:00:00.000Z")).toContain("09:00");
    expect(koreaLocalToIso("2026-01-01T09:00")).toBe("2026-01-01T00:00:00.000Z");
  });
});
