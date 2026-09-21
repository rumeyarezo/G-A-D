import { toCents } from './money';
import { faturaCartao, movimentoConta } from './ledger';
import type { Ativo, Cartao, Categoria, ClasseInvestimento, Cofrinho, Conta, Meta, Transacao } from './types';

/** Formato do JSON `grana_households.estado` gravado pelo app original (valores em reais, número decimal). */
export interface EstadoLegado {
  categorias?: Categoria[];
  contas?: { id: string; banco: string; apelido: string; saldo: number }[];
  cartoes?: {
    id: string; nome: string; tipo: 'crédito' | 'débito'; banco: string; bandeira: string; final: string;
    limiteBase?: number; faturaAtual?: number; fechamento?: number; vencimento?: number; contaId?: string;
    cofrinhoId?: string;
  }[];
  cofrinhos?: {
    id: string; nome: string; saldo: number; meta: number; cartaoId: string | null;
    historico?: { valor: number; data: string; pessoa: string }[];
  }[];
  investimentos?: { classe: string; ativos: { id: string; nome: string; valor: number; rent: number; data: string }[] }[];
  metas?: { id: string; nome: string; alvo: number; atual: number; prazo: string; vinculo: string | null }[];
  transacoes?: (Omit<Transacao, 'valor' | 'tipo'> & { valor: number; tipo: 'despesa' | 'receita' | 'transferencia' })[];
}

export interface EstadoNovo {
  categorias: Categoria[];
  contas: Conta[];
  cartoes: Cartao[];
  cofrinhos: Cofrinho[];
  transacoes: Transacao[];
  metas: Meta[];
  investimentos: ClasseInvestimento[];
  /** Coisas que o usuário deve olhar (o importador nunca descarta nada em silêncio). */
  avisos: string[];
}

/**
 * Converte o estado do app original para o modelo novo SEM alterar nenhum saldo:
 * saldoInicial/faturaInicial são calculados para que os valores DERIVADOS batam, centavo a centavo,
 * com o que o app original mostrava. Os testes conferem isso.
 */
export function importarEstadoLegado(e: EstadoLegado): EstadoNovo {
  const avisos: string[] = [];
  const cartoesLeg = e.cartoes ?? [];

  const transacoes: Transacao[] = (e.transacoes ?? []).map((t) => {
    const base = { ...t, valor: toCents(t.valor) } as Transacao;
    // O original registrava "pagar fatura" como uma DESPESA nova (dupla contagem). Aqui vira pagamento_fatura.
    if (t.tipo === 'despesa' && /^Pagamento fatura /.test(t.desc) && t.catId === 'dividas') {
      const nome = t.desc.replace(/^Pagamento fatura /, '');
      const cartao = cartoesLeg.find((c) => c.nome === nome);
      if (cartao) {
        avisos.push(`Pagamento de fatura "${t.desc}" (${t.data}) não tem conta de origem: informe de qual conta saiu para o saldo ficar correto.`);
        return { ...base, tipo: 'pagamento_fatura', cartaoId: cartao.id, catId: undefined, sub: undefined };
      }
    }
    return base;
  });

  const contas: Conta[] = (e.contas ?? []).map((c) => ({
    id: c.id, banco: c.banco, apelido: c.apelido,
    saldoInicial: toCents(c.saldo) - movimentoConta(c.id, transacoes),
  }));

  const cartoes: Cartao[] = cartoesLeg.map((c) => {
    const semBase: Cartao = {
      id: c.id, nome: c.nome, tipo: c.tipo, banco: c.banco, bandeira: c.bandeira, final: c.final,
      limiteBase: toCents(c.limiteBase ?? 0), faturaInicial: 0,
      ...(c.fechamento !== undefined && { fechamento: c.fechamento }),
      ...(c.vencimento !== undefined && { vencimento: c.vencimento }),
      ...(c.contaId !== undefined && { contaId: c.contaId }),
    };
    if (c.tipo === 'crédito') semBase.faturaInicial = toCents(c.faturaAtual ?? 0) - faturaCartao(semBase, transacoes);
    return semBase;
  });

  const cofrinhos: Cofrinho[] = (e.cofrinhos ?? []).map((p) => {
    const aportes = (p.historico ?? []).map((h) => ({ valor: toCents(h.valor), data: h.data, pessoa: h.pessoa }));
    const somaAportes = aportes.reduce((s, a) => s + a.valor, 0);
    const cartaoDoCartao = cartoesLeg.find((c) => c.cofrinhoId === p.id)?.id ?? null;
    if (cartaoDoCartao !== (p.cartaoId ?? null)) {
      avisos.push(`Cofrinho "${p.nome}": o vínculo com cartão estava duplicado e diferente nos dois lados; usei o do cofrinho (${p.cartaoId ?? 'nenhum'}), que é o que o app original usava no cálculo do limite.`);
    }
    return { id: p.id, nome: p.nome, meta: toCents(p.meta), saldoInicial: toCents(p.saldo) - somaAportes, cartaoId: p.cartaoId ?? null, aportes };
  });

  const metas: Meta[] = (e.metas ?? []).map((m) => ({ ...m, alvo: toCents(m.alvo), atual: toCents(m.atual) }));
  const investimentos: ClasseInvestimento[] = (e.investimentos ?? []).map((c) => ({
    classe: c.classe,
    ativos: c.ativos.map((a): Ativo => ({ ...a, valor: toCents(a.valor) })),
  }));

  return { categorias: e.categorias ?? [], contas, cartoes, cofrinhos, transacoes, metas, investimentos, avisos };
}
