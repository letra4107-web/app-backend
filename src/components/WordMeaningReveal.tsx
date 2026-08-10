import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme';

export type WordMeaningRevealData = {
  displayWord: string | null;
  meaningFil: string;
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
      <Text style={[styles.meaning, bodyA11yStyle]}>{definition.meaningFil}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', marginBottom: 14, paddingHorizontal: 12 },
  accented: { color: colors.coral, fontSize: 14, fontWeight: '800', marginBottom: 2, textAlign: 'center' },
  meaning: { color: colors.inkSoft, fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 18 },
  revealButton: { marginBottom: 14, paddingVertical: 6, paddingHorizontal: 14 },
  revealButtonText: { color: colors.lavenderDark, fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
});
