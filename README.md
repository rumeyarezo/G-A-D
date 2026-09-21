# Grana a Dois

Finanças de casal. Monorepo com três camadas, cada uma no que a linguagem faz melhor.

| Pasta | Linguagem | Papel |
|---|---|---|
| `packages/core` | TypeScript | Regras financeiras (saldo, fatura, recorrência, transferência, relatórios). Fonte única da verdade. |
| `apps/web` | TypeScript + Vite | Interface. Só consome `@grana/core`, Supabase (com RLS) e a API Python. |
| `services/api` | Python (FastAPI) | Importação de extratos OFX/CSV e projeção de saldo. Sem acesso ao banco: só valida o JWT. |
| `supabase/migrations` | SQL | Esquema relacional, RLS, views de saldo/fatura, backfill, endurecimento de segurança. |
| `shared` | JSON | Regras e vetores de teste lidos por TS **e** Python, para não divergirem. |

## Como rodar os testes

```bash
npm install && npm test                         # 52 testes TS (unidade, paridade com o app original, propriedades)
cd services/api && python -m pytest -q          # 43 testes Python
bash supabase/tests/run.sh                      # suíte SQL em um Postgres 16 descartável
```

## Regras que valem em todo o sistema

- Dinheiro em **centavos inteiros** (nunca float).
- Saldo de conta e fatura de cartão são **derivados** das transações; só transação **paga** move saldo.
- Compra no crédito vai para a fatura, não para a conta. Transferência conserva o total.
- `pagamento_fatura` debita uma conta e reduz a fatura, e **não** conta como despesa.
- Datas em ISO (UTC puro); "hoje" é sempre injetado.

Detalhes e decisões: `docs/DECISOES.md`.
