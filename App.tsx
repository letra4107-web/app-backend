import React from 'react';
import { Linking, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { getStateFromPath, NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Baloo2_600SemiBold,
  Baloo2_700Bold,
  Baloo2_800ExtraBold,
} from '@expo-google-fonts/baloo-2';
import {
  Lexend_400Regular,
  Lexend_500Medium,
  Lexend_700Bold,
} from '@expo-google-fonts/lexend';
import { AccessibilityProvider } from './src/contexts/AccessibilityContext';
import SplashScreen from './src/screens/SplashScreen';
import LoginScreen from './src/screens/LoginScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import ParentDashboard from './src/screens/ParentDashboardEnhanced';
import StudentDashboard from './src/screens/StudentDashboard';
import ParentSettings from './src/screens/ParentSettings';
import StudentSettings from './src/screens/StudentSettings';
import WelcomeScreen from './src/screens/WelcomeScreen';
import EmailVerification from './src/screens/EmailVerification';
import ForgotPassword from './src/screens/ForgotPassword';
import ResetPassword from './src/screens/ResetPassword';
import ResendVerification from './src/screens/ResendVerification';
import ErrorBoundary from './src/components/ErrorBoundary';

const Stack = createStackNavigator();

// Lets the password-reset email link (linawletra://reset-password?code=...)
// open the app directly into the ResetPassword screen, with the `code` query
// param handed to it as route.params.code — both cold-start (app not running)
// and warm (already open) cases are handled by this same config.
const normalizeRecoveryUrl = (url: string) =>
  url.replace(
    /#(?=(?:access_token|refresh_token|token_hash|type|error|error_description)=)/,
    url.includes('?') ? '&' : '?'
  );

const linking = {
  prefixes: ['linawletra://'],
  async getInitialURL() {
    const url = await Linking.getInitialURL();
    return url ? normalizeRecoveryUrl(url) : null;
  },
  subscribe(listener: (url: string) => void) {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      listener(normalizeRecoveryUrl(url));
    });
    return () => subscription.remove();
  },
  getStateFromPath(path: string, options: any) {
    // Supabase implicit recovery links place session values in the URL hash.
    // React Navigation normally ignores that fragment, so normalize it into
    // query parameters before building ResetPassword's route params.
    const normalizedPath = normalizeRecoveryUrl(path);
    return getStateFromPath(normalizedPath, options);
  },
  config: {
    screens: {
      ResetPassword: 'reset-password',
    },
  },
};

export default function App() {
  const [fontsLoaded] = useFonts({
    Baloo2_600SemiBold,
    Baloo2_700Bold,
    Baloo2_800ExtraBold,
    Lexend_400Regular,
    Lexend_500Medium,
    Lexend_700Bold,
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#fff' }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AccessibilityProvider>
        <NavigationContainer linking={linking}>
          <ErrorBoundary title="LinawLetra needs a refresh" message="The app hit an unexpected error. Try again to reload this view.">
            <Stack.Navigator initialRouteName="Splash" screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Splash" component={SplashScreen} />
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="SignUp" component={SignUpScreen} />
              <Stack.Screen name="EmailVerification" component={EmailVerification} />
              <Stack.Screen name="Welcome" component={WelcomeScreen} />
              <Stack.Screen name="ParentDashboard" component={ParentDashboard} />
              <Stack.Screen name="StudentDashboard" component={StudentDashboard} />
              <Stack.Screen name="ParentSettings" component={ParentSettings} />
              <Stack.Screen name="StudentSettings" component={StudentSettings} />
              <Stack.Screen name="ForgotPassword" component={ForgotPassword} />
              <Stack.Screen name="ResetPassword" component={ResetPassword} />
              <Stack.Screen name="ResendVerification" component={ResendVerification} />
            </Stack.Navigator>
          </ErrorBoundary>
          <StatusBar style="auto" />
        </NavigationContainer>
      </AccessibilityProvider>
    </GestureHandlerRootView>
  );
}
