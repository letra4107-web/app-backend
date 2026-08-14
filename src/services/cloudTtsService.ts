import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';
import { buildApiUrl, postJson } from '../config/api';
import { speakWord as onDeviceSpeakWord } from './ttsService';
import type { SpeechRate } from './settingsService';

export type CloudVoice = 'fil-PH-Wavenet-A' | 'fil-PH-Wavenet-C';

// Mirrors the backend's DEFAULT_SPEECH_RATE (backend/routes/tts.js) - kept as
// the fallback here too so a request sent before settings finish loading
// still uses the slower default rather than an undefined rate silently
// falling back to Google's own 1.0.
const SPEECH_RATE_BY_PRESET: Record<SpeechRate, number> = { slow: 0.65, normal: 0.82, fast: 1.0 };
let currentSpeechRate = SPEECH_RATE_BY_PRESET.normal;

/**
 * Settings' "Reading Speed" control calls this (alongside ttsService's own
 * setSpeechRateSetting, which only affects the on-device fallback voice) so
 * the primary cloud-TTS path - used for every normal word/sentence playback
 * - actually respects the setting too.
 */
export function setCloudSpeechRate(preset: SpeechRate) {
  currentSpeechRate = SPEECH_RATE_BY_PRESET[preset] ?? SPEECH_RATE_BY_PRESET.normal;
}

type SpeakResponse = {
  success: boolean;
  url?: string;
  audioContent?: string;
  cached?: boolean;
  message?: string;
};

type CloudSpeakOptions = {
  voice?: CloudVoice;
  onDone?: () => void;
  onError?: (message: string) => void;
};

export type SyllableTimepoint = { markName: string; timeSeconds: number };

type SpeakSyllablesResponse = {
  success: boolean;
  url?: string;
  audioContent?: string;
  timepoints?: SyllableTimepoint[];
  cached?: boolean;
  message?: string;
};

type KaraokeSpeakOptions = {
  voice?: CloudVoice;
  /** SSML speakingRate, clamped server-side to [0.25, 1.0]; defaults to 0.5. */
  rate?: number;
  /** Fires once per syllable boundary as playback crosses it, in order from 0. */
  onSyllableIndex?: (index: number) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};

let activePlayer: AudioPlayer | null = null;
let audioModeReady = false;

function releaseActivePlayer() {
  const player = activePlayer;
  activePlayer = null;
  if (!player) return;
  try {
    player.pause();
    player.remove();
  } catch {
    // Player may already be released - not worth surfacing to the caller.
  }
}

async function ensurePlaybackMode() {
  if (audioModeReady) return;
  try {
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    audioModeReady = true;
  } catch (error) {
    console.warn('[CloudTTS] setAudioModeAsync failed:', error);
  }
}

/**
 * Plays a word/phrase through Google Cloud TTS (via the backend proxy),
 * falling back to on-device expo-speech for any failure - network error,
 * quota exceeded, backend down, etc. The "Pakinggan/Listen" button must
 * never go silent, so every failure path below hands off to the fallback
 * rather than surfacing an error to the caller.
 */
export async function speakWordCloud(word: string, options: CloudSpeakOptions = {}) {
  const { voice, onDone, onError } = options;
  const text = word?.trim();
  if (!text) return;

  releaseActivePlayer();

  try {
    await ensurePlaybackMode();

    const response = await postJson<SpeakResponse>(
      buildApiUrl('/tts/speak'),
      { text, voice, rate: currentSpeechRate },
      15000,
    );

    const source = response.url
      ? { uri: response.url }
      : response.audioContent
      ? { uri: `data:audio/mpeg;base64,${response.audioContent}` }
      : null;

    if (!response.success || !source) {
      throw new Error(response.message || 'Cloud TTS returned no audio');
    }

    const player = createAudioPlayer(source);
    activePlayer = player;

    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) {
        subscription.remove();
        if (activePlayer === player) {
          releaseActivePlayer();
        }
        onDone?.();
      }
    });

    player.play();
  } catch (error: any) {
    console.warn('[CloudTTS] speakWordCloud failed, falling back to on-device TTS:', error?.message || error);
    onDeviceSpeakWord(text, { onDone, onError });
  }
}

/**
 * Plays a word as slow, syllable-marked speech and drives onSyllableIndex in
 * sync with real Google TTS timepoints (SSML <mark> + enableTimePointing,
 * v1beta1 - confirmed live to work with fil-PH-Wavenet-A/C). Unlike
 * speakWordCloud, this has NO on-device fallback: expo-speech has no timing
 * API, so there is no way to keep the highlight in sync if cloud synthesis
 * fails. Callers should treat onError as "fall back to plain speakWordCloud
 * for audio, but don't attempt to highlight" rather than going silent.
 */
export async function speakSyllablesCloud(syllables: string[], options: KaraokeSpeakOptions = {}) {
  const { voice, rate, onSyllableIndex, onDone, onError } = options;
  const clean = (syllables || []).map((s) => s?.trim()).filter(Boolean);
  if (!clean.length) return;

  releaseActivePlayer();

  try {
    await ensurePlaybackMode();

    const response = await postJson<SpeakSyllablesResponse>(
      buildApiUrl('/tts/speak-syllables'),
      { syllables: clean, voice, rate },
      20000,
    );

    const source = response.url
      ? { uri: response.url }
      : response.audioContent
      ? { uri: `data:audio/mpeg;base64,${response.audioContent}` }
      : null;

    if (!response.success || !source || !Array.isArray(response.timepoints) || response.timepoints.length !== clean.length) {
      throw new Error(response.message || 'Cloud TTS returned no usable syllable timing');
    }

    const timepoints = response.timepoints;
    const player = createAudioPlayer(source);
    activePlayer = player;

    let lastIndex = -1;
    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (typeof status.currentTime === 'number') {
        // Last timepoint at or before the current position - timepoints are
        // already restored to syllable order server-side.
        let index = 0;
        for (let i = 0; i < timepoints.length; i += 1) {
          if (status.currentTime >= timepoints[i].timeSeconds) index = i;
          else break;
        }
        if (index !== lastIndex) {
          lastIndex = index;
          onSyllableIndex?.(index);
        }
      }
      if (status.didJustFinish) {
        subscription.remove();
        if (activePlayer === player) {
          releaseActivePlayer();
        }
        onDone?.();
      }
    });

    onSyllableIndex?.(0);
    player.play();
  } catch (error: any) {
    console.warn('[CloudTTS] speakSyllablesCloud failed:', error?.message || error);
    onError?.(error?.message || 'Could not play syllable read-along.');
  }
}

export function stopCloudSpeaking() {
  releaseActivePlayer();
}
