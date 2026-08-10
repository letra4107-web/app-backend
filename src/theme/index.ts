// Single source of truth for design tokens (colors, typography, spacing,
// radius, shadows) across the app. Extracted from the values already in use
// in StudentDashboard.tsx et al. rather than invented - see the two notes
// below for the two places a real choice was made instead of a pure copy.
//
// This module owns *what the values are*. It has zero awareness of
// accessibility state (dyslexia font, text-size setting) - that composition
// still happens at the call site via useAccessibility()'s a11yFont()/
// a11ySize(), unchanged from before this file existed:
//   fontSize: a11ySize(typography.size.body)
//   fontFamily: a11yFont('bold') ?? typography.family.displaySemi
//   color: colors.inkSoft
//
// No provider, no context, no component - plain values only.

export const colors = {
  cream: '#FBF3E2',
  ink: '#3B322C',
  // The WCAG-AA contrast fix from the previous stage now has exactly one
  // home - every screen importing this instead of hand-typing the hex is
  // what makes that class of drift structurally impossible going forward.
  inkSoft: '#5F5044',
  sun: '#E3971A',
  coral: '#E06B4C',
  sage: '#5C8047',
  lavender: '#7C6FCF',
  lavenderDark: '#5F52B0',
  heroGradient: ['#6D28D9', '#974CDE', '#9D174D'] as const,
  vivid: {
    green: '#16A34A',
    orange: '#EA580C',
    violet: '#7C3AED',
    amber: '#F59E0B',
    teal: '#0D9488',
    navy: '#1E3A8A',
  },
  success: '#10b981',
  warning: '#f59e0b',
  warningText: '#B45309',
  danger: '#ef4444',
  dangerText: '#DC2626',
  primary: '#4f46e5',
  primaryLight: '#eef2ff',
  border: '#e5e7eb',
  textPrimary: '#111827',
  textSecondary: '#6b7280',
  white: '#ffffff',
};

export const typography = {
  family: {
    display: 'Baloo2_800ExtraBold',
    displaySemi: 'Baloo2_600SemiBold',
  },
  size: {
    caption: 11,
    small: 12,
    body: 13,
    subtitle: 15,
    title: 18,
    hero: 24,
  },
  weight: {
    regular: '600',
    bold: '700',
    heavy: '800',
    black: '900',
  } as const,
};

// 4px-based scale distilled from the padding/margin values already in
// constant use throughout StudentDashboard.tsx.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

// Verified against the real frequency distribution across StudentDashboard's
// ~140 borderRadius declarations: 999 (pill) is dominant, then 20, then 24,
// then 18, then 12. `md: 18` (not 16) reflects that real ranking - 18 is used
// more than twice as often as 16 in the actual codebase.
export const radius = {
  sm: 12,
  md: 18,
  lg: 20,
  xl: 24,
  pill: 999,
};

// Sourced from Student's shadow pattern specifically (the two most-repeated
// exact shadow specs in StudentDashboard.tsx, plus its one hero-glow spec) -
// this is the more polished side per the design audit, not something already
// consistent app-wide. Parent and Auth screens currently use different,
// unconverged shadow values and will be migrated onto these tiers during
// their own design-polish stages, not swapped in as a like-for-like match.
export const shadows = {
  card: {
    shadowColor: colors.ink,
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  raised: {
    shadowColor: colors.lavenderDark,
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  hero: {
    shadowColor: colors.heroGradient[0],
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
};

export const theme = { colors, typography, spacing, radius, shadows };
export default theme;
