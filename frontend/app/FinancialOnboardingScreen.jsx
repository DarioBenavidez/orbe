import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FontAwesome5 } from '@expo/vector-icons';
import { loadData, saveData } from '../constants/supabase';

const C = {
  green:      '#005247',
  gold:       '#C9A84C',
  goldLight:  '#E8C97A',
  white:      '#FFFFFF',
  whiteMuted: '#FFFFFF99',
  border:     '#FFFFFF25',
};

const DEFAULT_CATS = [
  { name: 'Vivienda',        icon: '🏠' },
  { name: 'Alimentación',    icon: '🛒' },
  { name: 'Transporte',      icon: '🚗' },
  { name: 'Salud',           icon: '💊' },
  { name: 'Entretenimiento', icon: '🎬' },
  { name: 'Servicios',       icon: '💡' },
  { name: 'Educación',       icon: '📚' },
  { name: 'Otros',           icon: '📦' },
];

const TOTAL_STEPS = 3;

function StepDots({ current }) {
  return (
    <View style={s.dots}>
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <View key={i} style={[s.dot, i === current && s.dotActive]} />
      ))}
    </View>
  );
}

export default function FinancialOnboardingScreen({ user, onDone }) {
  const [step, setStep]     = useState(0);
  const [sueldo, setSueldo] = useState('');
  const [saving, setSaving] = useState(false);

  const next = () => setStep(s => s + 1);
  const back = () => setStep(s => s - 1);

  const saveSueldo = async () => {
    if (!sueldo) { next(); return; }
    setSaving(true);
    try {
      const today  = new Date().toISOString().split('T')[0];
      const now    = new Date();
      const month  = now.getMonth();
      const year   = now.getFullYear();
      const amount = parseFloat(sueldo.replace(/\./g, ''));

      if (amount > 0) {
        let data = await loadData(user.id);
        if (!data) {
          data = {
            transactions: [], budgets: [], categories: {}, savings: [],
            debts: [], events: [], vocabulario: [], recurringIncomes: [],
            salaryOverrides: [], selectedMonth: month, selectedYear: year,
          };
        }
        const filtered = data.transactions.filter(t => {
          if (t.type !== 'sueldo') return true;
          const [y, m] = t.date.split('-').map(Number);
          return !(m - 1 === month && y === year);
        });
        data.transactions = [
          ...filtered,
          { id: Date.now().toString(), type: 'sueldo', amount, category: 'Sueldo', date: today, description: 'Sueldo mensual' },
        ];
        const overrides = (data.salaryOverrides || []).filter(
          o => !(o.fromMonth === month && o.fromYear === year)
        );
        data.salaryOverrides = [...overrides, { fromMonth: month, fromYear: year, amount }];
        await saveData(user.id, data);
      }
    } catch {}
    setSaving(false);
    next();
  };

  const finish = async () => {
    await AsyncStorage.setItem('orbe_financial_onboarded', '1');
    onDone();
  };

  const skip = async () => {
    await AsyncStorage.setItem('orbe_financial_onboarded', '1');
    onDone();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.root}>

        <View style={s.header}>
          <StepDots current={step} />
        </View>

        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ── PASO 1: Sueldo ── */}
          {step === 0 && (
            <View style={s.stepWrap}>
              <Text style={s.emoji}>💼</Text>
              <Text style={s.title}>¿Cuánto ganás por mes?</Text>
              <Text style={s.subtitle}>
                Con tu sueldo, Orbe sabe cuánto te queda disponible y puede proyectar tus ahorros mes a mes.
              </Text>

              <View style={s.amountBox}>
                <Text style={s.amountPrefix}>$</Text>
                <TextInput
                  style={s.amountInput}
                  value={sueldo}
                  onChangeText={v => setSueldo(v.replace(/\D/g,'').replace(/\B(?=(\d{3})+(?!\d))/g, '.'))}
                  placeholder="0"
                  placeholderTextColor={C.whiteMuted}
                  keyboardType="numeric"
                  returnKeyType="done"
                />
              </View>

              <Text style={s.hint}>
                Si no sabés la cantidad exacta, no hay problema — te espero.{'\n'}
                Podés cambiarlo cuando quieras desde la app.
              </Text>
            </View>
          )}

          {/* ── PASO 2: Categorías ── */}
          {step === 1 && (
            <View style={s.stepWrap}>
              <Text style={s.emoji}>🗂</Text>
              <Text style={s.title}>Organizá tus gastos</Text>
              <Text style={s.subtitle}>
                Cada gasto que cargués va a una categoría. Así Orbe te muestra exactamente en qué gastás más y dónde podés mejorar.
              </Text>

              <View style={s.catGrid}>
                {DEFAULT_CATS.map(cat => (
                  <View key={cat.name} style={s.catChip}>
                    <Text style={s.catIcon}>{cat.icon}</Text>
                    <Text style={s.catLabel}>{cat.name}</Text>
                  </View>
                ))}
              </View>

              <View style={s.infoBox}>
                <Text style={s.infoText}>
                  💡 Estas categorías ya vienen listas. Si necesitás una diferente, podés crearla desde la sección de Gastos dentro de la app.
                </Text>
              </View>
            </View>
          )}

          {/* ── PASO 3: WhatsApp ── */}
          {step === 2 && (
            <View style={s.stepWrap}>
              <View style={s.waCircle}>
                <FontAwesome5 name="whatsapp" size={44} color="#25D366" solid />
              </View>
              <Text style={s.title}>Tu asistente en WhatsApp</Text>
              <Text style={s.subtitle}>
                Podés usar Orbe sin abrir la app. Solo mandá un mensaje por WhatsApp y listo.
              </Text>

              <View style={s.waSteps}>
                {[
                  { n: '1', text: 'Andá a Perfil → Conectar WhatsApp dentro de la app.' },
                  { n: '2', text: 'Ingresá tu número y verificalo con el código que te enviamos.' },
                  { n: '3', text: 'Abrí el chat con Orbe y empezá a escribir.' },
                ].map(item => (
                  <View key={item.n} style={s.waStep}>
                    <View style={s.waStepNum}>
                      <Text style={{ color: C.green, fontWeight: '800', fontSize: 13 }}>{item.n}</Text>
                    </View>
                    <Text style={s.waStepText}>{item.text}</Text>
                  </View>
                ))}
              </View>

              <View style={s.infoBox}>
                <Text style={s.infoText}>
                  💬 Desde WhatsApp podés registrar gastos, consultar tu saldo, ver el precio del dólar y más — con un solo mensaje.
                </Text>
              </View>
            </View>
          )}

        </ScrollView>

        {/* ── Botones ── */}
        <View style={s.btnArea}>

          {step === 0 && (
            <View style={s.btnRow}>
              <TouchableOpacity onPress={skip} style={s.skipBtn}>
                <Text style={s.skipText}>Omitir</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveSueldo}
                style={[s.primaryBtn, saving && { opacity: 0.7 }]}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color={C.green} />
                  : <Text style={s.primaryText}>Siguiente</Text>
                }
              </TouchableOpacity>
            </View>
          )}

          {step === 1 && (
            <View style={s.btnRow}>
              <TouchableOpacity onPress={back} style={s.skipBtn}>
                <Text style={s.skipText}>Atrás</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={next} style={s.primaryBtn}>
                <Text style={s.primaryText}>Siguiente</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 2 && (
            <View style={s.btnRow}>
              <TouchableOpacity onPress={back} style={s.skipBtn}>
                <Text style={s.skipText}>Atrás</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={finish} style={s.primaryBtn}>
                <Text style={s.primaryText}>Comenzar</Text>
              </TouchableOpacity>
            </View>
          )}

        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.green },
  header: { alignItems: 'center', paddingTop: 56, paddingBottom: 8 },
  logo:   { width: 160, height: 64 },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 20 },

  dots:      { flexDirection: 'row', gap: 8, marginTop: 16 },
  dot:       { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFFFFF30' },
  dotActive: { backgroundColor: C.gold, width: 22 },

  stepWrap: { flex: 1, paddingTop: 28, alignItems: 'center' },
  emoji:    { fontSize: 52, marginBottom: 16 },
  title: {
    fontSize: 26, fontWeight: '800', color: C.white,
    textAlign: 'center', letterSpacing: -0.5, marginBottom: 12,
  },
  subtitle: {
    fontSize: 14, color: C.whiteMuted,
    textAlign: 'center', lineHeight: 22, marginBottom: 24,
  },
  hint: {
    fontSize: 12, color: C.whiteMuted,
    textAlign: 'center', lineHeight: 18, marginTop: 14,
  },

  // Sueldo
  amountBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF15', borderRadius: 20,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 20, paddingVertical: 4, width: '100%',
  },
  amountPrefix: { fontSize: 28, fontWeight: '700', color: C.gold, marginRight: 8 },
  amountInput:  { flex: 1, fontSize: 32, fontWeight: '800', color: C.white, paddingVertical: 12 },

  // Categorías
  catGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    justifyContent: 'center', marginBottom: 20,
  },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFFFFF15', borderRadius: 99,
    borderWidth: 1, borderColor: C.border,
    paddingVertical: 8, paddingHorizontal: 14,
  },
  catIcon:  { fontSize: 15 },
  catLabel: { fontSize: 12, color: C.white, fontWeight: '600' },

  // Info box
  infoBox: {
    backgroundColor: '#FFFFFF0F', borderRadius: 16,
    borderWidth: 1, borderColor: C.border,
    padding: 16, width: '100%',
  },
  infoText: { fontSize: 13, color: C.whiteMuted, lineHeight: 20 },

  // WhatsApp
  waCircle: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: '#FFFFFF15', borderWidth: 1, borderColor: '#25D36640',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  waSteps: { width: '100%', gap: 14, marginBottom: 20 },
  waStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  waStepNum: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 1,
  },
  waStepText: { flex: 1, color: C.white, fontSize: 14, lineHeight: 21 },

  // Buttons
  btnArea: { paddingHorizontal: 24, paddingBottom: 44, paddingTop: 12 },
  btnRow:  { flexDirection: 'row', gap: 12 },
  skipBtn: {
    flex: 1, paddingVertical: 16, alignItems: 'center',
    borderRadius: 18, borderWidth: 1, borderColor: C.border,
  },
  skipText: { color: C.whiteMuted, fontSize: 15, fontWeight: '600' },
  primaryBtn: {
    flex: 2, paddingVertical: 16, alignItems: 'center',
    borderRadius: 18, backgroundColor: C.gold,
    borderWidth: 1, borderColor: C.goldLight,
  },
  primaryText: { color: C.green, fontSize: 15, fontWeight: '800' },
});
