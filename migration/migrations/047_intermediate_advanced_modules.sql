-- INTERMEDIATE & ADVANCED MODULES (presentation MVP extension)
--
-- Migration 043 activated only Beginner Modules 1-5. Intermediate and
-- Advanced already have fully seeded reading_content (200 Intermediate
-- phrases, 200 Advanced sentences - see migrations 024/025/026) but no
-- reading_modules rows ever organized that content into a module path, so
-- students placed at those levels saw an empty Learn tab.
--
-- Per explicit product decision: Intermediate = 10 modules, Advanced = 10
-- modules, 5 items each (same module size as Beginner's phonetic modules),
-- drawn from the first 5-of-every-20 slice of the existing 200 phrases /
-- 200 sentences so each module still lands inside a distinct content theme
-- (Paglalarawang 1-100, Pandiwa 101-120, Panlunan/Pamanahon 121-200). The
-- remaining ~150 items per level, Advanced paragraphs, and the raw word
-- banks remain future work, same as the unactivated 15-consonant Beginner
-- curriculum.
--
-- IMPORTANT: validate_active_module_curriculum_version_trigger (migration
-- 042) enforces that only ONE curriculum_version may be is_active=true at
-- a time across the WHOLE table, not scoped per level. So these new
-- Intermediate/Advanced modules reuse the SAME curriculum_version already
-- active for Beginner ('presentation_beginner_mvp_v1') rather than a
-- version string of their own - every step below is therefore scoped by
-- level, never by curriculum_version alone, so the existing Beginner rows
-- (which share that same version string) are never touched.

BEGIN;

-- Fail loudly if the expected seeded content has drifted since this was written.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.reading_content
      WHERE level='Intermediate' AND content_type='phrase' AND is_active) <> 200 THEN
    RAISE EXCEPTION 'Expected exactly 200 active Intermediate phrases before module activation';
  END IF;
  IF (SELECT COUNT(*) FROM public.reading_content
      WHERE level='Advanced' AND content_type='sentence' AND is_active) <> 200 THEN
    RAISE EXCEPTION 'Expected exactly 200 active Advanced sentences before module activation';
  END IF;
END;
$$;

-- Ten modules per level, inactive until content/prerequisites/assessments
-- are wired up below (same order of operations as migration 043).
INSERT INTO public.reading_modules (
  curriculum_version, level, module_number, title, description,
  instructional_content_type, assessment_pass_percentage, is_required, is_active
)
VALUES
  ('presentation_beginner_mvp_v1','Intermediate',1,'Paglalarawang Parirala 1','Basahin ang mga pariralang naglalarawan ng tao gamit ang "na/-ng".','phrase',75,true,false),
  ('presentation_beginner_mvp_v1','Intermediate',2,'Paglalarawang Parirala 2','Ipagpatuloy ang pagbasa ng mga paglalarawang parirala.','phrase',75,true,false),
  ('presentation_beginner_mvp_v1','Intermediate',3,'Paglalarawang Parirala 3','Ipagpatuloy ang pagbasa ng mga paglalarawang parirala.','phrase',75,true,false),
  ('presentation_beginner_mvp_v1','Intermediate',4,'Paglalarawang Parirala 4','Ipagpatuloy ang pagbasa ng mga paglalarawang parirala.','phrase',75,true,false),
  ('presentation_beginner_mvp_v1','Intermediate',5,'Paglalarawang Parirala 5','Tapusin ang mga paglalarawang parirala.','phrase',75,true,false),
  ('presentation_beginner_mvp_v1','Intermediate',6,'Pariralang Pandiwa','Basahin ang mga pariralang naglalarawan ng kilos o gawain.','phrase',75,true,false),
  ('presentation_beginner_mvp_v1','Intermediate',7,'Pariralang Panlunan at Pamanahon 1','Basahin ang mga pariralang naglalarawan ng lugar at panahon.','phrase',75,true,false),
  ('presentation_beginner_mvp_v1','Intermediate',8,'Pariralang Panlunan at Pamanahon 2','Ipagpatuloy ang mga pariralang panlunan at pamanahon.','phrase',75,true,false),
  ('presentation_beginner_mvp_v1','Intermediate',9,'Pariralang Panlunan at Pamanahon 3','Ipagpatuloy ang mga pariralang panlunan at pamanahon.','phrase',75,true,false),
  ('presentation_beginner_mvp_v1','Intermediate',10,'Pariralang Panlunan at Pamanahon 4','Tapusin ang mga pariralang panlunan at pamanahon.','phrase',75,true,false),
  ('presentation_beginner_mvp_v1','Advanced',1,'Pangungusap 1','Basahin ang mga buong pangungusap nang may wastong daloy.','sentence',75,true,false),
  ('presentation_beginner_mvp_v1','Advanced',2,'Pangungusap 2','Ipagpatuloy ang pagbasa ng mga pangungusap.','sentence',75,true,false),
  ('presentation_beginner_mvp_v1','Advanced',3,'Pangungusap 3','Ipagpatuloy ang pagbasa ng mga pangungusap.','sentence',75,true,false),
  ('presentation_beginner_mvp_v1','Advanced',4,'Pangungusap 4','Ipagpatuloy ang pagbasa ng mga pangungusap.','sentence',75,true,false),
  ('presentation_beginner_mvp_v1','Advanced',5,'Pangungusap 5','Ipagpatuloy ang pagbasa ng mga pangungusap.','sentence',75,true,false),
  ('presentation_beginner_mvp_v1','Advanced',6,'Pangungusap 6','Ipagpatuloy ang pagbasa ng mga pangungusap.','sentence',75,true,false),
  ('presentation_beginner_mvp_v1','Advanced',7,'Pangungusap 7','Ipagpatuloy ang pagbasa ng mga pangungusap.','sentence',75,true,false),
  ('presentation_beginner_mvp_v1','Advanced',8,'Pangungusap 8','Ipagpatuloy ang pagbasa ng mga pangungusap.','sentence',75,true,false),
  ('presentation_beginner_mvp_v1','Advanced',9,'Pangungusap 9','Ipagpatuloy ang pagbasa ng mga pangungusap.','sentence',75,true,false),
  ('presentation_beginner_mvp_v1','Advanced',10,'Pangungusap 10','Tapusin ang mga pangungusap.','sentence',75,true,false)
ON CONFLICT (curriculum_version, level, module_number) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  instructional_content_type = EXCLUDED.instructional_content_type,
  assessment_pass_percentage = 75,
  is_required = true,
  is_active = false;

-- Intermediate: take the first 5 of every 20-item block (module_number =
-- ceil(seq/20), local item_order = ((seq-1) % 20) + 1, keep only <= 5) so
-- each module still lands inside one content theme.
INSERT INTO public.reading_module_items(module_id, content_id, item_order, role)
SELECT module.id, content.id,
  ((content.sequence_no - 1) % 20) + 1,
  'instruction'
FROM public.reading_content content
JOIN public.reading_modules module
  ON module.level = 'Intermediate'
 AND module.curriculum_version = 'presentation_beginner_mvp_v1'
 AND module.module_number = ((content.sequence_no - 1) / 20) + 1
WHERE content.level = 'Intermediate' AND content.content_type = 'phrase' AND content.is_active
  AND ((content.sequence_no - 1) % 20) < 5
ON CONFLICT (module_id, content_id) DO UPDATE SET
  item_order = EXCLUDED.item_order, role = 'instruction';

-- Advanced: same slicing, 5 sentences per module.
INSERT INTO public.reading_module_items(module_id, content_id, item_order, role)
SELECT module.id, content.id,
  ((content.sequence_no - 1) % 20) + 1,
  'instruction'
FROM public.reading_content content
JOIN public.reading_modules module
  ON module.level = 'Advanced'
 AND module.curriculum_version = 'presentation_beginner_mvp_v1'
 AND module.module_number = ((content.sequence_no - 1) / 20) + 1
WHERE content.level = 'Advanced' AND content.content_type = 'sentence' AND content.is_active
  AND ((content.sequence_no - 1) % 20) < 5
ON CONFLICT (module_id, content_id) DO UPDATE SET
  item_order = EXCLUDED.item_order, role = 'instruction';

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.reading_module_items item
      JOIN public.reading_modules module ON module.id = item.module_id
      WHERE module.level = 'Intermediate') <> 50 THEN
    RAISE EXCEPTION 'Expected exactly 50 Intermediate phrases mapped into modules (5 x 10)';
  END IF;
  IF (SELECT COUNT(*) FROM public.reading_module_items item
      JOIN public.reading_modules module ON module.id = item.module_id
      WHERE module.level = 'Advanced') <> 50 THEN
    RAISE EXCEPTION 'Expected exactly 50 Advanced sentences mapped into modules (5 x 10)';
  END IF;
END;
$$;

-- Strict sequential prerequisites: 1 -> 2 -> ... -> 10, per level. Scoped by
-- level (not curriculum_version, which Beginner now shares) so this never
-- touches Beginner's existing 1->2->..->5 chain from migration 043.
INSERT INTO public.reading_module_prerequisites(module_id, prerequisite_module_id)
SELECT current_module.id, previous_module.id
FROM public.reading_modules current_module
JOIN public.reading_modules previous_module
  ON previous_module.curriculum_version = current_module.curriculum_version
 AND previous_module.level = current_module.level
 AND previous_module.module_number = current_module.module_number - 1
WHERE current_module.level IN ('Intermediate','Advanced')
  AND current_module.module_number BETWEEN 2 AND 10
ON CONFLICT DO NOTHING;

-- One four-question assessment per module (start_module_assessment requires
-- exactly four same-module items - same contract as migration 043). Scoped
-- by level so Beginner's existing assessments are left untouched.
INSERT INTO public.reading_module_assessments(
  module_id, title, instructions, scoring_policy, version, is_active
)
SELECT module.id,
  format('Pagsusulit sa Modyul %s', module.module_number),
  'Basahin nang malinaw ang apat na item. Kailangan ang 75% upang makapasa.',
  'weighted_average_accuracy', 1, false
FROM public.reading_modules module
WHERE module.level IN ('Intermediate','Advanced')
ON CONFLICT (module_id) DO UPDATE SET
  title = EXCLUDED.title, instructions = EXCLUDED.instructions,
  scoring_policy = EXCLUDED.scoring_policy, version = 1, is_active = false;

-- Four of the five instructional items become assessment questions
-- (item_order 1-4), same pattern as Beginner modules 1-4. Scoped by level
-- so this never re-touches Beginner's own assessment items.
WITH assessment_selection(module_item_order, assessment_item_order) AS (
  VALUES (1,1),(2,2),(3,3),(4,4)
)
INSERT INTO public.reading_module_assessment_items(
  assessment_id, module_item_id, item_order, weight, is_required
)
SELECT assessment.id, module_item.id, selection.assessment_item_order, 1, true
FROM assessment_selection selection
JOIN public.reading_modules module
  ON module.level IN ('Intermediate','Advanced')
JOIN public.reading_module_assessments assessment ON assessment.module_id = module.id
JOIN public.reading_module_items module_item
  ON module_item.module_id = module.id
 AND module_item.item_order = selection.module_item_order
ON CONFLICT (assessment_id, module_item_id) DO UPDATE SET
  item_order = EXCLUDED.item_order, weight = 1, is_required = true;

-- Activate. Scoped by level so Beginner's own active rows (same
-- curriculum_version) are left exactly as migration 043 set them.
UPDATE public.reading_modules SET is_active = true
WHERE level IN ('Intermediate','Advanced')
  AND curriculum_version = 'presentation_beginner_mvp_v1';

UPDATE public.reading_module_assessments assessment SET is_active = true
FROM public.reading_modules module
WHERE module.id = assessment.module_id
  AND module.level IN ('Intermediate','Advanced');

COMMIT;

NOTIFY pgrst, 'reload schema';
