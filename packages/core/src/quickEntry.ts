import { addDays, type ISODate } from './dates';
import { parseMoneyBR, type Cents } from './money';
import type { Conta } from './types';

import rules from '../../../shared/rules.json';

/**
 * As regras vêm de shared/rules.json (lido também pelo serviço Python), para nunca divergirem.
 * Mesmas regras do app original, exceto `nu\b` -> `\bnu\b`: o original casava dentro de palavras
 * ("me*nu*", "geni*nu*") e atribuía Nubank sem querer.
 */
const build = <T extends unknown[]>(lista: readonly (readonly [string, ...T])[]) =>
  lista.map(([pattern, ...resto]) => [new RegExp(pattern, 'i'), ...resto] as const);

export const AUTO_CAT_RULES = build(rules.categoria as [string, string, string][]);
export const AUTO_FORMA_RULES = build(rules.forma as [string, string][]);
export const BANK_ALIASES = build(rules.banco as [string, string][]);

export function sugerirCategoria(desc: string): { catId: string; sub: string } | null {
  const m = AUTO_CAT_RULES.find((r) => r[0].test(desc || ''));
  return m ? { catId: m[1], sub: m[2] } : null;
}

export function sugerirForma(desc: string): string | null {
  const m = AUTO_FORMA_RULES.find((r) => r[0].test(desc || ''));
  return m ? m[1] : null;
}

export function sugerirConta(desc: string, contas: readonly Conta[]): string | null {
  const m = BANK_ALIASES.find((r) => r[0].test(desc || ''));
  if (!m) return null;
  return contas.find((c) => c.banco === m[1])?.id ?? null;
}

const stripKeyword = (text: string, re: RegExp) => text.replace(re, ' ').replace(/\s{2,}/g, ' ').trim();

export interface RascunhoLancamento {
  desc: string;
  valor: Cents;
  data: ISODate;
  catId: string | null;
  sub: string | null;
  forma: string | null;
  contaId: string | null;
}

// "1.234,56" | "154,90" | "154.90" | "154" — sempre no FIM do texto
const VALOR_FINAL = /(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*$/;

/**
 * Transforma "Uber 32,90 ontem" em um rascunho de lançamento.
 * `hoje` é injetado (o original fixava 2026-09-18 e por isso "ontem" ficava errado em qualquer outro dia).
 */
export function parseQuickEntry(raw: string, hoje: ISODate, contas: readonly Conta[]): RascunhoLancamento {
  let text = raw.trim();
  let data = hoje;
  if (/anteontem/i.test(text)) {
    data = addDays(hoje, -2);
    text = stripKeyword(text, /anteontem/i);
  } else if (/ontem/i.test(text)) {
    data = addDays(hoje, -1);
    text = stripKeyword(text, /ontem/i);
  } else if (/hoje/i.test(text)) {
    text = stripKeyword(text, /hoje/i);
  }

  const forma = sugerirForma(text);
  if (forma) text = stripKeyword(text, AUTO_FORMA_RULES.find((r) => r[1] === forma)![0]);

  const bankMatch = BANK_ALIASES.find((r) => r[0].test(text));
  let contaId: string | null = null;
  if (bankMatch) {
    contaId = sugerirConta(text, contas);
    if (contaId) text = stripKeyword(text, bankMatch[0]);
  }

  let valor: Cents = 0;
  const m = VALOR_FINAL.exec(text);
  if (m) {
    valor = parseMoneyBR(m[1] as string) ?? 0;
    text = text.slice(0, m.index).trim();
  } else {
    text = stripKeyword(text, /\b(reais|r\$)\b/i);
  }

  const desc = text.replace(/\s{2,}/g, ' ').trim() || 'Lançamento';
  const sug = sugerirCategoria(desc);
  return { desc, valor, data, catId: sug?.catId ?? null, sub: sug?.sub ?? null, forma: forma ?? null, contaId };
}
