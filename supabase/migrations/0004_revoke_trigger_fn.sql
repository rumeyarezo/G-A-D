-- 0004: gatilho de novo usuário não precisa ser chamável pela API (já aplicado junto da 0003 no projeto novo)
revoke execute on function public.grana_handle_new_user() from public, anon, authenticated;
