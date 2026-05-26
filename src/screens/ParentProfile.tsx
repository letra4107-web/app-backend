import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../config/supabase';
import { signOutUser } from '../services/supabaseService';
import { updateProfile } from '../services/profileService';

export default function ParentProfile({
  userId,
  name,
  email,
  onNameSaved,
  onLogout,
}: {
  userId: string;
  name: string;
  email: string;
  onNameSaved: (name: string) => void;
  onLogout: () => void;
}) {
  const [displayName, setDisplayName] = useState(name);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const saveName = async () => {
    if (displayName.trim().length < 2) {
      setError('Ilagay ang tamang pangalan.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateProfile({ id: userId, full_name: displayName.trim(), name: displayName.trim(), email });
      onNameSaved(displayName.trim());
      setMessage('Na-save ang pangalan.');
    } catch {
      setError('Hindi na-save ang pangalan.');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (password.length < 8) {
      setError('Password ay dapat 8 characters pataas.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword('');
      setMessage('Napaltan ang password.');
    } catch {
      setError('Hindi napalitan ang password.');
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    await signOutUser();
    onLogout();
  };

  return (
    <View>
      {!!message && <Text style={styles.success}>{message}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Text style={styles.label}>Pangalan</Text>
      <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} />
      <TouchableOpacity style={styles.button} onPress={saveName} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>I-save</Text>}
      </TouchableOpacity>

      <Text style={styles.label}>Email</Text>
      <TextInput style={[styles.input, styles.readOnly]} value={email} editable={false} />

      <Text style={styles.label}>Bagong Password</Text>
      <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Minimum 8 characters" />
      <TouchableOpacity style={styles.button} onPress={changePassword} disabled={saving}>
        <Text style={styles.buttonText}>Palitan ang Password</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logout} onPress={logout}>
        <Text style={styles.buttonText}>Mag-log out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: '800', marginTop: 14, marginBottom: 6, color: '#374151' },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, padding: 12, backgroundColor: '#fff' },
  readOnly: { backgroundColor: '#F3F4F6', color: '#6B7280' },
  button: { backgroundColor: '#4f46e5', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  logout: { backgroundColor: '#E74C3C', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 22 },
  buttonText: { color: '#fff', fontWeight: '800' },
  error: { color: '#E74C3C', marginBottom: 8 },
  success: { color: '#27AE60', marginBottom: 8, fontWeight: '700' },
});
