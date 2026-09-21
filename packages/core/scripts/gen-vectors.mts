import { proximoVencimento, addDays } from '../src/index';
import { writeFileSync } from 'node:fs';
const freqs = ['semanal','quinzenal','mensal','bimestral','trimestral','semestral','anual','personalizado'];
const dias: (number|string|null)[] = [null, null, 1, 5, 15, 28, 29, 30, 31, 'ultimo'];
const casos: any[] = [];
let seed = 12345; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let i = 0; i < 600; i++) {
  const ultima = addDays('2023-01-01', rnd(1400));
  const hoje = addDays(ultima, rnd(900) - 30);
  const freq = freqs[rnd(freqs.length)]!;
  const venceDia = dias[rnd(dias.length)] ?? null;
  const intervalo = 1 + rnd(90);
  casos.push({ ultima, hoje, frequencia: freq, venceDia, intervaloDias: intervalo, esperado: proximoVencimento(ultima, freq, hoje, { venceDia: venceDia as never, intervaloDias: intervalo }) });
}
// bordas conhecidas
for (const [u,h,f,d] of [['2026-01-31','2026-02-28','mensal',null],['2026-01-31','2026-03-31','mensal',null],['2028-01-31','2028-02-10','mensal',null],['2023-01-02','2026-09-18','semanal',null],['2026-08-31','2026-09-30','mensal','ultimo'],['2026-11-30','2026-11-30','anual',null]] as const)
  casos.push({ ultima: u, hoje: h, frequencia: f, venceDia: d, intervaloDias: 15, esperado: proximoVencimento(u, f, h, { venceDia: d as never, intervaloDias: 15 }) });
writeFileSync(new URL('../../../shared/recurrence_vectors.json', import.meta.url), JSON.stringify({ _doc: 'Gerado por packages/core (scripts/gen-vectors). Python precisa produzir as mesmas datas.', casos }, null, 0) + '\n');
console.log(casos.length, 'casos');
