import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, ImageBackground, Image, Dimensions } from 'react-native';

interface SplashScreenProps {
  navigation: any;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ navigation }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => navigation.replace('Login'), 2200);
    return () => clearTimeout(timer);
  }, [navigation, opacity, scale]);

  const bg = require('../../assets/background.png');
  const logo = require('../../assets/Logo.jpg');

  return (
    <ImageBackground source={bg} style={styles.container} resizeMode="cover">
      <Animated.View style={[styles.content, { opacity, transform: [{ scale }] }]}>
        <Image source={logo} style={styles.logo} resizeMode="contain" />
        <Text style={styles.tagline}>Linaw ng Pagbasa. Lakas ng Kinabukasan.</Text>
      </Animated.View>
    </ImageBackground>
  );
};

const { width, height } = Dimensions.get('window');
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
