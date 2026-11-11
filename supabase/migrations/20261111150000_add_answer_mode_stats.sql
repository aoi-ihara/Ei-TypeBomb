alter table public.ei_typebomb_item_memory
    add column if not exists answer_mode_stats jsonb;

comment on column public.ei_typebomb_item_memory.answer_mode_stats is
    'Separate recognition (multiple-choice) and recall (typed input) attempt statistics used by automatic answer-mode selection.';
