import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

type SyllableKaraokeTextProps = {
  /** Syllables in display order, e.g. ['Ka', 'li', 'ka', 'san']. */
  syllables: string[];
  /** Index of the syllable currently being spoken, or -1/null for none active. */
  activeIndex: number | null;
  fontSize?: number;
};

/**
 * Renders a word as individually styled syllable spans, highlighting
 * whichever one speakSyllablesCloud reports as currently playing. Plain
 * static rendering when activeIndex is null (e.g. before playback starts) -
 * same visual weight as the old .split('-') syllable line it replaces in
 * karaoke mode.
 */
export default function SyllableKaraokeText({ syllables, activeIndex, fontSize = 32 }: SyllableKaraokeTextProps) {
  return (
    <View style={styles.row} accessibilityRole="text">
      {syllables.map((syllable, index) => {
        const isActive = activeIndex !== null && index === activeIndex;
        return (
          <React.Fragment key={`${syllable}-${index}`}>
            {index > 0 && (
              <Text style={[styles.separator, { fontSize: fontSize * 0.6 }]}>·</Text>
            )}
            <Text
              style={[
                styles.syllable,
                { fontSize },
                isActive ? styles.syllableActive : styles.syllableIdle,
              ]}
            >
              {syllable}
            </Text>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-end' },
  syllable: {
    fontWeight: '900',
    paddingHorizontal: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  syllableIdle: { color: colors.inkSoft },
  syllableActive: { color: '#fff', backgroundColor: colors.lavenderDark },
  separator: { color: colors.inkSoft, fontWeight: '700', marginHorizontal: 2, opacity: 0.6 },
});
