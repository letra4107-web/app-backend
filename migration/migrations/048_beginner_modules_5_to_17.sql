-- BEGINNER MODULES 5-17 (full alphabet coverage + capstone)
--
-- Migration 043 activated only Beginner Modules 1-5 (vowels, Ba/Ka/Da rows,
-- and a 41-word capstone). This migration resolves the "alphabet coverage"
-- gap: every remaining native Filipino consonant gets its own module
-- (Modules 5-16), and the word-capstone role moves to a new Module 17 with
-- a fresh, larger, dictionary-verified word list. TS and consonant clusters
-- (DYA/BRA/DRA/KWA/etc.) remain fully out of scope, same as before.
--
-- Module 5 previously held the old 41-word capstone ("Pagbuo ng Salita",
-- instructional_content_type='word'). It is repurposed here into the new
-- Ga-row phonetic module, and the old capstone role moves to Module 17 with
-- an all-new 20-word list. Verified zero student completions/attempts on
-- Module 5 in production before this migration was written - see the
-- guard below, which re-checks the same thing at migration time and aborts
-- loudly if that has changed.
--
-- Word choices for Module 17 were freshly curated (dictionary-verified,
-- same rigor as the original Module 5 list) - NOT pulled from the
-- Tagalog_Phonetic_Words_Dyslexia_App_Updated.xlsx workbook. Ten of the 20
-- happen to already exist as active Beginner/word content from an earlier,
-- unrelated "Level 1 Simple" seed - those are reused via ON CONFLICT rather
-- than duplicated; the other ten are newly inserted.

BEGIN;

-- Abort loudly if production state has drifted since this was written -
-- repurposing Module 5's content type is only safe with zero completions.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.student_module_completions completion
    JOIN public.reading_modules module ON module.id = completion.module_id
    WHERE module.curriculum_version = 'presentation_beginner_mvp_v1'
      AND module.level = 'Beginner' AND module.module_number = 5
  ) THEN
    RAISE EXCEPTION 'Beginner module 5 already has student completions - aborting repurpose';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.student_module_assessment_attempts attempt
    JOIN public.reading_module_assessments assessment ON assessment.id = attempt.assessment_id
    JOIN public.reading_modules module ON module.id = assessment.module_id
    WHERE module.curriculum_version = 'presentation_beginner_mvp_v1'
      AND module.level = 'Beginner' AND module.module_number = 5
  ) THEN
    RAISE EXCEPTION 'Beginner module 5 already has assessment attempts - aborting repurpose';
  END IF;
END;
$$;

-- ============================================================
-- PART 1: Detach module 5's old word-list role (confirmed empty
-- above) so it can become a phonetic module like 2-4. The
-- underlying reading_content/words rows for the old 41-word list
-- are left untouched - only the module linkage is removed.
-- ============================================================
DELETE FROM public.reading_module_assessment_items
WHERE assessment_id IN (
  SELECT assessment.id FROM public.reading_module_assessments assessment
  JOIN public.reading_modules module ON module.id = assessment.module_id
  WHERE module.curriculum_version = 'presentation_beginner_mvp_v1'
    AND module.level = 'Beginner' AND module.module_number = 5
);
DELETE FROM public.reading_module_assessments
WHERE module_id IN (
  SELECT id FROM public.reading_modules
  WHERE curriculum_version = 'presentation_beginner_mvp_v1' AND level = 'Beginner' AND module_number = 5
);
DELETE FROM public.reading_module_items
WHERE module_id IN (
  SELECT id FROM public.reading_modules
  WHERE curriculum_version = 'presentation_beginner_mvp_v1' AND level = 'Beginner' AND module_number = 5
);

-- ============================================================
-- PART 2: Modules 5-16 - twelve consonant-row phonetic modules.
-- Inactive first (same deferred-activation discipline as
-- migration 043); module 5's type flips from 'word' to 'phonetic'
-- here, safe now that its old items were cleared in Part 1.
-- ============================================================
INSERT INTO public.reading_modules (
  curriculum_version, level, module_number, title, description,
  instructional_content_type, assessment_pass_percentage, is_required, is_active
)
VALUES
  ('presentation_beginner_mvp_v1','Beginner',5,'Hanay ng Ga','Bigkasin ang Ga, Ge, Gi, Go, at Gu.','phonetic',75,true,false),
  ('presentation_beginner_mvp_v1','Beginner',6,'Hanay ng Ha','Bigkasin ang Ha, He, Hi, Ho, at Hu.','phonetic',75,true,false),
  ('presentation_beginner_mvp_v1','Beginner',7,'Hanay ng La','Bigkasin ang La, Le, Li, Lo, at Lu.','phonetic',75,true,false),
  ('presentation_beginner_mvp_v1','Beginner',8,'Hanay ng Ma','Bigkasin ang Ma, Me, Mi, Mo, at Mu.','phonetic',75,true,false),
  ('presentation_beginner_mvp_v1','Beginner',9,'Hanay ng Na','Bigkasin ang Na, Ne, Ni, No, at Nu.','phonetic',75,true,false),
  ('presentation_beginner_mvp_v1','Beginner',10,'Hanay ng Nga','Bigkasin ang Nga, Nge, Ngi, Ngo, at Ngu.','phonetic',75,true,false),
  ('presentation_beginner_mvp_v1','Beginner',11,'Hanay ng Pa','Bigkasin ang Pa, Pe, Pi, Po, at Pu.','phonetic',75,true,false),
  ('presentation_beginner_mvp_v1','Beginner',12,'Hanay ng Ra','Bigkasin ang Ra, Re, Ri, Ro, at Ru.','phonetic',75,true,false),
  ('presentation_beginner_mvp_v1','Beginner',13,'Hanay ng Sa','Bigkasin ang Sa, Se, Si, So, at Su.','phonetic',75,true,false),
  ('presentation_beginner_mvp_v1','Beginner',14,'Hanay ng Ta','Bigkasin ang Ta, Te, Ti, To, at Tu.','phonetic',75,true,false),
  ('presentation_beginner_mvp_v1','Beginner',15,'Hanay ng Wa','Bigkasin ang Wa, We, Wi, Wo, at Wu.','phonetic',75,true,false),
  ('presentation_beginner_mvp_v1','Beginner',16,'Hanay ng Ya','Bigkasin ang Ya, Ye, Yi, Yo, at Yu.','phonetic',75,true,false)
ON CONFLICT (curriculum_version, level, module_number) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  instructional_content_type = EXCLUDED.instructional_content_type,
  assessment_pass_percentage = 75,
  is_required = true,
  is_active = false;

-- Reuse the existing workbook-backed phonetic rows for each consonant row -
-- same pattern Modules 2-4 already used in migration 043. These are plain
-- CV syllable tokens, not curated word/phrase content, so the "don't pull
-- from the xlsx workbook" rule doesn't apply to them (per the approved plan).
WITH module_tokens(module_number, normalized_text, item_order) AS (
  VALUES
    (5,'ga',1),(5,'ge',2),(5,'gi',3),(5,'go',4),(5,'gu',5),
    (6,'ha',1),(6,'he',2),(6,'hi',3),(6,'ho',4),(6,'hu',5),
    (7,'la',1),(7,'le',2),(7,'li',3),(7,'lo',4),(7,'lu',5),
    (8,'ma',1),(8,'me',2),(8,'mi',3),(8,'mo',4),(8,'mu',5),
    (9,'na',1),(9,'ne',2),(9,'ni',3),(9,'no',4),(9,'nu',5),
    (10,'nga',1),(10,'nge',2),(10,'ngi',3),(10,'ngo',4),(10,'ngu',5),
    (11,'pa',1),(11,'pe',2),(11,'pi',3),(11,'po',4),(11,'pu',5),
    (12,'ra',1),(12,'re',2),(12,'ri',3),(12,'ro',4),(12,'ru',5),
    (13,'sa',1),(13,'se',2),(13,'si',3),(13,'so',4),(13,'su',5),
    (14,'ta',1),(14,'te',2),(14,'ti',3),(14,'to',4),(14,'tu',5),
    (15,'wa',1),(15,'we',2),(15,'wi',3),(15,'wo',4),(15,'wu',5),
    (16,'ya',1),(16,'ye',2),(16,'yi',3),(16,'yo',4),(16,'yu',5)
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

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.reading_module_items item
      JOIN public.reading_modules module ON module.id=item.module_id
      WHERE module.curriculum_version='presentation_beginner_mvp_v1'
        AND module.level='Beginner' AND module.module_number BETWEEN 5 AND 16) <> 60 THEN
    RAISE EXCEPTION 'Expected all 60 phonetic rows (12 modules x 5) for Modules 5-16';
  END IF;
END;
$$;

-- Prerequisites: 5<-4 (already existed from migration 043; re-affirmed here
-- harmlessly), then 6<-5, 7<-6, ..., 16<-15.
INSERT INTO public.reading_module_prerequisites(module_id, prerequisite_module_id)
SELECT current_module.id, previous_module.id
FROM public.reading_modules current_module
JOIN public.reading_modules previous_module
  ON previous_module.curriculum_version=current_module.curriculum_version
 AND previous_module.level=current_module.level
 AND previous_module.module_number=current_module.module_number-1
WHERE current_module.curriculum_version='presentation_beginner_mvp_v1'
  AND current_module.level='Beginner'
  AND current_module.module_number BETWEEN 5 AND 16
ON CONFLICT DO NOTHING;

-- Four-question assessments for Modules 5-16 (items 1-4 of each module's 5,
-- same pattern as Modules 1-4).
INSERT INTO public.reading_module_assessments(
  module_id, title, instructions, scoring_policy, version, is_active
)
SELECT module.id,
  format('Pagsusulit sa Modyul %s', module.module_number),
  'Bigkasin nang malinaw ang apat na item. Kailangan ang 75% upang makapasa.',
  'weighted_average_accuracy', 1, false
FROM public.reading_modules module
WHERE module.curriculum_version='presentation_beginner_mvp_v1'
  AND module.level='Beginner' AND module.module_number BETWEEN 5 AND 16
ON CONFLICT (module_id) DO UPDATE SET
  title=EXCLUDED.title, instructions=EXCLUDED.instructions,
  scoring_policy=EXCLUDED.scoring_policy, version=1, is_active=false;

WITH assessment_selection(module_item_order, assessment_item_order) AS (
  VALUES (1,1),(2,2),(3,3),(4,4)
)
INSERT INTO public.reading_module_assessment_items(
  assessment_id, module_item_id, item_order, weight, is_required
)
SELECT assessment.id, module_item.id, selection.assessment_item_order, 1, true
FROM assessment_selection selection
JOIN public.reading_modules module
  ON module.curriculum_version='presentation_beginner_mvp_v1'
 AND module.level='Beginner' AND module.module_number BETWEEN 5 AND 16
JOIN public.reading_module_assessments assessment ON assessment.module_id=module.id
JOIN public.reading_module_items module_item
  ON module_item.module_id=module.id
 AND module_item.item_order=selection.module_item_order
ON CONFLICT (assessment_id, module_item_id) DO UPDATE SET
  item_order=EXCLUDED.item_order, weight=1, is_required=true;

-- ============================================================
-- PART 3: Module 17 - 20-word capstone (approved list, dictionary-
-- verified, pure open-CV syllables spanning all 15 taught consonant
-- rows). Ten already exist as active Beginner/word content from the
-- unrelated "Level 1 Simple" seed - reused via ON CONFLICT; the
-- other ten are newly inserted here.
-- ============================================================
WITH approved_words(word, syllables, definition, item_order) AS (
  VALUES
    ('bata','ba-ta','Isang batang tao, hindi pa matanda.',1),
    ('mata','ma-ta','Bahagi ng katawan na ginagamit sa paningin.',2),
    ('puti','pu-ti','Ang kulay ng gatas o niyebe.',3),
    ('pula','pu-la','Ang kulay ng dugo o hinog na kamatis.',4),
    ('bago','ba-go','Hindi pa ginagamit; kasalungat ng luma.',5),
    ('luma','lu-ma','Matagal nang ginagamit; kasalungat ng bago.',6),
    ('gabi','ga-bi','Ang bahagi ng araw kung kailan madilim na.',7),
    ('tawa','ta-wa','Ang tunog na ginagawa kapag masaya.',8),
    ('sabi','sa-bi','Ang sinabi o ipinahayag ng isang tao.',9),
    ('laro','la-ro','Isang gawaing ginagawa para sa saya o libangan.',10),
    ('lasa','la-sa','Ang nararamdaman ng dila kapag kumakain.',11),
    ('dami','da-mi','Ang bilang o sukat ng isang bagay.',12),
    ('bato','ba-to','Matigas na bagay na galing sa lupa.',13),
    ('guro','gu-ro','Ang taong nagtuturo sa paaralan.',14),
    ('hila','hi-la','Ang paggalaw ng bagay papalapit sa sarili.',15),
    ('ngiti','ngi-ti','Ang ekspresyong nagpapakita ng saya.',16),
    ('wala','wa-la','Ang kasalungat ng meron.',17),
    ('yaya','ya-ya','Ang taong nag-aalaga sa bata.',18),
    ('masaya','ma-sa-ya','Ang nararamdaman kapag natutuwa.',19),
    ('kusina','ku-si-na','Ang silid na pinagluluto ng pagkain.',20)
)
INSERT INTO public.words (
  word, level, syllable_count, has_diphthong, has_consonant_cluster
)
SELECT word, 'beginner',
  array_length(string_to_array(syllables, '-'), 1),
  false, false
FROM approved_words
ON CONFLICT (word, level) DO UPDATE SET
  syllable_count = EXCLUDED.syllable_count,
  has_diphthong = false,
  has_consonant_cluster = false;

WITH approved_words(word, syllables, definition, item_order) AS (
  VALUES
    ('bata','ba-ta','Isang batang tao, hindi pa matanda.',1),
    ('mata','ma-ta','Bahagi ng katawan na ginagamit sa paningin.',2),
    ('puti','pu-ti','Ang kulay ng gatas o niyebe.',3),
    ('pula','pu-la','Ang kulay ng dugo o hinog na kamatis.',4),
    ('bago','ba-go','Hindi pa ginagamit; kasalungat ng luma.',5),
    ('luma','lu-ma','Matagal nang ginagamit; kasalungat ng bago.',6),
    ('gabi','ga-bi','Ang bahagi ng araw kung kailan madilim na.',7),
    ('tawa','ta-wa','Ang tunog na ginagawa kapag masaya.',8),
    ('sabi','sa-bi','Ang sinabi o ipinahayag ng isang tao.',9),
    ('laro','la-ro','Isang gawaing ginagawa para sa saya o libangan.',10),
    ('lasa','la-sa','Ang nararamdaman ng dila kapag kumakain.',11),
    ('dami','da-mi','Ang bilang o sukat ng isang bagay.',12),
    ('bato','ba-to','Matigas na bagay na galing sa lupa.',13),
    ('guro','gu-ro','Ang taong nagtuturo sa paaralan.',14),
    ('hila','hi-la','Ang paggalaw ng bagay papalapit sa sarili.',15),
    ('ngiti','ngi-ti','Ang ekspresyong nagpapakita ng saya.',16),
    ('wala','wa-la','Ang kasalungat ng meron.',17),
    ('yaya','ya-ya','Ang taong nag-aalaga sa bata.',18),
    ('masaya','ma-sa-ya','Ang nararamdaman kapag natutuwa.',19),
    ('kusina','ku-si-na','Ang silid na pinagluluto ng pagkain.',20)
)
INSERT INTO public.reading_content (
  word_id, content_text, normalized_text, content_type, level, sequence_no,
  source_sheet, source_row, pattern_note, backend_category,
  is_assessment, is_active, syllable_hyphenation, definition,
  definition_needs_review
)
SELECT word_row.id, approved.word, approved.word, 'word', 'Beginner',
  12000 + approved.item_order, 'Beginner Module 17 Capstone',
  approved.item_order, 'Pure open-CV word spanning Modules 5-16 consonants',
  'presentation_mvp_module_17', false, true, approved.syllables,
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

INSERT INTO public.reading_modules (
  curriculum_version, level, module_number, title, description,
  instructional_content_type, assessment_pass_percentage, is_required, is_active
)
VALUES
  ('presentation_beginner_mvp_v1','Beginner',17,'Pagbuo ng Salita','Basahin ang 20 tunay na salitang gumagamit ng lahat ng natutuhang pantig.','word',75,true,false)
ON CONFLICT (curriculum_version, level, module_number) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  instructional_content_type = EXCLUDED.instructional_content_type,
  assessment_pass_percentage = 75,
  is_required = true,
  is_active = false;

WITH approved_words(word, item_order) AS (
  VALUES
    ('bata',1),('mata',2),('puti',3),('pula',4),('bago',5),('luma',6),
    ('gabi',7),('tawa',8),('sabi',9),('laro',10),('lasa',11),('dami',12),
    ('bato',13),('guro',14),('hila',15),('ngiti',16),('wala',17),
    ('yaya',18),('masaya',19),('kusina',20)
), module AS (
  SELECT id FROM public.reading_modules
  WHERE curriculum_version='presentation_beginner_mvp_v1' AND level='Beginner' AND module_number=17
)
INSERT INTO public.reading_module_items(module_id, content_id, item_order, role)
SELECT module.id, content.id, approved.item_order, 'instruction'
FROM module CROSS JOIN approved_words approved
JOIN public.reading_content content
  ON content.normalized_text=approved.word
 AND content.content_type='word' AND content.level='Beginner'
ON CONFLICT (module_id, content_id) DO UPDATE SET
  item_order=EXCLUDED.item_order, role='instruction';

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.reading_module_items item
      JOIN public.reading_modules module ON module.id=item.module_id
      WHERE module.curriculum_version='presentation_beginner_mvp_v1'
        AND module.level='Beginner' AND module.module_number=17) <> 20 THEN
    RAISE EXCEPTION 'Expected all 20 Module 17 words to be mapped';
  END IF;
END;
$$;

-- Prerequisite: 17 <- 16.
INSERT INTO public.reading_module_prerequisites(module_id, prerequisite_module_id)
SELECT current_module.id, previous_module.id
FROM public.reading_modules current_module
JOIN public.reading_modules previous_module
  ON previous_module.curriculum_version=current_module.curriculum_version
 AND previous_module.level=current_module.level
 AND previous_module.module_number=current_module.module_number-1
WHERE current_module.curriculum_version='presentation_beginner_mvp_v1'
  AND current_module.level='Beginner'
  AND current_module.module_number=17
ON CONFLICT DO NOTHING;

-- Ten-question capstone assessment (approved format - larger than the
-- 4-question format used by Modules 1-16). Requires the hardcoded
-- "exactly four items" check in start_module_assessment to be relaxed
-- first - done in Part 4 below, before this assessment is activated.
INSERT INTO public.reading_module_assessments(
  module_id, title, instructions, scoring_policy, version, is_active
)
SELECT module.id,
  'Pagsusulit sa Modyul 17',
  'Bigkasin nang malinaw ang sampung item. Kailangan ang 75% upang makapasa.',
  'weighted_average_accuracy', 1, false
FROM public.reading_modules module
WHERE module.curriculum_version='presentation_beginner_mvp_v1'
  AND module.level='Beginner' AND module.module_number=17
ON CONFLICT (module_id) DO UPDATE SET
  title=EXCLUDED.title, instructions=EXCLUDED.instructions,
  scoring_policy=EXCLUDED.scoring_policy, version=1, is_active=false;

-- Ten items, every even-numbered word (2,4,...,20) - spread across the
-- list, covering M/P/L/T/R/D/G/NG/Y/K/S/N consonants.
WITH assessment_selection(module_item_order, assessment_item_order) AS (
  VALUES (2,1),(4,2),(6,3),(8,4),(10,5),(12,6),(14,7),(16,8),(18,9),(20,10)
)
INSERT INTO public.reading_module_assessment_items(
  assessment_id, module_item_id, item_order, weight, is_required
)
SELECT assessment.id, module_item.id, selection.assessment_item_order, 1, true
FROM assessment_selection selection
JOIN public.reading_modules module
  ON module.curriculum_version='presentation_beginner_mvp_v1'
 AND module.level='Beginner' AND module.module_number=17
JOIN public.reading_module_assessments assessment ON assessment.module_id=module.id
JOIN public.reading_module_items module_item
  ON module_item.module_id=module.id
 AND module_item.item_order=selection.module_item_order
ON CONFLICT (assessment_id, module_item_id) DO UPDATE SET
  item_order=EXCLUDED.item_order, weight=1, is_required=true;

-- ============================================================
-- PART 4: Relax start_module_assessment's hardcoded "exactly four
-- items" check (migration 043) so Module 17's 10-question format
-- can start. submit_module_assessment (migration 042) was already
-- fully dynamic (counts required items from the assessment_items
-- table itself) - only this one check needed loosening. The
-- matching hardcoded check in backend/routes/modules.js's submit
-- route was relaxed in the same deploy as this migration.
-- ============================================================
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

  -- Question count is per-assessment now (4 for Modules 1-16, 10 for
  -- Module 17) - just guard against a misconfigured assessment with no
  -- items at all, rather than requiring an exact fixed count.
  IF jsonb_array_length(v_items) < 1 THEN
    RAISE EXCEPTION 'Assessment has no configured items' USING ERRCODE='P0001';
  END IF;
  RETURN jsonb_build_object(
    'attempt_id',v_attempt_id,'assessment_id',p_assessment_id,
    'module_id',v_module.id,'module_level',v_module.level,
    'pass_percentage',v_module.assessment_pass_percentage,
    'status','in_progress','items',v_items
  );
END;
$$;

-- ============================================================
-- PART 5: Activate everything (Modules 5-17 + their assessments).
-- Beginner Modules 1-4 (and their assessments) are untouched.
-- ============================================================
UPDATE public.reading_modules SET is_active=true
WHERE curriculum_version='presentation_beginner_mvp_v1'
  AND level='Beginner' AND module_number BETWEEN 5 AND 17;

UPDATE public.reading_module_assessments assessment SET is_active=true
FROM public.reading_modules module
WHERE module.id=assessment.module_id
  AND module.curriculum_version='presentation_beginner_mvp_v1'
  AND module.level='Beginner' AND module.module_number BETWEEN 5 AND 17;

COMMIT;

NOTIFY pgrst, 'reload schema';
