begin;

alter table public.ei_typebomb_rooms
add column if not exists items jsonb;

alter table public.ei_typebomb_rooms
alter column items set default '[]'::jsonb;

update public.ei_typebomb_rooms
set items = '[]'::jsonb
where items is null;

update public.ei_typebomb_rooms
set items = coalesce(
    (
        select jsonb_agg(
            jsonb_build_object(
                'id', gen_random_uuid(),
                'type', 'typed_recall',
                'prompt', word ->> 'jp',
                'answer', word ->> 'en'
            )
            order by ordinality
        )
        from jsonb_array_elements(words::jsonb)
            with ordinality as source(word, ordinality)
    ),
    '[]'::jsonb
)
where items = '[]'::jsonb
  and words is not null
  and jsonb_typeof(words::jsonb) = 'array';

alter table public.ei_typebomb_rooms
alter column items set not null;

commit;
