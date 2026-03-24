import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useC } from '../../lib/theme';
import { Card, Btn, Input, FAB, ModalSheet, Chip, IconCircle, EmptyState } from '../../components/ui';

export default function Turnos({ data, onSave }) {
  const C = useC();
  const turnos = (data.turnos || []).sort((a, b) => a.date.localeCompare(b.date));
  const today  = new Date().toISOString().split('T')[0];

  const [modal, setModal] = useState(false);
  const emptyF = { description:'', date:'', time:'', location:'', turnoType:'médico' };
  const [form, setForm]   = useState(emptyF);
  const [errors, setErrors] = useState({});
  const TIPOS = ['médico', 'peluquería', 'banco', 'trámite', 'reunión', 'otro'];

  const addTurno = () => {
    const errs = {};
    if (!form.description) errs.description = 'Ingresá una descripción';
    if (!form.date) errs.date = 'Ingresá la fecha del turno';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) errs.date = 'Formato: YYYY-MM-DD (ej: 2026-04-15)';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    const turno = { ...form, id: Date.now().toString(), notified: false };
    onSave({ ...data, turnos: [...(data.turnos || []), turno] });
    setModal(false); setForm(emptyF);
  };

  const delTurno = (id) => Alert.alert('Cancelar turno', '¿Cancelar este turno?', [
    { text: 'No' },
    { text: 'Cancelar turno', style: 'destructive', onPress: () =>
        onSave({ ...data, turnos: (data.turnos || []).filter(t => t.id !== id) })
    },
  ]);

  const proximos = turnos.filter(t => t.date >= today);
  const pasados  = turnos.filter(t => t.date < today);

  const TurnoCard = ({ t }) => {
    const diasRestantes = Math.ceil((new Date(t.date) - new Date(today)) / (1000 * 60 * 60 * 24));
    const esHoy    = t.date === today;
    const esPasado = t.date < today;
    const color    = esHoy ? C.accent : esPasado ? C.textMuted : diasRestantes <= 2 ? C.red : C.text;
    return (
      <Card style={{ marginBottom:10, opacity: esPasado ? 0.6 : 1 }}>
        <View style={{ flexDirection:'row', alignItems:'flex-start' }}>
          <IconCircle icon={t.turnoType==='médico'?'🏥':t.turnoType==='banco'?'🏦':t.turnoType==='peluquería'?'💈':'📋'} bg={C.accent+'18'} size={44}/>
          <View style={{ flex:1, marginLeft:12 }}>
            <Text style={{ fontSize:14, fontWeight:'700', color:C.text }}>{t.description}</Text>
            <Text style={{ fontSize:12, color, fontWeight:'600', marginTop:2 }}>
              {esHoy ? '🔔 Hoy' : esPasado ? 'Pasado' : diasRestantes === 1 ? '⚠️ Mañana' : `${t.date}`}
              {t.time ? ` · ${t.time}hs` : ''}
            </Text>
            {t.location ? <Text style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>📍 {t.location}</Text> : null}
          </View>
          <TouchableOpacity onPress={() => delTurno(t.id)}>
            <Text style={{ color:C.red, fontSize:12 }}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </Card>
    );
  };

  return (
    <View style={{ flex:1 }}>
      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:100 }} showsVerticalScrollIndicator={false}>
        {proximos.length === 0 && pasados.length === 0 && (
          <EmptyState icon="📅" title="Sin turnos agendados" subtitle="Agendá recordatorios de médicos, trámites y más" actionLabel="+ Agendar turno" onAction={() => setModal(true)}/>
        )}
        {proximos.length > 0 && (
          <>
            <Text style={{ fontSize:11, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>Próximos</Text>
            {proximos.map(t => <TurnoCard key={t.id} t={t}/>)}
          </>
        )}
        {pasados.length > 0 && (
          <>
            <Text style={{ fontSize:11, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:1, marginTop:16, marginBottom:10 }}>Historial</Text>
            {pasados.slice().reverse().slice(0, 5).map(t => <TurnoCard key={t.id} t={t}/>)}
          </>
        )}
      </ScrollView>
      <FAB onPress={() => setModal(true)}/>
      <ModalSheet visible={modal} onClose={() => { setModal(false); setForm(emptyF); setErrors({}); }} title="Nuevo turno">
        <Input label="Descripción" value={form.description} onChangeText={v => { setForm(f => ({ ...f, description:v })); if (errors.description) setErrors(e => ({ ...e, description:null })); }} placeholder="Ej: Médico clínico, Banco Galicia" error={errors.description}/>
        <Input label="Fecha (YYYY-MM-DD)" value={form.date} onChangeText={v => { setForm(f => ({ ...f, date:v })); if (errors.date) setErrors(e => ({ ...e, date:null })); }} placeholder={today} keyboardType="numeric" error={errors.date}/>
        <Input label="Hora (opcional)" value={form.time} onChangeText={v => setForm(f => ({ ...f, time:v }))} placeholder="14:30" keyboardType="numeric"/>
        <Input label="Lugar (opcional)" value={form.location} onChangeText={v => setForm(f => ({ ...f, location:v }))} placeholder="Ej: Av. Corrientes 1234"/>
        <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:1, marginBottom:8 }}>Tipo</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:16 }}>
          {TIPOS.map(t => (
            <Chip key={t} label={t} active={form.turnoType===t} onPress={() => setForm(f => ({ ...f, turnoType:t }))} style={{ marginRight:8 }}/>
          ))}
        </ScrollView>
        <View style={{ flexDirection:'row', gap:10 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={() => setModal(false)}/>
          <Btn label="Guardar" style={{ flex:1 }} onPress={addTurno}/>
        </View>
      </ModalSheet>
    </View>
  );
}
