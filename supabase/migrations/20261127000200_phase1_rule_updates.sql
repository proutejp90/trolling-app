-- Phase 1 changes to seeded rows. Guarded so they never overwrite an owner's edit:
-- each update applies only while the row still holds its Phase 0 seed value.
update public.thresholds
   set value = '15'::jsonb,
       note = 'How far R08 moves the depth range shallower. From six summers of Ludington buoy history; see docs/research/upwelling-shift.md.'
 where name = 'upwelling_shift_ft' and value = 'null'::jsonb;

update public.rules
   set "when" = '{"field":"has_temp_data","op":"eq","value":true}'::jsonb,
       source_note = 'Great Lakes Salmon Research: Recommender Logic, Depth. Fires whenever a profile or a break depth is known: a buoy, a report, or the angler''s own reading.',
       version = version + 1
 where code = 'R05' and "when" = '{"field":"temp_source_level","op":"in","value":[0,1]}'::jsonb;

update public.rules
   set source_note = 'Great Lakes Salmon Research: Recommender Logic, Upwelling; docs/research/upwelling-shift.md'
 where code = 'R08' and source_note like '%Skipped while upwelling_shift_ft has no value.';

update public.rules
   set recommend = '{"rank_first":["flasher_fly"],"allow_only":["flasher_fly","meat_rig"],"exclude":["spoon"]}'::jsonb,
       version = version + 1
 where code = 'P03' and recommend = '{"allow_only":["flasher_fly","meat_rig"],"exclude":["spoon"]}'::jsonb;
