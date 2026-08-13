import React from 'react';
import { Image, ImageSourcePropType, ImageStyle, StyleProp, StyleSheet, Text, TextStyle, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, typography } from '../theme';

type Props = {
  title: string;
  subtitle: string;
  illustration?: ImageSourcePropType;
  illustrationStyle?: StyleProp<ImageStyle>;
  notifDot?: boolean;
  // Callers pass the accessibility (Text Size / Dyslexia Font / High
  // Contrast) style overrides so every tab keeps reacting to those settings
  // the same way the old per-screen hero banners did.
  titleA11yStyle?: StyleProp<TextStyle>;
  subtitleA11yStyle?: StyleProp<TextStyle>;
  backLabelA11yStyle?: StyleProp<TextStyle>;
  backLabel?: string;
} & (
  | { onMenuPress: () => void; onBackPress?: undefined }
  | { onBackPress: () => void; onMenuPress?: undefined }
);

// The one hero-header shape every student tab (Home, Learn, Practice,
// Progress, Badges, Settings, Profile) should render - top-level tabs pass
// onMenuPress, drill-down sub-screens pass onBackPress instead.
export default function TabHeroHeader({
  title, subtitle, illustration, illustrationStyle, notifDot,
  titleA11yStyle, subtitleA11yStyle, backLabelA11yStyle, backLabel = 'Bumalik',
  onMenuPress, onBackPress,
}: Props) {
  return (
    <LinearGradient colors={colors.heroGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroBanner}>
      {onBackPress ? (
        <TouchableOpacity style={styles.heroBackRow} onPress={onBackPress} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color="#fff" />
          <Text style={[styles.heroBackText, backLabelA11yStyle]}>{backLabel}</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.heroTopRow}>
          <TouchableOpacity
            style={styles.heroLogoRow}
            onPress={onMenuPress}
            accessibilityRole="button"
            accessibilityLabel="Open navigation menu"
          >
            <View style={styles.heroMenuIconWrap}>
              <Ionicons name="menu-outline" size={20} color="#fff" />
              {!!notifDot && <View style={styles.heroMenuDot} />}
            </View>
            <Ionicons name="book" size={16} color="#fff" />
            <Text style={styles.heroLogoText}>LinawLetra</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text style={[styles.heroGreeting, titleA11yStyle]}>{title}</Text>
      <Text style={[styles.heroSubtitle, subtitleA11yStyle]}>{subtitle}</Text>
      {!!illustration && <Image source={illustration} style={[styles.heroImage, illustrationStyle]} resizeMode="contain" />}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  heroBanner: { borderRadius: 28, padding: 22, marginBottom: 20, overflow: 'hidden', position: 'relative', minHeight: 190 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  heroLogoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroMenuIconWrap: { position: 'relative' },
  heroMenuDot: {
    position: 'absolute', top: 0, right: 0, width: 9, height: 9, borderRadius: 4.5,
    backgroundColor: colors.danger, borderWidth: 1.5, borderColor: colors.heroGradient[0],
    zIndex: 10, elevation: 10,
  },
  heroLogoText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  heroBackRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 18 },
  heroBackText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  heroGreeting: { color: '#fff', fontSize: typography.size.hero, fontFamily: typography.family.display, lineHeight: 29, maxWidth: '68%' },
  heroSubtitle: { color: 'rgba(255,255,255,0.88)', fontSize: 14, fontWeight: '600', marginTop: 8, maxWidth: '62%' },
  heroImage: { position: 'absolute', right: -2, bottom: -12, width: 120, height: 212 },
});
