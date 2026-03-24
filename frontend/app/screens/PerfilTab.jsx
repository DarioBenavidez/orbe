import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../constants/supabase';
import { useC } from '../../lib/theme';
import { Card, Btn, Input, ModalSheet } from '../../components/ui';

export default function PerfilTab({ user, onLogout, connectWhatsApp, waLinked, dark, setDark, data }) {
  const C = useC();
  const meta     = user?.user_metadata || {};
  const nombre   = meta.nombre || user?.email?.split('@')[0] || 'Usuario';
  const apellido = meta.apellido || '';
  const fullName = meta.full_name || `${nombre} ${apellido}`.trim();
  const initial  = fullName[0]?.toUpperCase() || 'U';

  const [editNameModal, setEditNameModal] = useState(false);
  const [editNombre,    setEditNombre]    = useState(nombre);
  const [editApellido,  setEditApellido]  = useState(apellido);
  const [savingName,    setSavingName]    = useState(false);

  const saveNombre = async () => {
    if (!editNombre.trim()) return;
    setSavingName(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { nombre: editNombre.trim(), apellido: editApellido.trim(), full_name: `${editNombre.trim()} ${editApellido.trim()}`.trim() },
      });
      if (error) throw error;
      setEditNameModal(false);
    } catch {
      Alert.alert('Error', 'No se pudo actualizar el nombre. Verificá tu conexión.');
    }
    setSavingName(false);
  };

  const [pwModal,   setPwModal]   = useState(false);
  const [pwNew,     setPwNew]     = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [savingPw,  setSavingPw]  = useState(false);

  const changePassword = async () => {
    if (pwNew.length < 8) return Alert.alert('Error', 'La contraseña debe tener al menos 8 caracteres');
    if (pwNew !== pwConfirm) return Alert.alert('Error', 'Las contraseñas no coinciden');
    setSavingPw(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwNew });
      if (error) throw error;
      Alert.alert('Listo', 'Contraseña actualizada correctamente');
      setPwModal(false); setPwNew(''); setPwConfirm('');
    } catch {
      Alert.alert('Error', 'No se pudo cambiar la contraseña. Verificá tu conexión.');
    }
    setSavingPw(false);
  };

  const [bioEnabled,   setBioEnabled]   = useState(false);
  const [bioHardware,  setBioHardware]  = useState(false);
  useEffect(() => {
    let LA;
    try { LA = require('expo-local-authentication'); } catch { return; }
    LA.hasHardwareAsync().then(has => {
      if (!has) return;
      setBioHardware(true);
      AsyncStorage.getItem('orbe_bio').then(v => setBioEnabled(v === '1')).catch(() => {});
    });
  }, []);
  const toggleBio = async (val) => {
    if (val) {
      let LA;
      try { LA = require('expo-local-authentication'); } catch {}
      const enrolled = LA ? await LA.isEnrolledAsync() : false;
      if (!enrolled) {
        Alert.alert('Biometría no configurada', 'Primero configurá Face ID o huella dactilar en los ajustes del dispositivo.');
        return;
      }
    }
    setBioEnabled(val);
    await AsyncStorage.setItem('orbe_bio', val ? '1' : '0');
  };

  return (
    <View style={{ flex:1, backgroundColor:C.header }}>
      <View style={{ paddingTop:60, paddingBottom:36, alignItems:'center' }}>
        <View style={{
          width:86, height:86, borderRadius:43, backgroundColor:'#ffffff18',
          alignItems:'center', justifyContent:'center',
          borderWidth:2, borderColor:'#ffffff30', marginBottom:16,
        }}>
          <Text style={{ fontSize:38, fontWeight:'800', color:'#fff' }}>{initial}</Text>
        </View>
        <Text style={{ fontSize:22, fontWeight:'800', color:'#fff', letterSpacing:-0.5 }}>{fullName}</Text>
        <Text style={{ fontSize:13, color:'#ffffff55', marginTop:4 }}>{user?.email}</Text>
      </View>

      <View style={{ flex:1, backgroundColor:C.bg, borderTopLeftRadius:32, borderTopRightRadius:32, overflow:'hidden', borderTopWidth:1, borderColor:C.gold }}>
        <ScrollView contentContainerStyle={{ padding:20 }} showsVerticalScrollIndicator={false}>
          <Card style={{ marginBottom:14 }}>
            <TouchableOpacity onPress={() => { setEditNombre(nombre); setEditApellido(apellido); setEditNameModal(true); }}
              style={{ flexDirection:'row', alignItems:'center', paddingVertical:14, borderBottomWidth:1, borderBottomColor:C.border }}>
              <View style={{ flex:1 }}>
                <Text style={{ fontSize:15, fontWeight:'600', color:C.text }}>Editar nombre</Text>
                <Text style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>{fullName}</Text>
              </View>
              <Text style={{ color:C.textMuted, fontSize:20 }}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPwModal(true)}
              style={{ flexDirection:'row', alignItems:'center', paddingVertical:14 }}>
              <View style={{ flex:1 }}>
                <Text style={{ fontSize:15, fontWeight:'600', color:C.text }}>Cambiar contraseña</Text>
                <Text style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Actualizá tu contraseña de acceso</Text>
              </View>
              <Text style={{ color:C.textMuted, fontSize:20 }}>›</Text>
            </TouchableOpacity>
          </Card>

          <Card style={{ marginBottom:14 }}>
            {bioHardware && (
              <View style={{ flexDirection:'row', alignItems:'center', paddingVertical:14, borderBottomWidth:1, borderBottomColor:C.border }}>
                <Text style={{ flex:1, fontSize:15, fontWeight:'600', color:C.text }}>Huella / Face ID</Text>
                <Switch value={bioEnabled} onValueChange={toggleBio}
                  trackColor={{ false:C.border, true:C.accent }} thumbColor="#fff"/>
              </View>
            )}
            <View style={{ flexDirection:'row', alignItems:'center', paddingVertical:14, borderBottomWidth:1, borderBottomColor:C.border }}>
              <Text style={{ flex:1, fontSize:15, fontWeight:'600', color:C.text }}>Modo oscuro</Text>
              <Switch value={dark} onValueChange={setDark}
                trackColor={{ false:C.border, true:C.accent }} thumbColor="#fff"/>
            </View>
            <TouchableOpacity onPress={connectWhatsApp}
              style={{ flexDirection:'row', alignItems:'center', paddingVertical:14 }}>
              <View style={{ flex:1 }}>
                <Text style={{ fontSize:15, fontWeight:'600', color:C.text }}>
                  {waLinked ? 'WhatsApp conectado ✓' : 'Conectar WhatsApp'}
                </Text>
                <Text style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>
                  {waLinked ? `Vinculado al ${waLinked}` : 'Registrá gastos y consultá tu balance por chat'}
                </Text>
              </View>
              <Text style={{ color:C.textMuted, fontSize:20 }}>›</Text>
            </TouchableOpacity>
          </Card>

          <Card>
            <TouchableOpacity onPress={onLogout}
              style={{ flexDirection:'row', alignItems:'center', paddingVertical:6 }}>
              <Text style={{ flex:1, fontSize:15, fontWeight:'600', color:C.red }}>Cerrar sesión</Text>
              <Text style={{ color:C.red, fontSize:20 }}>›</Text>
            </TouchableOpacity>
          </Card>

          <View style={{ height:40 }}/>
        </ScrollView>
      </View>

      <ModalSheet visible={editNameModal} onClose={() => setEditNameModal(false)} title="Editar nombre">
        <Input label="Nombre" value={editNombre} onChangeText={setEditNombre} placeholder="Tu nombre"/>
        <Input label="Apellido" value={editApellido} onChangeText={setEditApellido} placeholder="Tu apellido"/>
        <View style={{ flexDirection:'row', gap:10, marginTop:4 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={() => setEditNameModal(false)}/>
          <Btn label="Guardar" loading={savingName} style={{ flex:1 }} onPress={saveNombre}/>
        </View>
      </ModalSheet>

      <ModalSheet visible={pwModal} onClose={() => setPwModal(false)} title="Cambiar contraseña">
        <Input label="Nueva contraseña" value={pwNew} onChangeText={setPwNew} placeholder="Mínimo 8 caracteres" secureTextEntry/>
        <Input label="Repetir contraseña" value={pwConfirm} onChangeText={setPwConfirm} placeholder="Repetí la contraseña" secureTextEntry/>
        <View style={{ flexDirection:'row', gap:10, marginTop:4 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={() => setPwModal(false)}/>
          <Btn label="Guardar" loading={savingPw} style={{ flex:1 }} onPress={changePassword}/>
        </View>
      </ModalSheet>
    </View>
  );
}
