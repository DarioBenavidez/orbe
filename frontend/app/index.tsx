import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { supabase } from '../constants/supabase';
import LoginScreen from './LoginScreen';
import MainApp from './MainApp';

const C = {
  bg: '#f0f4f1', accent: '#2e7d5a', text: '#1a2e22', textMuted: '#607a6c',
};

export default function Index() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);

  useEffect(() => {
    // Check biometric availability
    LocalAuthentication.hasHardwareAsync().then(has => {
      if (has) LocalAuthentication.isEnrolledAsync().then(setBioAvailable);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        setLocked(true); // lock on session restore
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user || null);
      if (!session?.user) setLocked(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Auto-trigger biometric when locked screen appears
  useEffect(() => {
    if (locked && bioAvailable) {
      authenticate();
    }
  }, [locked, bioAvailable]);

  const authenticate = async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Desbloqueá Mis Finanzas',
        fallbackLabel: 'Usar contraseña',
        cancelLabel: 'Cancelar',
        disableDeviceFallback: false,
      });
      if (result.success) {
        setLocked(false);
      }
    } catch (e) {
      console.log('Bio error:', e);
    }
  };

  const logout = () => {
    Alert.alert('Cerrar sesión', '¿Querés cerrar sesión?', [
      { text: 'Cancelar' },
      { text: 'Salir', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  };

  if (loading) return (
    <View style={s.center}>
      <ActivityIndicator size="large" color={C.accent} />
    </View>
  );

  if (!user) return <LoginScreen onLogin={setUser} />;

  if (locked) return (
    <View style={s.center}>
      <View style={s.lockBox}>
        <Text style={{ fontSize: 56, marginBottom: 24 }}>🔒</Text>
        <Text style={s.lockTitle}>Mis Finanzas</Text>
        <Text style={s.lockSub}>Verificá tu identidad para continuar</Text>

        {bioAvailable ? (
          <TouchableOpacity style={s.bioBtn} onPress={authenticate}>
            <Text style={{ fontSize: 32 }}>👆</Text>
            <Text style={s.bioBtnText}>Usar huella dactilar</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.bioBtn} onPress={() => setLocked(false)}>
            <Text style={s.bioBtnText}>Continuar</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={logout} style={{ marginTop: 24 }}>
          <Text style={{ color: C.textMuted, fontSize: 13 }}>Cerrar sesión</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return <MainApp user={user} onLogout={logout} />;
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  lockBox: { alignItems: 'center', padding: 32 },
  lockTitle: { fontSize: 28, fontWeight: '800', color: C.text, marginBottom: 8 },
  lockSub: { fontSize: 14, color: C.textMuted, marginBottom: 40, textAlign: 'center' },
  bioBtn: {
    backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center',
    width: 160, shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 16, elevation: 4, gap: 8,
  },
  bioBtnText: { fontSize: 14, fontWeight: '600', color: C.accent },
});
