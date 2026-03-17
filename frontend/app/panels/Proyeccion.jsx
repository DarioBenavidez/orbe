import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Modal, KeyboardAvoidingView, Platform, TextInput } from 'react-native';
import { useC } from '../lib/theme';
import { fmt, fmtAmt, parseAmt, parseDateParts, MONTH_NAMES, DEFAULT_CATEGORIES } from '../lib/constants';
import { Card } from '../components/ui';

export default function Proyeccion({ data, onSave }) {
  const C = useC();
  const now = new Date(); const startMonth=now.getMonth(); const startYear=now.getFullYear();
  const [expanded, setExpanded] = useState(null);
  const [modal, setModal]       = useState(false);
  const [newSalary, setNewSalary] = useState('');
  const [fromMonth, setFromMonth] = useState(startMonth);
  const [fromYear, setFromYear]   = useState(startYear);
  const cats = data.categories || DEFAULT_CATEGORIES;
  const overrides = data.salaryOverrides || [];

  const avgIncome = (() => {
    const totals=[];
    for (let i=0;i<3;i++){
      let m=startMonth-i; let y=startYear; if(m<0){m+=12;y--;}
      const inc=data.transactions.filter(t=>{
        const { month, year } = parseDateParts(t.date);
        return (t.type==='ingreso'||t.type==='sueldo') && month===m && year===y;
      }).reduce((s,t)=>s+t.amount,0);
      if(inc>0) totals.push(inc);
    }
    return totals.length>0?totals.reduce((a,b)=>a+b,0)/totals.length:0;
  })();

  const getIncome = (m, y) => {
    const absMonth = y * 12 + m;
    const applicable = overrides
      .filter(o => o.fromYear * 12 + o.fromMonth <= absMonth)
      .sort((a, b) => (b.fromYear * 12 + b.fromMonth) - (a.fromYear * 12 + a.fromMonth));
    return applicable.length > 0 ? applicable[0].amount : avgIncome;
  };

  const budgetItems = data.budgets.filter(b=>b.limit>0);
  const budgetTotal = budgetItems.reduce((s,b)=>s+b.limit,0);
  const activeDebts = data.debts.filter(d=>d.installment>0&&d.remainingInstallments>0);
  const months = Array.from({length:12},(_,i)=>{
    const m=(startMonth+i)%12; const y=startYear+Math.floor((startMonth+i)/12);
    const income = getIncome(m, y);
    const cuotas=activeDebts.filter(d=>i<d.remainingInstallments).map(d=>({name:d.name,amount:d.installment}));
    const totalCuotas=cuotas.reduce((s,d)=>s+d.amount,0);
    return {label:MONTH_NAMES[m],year:y,income,cuotas,totalCuotas,balance:income-budgetTotal-totalCuotas};
  });

  const saveOverride = () => {
    const amount = parseAmt(newSalary);
    if (!amount || amount <= 0) return Alert.alert('Error', 'Ingresá un monto válido');
    const newOverride = { fromMonth, fromYear, amount };
    const filtered = overrides.filter(o => !(o.fromMonth === fromMonth && o.fromYear === fromYear));
    const updated = [...filtered, newOverride].sort((a,b) => (a.fromYear*12+a.fromMonth)-(b.fromYear*12+b.fromMonth));
    onSave({ ...data, salaryOverrides: updated });
    setModal(false);
    setNewSalary('');
  };

  const deleteOverride = (o) => {
    Alert.alert('Eliminar ajuste', `¿Eliminar el ajuste de sueldo de ${MONTH_NAMES[o.fromMonth]} ${o.fromYear}?`, [
      { text: 'Cancelar' },
      { text: 'Eliminar', style: 'destructive', onPress: () => {
        onSave({ ...data, salaryOverrides: overrides.filter(x => !(x.fromMonth===o.fromMonth && x.fromYear===o.fromYear)) });
      }},
    ]);
  };

  return (
    <ScrollView contentContainerStyle={{ padding:16, paddingBottom:40 }} showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection:'row', gap:10, flexWrap:'wrap', marginBottom:14 }}>
        {[
          { label:'Ingreso base', val:avgIncome, sub:'Prom. 3 meses' },
          { label:'Gastos fijos', val:budgetTotal, sub:`${budgetItems.length} categorías` },
          { label:'Cuotas este mes', val:months[0].totalCuotas, sub:`${months[0].cuotas.length} cuota(s)` },
          { label:'Balance estimado', val:months[0].balance, sub:months[0].balance>=0?'Superávit':'Déficit' },
        ].map(k => (
          <Card key={k.label} style={{ flex:1, minWidth:'45%', marginBottom:4, padding:14 }}>
            <Text style={{ fontSize:9, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5 }}>{k.label}</Text>
            <Text style={{ fontSize:18, fontWeight:'800', color:k.label==='Balance estimado'&&k.val<0?C.red:C.text, marginTop:4 }}>{fmt(k.val)}</Text>
            <Text style={{ fontSize:10, color:C.textMuted, marginTop:2 }}>{k.sub}</Text>
          </Card>
        ))}
      </View>

      <TouchableOpacity onPress={() => setModal(true)}
        style={{ backgroundColor:C.accent, borderRadius:14, paddingVertical:13, alignItems:'center', marginBottom:16, borderWidth:1, borderColor:C.gold }}>
        <Text style={{ color:'#fff', fontWeight:'700', fontSize:14 }}>💼 Actualizar sueldo futuro</Text>
      </TouchableOpacity>

      {overrides.length > 0 && (
        <Card style={{ marginBottom:14 }}>
          <Text style={{ fontSize:11, fontWeight:'700', color:C.textMuted, letterSpacing:0.5, marginBottom:8 }}>AJUSTES DE SUELDO</Text>
          {overrides.map((o,i) => (
            <View key={i} style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:6 }}>
              <Text style={{ fontSize:13, color:C.text }}>Desde {MONTH_NAMES[o.fromMonth]} {o.fromYear}</Text>
              <View style={{ flexDirection:'row', alignItems:'center', gap:12 }}>
                <Text style={{ fontSize:13, fontWeight:'700', color:C.green }}>{fmt(o.amount)}</Text>
                <TouchableOpacity onPress={() => deleteOverride(o)}>
                  <Text style={{ fontSize:16, color:C.red }}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </Card>
      )}

      <Card style={{ marginBottom:32 }}>
        <Text style={{ fontSize:15, fontWeight:'700', color:C.text, marginBottom:14 }}>📅 Proyección 12 meses</Text>
        {months.map((mo,i) => (
          <View key={i}>
            <TouchableOpacity onPress={() => setExpanded(expanded===i?null:i)}
              style={{ flexDirection:'row', alignItems:'center', paddingVertical:12, borderBottomWidth:1, borderBottomColor:C.border }}>
              <Text style={{ fontSize:13, color:C.text, fontWeight:'600', width:68 }}>{mo.label} {mo.year}</Text>
              <View style={{ flex:1, marginHorizontal:10 }}>
                <View style={{ backgroundColor:C.surface2, borderRadius:99, height:6 }}>
                  <View style={{ backgroundColor:mo.balance>=0?C.accent:C.red, height:6, borderRadius:99, width:`${Math.min(Math.abs(mo.balance)/(mo.income||1)*100,100)}%` }}/>
                </View>
              </View>
              <Text style={{ fontSize:13, fontWeight:'700', color:mo.balance>=0?C.accent:C.red, width:78, textAlign:'right' }}>{fmt(mo.balance)}</Text>
              <Text style={{ fontSize:11, color:C.textMuted, marginLeft:6 }}>{expanded===i?'▲':'▼'}</Text>
            </TouchableOpacity>
            {expanded===i && (
              <View style={{ backgroundColor:C.surface2, borderRadius:14, padding:12, marginVertical:6 }}>
                <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, marginBottom:6, letterSpacing:0.5 }}>DETALLE</Text>
                <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
                  <Text style={{ fontSize:13, color:C.textMuted }}>📈 Ingreso estimado</Text>
                  <Text style={{ fontSize:13, color:C.green, fontWeight:'600' }}>{fmt(mo.income)}</Text>
                </View>
                {budgetItems.map(b => (
                  <View key={b.cat} style={{ flexDirection:'row', justifyContent:'space-between' }}>
                    <Text style={{ fontSize:13, color:C.textMuted }}>{cats[b.cat]||'📦'} {b.cat}</Text>
                    <Text style={{ fontSize:13, color:C.red }}>-{fmt(b.limit)}</Text>
                  </View>
                ))}
                {mo.cuotas.map((c,ci) => (
                  <View key={ci} style={{ flexDirection:'row', justifyContent:'space-between' }}>
                    <Text style={{ fontSize:13, color:C.textMuted }}>💳 {c.name}</Text>
                    <Text style={{ fontSize:13, color:C.red }}>-{fmt(c.amount)}</Text>
                  </View>
                ))}
                <View style={{ borderTopWidth:1, borderTopColor:C.border, marginTop:6, paddingTop:6, flexDirection:'row', justifyContent:'space-between' }}>
                  <Text style={{ fontSize:13, fontWeight:'700', color:C.text }}>Balance</Text>
                  <Text style={{ fontSize:13, fontWeight:'700', color:mo.balance>=0?C.accent:C.red }}>{fmt(mo.balance)}</Text>
                </View>
              </View>
            )}
          </View>
        ))}
      </Card>

      <Modal visible={modal} transparent animationType="fade">
        <KeyboardAvoidingView style={{ flex:1, backgroundColor:'#00000080', justifyContent:'center', padding:24 }} behavior={Platform.OS==='ios'?'padding':'height'}>
          <View style={{ backgroundColor:C.surface, borderRadius:24, padding:24 }}>
            <Text style={{ fontSize:17, fontWeight:'800', color:C.text, marginBottom:4 }}>💼 Nuevo sueldo</Text>
            <Text style={{ fontSize:13, color:C.textMuted, marginBottom:20 }}>La proyección usará este monto desde el mes que elijas en adelante.</Text>
            <Text style={{ fontSize:12, fontWeight:'600', color:C.textMuted, marginBottom:6 }}>MONTO</Text>
            <TextInput
              style={{ backgroundColor:C.surface2, borderRadius:12, padding:14, fontSize:16, color:C.text, marginBottom:16 }}
              placeholder="Ej: 500000" placeholderTextColor={C.textMuted}
              keyboardType="numeric" value={newSalary}
              onChangeText={v => setNewSalary(fmtAmt(v))}
            />
            <Text style={{ fontSize:12, fontWeight:'600', color:C.textMuted, marginBottom:8 }}>DESDE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:20 }}>
              {Array.from({length:12},(_,i)=>{
                const m=(startMonth+i)%12; const y=startYear+Math.floor((startMonth+i)/12);
                const sel = fromMonth===m && fromYear===y;
                return (
                  <TouchableOpacity key={i} onPress={() => { setFromMonth(m); setFromYear(y); }}
                    style={{ backgroundColor:sel?C.accent:C.surface2, borderRadius:12, paddingVertical:10, paddingHorizontal:14, marginRight:8, borderWidth:1, borderColor:sel?C.gold:C.border }}>
                    <Text style={{ fontSize:13, fontWeight:'700', color:sel?'#fff':C.textMuted }}>{MONTH_NAMES[m]}</Text>
                    <Text style={{ fontSize:10, color:sel?'#ffffff90':C.textMuted }}>{y}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection:'row', gap:10 }}>
              <TouchableOpacity onPress={() => { setModal(false); setNewSalary(''); }}
                style={{ flex:1, backgroundColor:C.surface2, borderRadius:14, paddingVertical:14, alignItems:'center' }}>
                <Text style={{ color:C.textMuted, fontWeight:'700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveOverride}
                style={{ flex:1, backgroundColor:C.accent, borderRadius:14, paddingVertical:14, alignItems:'center', borderWidth:1, borderColor:C.gold }}>
                <Text style={{ color:'#fff', fontWeight:'700' }}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}
