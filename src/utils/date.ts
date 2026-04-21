export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseLocalDateKey(dateStr: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, monthIndex, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== monthIndex ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

export function clampDateKeyToToday(dateStr: string, todayKey = localDateKey()): string {
  const parsed = parseLocalDateKey(dateStr);
  if (!parsed) return todayKey;
  const key = localDateKey(parsed);
  return key > todayKey ? todayKey : key;
}

export function unixSecondsFromDateKey(dateStr: string): number {
  const parsed = parseLocalDateKey(dateStr);
  if (!parsed) return Math.floor(Date.now() / 1000);
  return Math.floor(parsed.getTime() / 1000);
}
