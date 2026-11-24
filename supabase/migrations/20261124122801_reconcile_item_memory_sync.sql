-- Recognition and assisted recall can have no clean typed review.
alter table public.ei_typebomb_item_memory
    alter column last_reviewed_at drop not null;

-- Also fence writes from clients that still use the previous upsert.
-- PostgreSQL runs this after locking the conflicting row.
create function public.keep_newer_ei_typebomb_item_memory()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    return null;
end;
$$;

revoke execute on function public.keep_newer_ei_typebomb_item_memory() from public;

create trigger keep_newer_ei_typebomb_item_memory
before update on public.ei_typebomb_item_memory
for each row
when (new.updated_at <= old.updated_at)
execute function public.keep_newer_ei_typebomb_item_memory();
