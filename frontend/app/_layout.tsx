import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { supabase } from '../constants/supabase';

export default function RootLayout() {
  useEffect(() => {
    const handleUrl = async (url: string) => {
      const { queryParams } = Linking.parse(url);
      const code = queryParams?.code as string | undefined;
      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
        router.replace('/');
      }
    };

    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    Linking.getInitialURL().then(url => { if (url) handleUrl(url); });
    return () => sub.remove();
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}
