-- INTERMEDIATE MODULES 1-5 (freshly curated, Beginner-traceable phrases)
--
-- Migration 047 gave Intermediate 10 generic modules built from a
-- pre-existing 200-phrase pool (Paglalarawang/Pandiwa/Panlunan themes) with
-- no traceability to what was actually taught in Beginner. This migration
-- replaces that with the approved 5-module design: Modules 1-4 each cover
-- one group of the Beginner consonants already taught (A/B/K/D, G/H/L/M,
-- N/NG/P/R, S/T/W/Y), 5 phrases each; Module 5 is a 20-phrase capstone
-- combining vocabulary from all four groups plus Beginner Module 17's
-- 20-word list. Every phrase was freshly curated and dictionary-verified
-- (not pulled from the xlsx workbook), and reviewed word-by-word for
-- taught-syllable traceability plus phrase-level naturalness with a native
-- speaker. TS and consonant clusters remain fully out of scope, same as
-- Beginner.
--
-- Advanced's 10 modules (also from migration 047) are NOT touched here -
-- Stage 4 (Advanced short-story scaffolding) is separate, later work.
--
-- Zero completions/attempts were verified against production immediately
-- before writing this migration - see the guard below, which re-checks the
-- same thing at migration time and aborts loudly if that has changed.
--
-- Same curriculum_version-sharing constraint as migration 047:
-- validate_active_module_curriculum_version_trigger only allows one active
-- version across the whole table, so this reuses 'presentation_beginner_
-- mvp_v1' and scopes every step by level, never by curriculum_version alone.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.student_module_completions completion
    JOIN public.reading_modules module ON module.id = completion.module_id
    WHERE module.level = 'Intermediate'
  ) THEN
    RAISE EXCEPTION 'Intermediate modules already have student completions - aborting replacement';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.student_module_assessment_attempts attempt
    JOIN public.reading_module_assessments assessment ON assessment.id = attempt.assessment_id
    JOIN public.reading_modules module ON module.id = assessment.module_id
    WHERE module.level = 'Intermediate'
  ) THEN
    RAISE EXCEPTION 'Intermediate modules already have assessment attempts - aborting replacement';
  END IF;
END;
$$;

-- ============================================================
-- PART 1: Remove migration 047's old 10 Intermediate modules (confirmed
-- empty above). The underlying 200-phrase reading_content pool is left
-- untouched - it becomes an unlinked content library, not deleted, in
-- case it's useful later (e.g. free-practice mode).
-- ============================================================
DELETE FROM public.reading_module_assessment_items
WHERE assessment_id IN (
  SELECT assessment.id FROM public.reading_module_assessments assessment
  JOIN public.reading_modules module ON module.id = assessment.module_id
  WHERE module.level = 'Intermediate'
);
DELETE FROM public.reading_module_assessments
WHERE module_id IN (SELECT id FROM public.reading_modules WHERE level = 'Intermediate');
DELETE FROM public.reading_module_prerequisites
WHERE module_id IN (SELECT id FROM public.reading_modules WHERE level = 'Intermediate')
   OR prerequisite_module_id IN (SELECT id FROM public.reading_modules WHERE level = 'Intermediate');
DELETE FROM public.reading_module_items
WHERE module_id IN (SELECT id FROM public.reading_modules WHERE level = 'Intermediate');
DELETE FROM public.reading_modules WHERE level = 'Intermediate';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.reading_modules WHERE level = 'Intermediate') THEN
    RAISE EXCEPTION 'Expected zero Intermediate modules after clearing migration 047 content';
  END IF;
END;
$$;

-- ============================================================
-- PART 2: 40 freshly curated phrases (Modules 1-4: 5 each; Module 5
-- capstone: 20), inserted as new reading_content rows distinct from the
-- old 200-item pool (own source_sheet so they never collide).
-- ============================================================
WITH curated_phrases(module_number, item_order, phrase, pattern_note) AS (
  VALUES
    -- Module 1: A/B/K/D group
    (1,1,'Buo ang kubo.','Intermediate M1 (A/B/K/D group)'),
    (1,2,'Ang baka ko.','Intermediate M1 (A/B/K/D group)'),
    (1,3,'Buko at ube.','Intermediate M1 (A/B/K/D group)'),
    (1,4,'Baba na.','Intermediate M1 (A/B/K/D group)'),
    (1,5,'Kubo ba o kabibi?','Intermediate M1 (A/B/K/D group)'),
    -- Module 2: G/H/L/M group
    (2,1,'Ang lola at ang lolo.','Intermediate M2 (G/H/L/M group)'),
    (2,2,'Gala si Lolo.','Intermediate M2 (G/H/L/M group)'),
    (2,3,'Mali ang halaga.','Intermediate M2 (G/H/L/M group)'),
    (2,4,'Luha ng lola.','Intermediate M2 (G/H/L/M group)'),
    (2,5,'Sa hilaga ang lola.','Intermediate M2 (G/H/L/M group)'),
    -- Module 3: N/NG/P/R group
    (3,1,'Puno ang puno.','Intermediate M3 (N/NG/P/R group)'),
    (3,2,'Una ang apo.','Intermediate M3 (N/NG/P/R group)'),
    (3,3,'Opo, Ina.','Intermediate M3 (N/NG/P/R group)'),
    (3,4,'Ano ang pera?','Intermediate M3 (N/NG/P/R group)'),
    (3,5,'Pera para sa apo.','Intermediate M3 (N/NG/P/R group)'),
    -- Module 4: S/T/W/Y group
    (4,1,'Tao tayo.','Intermediate M4 (S/T/W/Y group)'),
    (4,2,'Tuwa ng tiya.','Intermediate M4 (S/T/W/Y group)'),
    (4,3,'Iyo ang susi.','Intermediate M4 (S/T/W/Y group)'),
    (4,4,'Yoyo ni Tiyo.','Intermediate M4 (S/T/W/Y group)'),
    (4,5,'Sisi ba, Tiya?','Intermediate M4 (S/T/W/Y group)'),
    -- Module 5: 20-phrase capstone (all groups + Beginner Module 17 words)
    (5,1,'Masaya ang lola.','Intermediate M5 capstone'),
    (5,2,'Guro si Tiya.','Intermediate M5 capstone'),
    (5,3,'Puti ang kubo.','Intermediate M5 capstone'),
    (5,4,'Wala ang pera ko.','Intermediate M5 capstone'),
    (5,5,'Bago ang susi.','Intermediate M5 capstone'),
    (5,6,'Tawa ni Lolo.','Intermediate M5 capstone'),
    (5,7,'Sabi ni Ina.','Intermediate M5 capstone'),
    (5,8,'Laro ng apo.','Intermediate M5 capstone'),
    (5,9,'Ang dami ng luha!','Intermediate M5 capstone'),
    (5,10,'Hila, Lolo!','Intermediate M5 capstone'),
    (5,11,'Ngiti ng apo.','Intermediate M5 capstone'),
    (5,12,'Wala ang bibi.','Intermediate M5 capstone'),
    (5,13,'Puno ng tawa.','Intermediate M5 capstone'),
    (5,14,'Ako ay guro.','Intermediate M5 capstone'),
    (5,15,'Bata ang apo.','Intermediate M5 capstone'),
    (5,16,'Kusina ni Ina.','Intermediate M5 capstone'),
    (5,17,'Toyo sa kusina.','Intermediate M5 capstone'),
    (5,18,'Lasa ng ube.','Intermediate M5 capstone'),
    (5,19,'Sa hilaga ang bato.','Intermediate M5 capstone'),
    (5,20,'Masaya sila.','Intermediate M5 capstone')
), numbered AS (
  SELECT *, row_number() OVER (ORDER BY module_number, item_order) AS global_row
  FROM curated_phrases
)
INSERT INTO public.reading_content (
  content_text, normalized_text, content_type, level, sequence_no,
  source_sheet, source_row, pattern_note, backend_category,
  is_assessment, is_active
)
SELECT phrase, lower(phrase), 'phrase', 'Intermediate',
  13000 + global_row, 'Intermediate Presentation MVP v2 (curated)',
  global_row, pattern_note, 'presentation_mvp_intermediate',
  false, true
FROM numbered
ON CONFLICT (normalized_text, content_type, level) DO UPDATE SET
  pattern_note = EXCLUDED.pattern_note,
  backend_category = EXCLUDED.backend_category,
  is_active = true;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.reading_content
      WHERE level = 'Intermediate' AND content_type = 'phrase'
        AND backend_category = 'presentation_mvp_intermediate') <> 40 THEN
    RAISE EXCEPTION 'Expected exactly 40 curated Intermediate phrases';
  END IF;
END;
$$;

-- ============================================================
-- PART 3: Five Intermediate modules, inactive until wired up below.
-- ============================================================
INSERT INTO public.reading_modules (
  curriculum_version, level, module_number, title, description,
  instructional_content_type, assessment_pass_percentage, is_required, is_active
)
VALUES
  ('presentation_beginner_mvp_v1','Intermediate',1,'Mga Parirala: A/B/K/D','Basahin ang mga pariralang gamit ang mga tunog na natutuhan mo sa Beginner.','phrase',75,true,false),
  ('presentation_beginner_mvp_v1','Intermediate',2,'Mga Parirala: G/H/L/M','Ipagpatuloy ang pagbasa ng mga parirala.','phrase',75,true,false),
  ('presentation_beginner_mvp_v1','Intermediate',3,'Mga Parirala: N/NG/P/R','Ipagpatuloy ang pagbasa ng mga parirala.','phrase',75,true,false),
  ('presentation_beginner_mvp_v1','Intermediate',4,'Mga Parirala: S/T/W/Y','Ipagpatuloy ang pagbasa ng mga parirala.','phrase',75,true,false),
  ('presentation_beginner_mvp_v1','Intermediate',5,'Pagsasanib ng mga Parirala','Basahin ang 20 pariralang pinagsama mula sa lahat ng natutuhan.','phrase',75,true,false)
ON CONFLICT (curriculum_version, level, module_number) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  instructional_content_type = EXCLUDED.instructional_content_type,
  assessment_pass_percentage = 75,
  is_required = true,
  is_active = false;

WITH module_map(module_number, item_order, phrase) AS (
  VALUES
    (1,1,'Buo ang kubo.'),
    (1,2,'Ang baka ko.'),
    (1,3,'Buko at ube.'),
    (1,4,'Baba na.'),
    (1,5,'Kubo ba o kabibi?'),
    (2,1,'Ang lola at ang lolo.'),
    (2,2,'Gala si Lolo.'),
    (2,3,'Mali ang halaga.'),
    (2,4,'Luha ng lola.'),
    (2,5,'Sa hilaga ang lola.'),
    (3,1,'Puno ang puno.'),
    (3,2,'Una ang apo.'),
    (3,3,'Opo, Ina.'),
    (3,4,'Ano ang pera?'),
    (3,5,'Pera para sa apo.'),
    (4,1,'Tao tayo.'),
    (4,2,'Tuwa ng tiya.'),
    (4,3,'Iyo ang susi.'),
    (4,4,'Yoyo ni Tiyo.'),
    (4,5,'Sisi ba, Tiya?'),
    (5,1,'Masaya ang lola.'),
    (5,2,'Guro si Tiya.'),
    (5,3,'Puti ang kubo.'),
    (5,4,'Wala ang pera ko.'),
    (5,5,'Bago ang susi.'),
    (5,6,'Tawa ni Lolo.'),
    (5,7,'Sabi ni Ina.'),
    (5,8,'Laro ng apo.'),
    (5,9,'Ang dami ng luha!'),
    (5,10,'Hila, Lolo!'),
    (5,11,'Ngiti ng apo.'),
    (5,12,'Wala ang bibi.'),
    (5,13,'Puno ng tawa.'),
    (5,14,'Ako ay guro.'),
    (5,15,'Bata ang apo.'),
    (5,16,'Kusina ni Ina.'),
    (5,17,'Toyo sa kusina.'),
    (5,18,'Lasa ng ube.'),
    (5,19,'Sa hilaga ang bato.'),
    (5,20,'Masaya sila.')
)
INSERT INTO public.reading_module_items(module_id, content_id, item_order, role)
SELECT module.id, content.id, map.item_order, 'instruction'
FROM module_map map
JOIN public.reading_modules module
  ON module.curriculum_version = 'presentation_beginner_mvp_v1'
 AND module.level = 'Intermediate' AND module.module_number = map.module_number
JOIN public.reading_content content
  ON content.level = 'Intermediate' AND content.content_type = 'phrase'
 AND content.backend_category = 'presentation_mvp_intermediate'
 AND content.normalized_text = lower(map.phrase)
ON CONFLICT (module_id, content_id) DO UPDATE SET
  item_order = EXCLUDED.item_order, role = 'instruction';

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.reading_module_items item
      JOIN public.reading_modules module ON module.id = item.module_id
      WHERE module.level = 'Intermediate') <> 40 THEN
    RAISE EXCEPTION 'Expected all 40 curated phrases to be mapped into Intermediate modules 1-5';
  END IF;
END;
$$;

-- Prerequisites: 2<-1, 3<-2, 4<-3, 5<-4.
INSERT INTO public.reading_module_prerequisites(module_id, prerequisite_module_id)
SELECT current_module.id, previous_module.id
FROM public.reading_modules current_module
JOIN public.reading_modules previous_module
  ON previous_module.curriculum_version = current_module.curriculum_version
 AND previous_module.level = current_module.level
 AND previous_module.module_number = current_module.module_number - 1
WHERE current_module.level = 'Intermediate' AND current_module.module_number BETWEEN 2 AND 5
ON CONFLICT DO NOTHING;

-- ============================================================
-- PART 4: Assessments. Modules 1-4 (5 items each) use the standard
-- 4-question format (items 1-4 of 5), same as Beginner Modules 1-16.
-- Module 5 (20-item capstone) uses the same 10-question format approved
-- for Beginner Module 17 (even positions 2,4,...,20) - start_module_
-- assessment already supports variable question counts as of migration
-- 048, so no function change is needed here.
-- ============================================================
INSERT INTO public.reading_module_assessments(
  module_id, title, instructions, scoring_policy, version, is_active
)
SELECT module.id,
  CASE WHEN module.module_number = 5 THEN 'Pagsusulit sa Pagsasanib ng mga Parirala'
       ELSE format('Pagsusulit sa Modyul %s', module.module_number) END,
  CASE WHEN module.module_number = 5
       THEN 'Bigkasin nang malinaw ang sampung item. Kailangan ang 75% upang makapasa.'
       ELSE 'Bigkasin nang malinaw ang apat na item. Kailangan ang 75% upang makapasa.' END,
  'weighted_average_accuracy', 1, false
FROM public.reading_modules module
WHERE module.level = 'Intermediate'
ON CONFLICT (module_id) DO UPDATE SET
  title = EXCLUDED.title, instructions = EXCLUDED.instructions,
  scoring_policy = EXCLUDED.scoring_policy, version = 1, is_active = false;

WITH assessment_selection_small(module_item_order, assessment_item_order) AS (
  VALUES (1,1),(2,2),(3,3),(4,4)
)
INSERT INTO public.reading_module_assessment_items(
  assessment_id, module_item_id, item_order, weight, is_required
)
SELECT assessment.id, module_item.id, selection.assessment_item_order, 1, true
FROM assessment_selection_small selection
JOIN public.reading_modules module
  ON module.level = 'Intermediate' AND module.module_number BETWEEN 1 AND 4
JOIN public.reading_module_assessments assessment ON assessment.module_id = module.id
JOIN public.reading_module_items module_item
  ON module_item.module_id = module.id
 AND module_item.item_order = selection.module_item_order
ON CONFLICT (assessment_id, module_item_id) DO UPDATE SET
  item_order = EXCLUDED.item_order, weight = 1, is_required = true;

WITH assessment_selection_capstone(module_item_order, assessment_item_order) AS (
  VALUES (2,1),(4,2),(6,3),(8,4),(10,5),(12,6),(14,7),(16,8),(18,9),(20,10)
)
INSERT INTO public.reading_module_assessment_items(
  assessment_id, module_item_id, item_order, weight, is_required
)
SELECT assessment.id, module_item.id, selection.assessment_item_order, 1, true
FROM assessment_selection_capstone selection
JOIN public.reading_modules module
  ON module.level = 'Intermediate' AND module.module_number = 5
JOIN public.reading_module_assessments assessment ON assessment.module_id = module.id
JOIN public.reading_module_items module_item
  ON module_item.module_id = module.id
 AND module_item.item_order = selection.module_item_order
ON CONFLICT (assessment_id, module_item_id) DO UPDATE SET
  item_order = EXCLUDED.item_order, weight = 1, is_required = true;

-- ============================================================
-- PART 5: Activate. Scoped by level so Beginner and Advanced (both sharing
-- the same curriculum_version) are never touched.
-- ============================================================
UPDATE public.reading_modules SET is_active = true WHERE level = 'Intermediate';

UPDATE public.reading_module_assessments assessment SET is_active = true
FROM public.reading_modules module
WHERE module.id = assessment.module_id AND module.level = 'Intermediate';

COMMIT;

NOTIFY pgrst, 'reload schema';
