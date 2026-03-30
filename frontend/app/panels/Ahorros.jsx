import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useC } from '../../lib/theme';
import { fmt, parseAmt } from '../../lib/constants';

const fmtUSD = (n) => {
  const num = Number(n) || 0;
  return num % 1 === 0 ? `USD ${num}` : `USD ${num.toFixed(2)}`;
};
import { BACKEND_URL } from '../../constants/supabase';
import { Card, Btn, Input, FAB, ModalSheet, IconCircle } from '../../components/ui';

export default function Ahorros({ data, onSave }) {
  const C = useC();
  const [modal, setModal]         = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const emptyF = { name:'', target:'', current:'', currency:'ars' };
  const [form, setForm]         = useState(emptyF);
  const [editForm, setEditForm] = useState(emptyF);
  const [dolarBlue, setDolarBlue] = useState(null);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/dolar`)
      .then(r => r.json())
      .then(d => { if (d.blue) setDolarBlue(d.blue); })
      .catch(() => {});
  }, []);

  const addAhorro = () => {
    if (!form.name||!form.target) return;
    const isUSD = form.currency === 'usd';
    onSave({ ...data, savings:[...data.savings, {
      id: Date.now().toString(),
      name: form.name,
      target: parseAmt(form.target),
      current: parseAmt(form.current||'0'),
      currency: isUSD ? 'usd' : 'ars',
      arsRate: isUSD && dolarBlue ? dolarBlue : null,
      history: [],
    }] });
    setModal(false); setForm(emptyF);
  };
  const openEdit = (sv) => { setEditTarget(sv.id); setEditForm({ name:sv.name, target:sv.target.toString(), current:sv.current.toString() }); setEditModal(true); };
  const saveEdit = () => {
    onSave({ ...data, savings:data.savings.map(sv => sv.id===editTarget ? { ...sv, name:editForm.name, target:parseAmt(editForm.target)||sv.target, current:parseAmt(editForm.current)||0 } : sv) });
    setEditModal(false);
  };
  const delAhorro = (id) => Alert.alert('Eliminar','¿Eliminar este ahorro?',[
    { text:'Cancelar' },
    { text:'Eliminar', style:'destructive', onPress: () => onSave({ ...data, savings:data.savings.filter(sv => sv.id!==id) }) },
  ]);

  const AhorroForm = ({ frm, setFrm, showCurrency = false }) => {
    const isUSD = frm.currency === 'usd';
    return (
      <>
        <Input label="Nombre" value={frm.name} onChangeText={v => setFrm(f => ({ ...f, name:v }))} placeholder="Ej: Vacaciones"/>
        {showCurrency && (
          <View style={{ flexDirection:'row', gap:8, marginBottom:14 }}>
            {['ars','usd'].map(cur => (
              <TouchableOpacity key={cur} onPress={() => setFrm(f => ({ ...f, currency:cur }))}
                style={{ flex:1, paddingVertical:10, borderRadius:12, alignItems:'center',
                  backgroundColor: frm.currency===cur ? C.accent : C.surface2,
                  borderWidth:1, borderColor: frm.currency===cur ? C.gold : C.border }}>
                <Text style={{ fontWeight:'700', fontSize:13, color: frm.currency===cur ? '#fff' : C.textMuted }}>
                  {cur === 'ars' ? '🇦🇷 ARS' : '🇺🇸 USD'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <Input label="Meta" value={frm.target} onChangeText={v => setFrm(f => ({ ...f, target:v }))} placeholder="0" keyboardType="numeric" prefix={isUSD ? 'USD' : '$'}/>
        <Input label="Ya tengo" value={frm.current} onChangeText={v => setFrm(f => ({ ...f, current:v }))} placeholder="0" keyboardType="numeric" prefix={isUSD ? 'USD' : '$'}/>
      </>
    );
  };

  return (
    <View style={{ flex:1 }}>
      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:100 }} showsVerticalScrollIndicator={false}>
        {data.savings.length===0
          ? <View style={{ padding:40, alignItems:'center' }}>
              <Text style={{ fontSize:48, marginBottom:12 }}>🐷</Text>
              <Text style={{ color:C.textMuted, fontSize:14, textAlign:'center' }}>No hay metas de ahorro aún</Text>
            </View>
          : data.savings.map(sv => {
              const isUSD = sv.currency === 'usd';
              const pct = sv.target > 0 ? Math.min((sv.current/sv.target)*100, 100) : 0;
              const rate = dolarBlue || sv.arsRate;
              const arsEquiv = isUSD && rate ? Math.round(sv.current * rate) : null;
              const arsTarget = isUSD && rate ? Math.round(sv.target * rate) : null;
              return (
                <Card key={sv.id} style={{ marginBottom:12 }}>
                  <View style={{ flexDirection:'row', alignItems:'center', marginBottom:12 }}>
                    <IconCircle icon={isUSD ? '💵' : '🐷'} bg={C.accent+'22'} size={44}/>
                    <View style={{ flex:1, marginLeft:12 }}>
                      <View style={{ flexDirection:'row', alignItems:'center', gap:6 }}>
                        <Text style={{ fontSize:15, fontWeight:'700', color:C.text }}>{sv.name}</Text>
                        {isUSD && <Text style={{ fontSize:10, fontWeight:'700', color:'#22c55e', backgroundColor:'#22c55e22', paddingHorizontal:6, paddingVertical:2, borderRadius:8 }}>USD</Text>}
                      </View>
                      {isUSD
                        ? <>
                            <Text style={{ fontSize:13, fontWeight:'700', color:C.text }}>{fmtUSD(sv.current)} / {fmtUSD(sv.target)}</Text>
                            {arsEquiv !== null && <Text style={{ fontSize:11, color:C.textMuted }}>≈ {fmt(arsEquiv)} de {fmt(arsTarget)} ARS</Text>}
                          </>
                        : <Text style={{ fontSize:12, color:C.textMuted }}>{fmt(sv.current)} de {fmt(sv.target)}</Text>
                      }
                    </View>
                    <View style={{ gap:4, alignItems:'flex-end' }}>
                      <TouchableOpacity onPress={() => openEdit(sv)}><Text style={{ color:C.accent, fontSize:11, fontWeight:'600' }}>Editar</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => delAhorro(sv.id)}><Text style={{ color:C.red, fontSize:11 }}>Eliminar</Text></TouchableOpacity>
                    </View>
                  </View>
                  <View style={{ backgroundColor:C.surface2, borderRadius:99, height:8, marginBottom:4 }}>
                    <View style={{ backgroundColor:isUSD ? '#22c55e' : C.accent, height:8, borderRadius:99, width:`${pct}%` }}/>
                  </View>
                  <Text style={{ color: isUSD ? '#22c55e' : C.accent, fontSize:11, textAlign:'right', fontWeight:'600' }}>{pct.toFixed(0)}%</Text>
                  {sv.history && sv.history.length>0 && (
                    <View style={{ marginTop:10, borderTopWidth:1, borderTopColor:C.border, paddingTop:8 }}>
                      <Text style={{ fontSize:9, fontWeight:'700', color:C.textMuted, letterSpacing:0.5, marginBottom:6 }}>HISTORIAL DE DEPÓSITOS</Text>
                      {sv.history.slice().reverse().slice(0,3).map((h,i) => (
                        <View key={i} style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical:2 }}>
                          <Text style={{ fontSize:11, color:C.textMuted }}>{h.date}</Text>
                          <Text style={{ fontSize:11, color: isUSD ? '#22c55e' : C.accent, fontWeight:'600' }}>
                            +{isUSD ? `${fmtUSD(h.amount)}${h.arsRate ? ` (≈ ${fmt(Math.round(h.amount * h.arsRate))})` : ''}` : fmt(h.amount)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </Card>
              );
            })
        }
      </ScrollView>
      <FAB onPress={() => setModal(true)}/>
      <ModalSheet visible={modal} onClose={() => setModal(false)} title="Nueva meta de ahorro">
        <AhorroForm frm={form} setFrm={setForm} showCurrency/>
        <View style={{ flexDirection:'row', gap:10 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={() => setModal(false)}/>
          <Btn label="Guardar" style={{ flex:1 }} onPress={addAhorro}/>
        </View>
      </ModalSheet>
      <ModalSheet visible={editModal} onClose={() => setEditModal(false)} title="Editar ahorro">
        <AhorroForm frm={editForm} setFrm={setEditForm}/>
        <View style={{ flexDirection:'row', gap:10 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={() => setEditModal(false)}/>
          <Btn label="Guardar" style={{ flex:1 }} onPress={saveEdit}/>
        </View>
      </ModalSheet>
    </View>
  );
}
