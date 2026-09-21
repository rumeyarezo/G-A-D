import { formatBRL, hojeSaoPaulo, monthKey, parseQuickEntry } from '@grana/core';

// Esqueleto: prova que o front-end consome as MESMAS regras do núcleo testado.
// A migração das telas do HTML original entra aqui, sem reescrever regra financeira.
const hoje = hojeSaoPaulo();
const rascunho = parseQuickEntry('Uber 32,90 ontem', hoje, []);
const app = document.getElementById('app');
if (app) app.textContent = `Grana a Dois — ${monthKey(hoje)} — exemplo: ${rascunho.desc} ${formatBRL(rascunho.valor)} em ${rascunho.data}`;
