create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke all on sequences from public, anon, authenticated;
alter default privileges in schema private revoke all on functions from public, anon, authenticated;

create table private.settings (
  singleton boolean primary key default true check (singleton),
  total_limit smallint not null default 4 check (total_limit between 1 and 20),
  admin_email text not null default 'bs06@gmail.com',
  updated_at timestamptz not null default now()
);
insert into private.settings (singleton) values (true);

create table private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table private.categories (
  id bigint generated always as identity primary key,
  name text not null unique check (length(name) between 1 and 40),
  student_limit smallint not null default 1 check (student_limit between 1 and 5),
  created_at timestamptz not null default now()
);
insert into private.categories (name) values ('주제선택'), ('예술체육'), ('진로탐색');

create table private.students (
  id bigint generated always as identity primary key,
  student_number text not null unique check (student_number ~ '^[0-9]{5}$'),
  name text not null check (length(name) between 1 and 50),
  code_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.courses (
  id bigint generated always as identity primary key,
  category_id bigint not null references private.categories(id) on delete restrict,
  name text not null check (length(name) between 1 and 80),
  code_hash text not null,
  capacity integer not null check (capacity between 1 and 10000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint courses_schedule_check check (starts_at < ends_at)
);
create index courses_live_schedule_idx on private.courses (starts_at, ends_at) where deleted_at is null;
create index courses_category_idx on private.courses (category_id) where deleted_at is null;

create table private.registrations (
  id bigint generated always as identity primary key,
  student_id bigint not null references private.students(id) on delete cascade,
  course_id bigint not null references private.courses(id) on delete cascade,
  registered_at timestamptz not null default now(),
  canceled_at timestamptz,
  canceled_by text,
  constraint registrations_canceled_by_check check (canceled_by is null or canceled_by in ('student', 'admin'))
);
create unique index registrations_one_active_per_course
  on private.registrations (student_id, course_id) where canceled_at is null;
create index registrations_course_order_idx on private.registrations (course_id, registered_at, id);
create index registrations_student_active_idx on private.registrations (student_id, registered_at) where canceled_at is null;

create table private.proofs (
  id bigint generated always as identity primary key,
  token_hash text not null unique,
  course_id bigint not null references private.courses(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index proofs_expiration_idx on private.proofs (expires_at);

create table private.attempts (
  kind text not null check (kind in ('student', 'course')),
  key_hash text not null,
  window_started_at timestamptz not null,
  attempt_count smallint not null check (attempt_count between 1 and 100),
  primary key (kind, key_hash)
);
create index attempts_window_idx on private.attempts (window_started_at);

alter table private.settings enable row level security;
alter table private.admins enable row level security;
alter table private.categories enable row level security;
alter table private.students enable row level security;
alter table private.courses enable row level security;
alter table private.registrations enable row level security;
alter table private.proofs enable row level security;
alter table private.attempts enable row level security;

create function private.seed_configured_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null
     and lower(new.email) = (select lower(admin_email) from private.settings where singleton) then
    insert into private.admins (user_id) values (new.id) on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.seed_configured_admin() from public, anon, authenticated;

create trigger seed_configured_admin
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function private.seed_configured_admin();

create function private.raise_error(error_code text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  message_text text;
begin
  message_text := case error_code
    when 'NOT_STARTED' then '아직 수강신청 시간이 아닙니다'
    when 'COURSE_CODE_MISMATCH' then '과목 코드가 일치하지 않습니다.'
    when 'STUDENT_AUTH_FAILED' then '학번, 이름, 학생 전용 코드를 확인해주세요.'
    when 'ALREADY_REGISTERED' then '이미 신청하였습니다'
    when 'COURSE_CLOSED' then '신청 마감 시한이 지났습니다.'
    when 'COURSE_FULL' then '해당 과목은 신청이 마감되었습니다.'
    when 'TOTAL_LIMIT' then '최대 신청 가능 과목 수에 도달했습니다.'
    when 'CATEGORY_LIMIT' then '범주 신청 한도에 도달했습니다.'
    when 'CANCEL_CLOSED' then '신청 마감 이후에는 취소할 수 없습니다.'
    when 'ADMIN_REQUIRED' then '관리자 권한이 없습니다.'
    when 'RATE_LIMITED' then '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
    when 'NOT_FOUND' then '요청한 정보를 찾을 수 없습니다.'
    else '입력 정보를 확인해주세요.'
  end;
  raise exception using errcode = 'P0001', message = message_text, detail = error_code;
end;
$$;
revoke all on function private.raise_error(text) from public, anon, authenticated;

create function private.record_attempt(p_kind text, p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_hash text;
  current_count smallint;
begin
  attempt_hash := encode(extensions.digest(p_key, 'sha256'), 'hex');
  if random() < 0.01 then
  delete from private.attempts where window_started_at < clock_timestamp() - interval '1 day';
  delete from private.proofs where expires_at < clock_timestamp() - interval '1 day';
  end if;
  insert into private.attempts (kind, key_hash, window_started_at, attempt_count)
  values (p_kind, attempt_hash, now(), 1)
  on conflict (kind, key_hash) do update
    set window_started_at = case
          when private.attempts.window_started_at <= now() - interval '1 minute' then now()
          else private.attempts.window_started_at
        end,
        attempt_count = case
          when private.attempts.window_started_at <= now() - interval '1 minute' then 1
          else least(private.attempts.attempt_count + 1, 100)
        end
  returning attempt_count into current_count;
  return current_count <= case p_kind when 'student' then 8 else 12 end;
end;
$$;
revoke all on function private.record_attempt(text, text) from public, anon, authenticated;

create function private.student_api(p_action text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_course private.courses%rowtype;
  v_student private.students%rowtype;
  v_category private.categories%rowtype;
  v_registration private.registrations%rowtype;
  v_course_id bigint;
  v_student_id bigint;
  v_token text;
  v_token_hash text;
  v_proof private.proofs%rowtype;
  v_active_count integer;
  v_category_count integer;
  v_capacity_count integer;
  v_total_limit smallint;
  v_name text;
  v_student_number text;
  v_rows jsonb;
begin
  if p_payload is null or pg_column_size(p_payload) > 32768 then
    perform private.raise_error('INVALID_INPUT');
  end if;

  if p_action = 'catalog' then
    return jsonb_build_object(
      'courses', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'category', cat.name, 'name', c.name, 'capacity', c.capacity,
          'startsAt', c.starts_at, 'endsAt', c.ends_at
        ) order by cat.id, c.name)
        from private.courses c join private.categories cat on cat.id = c.category_id
        where c.deleted_at is null
      ), '[]'::jsonb)
    );
  elsif p_action = 'verify_course' then
    if not private.record_attempt('course', coalesce(p_payload->>'courseId', '')) then
      perform private.raise_error('RATE_LIMITED');
    end if;
    if coalesce(octet_length(p_payload->>'code'), 0) not between 1 and 72 then
      perform private.raise_error('COURSE_CODE_MISMATCH');
    end if;
    select * into v_course from private.courses
      where id = (p_payload->>'courseId')::bigint and deleted_at is null;
    if not found then perform private.raise_error('NOT_FOUND'); end if;
    v_now := clock_timestamp();
    if v_now < v_course.starts_at then perform private.raise_error('NOT_STARTED'); end if;
    if v_now > v_course.ends_at then perform private.raise_error('COURSE_CLOSED'); end if;
    if extensions.crypt(p_payload->>'code', v_course.code_hash) <> v_course.code_hash then
      perform private.raise_error('COURSE_CODE_MISMATCH');
    end if;
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
    insert into private.proofs (token_hash, course_id, expires_at)
      values (v_token_hash, v_course.id, v_now + interval '10 minutes');
    return jsonb_build_object('proof', v_token);
  elsif p_action in ('register', 'cancel', 'mine', 'status') then
    v_student_number := p_payload->>'studentNumber';
    v_name := btrim(p_payload->>'name');
    if coalesce(v_student_number, '') !~ '^[0-9]{5}$' or coalesce(v_name, '') = ''
       or coalesce(octet_length(p_payload->>'studentCode'), 0) not between 1 and 72 then
      perform private.raise_error('STUDENT_AUTH_FAILED');
    end if;
    if not private.record_attempt('student', v_student_number) then
      perform private.raise_error('RATE_LIMITED');
    end if;
    select * into v_student from private.students where student_number = v_student_number;
    if not found or v_student.name <> v_name
       or extensions.crypt(p_payload->>'studentCode', v_student.code_hash) <> v_student.code_hash then
      perform private.raise_error('STUDENT_AUTH_FAILED');
    end if;

    if p_action in ('register', 'cancel') then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_student.student_number, 0));
    end if;

    if p_action = 'register' then
      if coalesce(p_payload->>'courseId', '') !~ '^[0-9]{1,18}$' then perform private.raise_error('INVALID_INPUT'); end if;
      v_course_id := (p_payload->>'courseId')::bigint;
      select * into v_course from private.courses where id = v_course_id and deleted_at is null for update;
      if not found then perform private.raise_error('NOT_FOUND'); end if;
      v_now := clock_timestamp();
      if v_now < v_course.starts_at then perform private.raise_error('NOT_STARTED'); end if;
      if v_now > v_course.ends_at then perform private.raise_error('COURSE_CLOSED'); end if;

      v_token := coalesce(p_payload->>'proof', '');
      v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
      select * into v_proof from private.proofs
        where token_hash = v_token_hash and course_id = v_course_id
          and used_at is null and expires_at > v_now
        for update;
      if not found then perform private.raise_error('COURSE_CODE_MISMATCH'); end if;
      update private.proofs set used_at = v_now where id = v_proof.id;

      if exists (select 1 from private.registrations where student_id = v_student.id and course_id = v_course_id and canceled_at is null) then
        perform private.raise_error('ALREADY_REGISTERED');
      end if;
      select count(*) into v_capacity_count from private.registrations
        where course_id = v_course_id and canceled_at is null;
      if v_capacity_count >= v_course.capacity then perform private.raise_error('COURSE_FULL'); end if;

      select count(*) into v_active_count
        from private.registrations r join private.courses c on c.id = r.course_id
        where r.student_id = v_student.id and r.canceled_at is null and c.deleted_at is null;
      select total_limit into v_total_limit from private.settings where singleton;
      if v_active_count >= v_total_limit then perform private.raise_error('TOTAL_LIMIT'); end if;
      select * into v_category from private.categories where id = v_course.category_id;
      select count(*) into v_category_count
        from private.registrations r join private.courses c on c.id = r.course_id
        where r.student_id = v_student.id and r.canceled_at is null
          and c.category_id = v_course.category_id and c.deleted_at is null;
      if v_category_count >= v_category.student_limit then
        raise exception using errcode = 'P0001', message = '범주 신청 한도에 도달했습니다.',
          detail = format('CATEGORY_LIMIT|%s|%s', v_category.name, v_category.student_limit);
      end if;
      insert into private.registrations (student_id, course_id) values (v_student.id, v_course_id);
      return jsonb_build_object('courseName', v_course.name);
    elsif p_action = 'cancel' then
      if coalesce(p_payload->>'registrationId', '') !~ '^[0-9]{1,18}$' then perform private.raise_error('INVALID_INPUT'); end if;
      select r.* into v_registration from private.registrations r
        where r.id = (p_payload->>'registrationId')::bigint
          and r.student_id = v_student.id and r.canceled_at is null
        for update;
      if not found then perform private.raise_error('NOT_FOUND'); end if;
      select * into v_course from private.courses where id = v_registration.course_id for update;
      v_now := clock_timestamp();
      if v_now > v_course.ends_at then perform private.raise_error('CANCEL_CLOSED'); end if;
      update private.registrations set canceled_at = v_now, canceled_by = 'student'
        where id = v_registration.id;
      return jsonb_build_object('ok', true);
    elsif p_action = 'mine' then
      return jsonb_build_object('registrations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'courseId', c.id, 'category', cat.name,
          'courseName', c.name, 'registeredAt', r.registered_at
        ) order by r.registered_at, r.id)
        from private.registrations r
        join private.courses c on c.id = r.course_id
        join private.categories cat on cat.id = c.category_id
        where r.student_id = v_student.id and r.canceled_at is null and c.deleted_at is null
      ), '[]'::jsonb));
    else
      return jsonb_build_object(
        'categories', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', cat.name,
            'courses', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'capacity', c.capacity,
                'registered', (select count(*) from private.registrations r where r.course_id = c.id and r.canceled_at is null),
                'startsAt', c.starts_at, 'endsAt', c.ends_at
              ) order by c.name)
              from private.courses c where c.category_id = cat.id and c.deleted_at is null
            ), '[]'::jsonb)
          ) order by cat.id)
          from private.categories cat
          where exists (select 1 from private.courses c where c.category_id = cat.id and c.deleted_at is null)
        ), '[]'::jsonb)
      );
    end if;
  end if;
  perform private.raise_error('INVALID_INPUT');
  return '{}'::jsonb;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    perform private.raise_error('INVALID_INPUT');
end;
$$;

create function private.admin_api(p_action text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_course private.courses%rowtype;
  v_category private.categories%rowtype;
  v_student private.students%rowtype;
  v_registration private.registrations%rowtype;
  v_rows jsonb;
  v_row jsonb;
  v_total integer;
  v_number text;
  v_name text;
  v_code text;
  v_cap integer;
begin
  if v_admin_id is null or not exists (select 1 from private.admins where user_id = v_admin_id) then
    perform private.raise_error('ADMIN_REQUIRED');
  end if;
  if p_payload is null or pg_column_size(p_payload) > 1900000 then perform private.raise_error('INVALID_INPUT'); end if;

  if p_action = 'dashboard' then
    return jsonb_build_object(
      'courseCount', (select count(*) from private.courses where deleted_at is null),
      'studentCount', (select count(*) from private.students),
      'registrationCount', (select count(*) from private.registrations r
        join private.courses c on c.id = r.course_id
        where r.canceled_at is null and c.deleted_at is null),
      'totalLimit', (select total_limit from private.settings where singleton)
    );
  elsif p_action = 'courses' then
    return jsonb_build_object('courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'category', cat.name, 'name', c.name,
        'capacity', c.capacity,
        'registered', (select count(*) from private.registrations r where r.course_id = c.id and r.canceled_at is null),
        'startsAt', c.starts_at, 'endsAt', c.ends_at
      ) order by c.created_at desc)
      from private.courses c join private.categories cat on cat.id = c.category_id
      where c.deleted_at is null
    ), '[]'::jsonb));
  elsif p_action = 'create_course' then
    if length(btrim(coalesce(p_payload->>'name', ''))) not between 1 and 80
      or length(btrim(coalesce(p_payload->>'category', ''))) not between 1 and 40
      or coalesce(octet_length(p_payload->>'code'), 0) not between 1 and 72
      or coalesce(p_payload->>'capacity', '') !~ '^[0-9]{1,5}$'
      or coalesce(p_payload->>'startsAt', '') = '' or coalesce(p_payload->>'endsAt', '') = ''
      or (p_payload->>'startsAt')::timestamptz >= (p_payload->>'endsAt')::timestamptz then
      perform private.raise_error('INVALID_INPUT');
    end if;
    perform 1 from private.settings where singleton for update;
    if (select count(*) from private.courses where deleted_at is null) >= 20 then perform private.raise_error('COURSE_FULL'); end if;
    v_cap := (p_payload->>'capacity')::integer;
    if v_cap < 1 then perform private.raise_error('INVALID_INPUT'); end if;
    insert into private.categories (name) values (btrim(p_payload->>'category'))
      on conflict (name) do nothing;
    select * into v_category from private.categories where name = btrim(p_payload->>'category') for update;
    insert into private.courses (category_id, name, code_hash, capacity, starts_at, ends_at)
    values (v_category.id, btrim(p_payload->>'name'),
      extensions.crypt(p_payload->>'code', extensions.gen_salt('bf', 12)),
      v_cap, (p_payload->>'startsAt')::timestamptz, (p_payload->>'endsAt')::timestamptz)
    returning * into v_course;
    return jsonb_build_object('id', v_course.id);
  elsif p_action = 'delete_course' then
    select * into v_course from private.courses
      where id = (p_payload->>'courseId')::bigint and deleted_at is null for update;
    if not found then perform private.raise_error('NOT_FOUND'); end if;
    update private.courses set deleted_at = v_now where id = v_course.id;
    return jsonb_build_object('ok', true);
  elsif p_action = 'archive' then
    return jsonb_build_object('courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'category', cat.name, 'name', c.name, 'deletedAt', c.deleted_at,
        'registrationCount', (select count(*) from private.registrations r where r.course_id = c.id)
      ) order by c.deleted_at desc)
      from private.courses c join private.categories cat on cat.id = c.category_id
      where c.deleted_at is not null
    ), '[]'::jsonb));
  elsif p_action = 'archive_roster' then
    select * into v_course from private.courses where id = (p_payload->>'courseId')::bigint and deleted_at is not null;
    if not found then perform private.raise_error('NOT_FOUND'); end if;
    return jsonb_build_object(
      'course', v_course.name,
      'registrations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'number', s.student_number, 'name', s.name, 'registeredAt', r.registered_at,
          'status', case when r.canceled_at is null then '신청' else '취소' end
        ) order by r.registered_at, r.id)
        from private.registrations r join private.students s on s.id = r.student_id
        where r.course_id = v_course.id
      ), '[]'::jsonb)
    );
  elsif p_action = 'purge_course' then
    if p_payload->>'confirmation' is distinct from '영구 삭제' then perform private.raise_error('INVALID_INPUT'); end if;
    delete from private.courses where id = (p_payload->>'courseId')::bigint and deleted_at is not null;
    if not found then perform private.raise_error('NOT_FOUND'); end if;
    return jsonb_build_object('ok', true);
  elsif p_action = 'category_limits' then
    return jsonb_build_object('categories', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'limit', student_limit) order by id)
      from private.categories
    ), '[]'::jsonb), 'totalLimit', (select total_limit from private.settings where singleton));
  elsif p_action = 'set_category_limit' then
    if length(btrim(coalesce(p_payload->>'name', ''))) not between 1 and 40
      or coalesce(p_payload->>'limit', '') !~ '^[1-5]$' then perform private.raise_error('INVALID_INPUT'); end if;
    insert into private.categories (name, student_limit) values (btrim(p_payload->>'name'), (p_payload->>'limit')::smallint)
      on conflict (name) do update set student_limit = excluded.student_limit;
    return jsonb_build_object('ok', true);
  elsif p_action = 'set_total_limit' then
    if coalesce(p_payload->>'limit', '') !~ '^([1-9]|1[0-9]|20)$' then perform private.raise_error('INVALID_INPUT'); end if;
    update private.settings set total_limit = (p_payload->>'limit')::smallint, updated_at = v_now where singleton;
    return jsonb_build_object('ok', true);
  elsif p_action = 'import_students' then
    v_rows := p_payload->'students';
    if jsonb_typeof(v_rows) is distinct from 'array' then perform private.raise_error('INVALID_INPUT'); end if;
    if jsonb_array_length(v_rows) > 3000 then perform private.raise_error('INVALID_INPUT'); end if;
    if exists (
      select 1 from jsonb_array_elements(v_rows) e
      where jsonb_typeof(e) is distinct from 'object'
        or coalesce(e->>'studentNumber', '') !~ '^[0-9]{5}$'
        or length(btrim(coalesce(e->>'name', ''))) not between 1 and 50
        or coalesce(octet_length(e->>'studentCode'), 0) not between 1 and 72
    ) or exists (
      select 1 from (
        select e->>'studentNumber' as n from jsonb_array_elements(v_rows) e
        group by e->>'studentNumber' having count(*) > 1
      ) duplicates
    ) then
      perform private.raise_error('INVALID_INPUT');
    end if;
    for v_row in select value from jsonb_array_elements(v_rows)
    loop
      insert into private.students (student_number, name, code_hash)
      values (v_row->>'studentNumber', btrim(v_row->>'name'),
        extensions.crypt(v_row->>'studentCode', extensions.gen_salt('bf', 12)))
      on conflict (student_number) do update
        set name = excluded.name, code_hash = excluded.code_hash, updated_at = v_now;
    end loop;
    return jsonb_build_object('imported', jsonb_array_length(v_rows));
  elsif p_action = 'reset_students' then
    if p_payload->>'confirmation' is distinct from '전체 삭제' then perform private.raise_error('INVALID_INPUT'); end if;
    delete from private.attempts where kind = 'student';
    delete from private.proofs;
    delete from private.students;
    return jsonb_build_object('ok', true);
  elsif p_action = 'search_student' then
    v_number := coalesce(p_payload->>'studentNumber', '');
    if v_number !~ '^[0-9]{5}$' then perform private.raise_error('INVALID_INPUT'); end if;
    select * into v_student from private.students where student_number = v_number;
    if not found then perform private.raise_error('NOT_FOUND'); end if;
    return jsonb_build_object(
      'student', jsonb_build_object('number', v_student.student_number, 'name', v_student.name),
      'registrations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'category', cat.name, 'courseName', c.name, 'registeredAt', r.registered_at
        ) order by r.registered_at, r.id)
        from private.registrations r join private.courses c on c.id = r.course_id
        join private.categories cat on cat.id = c.category_id
        where r.student_id = v_student.id and r.canceled_at is null and c.deleted_at is null
      ), '[]'::jsonb)
    );
  elsif p_action = 'delete_registration' then
    select * into v_registration from private.registrations
      where id = (p_payload->>'registrationId')::bigint and canceled_at is null;
    if not found then perform private.raise_error('NOT_FOUND'); end if;
    select * into v_student from private.students where id = v_registration.student_id;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_student.student_number, 0));
    select * into v_course from private.courses where id = v_registration.course_id for update;
    select * into v_registration from private.registrations
      where id = v_registration.id and canceled_at is null for update;
    if not found then perform private.raise_error('NOT_FOUND'); end if;
    v_now := clock_timestamp();
    update private.registrations set canceled_at = v_now, canceled_by = 'admin' where id = v_registration.id;
    return jsonb_build_object('ok', true);
  elsif p_action = 'course_roster' then
    select * into v_course from private.courses where id = (p_payload->>'courseId')::bigint and deleted_at is null;
    if not found then perform private.raise_error('NOT_FOUND'); end if;
    return jsonb_build_object(
      'course', v_course.name,
      'registrations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'number', s.student_number, 'name', s.name, 'registeredAt', r.registered_at
        ) order by r.registered_at, r.id)
        from private.registrations r join private.students s on s.id = r.student_id
        where r.course_id = v_course.id and r.canceled_at is null
      ), '[]'::jsonb)
    );
  end if;
  perform private.raise_error('INVALID_INPUT');
  return '{}'::jsonb;
exception
  when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    perform private.raise_error('INVALID_INPUT');
end;
$$;

create function public.student_api(p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.student_api(p_action, p_payload) $$;

create function public.admin_api(p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.admin_api(p_action, p_payload) $$;

revoke all on function private.student_api(text, jsonb) from public, anon, authenticated;
revoke all on function private.admin_api(text, jsonb) from public, anon, authenticated;
revoke all on function public.student_api(text, jsonb) from public, authenticated;
revoke all on function public.admin_api(text, jsonb) from public, anon;
grant execute on function public.student_api(text, jsonb) to anon, authenticated;
grant execute on function public.admin_api(text, jsonb) to authenticated;

comment on schema private is 'Student personal data and enrollment credentials; not exposed through PostgREST.';
