import { addDays, addMonthsClamped, diffDays, parseISO, type DiaAlvo, type ISODate } from './dates';
import type { Frequencia, Transacao } from './types';

const MESES_POR_PASSO: Partial<Record<Frequencia, number>> = {
  mensal: 1,
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};
const DIAS_POR_PASSO: Partial<Record<Frequencia, number>> = { semanal: 7, quinzenal: 14 };

export interface OpcoesRecorrencia {
  venceDia?: number | 'ultimo' | string | null;
  intervaloDias?: number | null;
}

function normalizaDia(v: OpcoesRecorrencia['venceDia']): DiaAlvo {
  if (v === 'ultimo') return 'ultimo';
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Primeira data ESTRITAMENTE depois de `hoje` na série que começa em `ultimaData`.
 *
 * Diferenças intencionais em relação ao app original (que tinha 3 defeitos):
 *  1. Mensal sem "vence no dia": o original derivava o dia da data ANTERIOR já ajustada,
 *     então 31/jan virava 28/fev e ficava no 28 para sempre. Aqui o dia âncora é o da data original.
 *  2. O original desistia após 80 passos e podia devolver uma data no passado
 *     (ex.: semanal parado há mais de ~1,5 ano). Aqui o cálculo é direto, sem limite.
 *  3. Semanas/dias usam matemática de calendário (UTC), não milissegundos.
 */
export function proximoVencimento(
  ultimaData: ISODate,
  frequencia: Frequencia | string | null | undefined,
  hoje: ISODate,
  opts: OpcoesRecorrencia = {},
): ISODate {
  const freq = (frequencia ?? 'mensal') as Frequencia;

  const diasPasso =
    freq === 'personalizado'
      ? Math.max(1, Math.trunc(opts.intervaloDias || 15))
      : DIAS_POR_PASSO[freq];

  if (diasPasso) {
    const passos = Math.max(1, Math.floor(diffDays(ultimaData, hoje) / diasPasso) + 1);
    return addDays(ultimaData, passos * diasPasso);
  }

  const mesesPasso = MESES_POR_PASSO[freq] ?? 1; // frequência desconhecida = mensal (igual ao original)
  const dia = normalizaDia(opts.venceDia);
  const u = parseISO(ultimaData);
  const h = parseISO(hoje);
  const mesesEntre = h.y * 12 + h.m - (u.y * 12 + u.m);
  let k = Math.max(1, Math.floor(mesesEntre / mesesPasso) - 1);
  // a data cresce com k; avança até passar de hoje
  while (addMonthsClamped(ultimaData, k * mesesPasso, dia) <= hoje) k++;
  return addMonthsClamped(ultimaData, k * mesesPasso, dia);
}

/** Última ocorrência de cada série recorrente (igual a `seriesRecorrentes` do original). */
export function seriesRecorrentes(transacoes: readonly Transacao[]): Transacao[] {
  const mapa = new Map<string, Transacao>();
  for (const t of transacoes) {
    if (!t.recorrenciaId) continue;
    const atual = mapa.get(t.recorrenciaId);
    if (!atual || t.data > atual.data) mapa.set(t.recorrenciaId, t);
  }
  return [...mapa.values()];
}

/** Quais lançamentos de uma série são afetados por editar/excluir "só este / este e futuros / todos". */
export function alvosDaRecorrencia(
  transacoes: readonly Transacao[],
  alvo: Transacao,
  escopo: 'apenas' | 'futuros' | 'todos',
): Transacao[] {
  if (!alvo.recorrenciaId || escopo === 'apenas') return [alvo];
  return transacoes.filter(
    (t) => t.recorrenciaId === alvo.recorrenciaId && (escopo === 'todos' || t.data >= alvo.data),
  );
}
