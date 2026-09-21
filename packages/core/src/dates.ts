/**
 * Datas como texto ISO (YYYY-MM-DD) com matemática 100% em UTC.
 * Não depende do fuso do navegador nem de horário de verão.
 */
export type ISODate = string;
export type YearMonth = string; // YYYY-MM

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseISO(iso: ISODate): { y: number; m: number; d: number } {
  const match = ISO_RE.exec(iso);
  if (!match) throw new RangeError(`data inválida: ${iso}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw new RangeError(`data inexistente: ${iso}`);
  return { y, m, d };
}

export function toISO(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(iso: ISODate, n: number): ISODate {
  const { y, m, d } = parseISO(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Diferença em dias inteiros (b - a). */
export function diffDays(a: ISODate, b: ISODate): number {
  const pa = parseISO(a);
  const pb = parseISO(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

export type DiaAlvo = number | 'ultimo' | null | undefined;

/**
 * Soma `n` meses. O dia é `diaAlvo` (número ou 'ultimo'); se ausente, usa o dia de `iso`.
 * Sempre limitado ao último dia do mês de destino (31 -> 28/29/30 quando preciso).
 */
export function addMonthsClamped(iso: ISODate, n: number, diaAlvo?: DiaAlvo): ISODate {
  const { y, m, d } = parseISO(iso);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (((total % 12) + 12) % 12) + 1;
  const last = daysInMonth(ny, nm);
  const wanted = diaAlvo === 'ultimo' ? last : diaAlvo ? Math.trunc(diaAlvo) : d;
  return toISO(ny, nm, Math.min(Math.max(1, wanted), last));
}

export const monthKey = (iso: ISODate): YearMonth => iso.slice(0, 7);

export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String(((total % 12) + 12) % 12 + 1).padStart(2, '0')}`;
}

export function firstDayOf(ym: YearMonth): ISODate {
  return `${ym}-01`;
}

export function lastDayOf(ym: YearMonth): ISODate {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return toISO(y, m, daysInMonth(y, m));
}

/** "Hoje" no fuso de São Paulo, injetável em testes. */
export function hojeSaoPaulo(now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts; // en-CA => YYYY-MM-DD
}
