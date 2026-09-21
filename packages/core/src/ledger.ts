import type { Cents } from './money';
import type { ISODate } from './dates';
import type { Cartao, Cofrinho, Conta, LimiteCartao, Transacao } from './types';

/**
 * REGRA CENTRAL: saldos e faturas são DERIVADOS das transações, nunca "mexidos" à mão.
 *
 * No app original cada tela somava/subtraía o saldo na hora (criar, editar, dar baixa, excluir,
 * transferir...). Bastava um caminho esquecer de desfazer um efeito e o saldo divergia do
 * extrato para sempre. Aqui existe UMA função por saldo; editar ou excluir é só mudar a lista.
 */

/** Efeito (em centavos) de uma transação sobre uma conta. Só transações PAGAS mexem no saldo. */
export function efeitoNaConta(t: Transacao, contaId: string): Cents {
  if (t.status !== 'pago') return 0;
  switch (t.tipo) {
    case 'receita':
      return t.contaId === contaId ? t.valor : 0;
    case 'despesa':
      // compra no crédito não sai da conta agora: entra na fatura (ver faturaCartao)
      return t.contaId === contaId && !t.cartaoId ? -t.valor : 0;
    case 'transferencia':
      return (t.contaDestinoId === contaId ? t.valor : 0) - (t.contaOrigemId === contaId ? t.valor : 0);
    case 'pagamento_fatura':
      return t.contaId === contaId ? -t.valor : 0;
  }
}

/** Soma dos efeitos de `transacoes` na conta, opcionalmente só até uma data (inclusive). */
export function movimentoConta(contaId: string, transacoes: readonly Transacao[], ate?: ISODate): Cents {
  let soma = 0;
  for (const t of transacoes) {
    if (ate && t.data > ate) continue;
    soma += efeitoNaConta(t, contaId);
  }
  return soma;
}

export function saldoConta(conta: Conta, transacoes: readonly Transacao[], ate?: ISODate): Cents {
  return conta.saldoInicial + movimentoConta(conta.id, transacoes, ate);
}

export function saldoTotal(contas: readonly Conta[], transacoes: readonly Transacao[], ate?: ISODate): Cents {
  return contas.reduce((s, c) => s + saldoConta(c, transacoes, ate), 0);
}

/** Fatura em aberto = fatura inicial + compras pagas no cartão − pagamentos de fatura. */
export function faturaCartao(cartao: Cartao, transacoes: readonly Transacao[]): Cents {
  let fatura = cartao.faturaInicial;
  for (const t of transacoes) {
    if (t.cartaoId !== cartao.id || t.status !== 'pago') continue;
    if (t.tipo === 'despesa') fatura += t.valor;
    else if (t.tipo === 'pagamento_fatura') fatura -= t.valor;
  }
  return fatura;
}

export function saldoCofrinho(c: Cofrinho): Cents {
  return c.saldoInicial + c.aportes.reduce((s, a) => s + a.valor, 0);
}

/**
 * Limite do cartão = limite base + tudo que está guardado nos cofrinhos vinculados a ele.
 * (Mesma regra do original: cada real guardado vira limite extra.)
 */
export function limiteCartao(
  cartao: Cartao,
  cofrinhos: readonly Cofrinho[],
  transacoes: readonly Transacao[],
): LimiteCartao {
  const bonus = cofrinhos.filter((c) => c.cartaoId === cartao.id).reduce((s, c) => s + saldoCofrinho(c), 0);
  const total = cartao.limiteBase + bonus;
  const usado = faturaCartao(cartao, transacoes);
  return {
    bonus,
    total,
    usado,
    disponivel: Math.max(0, total - usado),
    pct: total > 0 ? Math.min(100, (usado / total) * 100) : 0,
  };
}

/** Saldo de uma conta depois de descontar aportes de cofrinho que saem dela. */
export function saldoContaComAportes(
  conta: Conta,
  transacoes: readonly Transacao[],
  cofrinhos: readonly Cofrinho[],
  ate?: ISODate,
): Cents {
  const aportes = cofrinhos
    .flatMap((c) => c.aportes)
    .filter((a) => a.contaId === conta.id && (!ate || a.data <= ate))
    .reduce((s, a) => s + a.valor, 0);
  return saldoConta(conta, transacoes, ate) - aportes;
}

/* ------------------------------------------------------------------ */
/* Validação: nenhuma transação inválida entra no ledger               */
/* ------------------------------------------------------------------ */

export type CodigoErro =
  | 'valor_invalido'
  | 'data_invalida'
  | 'transferencia_mesma_conta'
  | 'conta_inexistente'
  | 'cartao_inexistente'
  | 'cartao_nao_e_credito'
  | 'credito_sem_cartao'
  | 'fatura_sem_conta'
  | 'pagamento_maior_que_fatura';

export interface ErroValidacao {
  codigo: CodigoErro;
  mensagem: string;
}

export interface ContextoValidacao {
  contas: readonly Conta[];
  cartoes: readonly Cartao[];
  /** Transações já existentes (para checar o teto do pagamento de fatura). */
  transacoes?: readonly Transacao[];
}

export function validarTransacao(t: Transacao, ctx: ContextoValidacao): ErroValidacao[] {
  const erros: ErroValidacao[] = [];
  const erro = (codigo: CodigoErro, mensagem: string) => erros.push({ codigo, mensagem });
  const conta = (id?: string) => ctx.contas.find((c) => c.id === id);
  const cartao = (id?: string) => ctx.cartoes.find((c) => c.id === id);

  if (!Number.isInteger(t.valor) || t.valor <= 0) erro('valor_invalido', 'O valor deve ser maior que zero (em centavos inteiros).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.data)) erro('data_invalida', 'Data inválida.');

  if (t.tipo === 'transferencia') {
    if (!conta(t.contaOrigemId) || !conta(t.contaDestinoId)) erro('conta_inexistente', 'Conta de origem/destino não encontrada.');
    if (t.contaOrigemId && t.contaOrigemId === t.contaDestinoId) erro('transferencia_mesma_conta', 'Origem e destino devem ser contas diferentes.');
  }

  if (t.contaId && !conta(t.contaId)) erro('conta_inexistente', 'Conta não encontrada.');

  if (t.tipo === 'despesa' && t.forma === 'Crédito' && !t.cartaoId) erro('credito_sem_cartao', 'Compra no crédito precisa de um cartão.');
  if (t.cartaoId) {
    const c = cartao(t.cartaoId);
    if (!c) erro('cartao_inexistente', 'Cartão não encontrado.');
    else if (c.tipo !== 'crédito') erro('cartao_nao_e_credito', 'Só cartões de crédito têm fatura.');
  }

  if (t.tipo === 'pagamento_fatura') {
    if (!t.contaId) erro('fatura_sem_conta', 'Informe de qual conta sai o pagamento da fatura.');
    const c = cartao(t.cartaoId);
    if (c && ctx.transacoes && t.status === 'pago') {
      const outras = ctx.transacoes.filter((x) => x.id !== t.id);
      if (t.valor > faturaCartao(c, outras)) erro('pagamento_maior_que_fatura', 'O pagamento é maior que a fatura em aberto.');
    }
  }
  return erros;
}
