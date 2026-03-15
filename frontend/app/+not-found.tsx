import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../constants/supabase';

// Shown when Expo Router can't match a route (e.g. orbe://auth/callback deep link).
// The layout's Linking listener exchanges the OAuth code; we wait for the session.
export default function NotFound() {
  useEffect(() => {
    // Watch for session (set by _layout's Linking handler)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) router.replace('/');
    });

    // Also check if session already exists (race condition)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/');
    });

    // Fallback: if no session in 8s, go home anyway
    const timer = setTimeout(() => router.replace('/'), 8000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#005247', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color="#C9A84C" />
    </View>
  );
}
