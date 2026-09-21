import { supabase } from './supabase';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Envia um OFX/CSV ao serviço Python e recebe os lançamentos com ids estáveis e duplicados marcados. */
export async function importarExtrato(arquivo: File): Promise<unknown> {
  const body = new FormData();
  body.append('arquivo', arquivo);
  const r = await fetch(`${BASE}/importar/extrato`, { method: 'POST', body, headers: await authHeader() });
  if (!r.ok) throw new Error(`Falha ao importar (${r.status})`);
  return r.json();
}

export async function projetar(payload: unknown): Promise<unknown> {
  const r = await fetch(`${BASE}/projecao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Falha na projeção (${r.status})`);
  return r.json();
}
