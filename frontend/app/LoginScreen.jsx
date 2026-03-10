import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator
} from 'react-native';
import { supabase } from '../constants/supabase';

const C = {
  bg: '#f0f4f1',
  surface: '#ffffff',
  border: '#dde8e2',
  accent: '#2e7d5a',
  accentLight: '#e8f5ee',
  text: '#1a2e22',
  textMuted: '#607a6c',
  red: '#c0392b',
};

export default function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState('login'); // login | register | reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(''); setSuccess(''); setLoading(true);
    try {
      if (mode === 'register') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSuccess('¡Cuenta creada! Ahora podés iniciar sesión.');
        setMode('login');
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: 'https://dariobenavidez.github.io/mis-finanzas/',
        });
        if (error) throw error;
        setSuccess('¡Listo! Revisá tu email para restablecer la contraseña.');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onLogin(data.user);
      }
    } catch (e) {
      setError(e.message || 'Error al procesar la solicitud');
    }
    setLoading(false);
  };

  const tabs = [
    { key: 'login', label: 'Iniciar sesión' },
    { key: 'register', label: 'Registrarse' },
    { key: 'reset', label: 'Olvidé clave' },
  ];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logoBox}>
            <Text style={styles.logoEmoji}>💰</Text>
          </View>
          <Text style={styles.title}>Mis Finanzas</Text>
          <Text style={styles.subtitle}>Tu gestor financiero personal</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          {/* Tabs */}
          <View style={styles.tabs}>
            {tabs.map(t => (
              <TouchableOpacity
                key={t.key}
                style={[styles.tab, mode === t.key && styles.tabActive]}
                onPress={() => { setMode(t.key); setError(''); setSuccess(''); }}
              >
                <Text style={[styles.tabText, mode === t.key && styles.tabTextActive]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Email */}
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="tu@email.com"
            placeholderTextColor={C.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          {/* Password */}
          {mode !== 'reset' && (
            <>
              <Text style={styles.label}>Contraseña</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Mínimo 6 caracteres"
                placeholderTextColor={C.textMuted}
                secureTextEntry
              />
            </>
          )}

          {mode === 'reset' && (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>Te enviaremos un email para restablecer tu contraseña.</Text>
            </View>
          )}

          {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
          {success ? <View style={styles.successBox}><Text style={styles.successText}>{success}</Text></View> : null}

          {/* Button */}
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonText}>
                  {mode === 'login' ? 'Entrar' : mode === 'register' ? 'Crear cuenta' : 'Enviar email'}
                </Text>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logoContainer: { alignItems: 'center', marginBottom: 32 },
  logoBox: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: C.accent, alignItems: 'center',
    justifyContent: 'center', marginBottom: 14,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3, shadowRadius: 16, elevation: 8,
  },
  logoEmoji: { fontSize: 36 },
  title: { fontSize: 28, fontWeight: '800', color: C.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: C.textMuted, marginTop: 4 },
  card: {
    backgroundColor: C.surface, borderRadius: 24, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
  },
  tabs: {
    flexDirection: 'row', backgroundColor: C.bg,
    borderRadius: 12, padding: 4, marginBottom: 24,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: C.accent },
  tabText: { fontSize: 12, fontWeight: '600', color: C.textMuted },
  tabTextActive: { color: '#fff' },
  label: {
    fontSize: 11, fontWeight: '700', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
  },
  input: {
    backgroundColor: '#f8faf8', borderWidth: 1, borderColor: C.border,
    borderRadius: 12, padding: 14, fontSize: 14, color: C.text, marginBottom: 16,
  },
  infoBox: { backgroundColor: C.bg, borderRadius: 10, padding: 12, marginBottom: 16 },
  infoText: { fontSize: 13, color: C.textMuted },
  errorBox: {
    backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#f0c8c8',
    borderRadius: 10, padding: 12, marginBottom: 16,
  },
  errorText: { fontSize: 13, color: C.red },
  successBox: {
    backgroundColor: C.accentLight, borderWidth: 1, borderColor: C.accent + '40',
    borderRadius: 10, padding: 12, marginBottom: 16,
  },
  successText: { fontSize: 13, color: C.accent },
  button: {
    backgroundColor: C.accent, borderRadius: 14,
    padding: 15, alignItems: 'center', marginTop: 4,
  },
  buttonDisabled: { backgroundColor: '#a0c4b4' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
