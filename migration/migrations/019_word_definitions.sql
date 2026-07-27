-- Word definitions/meanings for practice words, keyed by a normalized word
-- (lowercase, no hyphens/diacritics - same normalization the app already
-- uses when scoring pronunciation, so a lookup matches regardless of how a
-- source list capitalizes/hyphenates the word, e.g. "Ba-ba" vs "baba").
--
-- display_word carries the accented/stressed spelling (e.g. "gábi" vs
-- "gabí") for real homographs where meaning changes with stress - it is
-- UI-only, never fed into TTS or speech scoring (see is_ambiguous rows
-- below for the actual disambiguated pairs).

CREATE TABLE public.word_definitions (
  word_key text PRIMARY KEY,
  display_word text,
  meaning_fil text NOT NULL,
  example_sentence text,
  is_ambiguous boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.word_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_word_definitions" ON public.word_definitions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role_manage_word_definitions" ON public.word_definitions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Seed: every word currently in DEFAULT_PHONETIC_WORDS, SKILL_LONG_WORDS
-- (src/screens/StudentDashboard.tsx) and the legacy WORD_POOL
-- (src/services/streakService.ts). Real stress-based homographs
-- (is_ambiguous = true) carry both senses in one row since the app
-- practices them as a single word entry.
INSERT INTO public.word_definitions (word_key, display_word, meaning_fil, example_sentence, is_ambiguous) VALUES
  ('baba', 'bába / babâ', 'Bába = parte ng mukha sa ilalim ng bibig; babâ = pumunta o bumaba.', 'Hinugasan niya ang kanyang bába. / Babâ ka na sa hagdan.', true),
  ('upo', 'úpo / upô', 'Úpo = gulay na kalabasa; upô = umupo o nakaupo na.', 'Masarap lutuin ang úpo. / Upô ka muna dito.', true),
  ('gabi', 'gábi / gabí', 'Gábi = gulay na may malaking dahon; gabí = oras pagkatapos ng hapon, kabaligtaran ng araw.', 'Kumain kami ng gábi. / Madilim na sa gabí.', true),
  ('hapon', 'hápon / Hapón', 'Hápon = bahagi ng araw pagkatapos ng tanghali; Hapón = tao o bagay mula sa bansang Japan.', 'Maglalaro kami ngayong hápon. / Siya ay isang Hapón.', true),
  ('pala', 'pála / palá', 'Pála = kagamitang panghukay; palá = ginagamit para ipahayag na may nalaman kang bago.', 'Gumamit siya ng pála sa hardin. / Ay, ikaw palá ang kumatok!', true),
  ('saya', 'sáya / sayá', 'Sáya = damit pambabae na sinusuot sa baba; sayá = kaligayahan.', 'Bago ang kanyang sáya. / Sobrang sayá ng party.', true),
  ('tama', 'táma / tamâ', 'Táma = wasto o tumpak; tamâ = natamaan o naumpugan.', 'Táma ang sagot mo. / Tamâ siya ng bola.', true),
  ('tubo', 'túbo / tubô', 'Túbo = halamang matamis na katas o kagamitang hugis-pipa; tubô = kita o paglaki ng negosyo.', 'Mahilig siyang kumagat ng túbo. / Malaki ang tubô ng tindahan.', true),
  ('mahal', 'máhal / mahál', 'Máhal = malaki ang halaga o presyo; mahál = minamahal o iniibig.', 'Máhal ang bagong sapatos. / Mahál kita, Nanay.', true),
  ('kama', NULL, 'Kagamitang hinihigaan o tulugan.', NULL, false),
  ('aso', NULL, 'Hayop na alagang tumatahol at tapat sa tao.', NULL, false),
  ('mano', NULL, 'Pagsunod ng kamay ng nakatatanda bilang paggalang.', NULL, false),
  ('lapis', NULL, 'Kagamitan sa pagsulat o pagguhit.', NULL, false),
  ('ama', NULL, 'Lalaking magulang.', NULL, false),
  ('ate', NULL, 'Nakatatandang babaeng kapatid.', NULL, false),
  ('araw', NULL, 'Ang bituing nagbibigay init at liwanag sa Daigdig; tawag din sa isang yugto ng 24 oras.', NULL, false),
  ('bukid', NULL, 'Lupang taniman o sakahan.', NULL, false),
  ('dahon', NULL, 'Bahagi ng halaman na karaniwang berde at manipis.', NULL, false),
  ('dila', NULL, 'Bahagi ng bibig na ginagamit sa panlasa at pagsasalita.', NULL, false),
  ('kuya', NULL, 'Nakatatandang lalaking kapatid.', NULL, false),
  ('luma', NULL, 'Matagal nang ginagamit o hindi na bago.', NULL, false),
  ('nana', NULL, 'Mapagmahal na tawag sa lola o ina sa ilang pamilya.', NULL, false),
  ('niyog', NULL, 'Bunga ng puno ng niyog na may sapal at tubig.', NULL, false),
  ('pusa', NULL, 'Maliit na hayop na alaga na umuungol.', NULL, false),
  ('susi', NULL, 'Kagamitang pambukas o pansara ng kandado.', NULL, false),
  ('wala', NULL, 'Kasalungat ng may; kawalan ng anumang bagay.', NULL, false),
  ('yaya', NULL, 'Taong nag-aalaga ng bata.', NULL, false),
  ('kabayo', NULL, 'Malaking hayop na sinasakyan at pantulong sa paggawa.', NULL, false),
  ('talaba', NULL, 'Uri ng kabibi na matatagpuan sa dagat.', NULL, false),
  ('matamis', NULL, 'Panlasa na katulad ng asukal.', NULL, false),
  ('bulaklak', NULL, 'Bahagi ng halaman na maganda ang kulay at kadalasa''y mabango.', NULL, false),
  ('karabao', NULL, 'Malaking hayop na tumutulong sa pagsasaka.', NULL, false),
  ('sampaguita', NULL, 'Pambansang bulaklak ng Pilipinas na mabango at puti.', NULL, false),
  ('balahibo', NULL, 'Manipis na hibla sa balat ng tao o hayop.', NULL, false),
  ('palakasan', NULL, 'Laro o timpalak na sukatan ng lakas o kakayahan.', NULL, false),
  ('bahay', NULL, 'Tirahan o tahanan ng tao.', NULL, false),
  ('tubig', NULL, 'Likidong walang kulay na kailangan ng lahat ng may buhay.', NULL, false),
  ('pagkain', NULL, 'Anumang kinakain para mabuhay.', NULL, false)
ON CONFLICT (word_key) DO NOTHING;
