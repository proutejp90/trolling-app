-- is_admin() only ever answers for the caller, but nobody signed out needs it.
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
