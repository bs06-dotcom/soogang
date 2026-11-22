export function koreaLocalToIso(value: string): string {
  const date = new Date(`${value}:00+09:00`);
  if (!Number.isFinite(date.getTime())) throw new Error("올바른 날짜와 시간을 입력해주세요.");
  return date.toISOString();
}

export function isoToKoreaLocal(value: string): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return parts.replace(" ", "T");
}
