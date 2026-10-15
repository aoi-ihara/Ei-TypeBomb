-- Adds fa / fi regression items only to the designated integration-test room.
-- Idempotent: leaves the room unchanged if either fixture ID already exists.
update public.ei_typebomb_rooms
set items = items || '[
  {
    "id": "64a2dd10-03aa-40ea-8a8a-000000000011",
    "type": "typed_recall",
    "prompt": "ファイルの最初の2文字の読み",
    "answer": "ふぁ"
  },
  {
    "id": "64a2dd10-03aa-40ea-8a8a-000000000012",
    "type": "typed_recall",
    "prompt": "フィルムの最初の2文字の読み",
    "answer": "ふぃ"
  }
]'::jsonb,
    updated_at = now()
where id = 'c4a4531a-c05f-426f-8ba4-36f32bb80ab7'
  and title = 'Supabaseの構造を変えた後のテスト'
  and jsonb_typeof(items) = 'array'
  and not exists (
      select 1
      from jsonb_array_elements(items) as item
      where item ->> 'id' in (
          '64a2dd10-03aa-40ea-8a8a-000000000011',
          '64a2dd10-03aa-40ea-8a8a-000000000012'
      )
  )
returning id, title, jsonb_array_length(items) as item_count;
