create or replace function private.seed_configured_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null
     and lower(coalesce(new.email, '')) in ('bs06@gmail.com', 'bs06@ogeum.ms.kr') then
    insert into private.admins (user_id) values (new.id) on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.seed_configured_admin() from public, anon, authenticated;

create or replace function private.auto_confirm_configured_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(new.email, '')) in ('bs06@gmail.com', 'bs06@ogeum.ms.kr') then
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
