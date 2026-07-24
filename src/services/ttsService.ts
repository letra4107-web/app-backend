import * as Speech from 'expo-speech';
import { Alert } from 'react-native';

// Standard on-device Tagalog TTS settings, shared across every screen so a
// given kind of content (a single word vs. a full sentence) always sounds
// the same regardless of which screen triggered it.
export const TTS_LANGUAGE = 'fil-PH';
export const RATE_WORD = 0.8;
export const PITCH_WORD = 1.05;
export const RATE_SENTENCE = 0.95;
export const PITCH_SENTENCE = 1.0;

const TAGALOG_VOICE_PATTERN = /^(tl|fil)([-_]|$)/i;
const VOICE_INSTALL_MESSAGE =
  'Para mas malinaw ang boses, i-download ang Filipino/Tagalog voice sa Settings → System → Languages → Text-to-speech output → Install voice data.';
const AUDIO_FAILED_MESSAGE = 'Hindi ma-play ang audio.';

// Real settings wiring: Settings' "Text-to-speech" toggle and "Speech Speed"
// control both read/write these module-level values (set once on app load
// and again live whenever the setting changes), so every speakWord/
// speakPhrase call in the app actually respects them.
const RATE_MULTIPLIERS: Record<'slow' | 'normal' | 'fast', number> = { slow: 0.75, normal: 1, fast: 1.3 };
let ttsEnabled = true;
let rateMultiplier = 1;

export function setTtsEnabled(enabled: boolean) {
  ttsEnabled = enabled;
}

export function setSpeechRateSetting(rate: 'slow' | 'normal' | 'fast') {
  rateMultiplier = RATE_MULTIPLIERS[rate] ?? 1;
}

let voiceCheckPromise: Promise<boolean> | null = null;
let hasShownInstallPrompt = false;

async function detectTagalogVoice(): Promise<boolean> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    return voices.some((voice) => TAGALOG_VOICE_PATTERN.test(voice.language || ''));
  } catch (error) {
    console.warn('[TTS] getAvailableVoicesAsync failed:', error);
    // Unknown, not confirmed-absent — don't nag the user over a detection failure.
    return true;
  }
}

// Cached for the lifetime of the app session: the check only ever runs once,
// no matter how many words get spoken.
function ensureVoiceChecked(): Promise<boolean> {
  if (!voiceCheckPromise) {
    voiceCheckPromise = detectTagalogVoice();
  }
  return voiceCheckPromise;
}

function maybeShowInstallPrompt(hasTagalogVoice: boolean) {
  if (hasTagalogVoice || hasShownInstallPrompt) return;
  hasShownInstallPrompt = true;
  Alert.alert('Tip para sa Boses', VOICE_INSTALL_MESSAGE);
}

type SpeakOptions = {
  rate: number;
  pitch: number;
  onDone?: () => void;
  onError?: (message: string) => void;
};

async function speakWithSettings(text: string, { rate, pitch, onDone, onError }: SpeakOptions) {
  if (!text) return;
  if (!ttsEnabled) return;

  const effectiveRate = rate * rateMultiplier;

  try {
    const hasTagalogVoice = await ensureVoiceChecked();
    maybeShowInstallPrompt(hasTagalogVoice);
  } catch {
    // Detection failing is not fatal — still attempt to speak below.
  }

  try {
    // Always attempt to speak, even without a confirmed Tagalog voice: the
    // device's default TTS engine will fall back to its closest voice
    // rather than us failing silently.
    Speech.speak(text, {
      language: TTS_LANGUAGE,
      rate: effectiveRate,
      pitch,
      onDone,
      onError: (error) => {
        console.warn('[TTS] speak onError:', error);
        onError?.(AUDIO_FAILED_MESSAGE);
      },
    });
  } catch (error) {
    console.warn('[TTS] speak threw:', error);
    onError?.(AUDIO_FAILED_MESSAGE);
  }
}

/** Speak a single word (e.g. "Pakinggan" playback, practice feedback). */
export function speakWord(word: string, options: { onDone?: () => void; onError?: (message: string) => void } = {}) {
  return speakWithSettings(word, { rate: RATE_WORD, pitch: PITCH_WORD, ...options });
}

/** Speak a full sentence/phrase (praise messages, welcome/instructions). */
export function speakPhrase(text: string, options: { onDone?: () => void; onError?: (message: string) => void } = {}) {
  return speakWithSettings(text, { rate: RATE_SENTENCE, pitch: PITCH_SENTENCE, ...options });
}

export function stopSpeaking() {
  Speech.stop();
}
