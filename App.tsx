import React from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Baloo2_600SemiBold,
  Baloo2_700Bold,
  Baloo2_800ExtraBold,
} from '@expo-google-fonts/baloo-2';
import SplashScreen from './src/screens/SplashScreen';
import LoginScreen from './src/screens/LoginScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import ParentDashboard from './src/screens/ParentDashboardEnhanced';
import StudentDashboard from './src/screens/StudentDashboard';
import ParentSettings from './src/screens/ParentSettings';
import StudentSettings from './src/screens/StudentSettings';
import EditProfile from './src/screens/EditProfile';
import WelcomeScreen from './src/screens/WelcomeScreen';
import EmailVerification from './src/screens/EmailVerification';
import ForgotPassword from './src/screens/ForgotPassword';
import ResendVerification from './src/screens/ResendVerification';
import ErrorBoundary from './src/components/ErrorBoundary';

const Stack = createStackNavigator();

export default function App() {
  const [fontsLoaded] = useFonts({
    Baloo2_600SemiBold,
    Baloo2_700Bold,
    Baloo2_800ExtraBold,
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#fff' }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer>
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
            <Stack.Screen name="EditProfile" component={EditProfile} />
            <Stack.Screen name="ForgotPassword" component={ForgotPassword} />
            <Stack.Screen name="ResendVerification" component={ResendVerification} />
          </Stack.Navigator>
        </ErrorBoundary>
        <StatusBar style="auto" />
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
