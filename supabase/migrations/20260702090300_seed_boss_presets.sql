-- ============================================================================
-- boss_presets 시드 (디자인 핸드오프 값 그대로). 멱등: on conflict (id) do nothing.
-- 값이 바뀌면 관리자 UI(CRUD)로 수정하거나, 필요 시 별도 마이그레이션에서 update 한다.
-- (여기서 do update 로 덮으면 관리자가 나중에 수정한 값을 재적용 때 되돌릴 수 있어 do nothing 유지.)
--   id / name / reset_type / req_level / rec_hexa / symbol_type / req_force / list_order
-- ============================================================================
insert into public.boss_presets
  (id, name,              reset_type,   req_level, rec_hexa, symbol_type, req_force, list_order)
values
  ('b1', '주간 윌',              'weekly_thu', 220, 15, 'arcane', 2600, 1),
  ('b2', '주간 루시드',          'weekly_thu', 210, 12, 'arcane', 1500, 2),
  ('b3', '주간 데미안',          'weekly_thu', 210, 12, 'arcane', 1500, 3),
  ('b4', '주간 검은 마법사',     'weekly_thu', 240, 24, 'arcane', 4500, 4),
  ('b5', '하드 스우 / 듄켈',     'weekly_thu', 230, 18, 'arcane', 1800, 5),
  ('b6', '선택 아케인 (진힐라 등)', 'weekly_thu', 200, 10, 'arcane', 1400, 6)
on conflict (id) do nothing;
