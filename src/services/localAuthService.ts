// Loaded lazily (not as a static import) because the native module isn't present
// in every installed build yet - a static `import` calls requireNativeModule at
// module-load time and crashes the whole JS bundle if the native side is missing.
// require() inside a try/catch lets a build without the native module keep working,
// just with this gate skipped.
const loadLocalAuth = (): typeof import('expo-local-authentication') | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-local-authentication');
  } catch (error) {
    console.warn('[LocalAuth] native module unavailable:', error);
    return null;
  }
};

// Gates one-tap re-login behind the device's own lock (fingerprint/face/PIN)
// before a saved refresh token is used - this is now the PRIMARY security
// boundary for the feature (see the "switch profile" logout trade-off note
// on signOutUser in supabaseService.ts), so it is mandatory, not best-effort.
//
// Deliberately checks getEnrolledLevelAsync() rather than isEnrolledAsync():
// isEnrolledAsync() only reports BIOMETRIC enrollment (fingerprint/face) and
// stays false on a device secured only by a PIN/pattern/password with zero
// fingerprints enrolled - confirmed live on a test device with fingerprint
// hardware present but no prints registered. getEnrolledLevelAsync() returns
// SecurityLevel.NONE only when the device has no lock of ANY kind, which is
// the actual "biometric/PIN" condition the panel asked for.
export const canUseLocalAuth = async (): Promise<boolean> => {
  const LocalAuthentication = loadLocalAuth();
  if (!LocalAuthentication) return false;
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level !== LocalAuthentication.SecurityLevel.NONE;
  } catch (error) {
    console.warn('[LocalAuth] capability check failed:', error);
    return false;
  }
};

/** Mandatory gate: resolves true only when the user actually passes the device's
 * fingerprint/face/PIN prompt. Resolves false on an unavailable gate, a cancel, or a
 * failure - callers must treat false as "do not proceed," never skip it. */
export const requireLocalAuth = async (promptMessage: string): Promise<boolean> => {
  const LocalAuthentication = loadLocalAuth();
  if (!LocalAuthentication) return false;
  const available = await canUseLocalAuth();
  if (!available) return false;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Kanselahin',
      disableDeviceFallback: false,
    });
    return result.success;
  } catch (error) {
    console.warn('[LocalAuth] authentication prompt failed:', error);
    return false;
  }
};
