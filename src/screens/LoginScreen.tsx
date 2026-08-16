import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Image, ScrollView, Keyboard, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { buildApiUrl, postJson } from '../config/api';
import {
  signInUser, getChildByUsername, mapSupabaseAuthErrorCode,
  signInWithOAuthProvider, ensureUserProfileForOAuthUser, completeAuthSession, relogin, getCurrentSession, OAuthProvider,
  signOutUserFully,
} from '../services/supabaseService';
import { getSavedProfiles, saveAuthProfile, removeSavedProfile, updateSavedProfileToken, SavedAuthProfile } from '../services/authProfileStore';
import { requireLocalAuth, canUseLocalAuth } from '../services/localAuthService';
import { colors, typography } from '../theme';

interface LoginScreenProps {
  navigation: any;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ navigation }) => {
  const identifierInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [globalError, setGlobalError] = useState('');
  const [lastErrorCode, setLastErrorCode] = useState('');
  const [identifierError, setIdentifierError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [touchedIdentifier, setTouchedIdentifier] = useState(false);
  const [touchedPassword, setTouchedPassword] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // One-tap re-login (panel item 1). The biometric/PIN gate is mandatory -
  // it's the security boundary that replaced immediate server-side token
  // revocation on logout (see the trade-off note on signOutUser in
  // supabaseService.ts). So the picker only ever renders when the device
  // actually has a lock enrolled; otherwise saved profiles are still pruned
  // by TTL in the background, but the UI silently falls through to the full
  // credential form instead of offering a bare tap-to-login.
  const [savedProfiles, setSavedProfiles] = useState<SavedAuthProfile[]>([]);
  const [profilesChecked, setProfilesChecked] = useState(false);
  const [localAuthAvailable, setLocalAuthAvailable] = useState(false);
  const [showFullForm, setShowFullForm] = useState(false);
  const [reloginBusyId, setReloginBusyId] = useState<string | null>(null);
  const [reloginError, setReloginError] = useState('');

  useEffect(() => {
    void (async () => {
      const [profiles, gateAvailable] = await Promise.all([getSavedProfiles(), canUseLocalAuth()]);
      setSavedProfiles(profiles);
      setLocalAuthAvailable(gateAvailable);
      setProfilesChecked(true);
    })();
  }, []);

  const canOfferOneTapLogin = profilesChecked && localAuthAvailable && savedProfiles.length > 0;

  const validateIdentifier = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setIdentifierError('Ilagay ang iyong email o username');
      return false;
    }

    if (trimmed.includes('@')) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmed)) {
        setIdentifierError('Maglagay ng wastong email address');
        return false;
      }
    }

    setIdentifierError('');
    return true;
  };

  const validatePassword = (value: string) => {
    if (!value) {
      setPasswordError('Ilagay ang iyong password');
      return false;
    }
    setPasswordError('');
    return true;
  };

  const clearErrors = () => {
    setGlobalError('');
    setLastErrorCode('');
    setIdentifierError('');
    setPasswordError('');
  };

  const buildStudentAuthEmail = (username: string) => {
    return `${username.toLowerCase()}@student.linawletra.app`;
  };

  const createStudentAuthAccount = async (username: string, password: string, displayName: string) => {
    const data = await postJson(buildApiUrl('/auth/create-student-account'), { username, password, displayName });
    if (!data?.success) {
      throw new Error(data?.message || 'Unable to create student auth account');
    }
    return { authUid: data.authUid, authEmail: data.authEmail || buildStudentAuthEmail(username) };
  };

  const mapAuthError = (error: string) => {
    switch (error) {
      case 'auth/user-not-found':
        return 'Walang nahanap na account sa email o username na ito';
      case 'auth/wrong-password':
        return 'Maling password';
      case 'auth/too-many-requests':
        return 'Sobra na sa dami ng pagsubok mag-login. Subukang muli mamaya.';
      case 'auth/user-disabled':
        return 'Ang account na ito ay na-disable';
      case 'auth/invalid-email':
        return 'Maglagay ng wastong email address';
      case 'auth/invalid-credential':
        return 'Hindi wastong kredensyal. Suriin ang iyong email at password.';
      case 'auth/email-not-confirmed':
        return 'I-verify muna ang iyong email bago mag-log in.';
      default:
        return 'Hindi wasto ang email o username o password';
    }
  };

  const throwSupabaseLoginError = (error: any) => {
    const authError: any = new Error(error?.message || 'Hindi wastong login credentials');
    authError.code = mapSupabaseAuthErrorCode(error);
    authError.status = error?.status;
    authError.supabaseError = error;
    throw authError;
  };

  const handleLogin = async () => {
    clearErrors();
    setSubmitAttempted(true);
    setTouchedIdentifier(true);
    setTouchedPassword(true);

    const identifierValid = validateIdentifier(identifier);
    const passwordValid = validatePassword(password);
    if (!identifierValid || !passwordValid) {
      setGlobalError('Itama ang mga error sa ibaba');
      if (!identifierValid) identifierInputRef.current?.focus();
      else passwordInputRef.current?.focus();
      return;
    }

    Keyboard.dismiss();
    setLoading(true);
    try {
      const identifierValue = identifier.trim();
      // Credentials are frequently copy-pasted out of the enrollment email
      // (Gmail in particular tends to carry a trailing space or newline
      // along with a selected password), so trim before authenticating -
      // otherwise a byte-for-byte correct password silently fails to match.
      const passwordValue = password.trim();
      const isEmail = identifierValue.includes('@');
      let user: any;
      let refreshToken: string | null = null;

      if (isEmail) {
        const loginEmail = identifierValue.toLowerCase();
        const { data, error } = await signInUser(loginEmail, passwordValue);
        if (error || !data?.user) {
          throwSupabaseLoginError(error);
        }
        user = data.user;
        refreshToken = data.session?.refresh_token || null;
      } else {
        console.log('Attempting login for username:', identifierValue.toLowerCase());
        const childResult = await getChildByUsername(identifierValue.toLowerCase());
        if (childResult.error || !childResult.data) {
          const notFoundError: any = new Error('Student account not found');
          notFoundError.code = 'auth/user-not-found';
          throw notFoundError;
        }
        const studentData = childResult.data;
        const loginEmail = studentData.auth_email || buildStudentAuthEmail(identifierValue.toLowerCase());

        const { data, error } = await signInUser(loginEmail, passwordValue);
        if (error || !data?.user) {
          if (error?.status === 404 || error?.message?.includes('user not found')) {
            console.log('Student auth user not found, creating auth account on login');
            await createStudentAuthAccount(identifierValue.toLowerCase(), passwordValue, studentData.name || identifierValue);
            const createResult = await signInUser(loginEmail, passwordValue);
            if (createResult.error || !createResult.data?.user) {
              throw new Error('Unable to sign in after creating student account.');
            }
            user = createResult.data.user;
            refreshToken = createResult.data.session?.refresh_token || null;
          } else {
            throwSupabaseLoginError(error);
          }
        } else {
          user = data.user;
          refreshToken = data.session?.refresh_token || null;
        }
      }

      await completeAuthSession(user, isEmail, navigation, (message) => setGlobalError(message), (info) => {
        // Best-effort: a saved-profile write failing should never block an
        // otherwise-successful login.
        if (refreshToken) {
          void saveAuthProfile({
            userId: user.id,
            role: info.role as SavedAuthProfile['role'],
            isEmail,
            displayName: info.displayName,
            avatarUrl: info.avatarUrl,
            refreshToken,
          }).catch((saveError) => console.warn('[Login] failed to save relogin profile:', saveError));
        }
      });
    } catch (error: any) {
      const expectedAuthCodes = new Set([
        'auth/user-not-found',
        'auth/wrong-password',
        'auth/invalid-credential',
        'auth/invalid-email',
        'auth/email-not-confirmed',
        'auth/user-disabled',
        'auth/too-many-requests',
      ]);
      const errorDetails = {
        code: error.code,
        status: error.status,
        message: error.message,
        supabaseError: error.supabaseError
          ? {
              name: error.supabaseError.name,
              message: error.supabaseError.message,
              status: error.supabaseError.status,
              code: error.supabaseError.code,
            }
          : null,
      };
      if (expectedAuthCodes.has(error.code)) {
        // Invalid credentials are an expected form response. Logging them as
        // errors opens React Native's red LogBox in development mode.
        console.info('[Login] Login rejected:', errorDetails);
      } else {
        console.error('[Login] Unexpected login error:', errorDetails);
      }
      const friendlyError = mapAuthError(error.code || 'default');
      setGlobalError(friendlyError);
      setLastErrorCode(error.code || 'default');
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthLogin = async (provider: OAuthProvider) => {
    clearErrors();
    setOauthLoading(provider);
    try {
      const { data, error } = await signInWithOAuthProvider(provider);
      if (error) {
        if (error.code === 'auth/oauth-cancelled') return;
        throw error;
      }
      if (!data?.user) return; // web: full-page redirect already in flight
      await ensureUserProfileForOAuthUser(data.user);
      const currentSession = await getCurrentSession().catch(() => null);
      const refreshToken = currentSession?.refresh_token || null;
      await completeAuthSession(data.user, true, navigation, (message) => setGlobalError(message), (info) => {
        if (refreshToken) {
          void saveAuthProfile({
            userId: data.user.id,
            role: info.role as SavedAuthProfile['role'],
            isEmail: true,
            displayName: info.displayName,
            avatarUrl: info.avatarUrl,
            refreshToken,
          }).catch((saveError) => console.warn('[Login] failed to save relogin profile:', saveError));
        }
      });
    } catch (error: any) {
      console.error('[Login] OAuth login error:', { provider, message: error?.message, code: error?.code });
      setGlobalError('Hindi ma-login gamit ang Google. Pakisubukang muli.');
    } finally {
      setOauthLoading(null);
    }
  };

  // One-tap re-login (panel item 1): MANDATORY gate behind the device's own
  // lock (fingerprint/face/PIN) - this replaced immediate server-side token
  // revocation as the security boundary (see supabaseService.ts's
  // signOutUser trade-off note), so it is never skipped. The picker is only
  // ever shown when canOfferOneTapLogin already confirmed a lock is
  // enrolled, but the device's lock state can change between screens (e.g.
  // someone removes their PIN in Settings mid-session), so this re-checks
  // and refuses to proceed - falling back to the full credential form -
  // rather than silently letting the tap through unguarded.
  const handleTapProfile = async (profile: SavedAuthProfile) => {
    setReloginError('');
    setReloginBusyId(profile.userId);
    try {
      const stillAvailable = await canUseLocalAuth();
      if (!stillAvailable) {
        setReloginBusyId(null);
        setLocalAuthAvailable(false);
        setShowFullForm(true);
        Alert.alert(
          'Kailangan ng Lock Screen',
          'Wala nang naka-set na fingerprint/face/PIN sa device na ito, kaya kailangan mong mag-log in gamit ang buong email at password.',
        );
        return;
      }

      const passedGate = await requireLocalAuth(`Kumpirmahin na ikaw si ${profile.displayName}`);
      if (!passedGate) {
        setReloginBusyId(null);
        return;
      }

      const { data, error } = await relogin(profile.refreshToken);
      if (error || !data?.session || !data?.user) {
        console.warn('[Login] saved profile relogin failed, dropping it:', error?.message || error);
        await removeSavedProfile(profile.userId);
        setSavedProfiles((prev) => prev.filter((p) => p.userId !== profile.userId));
        setReloginError('Nag-expire na ang naka-save na session. Mag-log in muli.');
        setReloginBusyId(null);
        return;
      }

      // Supabase rotates refresh tokens on every use - the token just spent
      // above is now invalid, so the new one must replace it immediately or
      // this saved profile would only ever work this one time.
      await updateSavedProfileToken(profile.userId, data.session.refresh_token);

      await completeAuthSession(data.user, profile.isEmail, navigation, (message) => setGlobalError(message));
    } catch (error: any) {
      console.error('[Login] one-tap relogin error:', error?.message || error);
      setReloginError('Hindi maka-log in. Subukang muli o gamitin ang buong form.');
    } finally {
      setReloginBusyId(null);
    }
  };

  // A REAL sign-out of a saved-but-not-currently-active profile: exchanges
  // its refresh token for a live session just long enough to revoke it
  // server-side (signOutUserFully), then drops it from the picker either
  // way. This is the "Hindi ikaw ito?" affordance - deliberately a visible
  // button on every tile (see the JSX below) rather than a hidden
  // long-press, so it's easy to find when handing a shared device to a
  // different student.
  const handleRemoveProfile = (profile: SavedAuthProfile) => {
    Alert.alert(
      'Mag-sign Out nang Tuluyan?',
      `Tatanggalin ang "${profile.displayName}" sa listahan ng mabilisang log in, at hindi na ito magagamit para mag-log in muli nang walang buong password.`,
      [
        { text: 'Kanselahin', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data } = await relogin(profile.refreshToken);
              if (data?.session) await signOutUserFully();
            } catch (error) {
              console.warn('[Login] revoke-on-remove failed (token may already be dead):', error);
            } finally {
              await removeSavedProfile(profile.userId);
              setSavedProfiles((prev) => prev.filter((p) => p.userId !== profile.userId));
            }
          },
        },
      ],
    );
  };

  const isBusy = loading || !!oauthLoading;
  // Supabase/backend authentication already applies server-side throttling.
  // A persistent client-only lockout was both bypassable and could strand a
  // legitimate user for an hour, so only an in-flight request disables taps.
  const isButtonDisabled = isBusy;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.backgroundDecor}>
          <View style={styles.circleTopLeft} />
          <View style={styles.circleRight} />
          <View style={styles.circleBottom} />
        </View>

        <View style={styles.topHeader}>
          <Image source={require('../../assets/Logo.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>Maligayang pagbabalik!</Text>
          <Text style={styles.subtitle}>Mag-login para ipagpatuloy ang iyong paglalakbay sa pagbasa.</Text>
        </View>

        {/* One-tap re-login (panel item 1): shown instead of the full form
            only when there are saved profiles AND the device has a
            fingerprint/face/PIN enrolled to gate them with (canOfferOneTapLogin),
            and the user hasn't asked for "Gumamit ng Ibang Account". Each tile
            requires that device lock before it's used - see handleTapProfile -
            so this isn't a bare bypass of the password on a shared family
            device. The "Hindi ikaw ito?" icon on each tile is a real,
            fully-revoking sign-out of that saved profile (see
            handleRemoveProfile) - deliberately a visible button, not a
            hidden long-press, so a parent/teacher switching the device to a
            different student can find it without knowing a gesture. */}
        {canOfferOneTapLogin && !showFullForm && (
          <View style={styles.card}>
            {reloginError ? (
              <Text style={styles.globalError} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {reloginError}
              </Text>
            ) : null}
            <Text style={styles.profilePickerTitle}>Sino ang mag-lo-log in?</Text>
            {savedProfiles.map((profile) => (
              <View key={profile.userId} style={styles.profileTile}>
                <TouchableOpacity
                  style={styles.profileTileTapArea}
                  onPress={() => void handleTapProfile(profile)}
                  disabled={!!reloginBusyId}
                  accessibilityRole="button"
                  accessibilityLabel={`Log in as ${profile.displayName}`}
                  accessibilityHint="Confirms with fingerprint, face, or PIN before logging in"
                >
                  {profile.avatarUrl ? (
                    <Image source={{ uri: profile.avatarUrl }} style={styles.profileTileAvatar} />
                  ) : (
                    <View style={styles.profileTileAvatarFallback}>
                      <Text style={styles.profileTileAvatarInitial}>{profile.displayName.trim().charAt(0).toUpperCase() || '?'}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.profileTileName}>{profile.displayName}</Text>
                    <Text style={styles.profileTileRole}>{profile.role === 'student' ? 'Mag-aaral' : profile.role === 'teacher' ? 'Guro' : 'Magulang'}</Text>
                  </View>
                  {reloginBusyId === profile.userId ? (
                    <ActivityIndicator color={colors.lavenderDark} />
                  ) : (
                    <Ionicons name="chevron-forward" size={20} color={colors.inkSoft} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.profileTileRemove}
                  onPress={() => handleRemoveProfile(profile)}
                  disabled={!!reloginBusyId}
                  accessibilityRole="button"
                  accessibilityLabel={`Not ${profile.displayName}? Sign out completely`}
                >
                  <Ionicons name="close-circle-outline" size={16} color={colors.inkSoft} />
                  <Text style={styles.profileTileRemoveText}>Hindi ikaw ito?</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              onPress={() => setShowFullForm(true)}
              style={styles.useOtherAccountRow}
              accessibilityRole="button"
              accessibilityLabel="Use a different account"
            >
              <Ionicons name="person-add-outline" size={18} color={colors.lavenderDark} />
              <Text style={styles.link}>Gumamit ng Ibang Account</Text>
            </TouchableOpacity>
          </View>
        )}

        {(showFullForm || !canOfferOneTapLogin) && (
        <View style={styles.card}>
          {globalError ? (
            <Text style={styles.globalError} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {globalError}
            </Text>
          ) : null}

          {canOfferOneTapLogin && (
            <TouchableOpacity
              onPress={() => setShowFullForm(false)}
              style={styles.backToProfilesRow}
              accessibilityRole="button"
              accessibilityLabel="Back to saved profiles"
            >
              <Ionicons name="arrow-back" size={16} color={colors.lavenderDark} />
              <Text style={styles.link}>Bumalik sa mga Naka-save na Profile</Text>
            </TouchableOpacity>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <View style={[
              styles.inputWrapper,
              (touchedIdentifier || submitAttempted) && identifierError && styles.inputError,
              (touchedIdentifier || submitAttempted) && !identifierError && identifier && styles.inputValid,
            ]}>
              <Ionicons name="mail-outline" size={20} color={colors.lavenderDark} style={styles.inputLeadingIcon} />
              <TextInput
                ref={identifierInputRef}
                style={styles.input}
                placeholder="Ilagay ang iyong email"
                placeholderTextColor={colors.inkSoft}
                value={identifier}
                onChangeText={(text) => {
                  setIdentifier(text);
                  validateIdentifier(text);
                }}
                onBlur={() => setTouchedIdentifier(true)}
                keyboardType="email-address"
                autoCapitalize="none"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => passwordInputRef.current?.focus()}
                editable={!loading}
                accessible={true}
                accessibilityLabel="Email input"
                accessibilityHint="Enter your email address to log in"
              />
              {(touchedIdentifier || submitAttempted) && identifier && !identifierError && (
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              )}
            </View>
            {(touchedIdentifier || submitAttempted) && identifierError ? <Text style={styles.errorText}>{identifierError}</Text> : null}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={[
              styles.inputWrapper,
              (touchedPassword || submitAttempted) && passwordError && styles.inputError,
              (touchedPassword || submitAttempted) && !passwordError && password && styles.inputValid,
            ]}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.lavenderDark} style={styles.inputLeadingIcon} />
              <TextInput
                ref={passwordInputRef}
                style={styles.input}
                placeholder="Ilagay ang iyong password"
                placeholderTextColor={colors.inkSoft}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  validatePassword(text);
                }}
                onBlur={() => setTouchedPassword(true)}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={() => void handleLogin()}
                editable={!loading}
                accessible={true}
                accessibilityLabel="Password input"
                accessibilityHint="Enter your password. Password is hidden by default"
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.passwordToggle}
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={22} color={colors.lavenderDark} />
              </TouchableOpacity>
            </View>
            {(touchedPassword || submitAttempted) && passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
          </View>

          <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')} style={styles.forgotPasswordRow}>
            <Text style={styles.link}>Nakalimutan ang Password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, isButtonDisabled ? styles.buttonDisabled : {}]}
            onPress={() => void handleLogin()}
            disabled={isButtonDisabled}
            accessibilityRole="button"
            accessibilityLabel="Log In"
            accessibilityState={{ disabled: isButtonDisabled, busy: loading }}
          >
            <Text style={styles.buttonText}>{loading ? 'Nag-lo-log in...' : 'Mag-log In'}</Text>
          </TouchableOpacity>

          {/* Only after a login attempt failed specifically because the email
              isn't verified yet — not a permanent link on every visit. The
              post-signup case is already handled by EmailVerification's own
              resend flow, which the user is redirected to automatically. */}
          {lastErrorCode === 'auth/email-not-confirmed' && (
            <TouchableOpacity onPress={() => navigation.navigate('EmailVerification', { email: identifier })} style={styles.resendRow}>
              <Text style={styles.resendLink}>Ipadala Muli ang Verification Code</Text>
            </TouchableOpacity>
          )}

          <View style={styles.oauthDivider}>
            <View style={styles.oauthDividerLine} />
            <Text style={styles.oauthDividerText}>O</Text>
            <View style={styles.oauthDividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.oauthButton, { marginBottom: 0 }, (isBusy) && styles.oauthButtonDisabled]}
            onPress={() => handleOAuthLogin('google')}
            disabled={isBusy}
          >
            <Ionicons name="logo-google" size={20} color="#DB4437" />
            <Text style={styles.oauthButtonText}>
              {oauthLoading === 'google' ? 'Kumokonekta...' : 'Magpatuloy gamit ang Google'}
            </Text>
          </TouchableOpacity>
        </View>
        )}

        <TouchableOpacity onPress={() => navigation.navigate('SignUp')} style={styles.signUpRow}>
          <Text style={styles.signUpLink}>Wala ka pang account? <Text style={styles.signUpLinkBold}>Mag-sign Up</Text></Text>
        </TouchableOpacity>

        {/* Standalone re-entry point for a user who signed up, closed the app
            before verifying, and has no active OTP session/route params to
            resume from — distinct from the resendRow above, which only
            appears right after a failed login tells us the email exists. */}
        <TouchableOpacity onPress={() => navigation.navigate('ResendVerification')} style={styles.signUpRow}>
          <Text style={styles.signUpLink}>Kailangan i-verify ang email mo? <Text style={styles.signUpLinkBold}>Ipadala Muli</Text></Text>
        </TouchableOpacity>

        <View style={styles.trustNote}>
          <Ionicons name="shield-checkmark-outline" size={14} color={colors.inkSoft} />
          <Text style={styles.trustNoteText}>Ligtas at pribado ang iyong impormasyon.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  profilePickerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.ink,
    fontFamily: typography.family.displaySemi,
    marginBottom: 16,
    textAlign: 'center',
  },
  profileTile: {
    backgroundColor: '#FAF8F3',
    borderWidth: 1,
    borderColor: 'rgba(124,111,207,0.2)',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  profileTileTapArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
  },
  profileTileRemove: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-end',
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 4,
    minHeight: 28,
  },
  profileTileRemoveText: {
    color: colors.inkSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  profileTileAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EFECFB',
  },
  profileTileAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.lavenderDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileTileAvatarInitial: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  profileTileName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  profileTileRole: {
    fontSize: 12,
    color: colors.inkSoft,
    marginTop: 2,
  },
  useOtherAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6,
    minHeight: 44,
  },
  backToProfilesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
    minHeight: 32,
  },
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: Platform.OS === 'ios' ? 44 : 32,
    paddingBottom: 40,
  },
  backgroundDecor: {
    ...StyleSheet.absoluteFillObject,
    zIndex: -1,
  },
  circleTopLeft: {
    position: 'absolute',
    top: -80,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(124,111,207,0.14)',
  },
  circleRight: {
    position: 'absolute',
    top: 28,
    right: -90,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(224,107,76,0.12)',
  },
  circleBottom: {
    position: 'absolute',
    bottom: -100,
    left: -60,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(92,128,71,0.08)',
  },
  topHeader: {
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 8,
  },
  logo: {
    width: 220,
    height: 110,
    alignSelf: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 26,
    textAlign: 'center',
    marginBottom: 4,
    fontFamily: typography.family.display,
    color: colors.ink,
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 18,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    color: colors.inkSoft,
    lineHeight: 22,
    letterSpacing: 0.2,
  },
  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 20,
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(124,111,207,0.14)',
    elevation: 10,
    marginTop: 14,
    // "shadow*" props are deprecated on web in favor of a real CSS boxShadow
    // string, but remain the correct (and only) cross-platform way to draw a
    // shadow on native iOS/Android, so the two are split per-platform here.
    ...Platform.select({
      web: { boxShadow: '0px 20px 40px rgba(59,50,44,0.12)' },
      default: { shadowColor: colors.ink, shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.1, shadowRadius: 40 },
    }),
  },
  globalError: {
    color: '#9A3412',
    textAlign: 'center',
    marginBottom: 16,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    backgroundColor: 'rgba(224,107,76,0.12)',
    padding: 14,
    borderRadius: 18,
    borderLeftWidth: 4,
    borderLeftColor: colors.coral,
  },
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    fontSize: 12,
    marginBottom: 8,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: colors.ink,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  inputWrapper: {
    backgroundColor: '#FAF8F3',
    borderWidth: 1,
    borderColor: 'rgba(124,111,207,0.25)',
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 60,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  inputLeadingIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: colors.ink,
    padding: 0,
    minHeight: 44,
  },
  inputValid: {
    borderColor: colors.success,
    backgroundColor: '#F2FBF4',
  },
  inputError: {
    borderColor: colors.coral,
    backgroundColor: '#FDF3EF',
  },
  passwordToggle: {
    paddingLeft: 8,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#B3441F',
    fontSize: 12,
    marginTop: 6,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '600',
  },
  forgotPasswordRow: {
    alignSelf: 'flex-end',
    marginBottom: 18,
    minHeight: 32,
    justifyContent: 'center',
  },
  button: {
    backgroundColor: colors.lavenderDark,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 24,
    alignItems: 'center',
    elevation: 3,
    ...Platform.select({
      web: { boxShadow: '0px 4px 12px rgba(95,82,176,0.28)' },
      default: { shadowColor: colors.lavenderDark, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 12 },
    }),
  },
  buttonDisabled: {
    backgroundColor: '#C7C2D6',
    opacity: 0.8,
    elevation: 0,
    ...Platform.select({
      web: { boxShadow: 'none' },
      default: { shadowOpacity: 0 },
    }),
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    fontFamily: typography.family.displaySemi,
  },
  resendRow: {
    alignSelf: 'center',
    marginTop: 16,
    minHeight: 32,
    justifyContent: 'center',
  },
  resendLink: {
    color: colors.inkSoft,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  link: {
    color: colors.lavenderDark,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '700',
  },
  oauthDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 20,
    marginBottom: 16,
  },
  oauthDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(59,50,44,0.14)',
  },
  oauthDividerText: {
    color: colors.inkSoft,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  oauthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: 'rgba(59,50,44,0.14)',
    borderRadius: 16,
    paddingVertical: 14,
    minHeight: 52,
    marginBottom: 12,
  },
  oauthButtonDisabled: {
    opacity: 0.6,
  },
  oauthButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
  },
  signUpRow: {
    marginTop: 20,
    alignSelf: 'center',
    minHeight: 32,
    justifyContent: 'center',
  },
  signUpLink: {
    textAlign: 'center',
    color: colors.inkSoft,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '500',
  },
  signUpLinkBold: {
    color: colors.lavenderDark,
    fontWeight: '800',
  },
  trustNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 18,
    paddingHorizontal: 20,
  },
  trustNoteText: {
    color: colors.inkSoft,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
  },
});

export default LoginScreen;
