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
// before a saved refresh token is used - this is the deliberate trade-off
// that keeps "tap an avatar to log back in" from being a bare bypass of the
// password on a shared family device. If the device has neither biometrics
// nor a passcode enrolled, there's nothing to gate with, so the check is
// skipped rather than blocking the feature entirely - callers should treat
// that as a known, smaller residual risk (documented at the call site), not
// a bug.
export const canUseLocalAuth = async (): Promise<boolean> => {
  const LocalAuthentication = loadLocalAuth();
  if (!LocalAuthentication) return false;
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    return await LocalAuthentication.isEnrolledAsync();
  } catch (error) {
    console.warn('[LocalAuth] capability check failed:', error);
    return false;
  }
};

/** Resolves true if the device has no lock to gate with (nothing to fail), or the user passed the
 * prompt. Resolves false only on an explicit failure/cancel by the user. */
export const requireLocalAuth = async (promptMessage: string): Promise<boolean> => {
  const LocalAuthentication = loadLocalAuth();
  if (!LocalAuthentication) return true;
  const available = await canUseLocalAuth();
  if (!available) return true;
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
