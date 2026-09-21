import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
if (!url || !key) throw new Error('Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (veja .env.example).');

/** Só a chave pública (anon). A segurança vem do RLS; nunca coloque service key no front-end. */
export const supabase = createClient(url, key);
