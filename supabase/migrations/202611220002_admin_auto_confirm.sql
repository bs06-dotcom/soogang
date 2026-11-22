update private.settings
set admin_email = 'bs06@gmail.com',
    updated_at = now()
where singleton;

create or replace function private.auto_confirm_configured_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(new.email, '')) = 'bs06@gmail.com' then
    new.email_confirmed_at = coalesce(new.email_confirmed_at, now());
  end if;
  return new;
end;
$$;

revoke all on function private.auto_confirm_configured_admin() from public, anon, authenticated;

drop trigger if exists auto_confirm_configured_admin on auth.users;
create trigger auto_confirm_configured_admin
  before insert or update of email on auth.users
  for each row execute function private.auto_confirm_configured_admin();
