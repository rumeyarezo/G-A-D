/**
 * Dinheiro sempre em CENTAVOS INTEIROS.
 *
 * O app original guardava reais em `number` (44.90 + 0.10 vira 44.99999...).
 * Aqui todo cálculo é feito com inteiros e só formatamos na borda.
 */
export type Cents = number;

export function toCents(reais: number): Cents {
  if (!Number.isFinite(reais)) throw new RangeError(`valor inválido: ${reais}`);
  // 44.9*100 = 4490.000000000001 e 1.005*100 = 100.49999999999999: limpar o ruído binário (15 dígitos
  // significativos) antes de arredondar, e arredondar "meio para longe do zero" também nos negativos.
  const centavos = Number((Math.abs(reais) * 100).toPrecision(15));
  return (reais < 0 ? -1 : 1) * Math.round(centavos) || 0;
}

export function fromCents(c: Cents): number {
  return c / 100;
}

export function assertCents(c: number, label = 'valor'): asserts c is Cents {
  if (!Number.isInteger(c)) throw new RangeError(`${label} deve ser inteiro em centavos, recebi ${c}`);
}

export function formatBRL(c: Cents): string {
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(c);
  const reais = Math.floor(abs / 100);
  const cents = abs % 100;
  const intPart = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}R$ ${intPart},${String(cents).padStart(2, '0')}`;
}

/**
 * Lê texto de dinheiro no formato brasileiro ou simples.
 * "1.234,56" -> 123456 | "154,90" -> 15490 | "154.90" -> 15490 | "R$ 12" -> 1200
 * Retorna null se não for um valor reconhecível.
 */
export function parseMoneyBR(text: string): Cents | null {
  const t = text.replace(/R\$/gi, '').replace(/\s/g, '');
  if (!t) return null;
  // 1.234,56  (milhar com ponto, decimal com vírgula)
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) {
    return toCents(parseFloat(t.replace(/\./g, '').replace(',', '.')));
  }
  // 1234,56 ou 154,9
  if (/^\d+,\d{1,2}$/.test(t)) return toCents(parseFloat(t.replace(',', '.')));
  // 154.90 (ponto decimal, até 2 casas) ou inteiro
  if (/^\d+(\.\d{1,2})?$/.test(t)) return toCents(parseFloat(t));
  return null;
}

/** Divide um valor em `n` partes que somam exatamente o total (sobra vai para as primeiras). */
export function splitCents(total: Cents, n: number): Cents[] {
  assertCents(total);
  if (!Number.isInteger(n) || n <= 0) throw new RangeError('n deve ser inteiro positivo');
  const base = Math.trunc(total / n);
  let resto = total - base * n;
  const step = resto >= 0 ? 1 : -1;
  return Array.from({ length: n }, () => {
    if (resto !== 0) {
      resto -= step;
      return base + step;
    }
    return base;
  });
}
