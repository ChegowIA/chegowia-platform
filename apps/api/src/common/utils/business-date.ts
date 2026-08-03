import { BadRequestException } from "@nestjs/common";

/**
 * Datas de negócio no fuso da operação.
 *
 * Extraído de orders.service.ts porque relatórios e pedidos precisam do mesmo
 * conceito de "dia": um pedido feito às 23h precisa cair no dia em que a loja
 * o recebeu, não no dia UTC. Os intervalos são SEMIABERTOS — `end` é o início
 * do dia seguinte, então filtre com `lt`, nunca `lte`.
 */
export function businessDayRange(dateKey: string, timeZone: string) {
  const parts = parseDateKey(dateKey);
  const nextDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return {
    start: zonedDateTimeToUtc(parts.year, parts.month, parts.day, timeZone),
    end: zonedDateTimeToUtc(
      nextDate.getUTCFullYear(),
      nextDate.getUTCMonth() + 1,
      nextDate.getUTCDate(),
      timeZone,
    ),
  };
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new BadRequestException("Informe uma data válida no formato AAAA-MM-DD.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
  ) {
    throw new BadRequestException("Informe uma data válida.");
  }
  return { year, month, day };
}

function zonedDateTimeToUtc(year: number, month: number, day: number, timeZone: string) {
  const localTimestamp = Date.UTC(year, month - 1, day);
  let utcTimestamp = localTimestamp;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    utcTimestamp = localTimestamp - timeZoneOffsetMs(new Date(utcTimestamp), timeZone);
  }
  return new Date(utcTimestamp);
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function formatDateKey(value: string) {
  const { year, month, day } = parseDateKey(value);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

/**
 * Hora do dia (0-23) no fuso da operação. `Date.getHours()` usa o fuso do
 * processo — que em container sem TZ definido é UTC —, deslocando gráficos de
 * pico em 3 horas.
 */
export function hourInTimeZone(date: Date, timeZone: string) {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).format(date);
  return Number(value) % 24;
}

export { dateKeyInTimeZone, formatDateKey };
