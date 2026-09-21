import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  addDays, addMonthsClamped, adicionarTransacao, ajustarSaldoConta, alvosDaRecorrencia, darBaixa, detectarAnomalias,
  diffDays, editarTransacao, excluirTransacao, faturaCartao, formatBRL, guardarNoCofrinho, limiteCartao, parseMoneyBR,
  parseQuickEntry, pagarFatura, previsaoSaldo, projecaoDiaria, proximoVencimento, proximosVencimentos, saldoConta,
  saldoTotal, splitCents, toCents, totaisDoMes, validarTransacao, hojeSaoPaulo,
  type Cartao, type Cofrinho, type Conta, type Transacao,
} from '../src';

const conta = (id: string, saldoInicial = 0): Conta => ({ id, banco: 'Inter', apelido: id, saldoInicial });
const cartao = (id = 'cc', over: Partial<Cartao> = {}): Cartao => ({
  id, nome: 'Cartão', tipo: 'crédito', banco: 'Nubank', bandeira: 'Mastercard', final: '0000',
  limiteBase: 100_000, faturaInicial: 0, vencimento: 5, fechamento: 27, ...over,
});
let n = 0;
const tx = (over: Partial<Transacao>): Transacao => ({
  id: `t${++n}`, tipo: 'despesa', desc: 'x', valor: 1000, data: '2026-09-10', status: 'pago', ...over,
});

describe('dinheiro', () => {
  it('não acumula erro de ponto flutuante', () => {
    // 0.1 + 0.2 !== 0.3 em JS; em centavos é exato
    expect(toCents(0.1) + toCents(0.2)).toBe(toCents(0.3));
    expect(toCents(44.9)).toBe(4490);
    expect(toCents(1.005)).toBe(101); // arredonda como o comerciante espera? (documenta o comportamento)
  });
  it('formata em reais', () => {
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(-5)).toBe('-R$ 0,05');
    expect(formatBRL(0)).toBe('R$ 0,00');
  });
  it('lê formatos brasileiros', () => {
    expect(parseMoneyBR('1.234,56')).toBe(123456);
    expect(parseMoneyBR('154,9')).toBe(15490);
    expect(parseMoneyBR('154.90')).toBe(15490);
    expect(parseMoneyBR('R$ 12')).toBe(1200);
    expect(parseMoneyBR('abc')).toBeNull();
  });
  it('splitCents sempre soma o total exato', () => {
    fc.assert(fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.integer({ min: 1, max: 12 }), (total, k) => {
      const partes = splitCents(total, k);
      expect(partes).toHaveLength(k);
      expect(partes.reduce((a, b) => a + b, 0)).toBe(total);
      expect(Math.max(...partes) - Math.min(...partes)).toBeLessThanOrEqual(1);
    }));
  });
});

describe('datas (UTC, sem depender do fuso)', () => {
  it('soma dias e meses com limite de fim de mês', () => {
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02');
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29'); // bissexto
    expect(addMonthsClamped('2026-03-15', 1, 'ultimo')).toBe('2026-04-30');
    expect(addMonthsClamped('2026-11-30', 3)).toBe('2027-02-28');
    expect(diffDays('2026-09-18', '2026-09-20')).toBe(2);
  });
  it('hoje em São Paulo respeita o fuso (23h30 de SP ainda é o mesmo dia)', () => {
    expect(hojeSaoPaulo(new Date('2026-09-20T02:30:00Z'))).toBe('2026-09-19'); // 23:30 em SP
    expect(hojeSaoPaulo(new Date('2026-09-20T03:30:00Z'))).toBe('2026-09-20');
  });
  it('rejeita datas inexistentes', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow();
  });
});

describe('recorrência — correções em relação ao app original', () => {
  it('mensal no dia 31 NÃO deriva para o dia 28', () => {
    // original: 31/jan -> 28/fev -> 28/mar... ; correto: volta para 31 quando o mês permite
    expect(proximoVencimento('2026-01-31', 'mensal', '2026-02-28')).toBe('2026-03-31');
    expect(proximoVencimento('2026-01-31', 'mensal', '2026-03-31')).toBe('2026-04-30');
  });
  it('não devolve data no passado quando a série ficou parada por muito tempo', () => {
    // original desistia após 80 passos: semanal parado desde 2023 devolvia uma data passada
    const prox = proximoVencimento('2023-01-02', 'semanal', '2026-09-18');
    expect(prox > '2026-09-18').toBe(true);
    expect(prox).toBe('2026-09-21');
  });
  it('sempre estritamente depois de hoje (propriedade)', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 1500 }), fc.integer({ min: 0, max: 800 }),
      fc.constantFrom('semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral', 'semestral', 'anual', 'personalizado'),
      fc.integer({ min: 1, max: 90 }),
      (offUltima, offHoje, freq, intervalo) => {
        const ultima = addDays('2022-01-01', offUltima);
        const hoje = addDays('2022-01-01', offUltima + offHoje);
        const prox = proximoVencimento(ultima, freq, hoje, { intervaloDias: intervalo });
        expect(prox > hoje).toBe(true);
        expect(prox > ultima).toBe(true);
      },
    ));
  });
  it('alvos da série: só este / este e futuros / todos', () => {
    const a = tx({ recorrenciaId: 'r', data: '2026-07-08' });
    const b = tx({ recorrenciaId: 'r', data: '2026-08-08' });
    const c = tx({ recorrenciaId: 'r', data: '2026-09-08' });
    const outra = tx({ recorrenciaId: 'z', data: '2026-09-08' });
    const todas = [a, b, c, outra];
    expect(alvosDaRecorrencia(todas, b, 'apenas').map((t) => t.id)).toEqual([b.id]);
    expect(alvosDaRecorrencia(todas, b, 'futuros').map((t) => t.id)).toEqual([b.id, c.id]);
    expect(alvosDaRecorrencia(todas, b, 'todos').map((t) => t.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe('ledger — saldos derivados', () => {
  const contas = [conta('a', 100_00), conta('b', 0)];
  const cartoes = [cartao('cc')];
  const ctx = { contas, cartoes };

  it('receita entra, despesa sai, só se PAGA', () => {
    const t = [tx({ tipo: 'receita', valor: 5000, contaId: 'a' }), tx({ valor: 1200, contaId: 'a' }), tx({ valor: 999, contaId: 'a', status: 'pendente' })];
    expect(saldoConta(contas[0]!, t)).toBe(100_00 + 5000 - 1200);
  });
  it('transferência conserva o total', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000 }), (valor) => {
      const t = [tx({ tipo: 'transferencia', valor, contaOrigemId: 'a', contaDestinoId: 'b' })];
      expect(saldoTotal(contas, t)).toBe(saldoTotal(contas, []));
      expect(saldoConta(contas[1]!, t)).toBe(valor);
    }));
  });
  it('compra no crédito NÃO sai da conta: vai para a fatura', () => {
    const t = [tx({ valor: 8000, forma: 'Crédito', cartaoId: 'cc' })];
    expect(saldoTotal(contas, t)).toBe(saldoTotal(contas, []));
    expect(faturaCartao(cartoes[0]!, t)).toBe(8000);
  });
  it('dar baixa é idempotente e só então o saldo muda', () => {
    const t = tx({ valor: 700, contaId: 'a', status: 'pendente' });
    const antes = saldoConta(contas[0]!, [t]);
    const uma = darBaixa([t], t.id);
    const duas = darBaixa(uma, t.id);
    expect(saldoConta(contas[0]!, uma)).toBe(antes - 700);
    expect(saldoConta(contas[0]!, duas)).toBe(antes - 700);
  });
  it('excluir e editar não deixam resíduo (o saldo é sempre recalculado do extrato)', () => {
    const t1 = tx({ valor: 300, contaId: 'a' });
    const t2 = tx({ valor: 500, contaId: 'a' });
    const sem = excluirTransacao([t1, t2], t1.id);
    expect(saldoConta(contas[0]!, sem)).toBe(100_00 - 500);
    const ed = editarTransacao([t1, t2], t2.id, { valor: 800 }, 'apenas', ctx);
    expect(ed.ok && saldoConta(contas[0]!, ed.valor)).toBe(100_00 - 300 - 800);
  });
  it('ajuste de saldo cria o lançamento que leva ao saldo pedido', () => {
    fc.assert(fc.property(fc.integer({ min: -500_000, max: 500_000 }), (novo) => {
      const base = [tx({ valor: 1234, contaId: 'a' })];
      const depois = ajustarSaldoConta(contas[0]!, base, novo, { id: 'aj', data: '2026-09-18' });
      expect(saldoConta(contas[0]!, depois)).toBe(novo);
    }));
  });
});

describe('fatura e limite', () => {
  const c = cartao('cc', { limiteBase: 200_000, faturaInicial: 50_000 });
  const cofrinhos: Cofrinho[] = [
    { id: 'p1', nome: 'Viagem', meta: 800_000, saldoInicial: 100_000, cartaoId: 'cc', aportes: [{ valor: 20_000, data: '2026-09-02', pessoa: 'x' }] },
    { id: 'p2', nome: 'Reserva', meta: 3_000_000, saldoInicial: 840_000, cartaoId: null, aportes: [] },
  ];
  it('cada real em cofrinho vinculado vira limite; cofrinho sem vínculo não', () => {
    const li = limiteCartao(c, cofrinhos, []);
    expect(li.bonus).toBe(120_000);
    expect(li.total).toBe(320_000);
    expect(li.usado).toBe(50_000);
    expect(li.disponivel).toBe(270_000);
  });
  it('guardar no cofrinho aumenta o limite na hora', () => {
    const p = guardarNoCofrinho(cofrinhos[0]!, { valor: 5_000, data: '2026-09-18', pessoa: 'x' });
    expect(limiteCartao(c, [p], []).total).toBe(200_000 + 125_000);
    expect(() => guardarNoCofrinho(p, { valor: 0, data: '2026-09-18', pessoa: 'x' })).toThrow();
  });
  it('disponível nunca fica negativo e pct nunca passa de 100', () => {
    const estourado = [tx({ valor: 900_000, forma: 'Crédito', cartaoId: 'cc' })];
    const li = limiteCartao(c, [], estourado);
    expect(li.disponivel).toBe(0);
    expect(li.pct).toBe(100);
  });
  it('pagar fatura: NÃO conta como despesa e sai de uma conta real', () => {
    const contas = [conta('a', 1_000_00)];
    const compras = [tx({ valor: 30_000, forma: 'Crédito', cartaoId: 'cc', data: '2026-09-10' })];
    const r = pagarFatura(c, compras, { id: 'pg', contaId: 'a', data: '2026-09-18' }, { contas, cartoes: [c] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(faturaCartao(c, r.valor)).toBe(0);
    expect(saldoConta(contas[0]!, r.valor)).toBe(1_000_00 - 80_000); // 500,00 iniciais + 300,00 de compras
    // dupla contagem do original: compra (300) + pagamento (800) somavam como despesa
    expect(totaisDoMes(r.valor, '2026-09').despesas).toBe(30_000);
  });
  it('recusa pagar mais do que a fatura e pagar sem conta', () => {
    const contas = [conta('a', 1_000_00)];
    const r = pagarFatura(c, [], { id: 'pg', contaId: 'a', data: '2026-09-18', valor: 60_000 }, { contas, cartoes: [c] });
    expect(!r.ok && r.erros.map((e) => e.codigo)).toContain('pagamento_maior_que_fatura');
    const semConta = validarTransacao(tx({ tipo: 'pagamento_fatura', cartaoId: 'cc', valor: 100 }), { contas, cartoes: [c] });
    expect(semConta.map((e) => e.codigo)).toContain('fatura_sem_conta');
  });
});

describe('validação', () => {
  const ctx = { contas: [conta('a'), conta('b')], cartoes: [cartao('cc'), cartao('deb', { tipo: 'débito' })] };
  const codigos = (t: Transacao) => validarTransacao(t, ctx).map((e) => e.codigo);
  it('valor precisa ser inteiro e positivo', () => {
    expect(codigos(tx({ valor: 0 }))).toContain('valor_invalido');
    expect(codigos(tx({ valor: -5 }))).toContain('valor_invalido');
    expect(codigos(tx({ valor: 10.5 }))).toContain('valor_invalido');
  });
  it('transferência exige duas contas diferentes e existentes', () => {
    expect(codigos(tx({ tipo: 'transferencia', contaOrigemId: 'a', contaDestinoId: 'a' }))).toContain('transferencia_mesma_conta');
    expect(codigos(tx({ tipo: 'transferencia', contaOrigemId: 'a', contaDestinoId: 'zz' }))).toContain('conta_inexistente');
    expect(codigos(tx({ tipo: 'transferencia', contaOrigemId: 'a', contaDestinoId: 'b' }))).toEqual([]);
  });
  it('crédito exige cartão de crédito existente', () => {
    expect(codigos(tx({ forma: 'Crédito' }))).toContain('credito_sem_cartao');
    expect(codigos(tx({ forma: 'Crédito', cartaoId: 'nao' }))).toContain('cartao_inexistente');
    expect(codigos(tx({ forma: 'Crédito', cartaoId: 'deb' }))).toContain('cartao_nao_e_credito');
  });
  it('adicionarTransacao rejeita inválidas e ids repetidos', () => {
    const ok = tx({ contaId: 'a' });
    const r1 = adicionarTransacao([], ok, ctx);
    expect(r1.ok).toBe(true);
    expect(r1.ok && adicionarTransacao(r1.valor, ok, ctx).ok).toBe(false);
    expect(adicionarTransacao([], tx({ valor: 0 }), ctx).ok).toBe(false);
  });
});

describe('relatórios', () => {
  it('totais do mês ignoram transferência e pagamento de fatura', () => {
    const t = [
      tx({ tipo: 'receita', valor: 100_000 }), tx({ valor: 20_000 }),
      tx({ tipo: 'transferencia', valor: 50_000, contaOrigemId: 'a', contaDestinoId: 'b' }),
      tx({ tipo: 'pagamento_fatura', valor: 40_000, cartaoId: 'cc', contaId: 'a' }),
      tx({ valor: 9_999, data: '2026-08-31' }),
    ];
    expect(totaisDoMes(t, '2026-09')).toEqual({ receitas: 100_000, despesas: 20_000 });
  });
  it('anomalia: só passa de 130% da média; exatamente 130% não é anomalia', () => {
    const base = [tx({ catId: 'lazer', valor: 10_000, data: '2026-08-10' })];
    expect(detectarAnomalias([...base, tx({ catId: 'lazer', valor: 13_000, data: '2026-09-10' })], '2026-09-18')).toEqual([]);
    const r = detectarAnomalias([...base, tx({ catId: 'lazer', valor: 13_001, data: '2026-09-10' })], '2026-09-18');
    expect(r).toHaveLength(1);
    expect(r[0]!.catId).toBe('lazer');
  });
  it('anomalia funciona em qualquer mês (o original só olhava setembro/2026)', () => {
    const t = [tx({ catId: 'x', valor: 1000, data: '2027-01-10' }), tx({ catId: 'x', valor: 5000, data: '2027-02-10' })];
    expect(detectarAnomalias(t, '2027-02-15').map((a) => a.catId)).toEqual(['x']);
    expect(detectarAnomalias(t, '2027-01-15')).toEqual([]);
  });
  it('previsão soma receitas fixas e subtrai despesas fixas do mês', () => {
    const t = [tx({ tipo: 'receita', valor: 500_000, recorrente: true }), tx({ valor: 190_000, recorrente: true }), tx({ valor: 1_000 })];
    expect(previsaoSaldo(1_000_000, t, '2026-09-18').valor).toBe(1_000_000 + 500_000 - 190_000);
  });
  it('próximo vencimento de fatura usa a data real, não setembro fixo', () => {
    const c = cartao('cc', { vencimento: 5, faturaInicial: 10_000 });
    expect(proximosVencimentos([], [c], '2026-09-18')[0]!.data).toBe('2026-10-05');
    expect(proximosVencimentos([], [c], '2026-09-04')[0]!.data).toBe('2026-09-05');
    expect(proximosVencimentos([], [c], '2026-12-20')[0]!.data).toBe('2027-01-05');
  });
  it('projeção diária acumula entradas e saídas', () => {
    const t = [tx({ tipo: 'receita', valor: 1000, data: '2026-09-02' }), tx({ valor: 400, data: '2026-09-03' })];
    const p = projecaoDiaria(t, '2026-09', 5000);
    expect(p['2026-09-01']!.saldo).toBe(5000);
    expect(p['2026-09-02']!.saldo).toBe(6000);
    expect(p['2026-09-30']!.saldo).toBe(5600);
  });
});

describe('lançamento rápido', () => {
  const contas = [conta('conta-nu', 0)].map((c) => ({ ...c, banco: 'Nubank' }));
  it('entende ontem / valor / forma', () => {
    const r = parseQuickEntry('Uber 32,90 ontem', '2026-09-18', contas);
    expect(r).toMatchObject({ desc: 'Uber', valor: 3290, data: '2026-09-17', catId: 'transporte', sub: 'Uber / 99' });
  });
  it('"ontem" acompanha o dia de hoje (o original fixava 17/09/2026)', () => {
    expect(parseQuickEntry('Mercado 10 ontem', '2027-03-01', []).data).toBe('2027-02-28');
    expect(parseQuickEntry('Mercado 10 anteontem', '2027-03-01', []).data).toBe('2027-02-27');
  });
  it('lê milhar brasileiro (o original lia "1.900,00" como 900)', () => {
    expect(parseQuickEntry('Aluguel 1.900,00', '2026-09-18', []).valor).toBe(190_000);
    expect(parseQuickEntry('Aluguel 1900', '2026-09-18', []).valor).toBe(190_000);
  });
  it('"menu" não vira Nubank por engano', () => {
    const r = parseQuickEntry('menu 25', '2026-09-18', contas);
    expect(r.contaId).toBeNull();
    expect(r.desc).toBe('menu');
    expect(parseQuickEntry('nu 25', '2026-09-18', contas).contaId).toBe('conta-nu');
  });
});

describe('efeito na conta — casos de borda', () => {
  it('lançamento com cartão E conta nunca tira da conta (a compra vai para a fatura)', () => {
    const t = tx({ valor: 5000, contaId: 'a', cartaoId: 'cc', forma: 'Crédito' });
    expect(saldoConta(conta('a', 10_000), [t])).toBe(10_000);
  });
});

import vetores from '../../../shared/vectors.json';
import { BANK_ALIASES, sugerirCategoria, sugerirForma } from '../src';

describe('vetores compartilhados com o serviço Python', () => {
  it('categoria', () => {
    for (const [texto, catId, sub] of vetores.categoria as [string, string | null, string | null][]) {
      expect(sugerirCategoria(texto), texto).toEqual(catId ? { catId, sub } : null);
    }
  });
  it('forma de pagamento', () => {
    for (const [texto, forma] of vetores.forma as [string, string | null][]) expect(sugerirForma(texto), texto).toBe(forma);
  });
  it('banco', () => {
    for (const [texto, banco] of vetores.banco as [string, string | null][]) {
      const m = BANK_ALIASES.find((r) => r[0].test(texto));
      expect(m ? m[1] : null, texto).toBe(banco);
    }
  });
});

describe('cenário idêntico ao teste SQL (supabase/tests/test_schema.sql)', () => {
  it('os mesmos números saem do TypeScript e do banco', () => {
    const contas = [conta('c1', 100_000), conta('c2', 0)];
    const cc = cartao('k1', { limiteBase: 200_000 });
    const t = [
      tx({ tipo: 'receita', valor: 5000, contaId: 'c1' }),
      tx({ valor: 1200, contaId: 'c1' }),
      tx({ valor: 999, contaId: 'c1', status: 'pendente' }),
      tx({ tipo: 'transferencia', valor: 3000, contaOrigemId: 'c1', contaDestinoId: 'c2' }),
      tx({ valor: 8000, cartaoId: 'k1', forma: 'Crédito' }),
      tx({ tipo: 'pagamento_fatura', valor: 8000, cartaoId: 'k1', contaId: 'c1' }),
    ];
    expect(saldoConta(contas[0]!, t)).toBe(92_800);
    expect(saldoConta(contas[1]!, t)).toBe(3_000);
    expect(faturaCartao(cc, t)).toBe(0);
    const depoisDaBaixa = darBaixa(t, t[2]!.id);
    expect(saldoConta(contas[0]!, depoisDaBaixa)).toBe(91_801);
  });
});

import { faturasPagasNoMes, pagamentosDeFatura } from '../src';
describe('histórico de pagamento de fatura', () => {
  const c = cartao('cc');
  const contas = [conta('a', 1_000_000)];
  const compras = [tx({ valor: 50_000, forma: 'Crédito', cartaoId: 'cc', data: '2026-09-01' })];
  it('mostra quando foi pago e se quitou ou foi parcial', () => {
    const p1 = pagarFatura(c, compras, { id: 'p1', contaId: 'a', data: '2026-09-10', valor: 20_000 }, { contas, cartoes: [c] });
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    const p2 = pagarFatura(c, p1.valor, { id: 'p2', contaId: 'a', data: '2026-09-15' }, { contas, cartoes: [c] });
    expect(p2.ok).toBe(true);
    if (!p2.ok) return;
    const h = pagamentosDeFatura(p2.valor, [c]);
    expect(h.map((x) => [x.id, x.situacao, x.restante])).toEqual([['p2', 'quitada', 0], ['p1', 'parcial', 30_000]]);
    expect(faturasPagasNoMes(p2.valor, '2026-09')).toBe(50_000);
    expect(pagamentosDeFatura(p2.valor, [c], '2026-08')).toEqual([]);
    // continua fora das despesas: só a compra de 500,00 conta
    expect(totaisDoMes(p2.valor, '2026-09').despesas).toBe(50_000);
  });
});
