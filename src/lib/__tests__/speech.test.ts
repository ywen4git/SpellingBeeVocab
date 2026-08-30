import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSpeechSupported, speakWord } from '../speech';

afterEach(() => vi.unstubAllGlobals());

describe('isSpeechSupported', () => {
  it('is true when window.speechSynthesis exists', () => {
    vi.stubGlobal('speechSynthesis', {});
    expect(isSpeechSupported()).toBe(true);
  });

  it('is false when window.speechSynthesis is absent', () => {
    expect(isSpeechSupported()).toBe(false);
  });
});

describe('speakWord', () => {
  it('cancels any in-flight utterance, then speaks the word in English', () => {
    const cancel = vi.fn();
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { cancel, speak });
    const UtteranceCtor = vi.fn(function (this: { text: string }, text: string) {
      this.text = text;
    });
    vi.stubGlobal('SpeechSynthesisUtterance', UtteranceCtor);

    speakWord('AGARIC');

    expect(cancel).toHaveBeenCalledOnce();
    expect(UtteranceCtor).toHaveBeenCalledWith('AGARIC');
    expect(speak).toHaveBeenCalledOnce();
    const utterance = speak.mock.calls[0][0] as { text: string; lang: string };
    expect(utterance.text).toBe('AGARIC');
    expect(utterance.lang).toBe('en-US');
  });
});
