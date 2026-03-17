import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { supabase } from '../constants/supabase';
import LoginScreen from './LoginScreen';
import MainApp from './MainApp';
import OnboardingScreen from './OnboardingScreen';
import FinancialOnboardingScreen from './FinancialOnboardingScreen';

const C = {
  green: '#005247', gold: '#C9A84C', bg: '#005247',
  text: '#FFFFFF', textMuted: '#FFFFFF80',
};

export default function Index() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [onboarded, setOnboarded]           = useState<boolean | null>(null);
  const [financialOnboarded, setFinancialOnboarded] = useState<boolean | null>(null);
  useEffect(() => {
    // Check if onboarded
    AsyncStorage.getItem('orbe_onboarded').then(v => setOnboarded(v === '1'));
    AsyncStorage.getItem('orbe_financial_onboarded').then(v => setFinancialOnboarded(v === '1'));

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
        promptMessage: 'Desbloqueá Orbe',
        fallbackLabel: 'Usar contraseña',
        cancelLabel: 'Cancelar',
        disableDeviceFallback: false,
      });
      if (result.success) {
        setLocked(false);
      }
    } catch (e) {
      // error silencioso — fallo de biometría es esperado en dispositivos sin sensor
    }
  };

  const logout = () => {
    Alert.alert('Cerrar sesión', '¿Querés cerrar sesión?', [
      { text: 'Cancelar' },
      { text: 'Salir', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  };

  if (onboarded === null || financialOnboarded === null || loading) return (
    <View style={s.center}>
      <Image source={require('../assets/images/orbe-logo.png')} style={{ width: 180, height: 72 }} resizeMode="contain"/>
      <ActivityIndicator size="large" color={C.gold} style={{ marginTop: 40 }}/>
    </View>
  );

  if (!onboarded) return <OnboardingScreen onDone={() => setOnboarded(true)} />;

  if (!user) return <LoginScreen onLogin={setUser} />;

  if (user && !financialOnboarded) return (
    <FinancialOnboardingScreen
      user={user}
      onDone={() => setFinancialOnboarded(true)}
    />
  );

  if (locked) return (
    <View style={s.center}>
      <Image source={require('../assets/images/orbe-logo.png')} style={{ width: 180, height: 72, marginBottom: 48 }} resizeMode="contain"/>
      <Text style={s.lockSub}>Verificá tu identidad para continuar</Text>

      {bioAvailable ? (
        <TouchableOpacity style={s.bioBtn} onPress={authenticate}>
          <Text style={{ fontSize: 36 }}>👆</Text>
          <Text style={s.bioBtnText}>Usar huella / Face ID</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={s.bioBtn} onPress={() => setLocked(false)}>
          <Text style={s.bioBtnText}>Continuar</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={logout} style={{ marginTop: 28 }}>
        <Text style={{ color: C.textMuted, fontSize: 13 }}>Cerrar sesión</Text>
      </TouchableOpacity>
    </View>
  );

  return <MainApp user={user} onLogout={logout} />;
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', padding: 32 },
  lockSub: { fontSize: 14, color: C.textMuted, marginBottom: 40, textAlign: 'center' },
  bioBtn: {
    backgroundColor: '#FFFFFF15',
    borderWidth: 1, borderColor: '#FFFFFF30',
    borderRadius: 24, paddingVertical: 22, paddingHorizontal: 40,
    alignItems: 'center', gap: 10,
  },
  bioBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
