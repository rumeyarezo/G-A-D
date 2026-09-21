import { addDays, diffDays, monthKey, parseISO, shiftMonth, toISO, daysInMonth, type ISODate, type YearMonth } from './dates';
import { faturaCartao } from './ledger';
import type { Cents } from './money';
import type { Cartao, Transacao } from './types';

/** Receitas/despesas do mês (regime de competência: pagas, pendentes e atrasadas, como no original). */
export function totaisDoMes(transacoes: readonly Transacao[], ym: YearMonth): { receitas: Cents; despesas: Cents } {
  let receitas = 0;
  let despesas = 0;
  for (const t of transacoes) {
    if (monthKey(t.data) !== ym) continue;
    if (t.tipo === 'receita') receitas += t.valor;
    // transferência e pagamento de fatura NÃO são despesa: o dinheiro só muda de lugar / quita dívida
    else if (t.tipo === 'despesa') despesas += t.valor;
  }
  return { receitas, despesas };
}

export function gastosPorCategoria(
  transacoes: readonly Transacao[],
  ym: YearMonth,
): { catId: string; valor: Cents }[] {
  const mapa = new Map<string, Cents>();
  for (const t of transacoes) {
    if (t.tipo !== 'despesa' || !t.catId || monthKey(t.data) !== ym) continue;
    mapa.set(t.catId, (mapa.get(t.catId) ?? 0) + t.valor);
  }
  return [...mapa.entries()].map(([catId, valor]) => ({ catId, valor })).sort((a, b) => b.valor - a.valor);
}

export interface Anomalia {
  catId: string;
  atual: Cents;
  media: Cents;
  /** Ex.: 0.42 = 42% acima da média. */
  pct: number;
}

/**
 * Categoria cujo gasto no mês de `hoje` passa de 130% da média dos 2 meses anteriores
 * (só entram na média os meses em que houve gasto). Regra idêntica à do app original,
 * mas o mês de referência vem de `hoje` em vez de estar fixo em setembro/2026.
 */
export function detectarAnomalias(transacoes: readonly Transacao[], hoje: ISODate): Anomalia[] {
  const atualYm = monthKey(hoje);
  const anteriores = [shiftMonth(atualYm, -1), shiftMonth(atualYm, -2)];
  const despesas = transacoes.filter((t) => t.tipo === 'despesa' && t.catId);
  const cats = [...new Set(despesas.map((t) => t.catId as string))];
  const out: Anomalia[] = [];
  const soma = (catId: string, ym: YearMonth) =>
    despesas.filter((t) => t.catId === catId && monthKey(t.data) === ym).reduce((s, t) => s + t.valor, 0);

  for (const catId of cats) {
    const atual = soma(catId, atualYm);
    const hist = anteriores.map((m) => soma(catId, m)).filter((v) => v > 0);
    if (atual <= 0 || hist.length === 0) continue;
    const somaHist = hist.reduce((a, b) => a + b, 0);
    // atual > (somaHist / n) * 1.3   <=>   atual * n * 10 > somaHist * 13   (só inteiros, sem arredondar)
    if (atual * hist.length * 10 > somaHist * 13) {
      const media = somaHist / hist.length;
      out.push({ catId, atual, media: Math.round(media), pct: atual / media - 1 });
    }
  }
  return out.sort((a, b) => b.pct - a.pct);
}

/** Saldo previsto: saldo atual + receitas fixas − despesas fixas do mês corrente. */
export function previsaoSaldo(
  saldoAtual: Cents,
  transacoes: readonly Transacao[],
  hoje: ISODate,
): { valor: Cents; recRec: Cents; recDesp: Cents } {
  const ym = monthKey(hoje);
  let recRec = 0;
  let recDesp = 0;
  for (const t of transacoes) {
    if (!t.recorrente || monthKey(t.data) !== ym) continue;
    if (t.tipo === 'receita') recRec += t.valor;
    else if (t.tipo === 'despesa') recDesp += t.valor;
  }
  return { valor: saldoAtual + recRec - recDesp, recRec, recDesp };
}

export interface Vencimento {
  label: string;
  valor: Cents;
  data: ISODate;
  status: 'pendente' | 'atrasado';
  tipoItem: 'lancamento' | 'fatura';
  id?: string;
  cartaoId?: string;
}

/** Próxima data com o dia `dia` (1-31, limitado ao fim do mês) que seja hoje ou depois. */
export function proximaDataDoDia(dia: number, hoje: ISODate): ISODate {
  const h = parseISO(hoje);
  const noMes = (y: number, m: number) => toISO(y, m, Math.min(Math.max(1, dia), daysInMonth(y, m)));
  const esteMes = noMes(h.y, h.m);
  if (esteMes >= hoje) return esteMes;
  const ym = shiftMonth(monthKey(hoje), 1);
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return noMes(y, m);
}

/**
 * Pendências e faturas a vencer, da mais próxima para a mais distante.
 * (O original fixava o mês da fatura em setembro/2026; aqui é a próxima data real de vencimento.)
 */
export function proximosVencimentos(
  transacoes: readonly Transacao[],
  cartoes: readonly Cartao[],
  hoje: ISODate,
): Vencimento[] {
  const pend: Vencimento[] = transacoes
    .filter((t) => (t.status === 'pendente' || t.status === 'atrasado') && (t.tipo === 'despesa' || t.tipo === 'receita'))
    .map((t) => ({
      label: t.desc,
      valor: t.valor,
      data: t.data,
      status: t.status as 'pendente' | 'atrasado',
      tipoItem: 'lancamento' as const,
      id: t.id,
    }));
  const faturas: Vencimento[] = cartoes
    .filter((c) => c.tipo === 'crédito' && c.vencimento)
    .map((c) => ({ c, fatura: faturaCartao(c, transacoes) }))
    .filter(({ fatura }) => fatura > 0)
    .map(({ c, fatura }) => ({
      label: `Fatura ${c.nome}`,
      valor: fatura,
      data: proximaDataDoDia(c.vencimento as number, hoje),
      status: 'pendente' as const,
      tipoItem: 'fatura' as const,
      cartaoId: c.id,
    }));
  return [...pend, ...faturas].sort((a, b) => a.data.localeCompare(b.data));
}

export interface DiaProjetado {
  entradas: Cents;
  saidas: Cents;
  saldo: Cents;
}

/**
 * Saldo dia a dia de um mês (igual ao "saldo projetado" da Agenda do original).
 * `saldoInicial` deve ser o saldo total no fim do mês anterior.
 */
export function projecaoDiaria(
  transacoes: readonly Transacao[],
  ym: YearMonth,
  saldoInicial: Cents,
): Record<ISODate, DiaProjetado> {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const dias = daysInMonth(y, m);
  const out: Record<ISODate, DiaProjetado> = {};
  let saldo = saldoInicial;
  for (let d = 1; d <= dias; d++) {
    const iso = toISO(y, m, d);
    let entradas = 0;
    let saidas = 0;
    for (const t of transacoes) {
      if (t.data !== iso) continue;
      if (t.tipo === 'receita') entradas += t.valor;
      else if (t.tipo === 'despesa') saidas += t.valor;
    }
    saldo += entradas - saidas;
    out[iso] = { entradas, saidas, saldo };
  }
  return out;
}

export function estaDentroDoPeriodo(dataIso: ISODate, dias: number, hoje: ISODate): boolean {
  return dataIso >= addDays(hoje, -dias) && dataIso <= hoje;
}

export { diffDays };

export interface PagamentoFatura {
  id: string;
  data: ISODate;
  valor: Cents;
  cartaoId: string;
  contaId: string;
  desc: string;
  /** 'quitada' = a fatura ficou zerada (ou negativa) depois deste pagamento; 'parcial' = ainda sobrou saldo devedor. */
  situacao: 'quitada' | 'parcial';
  restante: Cents;
}

/**
 * Histórico de pagamentos de fatura, do mais recente para o mais antigo, para saber QUANDO cada cartão foi pago
 * e se o pagamento quitou ou foi parcial/negociado. Aparece no extrato como saída da conta, mas fica FORA de
 * `totaisDoMes().despesas` (as compras já foram contadas como despesa) — por isso tem total próprio.
 */
export function pagamentosDeFatura(
  transacoes: readonly Transacao[],
  cartoes: readonly Cartao[],
  ym?: YearMonth,
): PagamentoFatura[] {
  const out: PagamentoFatura[] = [];
  for (const t of transacoes) {
    if (t.tipo !== 'pagamento_fatura' || t.status !== 'pago' || !t.cartaoId || !t.contaId) continue;
    if (ym && monthKey(t.data) !== ym) continue;
    const cartao = cartoes.find((c) => c.id === t.cartaoId);
    if (!cartao) continue;
    const restante = faturaCartao(cartao, transacoes.filter((x) => x.data <= t.data));
    out.push({
      id: t.id, data: t.data, valor: t.valor, cartaoId: t.cartaoId, contaId: t.contaId, desc: t.desc,
      situacao: restante <= 0 ? 'quitada' : 'parcial', restante: Math.max(restante, 0),
    });
  }
  return out.sort((a, b) => b.data.localeCompare(a.data) || a.id.localeCompare(b.id));
}

/** Total de faturas pagas no mês (separado das despesas, para não contar o mesmo gasto duas vezes). */
export function faturasPagasNoMes(transacoes: readonly Transacao[], ym: YearMonth): Cents {
  return transacoes
    .filter((t) => t.tipo === 'pagamento_fatura' && t.status === 'pago' && monthKey(t.data) === ym)
    .reduce((s, t) => s + t.valor, 0);
}
