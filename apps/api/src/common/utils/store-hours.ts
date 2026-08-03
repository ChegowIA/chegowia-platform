function normalizeWeekday(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace("-feira", "");
}

/** Retorna se a loja está aberta no fuso comercial configurado. */
export function isStoreOpen(
  openingHours: unknown,
  now = new Date(),
  timeZone = process.env.BUSINESS_TIMEZONE ?? "America/Sao_Paulo",
) {
  if (!openingHours || typeof openingHours !== "object" || Array.isArray(openingHours)) return true;
  const dateParts = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = normalizeWeekday(dateParts.find((part) => part.type === "weekday")?.value ?? "");
  const schedule = String((openingHours as Record<string, unknown>)[weekday] ?? "").trim();
  if (!schedule) return true;
  if (/^fechado$/i.test(schedule)) return false;
  const match = schedule.match(/^([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return false;
  const current = Number(dateParts.find((part) => part.type === "hour")?.value ?? 0) * 60
    + Number(dateParts.find((part) => part.type === "minute")?.value ?? 0);
  const starts = Number(match[1]) * 60 + Number(match[2]);
  const ends = Number(match[3]) * 60 + Number(match[4]);
  return ends > starts
    ? current >= starts && current < ends
    : current >= starts || current < ends;
}
