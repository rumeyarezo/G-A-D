-- Fixa o search_path da função de categorias padrão (aviso do Supabase advisor).
alter function public.grana_categorias_padrao() set search_path = public;
