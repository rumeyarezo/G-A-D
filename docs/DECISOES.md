# Decisões e diferenças em relação ao app original

## Por que três linguagens
- **TypeScript**: regra financeira roda no navegador (resposta instantânea) e é testada uma vez só.
- **Python**: leitura de extratos (OFX/CSV) e projeções; ecossistema forte para dados.
- **SQL (Postgres)**: garantia final de integridade (chaves compostas, CHECKs, RLS) mesmo se o front errar.

## Comportamentos corrigidos (o original tinha erro)
1. Pagar fatura zerava a fatura sem debitar conta alguma e ainda contava como despesa (dupla contagem). Agora é `pagamento_fatura`: aparece no extrato como saída da conta e no histórico (`pagamentosDeFatura`: data, valor, quitada/parcial), com total próprio (`faturasPagasNoMes`), mas fica fora de `totaisDoMes().despesas` porque as compras já foram contadas.
2. Recorrência mensal: 31/jan virava 28/fev e ficava no 28 para sempre; passava de 80 passos e devolvia data no passado; semanas em milissegundos.
3. Lançamento rápido: "ontem" fixo em 2026-09-18; separador de milhar; `nu` casava dentro de "menu".
4. Anomalias, previsão e vencimento de fatura usavam setembro/2026 fixo; agora usam o "hoje" real.
5. Dinheiro em float (44,90 + 0,10 ≠ 45,00); agora centavos inteiros.

## Como se garante que "funciona perfeitamente"
- Testes de paridade: o JS do app original roda num sandbox e é comparado com o TS novo (propriedades com fast-check).
- Teste baseado em modelo: contabilidade imperativa do original × razão derivada.
- Teste de mutação manual: 7 mutações injetadas, todas detectadas.
- Vetores compartilhados (606 casos de recorrência) verificados em TS e Python; cenários idênticos em TS e SQL.

## Banco de dados
O Grana a Dois agora tem projeto Supabase PRÓPRIO (`grana-a-dois`, região sa-east-1), separado do projeto que guarda o Acervo dos Rezos (`cifrario_*`).
Migrações 0000 (base), 0001, 0002, 0003 e 0004 foram aplicadas no projeto novo (vazio). Teste de fumaça com rollback: saldo 980000, fatura 30000, CHECK de compra no crédito bloqueou conta, dono criado pelo gatilho.
O projeto antigo NÃO foi alterado: o app atual continua funcionando lá até a virada.
Pendente: criar os logins no projeto novo e copiar o estado antigo com `grana_migrar_estado`.

## Limitações conhecidas
- Telas do HTML original (~3500 linhas) ainda não foram portadas para `apps/web`.
- Verificação JWKS (ES256/RS256) não foi testada contra um Supabase real.

## Contas novas zeradas e "zerar dados" (migrações 0005 e 0006)

- Toda conta (household) nova nasce só com as 20 categorias essenciais: contas, cartões, lançamentos, metas e investimentos começam vazios. Isso é garantido por um gatilho no banco, não pelo app.
- `grana_zerar_household()` (só o dono da conta) apaga movimentações e cadastros financeiros e mantém categorias e membros. Membro e usuário anônimo são recusados (testado em `supabase/tests/test_seed.sql`).
- Aplicadas apenas no projeto novo (`grana-a-dois`); o projeto antigo não foi tocado.

## Site instalável (apps/site)

- `python3 apps/site/make_icons.py` gera os ícones e `python3 apps/site/build.py` monta `apps/site/dist` (manifest, service worker, supabase-js local). `dist` é versionado para poder ser publicado direto (Netlify, Vercel, Cloudflare Pages).
- O app usa hoje o Supabase antigo (estado em JSON); a troca para o esquema relacional novo é um passo à parte.

## Ajustes de usabilidade e notificações (set/2026)
- Zoom fixo: viewport travado (sem pinça) e `zoom` CSS de 110% por padrão, ajustável em Configurações > Aparência (100–150%). Elementos `fixed`/`getBoundingClientRect` compensam o zoom (`zoomAtual()`).
- Barra inferior 40% maior e fixa; botão "Adicionar" acima dela. Sem rolagem lateral (grids com `min-width:0`, linhas de lançamento em grid no celular).
- Todo botão só com ícone ganha nome visível (topo, tour, modais; ações de linha via `rotularBotoes()`).
- "Meu perfil" virou a primeira opção do menu (avatar com iniciais + view própria); saiu do topo.
- Notificações no dispositivo: permissão ao abrir, avisos de lançamentos/pagamentos do parceiro (diff de `notificacoes` por `por`/`id`, com baseline no primeiro uso), vencimentos do dia (despesas pendentes e faturas), preferências em localStorage. Limite: sem servidor de push, só com o app aberto/segundo plano.

## Rodada 3
- Atualizacoes via versao.json + aviso + notificacao; schema versionado (migrarEstado) para nao exigir novas contas.
- Motor de indices BCB no app (localStorage grana-indices, refresh 12h/hora aberta).
- Parser de texto: qualquer numero vira valor; receber/recebimento abre em modo receita.
- Status de receita: Recebido / A receber / A receber - Em atraso; botao Receber.
- Desfazer 2s por diff de snapshot; categorias/subcategorias criadas no lancamento; zoom por select.

## Rodada 3b — Web Push
- Supabase (projeto grana-a-dois): tabelas grana_push_subs (assinaturas + prefs) e grana_push_config (chaves VAPID e segredo do cron; RLS ligado, sem políticas = só service role).
- Edge Function `grana-push` (verify_jwt desligado; autenticação própria: JWT do usuário ou header x-cron-secret). Ações: chave, assinar, cancelar, teste, parceiro. Modo cron: avisa vencimentos/recebimentos do dia.
- pg_cron `grana-push-vencimentos` às 11:00 UTC (8h de Brasília) chama a função via pg_net.
- App: sw.js trata o evento push; com push ativo, os avisos locais de parceiro/vencimento são suprimidos para não duplicar.
- Fonte da função vive no Supabase (não está no repositório).

## Rodada 4
- Convites para quem ja tem conta: RPCs grana_aceitar_convite / grana_recusar_convite (security definer), coluna grana_convites.de_nome, modal no app, push 'convidar'. Nenhum dado e apagado: o grupo antigo do convidado fica guardado.
- Comandos por texto (botao +): parser com correspondencia fuzzy por nome; confirmacao antes de alterar saldo/cofrinho/pagamento; compras abrem o popup ja preenchido.
- Menu do FAB no mobile: regra de posicao movida para depois das regras base (a media query estava sendo sobrescrita).
- Fonte da funcao grana-push agora versionada em supabase/functions/grana-push/index.ts.

## Rodada 5
- Modelo individual x compartilhado (dono + compartilhada) em contas, cartoes, cofrinhos, metas e categorias; lancamentos por pessoa/criadoPor/compartilhada. Itens do outro ficam em OCULTOS e voltam intactos ao salvar. Saldo derivado usa todos os lancamentos.
- Limite conhecido: a separacao e da interface; o JSON de estado continua unico por household (isolamento no servidor exigiria estado por pessoa).
- Baixa de despesa/receita: quem paga escolhe a conta (pedirBaixa); conta individual do outro nunca e alterada; parceiro e avisado se o item e compartilhado.
- Logo do topo (mobile) = sincronizar (versao nova + estado da nuvem + convites/indices/push). Zoom padrao 100%.

## Rodada 6
- Cabecalho enxuto: tema, "Salvo" e pill de compartilhamento foram para Meu perfil; #sync-badge continua no cabecalho so para erro/conflito.
- Foto de perfil: canvas, corte central, 256x256 JPEG q0.82, guardada em estado.fotos[usuario] (validada por regex data:image).
- Backup = so o que a pessoa enxerga (proprios + compartilhados), marcado _backup:'grana-a-dois'. Restaurar substitui o visivel, preserva OCULTOS, itens nao compartilhados viram do restaurador; desfazer via checarMudanca.
- Zerar conta: transacoes/investimentos/notificacoes sempre apagados; itens mantidos zeram saldo (saldoInicial=-efeito), limiteBase/fatura/parcelas, cofrinho saldo/historico, meta atual. Itens compartilhados zeram para o parceiro tambem (ele e avisado). Botao de confirmar libera apos 9s.

## Rodada 7 (comentarios no artefato)
- Card "Despesas em aberto" no Inicio (lista com Pagar; alerta vermelho quando ha pendencia). Chips Despesa/Receita/Transferencia em grade de 3 colunas com fonte por container query.
- Sugestao de comandos ao digitar (sugerirComandos, #qp-sugg; setas/Tab/Enter).
- Notificacoes de bancos: PWA nao le notificacoes de outros apps. Entrada por ?notif=<texto> (MacroDroid/Tasker) ou Web Share Target (manifest); interpretarNotifBanco -> notificacao propria (data.nb) -> abrirRascunhoBanco abre o popup preenchido. Sem permissao: modal. iPhone: so pelo Compartilhar/Atalhos.
- Lembrete 3 dias sem lancar: cliente (verificarLembreteLancamentos, so sem push) + Edge Function grana-push v4 (rodarLembretes no cron diario, por pessoa, pref lembrar).
