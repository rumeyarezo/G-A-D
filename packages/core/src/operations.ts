import type { ISODate } from './dates';
import { faturaCartao, saldoConta, validarTransacao, type ContextoValidacao, type ErroValidacao } from './ledger';
import { alvosDaRecorrencia } from './recurrence';
import type { Aporte, Cartao, Cofrinho, Conta, EscopoRecorrencia, Transacao } from './types';
import type { Cents } from './money';

/**
 * Operações puras: recebem a lista atual e devolvem a nova. Como saldos e faturas são derivados,
 * NENHUMA operação precisa "desfazer" efeitos — é só trocar a lista.
 */

export type Resultado<T> = { ok: true; valor: T } | { ok: false; erros: ErroValidacao[] };

export function adicionarTransacao(
  transacoes: readonly Transacao[],
  nova: Transacao,
  ctx: Omit<ContextoValidacao, 'transacoes'>,
): Resultado<Transacao[]> {
  if (transacoes.some((t) => t.id === nova.id)) {
    return { ok: false, erros: [{ codigo: 'valor_invalido', mensagem: 'Já existe um lançamento com esse identificador.' }] };
  }
  const erros = validarTransacao(nova, { ...ctx, transacoes });
  if (erros.length) return { ok: false, erros };
  return { ok: true, valor: [nova, ...transacoes] };
}

/** "Dar baixa": marca como pago. Idempotente (baixar duas vezes não duplica nada — o saldo é derivado). */
export function darBaixa(transacoes: readonly Transacao[], id: string): Transacao[] {
  return transacoes.map((t) => (t.id === id && t.status !== 'pago' ? { ...t, status: 'pago' } : t));
}

export function excluirTransacao(
  transacoes: readonly Transacao[],
  id: string,
  escopo: EscopoRecorrencia = 'apenas',
): Transacao[] {
  const alvo = transacoes.find((t) => t.id === id);
  if (!alvo) return [...transacoes];
  const ids = new Set(alvosDaRecorrencia(transacoes, alvo, escopo).map((t) => t.id));
  return transacoes.filter((t) => !ids.has(t.id));
}

export type CamposEditaveis = Partial<
  Pick<
    Transacao,
    | 'desc' | 'fornecedor' | 'valor' | 'catId' | 'sub' | 'data' | 'forma' | 'cartaoId' | 'contaId' | 'pessoa' | 'status'
    | 'compartilhada' | 'classificacaoCusto' | 'frequencia' | 'intervaloDias' | 'venceDia' | 'valorVariavel' | 'desconto'
    | 'contaOrigemId' | 'contaDestinoId'
  >
>;

/**
 * Edita um lançamento. Em séries recorrentes, o escopo decide quem muda; a DATA só muda no lançamento
 * que foi editado (nos demais da série a data original é mantida — mesmo comportamento do original).
 */
export function editarTransacao(
  transacoes: readonly Transacao[],
  id: string,
  campos: CamposEditaveis,
  escopo: EscopoRecorrencia,
  ctx: Omit<ContextoValidacao, 'transacoes'>,
): Resultado<Transacao[]> {
  const alvo = transacoes.find((t) => t.id === id);
  if (!alvo) return { ok: false, erros: [{ codigo: 'valor_invalido', mensagem: 'Lançamento não encontrado.' }] };
  const ids = new Set(alvosDaRecorrencia(transacoes, alvo, escopo).map((t) => t.id));
  const { data, ...semData } = campos;

  const novas = transacoes.map((t) => {
    if (!ids.has(t.id)) return t;
    const merged: Transacao = { ...t, ...semData };
    if (t.id === id && data !== undefined) merged.data = data;
    if ('frequencia' in campos) merged.recorrente = !!campos.frequencia;
    return merged;
  });

  const erros = novas.filter((t) => ids.has(t.id)).flatMap((t) => validarTransacao(t, { ...ctx, transacoes: novas }));
  if (erros.length) return { ok: false, erros };
  return { ok: true, valor: novas };
}

/**
 * Paga a fatura do cartão. Diferente do app original, isto:
 *  - NÃO é uma despesa nova (as compras já foram contadas como despesa quando aconteceram);
 *  - sai de uma conta real (o original zerava a fatura sem debitar conta nenhuma).
 */
export function pagarFatura(
  cartao: Cartao,
  transacoes: readonly Transacao[],
  args: { id: string; contaId: string; data: ISODate; pessoa?: string; valor?: Cents },
  ctx: Omit<ContextoValidacao, 'transacoes'>,
): Resultado<Transacao[]> {
  const emAberto = faturaCartao(cartao, transacoes);
  const valor = args.valor ?? emAberto;
  const t: Transacao = {
    id: args.id,
    tipo: 'pagamento_fatura',
    desc: `Pagamento fatura ${cartao.nome}`,
    valor,
    data: args.data,
    status: 'pago',
    pessoa: args.pessoa,
    cartaoId: cartao.id,
    contaId: args.contaId,
    forma: 'Pix',
    compartilhada: false,
  };
  return adicionarTransacao(transacoes, t, ctx);
}

/**
 * Ajuste de saldo: registra a diferença como receita/despesa "Ajuste de saldo" para manter o extrato
 * completo. Devolve as transações sem mudança se o saldo já está correto (tolerância: 0 centavos).
 */
export function ajustarSaldoConta(
  conta: Conta,
  transacoes: readonly Transacao[],
  novoSaldo: Cents,
  args: { id: string; data: ISODate; pessoa?: string },
): Transacao[] {
  const diff = novoSaldo - saldoConta(conta, transacoes);
  if (diff === 0) return [...transacoes];
  const ajuste: Transacao = {
    id: args.id,
    tipo: diff > 0 ? 'receita' : 'despesa',
    desc: 'Ajuste de saldo',
    catId: diff > 0 ? 'outrosr' : 'outrosd',
    sub: 'Diversos',
    valor: Math.abs(diff),
    data: args.data,
    pessoa: args.pessoa,
    compartilhada: false,
    forma: 'Ajuste',
    contaId: conta.id,
    status: 'pago',
  };
  return [ajuste, ...transacoes];
}

export function guardarNoCofrinho(cofrinho: Cofrinho, aporte: Aporte): Cofrinho {
  if (!Number.isInteger(aporte.valor) || aporte.valor <= 0) throw new RangeError('O aporte deve ser maior que zero.');
  return { ...cofrinho, aportes: [...cofrinho.aportes, aporte] };
}

/** Regras de exclusão que o app original também aplicava, agora como função testável. */
export function podeExcluirConta(conta: Conta, cartoes: readonly Cartao[]): boolean {
  return !cartoes.some((c) => c.contaId === conta.id);
}
