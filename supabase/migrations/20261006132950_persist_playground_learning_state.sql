alter table public.ei_typebomb_item_memory
    add column if not exists learning_state jsonb,
    add column if not exists last_presented_at timestamptz;

comment on column public.ei_typebomb_item_memory.learning_state is
    'Explicit learning phase and retrieval successes; review_count is not a mastery criterion.';
comment on column public.ei_typebomb_item_memory.last_presented_at is
    'Most recent answer exposure, including BOT presentations and early extra practice.';
