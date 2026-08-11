/* global jest, describe, it, expect */

const { createSpeechRecognitionSession } = require('./speechRecognitionSession');

describe('Word of the Day speech session', () => {
  const setup = () => {
    jest.useFakeTimers();
    const stop = jest.fn();
    const submit = jest.fn();
    const session = createSpeechRecognitionSession({ stopRecognition: stop, submitTranscript: submit });
    session.start();
    return { session, stop, submit };
  };

  it('stops after speechend and preserves the latest transcript', () => {
    const { session, stop, submit } = setup();
    session.onTranscript('bata', false);
    session.onSpeechEnd();
    jest.advanceTimersByTime(200);
    expect(stop).toHaveBeenCalledTimes(1);
    session.onRecognitionEnd();
    expect(submit).toHaveBeenCalledWith('bata');
  });

  it('submits a final result only once across duplicate events', () => {
    const { session, stop, submit } = setup();
    session.onTranscript('dahon', true);
    session.onSpeechEnd();
    session.onTranscript('dahon', true);
    session.onRecognitionEnd();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('auto-stops a one-word response after interim transcript silence', () => {
    jest.useFakeTimers();
    const stop = jest.fn();
    const submit = jest.fn();
    const session = createSpeechRecognitionSession({
      stopRecognition: stop,
      submitTranscript: submit,
      transcriptSilenceMs: 1300,
    });
    session.start();
    session.onTranscript('isda', false);
    jest.advanceTimersByTime(1299);
    expect(stop).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(stop).toHaveBeenCalledTimes(1);
    session.onRecognitionEnd();
    expect(submit).toHaveBeenCalledWith('isda');
  });

  it('keeps manual stop and the 12-second hard timeout', () => {
    const manual = setup();
    expect(manual.session.manualStop()).toBe(true);
    expect(manual.stop).toHaveBeenCalledTimes(1);

    const timed = setup();
    jest.advanceTimersByTime(11999);
    expect(timed.stop).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(timed.stop).toHaveBeenCalledTimes(1);
  });

  it('cleans timers and ignores late events after dispose', () => {
    const { session, stop, submit } = setup();
    session.onTranscript('bata', false);
    session.onSpeechEnd();
    session.dispose();
    jest.runAllTimers();
    session.onRecognitionEnd();
    session.onTranscript('bata', true);
    expect(stop).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
