// Grana a Dois — Web Push. Autenticação própria: JWT do usuário (app) ou segredo do agendador (cron).
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

let cfg: Record<string, string> | null = null;
async function config() {
  if (cfg) return cfg;
  const { data, error } = await admin.from('grana_push_config').select('chave,valor');
  if (error) throw error;
  cfg = Object.fromEntries((data ?? []).map((r: any) => [r.chave, r.valor]));
  webpush.setVapidDetails('https://g-a-d.grana-a-dois.workers.dev', cfg.vapid_public, cfg.vapid_private);
  return cfg;
}

async function enviar(subs: any[], payload: { titulo: string; corpo: string; view?: string; tag?: string }) {
  await config();
  let ok = 0, removidas = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 12, urgency: 'high' },
      );
      ok++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await admin.from('grana_push_subs').delete().eq('endpoint', s.endpoint);
        removidas++;
      } else console.error('push falhou', e?.statusCode, e?.body);
    }
  }));
  return { ok, removidas };
}

const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const brl = (n: number) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
// hora atual em SP, arredondada pra baixo nos 5 min (mesma granularidade do cron de horários agendados) e dia da semana (0=dom) em SP
function agoraSP() {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const obj = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  const semana: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const mm = Math.floor(Number(obj.minute) / 5) * 5;
  return { hhmm: `${obj.hour}:${String(mm).padStart(2, '0')}`, diaSemana: semana[obj.weekday] ?? 0 };
}

async function rodarVencimentos() {
  const hoje = hojeSP(), diaHoje = Number(hoje.slice(8));
  const { data: hhs } = await admin.from('grana_push_subs').select('household_id');
  const ids = [...new Set((hhs ?? []).map((r: any) => r.household_id))];
  const resumo: any[] = [];
  for (const id of ids) {
    const { data: h } = await admin.from('grana_households').select('estado').eq('id', id).single();
    const est: any = h?.estado ?? {};
    const itens: { rec: boolean; txt: string }[] = [];
    for (const t of est.transacoes ?? []) {
      if ((t.tipo === 'despesa' || t.tipo === 'receita') && (t.status === 'pendente' || t.status === 'atrasado') && t.data === hoje)
        itens.push({ rec: t.tipo === 'receita', txt: `${t.tipo === 'receita' ? 'A receber' : 'A pagar'}: ${t.desc ?? ''} — ${brl(t.valor)}` });
    }
    for (const c of est.cartoes ?? []) {
      if (c.tipo === 'crédito' && Number(c.vencimento) === diaHoje) itens.push({ rec: false, txt: `A pagar: fatura do cartão ${c.nome}` });
    }
    if (!itens.length) continue;
    const nR = itens.filter((i) => i.rec).length, nP = itens.length - nR;
    const titulo = itens.length === 1 ? (nR ? 'Recebimento previsto hoje' : 'Vence hoje')
      : (nR && nP ? `Hoje: ${nP} a pagar e ${nR} a receber` : (nR ? `${nR} recebimentos previstos hoje` : `${nP} contas vencem hoje`));
    const corpo = itens.slice(0, 3).map((i) => i.txt).join('\n') + (itens.length > 3 ? `\ne mais ${itens.length - 3}` : '');
    const { data: subs } = await admin.from('grana_push_subs').select('*').eq('household_id', id);
    const alvo = (subs ?? []).filter((s: any) => s.prefs?.venc !== false);
    resumo.push({ itens: itens.length, ...(await enviar(alvo, { titulo, corpo, view: 'agenda', tag: 'venc-' + hoje })) });
  }
  return resumo;
}

// Lembrete: mais de 3 dias sem lançar nenhuma despesa/receita (por pessoa; dono = 'caio', membro = 'marina').
async function rodarLembretes() {
  const hoje = hojeSP();
  const dias = (a: string, b: string) => Math.floor((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 864e5);
  const { data: todas } = await admin.from('grana_push_subs').select('*');
  const porHH = new Map<string, any[]>();
  for (const s of todas ?? []) { if (!porHH.has(s.household_id)) porHH.set(s.household_id, []); porHH.get(s.household_id)!.push(s); }
  const resumo: any[] = [];
  for (const [id, subs] of porHH) {
    const { data: h } = await admin.from('grana_households').select('estado').eq('id', id).single();
    const { data: perfis } = await admin.from('grana_profiles').select('id,papel').eq('household_id', id);
    const est: any = h?.estado ?? {};
    const txs = (est.transacoes ?? []).filter((t: any) => (t.tipo === 'despesa' || t.tipo === 'receita') && t.data && t.data <= hoje);
    for (const s of subs) {
      if (s.prefs?.lembrar === false) continue;
      const chave = (perfis ?? []).find((p: any) => p.id === s.user_id)?.papel === 'dono' ? 'caio' : 'marina';
      const seus = txs.filter((t: any) => t.compartilhada === true || t.pessoa === chave || t.criadoPor === chave || (!t.pessoa && !t.criadoPor));
      if (!seus.length) continue;
      const ultima = seus.reduce((m: string, t: any) => (t.data > m ? t.data : m), '0000-00-00');
      const d = dias(hoje, ultima);
      if (d <= 3) continue;
      resumo.push({ dias: d, ...(await enviar([s], { titulo: 'Não se esqueça de registrar seus gastos!', corpo: `Faz ${d} dias que você não lança nenhuma despesa ou receita. Toque para registrar agora.`, view: 'transacoes', tag: 'lembrete-' + hoje })) });
    }
  }
  return resumo;
}

// Lembretes agendados (Rodada 21): a pessoa escolhe vários horários/dias; roda a cada 5 min (job separado do cron diário
// acima, pra não mudar a cadência nem o comportamento do que já funcionava). Só avisa se ainda não lançou nada hoje,
// e no máximo uma vez por horário configurado por dia (marcado em prefs.lembretesFeitos da própria assinatura).
async function rodarLembretesAgendados() {
  const hoje = hojeSP();
  const { hhmm, diaSemana } = agoraSP();
  const { data: todas } = await admin.from('grana_push_subs').select('*');
  const porHH = new Map<string, any[]>();
  for (const s of todas ?? []) { if (!Array.isArray(s.prefs?.lembretes) || !s.prefs.lembretes.length) continue; if (!porHH.has(s.household_id)) porHH.set(s.household_id, []); porHH.get(s.household_id)!.push(s); }
  const resumo: any[] = [];
  for (const [id, subs] of porHH) {
    const { data: h } = await admin.from('grana_households').select('estado').eq('id', id).single();
    const { data: perfis } = await admin.from('grana_profiles').select('id,papel').eq('household_id', id);
    const est: any = h?.estado ?? {};
    const txs = (est.transacoes ?? []).filter((t: any) => (t.tipo === 'despesa' || t.tipo === 'receita') && t.data === hoje);
    for (const s of subs) {
      const feitos = s.prefs?.lembretesFeitos?.data === hoje ? (s.prefs.lembretesFeitos.ids ?? []) : [];
      const bateram = (s.prefs.lembretes as any[]).filter((r) => r?.hora === hhmm && (!Array.isArray(r.dias) || !r.dias.length || r.dias.includes(diaSemana)) && !feitos.includes(r.id));
      if (!bateram.length) continue;
      const novosFeitos = { data: hoje, ids: [...feitos, ...bateram.map((r) => r.id)] };
      await admin.from('grana_push_subs').update({ prefs: { ...s.prefs, lembretesFeitos: novosFeitos } }).eq('endpoint', s.endpoint);
      const chave = (perfis ?? []).find((p: any) => p.id === s.user_id)?.papel === 'dono' ? 'caio' : 'marina';
      const jaLancouHoje = txs.some((t: any) => t.compartilhada === true || t.pessoa === chave || t.criadoPor === chave || (!t.pessoa && !t.criadoPor));
      if (jaLancouHoje) { resumo.push({ sub: s.endpoint.slice(-8), pulou: 'já lançou hoje' }); continue; }
      resumo.push({ sub: s.endpoint.slice(-8), horarios: bateram.map((r) => r.id), ...(await enviar([s], { titulo: 'Não se esqueça de registrar seus gastos!', corpo: 'Chegou o horário que você escolheu para lançar suas despesas e receitas de hoje.', view: 'transacoes', tag: 'lembrete-ag-' + hoje })) });
    }
  }
  return resumo;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'método' }, 405);
  let body: any = {};
  try { body = await req.json(); } catch (_) { /* vazio */ }

  try {
    const c = await config();
    const segredo = req.headers.get('x-cron-secret');
    if (segredo) {
      if (segredo !== c.cron_secret) return json({ erro: 'não autorizado' }, 401);
      if (body.modo === 'agendados') {
        // job separado (a cada 5 min) só dos horários agendados pela pessoa; não mexe no cron diário abaixo.
        let agendados: any = [];
        try { agendados = await rodarLembretesAgendados(); } catch (e: any) { console.error('lembretes agendados falhou', e); agendados = { erro: String(e?.message ?? e) }; }
        return json({ modo: 'agendados', agendados });
      }
      const venc = await rodarVencimentos();
      let lembretes: any = [];
      try { lembretes = await rodarLembretes(); } catch (e: any) { console.error('lembretes falhou', e); lembretes = { erro: String(e?.message ?? e) }; }
      return json({ modo: 'cron', resumo: venc, lembretes });
    }

    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    const user = u?.user;
    if (!user) return json({ erro: 'não autorizado' }, 401);
    const { data: perfil } = await admin.from('grana_profiles').select('household_id,nome').eq('id', user.id).single();
    const hh = perfil?.household_id;
    if (!hh) return json({ erro: 'sem grupo' }, 403);

    switch (body.acao) {
      case 'chave':
        return json({ chave: c.vapid_public });
      case 'assinar': {
        const s = body.sub;
        if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) return json({ erro: 'assinatura inválida' }, 400);
        const horaRe = /^([01]\d|2[0-3]):[0-5]\d$/;
        const lembretes = Array.isArray(body.prefs?.lembretes)
          ? body.prefs.lembretes
              .filter((r: any) => r && typeof r.id === 'string' && horaRe.test(r.hora) && (r.dias === undefined || (Array.isArray(r.dias) && r.dias.every((d: any) => Number.isInteger(d) && d >= 0 && d <= 6))))
              .slice(0, 10)
              .map((r: any) => ({ id: String(r.id).slice(0, 40), hora: r.hora, dias: Array.isArray(r.dias) ? r.dias.slice(0, 7) : [] }))
          : [];
        // preserva o registro de "já avisei hoje" dos horários agendados (lembretesFeitos): sem isso, toda vez que o app
        // resincroniza (abrir o app, mudar qualquer preferência) o dedup do dia zerava e podia avisar de novo no mesmo horário.
        const { data: existente } = await admin.from('grana_push_subs').select('prefs').eq('endpoint', s.endpoint).maybeSingle();
        const prefs = { parceiro: body.prefs?.parceiro !== false, venc: body.prefs?.venc !== false, lembrar: body.prefs?.lembrar !== false, lembretes, lembretesFeitos: existente?.prefs?.lembretesFeitos };
        const { error } = await admin.from('grana_push_subs').upsert({ endpoint: s.endpoint, household_id: hh, user_id: user.id, p256dh: s.keys.p256dh, auth: s.keys.auth, prefs }, { onConflict: 'endpoint' });
        if (error) return json({ erro: error.message }, 500);
        return json({ ok: true });
      }
      case 'cancelar':
        await admin.from('grana_push_subs').delete().eq('endpoint', String(body.endpoint ?? '')).eq('user_id', user.id);
        return json({ ok: true });
      case 'teste': {
        const { data: subs } = await admin.from('grana_push_subs').select('*').eq('user_id', user.id);
        return json(await enviar(subs ?? [], { titulo: 'Grana a Dois', corpo: 'Push funcionando: você recebe avisos mesmo com o app fechado.', view: 'dashboard', tag: 'teste-push' }));
      }
      case 'parceiro': {
        const { data: subs } = await admin.from('grana_push_subs').select('*').eq('household_id', hh).neq('user_id', user.id);
        const alvo = (subs ?? []).filter((s: any) => s.prefs?.parceiro !== false);
        return json(await enviar(alvo, { titulo: String(body.titulo ?? 'Grana a Dois').slice(0, 80), corpo: String(body.corpo ?? '').slice(0, 200), view: String(body.view ?? 'transacoes'), tag: 'parceiro-' + Date.now() }));
      }
      case 'convidar': {
        // avisa quem já tem conta que recebeu um convite (só se houver convite pendente deste grupo para o e-mail)
        const email = String(body.email ?? '').trim().toLowerCase();
        const { data: conv } = await admin.from('grana_convites').select('id').eq('household_id', hh).eq('status', 'pendente').ilike('email', email).limit(1);
        if (!conv?.length) return json({ ok: 0 });
        const { data: alvoPerfil } = await admin.from('grana_profiles').select('id').ilike('email', email).limit(1);
        if (!alvoPerfil?.length) return json({ ok: 0 });
        const { data: subs } = await admin.from('grana_push_subs').select('*').eq('user_id', alvoPerfil[0].id);
        return json(await enviar(subs ?? [], { titulo: 'Convite no Grana a Dois', corpo: `${perfil?.nome ?? 'Alguém'} convidou você para compartilhar as finanças. Abra o app para aceitar.`, view: 'dashboard', tag: 'convite' }));
      }
      default:
        return json({ erro: 'ação desconhecida' }, 400);
    }
  } catch (e: any) {
    console.error(e);
    return json({ erro: String(e?.message ?? e) }, 500);
  }
});
