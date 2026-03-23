import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FontAwesome5 } from '@expo/vector-icons';
import { loadData, saveData } from '../constants/supabase';

const C = {
  green:      '#005247',
  greenDark:  '#003D36',
  gold:       '#C9A84C',
  goldLight:  '#E8C97A',
  white:      '#FFFFFF',
  whiteMuted: '#FFFFFF99',
  whiteDim:   '#FFFFFF40',
  border:     '#FFFFFF20',
  surface:    '#FFFFFF12',
  surface2:   '#FFFFFF08',
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

const STEPS = [
  { label: 'Ingresos' },
  { label: 'Categorías' },
  { label: 'WhatsApp' },
];

function ProgressBar({ current }) {
  return (
    <View style={s.progressWrap}>
      {STEPS.map((step, i) => (
        <View key={i} style={s.progressItem}>
          <View style={[s.progressDot, i <= current && s.progressDotActive, i === current && s.progressDotCurrent]}>
            {i < current
              ? <Text style={{ fontSize: 10, color: C.green, fontWeight: '800' }}>✓</Text>
              : <Text style={{ fontSize: 11, color: i === current ? C.green : C.whiteDim, fontWeight: '800' }}>{i + 1}</Text>
            }
          </View>
          <Text style={[s.progressLabel, i === current && s.progressLabelActive]}>{step.label}</Text>
          {i < STEPS.length - 1 && (
            <View style={[s.progressLine, i < current && s.progressLineActive]} />
          )}
        </View>
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
            debts: [], events: [], turnos: [], loans: [], credits: {},
            vocabulario: [], recurringIncomes: [],
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

        {/* Decorative blobs */}
        <View style={s.blob1} />
        <View style={s.blob2} />

        <View style={s.header}>
          <ProgressBar current={step} />
        </View>

        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ── PASO 1: Sueldo ── */}
          {step === 0 && (
            <View style={s.stepWrap}>
              <View style={s.iconWrap}>
                <Text style={{ fontSize: 48 }}>💼</Text>
              </View>
              <Text style={s.title}>¿Cuánto ganás{'\n'}por mes?</Text>
              <Text style={s.subtitle}>
                Con tu sueldo, Orbe sabe cuánto te queda disponible y proyecta tus ahorros mes a mes.
              </Text>

              <View style={s.amountCard}>
                <Text style={s.amountLabel}>INGRESO MENSUAL</Text>
                <View style={s.amountRow}>
                  <Text style={s.amountPrefix}>$</Text>
                  <TextInput
                    style={s.amountInput}
                    value={sueldo}
                    onChangeText={v => setSueldo(v.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.'))}
                    placeholder="0"
                    placeholderTextColor={C.whiteDim}
                    keyboardType="numeric"
                    returnKeyType="done"
                  />
                </View>
                <View style={s.amountDivider} />
                <Text style={s.amountHint}>
                  Podés cambiarlo cuando quieras desde la app
                </Text>
              </View>
            </View>
          )}

          {/* ── PASO 2: Categorías ── */}
          {step === 1 && (
            <View style={s.stepWrap}>
              <View style={s.iconWrap}>
                <Text style={{ fontSize: 48 }}>🗂</Text>
              </View>
              <Text style={s.title}>Organizá{'\n'}tus gastos</Text>
              <Text style={s.subtitle}>
                Cada movimiento va a una categoría. Así Orbe te muestra en qué gastás más y dónde podés mejorar.
              </Text>

              <View style={s.catGrid}>
                {DEFAULT_CATS.map(cat => (
                  <View key={cat.name} style={s.catCard}>
                    <Text style={s.catIcon}>{cat.icon}</Text>
                    <Text style={s.catLabel}>{cat.name}</Text>
                  </View>
                ))}
              </View>

              <View style={s.infoBox}>
                <Text style={s.infoIcon}>💡</Text>
                <Text style={s.infoText}>
                  Estas categorías ya vienen listas. Podés crear nuevas desde la sección de Análisis.
                </Text>
              </View>
            </View>
          )}

          {/* ── PASO 3: WhatsApp ── */}
          {step === 2 && (
            <View style={s.stepWrap}>
              <View style={s.waIconWrap}>
                <FontAwesome5 name="whatsapp" size={52} color="#25D366" solid />
              </View>
              <Text style={s.title}>Tu asistente{'\n'}donde ya estás</Text>
              <Text style={s.subtitle}>
                Usá Orbe sin abrir la app. Solo mandá un mensaje por WhatsApp.
              </Text>

              <View style={s.waSteps}>
                {[
                  { n: '1', icon: '📱', text: 'Andá a Perfil → Conectar WhatsApp.' },
                  { n: '2', icon: '🔐', text: 'Ingresá tu número y verificalo con el código.' },
                  { n: '3', icon: '💬', text: 'Abrí el chat con Orbe y empezá a escribir.' },
                ].map(item => (
                  <View key={item.n} style={s.waStepCard}>
                    <View style={s.waStepNum}>
                      <Text style={{ color: C.green, fontWeight: '800', fontSize: 12 }}>{item.n}</Text>
                    </View>
                    <Text style={{ fontSize: 22, marginHorizontal: 12 }}>{item.icon}</Text>
                    <Text style={s.waStepText}>{item.text}</Text>
                  </View>
                ))}
              </View>

              <View style={s.infoBox}>
                <Text style={s.infoIcon}>✨</Text>
                <Text style={s.infoText}>
                  Registrá gastos, consultá tu saldo, o pedí el precio del dólar — con un solo mensaje.
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
                  : <Text style={s.primaryText}>Siguiente →</Text>
                }
              </TouchableOpacity>
            </View>
          )}

          {step === 1 && (
            <View style={s.btnRow}>
              <TouchableOpacity onPress={back} style={s.skipBtn}>
                <Text style={s.skipText}>← Atrás</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={next} style={s.primaryBtn}>
                <Text style={s.primaryText}>Siguiente →</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 2 && (
            <View style={s.btnRow}>
              <TouchableOpacity onPress={back} style={s.skipBtn}>
                <Text style={s.skipText}>← Atrás</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={finish} style={s.primaryBtn}>
                <Text style={s.primaryText}>¡Arranquemos! 🚀</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.green, overflow: 'hidden' },
  header: { paddingTop: 56, paddingHorizontal: 24, paddingBottom: 8 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 20 },

  // Decorative blobs
  blob1: {
    position: 'absolute', top: -80, right: -80,
    width: 280, height: 280, borderRadius: 140,
    backgroundColor: '#FFFFFF07',
  },
  blob2: {
    position: 'absolute', bottom: 100, left: -100,
    width: 320, height: 320, borderRadius: 160,
    backgroundColor: '#C9A84C08',
  },

  // Progress bar
  progressWrap: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', paddingVertical: 8,
  },
  progressItem:       { alignItems: 'center', position: 'relative' },
  progressDot: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  progressDotActive:  { borderColor: C.gold, backgroundColor: '#C9A84C30' },
  progressDotCurrent: { backgroundColor: C.gold, borderColor: C.goldLight },
  progressLabel:      { fontSize: 10, color: C.whiteDim, fontWeight: '600', letterSpacing: 0.3 },
  progressLabelActive:{ color: C.gold },
  progressLine: {
    position: 'absolute', top: 16, left: 32,
    width: 56, height: 1.5,
    backgroundColor: C.border,
  },
  progressLineActive: { backgroundColor: C.gold },

  // Step content
  stepWrap: { paddingTop: 24, alignItems: 'center' },
  iconWrap: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  title: {
    fontSize: 30, fontWeight: '800', color: C.white,
    textAlign: 'center', letterSpacing: -0.8, marginBottom: 12, lineHeight: 36,
  },
  subtitle: {
    fontSize: 14, color: C.whiteMuted,
    textAlign: 'center', lineHeight: 22, marginBottom: 28, paddingHorizontal: 8,
  },

  // Sueldo
  amountCard: {
    width: '100%', backgroundColor: C.surface,
    borderRadius: 24, borderWidth: 1, borderColor: C.border,
    padding: 24,
  },
  amountLabel: {
    fontSize: 10, fontWeight: '800', color: C.gold,
    letterSpacing: 1.5, marginBottom: 12,
  },
  amountRow:   { flexDirection: 'row', alignItems: 'center' },
  amountPrefix:{ fontSize: 32, fontWeight: '700', color: C.gold, marginRight: 8 },
  amountInput: { flex: 1, fontSize: 40, fontWeight: '800', color: C.white, paddingVertical: 0 },
  amountDivider: { height: 1, backgroundColor: C.border, marginVertical: 16 },
  amountHint:  { fontSize: 12, color: C.whiteDim, textAlign: 'center' },

  // Categorías
  catGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    justifyContent: 'center', marginBottom: 20, width: '100%',
  },
  catCard: {
    width: '22%', aspectRatio: 1,
    backgroundColor: C.surface, borderRadius: 18,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  catIcon:  { fontSize: 22 },
  catLabel: { fontSize: 9, color: C.whiteMuted, fontWeight: '700', textAlign: 'center' },

  // Info box
  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: C.surface2, borderRadius: 16,
    borderWidth: 1, borderColor: C.border,
    padding: 16, width: '100%',
  },
  infoIcon: { fontSize: 16 },
  infoText: { flex: 1, fontSize: 13, color: C.whiteMuted, lineHeight: 20 },

  // WhatsApp
  waIconWrap: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: '#25D36615', borderWidth: 1.5, borderColor: '#25D36640',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  waSteps: { width: '100%', gap: 10, marginBottom: 20 },
  waStepCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 16,
    borderWidth: 1, borderColor: C.border,
    padding: 14,
  },
  waStepNum: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  waStepText: { flex: 1, color: C.white, fontSize: 13, lineHeight: 20 },

  // Buttons
  btnArea: { paddingHorizontal: 24, paddingBottom: 44, paddingTop: 12 },
  btnRow:  { flexDirection: 'row', gap: 12 },
  skipBtn: {
    flex: 1, paddingVertical: 16, alignItems: 'center',
    borderRadius: 18, borderWidth: 1, borderColor: C.border,
  },
  skipText: { color: C.whiteMuted, fontSize: 14, fontWeight: '600' },
  primaryBtn: {
    flex: 2, paddingVertical: 16, alignItems: 'center',
    borderRadius: 18, backgroundColor: C.gold,
    borderWidth: 1, borderColor: C.goldLight,
    shadowColor: C.gold, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 10,
  },
  primaryText: { color: C.green, fontSize: 15, fontWeight: '800' },
});
