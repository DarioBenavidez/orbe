import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, TextInput } from 'react-native';
import { useC } from '../../lib/theme';
import { fmt, fmtAmt, parseAmt, MONTH_NAMES, DEFAULT_CATEGORIES } from '../../lib/constants';
import { Card, Btn, Input, FAB, ModalSheet, IconCircle } from '../../components/ui';

export default function Deudas({ data, onSave }) {
  const C = useC();
  const emptyF = { name:'', remaining:'', installment:'', remainingInstallments:'' };
  const [modal, setModal]           = useState(false);
  const [editModal, setEditModal]   = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm]             = useState(emptyF);
  const [editForm, setEditForm]     = useState(emptyF);
  const [payAmt, setPayAmt]         = useState({});

  const totalDebt       = data.debts.reduce((s,d) => s+d.remaining, 0);
  const monthlyPayments = data.debts.reduce((s,d) => s+d.installment, 0);

  const calcInst = (rem, inst) => {
    if (!rem||!inst||parseAmt(inst)===0) return '';
    return Math.ceil(parseAmt(rem)/parseAmt(inst)).toString();
  };
  const endMonth = (instStr) => {
    if (!instStr) return '';
    const n = parseInt(instStr);
    const d = new Date(); d.setMonth(d.getMonth()+n-1);
    return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  };
  const addDeuda = () => {
    if (!form.name||!form.remaining) return;
    const inst = parseAmt(form.installment)||0;
    const ri = parseInt(form.remainingInstallments)||(inst>0?Math.ceil(parseAmt(form.remaining)/inst):0);
    onSave({ ...data, debts:[...data.debts, { name:form.name, total:parseAmt(form.remaining), remaining:parseAmt(form.remaining), installment:inst, remainingInstallments:ri, id:Date.now().toString() }] });
    setModal(false); setForm(emptyF);
  };
  const openEdit = (d) => {
    setEditTarget(d.id);
    setEditForm({ name:d.name, remaining:d.remaining.toString(), installment:d.installment.toString(), remainingInstallments:d.remainingInstallments.toString() });
    setEditModal(true);
  };
  const saveEdit = () => {
    const inst = parseAmt(editForm.installment)||0;
    const ri = parseInt(editForm.remainingInstallments)||(inst>0?Math.ceil(parseAmt(editForm.remaining)/inst):0);
    onSave({ ...data, debts:data.debts.map(d => d.id===editTarget ? { ...d, name:editForm.name, remaining:parseAmt(editForm.remaining)||d.remaining, installment:inst, remainingInstallments:ri } : d) });
    setEditModal(false);
  };
  const pay = (id) => {
    const amt = parseAmt(payAmt[id]||'0'); if (!amt) return;
    const deuda = data.debts.find(d => d.id===id);
    const realAmt = Math.min(amt, deuda.remaining);
    const debts = data.debts.map(d => d.id===id ? { ...d, remaining:Math.max(0,d.remaining-realAmt), remainingInstallments:Math.max(0,(d.remainingInstallments||0)-1) } : d);
    const cats = data.categories || DEFAULT_CATEGORIES;
    const payCategory = cats['Préstamo tarjeta'] ? 'Préstamo tarjeta' : 'Otros';
    const tx = { id:Date.now().toString(), type:'gasto', description:`Pago: ${deuda.name}`, amount:realAmt, category:payCategory, date:new Date().toISOString().split('T')[0] };
    onSave({ ...data, debts, transactions:[...data.transactions, tx] });
    setPayAmt({ ...payAmt, [id]:'' });
  };
  const delDeuda = (id) => Alert.alert('Eliminar','¿Eliminar esta deuda?',[
    { text:'Cancelar' },
    { text:'Eliminar', style:'destructive', onPress: () => onSave({ ...data, debts:data.debts.filter(d => d.id!==id) }) },
  ]);

  const DeudaForm = ({ frm, setFrm }) => (
    <>
      <Input label="Nombre / Acreedor" value={frm.name} onChangeText={v => setFrm(f => ({ ...f, name:v }))} placeholder="Ej: Tarjeta Visa"/>
      <Input label="Monto pendiente" value={frm.remaining} onChangeText={v => setFrm(f => ({ ...f, remaining:v, remainingInstallments:calcInst(v,f.installment) }))} placeholder="0" keyboardType="numeric" prefix="$"/>
      <Input label="Cuota mensual" value={frm.installment} onChangeText={v => setFrm(f => ({ ...f, installment:v, remainingInstallments:calcInst(f.remaining,v) }))} placeholder="0" keyboardType="numeric" prefix="$"/>
      <View style={{ backgroundColor:C.surface2, borderRadius:12, padding:12, marginBottom:14 }}>
        <Text style={{ fontSize:13, color:C.accent }}>
          📅 {frm.remainingInstallments ? `${frm.remainingInstallments} cuotas · Termina ${endMonth(frm.remainingInstallments)}` : 'Ingresá monto y cuota para calcular'}
        </Text>
      </View>
    </>
  );

  return (
    <View style={{ flex:1 }}>
      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:100 }} showsVerticalScrollIndicator={false}>
        {(totalDebt > 0 || monthlyPayments > 0) && (
          <View style={{ flexDirection:'row', gap:10, marginBottom:14 }}>
            <Card style={{ flex:1, padding:14 }}>
              <Text style={{ fontSize:9, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5 }}>Deuda total</Text>
              <Text style={{ fontSize:18, fontWeight:'800', color:C.red, marginTop:4 }}>{fmt(totalDebt)}</Text>
            </Card>
            {monthlyPayments > 0 && (
              <Card style={{ flex:1, padding:14 }}>
                <Text style={{ fontSize:9, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5 }}>Cuotas / mes</Text>
                <Text style={{ fontSize:18, fontWeight:'800', color:C.text, marginTop:4 }}>{fmt(monthlyPayments)}</Text>
              </Card>
            )}
          </View>
        )}
        {data.debts.length===0
          ? <View style={{ padding:40, alignItems:'center' }}>
              <Text style={{ fontSize:48, marginBottom:12 }}>💳</Text>
              <Text style={{ color:C.textMuted, fontSize:14, textAlign:'center' }}>Sin deudas registradas</Text>
            </View>
          : data.debts.map(d => {
              const pct = d.total>0 ? Math.min(((d.total-d.remaining)/d.total)*100, 100) : 0;
              return (
                <Card key={d.id} style={{ marginBottom:12 }}>
                  <View style={{ flexDirection:'row', alignItems:'flex-start', marginBottom:10 }}>
                    <IconCircle icon="💳" bg={C.red+'22'} size={44}/>
                    <View style={{ flex:1, marginLeft:12 }}>
                      <Text style={{ fontSize:15, fontWeight:'700', color:C.text }}>{d.name}</Text>
                      <Text style={{ fontSize:12, color:C.textMuted }}>Restante: {fmt(d.remaining)}{d.installment>0 ? ` · Cuota: ${fmt(d.installment)}` : ''}</Text>
                      {d.remainingInstallments>0 && (
                        <Text style={{ fontSize:11, color:C.accent, marginTop:2 }}>📅 {d.remainingInstallments} cuotas · {endMonth(d.remainingInstallments.toString())}</Text>
                      )}
                    </View>
                    <View style={{ gap:4, alignItems:'flex-end' }}>
                      <TouchableOpacity onPress={() => openEdit(d)}><Text style={{ color:C.accent, fontSize:11, fontWeight:'600' }}>Editar</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => delDeuda(d.id)}><Text style={{ color:C.red, fontSize:11 }}>Eliminar</Text></TouchableOpacity>
                    </View>
                  </View>
                  <View style={{ backgroundColor:C.surface2, borderRadius:99, height:8, marginBottom:12 }}>
                    <View style={{ backgroundColor:C.accent, height:8, borderRadius:99, width:`${pct}%` }}/>
                  </View>
                  <View style={{ flexDirection:'row', gap:8, alignItems:'center' }}>
                    <TextInput
                      style={{ flex:1, backgroundColor:C.surface2, borderWidth:1, borderColor:C.border, borderRadius:12, padding:10, fontSize:13, color:C.text }}
                      value={payAmt[d.id]||''} onChangeText={v => setPayAmt(p => ({ ...p, [d.id]:fmtAmt(v) }))}
                      placeholder="Registrar pago $" keyboardType="numeric" placeholderTextColor={C.textDim}
                    />
                    <Btn label="Pagar" onPress={() => pay(d.id)} style={{ paddingHorizontal:18, paddingVertical:10 }}/>
                  </View>
                  <Text style={{ fontSize:10, color:C.textMuted, marginTop:6 }}>💡 El pago se registra como gasto automáticamente</Text>
                </Card>
              );
            })
        }
      </ScrollView>
      <FAB onPress={() => setModal(true)}/>
      <ModalSheet visible={modal} onClose={() => setModal(false)} title="Nueva deuda">
        <DeudaForm frm={form} setFrm={setForm}/>
        <View style={{ flexDirection:'row', gap:10 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={() => setModal(false)}/>
          <Btn label="Guardar" style={{ flex:1 }} onPress={addDeuda}/>
        </View>
      </ModalSheet>
      <ModalSheet visible={editModal} onClose={() => setEditModal(false)} title="Editar deuda">
        <DeudaForm frm={editForm} setFrm={setEditForm}/>
        <View style={{ flexDirection:'row', gap:10 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={() => setEditModal(false)}/>
          <Btn label="Guardar" style={{ flex:1 }} onPress={saveEdit}/>
        </View>
      </ModalSheet>
    </View>
  );
}
