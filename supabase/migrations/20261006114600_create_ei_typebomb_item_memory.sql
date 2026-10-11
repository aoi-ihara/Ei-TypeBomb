create table if not exists public.ei_typebomb_item_memory (
    user_id uuid not null references auth.users(id) on delete cascade,
    room_id uuid not null references public.ei_typebomb_rooms(id) on delete cascade,
    id uuid not null,
    stability double precision not null default 0
        constraint ei_typebomb_item_memory_stability_nonnegative
        check (stability >= 0),
    difficulty double precision not null default 0,
    review_count integer not null default 0
        constraint ei_typebomb_item_memory_review_count_nonnegative
        check (review_count >= 0),
    last_reviewed_at timestamp with time zone not null default now(),
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint ei_typebomb_item_memory_pkey
        primary key (user_id, room_id, id)
);

alter table public.ei_typebomb_item_memory enable row level security;

revoke all on table public.ei_typebomb_item_memory from anon;
grant select, insert, update, delete
    on table public.ei_typebomb_item_memory
    to authenticated, service_role;

drop policy if exists "Users can read their own ETB memory"
    on public.ei_typebomb_item_memory;
create policy "Users can read their own ETB memory"
    on public.ei_typebomb_item_memory
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own ETB memory"
    on public.ei_typebomb_item_memory;
create policy "Users can insert their own ETB memory"
    on public.ei_typebomb_item_memory
    for insert
    to authenticated
    with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own ETB memory"
    on public.ei_typebomb_item_memory;
create policy "Users can update their own ETB memory"
    on public.ei_typebomb_item_memory
    for update
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own ETB memory"
    on public.ei_typebomb_item_memory;
create policy "Users can delete their own ETB memory"
    on public.ei_typebomb_item_memory
    for delete
    to authenticated
    using ((select auth.uid()) = user_id);
