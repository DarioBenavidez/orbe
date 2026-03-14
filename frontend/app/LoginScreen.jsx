import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator, Image,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../constants/supabase';

WebBrowser.maybeCompleteAuthSession();

// ── Brand colors ───────────────────────────────────────────────
const C = {
  green:      '#005247',
  greenDark:  '#003D36',
  greenLight: '#006B5E',
  gold:       '#C9A84C',
  goldLight:  '#E8C97A',
  bg:         '#FAFAF8',
  surface:    '#FFFFFF',
  border:     '#E8E4DC',
  text:       '#1A1A1A',
  textMuted:  '#7A7A7A',
  red:        '#E53935',
  cream:      '#F5F2EC',
};

// ── Password validator ─────────────────────────────────────────
function validatePassword(pw) {
  const rules = [
    { ok: pw.length >= 8,           label: '8 caracteres mínimo' },
    { ok: /[A-Z]/.test(pw),         label: 'Una mayúscula' },
    { ok: /[a-z]/.test(pw),         label: 'Una minúscula' },
    { ok: /[0-9]/.test(pw),         label: 'Un número' },
    { ok: /[^A-Za-z0-9]/.test(pw),  label: 'Un carácter especial (!@#$...)' },
  ];
  return rules;
}

// ── Field con ícono ────────────────────────────────────────────
function Field({ icon, placeholder, value, onChangeText, keyboardType, secureTextEntry, autoCapitalize, showToggle, onToggle }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldIcon}>{icon}</Text>
      <TextInput
        style={styles.fieldInput}
        placeholder={placeholder}
        placeholderTextColor={C.textMuted}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType || 'default'}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize || 'none'}
        autoCorrect={false}
      />
      {showToggle && (
        <TouchableOpacity onPress={onToggle} style={{ paddingHorizontal: 12 }}>
          <Text style={{ fontSize: 16 }}>{secureTextEntry ? '👁' : '🙈'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── OAuth button ───────────────────────────────────────────────
function OAuthBtn({ icon, label, color, onPress }) {
  return (
    <TouchableOpacity style={[styles.oauthBtn, { backgroundColor: color }]} onPress={onPress}>
      <Text style={styles.oauthIcon}>{icon}</Text>
      <Text style={styles.oauthLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Main ───────────────────────────────────────────────────────
export default function LoginScreen({ onLogin }) {
  const [mode, setMode]           = useState('login'); // login | register | reset
  const [nombre, setNombre]       = useState('');
  const [apellido, setApellido]   = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [showCf, setShowCf]       = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [loading, setLoading]     = useState(false);
  const [pwFocused, setPwFocused] = useState(false);

  const pwRules    = validatePassword(password);
  const pwValid    = pwRules.every(r => r.ok);
  const confirmOk  = confirm === password && confirm.length > 0;

  const clear = () => { setError(''); setSuccess(''); };

  const handleSubmit = async () => {
    clear(); setLoading(true);
    try {
      if (mode === 'register') {
        if (!nombre.trim() || !apellido.trim()) throw new Error('Ingresá tu nombre y apellido');
        if (!pwValid) throw new Error('La contraseña no cumple los requisitos');
        if (!confirmOk) throw new Error('Las contraseñas no coinciden');
        const fullName = `${nombre.trim()} ${apellido.trim()}`;
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { nombre: nombre.trim(), apellido: apellido.trim(), full_name: fullName } },
        });
        if (error) throw error;
        setSuccess('¡Cuenta creada! Revisá tu email para confirmarla.');
        setMode('login');
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setSuccess('Revisá tu email para restablecer la contraseña.');
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

  const handleOAuth = async (provider) => {
    try {
      const redirectTo = 'orbe://auth/callback';
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      });
      if (error) throw error;
      if (data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type === 'success') {
          const { data: sessionData } = await supabase.auth.getSession();
          if (sessionData?.session?.user) onLogin(sessionData.session.user);
        }
      }
    } catch {
      setError('No se pudo iniciar sesión con ese proveedor.');
    }
  };

  const isLogin    = mode === 'login';
  const isRegister = mode === 'register';
  const isReset    = mode === 'reset';

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* ── Header verde con logo ── */}
        <View style={styles.header}>
          <Image
            source={require('../assets/images/orbe-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        {/* ── Card blanca ── */}
        <View style={styles.card}>

          {(isRegister || isReset) && (
            <Text style={styles.greeting}>
              {isRegister ? '¡Creá tu cuenta!' : 'Recuperar contraseña'}
            </Text>
          )}

          {/* Nombre + Apellido */}
          {isRegister && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field icon="👤" placeholder="Nombre" value={nombre} onChangeText={setNombre} autoCapitalize="words"/>
              </View>
              <View style={{ flex: 1 }}>
                <Field icon="👤" placeholder="Apellido" value={apellido} onChangeText={setApellido} autoCapitalize="words"/>
              </View>
            </View>
          )}

          {/* Email */}
          <Field icon="✉️" placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email-address"/>

          {/* Password */}
          {!isReset && (
            <View>
              <Field
                icon="🔒"
                placeholder="Contraseña"
                value={password}
                onChangeText={v => { setPassword(v); if (!pwFocused) setPwFocused(true); }}
                secureTextEntry={!showPw}
                showToggle
                onToggle={() => setShowPw(p => !p)}
              />
              {/* Reglas de contraseña (solo en registro) */}
              {isRegister && password.length > 0 && (
                <View style={styles.pwRules}>
                  {pwRules.map((r, i) => (
                    <View key={i} style={styles.pwRule}>
                      <Text style={{ fontSize: 11, color: r.ok ? C.gold : C.textMuted }}>
                        {r.ok ? '✓' : '○'} {r.label}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Confirmar contraseña */}
          {isRegister && (
            <View>
              <Field
                icon="🔒"
                placeholder="Repetir contraseña"
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry={!showCf}
                showToggle
                onToggle={() => setShowCf(p => !p)}
              />
              {confirm.length > 0 && (
                <Text style={{ fontSize: 11, color: confirmOk ? C.gold : C.red, marginTop: -8, marginBottom: 10, marginLeft: 4 }}>
                  {confirmOk ? '✓ Las contraseñas coinciden' : '✗ No coinciden'}
                </Text>
              )}
            </View>
          )}

          {/* Error / Success */}
          {error   ? <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>   : null}
          {success ? <View style={styles.successBox}><Text style={styles.successText}>✅ {success}</Text></View> : null}

          {/* Botón principal */}
          <TouchableOpacity
            style={[styles.mainBtn, loading && { opacity: 0.7 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff"/>
              : <Text style={styles.mainBtnText}>
                  {isLogin ? 'Iniciar sesión' : isRegister ? 'Crear cuenta' : 'Enviar email'}
                </Text>
            }
          </TouchableOpacity>

          {/* OAuth (solo login/register) */}
          {!isReset && (
            <>
              <View style={styles.divider}>
                <View style={styles.dividerLine}/>
                <Text style={styles.dividerText}>o continuá con</Text>
                <View style={styles.dividerLine}/>
              </View>
              <OAuthBtn icon="G" label="Continuar con Google" color={C.red} onPress={() => handleOAuth('google')}/>
            </>
          )}

          {/* Links de modo */}
          <View style={styles.links}>
            {!isLogin && (
              <TouchableOpacity onPress={() => { setMode('login'); clear(); }}>
                <Text style={styles.link}>¿Ya tenés cuenta? <Text style={styles.linkBold}>Iniciá sesión</Text></Text>
              </TouchableOpacity>
            )}
            {!isRegister && (
              <TouchableOpacity onPress={() => { setMode('register'); clear(); }}>
                <Text style={styles.link}>¿No tenés cuenta? <Text style={styles.linkBold}>Registrate</Text></Text>
              </TouchableOpacity>
            )}
            {!isReset && (
              <TouchableOpacity onPress={() => { setMode('reset'); clear(); }}>
                <Text style={[styles.link, { marginTop: 4 }]}>¿Olvidaste tu contraseña?</Text>
              </TouchableOpacity>
            )}
          </View>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: C.green },
  scroll:  { flexGrow: 1 },

  // Header
  header: {
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 70,
    paddingBottom: 36,
    paddingHorizontal: 24,
  },
  logo: {
    width: 640,
    height: 280,
    marginBottom: 12,
  },
  tagline: {
    color: '#FFFFFF80',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.3,
  },

  // Card
  card: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    padding: 28,
    paddingBottom: 48,
    flex: 1,
  },
  greeting: {
    fontSize: 22,
    fontWeight: '800',
    color: C.text,
    letterSpacing: -0.5,
    marginBottom: 24,
  },

  // Fields
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    marginBottom: 12,
    paddingLeft: 14,
  },
  fieldIcon:  { fontSize: 16, marginRight: 8 },
  fieldInput: {
    flex: 1,
    paddingVertical: 15,
    fontSize: 15,
    color: C.text,
  },

  // Password rules
  pwRules: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    gap: 6,
    marginTop: -4,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  pwRule: {},

  // Main button
  mainBtn: {
    backgroundColor: C.green,
    borderRadius: 18,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: C.green,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  mainBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },

  // Divider
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
    gap: 10,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { fontSize: 12, color: C.textMuted, fontWeight: '500' },

  // OAuth
  oauthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 20,
    alignSelf: 'center',
    minWidth: 200,
  },
  oauthIcon:  { fontSize: 14, fontWeight: '800', color: '#fff' },
  oauthLabel: { fontSize: 13, fontWeight: '700', color: '#fff' },

  // Error / Success
  errorBox: {
    backgroundColor: '#FFF3F3',
    borderWidth: 1,
    borderColor: '#F5C5C5',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  errorText: { fontSize: 13, color: C.red },
  successBox: {
    backgroundColor: '#F0FBF7',
    borderWidth: 1,
    borderColor: '#A8DFC9',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  successText: { fontSize: 13, color: C.green },

  // Links
  links:    { marginTop: 20, alignItems: 'center', gap: 6 },
  link:     { fontSize: 13, color: C.textMuted },
  linkBold: { color: C.green, fontWeight: '700' },
});
