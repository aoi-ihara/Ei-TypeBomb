-- Integration fixtures for Japanese typing, stored in the existing items JSONB.
-- Safe to execute once against the designated EMPTY test room only.
-- Non-destructive: refuses to overwrite existing items (including any later edits).
update public.ei_typebomb_rooms
set
    items = '[{"id":"64a2dd10-03aa-40ea-8a8a-000000000001","type":"typed_recall","prompt":"桜の読み方","answer":"さくら"},{"id":"64a2dd10-03aa-40ea-8a8a-000000000002","type":"typed_recall","prompt":"お茶の「ちゃ」","answer":"ちゃ"},{"id":"64a2dd10-03aa-40ea-8a8a-000000000003","type":"typed_recall","prompt":"今日の読み方","answer":"きょう"},{"id":"64a2dd10-03aa-40ea-8a8a-000000000004","type":"typed_recall","prompt":"あいさつ","answer":"こんにちは"},{"id":"64a2dd10-03aa-40ea-8a8a-000000000005","type":"typed_recall","prompt":"学校の読み方","answer":"がっこう"},{"id":"64a2dd10-03aa-40ea-8a8a-000000000006","type":"typed_recall","prompt":"漢字の読み方","answer":"かんじ"},{"id":"64a2dd10-03aa-40ea-8a8a-000000000007","type":"typed_recall","prompt":"詩の読み方","answer":"し"},{"id":"64a2dd10-03aa-40ea-8a8a-000000000008","type":"typed_recall","prompt":"英数とハイフンの混在","answer":"さ-a"},{"id":"64a2dd10-03aa-40ea-8a8a-000000000009","type":"typed_recall","prompt":"りんごの英語","answer":"apple"},{"id":"64a2dd10-03aa-40ea-8a8a-000000000010","type":"typed_recall","prompt":"ひらがなとスペース","answer":"あ い"}]'::jsonb,
    updated_at = now()
where id = 'c4a4531a-c05f-426f-8ba4-36f32bb80ab7'
  and title = 'Supabaseの構造を変えた後のテスト'
  and items = '[]'::jsonb
returning id, title, jsonb_array_length(items) as item_count;
