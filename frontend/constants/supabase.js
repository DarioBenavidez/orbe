import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = 'https://cvazbnthpsntqoatzswj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2YXpibnRocHNudHFvYXR6c3dqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMzkyMTMsImV4cCI6MjA4NzgxNTIxM30.KLevD2MfnMD0lndOhvngaG5JR76VKTBg_ofCmerRCRg';

// URL del backend en Railway — actualizar si cambia el dominio
export const BACKEND_URL = 'https://orbe-bot-production.up.railway.app';

// SecureStore tiene límite de 2048 bytes por item.
// Este adapter divide valores grandes en chunks encriptados en lugar de
// caer a AsyncStorage en plaintext.
const CHUNK_SIZE = 1900; // margen bajo el límite de 2048

const LargeSecureStore = {
  async getItem(key) {
    try {
      // Intentar lectura directa primero
      const direct = await SecureStore.getItemAsync(key);
      if (direct !== null) return direct;
      // Intentar lectura chunked
      const countStr = await SecureStore.getItemAsync(`${key}__n`);
      if (!countStr) return AsyncStorage.getItem(key); // fallback legacy
      const count = parseInt(countStr, 10);
      const chunks = await Promise.all(
        Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${key}__${i}`))
      );
      if (chunks.some(c => c === null)) return null;
      return chunks.join('');
    } catch {
      return AsyncStorage.getItem(key);
    }
  },
  async setItem(key, value) {
    try {
      if (value.length <= CHUNK_SIZE) {
        await this._deleteChunks(key); // limpiar chunks viejos si existían
        return SecureStore.setItemAsync(key, value);
      }
      // Dividir en chunks y guardar cada uno encriptado
      const chunks = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) {
        chunks.push(value.slice(i, i + CHUNK_SIZE));
      }
      await Promise.all(chunks.map((chunk, i) => SecureStore.setItemAsync(`${key}__${i}`, chunk)));
      await SecureStore.setItemAsync(`${key}__n`, String(chunks.length));
      await SecureStore.deleteItemAsync(key).catch(() => {}); // eliminar versión directa si existía
    } catch {
      return AsyncStorage.setItem(key, value);
    }
  },
  async removeItem(key) {
    await this._deleteChunks(key);
    await SecureStore.deleteItemAsync(key).catch(() => {});
    await AsyncStorage.removeItem(key);
  },
  async _deleteChunks(key) {
    try {
      const countStr = await SecureStore.getItemAsync(`${key}__n`);
      if (!countStr) return;
      const count = parseInt(countStr, 10);
      await Promise.all([
        ...Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(`${key}__${i}`).catch(() => {})),
        SecureStore.deleteItemAsync(`${key}__n`).catch(() => {}),
      ]);
    } catch {}
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: LargeSecureStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export async function loadData(uid) {
  const { data, error } = await supabase
    .from('finanzas')
    .select('data')
    .eq('id', uid)
    .single();
  if (error || !data) return null;
  const d = data.data;
  if (!d || typeof d !== 'object') return null;
  // Merge with defaults to handle users with older schema (missing fields)
  return {
    transactions:     Array.isArray(d.transactions)    ? d.transactions    : [],
    budgets:          Array.isArray(d.budgets)          ? d.budgets         : [],
    categories:       d.categories && typeof d.categories === 'object' ? d.categories : {},
    savings:          Array.isArray(d.savings)          ? d.savings         : [],
    debts:            Array.isArray(d.debts)            ? d.debts           : [],
    events:           Array.isArray(d.events)           ? d.events          : [],
    turnos:           Array.isArray(d.turnos)           ? d.turnos          : [],
    loans:            Array.isArray(d.loans)            ? d.loans           : [],
    credits:          d.credits && typeof d.credits === 'object' ? d.credits : {},
    vocabulario:      Array.isArray(d.vocabulario)      ? d.vocabulario     : [],
    recurringIncomes:   Array.isArray(d.recurringIncomes)   ? d.recurringIncomes   : [],
    salaryOverrides:    Array.isArray(d.salaryOverrides)    ? d.salaryOverrides    : [],
    suscripciones:      Array.isArray(d.suscripciones)      ? d.suscripciones      : [],
    recurringExpenses:  Array.isArray(d.recurringExpenses)  ? d.recurringExpenses  : [],
    selectedMonth:    typeof d.selectedMonth === 'number' ? d.selectedMonth : new Date().getMonth(),
    selectedYear:     typeof d.selectedYear  === 'number' ? d.selectedYear  : new Date().getFullYear(),
  };
}

export async function saveData(uid, payload) {
  const { error } = await supabase
    .from('finanzas')
    .upsert({ id: uid, data: payload, updated_at: new Date().toISOString() });
  if (error) throw error;
}
