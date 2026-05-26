import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { colors } from '../config/theme';
import { getWordOfTheDay, WordOfTheDay } from '../services/streakService';
import { getCurrentUser, getUserProfileById } from '../services/supabaseService';

type WelcomeRouteProp = RouteProp<{ Welcome: { studentId?: string; studentName?: string } }, 'Welcome'>;

const WelcomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<WelcomeRouteProp>();
  const [studentName, setStudentName] = useState<string>('Mag-aaral');
  const [wordOfTheDay, setWordOfTheDay] = useState<WordOfTheDay | null>(null);
  const [loading, setLoading] = useState(true);

  const speakWelcome = (name: string, word: string) => {
    const message = `Kumusta, ${name}! Welcome back to LinawLetra. Ready to practice today\'s word? Ang salita ng araw ay ${word}.`;
    Speech.speak(message, { language: 'fil-PH', rate: 0.95 });
  };

  const loadStudentName = async () => {
    const routeName = route.params?.studentName;
    const routeId = route.params?.studentId;
    if (routeName) {
      setStudentName(routeName);
    }

    try {
      const currentUser = await getCurrentUser();
      const uid = routeId || currentUser?.id;
      const userNameFallback = routeName || currentUser?.user_metadata?.full_name || currentUser?.email || 'Mag-aaral';
      if (uid) {
        const profileResult = await getUserProfileById(uid);
        if (profileResult.data) {
          const name = typeof profileResult.data.name === 'string' ? profileResult.data.name : userNameFallback;
          if (name) setStudentName(name);
        } else {
          setStudentName(userNameFallback);
        }
      }
    } catch (error) {
      console.warn('Unable to load student name for welcome screen:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const word = getWordOfTheDay();
    setWordOfTheDay(word);
    void loadStudentName();
  }, []);

  useEffect(() => {
    if (wordOfTheDay && !loading) {
      speakWelcome(studentName, wordOfTheDay.word);
    }
  }, [studentName, wordOfTheDay, loading]);

  const handleStartPractice = () => {
    navigation.navigate('StudentDashboard', { activeTab: 'activities' });
  };

  const handleReplayWord = () => {
    if (wordOfTheDay) {
      Speech.speak(`Ang salita ng araw ay ${wordOfTheDay.word}.`, { language: 'fil-PH', rate: 0.95 });
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Inaayos ang welcome page...</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.greeting}>👋 Kumusta, {studentName}!</Text>
        <Text style={styles.subtitle}>Welcome back to LinawLetra.</Text>
        <Text style={styles.body}>Ready to practice today’s word?</Text>

        <View style={styles.welcomeCard}>
          <Text style={styles.wordLabel}>Word of the Day</Text>
          <Text style={styles.wordText}>{wordOfTheDay?.word}</Text>
          <Text style={styles.wordNote}>{wordOfTheDay?.tagalog || 'Practice this word with your voice.'}</Text>
          <TouchableOpacity style={styles.replayButton} onPress={handleReplayWord}>
            <Ionicons name="volume-high" size={18} color="#1B5E20" />
            <Text style={styles.replayText}>Replay</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.startButton} onPress={handleStartPractice}>
          <Text style={styles.startButtonText}>Start Practice</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#E8F5E9',
    padding: 18,
    justifyContent: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
  },
  loadingText: {
    marginTop: 14,
    fontSize: 16,
    color: colors.primary,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  greeting: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1B5E20',
    marginBottom: 8,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  subtitle: {
    fontSize: 18,
    color: '#33691E',
    marginBottom: 16,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  body: {
    fontSize: 16,
    color: '#4E342E',
    marginBottom: 24,
    lineHeight: 24,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  welcomeCard: {
    backgroundColor: '#F1F8E9',
    borderRadius: 24,
    padding: 22,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  wordLabel: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '700',
    marginBottom: 10,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  wordText: {
    fontSize: 36,
    fontWeight: '800',
    color: '#1B5E20',
    marginBottom: 10,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  wordNote: {
    fontSize: 14,
    color: '#4E342E',
    marginBottom: 18,
    lineHeight: 22,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  replayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D0F0C0',
    paddingVertical: 12,
    borderRadius: 16,
  },
  replayText: {
    marginLeft: 8,
    fontSize: 15,
    color: '#1B5E20',
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  startButton: {
    backgroundColor: colors.primary,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
});

export default WelcomeScreen;

