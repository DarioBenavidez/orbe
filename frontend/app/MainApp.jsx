import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Linking, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FontAwesome5 } from '@expo/vector-icons';
import { loadData, saveData, supabase, BACKEND_URL } from '../constants/supabase';

import { ThemeCtx, mkTheme } from '../lib/theme';
import { defaultData, MONTH_NAMES } from '../lib/constants';
import { ModalSheet, Chip, Btn, Input, SaveIndicator } from '../components/ui';
import AddTxModal  from '../components/AddTxModal';
import InicioTab   from './screens/InicioTab';
import AnalisisTab from './screens/AnalisisTab';
import PerfilTab   from './screens/PerfilTab';
import Ahorros     from './panels/Ahorros';
import Deudas      from './panels/Deudas';
import Prestamos   from './panels/Prestamos';
import Turnos      from './panels/Turnos';
import Calendario  from './panels/Calendario';
import Proyeccion  from './panels/Proyeccion';

const TABS = [
  { key:'inicio',        label:'Inicio',   icon:'🏠' },
  { key:'analisis',      label:'Análisis', icon:'📊' },
  { key:'__whatsapp__',  label:'WhatsApp', icon:'💬' },
  { key:'perfil',        label:'Perfil',   icon:'👤' },
  { key:'__add__',       label:'',         icon:'+' },
];

const PICKER_YEARS = [2026, 2027, 2028, 2029, 2030];
const WA_POLLING_TIMEOUT_MS = 2 * 60 * 1000;

const PANEL_LABELS = {
  ahorros: 'Ahorros', deudas: 'Deudas', prestamos: 'Préstamos',
  turnos: 'Turnos', calendario: 'Eventos', proyeccion: 'Proyección',
};

export default function MainApp({ user, onLogout }) {
  const [tab,      setTab]      = useState('inicio');
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [dark,     setDarkState] = useState(false);
  const [monthPicker, setMonthPicker] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [editTx,   setEditTx]   = useState(null);
  const [panel,    setPanel]    = useState(null);

  const C = mkTheme(dark);

  const setDark = useCallback(async (val) => {
    setDarkState(val);
    try { await AsyncStorage.setItem('orbe_dark', val ? '1' : '0'); } catch {}
  }, []);

  const meta     = user?.user_metadata || {};
  const nombre   = meta.nombre || user?.email?.split('@')[0] || 'Usuario';

  const [waLinked,  setWaLinked]  = useState(null);
  const [waModal,   setWaModal]   = useState(false);
  const [waStep,    setWaStep]    = useState('phone'); // 'phone' | 'otp' | 'fallback'
  const [waPhone,   setWaPhone]   = useState('');
  const [waOtp,     setWaOtp]     = useState('');
  const [waCode,    setWaCode]    = useState('');
  const [waLoading, setWaLoading] = useState(false);
  const [waError,   setWaError]   = useState('');
  const [waPolling, setWaPolling] = useState(null);

  const formatWaPhone = (raw) => {
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('549')) digits = digits.slice(3);
    else if (digits.startsWith('54')) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 11 && digits.startsWith('9')) digits = digits.slice(1);
    return '549' + digits;
  };

  const connectWhatsApp = () => {
    if (waLinked) {
      Linking.openURL('https://wa.me/5491125728211').catch(() => Alert.alert('Error', 'No se pudo abrir WhatsApp.'));
      return;
    }
    setWaStep('phone'); setWaPhone(''); setWaOtp(''); setWaCode(''); setWaError('');
    setWaModal(true);
  };

  const sendOtp = async () => {
    setWaError(''); setWaLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const phone = formatWaPhone(waPhone);
      if (phone.length < 11) { setWaError('Ingresá un número válido'); setWaLoading(false); return; }
      const resp = await fetch(`${BACKEND_URL}/api/send-phone-otp`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const body = await resp.json();
      if (body.needsFirstMessage) {
        // fallback: el usuario nunca le escribió al bot, usamos el flujo de código
        const resp2 = await fetch(`${BACKEND_URL}/api/generate-link-code`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
        });
        const body2 = await resp2.json();
        if (body2.code) { setWaCode(body2.code); setWaStep('fallback'); }
        else setWaError('Error generando el código. Intentá de nuevo.');
      } else if (resp.ok) {
        setWaStep('otp');
      } else {
        setWaError(body.error || 'No se pudo enviar el código.');
      }
    } catch { setWaError('Error de conexión. Intentá de nuevo.'); }
    setWaLoading(false);
  };

  const verifyOtp = async () => {
    setWaError(''); setWaLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const phone = formatWaPhone(waPhone);
      const resp = await fetch(`${BACKEND_URL}/api/verify-phone-otp`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp: waOtp.trim() }),
      });
      const body = await resp.json();
      if (resp.ok) {
        setWaLinked(phone); setWaModal(false);
        Alert.alert('¡WhatsApp conectado!', 'Ya podés usar Orbe desde WhatsApp.');
      } else {
        setWaError(body.error || 'Código incorrecto.');
      }
    } catch { setWaError('Error de conexión. Intentá de nuevo.'); }
    setWaLoading(false);
  };

  const checkLinked = async () => {
    const { data: waRows } = await supabase.from('whatsapp_users').select('phone, linked_at').eq('user_id', user.id).order('linked_at', { ascending: false });
    const wa = waRows?.[0];
    if (wa?.phone) {
      if (waPolling) { clearInterval(waPolling); setWaPolling(null); }
      setWaLinked(wa.phone); setWaModal(false);
      Alert.alert('¡WhatsApp conectado!', 'Ya podés usar Orbe desde WhatsApp.');
      return true;
    }
    return false;
  };

  const startPolling = () => {
    const id = setInterval(async () => { await checkLinked(); }, 3000);
    setWaPolling(id);
    setTimeout(() => {
      clearInterval(id);
      setWaPolling(null);
      Alert.alert('Tiempo agotado', 'No detectamos el mensaje. Asegurate de haber enviado el código y volvé a intentarlo.');
    }, WA_POLLING_TIMEOUT_MS);
  };

  const closeWaModal = () => {
    if (waPolling) { clearInterval(waPolling); setWaPolling(null); }
    setWaModal(false);
  };

  useEffect(() => {
    AsyncStorage.getItem('orbe_dark').then(v => { if (v === '1') setDarkState(true); }).catch(() => {});
    loadData(user.id)
      .then(d => { setData(d || defaultData()); setLoading(false); })
      .catch(() => { setData(defaultData()); setLoading(false); });
    supabase.from('whatsapp_users').select('phone, linked_at').eq('user_id', user.id).order('linked_at', { ascending: false })
      .then(({ data: waRows }) => setWaLinked(waRows?.[0]?.phone || false))
      .catch(() => setWaLinked(false));
  }, [user]);

  const save = useCallback(async (newData) => {
    setData(newData);
    setSaving(true);
    try {
      await saveData(user.id, newData);
    } catch {
      Alert.alert('Error al guardar', 'No se pudieron guardar los cambios. Verificá tu conexión.');
    } finally {
      setSaving(false);
    }
  }, [user]);

  if (loading) return (
    <View style={{ flex:1, alignItems:'center', justifyContent:'center', backgroundColor:C.bg }}>
      <ActivityIndicator size="large" color={C.accent}/>
    </View>
  );

  const handleTab = async (key) => {
    if (key === '__add__') { setAddModal(true); return; }
    if (key === '__whatsapp__') {
      if (waLinked) {
        Linking.openURL('https://wa.me/5491125728211').catch(() => {});
        return;
      }
      // Verificar en Supabase por si ya vinculó en otra sesión
      const { data: waRows } = await supabase.from('whatsapp_users').select('phone, linked_at').eq('user_id', user.id).order('linked_at', { ascending: false });
      const wa = waRows?.[0];
      if (wa?.phone) {
        setWaLinked(wa.phone);
        Linking.openURL('https://wa.me/5491125728211').catch(() => {});
      } else {
        setWaLinked(false);
        setWaStep('phone'); setWaPhone(''); setWaOtp(''); setWaCode(''); setWaError('');
        setWaModal(true);
      }
      return;
    }
    setTab(key);
  };

  return (
    <ThemeCtx.Provider value={C}>
      <View style={{ flex:1, backgroundColor:C.bg }}>
        <SaveIndicator saving={saving}/>
        {/* Tab content */}
        <View style={{ flex:1 }}>
          {tab==='inicio'   && <InicioTab data={data} onSave={save} onMonthPress={() => setMonthPicker(true)} nombre={nombre} onOpenPanel={setPanel} onEditTx={tx => { setEditTx(tx); setAddModal(true); }}/>}
          {tab==='analisis' && <AnalisisTab data={data} onSave={save}/>}
          {tab==='perfil'   && <PerfilTab user={user} onLogout={onLogout} connectWhatsApp={connectWhatsApp} waLinked={waLinked} dark={dark} setDark={setDark} data={data}/>}
        </View>

        {/* Panel modal (opened from module shortcuts) */}
        <Modal visible={!!panel} animationType="slide" onRequestClose={() => setPanel(null)}>
          <ThemeCtx.Provider value={C}>
            <View style={{ flex:1, backgroundColor: C.bg }}>
              <View style={{ backgroundColor: C.accent, paddingTop: 52, paddingBottom: 18, paddingHorizontal: 20, flexDirection:'row', alignItems:'center', gap:12, borderBottomWidth:1, borderBottomColor:C.gold+'60', overflow:'hidden' }}>
                {/* Decorative blobs */}
                <View style={{ position:'absolute', top:-40, right:-40, width:160, height:160, borderRadius:80, backgroundColor:'#FFFFFF07', pointerEvents:'none' }}/>
                <View style={{ position:'absolute', bottom:-60, left:-60, width:180, height:180, borderRadius:90, backgroundColor:'#C9A84C08', pointerEvents:'none' }}/>
                <TouchableOpacity onPress={() => setPanel(null)} style={{ width:36, height:36, borderRadius:18, backgroundColor:'#FFFFFF15', alignItems:'center', justifyContent:'center', borderWidth:1, borderColor:'#FFFFFF25' }}>
                  <Text style={{ color:'#fff', fontSize:18 }}>←</Text>
                </TouchableOpacity>
                <Text style={{ color:'#fff', fontSize:19, fontWeight:'800', letterSpacing:-0.3 }}>{PANEL_LABELS[panel]}</Text>
              </View>
              {panel==='ahorros'    && <Ahorros    data={data} onSave={save}/>}
              {panel==='deudas'     && <Deudas     data={data} onSave={save}/>}
              {panel==='prestamos'  && <Prestamos  data={data} onSave={save}/>}
              {panel==='turnos'     && <Turnos     data={data} onSave={save}/>}
              {panel==='calendario' && <Calendario data={data} onSave={save}/>}
              {panel==='proyeccion' && <Proyeccion data={data} onSave={save}/>}
            </View>
          </ThemeCtx.Provider>
        </Modal>

        {/* Bottom tab bar */}
        <View style={{
          flexDirection:'row', backgroundColor:C.tab,
          paddingBottom:28, paddingTop:10,
          borderTopWidth:1, borderTopColor:C.gold+'40',
          shadowColor: C.gold,
          shadowOffset:{width:0,height:-6},
          shadowOpacity:0.12, shadowRadius:20, elevation:14,
        }}>
          {TABS.map(t => {
            const isActive = tab === t.key;
            const isAdd    = t.key === '__add__';
            return (
              <TouchableOpacity key={t.key} onPress={() => handleTab(t.key)}
                style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
                {isAdd ? (
                  <View style={{
                    width:52, height:52, borderRadius:26, backgroundColor:C.accent,
                    alignItems:'center', justifyContent:'center',
                    marginTop:-20,
                    borderWidth:1, borderColor:C.gold,
                    shadowColor: C.gold, shadowOffset:{width:0,height:8},
                    shadowOpacity:0.4, shadowRadius:16, elevation:12,
                  }}>
                    <Text style={{ color:'#fff', fontSize:26, fontWeight:'300', lineHeight:30 }}>+</Text>
                  </View>
                ) : (
                  <>
                    <View style={{ alignItems:'center', justifyContent:'center', height:34 }}>
                      {t.key === '__whatsapp__'
                        ? <FontAwesome5 name="whatsapp" size={24} color={isActive ? '#25D366' : C.textMuted} solid/>
                        : <Text style={{ fontSize:22, opacity: isActive ? 1 : 0.35 }}>{t.icon}</Text>
                      }
                    </View>
                    <Text style={{ fontSize:10, fontWeight:'700', color: isActive ? C.accent : C.textMuted, marginTop:2, letterSpacing:0.2 }}>{t.label}</Text>
                    {isActive && <View style={{ width:20, height:3, borderRadius:2, backgroundColor:C.gold, marginTop:3, shadowColor:C.gold, shadowOffset:{width:0,height:2}, shadowOpacity:0.8, shadowRadius:6 }}/>}
                  </>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Add Transaction Modal */}
        <AddTxModal visible={addModal} onClose={() => { setAddModal(false); setEditTx(null); }} data={data} onSave={save} editTx={editTx}/>

        {/* Month Picker */}
        <ModalSheet visible={monthPicker} onClose={() => setMonthPicker(false)} title="Seleccionar mes">
          <ScrollView style={{ maxHeight:300 }} showsVerticalScrollIndicator={false}>
          {PICKER_YEARS.map(year => (
            <View key={year}>
              <Text style={{ color:C.textMuted, fontWeight:'700', marginBottom:8, marginTop:4 }}>{year}</Text>
              <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:12 }}>
                {MONTH_NAMES.map((m,i) => (
                  <Chip key={i} label={m} active={data.selectedMonth===i&&data.selectedYear===year}
                    onPress={() => { save({ ...data, selectedMonth:i, selectedYear:year }); setMonthPicker(false); }}/>
                ))}
              </View>
            </View>
          ))}
          </ScrollView>
          <Btn label="Cerrar" variant="ghost" onPress={() => setMonthPicker(false)} style={{ marginTop:8 }}/>
        </ModalSheet>

        {/* WhatsApp linking modal */}
        <ModalSheet visible={waModal} onClose={closeWaModal} title="Conectar WhatsApp">
          {waLoading ? (
            <ActivityIndicator color={C.accent} style={{ marginVertical: 32 }}/>
          ) : waStep === 'phone' ? (
            <>
              <Text style={{ fontSize:13, color:C.textMuted, marginBottom:20, lineHeight:20 }}>
                Ingresá tu número de WhatsApp y te mandamos un código para verificar tu cuenta.
              </Text>
              <Input
                label="Número de WhatsApp"
                value={waPhone}
                onChangeText={setWaPhone}
                placeholder="9 11 1234 5678"
                keyboardType="phone-pad"
                prefix="+54"
              />
              {waError ? <Text style={{ color:C.red, fontSize:12, marginBottom:12 }}>{waError}</Text> : null}
              <Btn label="Enviar código" onPress={sendOtp} style={{ marginBottom:10 }}/>
              <Btn label="Cancelar" variant="ghost" onPress={closeWaModal}/>
            </>
          ) : waStep === 'otp' ? (
            <>
              <Text style={{ fontSize:13, color:C.textMuted, marginBottom:20, lineHeight:20 }}>
                Te enviamos un código por WhatsApp al +{formatWaPhone(waPhone)}. Ingresálo acá.
              </Text>
              <Input
                label="Código de verificación"
                value={waOtp}
                onChangeText={v => setWaOtp(v.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                keyboardType="number-pad"
              />
              {waError ? <Text style={{ color:C.red, fontSize:12, marginBottom:12 }}>{waError}</Text> : null}
              <Btn label="Verificar" onPress={verifyOtp} style={{ marginBottom:10 }}/>
              <Btn label="Volver a ingresar número" variant="ghost" onPress={() => { setWaStep('phone'); setWaOtp(''); setWaError(''); }} style={{ marginBottom:10 }}/>
              <Btn label="Cancelar" variant="ghost" onPress={closeWaModal}/>
            </>
          ) : (
            <>
              <Text style={{ fontSize:13, color:C.textMuted, marginBottom:12, lineHeight:20 }}>
                Primero tenés que escribirle al bot de Orbe en WhatsApp. Después enviá este código para vincular tu cuenta.
              </Text>
              <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Tu código</Text>
              <View style={{ backgroundColor:C.surface2, borderRadius:14, borderWidth:1, borderColor:C.border, paddingHorizontal:20, paddingVertical:16, alignItems:'center', marginBottom:20 }}>
                <Text style={{ fontSize:28, fontWeight:'800', color:C.text, letterSpacing:6 }}>
                  ORBE: {waCode}
                </Text>
              </View>
              <TouchableOpacity
                style={{ flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, backgroundColor:'#25D366', borderRadius:16, paddingVertical:14, marginBottom:12 }}
                onPress={() => { Linking.openURL(`https://wa.me/5491125728211?text=ORBE:%20${waCode}`); if (!waPolling) startPolling(); }}
              >
                <FontAwesome5 name="whatsapp" size={18} color="#fff" solid/>
                <Text style={{ color:'#fff', fontWeight:'800', fontSize:15 }}>Abrir WhatsApp y enviar</Text>
              </TouchableOpacity>
              {waPolling && (
                <View style={{ gap:10, marginTop:8 }}>
                  <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8 }}>
                    <ActivityIndicator size="small" color={C.accent}/>
                    <Text style={{ fontSize:12, color:C.textMuted }}>Esperando confirmación...</Text>
                  </View>
                  <Btn label="Ya lo envié, verificar" onPress={checkLinked} style={{ marginTop:4 }}/>
                </View>
              )}
              <Btn label="Cancelar" variant="ghost" onPress={closeWaModal} style={{ marginTop:12 }}/>
            </>
          )}
        </ModalSheet>
      </View>
    </ThemeCtx.Provider>
  );
}
