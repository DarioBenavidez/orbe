import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { supabase } from '../../constants/supabase';

export default function AuthCallback() {
  const url = Linking.useURL();

  useEffect(() => {
    const handle = async (targetUrl: string | null) => {
      if (!targetUrl) return;
      const { queryParams } = Linking.parse(targetUrl);
      const code = queryParams?.code as string | undefined;
      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
      }
      router.replace('/');
    };
    handle(url);
  }, [url]);

  return (
    <View style={{ flex: 1, backgroundColor: '#005247', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color="#C9A84C" />
    </View>
  );
}
