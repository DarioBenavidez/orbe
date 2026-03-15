import { useState, useRef } from 'react';
import {
  View, Text, Image, TouchableOpacity,
  ScrollView, Dimensions, StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');

const C = {
  green:     '#005247',
  greenDark: '#003D36',
  gold:      '#C9A84C',
  goldLight: '#E8C97A',
  white:     '#FFFFFF',
  whiteMuted:'#FFFFFF99',
};

const SLIDES = [
  {
    icon:    '📊',
    title:   'Controlá tus finanzas',
    body:    'Registrá gastos e ingresos en segundos. Mirá tu balance del mes y saber exactamente a dónde va tu plata.',
    accent:  '#C9A84C',
  },
  {
    icon:    '🐷',
    title:   'Ahorrá con metas',
    body:    'Creá metas de ahorro y seguí tu progreso. Orbe te muestra cuánto te falta y proyecta tus próximos 12 meses.',
    accent:  '#E8C97A',
  },
  {
    icon:    '💳',
    title:   'Manejá tus deudas',
    body:    'Registrá cuotas y préstamos. Orbe te avisa cuándo vencen y los descuenta automáticamente de tu proyección.',
    accent:  '#C9A84C',
  },
  {
    icon:    '💬',
    title:   'Hablá con Orbe por WhatsApp',
    body:    'Registrá un gasto, consultá tu balance o pedí el precio del dólar sin abrir la app. Solo escribile a Orbe.',
    accent:  '#E8C97A',
  },
];

export default function OnboardingScreen({ onDone }) {
  const [current, setCurrent] = useState(0);
  const scrollRef = useRef(null);

  const goTo = (index) => {
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
    setCurrent(index);
  };

  const handleScroll = (e) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    setCurrent(index);
  };

  const finish = async () => {
    await AsyncStorage.setItem('orbe_onboarded', '1');
    onDone();
  };

  const isLast = current === SLIDES.length - 1;

  return (
    <View style={s.root}>

      {/* Logo */}
      <View style={s.logoWrap}>
        <Image
          source={require('../assets/images/orbe-logo.png')}
          style={s.logo}
          resizeMode="contain"
        />
      </View>

      {/* Slides */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide, i) => (
          <View key={i} style={s.slide}>
            <View style={[s.iconCircle, { borderColor: slide.accent }]}>
              <Text style={s.iconText}>{slide.icon}</Text>
            </View>
            <Text style={s.title}>{slide.title}</Text>
            <Text style={s.body}>{slide.body}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Dots */}
      <View style={s.dots}>
        {SLIDES.map((_, i) => (
          <TouchableOpacity key={i} onPress={() => goTo(i)}>
            <View style={[s.dot, current === i && s.dotActive]} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Buttons */}
      <View style={s.btnRow}>
        {!isLast && (
          <TouchableOpacity onPress={finish} style={s.skipBtn}>
            <Text style={s.skipText}>Saltar</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={isLast ? finish : () => goTo(current + 1)}
          style={[s.nextBtn, isLast && s.nextBtnFull]}
        >
          <Text style={s.nextText}>{isLast ? 'Comenzar' : 'Siguiente'}</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.green,
    paddingBottom: 48,
  },
  logoWrap: {
    alignItems: 'center',
    paddingTop: 64,
    paddingBottom: 8,
  },
  logo: {
    width: 200,
    height: 80,
  },

  // Slides
  slide: {
    width,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    paddingVertical: 24,
  },
  iconCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1.5,
    backgroundColor: '#FFFFFF10',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  iconText:  { fontSize: 48 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: C.white,
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: 16,
  },
  body: {
    fontSize: 15,
    color: C.whiteMuted,
    textAlign: 'center',
    lineHeight: 23,
  },

  // Dots
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 28,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#FFFFFF30',
  },
  dotActive: {
    backgroundColor: C.gold,
    width: 22,
  },

  // Buttons
  btnRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 12,
  },
  skipBtn: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#FFFFFF30',
  },
  skipText: { color: C.whiteMuted, fontSize: 15, fontWeight: '600' },
  nextBtn: {
    flex: 2,
    paddingVertical: 16,
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: C.gold,
    borderWidth: 1,
    borderColor: C.goldLight,
  },
  nextBtnFull: { flex: 1 },
  nextText: { color: C.green, fontSize: 15, fontWeight: '800' },
});
