begin;

create or replace function public.consume_gemini_generation(
    p_user_id uuid,
    p_limit smallint
)
returns table (
    allowed boolean,
    generation_count smallint
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_usage_date date := (now() at time zone 'Asia/Tokyo')::date;
begin
    if p_limit <= 0 then
        return query select false, 0::smallint;
        return;
    end if;

    return query
    insert into public.ei_type_bomb_gemini_usage (
        user_id,
        usage_date,
        generation_count
    )
    values (
        p_user_id,
        v_usage_date,
        1
    )
    on conflict (user_id, usage_date)
    do update set
        generation_count =
            public.ei_type_bomb_gemini_usage.generation_count + 1,
        updated_at = now()
    where public.ei_type_bomb_gemini_usage.generation_count < p_limit
    returning true, generation_count;

    if not found then
        return query select false, p_limit;
    end if;
end;
$$;

revoke execute on function public.consume_gemini_generation(uuid, smallint)
from public, anon, authenticated;

grant execute on function public.consume_gemini_generation(uuid, smallint)
to service_role;

commit;
