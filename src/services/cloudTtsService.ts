import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';
import { buildApiUrl, postJson } from '../config/api';
import { speakWord as onDeviceSpeakWord } from './ttsService';

export type CloudVoice = 'fil-PH-Wavenet-A' | 'fil-PH-Wavenet-C';

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

    const response = await postJson<SpeakResponse>(buildApiUrl('/tts/speak'), { text, voice }, 15000);

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

export function stopCloudSpeaking() {
  releaseActivePlayer();
}
