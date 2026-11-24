-- Run with psql -v ON_ERROR_STOP=1 against a disposable migrated database.
begin;

insert into auth.users (id)
values ('0e8e7a1f-8be3-4e00-8f04-e7fd14d3efee'),
       ('4b3e9a47-426b-4ad6-8955-05e8cc601a76');

insert into public.ei_typebomb_rooms (id, user_id, title)
values ('09059604-4740-4cdf-83a8-00e902940ec9', '0e8e7a1f-8be3-4e00-8f04-e7fd14d3efee', 'Memory sync test');

set local role authenticated;
select set_config('request.jwt.claim.sub', '0e8e7a1f-8be3-4e00-8f04-e7fd14d3efee', true);

insert into public.ei_typebomb_item_memory
    (user_id, room_id, id, stability, difficulty, review_count, last_reviewed_at, updated_at)
values ('0e8e7a1f-8be3-4e00-8f04-e7fd14d3efee', '09059604-4740-4cdf-83a8-00e902940ec9',
        '31fc40b7-22f8-42a0-8bca-0f0a5b2b3814', 0.3, 5, 2, null, '2026-11-20T00:00:02Z');

-- Simulate the older device arriving after the newer snapshot and a retry
-- carrying the same timestamp.
insert into public.ei_typebomb_item_memory
    (user_id, room_id, id, stability, difficulty, review_count, last_reviewed_at, updated_at)
values ('0e8e7a1f-8be3-4e00-8f04-e7fd14d3efee', '09059604-4740-4cdf-83a8-00e902940ec9',
        '31fc40b7-22f8-42a0-8bca-0f0a5b2b3814', 0.15, 5, 1, null, '2026-11-20T00:00:01Z')
on conflict (user_id, room_id, id) do update
set updated_at = excluded.updated_at, review_count = excluded.review_count;

update public.ei_typebomb_item_memory
set review_count = 99 where id = '31fc40b7-22f8-42a0-8bca-0f0a5b2b3814';

do $$
begin
    if not exists (
        select from public.ei_typebomb_item_memory
        where id = '31fc40b7-22f8-42a0-8bca-0f0a5b2b3814'
          and review_count = 2 and last_reviewed_at is null
    ) then
        raise exception 'Stale/equal snapshots changed the newer row';
    end if;
end
$$;

update public.ei_typebomb_item_memory
set review_count = 3, updated_at = '2026-11-20T00:00:03Z'
where id = '31fc40b7-22f8-42a0-8bca-0f0a5b2b3814';

do $$
begin
    if not exists (
        select from public.ei_typebomb_item_memory
        where id = '31fc40b7-22f8-42a0-8bca-0f0a5b2b3814' and review_count = 3
    ) then
        raise exception 'A newer snapshot failed to update';
    end if;
end
$$;

select set_config('request.jwt.claim.sub', '4b3e9a47-426b-4ad6-8955-05e8cc601a76', true);
do $$
begin
    if exists (
        select from public.ei_typebomb_item_memory
        where id = '31fc40b7-22f8-42a0-8bca-0f0a5b2b3814'
    ) then
        raise exception 'Another user could read the memory';
    end if;
    begin
        insert into public.ei_typebomb_item_memory (user_id, room_id, id)
        values ('0e8e7a1f-8be3-4e00-8f04-e7fd14d3efee', '09059604-4740-4cdf-83a8-00e902940ec9',
                '31fc40b7-22f8-42a0-8bca-0f0a5b2b3814');
        raise exception 'Another user could insert memory under a different identity';
    exception when insufficient_privilege then null;
    end;
end
$$;

rollback;
