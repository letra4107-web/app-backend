import React from 'react';
import { Image, ImageSourcePropType, ImageStyle, StyleProp, StyleSheet, Text, TextStyle, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, roleColors, typography } from '../theme';

type Props = {
  title: string;
  subtitle: string;
  illustration?: ImageSourcePropType;
  illustrationStyle?: StyleProp<ImageStyle>;
  backgroundImage?: ImageSourcePropType;
  notifDot?: boolean;
  // Callers pass the accessibility (Text Size / Dyslexia Font / High
  // Contrast) style overrides so every tab keeps reacting to those settings
  // the same way the old per-screen hero banners did.
  titleA11yStyle?: StyleProp<TextStyle>;
  subtitleA11yStyle?: StyleProp<TextStyle>;
  backLabelA11yStyle?: StyleProp<TextStyle>;
  backLabel?: string;
  variant?: 'student' | 'parent';
} & (
  | { onMenuPress: () => void; onBackPress?: undefined }
  | { onBackPress: () => void; onMenuPress?: undefined }
);

const STUDENT_HERO_BACKGROUND = require('../../assets/students/backgrounds/student-hero-bg.png');

// The one hero-header shape every student tab (Home, Learn, Practice,
// Progress, Badges, Settings, Profile) should render - top-level tabs pass
// onMenuPress, drill-down sub-screens pass onBackPress instead.
export default function TabHeroHeader({
  title, subtitle, illustration, illustrationStyle, backgroundImage, notifDot,
  titleA11yStyle, subtitleA11yStyle, backLabelA11yStyle, backLabel = 'Bumalik',
  variant = 'student',
  onMenuPress, onBackPress,
}: Props) {
  return (
    <View style={styles.heroShell}>
      {variant === 'student' && (
        <Image
          source={backgroundImage ?? STUDENT_HERO_BACKGROUND}
          style={styles.heroBackground}
          resizeMode="cover"
        />
      )}
      <LinearGradient
        colors={variant === 'student'
          ? ['rgba(117,103,184,0.82)', 'rgba(143,184,216,0.74)', 'rgba(169,154,197,0.80)']
          : [roleColors[variant].primary, roleColors[variant].primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroBanner}
      >
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
      </LinearGradient>
      {!!illustration && <Image source={illustration} style={[styles.heroImage, illustrationStyle]} resizeMode="contain" />}
    </View>
  );
}

const styles = StyleSheet.create({
  heroShell: { borderRadius: 28, marginBottom: 20, overflow: 'hidden', position: 'relative', minHeight: 190 },
  heroBackground: { ...StyleSheet.absoluteFillObject, width: undefined, height: undefined },
  heroBanner: { flex: 1, padding: 22, minHeight: 190, backgroundColor: 'transparent' },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  heroLogoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroMenuIconWrap: { position: 'relative' },
  heroMenuDot: {
    position: 'absolute', top: 0, right: 0, width: 9, height: 9, borderRadius: 4.5,
    backgroundColor: colors.coral, borderWidth: 1.5, borderColor: colors.primary,
    zIndex: 10, elevation: 10,
  },
  heroLogoText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  heroBackRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 18 },
  heroBackText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  // Web's student character art is a wide illustration. Give it a real
  // foreground layer on Android (rather than letting it fall behind the
  // gradient/text stacking context) and keep the copy above it.
  heroGreeting: { position: 'relative', zIndex: 2, color: '#fff', fontSize: typography.size.hero, fontFamily: typography.family.display, lineHeight: 29, maxWidth: '62%' },
  heroSubtitle: { position: 'relative', zIndex: 2, color: 'rgba(255,255,255,0.88)', fontSize: 14, fontWeight: '600', marginTop: 8, maxWidth: '58%' },
  heroImage: { position: 'absolute', zIndex: 1, elevation: 1, right: -6, bottom: -4, width: 156, height: 156 },
});
