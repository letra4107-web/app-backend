import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { speakPhrase, stopSpeaking } from '../services/ttsService';
import { FILIPINO_TTS_RATES } from '../services/filipinoTts';

export type WordMeaningRevealData = {
  displayWord: string | null;
  meaningFil: string;
  exampleSentence?: string | null;
  isAmbiguous: boolean;
};

type WordMeaningRevealProps = {
  definition: WordMeaningRevealData;
  bodyA11yStyle?: any;
};

/**
 * Genuinely ambiguous homographs (is_ambiguous) show their meaning
 * immediately - hiding the disambiguation behind a tap defeats the whole
 * point, since a student who doesn't know to tap never learns which
 * reading is being practiced. Non-ambiguous words are useful context, not
 * critical, so they stay behind "Ano ang ibig sabihin?" to avoid cluttering
 * every single practice word once coverage grows past a handful of terms.
 */
export default function WordMeaningReveal({ definition, bodyA11yStyle }: WordMeaningRevealProps) {
  const [revealed, setRevealed] = useState(definition.isAmbiguous);
  const [speaking, setSpeaking] = useState(false);
  const [audioError, setAudioError] = useState('');

  const playMeaning = () => {
    const text = [definition.meaningFil, definition.exampleSentence].filter(Boolean).join(' ');
    if (!text) return;
    stopSpeaking();
    setAudioError('');
    setSpeaking(true);
    void speakPhrase(text, {
      bypassToggle: true,
      rate: FILIPINO_TTS_RATES.meaning,
      onDone: () => setSpeaking(false),
      onError: (message) => { setSpeaking(false); setAudioError(message); },
    });
  };

  if (!definition.isAmbiguous && !revealed) {
    return (
      <TouchableOpacity
        style={styles.revealButton}
        onPress={() => setRevealed(true)}
        accessibilityRole="button"
        accessibilityLabel="Ano ang ibig sabihin ng salitang ito?"
      >
        <Text style={[styles.revealButtonText, bodyA11yStyle]}>Ano ang ibig sabihin?</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.box}>
      {!!definition.displayWord && (
        <Text style={[styles.accented, bodyA11yStyle]}>{definition.displayWord}</Text>
      )}
      <View style={styles.meaningRow}>
        <Text style={[styles.meaning, bodyA11yStyle]}>{definition.meaningFil}</Text>
        <TouchableOpacity style={styles.playButton} onPress={playMeaning} disabled={speaking} accessibilityRole="button" accessibilityLabel="Pakinggan ang kahulugan">
          {speaking ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="volume-high" size={17} color={colors.primary} />}
        </TouchableOpacity>
      </View>
      {!!definition.exampleSentence && <Text style={[styles.example, bodyA11yStyle]}>{definition.exampleSentence}</Text>}
      {!!audioError && <Text style={styles.error}>{audioError}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', marginBottom: 14, paddingHorizontal: 12 },
  accented: { color: colors.coral, fontSize: 14, fontWeight: '800', marginBottom: 2, textAlign: 'center' },
  meaningRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  meaning: { color: colors.inkSoft, fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 18, flexShrink: 1 },
  example: { color: colors.inkSoft, fontSize: 12, fontStyle: 'italic', textAlign: 'center', lineHeight: 17, marginTop: 4 },
  playButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger, fontSize: 11, textAlign: 'center', marginTop: 5 },
  revealButton: { marginBottom: 14, paddingVertical: 6, paddingHorizontal: 14 },
  revealButtonText: { color: colors.lavenderDark, fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
});
