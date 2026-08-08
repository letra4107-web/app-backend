-- First expansion batch for word_definitions, covering the 33 uncovered
-- words in the first 40 sequential Beginner-curriculum words (sequence_no
-- 1-40 in reading_content, content_type='word'). Previously only 38 words
-- total were covered, hand-curated years ago for an old legacy hardcoded
-- word list unrelated to the xlsx-backed curriculum - this is the first
-- batch drawn from the real curriculum, in curriculum order.
--
-- IMPORTANT: these definitions were drafted by Claude for review, not
-- sourced from the client or a linguist. They cover concrete, single-sense
-- nouns (animals, family terms, body parts) chosen specifically because
-- they carry low linguistic risk - reviewed and approved before this
-- migration was written. "baka" was found to be a genuine, previously
-- unflagged homograph (báka the animal vs. bakâ meaning "maybe") while
-- drafting this batch, not from the original known-homograph list.
--
-- ON CONFLICT DO NOTHING makes this safe to run even if any of these 33
-- keys were somehow already added by another process.

INSERT INTO public.word_definitions (word_key, display_word, meaning_fil, example_sentence, is_ambiguous) VALUES
  ('baka', 'báka / bakâ', 'Báka = hayop na kadalasang pinagkukunan ng gatas at karne; bakâ = maaaring mangyari, marahil.', 'Kumain ng damo ang báka. / Bakâ umulan mamaya.', true),
  ('ibon', null, 'Hayop na may pakpak at balahibo, karaniwang lumilipad.', null, false),
  ('isda', null, 'Hayop na nakatira sa tubig at may hasang at palikpik.', null, false),
  ('daga', null, 'Maliit na hayop na kadalasang nakikita sa bahay o palayan.', null, false),
  ('uwak', null, 'Itim na ibong kadalasang kumakain ng bulok na pagkain.', null, false),
  ('kuto', null, 'Maliit na insektong nakatira sa buhok ng tao.', null, false),
  ('lamok', null, 'Maliit na insektong dumidikit at umiinom ng dugo.', null, false),
  ('bubuyog', null, 'Insektong lumilipad at gumagawa ng pulot-pukyutan.', null, false),
  ('mesa', null, 'Kagamitang may patag na ibabaw at paa, ginagamit sa pagkain o pagsulat.', null, false),
  ('silya', null, 'Kagamitang inuupuan.', null, false),
  ('pinto', null, 'Bukasan ng bahay o silid na maaaring buksan o isara.', null, false),
  ('bata', null, 'Batang tao; hindi pa matanda.', null, false),
  ('lola', null, 'Ina ng ama o ina.', null, false),
  ('lolo', null, 'Ama ng ama o ina.', null, false),
  ('tita', null, 'Kapatid na babae ng ama o ina.', null, false),
  ('tito', null, 'Kapatid na lalaki ng ama o ina.', null, false),
  ('apoy', null, 'Init at liwanag na nagmumula sa pagsunog.', null, false),
  ('lupa', null, 'Ang matigas na ibabaw ng Daigdig na tinatayuan; kadalasan ding tumutukoy sa lupang taniman.', null, false),
  ('buwan', null, 'Ang bagay sa kalangitan na nagbibigay liwanag sa gabi; tawag din sa isa sa 12 bahagi ng taon.', null, false),
  ('ulap', null, 'Puting bagay na lumulutang sa langit, gawa sa tubig-singaw.', null, false),
  ('ulan', null, 'Tubig na bumabagsak mula sa langit.', null, false),
  ('langit', null, 'Ang malawak na kalawakan sa itaas ng Daigdig.', null, false),
  ('dagat', null, 'Malawak na katubigang maalat.', null, false),
  ('ilog', null, 'Daluyan ng tubig na umaagos patungo sa dagat.', null, false),
  ('kamay', null, 'Bahagi ng katawan na may daliri, ginagamit sa paghawak.', null, false),
  ('paa', null, 'Bahagi ng katawan na ginagamit sa paglalakad.', null, false),
  ('ilong', null, 'Bahagi ng mukha na ginagamit sa paghinga at pang-amoy.', null, false),
  ('bibig', null, 'Bahagi ng mukha na ginagamit sa pagkain at pagsasalita.', null, false),
  ('tenga', null, 'Bahagi ng katawan na ginagamit sa pandinig.', null, false),
  ('ulo', null, 'Pinakaitaas na bahagi ng katawan na kinaroroonan ng utak.', null, false),
  ('tuhod', null, 'Bahagi ng binti na nagbibigay-daan sa pagyukod ng paa.', null, false),
  ('balikat', null, 'Bahagi ng katawan sa pagitan ng leeg at braso.', null, false),
  ('leeg', null, 'Bahagi ng katawan na nag-uugnay sa ulo at katawan.', null, false)
ON CONFLICT (word_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
