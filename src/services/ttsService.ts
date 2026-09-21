import { speakWordCloud, stopCloudSpeaking } from './cloudTtsService';
import { FILIPINO_TTS_RATES, isMultiSyllableWord } from './filipinoTts';

// Compatibility facade for existing screens. All playback is routed to the
// secured Filipino Google Cloud voice; expo-speech is deliberately not used.
let ttsEnabled = true;

export function setTtsEnabled(enabled: boolean) {
  ttsEnabled = enabled;
}

// Keep the existing Settings API stable. Content-specific Filipino rates take
// precedence over a device-level speed multiplier.
export function setSpeechRateSetting(_rate: 'slow' | 'normal' | 'fast') {}

type SpeakOptions = {
  onDone?: () => void;
  onError?: (message: string) => void;
  bypassToggle?: boolean;
  rate?: number;
};

export function speakWord(word: string, options: SpeakOptions = {}) {
  const rate = options.rate ?? (isMultiSyllableWord(word) ? FILIPINO_TTS_RATES.word : 0.85);
  return speakWordCloud(word, { ...options, rate });
}

export function speakPhrase(text: string, options: SpeakOptions = {}) {
  if (!options.bypassToggle && !ttsEnabled) return;
  return speakWordCloud(text, { ...options, rate: options.rate ?? FILIPINO_TTS_RATES.feedback });
}

export function stopSpeaking() {
  stopCloudSpeaking();
}
