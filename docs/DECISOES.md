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

## Rodada 8
- Listas suspensas: todo <select> (menos .no-dd) e envolvido por um botao arredondado; o select nativo continua no DOM (opacity 0) mantendo value/selectedIndex/eventos (propriedades sobrescritas na instancia + MutationObserver). Opcoes abrem numa folha fixa (bottom-sheet no celular, centrada no desktop) com busca quando ha mais de 7 opcoes; Esc fecha so a folha.
- Formulario de lancamento: mesmos ids/handlers; so o markup mudou (hero de valor + secoes .lanc-sec com icones .fic). Icones novos em ICONS.
- Sem movimento lateral: html{touch-action:pan-y}; excecoes com pan-x nas faixas que rolam (bottom-nav, tabelas, filtros). Inputs 16px em ponteiro grosso (iOS nao da zoom ao focar).
- Meu perfil e o ultimo de NAV_ITEMS.
- Area do empreendedor: estado.empresas[caio|marina] = {razao,cnpj,banco,agencia,conta,tipoConta,pix[],qr,qrRotulo}. Cada pessoa ve/edita so a sua (mesma limitacao da separacao pela interface: o JSON e unico por household). CNPJ com mascara e digitos verificadores; QR reduzido a 640px (JPEG) sem cortar; sanEmpresa valida tudo ao carregar. Backup leva a empresa de quem baixou; zerar conta NAO apaga a empresa.

## Rodada 9
- Cartao: continua tipo 'credito'|'debito' (toda a logica de fatura/limite intacta). "Debito e Credito" = tipo 'credito' + debito:true (+ contaId para o debito). Novos campos: final (so 4 digitos; numero completo nunca e guardado), cor, padrao, adicionais[{nome,final}]; lancamento no credito ganha "Quem usou o cartao" (t.adicional) quando ha adicionais. Debito puro: limiteBase 0, sem datas; nao cria mais conta automatica, usa a conta escolhida.
- Conta: novos campos tipoConta, grupo (pf|pj|inv), cor, limiteEspecial (informativo, fora do saldo e do patrimonio), ativa (undefined = true). Inativa: fora das listas de lancamento/baixa/comandos e do saldo total; historico e mantido. Editar conta reutiliza a mesma janela (saldo so via Ajustar saldo).
- abrirFormModal: janela generica com preview (usada por cartao e conta). Open Finance: view placeholder, nav depois de Investimentos. --sidebar-w 236 -> 212.

## Rodada 10
- Atividades: log por diff (registrarDiff compara o snapshot estavel anterior/atual em checarMudanca) -> entradas {id,ts,quem,dono,tipo,ent,titulo,detalhe,comp,disp,mud[{c,de,para}]}. So campos mapeados em ATIV_CAMPOS contam (saldo derivado, fatura, historico do cofrinho nao). Guarda 400 entradas / 90 dias em estado.atividades. Desfazer remove as atividades do lote. Visibilidade: so as suas, as compartilhadas (comp) e as de sistema suas - de novo, nivel de interface (o JSON e unico por household).
- Seguranca: bloqueio por biometria = WebAuthn com autenticador da plataforma (userVerification required), credencial guardada em localStorage (grana-bio-<uid>). E um bloqueio LOCAL do aparelho, nao validado no servidor. 2FA = TOTP do Supabase Auth (sb.auth.mfa.*): precisa de MFA habilitado nas configuracoes de Auth do projeto; nao testado contra o Supabase real (testes usam mock). Trocar senha: reautentica com signInWithPassword e depois updateUser. "Sair dos outros aparelhos" = signOut({scope:'others'}). Lista de aparelhos = registro proprio em estado.dispositivos (sem IP; nao lista sessoes reais).
- Relatorios: efetivadas = status 'pago'; ignora lancamentos "Pagamento fatura ..." (evita contar duas vezes a compra no credito e o pagamento). Filtro Geral/PF/PJ/Investimentos pelo grupo da conta (cartao usa a conta dele). Graficos em SVG puro, sem biblioteca. Exporta CSV.
- Fonte dos numeros: Inter com tabular-nums (variavel --font-mono mantida por compatibilidade).

## Rodada 11
- Bloqueio: localStorage grana-ativo-<uid> guarda a ultima atividade (toque/tecla/rolagem, batimento de 20s, pagehide). Ao abrir/voltar, so bloqueia se ficou fora mais que c.espera (padrao 300s; configs antigas migradas para 300 via v:2). Continua sendo bloqueio local do aparelho.
- Listas de compra: estado.compras = {listas:[{id,nome,tipo,dono,comp}], itens:[...]}. Lista 'l_mercado' (compartilhada) e o catalogo geral; "lista de compras" = itens com precisa:true. Categoria obrigatoria no Mercado (5 fixas); item criado pela barra entra sem categoria e abre modal sem botao de fechar ate escolher. Outras listas: prioridade, preco sugerido, sem categoria. Visibilidade por interface (dono/comp), como o resto.
- Precos: precoAtual (digitado), precoUltimo, precos[] (historico). Ao voltar ao carrinho ou em "Atualizar preco", o atual passa a ultimo e entra no historico; media = historico + atual. Concluir compra tira os comprados da lista e mantem o valor pago.
- Barra: comandos 'receber' (recebi/receber/recebimento/salario no inicio) e 'comprar' (precisa comprar, precisamos, comprar, falta, acabou). Itens separados por virgula, ";" ou " e "; aceita quantidade/unidade (2 leite, 2kg de banana). Casamento por nome normalizado (singular/plural); ambiguo pergunta.

## Rodada 12
- Pagar/Receber: abrirBaixaModal (valor, juros/multa, data <= hoje, conta). Baixa parcial cria um clone pago (data = pagamento) e deixa o resto pendente; quitacao mantem `data` (vencimento) e grava `pagoEm`. Juros viram lancamento a parte (despesa em "Dividas e taxas > Juros e multas", ou receita "Juros recebidos"). Fatura de cartao usa a mesma janela (parcial reduz faturaAtual). Relatorios contam pela data `pagoEm||data`; as demais telas continuam por `data` (competencia).
- Listas: item ganha `levando` (mesma unidade do preco), `promo`, `promoUltimo`. Ao marcar o check sem levando, usa a quantidade planejada. Subtotal = round2(levando × precoAtual); "Ja no carrinho" = soma dos marcados, atualizada a cada tecla sem re-renderizar (re-render tirava o foco ao trocar de campo). Promocao do preco atual vira `promoUltimo` quando o preco desloca para "ultimo".
- Notificacoes: `lidas:[user]` por pessoa; selo so conta nao lidas; lista e historico mantem as ultimas 20 (NOTIF_MAX).

## Rodada 13
- Compartilhar lista: botao no cabecalho de Listas de compra. textoLista() monta texto (Mercado: so os itens "Precisa comprar" por categoria, com check e total estimado; outras: prioridade e preco). Usa navigator.share quando existe, mais WhatsApp (wa.me) e Copiar. Em lista individual o modal tambem tem a chave "visivel para o parceiro" (lista.comp).

## Rodada 14
- Busca sem resultado (Mercado ou lista propria) mostra "Adicionar '<texto>' agora": abre o modal de item ja com o nome preenchido (abrirItemModal com opc.nome), fecha a busca ao salvar. No Mercado a categoria continua obrigatoria (mesma regra ja existente).
- Itens marcados ("comprado") saem dos grupos por categoria e vao para um bloco "Comprados" ao final da lista (renderListas separa pend/don antes de montar o HTML); no Mercado o bloco "Comprados" fica ordenado por categoria+nome, sem subdivisao. Filtro rapido lsFiltro ('todos'|'falta'|'carrinho') some por cima do resumo quando a lista/aba tem itens; reseta para 'todos' ao trocar de lista ou aba. Marcar/desmarcar o check agora chama renderListas() (antes so patchava via vivo()) para reordenar na hora.
- Estoque em casa: campo numerico opcional (estoque) nos itens do Mercado, editavel direto na linha do catalogo (input, como o "Valor atual") e tambem no modal de novo/editar item. So aparece nos itens do Mercado (faz sentido nas demais listas? decidimos que nao, sao itens avulsos sem recompra). Sem alerta automatico de estoque baixo (fora do pedido); so o numero fica destacado em vermelho quando chega a zero.
- Comando "Compra no Pix" (barra de lancamento): mesma familia do "Compra no debito", mas sem cartao - sempre sai direto de uma conta (contasAtivas()). Reaproveita cmdCompra com tipoCartao='pix'; forma da transacao = 'Pix', contaId da conta escolhida.

## Rodada 15 - correcao de bug (perda silenciosa de dados)
- **Bug encontrado**: Caio relatou uma lista de compras criada que "sumiu". Conferido direto no Supabase (estado.compras do household): a lista realmente nunca chegou a ser salva - nao era bug de tela.
- **Causa**: estado.compras/categorias/contas/... e um unico JSON (`grana_households.estado`), salvo por inteiro a cada mudanca (`persistState`, debounce de 600ms) e trazido por inteiro quando a nuvem muda (realtime `postgres_changes` ou `resolverConflito` apos a gravacao com controle otimista por `_ts` falhar). `aplicarEstadoDaNuvem` chamava `applyStateSnapshot` que SUBSTITUiA cada colecao inteira pela versao da nuvem. Se algo era criado localmente (ex.: nova lista) e, antes do debounce salvar, chegava uma atualizacao da nuvem (outro aparelho/aba salvando qualquer coisa, mesmo sem relacao), o estado local era todo sobrescrito e o item recem-criado - que so existia em memoria - desaparecia sem nenhum aviso de erro (so o toast normal "Dados atualizados").
- **Correcao**: `applyStateSnapshot(s, mesclarComLocal)` agora aceita mesclar; quando `mesclarComLocal` e verdadeiro (chamado por `aplicarEstadoDaNuvem` sempre que `estadoCarregado` ja era true, ou seja, fora da primeira leitura), cada colecao por id (categorias, contas, cartoes, cofrinhos, investimentos, metas, transacoes, compras.listas, compras.itens) passa por `mesclarPorId`: mantem a nuvem como base e devolve pra frente qualquer item que so existe localmente (recem-criado, ainda sem salvar). A nuvem sempre vence em caso de edicao do MESMO item nos dois lados (nao virou um CRDT completo); o que muda e que um item NOVO nunca e descartado sem nunca ter sido salvo. Quando a mesclagem recupera algo, `aplicarEstadoDaNuvem` forca `ultimoSalvoJson=''` e chama `schedulePersist()` de novo, para o item recuperado realmente chegar ao servidor (senao ficava so na tela ate a proxima mudanca qualquer). `atividades`/`dispositivos`/`notificacoes` continuam substituicao direta (tem logica propria de ordem/corte que a mescla quebraria). O desfazer (`applyStateSnapshot` chamado sem o 2o parametro, em `desfazerPara`) continua substituindo de verdade - e o unico caso em que "voltar exatamente pro estado anterior" e o comportamento certo.
- **O que nao cobre**: dois aparelhos editando o MESMO item ao mesmo tempo ainda e last-write-wins (a nuvem vence, sem merge de campos). So a perda de um item inteiro recem-criado e que foi eliminada.
- Teste: `r15.py` reproduz a corrida exata (cria lista/item, dispara `schedulePersist`, e simula a chegada da nuvem antes do debounce) e confere que o item sobrevive, que a mudanca genuina da nuvem tambem e aplicada, que ele realmente chega a ser salvo no servidor (via `srv.patches`), e que o desfazer continua substituindo de verdade.

## Rodada 16 - ajustes de usabilidade (botao de lancamento e biometria)
- **Pedido do Caio**: botao "Registrar lancamento" preenchido de vermelho/verde (nao so um tom clarinho); biometria/PIN pedida SEMPRE que o app e fechado e reaberto.
- **Botao de lancamento**: o botao ja usava `--good-soft`/`--critical-soft` (fundo pastel ~9-10% de opacidade) para receita/despesa - so um tom, nao um preenchimento solido, exatamente o que o Caio apontou. `--good`/`--critical` (as variaveis de cor de texto) nao servem para virar fundo solido com texto branco fixo: elas invertem de brilho entre o modo claro e o escuro de proposito (para continuarem legiveis como texto sobre o fundo da pagina), entao um botao solido com essas cores ficaria ilegivel ou mudaria de tom sozinho ao trocar de tema. Criadas duas variaveis novas, fixas (nao variam por tema, ao contrario de `--good`/`--critical`): `--good-fill`/`--on-good-fill` e `--critical-fill`/`--on-critical-fill`, e duas classes `.btn-rc` (receita, verde solido) e `.btn-ds` (despesa, vermelho solido) que substituem o estilo inline antigo no botao de enviar (`renderLancamentoForm`). O botao de transferencia (azul) nao foi mexido - o pedido foi so sobre despesa/receita.
- **Biometria sempre ao reabrir**: existiam dois gatilhos distintos - `iniciarSessaoReal` (chamado uma vez por carregamento novo da pagina, ou seja, app fechado e reaberto de verdade) e o listener de `visibilitychange` (app so foi para segundo plano dentro da MESMA sessao, ex.: trocar de aba). So o primeiro usava `precisaBloquearAoAbrir()` (que respeita a "espera" configuravel, padrao 5 min) antes de decidir bloquear - ou seja, se o Caio fechasse e abrisse o app de novo antes da espera configurada passar, nao pedia biometria. Isso foi trocado: `iniciarSessaoReal` agora sempre chama `mostrarBloqueio()` quando a biometria esta ativada (sem checar `precisaBloquearAoAbrir()`), exceto logo apos o proprio login com senha (`opc.senhaAgora`, que ja e uma confirmacao de identidade). O listener de `visibilitychange` continua exatamente como antes, respeitando a espera configuravel - essa opcao (Configuracoes > Seguranca > "pedir de novo depois de") agora vale so para o app ficar em segundo plano com a pagina ainda aberta, nunca mais para fechar-e-reabrir. Texto da tela de Seguranca atualizado para explicar essa diferenca.
- Teste: `r16.py` confere o `background-color` computado do botao de lancamento em despesa (`rgb(185, 28, 28)`) e receita (`rgb(21, 128, 61)`, texto branco); e confere que a tela de bloqueio aparece ao recarregar a pagina mesmo com a espera configurada no maximo (15 min) e o uso tendo sido ha poucos segundos, que ela nao desaparece sozinha sem confirmacao valida, e que desbloqueia normalmente ao confirmar a biometria de verdade.

## Rodada 17 - corrige loop do aviso de atualizacao (pos-migracao Cloudflare)
- **Pedido do Caio**: o aviso "Nova versao do Grana a Dois" aparecia, ele clicava em "Atualizar agora", e o mesmo aviso voltava poucos segundos depois - em loop.
- **Causa raiz (a mais grave)**: nos primeiros commits da migracao para Cloudflare, `dist/index.html` foi corrigido no GitHub com *patches cirurgicos de texto* (trocar so o dominio do Netlify, por exemplo) em vez de um `build.py` completo. Isso deixou a marca `window.GRANA_BUILD={v:...}` embutida no `<head>` do HTML publicado **congelada na Rodada 15** (`1d461f7dba`), mesmo depois de 3 deploys que mudaram `dist/versao.json` para hashes mais novos. Resultado: `BUILD_ATUAL` (lido dessa marca, no navegador) nunca batia com `versao.json` - o app achava, para sempre, que havia uma versao nova, nao importa quantas vezes recarregasse.
- **Causa secundaria (agrava o sintoma)**: mesmo com as duas marcas sincronizadas, a Cloudflare pode levar alguns segundos para propagar um deploy novo para todas as suas bordas; um `location.reload()` logo em seguida podia cair numa borda ainda desatualizada.
- **Correcao**:
  1. `dist/index.html`, `dist/versao.json` e `dist/sw.js` foram ressincronizados manualmente para o mesmo hash (`4f52d6dcb9`), e `apps/site/app.body.html` no GitHub (que tambem estava com uma funcao antiga - `notasHtml` cortava em 3 notas, nao 6) foi reconstruido a partir do `dist/index.html` correto e recolocado em sincronia com o codigo-fonte local.
  2. `aplicarAtualizacao()` agora guarda em `sessionStorage` qual versao esta esperando antes de recarregar; ao carregar de novo, `conferirUpdPendente()` confere em silencio (sem reabrir o aviso) por ate ~15s (5 tentativas de 3s, dando tempo pra Cloudflare propagar) antes de desistir e voltar ao fluxo normal. O botao "Atualizar agora" tambem passa a mostrar "Atualizando..." e fica desabilitado no clique, pra dar retorno imediato.
  3. Criado `apps/site/verificar_deploy.py`: depois de QUALQUER deploy (manual ou por push), roda esse script contra a URL publicada - ele confere `versao.json` E o `window.GRANA_BUILD` embutido no `index.html` ao vivo contra o hash local, com novas tentativas e espera crescente, e so retorna sucesso (exit 0) quando os dois baterem de verdade. Nunca mais declarar um deploy "concluido" so porque o build da Cloudflare terminou com sucesso - o build passar nao significa que o conteudo publicado esta correto (foi exatamente esse o caso aqui: o build "succeeded" nas 3 tentativas anteriores, servindo a versao errada o tempo todo).
- Regra daqui pra frente: qualquer alteracao em `apps/site/dist/` **tem que vir de um `python3 build.py` completo local** (nunca um patch de texto direto no `dist/index.html` publicado) - e todo deploy termina com `python3 verificar_deploy.py` antes de avisar o Caio que "esta no ar".

## Rodada 18 - segundo bug encontrado na verificacao (marca de versao certa, conteudo errado) + Enter nas Listas de compra

- **O que a verificacao dupla encontrou**: ao comecar a Rodada 18, antes de mexer em qualquer coisa nova, foi comparado o `apps/site/app.body.html` publicado no GitHub contra o arquivo local - e eles nao batiam. O GitHub estava sem 4 trechos da Rodada 16 (as variaveis `--good-fill`/`--critical-fill`, as classes `.btn-rc`/`.btn-ds`, a remocao de `precisaBloquearAoAbrir()` do fechar-e-reabrir, e o texto novo da tela de Seguranca). O `dist/index.html` publicado tambem estava sem essas mudancas - mas a marca `window.GRANA_BUILD` embutida nele, e o `versao.json`, diziam `v: "4f52d6dcb9"`, exatamente o hash que o build correto (com as mudancas) tambem calcula. Ou seja: a marca de versao batia, mas o conteudo publicado de verdade era outro. Confirmado tambem ao vivo (`curl` no site publicado): sem `btn-ds`/`btn-rc`, biometria ainda com a checagem antiga.
- **Causa**: no fechamento emergencial da Rodada 17 (commit "root-cause fix"), o `dist/index.html` publicado foi montado copiando um HTML que nao passou pelo `build.py` completo contra o `app.body.html` certo - so a marca de versao e o `versao.json` foram escritos com o valor correto. Isso quebra a premissa inteira do sistema de versao (o hash so significa algo se for calculado de verdade a partir do conteudo).
- **Correcao**: reconstruido o `app.body.html` a partir do arquivo local (confirmado, com hash proprio, como a fonte certa - continha as 4 mudancas da Rodada 16 que faltavam no GitHub), rodado o `build.py` de verdade, e publicados `app.body.html`, `dist/index.html`, `dist/versao.json` e `dist/sw.js` juntos no mesmo commit. Toda a comparacao foi feita por hash (sha256) antes de publicar, nao so visualmente.
- **`verificar_deploy.py` reforcado**: ate a Rodada 17 ele so conferia se a marca de versao batia (`versao.json` e o `window.GRANA_BUILD` embutido). Isso NAO pega o defeito acima, porque a marca podia bater com o conteudo errado. Agora o script tambem baixa o HTML publicado e compara **byte a byte** com o `dist/index.html` local - so passa (exit 0) quando os tres batem: `versao.json`, a marca embutida E o corpo inteiro do HTML.
- **Pedido do Caio - Listas de Compras**: ao digitar o nome de um item que nao existe na busca, Enter deve mandar adicionar o item novo (abrir a tela de cadastro) e Enter de novo deve salvar como estiver preenchido.
  - Na caixa de busca (`#ls-busca`): Enter aciona o mesmo botao "Adicionar '...' agora" que ja aparecia quando a busca nao encontra nada (`#ls-add-busca`), abrindo `abrirItemModal` com o nome ja preenchido. Se a busca tem resultado, Enter nao faz nada (nao havia pedido pra esse caso).
  - Dentro do modal de item (`abrirItemModal`): Enter em qualquer campo de texto (nome, quantidade, valores, observacao, estoque) aciona o mesmo botao "Salvar" (`#it-ok`), com a mesma validacao de sempre (nome obrigatorio; categoria obrigatoria no Mercado). Enter e ignorado quando o foco esta num botao (os seletores arredondados de categoria/prioridade/unidade da Rodada 8 sao `<button>`, nao `<select>`) ou enquanto a folha do seletor esta aberta - pra nao atrapalhar quem esta escolhendo uma opcao com o teclado.
- Teste manual: buscar um item inexistente no Mercado, Enter abre a tela ja com o nome preenchido e o foco na categoria (obrigatoria); numa lista sem categoria, Enter abre com o foco no nome e Enter de novo salva direto.
