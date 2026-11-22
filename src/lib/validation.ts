export type RosterRow = {
  rowNumber: number;
  studentNumber: string;
  name: string;
  studentCode: string;
};

export type RosterError = { rowNumber: number; reason: string };

export function normalizeStudentNumber(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value)) {
    return String(value).padStart(5, "0");
  }
  return String(value ?? "").trim();
}

export function isStudentNumber(value: string): boolean {
  return /^\d{5}$/.test(value);
}

export function isValidSecretCode(value: string): boolean {
  const byteLength = new TextEncoder().encode(value).length;
  return byteLength >= 1 && byteLength <= 72;
}

export function validateRosterRows(rows: RosterRow[]): RosterError[] {
  const errors: RosterError[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const number = normalizeStudentNumber(row.studentNumber);
    if (!isStudentNumber(number)) errors.push({ rowNumber: row.rowNumber, reason: "학번은 숫자 5자리여야 합니다." });
    if (!row.name.trim() || row.name.trim().length > 50) errors.push({ rowNumber: row.rowNumber, reason: "이름은 1~50자여야 합니다." });
    if (!isValidSecretCode(row.studentCode)) errors.push({ rowNumber: row.rowNumber, reason: "전용코드는 UTF-8 기준 1~72바이트여야 합니다." });
    if (number && seen.has(number)) errors.push({ rowNumber: row.rowNumber, reason: "학번이 중복되었습니다." });
    if (number) seen.add(number);
  }
  return errors;
}

export function isValidSchedule(start: string, end: string): boolean {
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  return Number.isFinite(startTime) && Number.isFinite(endTime) && startTime < endTime;
}

export function scheduleLabel(
  startsAt: string,
  endsAt: string,
  now = Date.now(),
): "신청 예정" | "신청 가능" | "마감" {
  if (now < Date.parse(startsAt)) return "신청 예정";
  if (now > Date.parse(endsAt)) return "마감";
  return "신청 가능";
}

export function formatKoreaTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function safeErrorMessage(code?: string, fallback = "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요."): string {
  const messages: Record<string, string> = {
    NOT_STARTED: "아직 수강신청 시간이 아닙니다",
    COURSE_CODE_MISMATCH: "과목 코드가 일치하지 않습니다.",
    STUDENT_AUTH_FAILED: "학번, 이름, 학생 전용 코드를 확인해주세요.",
    ALREADY_REGISTERED: "이미 신청하였습니다",
    COURSE_CLOSED: "신청 마감 시한이 지났습니다.",
    COURSE_FULL: "해당 과목은 신청이 마감되었습니다.",
    TOTAL_LIMIT: "최대 신청 가능 과목 수에 도달했습니다.",
    CATEGORY_LIMIT: "해당 범주 신청 한도에 도달했습니다.",
    CANCEL_CLOSED: "신청 마감 이후에는 취소할 수 없습니다.",
    ADMIN_REQUIRED: "관리자 권한이 없습니다.",
    INVALID_INPUT: "입력 정보를 확인해주세요.",
    RATE_LIMITED: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
    NOT_FOUND: "요청한 정보를 찾을 수 없습니다.",
  };
  return code ? messages[code] ?? fallback : fallback;
}
