import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useC } from '../../lib/theme';
import { EVENT_TYPES, MONTH_FULL, cMonth, cYear, fmt, fmtAmt, parseAmt } from '../../lib/constants';
import { Card, Btn, Input, FAB, ModalSheet, Chip } from '../../components/ui';

export default function Calendario({ data, onSave }) {
  const C = useC();
  const [modal, setModal]           = useState(false);
  const [editModal, setEditModal]   = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [payModal, setPayModal]     = useState(false);
  const [payTarget, setPayTarget]   = useState(null);
  const [payAmt, setPayAmt]         = useState('');
  const emptyF = { title:'', day:'', type:'vencimiento', notifyDaysBefore:'2' };
  const [form, setForm]             = useState(emptyF);
  const [editForm, setEditForm]     = useState(emptyF);
  const events = data.events || [];
  const today  = new Date().getDate();

  const addEvent = () => {
    if (!form.title||!form.day) return;
    const dayNum = parseInt(form.day);
    const maxDay = new Date(data.selectedYear, data.selectedMonth + 1, 0).getDate();
    if (isNaN(dayNum) || dayNum < 1 || dayNum > maxDay) return Alert.alert('Día inválido', `Ingresá un día entre 1 y ${maxDay} para este mes.`);
    const ev = { ...form, id:Date.now().toString(), day:dayNum, notifyDaysBefore:parseInt(form.notifyDaysBefore)||2 };
    onSave({ ...data, events:[...events, ev] });
    setModal(false); setForm(emptyF);
  };
  const openEdit = (ev) => {
    setEditTarget(ev.id);
    setEditForm({ title:ev.title, day:ev.day.toString(), type:ev.type, notifyDaysBefore:(ev.notifyDaysBefore||2).toString() });
    setEditModal(true);
  };
  const saveEdit = () => {
    const dayNum = parseInt(editForm.day);
    const maxDay = new Date(data.selectedYear, data.selectedMonth + 1, 0).getDate();
    if (isNaN(dayNum) || dayNum < 1 || dayNum > maxDay) return Alert.alert('Día inválido', `Ingresá un día entre 1 y ${maxDay} para este mes.`);
    const ev = { ...editForm, id:editTarget, day:dayNum, notifyDaysBefore:parseInt(editForm.notifyDaysBefore)||2 };
    onSave({ ...data, events:events.map(e => e.id===editTarget?ev:e) });
    setEditModal(false);
  };
  const delEvent = (id) => Alert.alert('Eliminar','¿Eliminar este evento?',[
    { text:'Cancelar' },
    { text:'Eliminar', style:'destructive', onPress: () => onSave({ ...data, events:events.filter(e => e.id!==id) }) },
  ]);

  const openPagar = (ev) => { setPayTarget(ev); setPayAmt(''); setPayModal(true); };
  const confirmPago = () => {
    const amt = parseAmt(payAmt);
    if (!amt || amt <= 0) return Alert.alert('Error', 'Ingresá un monto válido');
    const tx = {
      id: Date.now().toString(),
      type: 'gasto',
      description: payTarget.title,
      amount: amt,
      category: payTarget.type === 'pago' ? 'Servicios' : 'Otros',
      date: new Date().toISOString().split('T')[0],
    };
    onSave({
      ...data,
      transactions: [...data.transactions, tx],
      events: events.filter(e => e.id !== payTarget.id),
    });
    setPayModal(false);
    Alert.alert('✅ Pago registrado', `${fmt(amt)} registrado como gasto.`);
  };
  const byType = EVENT_TYPES.reduce((acc,t) => { acc[t.key]=events.filter(e=>e.type===t.key).sort((a,b)=>a.day-b.day); return acc; }, {});

  const EventForm = ({ frm, setFrm }) => (
    <>
      <Input label="Título" value={frm.title} onChangeText={v => setFrm(f => ({ ...f, title:v }))} placeholder="Ej: Vencimiento luz"/>
      <Input label="Día del mes" value={frm.day} onChangeText={v => setFrm(f => ({ ...f, day:v }))} placeholder="1-31" keyboardType="numeric"/>
      <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Tipo</Text>
      <View style={{ flexDirection:'row', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        {EVENT_TYPES.map(t => (
          <Chip key={t.key} label={t.label} active={frm.type===t.key} onPress={() => setFrm(f => ({ ...f, type:t.key }))}/>
        ))}
      </View>
      <Input label="Notificar por WhatsApp (días antes)" value={frm.notifyDaysBefore} onChangeText={v => setFrm(f => ({ ...f, notifyDaysBefore:v }))} placeholder="2" keyboardType="numeric"/>
    </>
  );

  return (
    <View style={{ flex:1 }}>
      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:100 }} showsVerticalScrollIndicator={false}>
        <Card style={{ marginBottom:14 }}>
          <Text style={{ fontSize:15, fontWeight:'700', color:C.text, marginBottom:14 }}>
            📆 {MONTH_FULL[data.selectedMonth]} {data.selectedYear}
          </Text>
          <View style={{ flexDirection:'row', flexWrap:'wrap', gap:6 }}>
            {Array.from({length: new Date(data.selectedYear, data.selectedMonth+1, 0).getDate()},(_,i)=>i+1).map(day => {
              const dayEvents = events.filter(e => e.day===day);
              const isToday   = day===today && data.selectedMonth===cMonth && data.selectedYear===cYear;
              const hasEvent  = dayEvents.length>0;
              const typeColor = hasEvent ? EVENT_TYPES.find(t=>t.key===dayEvents[0].type)?.color : null;
              return (
                <View key={day} style={{
                  width:36, height:36, borderRadius:10, alignItems:'center', justifyContent:'center',
                  backgroundColor: isToday ? C.accent : hasEvent ? typeColor+'22' : C.surface2,
                  borderWidth: hasEvent||isToday ? 1.5 : 1,
                  borderColor: isToday ? C.gold : hasEvent ? typeColor : C.border,
                }}>
                  <Text style={{ fontSize:11, fontWeight:isToday||hasEvent?'700':'400', color:isToday?'#fff':hasEvent?typeColor:C.textMuted }}>{day}</Text>
                </View>
              );
            })}
          </View>
          <View style={{ flexDirection:'row', gap:14, marginTop:12, flexWrap:'wrap' }}>
            {EVENT_TYPES.map(t => (
              <View key={t.key} style={{ flexDirection:'row', alignItems:'center', gap:4 }}>
                <View style={{ width:10, height:10, borderRadius:5, backgroundColor:t.color }}/>
                <Text style={{ fontSize:10, color:C.textMuted }}>{t.label.split(' ')[0]}</Text>
              </View>
            ))}
          </View>
        </Card>
        {EVENT_TYPES.map(t => (
          byType[t.key].length>0 && (
            <Card key={t.key} style={{ marginBottom:14 }}>
              <Text style={{ fontSize:14, fontWeight:'700', color:t.color, marginBottom:12 }}>{t.label}</Text>
              {byType[t.key].map(ev => {
                const daysLeft = ev.day - today;
                return (
                  <View key={ev.id} style={{ flexDirection:'row', alignItems:'center', paddingVertical:10, borderBottomWidth:1, borderBottomColor:C.border }}>
                    <View style={{ flex:1 }}>
                      <Text style={{ fontSize:14, color:C.text, fontWeight:'500' }}>{ev.title}</Text>
                      <Text style={{ fontSize:11, color:C.textMuted }}>
                        Día {ev.day}
                        {data.selectedMonth===cMonth && daysLeft>=0 && daysLeft<=7 && (
                          <Text style={{ color:C.red, fontWeight:'600' }}> · ⚠️ en {daysLeft===0?'hoy':`${daysLeft} días`}</Text>
                        )}
                      </Text>
                    </View>
                    <View style={{ flexDirection:'row', gap:12, alignItems:'center' }}>
                      {(t.key === 'vencimiento' || t.key === 'pago') && (
                        <TouchableOpacity onPress={() => openPagar(ev)}
                          style={{ backgroundColor:C.accent, borderRadius:8, paddingHorizontal:10, paddingVertical:5, borderWidth:1, borderColor:C.gold }}>
                          <Text style={{ color:'#fff', fontSize:11, fontWeight:'700' }}>💸 Pagar</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity onPress={() => openEdit(ev)}><Text style={{ color:C.accent, fontSize:12, fontWeight:'600' }}>Editar</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => delEvent(ev.id)}><Text style={{ color:C.red, fontSize:12 }}>Eliminar</Text></TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </Card>
          )
        ))}
        {events.length===0 && (
          <View style={{ padding:40, alignItems:'center' }}>
            <Text style={{ fontSize:48, marginBottom:12 }}>📅</Text>
            <Text style={{ color:C.textMuted, fontSize:14, textAlign:'center' }}>Sin eventos. Agregá vencimientos o recordatorios.</Text>
          </View>
        )}
      </ScrollView>
      <FAB onPress={() => setModal(true)}/>
      <ModalSheet visible={modal} onClose={() => setModal(false)} title="Nuevo evento">
        <EventForm frm={form} setFrm={setForm}/>
        <View style={{ flexDirection:'row', gap:10 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={() => setModal(false)}/>
          <Btn label="Guardar" style={{ flex:1 }} onPress={addEvent}/>
        </View>
      </ModalSheet>
      <ModalSheet visible={editModal} onClose={() => setEditModal(false)} title="Editar evento">
        <EventForm frm={editForm} setFrm={setEditForm}/>
        <View style={{ flexDirection:'row', gap:10 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={() => setEditModal(false)}/>
          <Btn label="Guardar" style={{ flex:1 }} onPress={saveEdit}/>
        </View>
      </ModalSheet>

      <ModalSheet visible={payModal} onClose={() => setPayModal(false)} title={`💸 Pagar: ${payTarget?.title || ''}`}>
        <Input label="Monto pagado" value={payAmt} onChangeText={setPayAmt} placeholder="0" keyboardType="numeric" prefix="$"/>
        <View style={{ flexDirection:'row', gap:10 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={() => setPayModal(false)}/>
          <Btn label="Confirmar pago" style={{ flex:1 }} onPress={confirmPago}/>
        </View>
      </ModalSheet>
    </View>
  );
}
