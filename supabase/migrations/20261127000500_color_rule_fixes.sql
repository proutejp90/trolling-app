-- Owner-approved color rule fixes (2026-11-27). R11 changes only while it still holds its seed value.
update public.rules
   set recommend = '{"allow_colors":["green","blue","silver","chartreuse"],"allow_finishes":["chrome","glow","fluorescent"]}'::jsonb,
       source_note = 'Great Lakes Salmon Research: Recommender Logic, Color. Chartreuse and fluorescent finishes added by the owner, 2026-11-27, so R14''s stained-water picks survive at mid depths.',
       version = version + 1
 where code = 'R11' and recommend = '{"allow_colors":["green","blue","silver"],"allow_finishes":["chrome","glow"]}'::jsonb;

insert into public.rules (code, priority, stage, "when", recommend, tags, source_note, lakes, species, enabled, version)
values ('R20', 20, 'color', '{"field":"lure_depth_ft","op":"gt","threshold":"blue_max_ft"}'::jsonb,
        '{"allow_colors":["silver"],"allow_finishes":["chrome","glow"]}'::jsonb, array['science'],
        'Light attenuation past the blue limit. Added by the owner, 2026-11-27: the starter rules said nothing below it, so every color came back.',
        array['michigan'], 'chinook', true, 1)
on conflict (code) do nothing;
