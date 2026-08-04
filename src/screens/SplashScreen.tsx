import React, { useEffect, useRef } from 'react';
import { Text, StyleSheet, Animated, ImageBackground, Image, Dimensions, Platform } from 'react-native';
import { supabase } from '../config/supabase';
import { completeAuthSession } from '../services/supabaseService';

interface SplashScreenProps {
  navigation: any;
}

// react-native-web has no native animated module at all (there's nothing to
// autolink - the browser has no native driver concept), so useNativeDriver:
// true always logs this warning there while silently falling back to a JS
// driven animation. It's real native-module autolinking on iOS/Android, so
// native builds keep the native driver; only web is downgraded.
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

const SplashScreen: React.FC<SplashScreenProps> = ({ navigation }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: USE_NATIVE_DRIVER }),
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: USE_NATIVE_DRIVER }),
    ]).start();

    // Without this, a perfectly valid persisted session (AsyncStorage on
    // native, localStorage on web) was still discarded on every cold start —
    // this screen always sent the user to Login regardless of whether they
    // were already signed in.
    const timer = setTimeout(async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.user) {
          await completeAuthSession(data.session.user, true, navigation);
          return;
        }
      } catch (error) {
        console.error('[Splash] Session restore check failed:', error);
      }
      navigation.replace('Login');
    }, 2200);
    return () => clearTimeout(timer);
  }, [navigation, opacity, scale]);

  const bg = require('../../assets/background.png');
  const logo = require('../../assets/Logo.png');

  return (
    <ImageBackground source={bg} style={styles.container} resizeMode="cover">
      <Animated.View style={[styles.content, { opacity, transform: [{ scale }] }]}>
        <Image source={logo} style={styles.logo} resizeMode="contain" />
        <Text style={styles.tagline}>Linaw ng Pagbasa. Lakas ng Kinabukasan.</Text>
      </Animated.View>
    </ImageBackground>
  );
};

const { width } = Dimensions.get('window');
const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  content: {
    alignItems: 'center',
    width: Math.min(420, width * 0.9),
    paddingHorizontal: 12,
  },
  logo: {
    width: '92%',
    height: undefined,
    aspectRatio: 1,
    maxWidth: 520,
    marginBottom: 14,
  },
  tagline: {
    fontSize: 16,
    color: '#4f46e5',
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
});

export default SplashScreen;
