/**
 * TESTES DE PARIDADE: o código NOVO (TypeScript) contra o código ORIGINAL do app (JavaScript de
 * fixtures/grana-legacy.html, executado numa sandbox). Onde os dois discordam, ou o original tinha
 * um defeito (e há um teste em unit.test.ts documentando a correção) ou o teste está errado.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  addDays, addMonthsClamped, adicionarTransacao, darBaixa, detectarAnomalias, editarTransacao, excluirTransacao,
  faturaCartao, importarEstadoLegado, limiteCartao, parseQuickEntry, previsaoSaldo, proximoVencimento, saldoConta,
  sugerirCategoria, sugerirForma, toCents, totaisDoMes,
  type Cartao, type Cofrinho, type Conta, type Transacao,
} from '../src';
import { loadLegacy } from './legacy';

const legacy = loadLegacy();
const HOJE = legacy.HOJE; // '2026-09-18' — fixo no original

describe('sanidade da sandbox', () => {
  it('carregou o JS original', () => {
    expect(HOJE).toBe('2026-09-18');
    expect(legacy.run<number>('cardLimiteInfo({id:"x",limiteBase:1000,faturaAtual:100}).disponivel')).toBe(900);
  });
});

describe('paridade: recorrência', () => {
  const freqs = ['semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral', 'semestral', 'anual', 'personalizado'] as const;
  const diaArb = fc.oneof(
    fc.constant(undefined),
    fc.constant('ultimo'),
    fc.integer({ min: 1, max: 31 }).map(String),
    fc.integer({ min: 1, max: 31 }),
  );

  it('addMonthsClamped: mesma data que o original', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 2500 }), fc.integer({ min: 0, max: 30 }), diaArb,
      (off, meses, dia) => {
        const iso = addDays('2020-01-01', off);
        // sem dia-alvo o original usa o dia da data recebida: comparamos com a MESMA entrada (1 passo)
        const esperado = legacy.run<string>(
          `addMonthsClamped(new Date(${JSON.stringify(iso)}+'T00:00:00'), ${meses}, ${JSON.stringify(dia ?? null)}).toISOString().slice(0,10)`,
        );
        const dNum = dia === undefined ? undefined : dia === 'ultimo' ? 'ultimo' : Number(dia);
        expect(addMonthsClamped(iso, meses, dNum)).toBe(esperado);
      },
    ), { numRuns: 400 });
  });

  it('proximoVencimento: mesma data, nos casos em que o original está correto', () => {
    fc.assert(fc.property(
      fc.constantFrom(...freqs), fc.integer({ min: 0, max: 400 }), fc.integer({ min: 1, max: 28 }),
      diaArb, fc.integer({ min: 7, max: 60 }),
      (freq, atras, diaDoMes, venceDia, intervalo) => {
        const ultima = addDays(HOJE, -atras);
        // domínio onde o original é correto: (a) tem "vence no dia" OU o dia da data é <= 28 (sem deriva);
        // (b) dentro de 80 passos (ver unit.test.ts para os casos em que o original errava)
        const ancorada = venceDia !== undefined || Number(ultima.slice(8)) <= 28;
        fc.pre(ancorada);
        void diaDoMes;
        const esperado = legacy.run<string>(
          `proximoVencimento(${JSON.stringify(ultima)}, ${JSON.stringify(freq)}, ${JSON.stringify(venceDia ?? null)}, ${intervalo})`,
        );
        const obtido = proximoVencimento(ultima, freq, HOJE, { venceDia: venceDia as never, intervaloDias: intervalo });
        expect(obtido).toBe(esperado);
      },
    ), { numRuns: 600 });
  });
});

describe('paridade: lançamento rápido, categoria e forma', () => {
  const contasLegado = [
    { id: 'conta-inter', banco: 'Inter', apelido: 'Conta corrente', saldo: 0 },
    { id: 'conta-nu', banco: 'Nubank', apelido: 'Dia a dia', saldo: 0 },
  ];
  legacy.set('contas', contasLegado);
  const contas: Conta[] = contasLegado.map((c) => ({ id: c.id, banco: c.banco, apelido: c.apelido, saldoInicial: 0 }));

  const palavras = ['Uber', 'Mercado', 'Padaria', 'Netflix', 'Aluguel', 'Farmácia', 'Posto', 'iFood', 'Academia', 'Cinema', 'Salário', 'Luz', 'Presente', 'Livro', 'Café'];
  const extras = ['pix', 'débito', 'crédito', 'dinheiro', 'nubank', 'inter', 'itaú', 'hoje', 'ontem', 'anteontem'];
  const valorArb = fc.oneof(
    fc.constant(''),
    fc.integer({ min: 0, max: 99999 }).map(String),
    fc.tuple(fc.integer({ min: 0, max: 999 }), fc.integer({ min: 0, max: 99 })).map(([a, b]) => `${a},${String(b).padStart(2, '0')}`),
    fc.tuple(fc.integer({ min: 0, max: 999 }), fc.integer({ min: 0, max: 9 })).map(([a, b]) => `${a}.${b}`),
  );
  const entradaArb = fc.tuple(
    fc.array(fc.constantFrom(...palavras), { minLength: 1, maxLength: 2 }),
    fc.array(fc.constantFrom(...extras), { maxLength: 2 }),
    valorArb,
  ).map(([ps, ex, v]) => [...ps, ...ex, v].join(' ').trim());

  it('parseQuickEntry: mesmo rascunho que o original', () => {
    fc.assert(fc.property(entradaArb, (texto) => {
      const esperado = legacy.run<{ desc: string; valor: number; data: string; catId: string | null; sub: string | null; forma: string | null; contaId: string | null }>(
        `parseQuickEntry(${JSON.stringify(texto)})`,
      );
      const obtido = parseQuickEntry(texto, HOJE, contas);
      expect({ ...obtido, valor: obtido.valor }).toEqual({ ...esperado, valor: toCents(esperado.valor) });
    }), { numRuns: 500 });
  });

  it('sugerirCategoria e sugerirForma: iguais ao original', () => {
    fc.assert(fc.property(entradaArb, (texto) => {
      expect(sugerirCategoria(texto)).toEqual(legacy.run(`sugerirCategoria(${JSON.stringify(texto)})`));
      expect(sugerirForma(texto)).toEqual(legacy.run(`sugerirForma(${JSON.stringify(texto)})`));
    }), { numRuns: 300 });
  });
});

const reais = (c: number) => c / 100;
const legadoTx = (t: Transacao) => ({ ...t, valor: reais(t.valor) });

describe('paridade: insights (anomalias e previsão)', () => {
  const txArb = fc.record({
    catId: fc.constantFrom('a', 'b', 'c', 'd'),
    valor: fc.integer({ min: 1, max: 200_000 }),
    data: fc.constantFrom('2026-06-15', '2026-07-03', '2026-07-28', '2026-08-01', '2026-08-30', '2026-09-02', '2026-09-17'),
    tipo: fc.constantFrom('despesa', 'despesa', 'despesa', 'receita'),
    recorrente: fc.boolean(),
  });
  let seq = 0;
  const toTx = (r: { catId: string; valor: number; data: string; tipo: string; recorrente: boolean }): Transacao =>
    ({ id: `p${++seq}`, tipo: r.tipo as Transacao['tipo'], desc: 'x', valor: r.valor, data: r.data, status: 'pago', catId: r.catId, recorrente: r.recorrente });

  it('detectarAnomalias: mesmas categorias e mesmos números', () => {
    fc.assert(fc.property(fc.array(txArb, { maxLength: 25 }), (rs) => {
      const txs = rs.map(toTx);
      // exclui empates exatos em 130% (float do original é indeterminado nesse ponto; ver unit.test.ts)
      const cats = [...new Set(txs.filter((t) => t.tipo === 'despesa').map((t) => t.catId!))];
      for (const c of cats) {
        const soma = (ym: string) => txs.filter((t) => t.catId === c && t.tipo === 'despesa' && t.data.startsWith(ym)).reduce((s, t) => s + t.valor, 0);
        const hist = ['2026-08', '2026-07'].map(soma).filter((v) => v > 0);
        fc.pre(!(hist.length && soma('2026-09') * hist.length * 10 === hist.reduce((a, b) => a + b, 0) * 13));
      }
      legacy.set('transacoes', txs.map(legadoTx));
      const esperado = legacy.run<{ catId: string; atual: number; media: number; pct: number }[]>('detectarAnomalias()');
      const obtido = detectarAnomalias(txs, HOJE);
      expect(obtido.map((a) => a.catId).sort()).toEqual(esperado.map((a) => a.catId).sort());
      for (const o of obtido) {
        const e = esperado.find((x) => x.catId === o.catId)!;
        expect(o.atual).toBe(toCents(e.atual));
        expect(Math.abs(o.media - toCents(e.media))).toBeLessThanOrEqual(1);
        expect(o.pct).toBeCloseTo(e.pct, 9);
      }
    }), { numRuns: 300 });
  });

  it('previsaoSaldo: mesmo valor', () => {
    fc.assert(fc.property(fc.array(txArb, { maxLength: 25 }), (rs) => {
      const txs = rs.map(toTx);
      legacy.set('transacoes', txs.map(legadoTx));
      const saldoLegado = legacy.run<number>('EVOLUCAO[EVOLUCAO.length-1].saldo');
      const esperado = legacy.run<{ valor: number; recRec: number; recDesp: number }>('previsaoSaldo()');
      const obtido = previsaoSaldo(toCents(saldoLegado), txs, HOJE);
      expect(obtido.valor).toBe(toCents(esperado.valor));
      expect(obtido.recRec).toBe(toCents(esperado.recRec));
      expect(obtido.recDesp).toBe(toCents(esperado.recDesp));
    }), { numRuns: 200 });
  });

  it('totais do mês: mesmos números do painel (sem transferência/pagamento de fatura no original)', () => {
    fc.assert(fc.property(fc.array(txArb, { maxLength: 25 }), (rs) => {
      const txs = rs.map(toTx);
      legacy.set('transacoes', txs.map(legadoTx));
      const rec = legacy.run<number>(`sumTipo(txnsOfMonth('2026-09'),'receita')`);
      const des = legacy.run<number>(`sumTipo(txnsOfMonth('2026-09'),'despesa')`);
      const t = totaisDoMes(txs, '2026-09');
      expect(t.receitas).toBe(toCents(rec));
      expect(t.despesas).toBe(toCents(des));
    }), { numRuns: 200 });
  });
});

describe('paridade: importação do estado + limite do cartão', () => {
  it('saldos e faturas derivados batem, centavo a centavo, com o que o app original mostrava', () => {
    const contaArb = fc.record({ saldo: fc.integer({ min: -500_000, max: 5_000_000 }) });
    const compraArb = fc.record({
      valor: fc.integer({ min: 1, max: 300_000 }),
      cartao: fc.constantFrom('cc1', 'cc2'),
      status: fc.constantFrom('pago', 'pendente', 'atrasado'),
    });
    fc.assert(fc.property(
      fc.array(contaArb, { minLength: 1, maxLength: 3 }),
      fc.array(compraArb, { maxLength: 12 }),
      fc.integer({ min: 0, max: 500_000 }), fc.integer({ min: 0, max: 500_000 }),
      fc.integer({ min: 0, max: 400_000 }), fc.integer({ min: 0, max: 400_000 }),
      (contasR, compras, fat1, fat2, pig1, pig2) => {
        const cartoesLeg = [
          { id: 'cc1', nome: 'A', tipo: 'crédito' as const, banco: 'X', bandeira: 'Visa', final: '1', limiteBase: reais(600_000), faturaAtual: reais(fat1), fechamento: 10, vencimento: 17 },
          { id: 'cc2', nome: 'B', tipo: 'crédito' as const, banco: 'Y', bandeira: 'Visa', final: '2', limiteBase: reais(200_000), faturaAtual: reais(fat2), fechamento: 10, vencimento: 17 },
        ];
        const cofrinhosLeg = [
          { id: 'p1', nome: 'P1', saldo: reais(pig1), meta: 1000, cartaoId: 'cc1', historico: [{ valor: reais(Math.floor(pig1 / 2)), data: '2026-09-01', pessoa: 'x' }] },
          { id: 'p2', nome: 'P2', saldo: reais(pig2), meta: 1000, cartaoId: 'cc1', historico: [] },
        ];
        const contasLeg = contasR.map((c, i) => ({ id: `ct${i}`, banco: 'B', apelido: `c${i}`, saldo: reais(c.saldo) }));
        const transLeg = compras.map((c, i) => ({
          id: `t${i}`, tipo: 'despesa' as const, desc: 'compra', valor: reais(c.valor), data: '2026-09-10', status: c.status,
          forma: 'Crédito', cartaoId: c.cartao,
        })).concat(contasR.map((c, i) => ({
          id: `d${i}`, tipo: 'despesa' as const, desc: 'deb', valor: reais(1234), data: '2026-09-11', status: 'pago',
          forma: 'Débito', cartaoId: undefined as unknown as string, contaId: `ct${i}`,
        })) as never);

        const novo = importarEstadoLegado({ contas: contasLeg, cartoes: cartoesLeg, cofrinhos: cofrinhosLeg, transacoes: transLeg as never });

        for (const c of contasLeg) {
          const nc = novo.contas.find((x) => x.id === c.id)!;
          expect(saldoConta(nc, novo.transacoes)).toBe(toCents(c.saldo));
        }
        legacy.set('cofrinhos', cofrinhosLeg);
        for (const c of cartoesLeg) {
          const esperado = legacy.run<{ bonus: number; total: number; usado: number; disponivel: number; pct: number }>(`cardLimiteInfo(${JSON.stringify(c)})`);
          const nc = novo.cartoes.find((x) => x.id === c.id)!;
          expect(faturaCartao(nc, novo.transacoes)).toBe(toCents(c.faturaAtual));
          const li = limiteCartao(nc, novo.cofrinhos, novo.transacoes);
          expect(li.bonus).toBe(toCents(esperado.bonus));
          expect(li.total).toBe(toCents(esperado.total));
          expect(li.usado).toBe(toCents(esperado.usado));
          expect(li.disponivel).toBe(toCents(esperado.disponivel));
          expect(li.pct).toBeCloseTo(esperado.pct, 6);
        }
      },
    ), { numRuns: 200 });
  });
});

/**
 * MODELO DE REFERÊNCIA: replica, em centavos, as regras IMPERATIVAS do original (submitLancamento,
 * darBaixaTransacao, applyLancamentoEdit, submitTransferencia, deleteTransacao). Se o saldo derivado
 * do ledger novo diverge dele em qualquer sequência de operações, há um bug no ledger novo.
 */
describe('modelo: ledger derivado ≡ contabilidade imperativa do original', () => {
  type Op =
    | { k: 'debito' | 'receita'; conta: number; valor: number; pago: boolean }
    | { k: 'credito'; cartao: number; valor: number; pago: boolean }
    | { k: 'transfer'; de: number; para: number; valor: number }
    | { k: 'baixa' | 'delete'; alvo: number }
    | { k: 'edit'; alvo: number; valor: number; pago: boolean };

  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ k: fc.constantFrom('debito' as const, 'receita' as const), conta: fc.integer({ min: 0, max: 1 }), valor: fc.integer({ min: 1, max: 100_000 }), pago: fc.boolean() }),
    fc.record({ k: fc.constant('credito' as const), cartao: fc.integer({ min: 0, max: 1 }), valor: fc.integer({ min: 1, max: 100_000 }), pago: fc.boolean() }),
    fc.record({ k: fc.constant('transfer' as const), de: fc.integer({ min: 0, max: 1 }), para: fc.integer({ min: 0, max: 1 }), valor: fc.integer({ min: 1, max: 100_000 }) }),
    fc.record({ k: fc.constantFrom('baixa' as const, 'delete' as const), alvo: fc.nat(50) }),
    fc.record({ k: fc.constant('edit' as const), alvo: fc.nat(50), valor: fc.integer({ min: 1, max: 100_000 }), pago: fc.boolean() }),
  );

  it('após QUALQUER sequência de operações, saldos e faturas são idênticos', () => {
    fc.assert(fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
      const contas: Conta[] = [{ id: 'c0', banco: 'A', apelido: 'a', saldoInicial: 100_000 }, { id: 'c1', banco: 'B', apelido: 'b', saldoInicial: 0 }];
      const cartoes: Cartao[] = ['k0', 'k1'].map((id) => ({ id, nome: id, tipo: 'crédito', banco: 'X', bandeira: 'V', final: '0', limiteBase: 1e9, faturaInicial: 0 }));
      const ctx = { contas, cartoes };

      // referência imperativa
      const saldo = [100_000, 0];
      const fatura = [0, 0];
      const ref: { id: string; t: Transacao }[] = [];
      const efeito = (t: Transacao, sinal: 1 | -1) => {
        if (t.tipo === 'transferencia') {
          saldo[Number(t.contaOrigemId!.slice(1))]! -= sinal * t.valor;
          saldo[Number(t.contaDestinoId!.slice(1))]! += sinal * t.valor;
          return;
        }
        if (t.status !== 'pago') return;
        if (t.contaId) saldo[Number(t.contaId.slice(1))]! += sinal * (t.tipo === 'receita' ? t.valor : -t.valor);
        if (t.cartaoId && t.tipo === 'despesa') fatura[Number(t.cartaoId.slice(1))]! += sinal * t.valor;
      };

      let lista: Transacao[] = [];
      let seq = 0;
      for (const op of ops) {
        if (op.k === 'debito' || op.k === 'receita') {
          const t: Transacao = { id: `m${++seq}`, tipo: op.k === 'receita' ? 'receita' : 'despesa', desc: 'x', valor: op.valor, data: '2026-09-10', status: op.pago ? 'pago' : 'pendente', contaId: `c${op.conta}`, forma: 'Pix' };
          const r = adicionarTransacao(lista, t, ctx);
          if (r.ok) { lista = r.valor; ref.unshift({ id: t.id, t }); efeito(t, 1); }
        } else if (op.k === 'credito') {
          const t: Transacao = { id: `m${++seq}`, tipo: 'despesa', desc: 'x', valor: op.valor, data: '2026-09-10', status: op.pago ? 'pago' : 'pendente', cartaoId: `k${op.cartao}`, forma: 'Crédito' };
          const r = adicionarTransacao(lista, t, ctx);
          if (r.ok) { lista = r.valor; ref.unshift({ id: t.id, t }); efeito(t, 1); }
        } else if (op.k === 'transfer') {
          const t: Transacao = { id: `m${++seq}`, tipo: 'transferencia', desc: '', valor: op.valor, data: '2026-09-10', status: 'pago', contaOrigemId: `c${op.de}`, contaDestinoId: `c${op.para}` };
          const r = adicionarTransacao(lista, t, ctx);
          if (r.ok) { lista = r.valor; ref.unshift({ id: t.id, t }); efeito(t, 1); } // o original também recusa origem == destino
        } else if (ref.length && (op.k === 'baixa' || op.k === 'delete' || op.k === 'edit')) {
          const alvoRef = ref[op.alvo % ref.length]!;
          const id = alvoRef.id;
          if (op.k === 'baixa') {
            if (alvoRef.t.tipo !== 'transferencia' && alvoRef.t.status !== 'pago') { alvoRef.t = { ...alvoRef.t, status: 'pago' }; efeito(alvoRef.t, 1); }
            lista = darBaixa(lista, id);
          } else if (op.k === 'delete') {
            efeito(alvoRef.t, -1);
            ref.splice(ref.indexOf(alvoRef), 1);
            lista = excluirTransacao(lista, id);
          } else if (op.k === 'edit') {
            const novoStatus = alvoRef.t.tipo === 'transferencia' ? 'pago' : op.pago ? 'pago' : 'pendente';
            efeito(alvoRef.t, -1);
            alvoRef.t = { ...alvoRef.t, valor: op.valor, status: novoStatus };
            efeito(alvoRef.t, 1);
            const r = editarTransacao(lista, id, { valor: op.valor, status: novoStatus }, 'apenas', ctx);
            if (r.ok) lista = r.valor;
          }
        }
        expect(saldo).toEqual(contas.map((c) => saldoConta(c, lista)));
        expect(fatura).toEqual(cartoes.map((c) => faturaCartao(c, lista)));
      }
    }), { numRuns: 400 });
  });
});
