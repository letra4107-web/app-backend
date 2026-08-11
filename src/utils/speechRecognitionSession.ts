export type SpeechStopReason = 'speechend' | 'final-result' | 'manual' | 'hard-timeout';

type Timer = ReturnType<typeof setTimeout>;

export const createSpeechRecognitionSession = ({
  stopRecognition,
  submitTranscript,
  onStopRequested,
  hardTimeoutMs = 12000,
  speechEndDelayMs = 200,
  transcriptSilenceMs = 0,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: {
  stopRecognition: () => void;
  submitTranscript: (transcript: string) => void | Promise<void>;
  onStopRequested?: (reason: SpeechStopReason) => void;
  hardTimeoutMs?: number;
  speechEndDelayMs?: number;
  transcriptSilenceMs?: number;
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
        if (silenceTimer) clearTimer(silenceTimer);
        silenceTimer = null;
        requestStop('final-result');
        submitOnce(normalized);
      } else if (normalized && transcriptSilenceMs > 0) {
        // Some Android recognizers do not emit `speechend`/a final result
        // until the user manually taps Stop. Treat a short pause after an
        // interim transcript as the end of a one-word response instead.
        if (silenceTimer) clearTimer(silenceTimer);
        silenceTimer = setTimer(() => {
          silenceTimer = null;
          requestStop('speechend');
        }, transcriptSilenceMs);
      }
    },
    onSpeechEnd() {
      if (disposed || !active || stopRequested) return;
      // Android emits speechend after its configured 2.3s complete-silence
      // window. A short grace period lets a trailing final result arrive.
      if (silenceTimer) clearTimer(silenceTimer);
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
