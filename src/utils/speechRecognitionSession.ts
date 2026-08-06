export type SpeechStopReason = 'speechend' | 'final-result' | 'manual' | 'hard-timeout';

type Timer = ReturnType<typeof setTimeout>;

export const createSpeechRecognitionSession = ({
  stopRecognition,
  submitTranscript,
  onStopRequested,
  hardTimeoutMs = 12000,
  speechEndDelayMs = 200,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: {
  stopRecognition: () => void;
  submitTranscript: (transcript: string) => void | Promise<void>;
  onStopRequested?: (reason: SpeechStopReason) => void;
  hardTimeoutMs?: number;
  speechEndDelayMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}) => {
  let active = false;
  let disposed = false;
  let stopRequested = false;
  let submitted = false;
  let latestTranscript = '';
  let hardTimer: Timer | null = null;
  let silenceTimer: Timer | null = null;

  const clearTimers = () => {
    if (hardTimer) clearTimer(hardTimer);
    if (silenceTimer) clearTimer(silenceTimer);
    hardTimer = null;
    silenceTimer = null;
  };

  const submitOnce = (transcript = latestTranscript) => {
    const normalized = transcript.trim();
    if (disposed || submitted || !normalized) return false;
    submitted = true;
    void submitTranscript(normalized);
    return true;
  };

  const requestStop = (reason: SpeechStopReason) => {
    if (disposed || !active || stopRequested) return false;
    stopRequested = true;
    if (hardTimer) clearTimer(hardTimer);
    hardTimer = null;
    onStopRequested?.(reason);
    stopRecognition();
    return true;
  };

  return {
    start() {
      clearTimers();
      active = true;
      disposed = false;
      stopRequested = false;
      submitted = false;
      latestTranscript = '';
      hardTimer = setTimer(() => requestStop('hard-timeout'), hardTimeoutMs);
    },
    cancel() {
      active = false;
      clearTimers();
    },
    onTranscript(transcript: string, isFinal = false) {
      if (disposed || !active) return;
      const normalized = transcript.trim();
      if (normalized) latestTranscript = normalized;
      if (isFinal && normalized) {
        requestStop('final-result');
        submitOnce(normalized);
      }
    },
    onSpeechEnd() {
      if (disposed || !active || stopRequested || silenceTimer) return;
      // Android emits speechend after its configured 2.3s complete-silence
      // window. A short grace period lets a trailing final result arrive.
      silenceTimer = setTimer(() => {
        silenceTimer = null;
        requestStop('speechend');
      }, speechEndDelayMs);
    },
    onRecognitionEnd() {
      if (disposed) return false;
      active = false;
      clearTimers();
      return submitOnce();
    },
    manualStop() {
      return requestStop('manual');
    },
    dispose() {
      disposed = true;
      active = false;
      clearTimers();
    },
    hasSubmitted() { return submitted; },
    latestTranscript() { return latestTranscript; },
  };
};

export type SpeechRecognitionSession = ReturnType<typeof createSpeechRecognitionSession>;
