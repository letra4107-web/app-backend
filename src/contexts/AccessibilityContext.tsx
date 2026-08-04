import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DashboardSettings, FontSize } from '../services/settingsService';

type AccessibilityState = {
  dyslexiaFont: boolean;
  highContrast: boolean;
  fontSize: FontSize;
};

const DEFAULT_STATE: AccessibilityState = { dyslexiaFont: false, highContrast: false, fontSize: 'medium' };

// Applied multiplicatively to a screen's own base font sizes - not an
// absolute px scale, so it composes with whatever type scale each screen
// already uses.
const FONT_SIZE_MULTIPLIER: Record<FontSize, number> = { small: 0.92, medium: 1, large: 1.16 };

type AccessibilityContextValue = AccessibilityState & {
  setAccessibilitySettings: (next: Partial<AccessibilityState>) => void;
  // Returns the Lexend font family for the given weight when dyslexiaFont is
  // on, or undefined (i.e. "leave the caller's own fontFamily alone") when
  // it's off - always spread AFTER a style's own fontFamily so it only
  // overrides when actually enabled: `[styles.title, { fontFamily: a11yFont('bold') }]`.
  a11yFont: (weight?: 'regular' | 'medium' | 'bold') => string | undefined;
  // Multiplies a base font size by the current text-size setting.
  a11ySize: (baseSize: number) => number;
};

const AccessibilityContext = createContext<AccessibilityContextValue>({
  ...DEFAULT_STATE,
  setAccessibilitySettings: () => {},
  a11yFont: () => undefined,
  a11ySize: (base) => base,
});

const LEXEND_BY_WEIGHT: Record<'regular' | 'medium' | 'bold', string> = {
  regular: 'Lexend_400Regular',
  medium: 'Lexend_500Medium',
  bold: 'Lexend_700Bold',
};

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AccessibilityState>(DEFAULT_STATE);

  const setAccessibilitySettings = useCallback((next: Partial<AccessibilityState>) => {
    setState((prev) => ({ ...prev, ...next }));
  }, []);

  const value = useMemo<AccessibilityContextValue>(
    () => ({
      ...state,
      setAccessibilitySettings,
      a11yFont: (weight = 'regular') => (state.dyslexiaFont ? LEXEND_BY_WEIGHT[weight] : undefined),
      a11ySize: (baseSize: number) => Math.round(baseSize * FONT_SIZE_MULTIPLIER[state.fontSize]),
    }),
    [state, setAccessibilitySettings],
  );

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

export const useAccessibility = () => useContext(AccessibilityContext);

// Shared mapping from a fetched DashboardSettings row to the subset this
// context cares about - both StudentDashboard and ParentDashboardEnhanced
// call this after loading/saving settings so the two stay in sync.
export const accessibilityFromSettings = (
  settings: Pick<DashboardSettings, 'dyslexia_font' | 'high_contrast' | 'font_size'> | null | undefined,
): AccessibilityState => ({
  dyslexiaFont: !!settings?.dyslexia_font,
  highContrast: !!settings?.high_contrast,
  fontSize: settings?.font_size || 'medium',
});
