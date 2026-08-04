import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../config/supabase';
import { fetchProfile, updateProfile, uploadAvatar } from '../services/profileService';
import { useNavigation } from '@react-navigation/native';

export default function EditProfile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<any>({});
  const navigation = useNavigation();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        if (!user) return;
        const p = await fetchProfile(user.id);
        setProfile(p || {});
      } catch {
        Alert.alert('Error', 'Could not load profile');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const pickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission required', 'Please grant access to select a photo');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
      if (!result.cancelled) {
        setProfile({ ...profile, avatar_url: result.uri });
      }
    } catch {
      Alert.alert('Error', 'Could not pick image');
    }
  };

  const save = async () => {
    try {
      setSaving(true);
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (!user) throw new Error('Not logged in');
      // If avatar is local uri, upload it
      if (profile.avatar_url && profile.avatar_url.startsWith('file')) {
        await uploadAvatar(user.id, profile.avatar_url);
      }
      await updateProfile({ id: user.id, full_name: profile.full_name, username: profile.username, email: profile.email, phone: profile.phone, birthdate: profile.birthdate, gender: profile.gender, address: profile.address });
      if (Platform.OS === 'android') {
        // quick toast
        // @ts-ignore
        if (global?.ToastAndroid) global.ToastAndroid.show('Profile saved', global.ToastAndroid.SHORT);
      } else {
        Alert.alert('Success', 'Profile saved');
      }
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.avatarPicker} onPress={pickImage}>
        <Text style={styles.avatarPickerText}>Change Profile Photo</Text>
      </TouchableOpacity>

      <TextInput style={styles.input} placeholder="Full name" value={profile.full_name} onChangeText={(t) => setProfile({ ...profile, full_name: t })} />
      <TextInput style={styles.input} placeholder="Username" value={profile.username} onChangeText={(t) => setProfile({ ...profile, username: t })} />
      <TextInput style={styles.input} placeholder="Email" keyboardType="email-address" value={profile.email} onChangeText={(t) => setProfile({ ...profile, email: t })} />
      <TextInput style={styles.input} placeholder="Phone" keyboardType="phone-pad" value={profile.phone} onChangeText={(t) => setProfile({ ...profile, phone: t })} />
      <TextInput style={styles.input} placeholder="Birthdate (YYYY-MM-DD)" value={profile.birthdate} onChangeText={(t) => setProfile({ ...profile, birthdate: t })} />
      <TextInput style={styles.input} placeholder="Gender" value={profile.gender} onChangeText={(t) => setProfile({ ...profile, gender: t })} />
      <TextInput style={styles.input} placeholder="Address (optional)" value={profile.address} onChangeText={(t) => setProfile({ ...profile, address: t })} />

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.button, styles.cancel]} onPress={() => navigation.goBack()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.save]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save Changes</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f8fafc' },
  avatarPicker: { padding: 14, alignItems: 'center', backgroundColor: '#eef2ff', borderRadius: 10, marginBottom: 12 },
  avatarPickerText: { color: '#4f46e5', fontWeight: '700' },
  input: { backgroundColor: '#fff', padding: 12, borderRadius: 10, marginBottom: 10 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  button: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
  cancel: { backgroundColor: '#fff', marginRight: 8 },
  save: { backgroundColor: '#4f46e5', marginLeft: 8 },
  cancelText: { color: '#374151', fontWeight: '700' },
  saveText: { color: '#fff', fontWeight: '700' },
});
