-- PRESENTATION-ONLY BEGINNER MVP (August 2026)
--
-- This is deliberately NOT the final Linaw curriculum. It activates only:
--   1. A/E/I/O/U
--   2. Ba/Be/Bi/Bo/Bu
--   3. Ka/Ke/Ki/Ko/Ku
--   4. Da/De/Di/Do/Du
--   5. 41 dictionary-verified words composed only from the tokens above
--
-- The full 15-consonant curriculum, TS/clusters, Intermediate modules, and
-- Advanced modules remain future work after the presentation. Do not infer
-- from this seed that B/K/D is the approved final Beginner scope.
--
-- This migration also hardens the dormant module RPC foundation before its
-- first activation. The existing count-based get_student_reading_progress()
-- remains the sole official level authority for this MVP.

BEGIN;

-- Assessments reuse four of the module's instructional items. Requiring a
-- duplicate role='assessment' mapping is incompatible with the table's
-- UNIQUE(module_id, content_id) constraint and would hide lesson content.
-- Same-module, same-level, and homogeneous-type checks remain mandatory.
CREATE OR REPLACE FUNCTION public.validate_reading_module_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_module_type TEXT;
  v_module_level TEXT;
  v_content_type TEXT;
  v_content_level TEXT;
BEGIN
  SELECT instructional_content_type, level
  INTO v_module_type, v_module_level
  FROM public.reading_modules
  WHERE id = NEW.module_id;

  SELECT content_type, level
  INTO v_content_type, v_content_level
  FROM public.reading_content
  WHERE id = NEW.content_id;

  IF v_module_type IS NULL OR v_content_type IS NULL THEN
    RAISE EXCEPTION 'Module and content must exist' USING ERRCODE = '23503';
  END IF;
  IF v_module_type <> v_content_type THEN
    RAISE EXCEPTION 'Module content must be homogeneous: module type %, content type %',
      v_module_type, v_content_type USING ERRCODE = '23514';
  END IF;
  IF v_module_level <> v_content_level THEN
    RAISE EXCEPTION 'Module and content levels must match: module %, content %',
      v_module_level, v_content_level USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.reading_module_assessment_items assessment_item
    JOIN public.reading_module_assessments assessment
      ON assessment.id = assessment_item.assessment_id
    WHERE assessment_item.module_item_id = NEW.id
      AND assessment.module_id <> NEW.module_id
  ) THEN
    RAISE EXCEPTION 'An assessment-linked item must remain in its assessment module'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_reading_module_assessment_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_assessment_module_id UUID;
  v_assessment_level TEXT;
  v_assessment_type TEXT;
  v_item_module_id UUID;
  v_content_level TEXT;
  v_content_type TEXT;
BEGIN
  SELECT assessment.module_id, module.level, module.instructional_content_type
  INTO v_assessment_module_id, v_assessment_level, v_assessment_type
  FROM public.reading_module_assessments assessment
  JOIN public.reading_modules module ON module.id = assessment.module_id
  WHERE assessment.id = NEW.assessment_id;

  SELECT item.module_id, content.level, content.content_type
  INTO v_item_module_id, v_content_level, v_content_type
  FROM public.reading_module_items item
  JOIN public.reading_content content ON content.id = item.content_id
  WHERE item.id = NEW.module_item_id;

  IF v_assessment_module_id IS NULL OR v_item_module_id IS NULL THEN
    RAISE EXCEPTION 'Assessment and module item must exist' USING ERRCODE = '23503';
  END IF;
  IF v_assessment_module_id <> v_item_module_id
     OR v_assessment_level <> v_content_level
     OR v_assessment_type <> v_content_type THEN
    RAISE EXCEPTION 'Assessment items must belong to the same module, level, and content type'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Prerequisites may never cross a curriculum version or reading level.
CREATE OR REPLACE FUNCTION public.validate_reading_module_prerequisite()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_module_version TEXT;
  v_prerequisite_version TEXT;
  v_module_level TEXT;
  v_prerequisite_level TEXT;
BEGIN
  SELECT curriculum_version, level INTO v_module_version, v_module_level
  FROM public.reading_modules WHERE id = NEW.module_id;
  SELECT curriculum_version, level INTO v_prerequisite_version, v_prerequisite_level
  FROM public.reading_modules WHERE id = NEW.prerequisite_module_id;

  IF v_module_version IS DISTINCT FROM v_prerequisite_version
     OR v_module_level IS DISTINCT FROM v_prerequisite_level THEN
    RAISE EXCEPTION 'Module prerequisites must belong to the same curriculum version and level'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH RECURSIVE ancestors(module_id) AS (
      SELECT prerequisite_module_id
      FROM public.reading_module_prerequisites
      WHERE module_id = NEW.prerequisite_module_id
      UNION
      SELECT prerequisite.prerequisite_module_id
      FROM public.reading_module_prerequisites prerequisite
      JOIN ancestors ON prerequisite.module_id = ancestors.module_id
    )
    SELECT 1 FROM ancestors WHERE module_id = NEW.module_id
  ) THEN
    RAISE EXCEPTION 'Module prerequisite cycle detected' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Five canonical vowel rows. These cannot remain UI-only constants because
-- module membership, attempts, completions, and assessment responses require
-- stable reading_content IDs.
INSERT INTO public.reading_content (
  content_text, normalized_text, content_type, level, sequence_no,
  source_sheet, source_row, pattern_note, backend_category,
  is_assessment, is_active, syllable_hyphenation, definition,
  definition_needs_review
)
SELECT vowel, lower(vowel), 'phonetic', 'Beginner', 10000 + item_order,
  'Presentation MVP - Beginner Vowels', item_order,
  'Presentation-only Module 1 vowel', 'presentation_mvp_vowel',
  false, true, vowel, 'Isang patinig sa alpabetong Filipino.', false
FROM (VALUES
  (1, 'A'), (2, 'E'), (3, 'I'), (4, 'O'), (5, 'U')
) AS seed(item_order, vowel)
ON CONFLICT (normalized_text, content_type, level) DO UPDATE SET
  is_active = true,
  pattern_note = EXCLUDED.pattern_note,
  backend_category = EXCLUDED.backend_category;

-- Canonical word-bank records. ON CONFLICT deliberately reuses existing
-- Beginner rows (including baka, baba, and buko) rather than duplicating them.
WITH approved_words(word, syllables, definition, item_order) AS (
  VALUES
    ('aba','a-ba','Katagang nagpapahayag ng pagkagulat o paghanga.',1),
    ('abo','a-bo','Pulbos na natitira matapos masunog ang isang bagay.',2),
    ('ada','a-da','Engkantada o diwata.',3),
    ('ako','a-ko','Panghalip na ginagamit ng nagsasalita para sa sarili.',4),
    ('baba','ba-ba','Ibabang bahagi ng mukha.',5),
    ('baka','ba-ka','Malaking maamong hayop na maaaring pagkunan ng gatas.',6),
    ('bako','ba-ko','Umbok o hindi pantay na bahagi ng isang ibabaw.',7),
    ('bibe','bi-be','Pato o batang pato.',8),
    ('bibo','bi-bo','Masigla at aktibo.',9),
    ('bida','bi-da','Pangunahing tauhan o bayani sa kuwento.',10),
    ('biko','bi-ko','Matamis na kakaning gawa sa malagkit na bigas.',11),
    ('buka','bu-ka','Bukas na espasyo o lagusan.',12),
    ('buko','bu-ko','Batang bunga ng niyog.',13),
    ('buo','bu-o','May lahat ng kailangang bahagi; kumpleto.',14),
    ('dako','da-ko','Pook, lugar, o direksiyon.',15),
    ('dike','di-ke','Mataas na harang na kumokontrol sa tubig.',16),
    ('duda','du-da','Pag-aalinlangan o kawalan ng katiyakan.',17),
    ('duko','du-ko','Nakahilig pababa ang ulo.',18),
    ('iba','i-ba','Hindi katulad; panibago o bukod.',19),
    ('kaba','ka-ba','Mabilis na tibok ng puso dahil sa takot o pagkabigla.',20),
    ('kada','ka-da','Bawat isa.',21),
    ('kibo','ki-bo','Maliit na kilos o tugon.',22),
    ('kubo','ku-bo','Maliit na bahay na karaniwang yari sa magaang materyales.',23),
    ('kuko','ku-ko','Matigas na bahagi sa dulo ng daliri.',24),
    ('oo','o-o','Tugon na nagpapahayag ng pagsang-ayon.',25),
    ('ube','u-be','Halamang-ugat na kulay lila.',26),
    ('ubo','u-bo','Biglaang paglabas ng hangin mula sa baga na may tunog.',27),
    ('abaka','a-ba-ka','Halamang kauri ng saging na pinagkukunan ng hibla.',28),
    ('adobo','a-do-bo','Putaheng niluluto sa suka at mga pampalasa.',29),
    ('babae','ba-ba-e','Babaeng tao o batang babae.',30),
    ('dekada','de-ka-da','Panahon na binubuo ng sampung taon.',31),
    ('ibaba','i-ba-ba','Ilagay o dalhin sa mas mababang lugar.',32),
    ('kabado','ka-ba-do','Kinakabahan o nag-aalala.',33),
    ('kabibe','ka-bi-be','Matigas na balot ng lamang-dagat na mollusk.',34),
    ('kaiba','ka-i-ba','Hindi karaniwan o naiiba.',35),
    ('abakada','a-ba-ka-da','Tradisyonal na paraan ng pagbigkas sa alpabetong Filipino.',36),
    ('abokado','a-bo-ka-do','Prutas na berde o dilaw ang malambot na laman.',37),
    ('edukado','e-du-ka-do','May pinag-aralan.',38),
    ('kakaiba','ka-ka-i-ba','Lubhang naiiba o hindi karaniwan.',39),
    ('bako-bako','ba-ko-ba-ko','Maraming bako o hindi pantay.',40),
    ('iba-iba','i-ba-i-ba','Sari-sari o hindi magkakatulad.',41)
)
INSERT INTO public.words (
  word, level, syllable_count, has_diphthong, has_consonant_cluster
)
SELECT word, 'beginner',
  array_length(string_to_array(replace(syllables, '--', '-'), '-'), 1),
  false, false
FROM approved_words
ON CONFLICT (word, level) DO UPDATE SET
  syllable_count = EXCLUDED.syllable_count,
  has_diphthong = false,
  has_consonant_cluster = false;

WITH approved_words(word, syllables, definition, item_order) AS (
  VALUES
    ('aba','a-ba','Katagang nagpapahayag ng pagkagulat o paghanga.',1),
    ('abo','a-bo','Pulbos na natitira matapos masunog ang isang bagay.',2),
    ('ada','a-da','Engkantada o diwata.',3),
    ('ako','a-ko','Panghalip na ginagamit ng nagsasalita para sa sarili.',4),
    ('baba','ba-ba','Ibabang bahagi ng mukha.',5),
    ('baka','ba-ka','Malaking maamong hayop na maaaring pagkunan ng gatas.',6),
    ('bako','ba-ko','Umbok o hindi pantay na bahagi ng isang ibabaw.',7),
    ('bibe','bi-be','Pato o batang pato.',8),
    ('bibo','bi-bo','Masigla at aktibo.',9),
    ('bida','bi-da','Pangunahing tauhan o bayani sa kuwento.',10),
    ('biko','bi-ko','Matamis na kakaning gawa sa malagkit na bigas.',11),
    ('buka','bu-ka','Bukas na espasyo o lagusan.',12),
    ('buko','bu-ko','Batang bunga ng niyog.',13),
    ('buo','bu-o','May lahat ng kailangang bahagi; kumpleto.',14),
    ('dako','da-ko','Pook, lugar, o direksiyon.',15),
    ('dike','di-ke','Mataas na harang na kumokontrol sa tubig.',16),
    ('duda','du-da','Pag-aalinlangan o kawalan ng katiyakan.',17),
    ('duko','du-ko','Nakahilig pababa ang ulo.',18),
    ('iba','i-ba','Hindi katulad; panibago o bukod.',19),
    ('kaba','ka-ba','Mabilis na tibok ng puso dahil sa takot o pagkabigla.',20),
    ('kada','ka-da','Bawat isa.',21),
    ('kibo','ki-bo','Maliit na kilos o tugon.',22),
    ('kubo','ku-bo','Maliit na bahay na karaniwang yari sa magaang materyales.',23),
    ('kuko','ku-ko','Matigas na bahagi sa dulo ng daliri.',24),
    ('oo','o-o','Tugon na nagpapahayag ng pagsang-ayon.',25),
    ('ube','u-be','Halamang-ugat na kulay lila.',26),
    ('ubo','u-bo','Biglaang paglabas ng hangin mula sa baga na may tunog.',27),
    ('abaka','a-ba-ka','Halamang kauri ng saging na pinagkukunan ng hibla.',28),
    ('adobo','a-do-bo','Putaheng niluluto sa suka at mga pampalasa.',29),
    ('babae','ba-ba-e','Babaeng tao o batang babae.',30),
    ('dekada','de-ka-da','Panahon na binubuo ng sampung taon.',31),
    ('ibaba','i-ba-ba','Ilagay o dalhin sa mas mababang lugar.',32),
    ('kabado','ka-ba-do','Kinakabahan o nag-aalala.',33),
    ('kabibe','ka-bi-be','Matigas na balot ng lamang-dagat na mollusk.',34),
    ('kaiba','ka-i-ba','Hindi karaniwan o naiiba.',35),
    ('abakada','a-ba-ka-da','Tradisyonal na paraan ng pagbigkas sa alpabetong Filipino.',36),
    ('abokado','a-bo-ka-do','Prutas na berde o dilaw ang malambot na laman.',37),
    ('edukado','e-du-ka-do','May pinag-aralan.',38),
    ('kakaiba','ka-ka-i-ba','Lubhang naiiba o hindi karaniwan.',39),
    ('bako-bako','ba-ko-ba-ko','Maraming bako o hindi pantay.',40),
    ('iba-iba','i-ba-i-ba','Sari-sari o hindi magkakatulad.',41)
)
INSERT INTO public.reading_content (
  word_id, content_text, normalized_text, content_type, level, sequence_no,
  source_sheet, source_row, pattern_note, backend_category,
  is_assessment, is_active, syllable_hyphenation, definition,
  definition_needs_review
)
SELECT word_row.id, approved.word, approved.word, 'word', 'Beginner',
  11000 + approved.item_order, 'Presentation MVP - Beginner Words',
  approved.item_order, 'Uses only presentation MVP vowel/B/K/D tokens',
  'presentation_mvp_module_5', false, true, approved.syllables,
  approved.definition, false
FROM approved_words approved
JOIN public.words word_row
  ON word_row.word = approved.word AND word_row.level = 'beginner'
ON CONFLICT (normalized_text, content_type, level) DO UPDATE SET
  word_id = EXCLUDED.word_id,
  is_active = true,
  syllable_hyphenation = EXCLUDED.syllable_hyphenation,
  definition = EXCLUDED.definition,
  definition_needs_review = false;

-- Create the five modules inactive first; activation is the last data step.
INSERT INTO public.reading_modules (
  curriculum_version, level, module_number, title, description,
  instructional_content_type, assessment_pass_percentage, is_required, is_active
)
VALUES
  ('presentation_beginner_mvp_v1','Beginner',1,'Mga Patinig','Kilalanin at bigkasin ang A, E, I, O, at U.','phonetic',75,true,false),
  ('presentation_beginner_mvp_v1','Beginner',2,'Hanay ng Ba','Bigkasin ang Ba, Be, Bi, Bo, at Bu.','phonetic',75,true,false),
  ('presentation_beginner_mvp_v1','Beginner',3,'Hanay ng Ka','Bigkasin ang Ka, Ke, Ki, Ko, at Ku.','phonetic',75,true,false),
  ('presentation_beginner_mvp_v1','Beginner',4,'Hanay ng Da','Bigkasin ang Da, De, Di, Do, at Du.','phonetic',75,true,false),
  ('presentation_beginner_mvp_v1','Beginner',5,'Pagbuo ng Salita','Basahin ang 41 tunay na salitang gumagamit lamang ng mga natutuhang pantig.','word',75,true,false)
ON CONFLICT (curriculum_version, level, module_number) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  instructional_content_type = EXCLUDED.instructional_content_type,
  assessment_pass_percentage = 75,
  is_required = true,
  is_active = false;

-- Module 1: vowels.
WITH module AS (
  SELECT id FROM public.reading_modules
  WHERE curriculum_version='presentation_beginner_mvp_v1' AND level='Beginner' AND module_number=1
), seed(normalized_text, item_order) AS (
  VALUES ('a',1),('e',2),('i',3),('o',4),('u',5)
)
INSERT INTO public.reading_module_items(module_id, content_id, item_order, role)
SELECT module.id, content.id, seed.item_order, 'instruction'
FROM module CROSS JOIN seed
JOIN public.reading_content content
  ON content.normalized_text=seed.normalized_text
 AND content.content_type='phonetic' AND content.level='Beginner'
ON CONFLICT (module_id, content_id) DO UPDATE SET
  item_order=EXCLUDED.item_order, role='instruction';

-- Modules 2-4 reuse the workbook-backed first 15 Beginner phonetics.
WITH module_tokens(module_number, normalized_text, item_order) AS (
  VALUES
    (2,'ba',1),(2,'be',2),(2,'bi',3),(2,'bo',4),(2,'bu',5),
    (3,'ka',1),(3,'ke',2),(3,'ki',3),(3,'ko',4),(3,'ku',5),
    (4,'da',1),(4,'de',2),(4,'di',3),(4,'do',4),(4,'du',5)
)
INSERT INTO public.reading_module_items(module_id, content_id, item_order, role)
SELECT module.id, content.id, token.item_order, 'instruction'
FROM module_tokens token
JOIN public.reading_modules module
  ON module.curriculum_version='presentation_beginner_mvp_v1'
 AND module.level='Beginner' AND module.module_number=token.module_number
JOIN public.reading_content content
  ON content.normalized_text=token.normalized_text
 AND content.content_type='phonetic' AND content.level='Beginner' AND content.is_active
ON CONFLICT (module_id, content_id) DO UPDATE SET
  item_order=EXCLUDED.item_order, role='instruction';

-- Fail loudly if the expected workbook phonetics are absent.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.reading_module_items item
      JOIN public.reading_modules module ON module.id=item.module_id
      WHERE module.curriculum_version='presentation_beginner_mvp_v1'
        AND module.module_number BETWEEN 2 AND 4) <> 15 THEN
    RAISE EXCEPTION 'Expected all 15 existing Ba/Ka/Da phonetic rows before activation';
  END IF;
END;
$$;

-- Module 5 uses the approved sequence above.
WITH approved_words(word, item_order) AS (
  VALUES
    ('aba',1),('abo',2),('ada',3),('ako',4),('baba',5),('baka',6),('bako',7),
    ('bibe',8),('bibo',9),('bida',10),('biko',11),('buka',12),('buko',13),
    ('buo',14),('dako',15),('dike',16),('duda',17),('duko',18),('iba',19),
    ('kaba',20),('kada',21),('kibo',22),('kubo',23),('kuko',24),('oo',25),
    ('ube',26),('ubo',27),('abaka',28),('adobo',29),('babae',30),('dekada',31),
    ('ibaba',32),('kabado',33),('kabibe',34),('kaiba',35),('abakada',36),
    ('abokado',37),('edukado',38),('kakaiba',39),('bako-bako',40),('iba-iba',41)
), module AS (
  SELECT id FROM public.reading_modules
  WHERE curriculum_version='presentation_beginner_mvp_v1' AND level='Beginner' AND module_number=5
)
INSERT INTO public.reading_module_items(module_id, content_id, item_order, role)
SELECT module.id, content.id, approved.item_order, 'instruction'
FROM module CROSS JOIN approved_words approved
JOIN public.reading_content content
  ON content.normalized_text=approved.word
 AND content.content_type='word' AND content.level='Beginner'
ON CONFLICT (module_id, content_id) DO UPDATE SET
  item_order=EXCLUDED.item_order, role='instruction';

-- Strict sequential prerequisites: 1 -> 2 -> 3 -> 4 -> 5.
INSERT INTO public.reading_module_prerequisites(module_id, prerequisite_module_id)
SELECT current_module.id, previous_module.id
FROM public.reading_modules current_module
JOIN public.reading_modules previous_module
  ON previous_module.curriculum_version=current_module.curriculum_version
 AND previous_module.level=current_module.level
 AND previous_module.module_number=current_module.module_number-1
WHERE current_module.curriculum_version='presentation_beginner_mvp_v1'
  AND current_module.level='Beginner'
  AND current_module.module_number BETWEEN 2 AND 5
ON CONFLICT DO NOTHING;

-- One four-question assessment per module. At 75%, three 100%-correct
-- responses out of four pass. The score remains the server-owned weighted
-- average of immutable assessment-source content attempts.
INSERT INTO public.reading_module_assessments(
  module_id, title, instructions, scoring_policy, version, is_active
)
SELECT module.id,
  format('Pagsusulit sa Modyul %s', module.module_number),
  'Bigkasin nang malinaw ang apat na item. Kailangan ang 75% upang makapasa.',
  'weighted_average_accuracy', 1, false
FROM public.reading_modules module
WHERE module.curriculum_version='presentation_beginner_mvp_v1'
  AND module.level='Beginner' AND module.module_number BETWEEN 1 AND 5
ON CONFLICT (module_id) DO UPDATE SET
  title=EXCLUDED.title, instructions=EXCLUDED.instructions,
  scoring_policy=EXCLUDED.scoring_policy, version=1, is_active=false;

WITH assessment_selection(module_number, module_item_order, assessment_item_order) AS (
  VALUES
    (1,1,1),(1,2,2),(1,3,3),(1,4,4),
    (2,1,1),(2,2,2),(2,3,3),(2,4,4),
    (3,1,1),(3,2,2),(3,3,3),(3,4,4),
    (4,1,1),(4,2,2),(4,3,3),(4,4,4),
    -- ako, baka, buko, kubo: four common words spread across the approved list.
    (5,4,1),(5,6,2),(5,13,3),(5,23,4)
)
INSERT INTO public.reading_module_assessment_items(
  assessment_id, module_item_id, item_order, weight, is_required
)
SELECT assessment.id, module_item.id, selection.assessment_item_order, 1, true
FROM assessment_selection selection
JOIN public.reading_modules module
  ON module.curriculum_version='presentation_beginner_mvp_v1'
 AND module.level='Beginner' AND module.module_number=selection.module_number
JOIN public.reading_module_assessments assessment ON assessment.module_id=module.id
JOIN public.reading_module_items module_item
  ON module_item.module_id=module.id
 AND module_item.item_order=selection.module_item_order
ON CONFLICT (assessment_id, module_item_id) DO UPDATE SET
  item_order=EXCLUDED.item_order, weight=1, is_required=true;

-- Keep official level progression count-based for this presentation MVP.
-- Module completion unlocks only the next module and never updates
-- child_progress.level or fabricates a reading-level transition.
COMMENT ON TABLE public.reading_modules IS
  'Sequential curriculum modules. presentation_beginner_mvp_v1 is a presentation-only B/K/D subset, not the final Beginner curriculum. Official level progression remains count-based until a later explicit cutover.';

-- Only the five approved presentation modules become active.
UPDATE public.reading_modules SET is_active=false
WHERE curriculum_version <> 'presentation_beginner_mvp_v1'
   OR level <> 'Beginner'
   OR module_number NOT BETWEEN 1 AND 5;

UPDATE public.reading_module_assessments assessment SET is_active=false
WHERE NOT EXISTS (
  SELECT 1 FROM public.reading_modules module
  WHERE module.id=assessment.module_id
    AND module.curriculum_version='presentation_beginner_mvp_v1'
    AND module.level='Beginner' AND module.module_number BETWEEN 1 AND 5
);

UPDATE public.reading_modules SET is_active=true
WHERE curriculum_version='presentation_beginner_mvp_v1'
  AND level='Beginner' AND module_number BETWEEN 1 AND 5;

UPDATE public.reading_module_assessments assessment SET is_active=true
FROM public.reading_modules module
WHERE module.id=assessment.module_id
  AND module.curriculum_version='presentation_beginner_mvp_v1'
  AND module.level='Beginner' AND module.module_number BETWEEN 1 AND 5;

-- Official-level isolation helper. It intentionally delegates to the legacy
-- count-based authority for this MVP rather than get_student_module_level().
CREATE OR REPLACE FUNCTION public.get_student_official_reading_level(p_student_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(public.get_student_reading_progress(p_student_id)->>'effective_level', 'Beginner');
$$;

-- Keep the pre-existing module-level reporting RPC honest during the MVP:
-- module completions are reported, but they do not become level authority.
CREATE OR REPLACE FUNCTION public.get_student_module_level(p_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_progress JSONB;
  v_level TEXT;
  v_configured BOOLEAN;
  v_beginner_complete BOOLEAN;
BEGIN
  v_progress := public.get_student_reading_progress(p_student_id);
  v_level := COALESCE(v_progress->>'effective_level','Beginner');
  SELECT EXISTS(SELECT 1 FROM public.reading_modules WHERE is_active AND level=v_level)
  INTO v_configured;
  SELECT COALESCE(bool_and(completion.id IS NOT NULL),false)
  INTO v_beginner_complete
  FROM public.reading_modules module
  LEFT JOIN public.student_module_completions completion
    ON completion.module_id=module.id AND completion.student_id=p_student_id
  WHERE module.is_active AND module.level='Beginner' AND module.is_required;
  RETURN jsonb_build_object(
    'configured',v_configured,
    'official_earned_level',v_progress->>'official_earned_level',
    'placement_override_level',v_progress->>'placement_override_level',
    'effective_level',v_level,
    'beginner_modules_complete',v_beginner_complete,
    'program_complete',v_progress->'program_complete',
    'progression_authority','legacy_counts_during_presentation_mvp'
  );
END;
$$;

-- RLS helper: signed-in students see only their official level. Non-student
-- authenticated users (for example a parent reviewing a child) retain the
-- existing read behavior; child-specific parent views remain API-scoped.
CREATE OR REPLACE FUNCTION public.is_signed_in_student_level(p_level TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id UUID;
BEGIN
  SELECT id INTO v_student_id FROM public.children
  WHERE auth_uid::text=auth.uid()::text LIMIT 1;
  IF v_student_id IS NULL THEN RETURN true; END IF;
  RETURN p_level=public.get_student_official_reading_level(v_student_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_student_module_unlocked(
  p_student_id UUID,
  p_module_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.reading_modules module
    WHERE module.id=p_module_id
      AND module.is_active
      AND module.level=public.get_student_official_reading_level(p_student_id)
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.reading_module_prerequisites prerequisite
    JOIN public.reading_modules prerequisite_module
      ON prerequisite_module.id=prerequisite.prerequisite_module_id
     AND prerequisite_module.is_active
    LEFT JOIN public.student_module_completions completion
      ON completion.module_id=prerequisite.prerequisite_module_id
     AND completion.student_id=p_student_id
    WHERE prerequisite.module_id=p_module_id
      AND completion.id IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.get_student_module_path(p_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_level TEXT;
  v_modules JSONB;
  v_current_module JSONB;
  v_configured BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.children WHERE id=p_student_id) THEN
    RAISE EXCEPTION 'Student not found' USING ERRCODE='P0002';
  END IF;
  v_level := public.get_student_official_reading_level(p_student_id);

  SELECT EXISTS(
    SELECT 1 FROM public.reading_modules
    WHERE is_active AND level=v_level
  ) INTO v_configured;

  SELECT COALESCE(jsonb_agg(payload ORDER BY module_number), '[]'::jsonb)
  INTO v_modules
  FROM (
    SELECT module.module_number,
      jsonb_build_object(
        'id',module.id,'curriculum_version',module.curriculum_version,
        'level',module.level,'module_number',module.module_number,
        'title',module.title,'description',module.description,
        'instructional_content_type',module.instructional_content_type,
        'assessment_pass_percentage',module.assessment_pass_percentage,
        'assessment_id',assessment.id,
        'state',CASE WHEN completion.id IS NOT NULL THEN 'completed'
          WHEN public.is_student_module_unlocked(p_student_id,module.id) THEN 'unlocked'
          ELSE 'locked' END,
        'completed_at',completion.completed_at,
        'content_item_count',(SELECT COUNT(*) FROM public.reading_module_items item
          WHERE item.module_id=module.id AND item.role<>'assessment'),
        'completed_content_item_count',(SELECT COUNT(*)
          FROM public.reading_module_items item
          JOIN public.student_content_completions content_completion
            ON content_completion.content_id=item.content_id
           AND content_completion.student_id=p_student_id
          WHERE item.module_id=module.id AND item.role<>'assessment')
      ) AS payload
    FROM public.reading_modules module
    LEFT JOIN public.reading_module_assessments assessment
      ON assessment.module_id=module.id AND assessment.is_active
    LEFT JOIN public.student_module_completions completion
      ON completion.module_id=module.id AND completion.student_id=p_student_id
    WHERE module.is_active
      AND module.level=v_level -- hard level boundary, not seed coincidence
  ) scoped_modules;

  SELECT entry INTO v_current_module
  FROM jsonb_array_elements(v_modules) entry
  WHERE entry->>'state'='unlocked'
  ORDER BY (entry->>'module_number')::INTEGER LIMIT 1;

  RETURN jsonb_build_object(
    'configured',v_configured,
    'effective_level',v_level,
    'progression_authority','legacy_counts_during_presentation_mvp',
    'modules',v_modules,
    'current_module',v_current_module
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_reading_module_content(
  p_student_id UUID,
  p_module_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_module public.reading_modules%ROWTYPE;
  v_level TEXT;
  v_items JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.children WHERE id=p_student_id) THEN
    RAISE EXCEPTION 'Student not found' USING ERRCODE='P0002';
  END IF;
  v_level := public.get_student_official_reading_level(p_student_id);
  SELECT * INTO v_module FROM public.reading_modules
  WHERE id=p_module_id AND is_active AND level=v_level;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active module not found at the student official level' USING ERRCODE='P0002';
  END IF;
  IF NOT public.is_student_module_unlocked(p_student_id,p_module_id)
     AND NOT EXISTS (SELECT 1 FROM public.student_module_completions
       WHERE student_id=p_student_id AND module_id=p_module_id) THEN
    RAISE EXCEPTION 'Module is locked' USING ERRCODE='42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'module_item_id',item.id,'content_id',content.id,
    'content_text',content.content_text,'content_type',content.content_type,
    'level',content.level,'item_order',item.item_order,'role',item.role,
    'word_id',content.word_id,'pattern_note',content.pattern_note,
    'syllable_hyphenation',content.syllable_hyphenation,
    'definition',content.definition,'completed',completion.id IS NOT NULL
  ) ORDER BY item.item_order),'[]'::jsonb) INTO v_items
  FROM public.reading_module_items item
  JOIN public.reading_content content
    ON content.id=item.content_id AND content.is_active
   AND content.level=v_module.level
   AND content.content_type=v_module.instructional_content_type
  LEFT JOIN public.student_content_completions completion
    ON completion.content_id=content.id AND completion.student_id=p_student_id
  WHERE item.module_id=p_module_id AND item.role<>'assessment';

  RETURN jsonb_build_object(
    'module',jsonb_build_object(
      'id',v_module.id,'curriculum_version',v_module.curriculum_version,
      'level',v_module.level,'module_number',v_module.module_number,
      'title',v_module.title,'description',v_module.description,
      'instructional_content_type',v_module.instructional_content_type,
      'assessment_pass_percentage',v_module.assessment_pass_percentage,
      'assessment_id',(SELECT id FROM public.reading_module_assessments
        WHERE module_id=v_module.id AND is_active)
    ),
    'items',v_items
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.start_module_assessment(
  p_student_id UUID,
  p_assessment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_assessment public.reading_module_assessments%ROWTYPE;
  v_module public.reading_modules%ROWTYPE;
  v_attempt_id UUID;
  v_level TEXT;
  v_items JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.children WHERE id=p_student_id) THEN
    RAISE EXCEPTION 'Student not found' USING ERRCODE='P0002';
  END IF;
  v_level := public.get_student_official_reading_level(p_student_id);
  SELECT * INTO v_assessment FROM public.reading_module_assessments
  WHERE id=p_assessment_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active assessment not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_module FROM public.reading_modules
  WHERE id=v_assessment.module_id AND is_active AND level=v_level;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assessment module is not at the student official level' USING ERRCODE='42501';
  END IF;
  IF NOT public.is_student_module_unlocked(p_student_id,v_module.id) THEN
    RAISE EXCEPTION 'Module is locked' USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reading_module_items item
    LEFT JOIN public.student_content_completions completion
      ON completion.content_id=item.content_id AND completion.student_id=p_student_id
    WHERE item.module_id=v_module.id AND item.role<>'assessment' AND completion.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Complete all instructional module items before starting the assessment'
      USING ERRCODE='P0001';
  END IF;

  SELECT id INTO v_attempt_id FROM public.student_module_assessment_attempts
  WHERE student_id=p_student_id AND assessment_id=p_assessment_id AND status='in_progress'
  ORDER BY started_at DESC LIMIT 1 FOR UPDATE;
  IF v_attempt_id IS NULL THEN
    INSERT INTO public.student_module_assessment_attempts(
      student_id,assessment_id,pass_percentage_snapshot
    ) VALUES (p_student_id,p_assessment_id,v_module.assessment_pass_percentage)
    ON CONFLICT (student_id,assessment_id) WHERE status='in_progress' DO NOTHING
    RETURNING id INTO v_attempt_id;
    IF v_attempt_id IS NULL THEN
      SELECT id INTO v_attempt_id FROM public.student_module_assessment_attempts
      WHERE student_id=p_student_id AND assessment_id=p_assessment_id AND status='in_progress'
      ORDER BY started_at DESC LIMIT 1;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'assessment_item_id',assessment_item.id,
    'content_id',content.id,'content_text',content.content_text,
    'content_type',content.content_type,'level',content.level,
    'syllable_hyphenation',content.syllable_hyphenation,
    'item_order',assessment_item.item_order
  ) ORDER BY assessment_item.item_order),'[]'::jsonb) INTO v_items
  FROM public.reading_module_assessment_items assessment_item
  JOIN public.reading_module_items module_item
    ON module_item.id=assessment_item.module_item_id
   AND module_item.module_id=v_module.id
  JOIN public.reading_content content
    ON content.id=module_item.content_id AND content.is_active
   AND content.level=v_module.level
   AND content.content_type=v_module.instructional_content_type
  WHERE assessment_item.assessment_id=p_assessment_id;

  IF jsonb_array_length(v_items) <> 4 THEN
    RAISE EXCEPTION 'Presentation MVP assessments require exactly four same-module items'
      USING ERRCODE='P0001';
  END IF;
  RETURN jsonb_build_object(
    'attempt_id',v_attempt_id,'assessment_id',p_assessment_id,
    'module_id',v_module.id,'module_level',v_module.level,
    'pass_percentage',v_module.assessment_pass_percentage,
    'status','in_progress','items',v_items
  );
END;
$$;

-- Assessment responses must still be at the student's official level when
-- submitted, not merely when the attempt was started.
CREATE OR REPLACE FUNCTION public.validate_student_module_assessment_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.student_module_assessment_attempts module_attempt
    JOIN public.reading_module_assessment_items assessment_item
      ON assessment_item.id=NEW.assessment_item_id
     AND assessment_item.assessment_id=module_attempt.assessment_id
    JOIN public.reading_module_items module_item
      ON module_item.id=assessment_item.module_item_id
    JOIN public.reading_modules module ON module.id=module_item.module_id
    JOIN public.student_content_attempts content_attempt
      ON content_attempt.id=NEW.content_attempt_id
     AND content_attempt.student_id=module_attempt.student_id
     AND content_attempt.content_id=module_item.content_id
     AND content_attempt.source='assessment'
    WHERE module_attempt.id=NEW.assessment_attempt_id
      AND module.level=public.get_student_official_reading_level(module_attempt.student_id)
      AND NEW.response_score=content_attempt.accuracy
  ) THEN
    RAISE EXCEPTION 'Assessment response does not match its student, module, official level, content, or score'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Every newly recorded student attempt (practice, recommendation, lesson,
-- diagnostic, or assessment) is constrained at the data boundary too. Only
-- audited historical imports may intentionally preserve an earlier level.
CREATE OR REPLACE FUNCTION public.validate_student_content_attempt_level()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source <> 'import' AND NOT EXISTS (
    SELECT 1 FROM public.reading_content content
    WHERE content.id=NEW.content_id
      AND content.is_active
      AND content.level=public.get_student_official_reading_level(NEW.student_id)
  ) THEN
    RAISE EXCEPTION 'Content attempt is outside the student official reading level'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_student_content_attempt_level_trigger
  ON public.student_content_attempts;
CREATE TRIGGER validate_student_content_attempt_level_trigger
  BEFORE INSERT OR UPDATE OF student_id, content_id, source
  ON public.student_content_attempts
  FOR EACH ROW EXECUTE FUNCTION public.validate_student_content_attempt_level();

-- Submission-time isolation closes the race where a student's official level
-- changes after start but before submit. Existing transactional scoring and
-- completion logic from migration 042 otherwise remains unchanged.
CREATE OR REPLACE FUNCTION public.validate_student_module_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.student_module_assessment_attempts attempt
    JOIN public.reading_module_assessments assessment ON assessment.id=attempt.assessment_id
    JOIN public.reading_modules module ON module.id=assessment.module_id
    WHERE attempt.id=NEW.qualifying_assessment_attempt_id
      AND attempt.student_id=NEW.student_id
      AND assessment.module_id=NEW.module_id
      AND module.level=public.get_student_official_reading_level(NEW.student_id)
      AND attempt.status='submitted' AND attempt.passed=true
  ) THEN
    RAISE EXCEPTION 'Module completion requires a passed assessment at the student official level'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Direct canonical-table reads are also level-isolated for signed-in student
-- accounts; isolation is not dependent on the mobile UI remembering a filter.
DROP POLICY IF EXISTS "Authenticated users read active curriculum" ON public.reading_content;
CREATE POLICY "Students read active curriculum at official level"
  ON public.reading_content FOR SELECT TO authenticated
  USING (is_active AND public.is_signed_in_student_level(level));

DROP POLICY IF EXISTS "authenticated_read_words" ON public.words;
CREATE POLICY "Students read words at official level"
  ON public.words FOR SELECT TO authenticated
  USING (public.is_signed_in_student_level(initcap(level)));

DROP POLICY IF EXISTS "Authenticated users read active modules" ON public.reading_modules;
CREATE POLICY "Students read active modules at official level"
  ON public.reading_modules FOR SELECT TO authenticated
  USING (is_active AND public.is_signed_in_student_level(level));

DROP POLICY IF EXISTS "Authenticated users read active module items" ON public.reading_module_items;
CREATE POLICY "Students read active module items at official level"
  ON public.reading_module_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.reading_modules module
    WHERE module.id=module_id AND module.is_active
      AND public.is_signed_in_student_level(module.level)
  ));

DROP POLICY IF EXISTS "Authenticated users read active module assessments" ON public.reading_module_assessments;
CREATE POLICY "Students read active assessments at official level"
  ON public.reading_module_assessments FOR SELECT TO authenticated
  USING (is_active AND EXISTS (
    SELECT 1 FROM public.reading_modules module
    WHERE module.id=module_id AND module.is_active
      AND public.is_signed_in_student_level(module.level)
  ));

DROP POLICY IF EXISTS "Authenticated users read active module assessment items" ON public.reading_module_assessment_items;
CREATE POLICY "Students read active assessment items at official level"
  ON public.reading_module_assessment_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.reading_module_assessments assessment
    JOIN public.reading_modules module ON module.id=assessment.module_id
    WHERE assessment.id=assessment_id AND assessment.is_active AND module.is_active
      AND public.is_signed_in_student_level(module.level)
  ));

DROP POLICY IF EXISTS "Authenticated users read active module prerequisites" ON public.reading_module_prerequisites;
CREATE POLICY "Students read active prerequisites at official level"
  ON public.reading_module_prerequisites FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.reading_modules module
    WHERE module.id=module_id AND module.is_active
      AND public.is_signed_in_student_level(module.level)
  ));

REVOKE ALL ON FUNCTION public.get_student_official_reading_level(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_official_reading_level(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.is_signed_in_student_level(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_signed_in_student_level(TEXT) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
