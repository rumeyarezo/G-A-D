import type { Cents } from './money';
import type { ISODate } from './dates';

export type TxTipo = 'despesa' | 'receita' | 'transferencia' | 'pagamento_fatura';
export type TxStatus = 'pago' | 'pendente' | 'atrasado';
export type Forma = 'Pix' | 'Débito' | 'Crédito' | 'Dinheiro' | 'Ajuste';
export type Frequencia =
  | 'semanal'
  | 'quinzenal'
  | 'mensal'
  | 'bimestral'
  | 'trimestral'
  | 'semestral'
  | 'anual'
  | 'personalizado';
export type Custo = 'essencial' | 'ajustavel' | 'fora' | 'confirmar';
export type EscopoRecorrencia = 'apenas' | 'futuros' | 'todos';

export interface Conta {
  id: string;
  banco: string;
  apelido: string;
  /** Saldo antes da primeira transação registrada. O saldo atual é DERIVADO (ver ledger.saldoConta). */
  saldoInicial: Cents;
}

export interface Cartao {
  id: string;
  nome: string;
  tipo: 'crédito' | 'débito';
  banco: string;
  bandeira: string;
  final: string;
  limiteBase: Cents;
  /** Fatura em aberto antes da primeira transação registrada. A fatura atual é DERIVADA. */
  faturaInicial: Cents;
  fechamento?: number;
  vencimento?: number;
  /** Só para cartão de débito. */
  contaId?: string;
}

export interface Aporte {
  valor: Cents;
  data: ISODate;
  pessoa: string;
  /** Se informado, o aporte também sai desta conta (senão é só um registro, como no app original). */
  contaId?: string;
}

export interface Cofrinho {
  id: string;
  nome: string;
  meta: Cents;
  saldoInicial: Cents;
  cartaoId: string | null;
  aportes: Aporte[];
}

export interface Transacao {
  id: string;
  tipo: TxTipo;
  desc: string;
  valor: Cents; // sempre positivo; o sinal vem do tipo
  data: ISODate;
  status: TxStatus;
  pessoa?: string;
  catId?: string;
  sub?: string;
  fornecedor?: string;
  compartilhada?: boolean;
  forma?: Forma | string;
  /** Compra no crédito (despesa) OU cartão que está sendo pago (pagamento_fatura). */
  cartaoId?: string;
  /** Conta afetada (Pix/Débito, receitas, e origem do pagamento de fatura). */
  contaId?: string;
  contaOrigemId?: string;
  contaDestinoId?: string;
  classificacaoCusto?: Custo;
  recorrente?: boolean;
  recorrenciaId?: string | null;
  frequencia?: Frequencia | null;
  venceDia?: number | 'ultimo';
  intervaloDias?: number;
  valorVariavel?: boolean;
  desconto?: boolean;
}

export interface LimiteCartao {
  bonus: Cents;
  total: Cents;
  usado: Cents;
  disponivel: Cents;
  /** 0..100 */
  pct: number;
}

export interface Categoria {
  id: string;
  nome: string;
  tipo: 'despesa' | 'receita';
  subs: string[];
  arquivada?: boolean;
}

export interface Meta {
  id: string;
  nome: string;
  alvo: Cents;
  atual: Cents;
  prazo: ISODate;
  vinculo: string | null;
}

export interface Ativo {
  id: string;
  nome: string;
  valor: Cents;
  /** Rentabilidade no mês como fração (0.012 = 1,2%). */
  rent: number;
  data: ISODate;
}

export interface ClasseInvestimento {
  classe: string;
  ativos: Ativo[];
}
