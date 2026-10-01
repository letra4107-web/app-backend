import { speakWordCloud, stopCloudSpeaking } from './cloudTtsService';

// Compatibility facade for existing screens. All playback is routed to the
// secured Filipino ElevenLabs voice; expo-speech is deliberately not used.
let ttsEnabled = true;

export function setTtsEnabled(enabled: boolean) {
  ttsEnabled = enabled;
}

// Keep the existing Settings API stable. The rate itself is owned by the
// cloud player, matching the web TTS settings contract.
export function setSpeechRateSetting(_rate: 'slow' | 'normal' | 'fast') {}

type SpeakOptions = {
  onDone?: () => void;
  onError?: (message: string) => void;
  bypassToggle?: boolean;
  rate?: number;
};

export function speakWord(word: string, options: SpeakOptions = {}) {
  // The web app intentionally keeps isolated vowels at normal speed so they
  // remain clear; every other word uses the saved reading-speed preference.
  const isStandaloneVowel = /^[aeiou]$/iu.test(
    word.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
  );
  const rate = options.rate ?? (isStandaloneVowel ? 1 : undefined);
  return speakWordCloud(word, { ...options, rate });
}

export function speakPhrase(text: string, options: SpeakOptions = {}) {
  if (!options.bypassToggle && !ttsEnabled) return;
  return speakWordCloud(text, options);
}

export function stopSpeaking() {
  stopCloudSpeaking();
}
