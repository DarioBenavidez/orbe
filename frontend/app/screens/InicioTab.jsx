import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useC } from '../../lib/theme';
import { fmt, parseDateParts, DEFAULT_CATEGORIES, MONTH_NAMES, cMonth, cYear } from '../../lib/constants';
import { Card, TxRow, ScreenWithHeader } from '../../components/ui';

export default function InicioTab({ data, onSave, onMonthPress, nombre, onOpenPanel, onEditTx }) {
  const C = useC();
  const [txFilter, setTxFilter] = useState('mes');
  const txs = data.transactions.filter(t => {
    const { month, year } = parseDateParts(t.date);
    return month === data.selectedMonth && year === data.selectedYear;
  });

  const filteredTxs = (() => {
    if (txFilter === 'semana') {
      const now = new Date();
      const day = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const mon = new Date(now); mon.setDate(now.getDate() - day); mon.setHours(0,0,0,0);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999);
      return data.transactions.filter(t => {
        const d = new Date(t.date + 'T00:00:00');
        return d >= mon && d <= sun;
      });
    }
    if (txFilter === 'anterior') {
      const m = data.selectedMonth === 0 ? 11 : data.selectedMonth - 1;
      const y = data.selectedMonth === 0 ? data.selectedYear - 1 : data.selectedYear;
      return data.transactions.filter(t => {
        const { month, year } = parseDateParts(t.date);
        return month === m && year === y;
      });
    }
    return txs;
  })();

  const totalIncome  = txs.filter(t => t.type==='ingreso'||t.type==='sueldo').reduce((a,t) => a+t.amount, 0);
  const totalExpense = txs.filter(t => t.type==='gasto' || t.type==='ahorro_meta').reduce((a,t) => a+t.amount, 0);
  const totalBudget  = data.budgets.reduce((s,b) => s+b.limit, 0);
  const pct          = totalBudget > 0 ? Math.min((totalExpense/totalBudget)*100, 100) : 0;
  const balance      = totalIncome - totalExpense;
  const cats         = data.categories || DEFAULT_CATEGORIES;
  const today        = new Date().getDate();
  const isCurrentMonth = data.selectedMonth === cMonth && data.selectedYear === cYear;
  const upcoming     = isCurrentMonth
    ? (data.events||[]).filter(ev => ev.day>=today && ev.day<=today+7).sort((a,b) => a.day-b.day).slice(0,3)
    : [];

  const today2 = new Date();
  const todayStr = `${today2.getFullYear()}-${String(today2.getMonth()+1).padStart(2,'0')}-${String(today2.getDate()).padStart(2,'0')}`;
  const upcomingTurnos = (data.turnos || [])
    .filter(t => t.date >= todayStr && !t.cancelled)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);

  return (
    <ScreenWithHeader header={
      <>
        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:22 }}>
          <View style={{ flex:1, marginRight:10 }}>
            <Text style={{ fontSize:13, color:'#ffffff70', fontWeight:'600', letterSpacing:0.3 }}>{(() => { const h=new Date().getHours(); return h<12?'Buenos días':h<18?'Buenas tardes':'Buenas noches'; })()}</Text>
            <Text style={{ fontSize:22, fontWeight:'800', color:'#fff', letterSpacing:-0.7, marginTop:2 }} numberOfLines={1} ellipsizeMode="tail">{nombre}</Text>
          </View>
          <TouchableOpacity onPress={onMonthPress}
            style={{ backgroundColor:'#ffffff15', borderRadius:20, paddingHorizontal:12, paddingVertical:8, borderWidth:1, borderColor:'#ffffff25', flexShrink:0 }}>
            <Text style={{ color:'#ffffffcc', fontSize:12, fontWeight:'700' }}>{today} / {MONTH_NAMES[data.selectedMonth]} / {data.selectedYear} ▾</Text>
          </TouchableOpacity>
        </View>
        <View style={{ marginBottom:6 }}>
          <Text style={{ fontSize:12, color:'#ffffff60', fontWeight:'600', textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>Balance disponible</Text>
          <Text style={{ fontSize:42, fontWeight:'800', color:'#fff', letterSpacing:-1.5, marginBottom:10 }}>{fmt(balance)}</Text>
          <View style={{ flexDirection:'row', gap:18 }}>
            <View style={{ flexDirection:'row', alignItems:'center', gap:6 }}>
              <View style={{ width:8, height:8, borderRadius:4, backgroundColor:'#34D399' }}/>
              <Text style={{ fontSize:13, color:'#ffffffbb', fontWeight:'600' }}>Ingresos {fmt(totalIncome)}</Text>
            </View>
            <View style={{ flexDirection:'row', alignItems:'center', gap:6 }}>
              <View style={{ width:8, height:8, borderRadius:4, backgroundColor:'#F87171' }}/>
              <Text style={{ fontSize:13, color: totalExpense>totalBudget&&totalBudget>0 ? '#ffa0a0' : '#ffffffbb', fontWeight:'600' }}>Gastos {fmt(totalExpense)}</Text>
            </View>
          </View>
        </View>
        {totalBudget > 0 && (
          <View style={{ marginTop:14 }}>
            <View style={{ backgroundColor:'#ffffff20', borderRadius:99, height:6, overflow:'hidden', marginBottom:6 }}>
              <View style={{ width:`${pct}%`, backgroundColor: pct>80 ? '#F87171' : '#ffffff99', borderRadius:99, height:6 }}/>
            </View>
            <Text style={{ fontSize:11, color:'#ffffff80' }}>
              {pct>=100 ? '⚠️ Presupuesto superado' : pct>=80 ? `⚠️ ${pct.toFixed(0)}% del presupuesto` : `${pct.toFixed(0)}% del presupuesto usado`}
            </Text>
          </View>
        )}
      </>
    }>
      <ScrollView contentContainerStyle={{ padding:16, paddingTop:20 }} showsVerticalScrollIndicator={false}>
        <View style={{ marginBottom:12 }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal:16, paddingVertical:4 }}
          >
            {[
              { key:'ahorros',    label:'Ahorros',    icon:'🐷' },
              { key:'deudas',     label:'Deudas',     icon:'💳' },
              { key:'prestamos',  label:'Préstamos',  icon:'🤝' },
              { key:'turnos',     label:'Turnos',     icon:'📅' },
              { key:'calendario', label:'Eventos',    icon:'🗓️' },
              { key:'proyeccion', label:'Proyección', icon:'📈' },
            ].map(m => (
              <TouchableOpacity key={m.key} onPress={() => onOpenPanel(m.key)}
                style={{ backgroundColor:C.accent, borderWidth:1, borderColor:C.gold, borderRadius:16, padding:14, marginRight:10, alignItems:'center', width:90, shadowColor:'#C9A84C', shadowOffset:{ width:0, height:4 }, shadowOpacity:0.25, shadowRadius:8, elevation:6 }}>
                <Text style={{ fontSize:24 }}>{m.icon}</Text>
                <Text style={{ fontSize:11, color:'#fff', fontWeight:'700', marginTop:6, textAlign:'center' }}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <LinearGradient
            colors={[C.bg, 'transparent']}
            start={{ x:0, y:0 }} end={{ x:1, y:0 }}
            pointerEvents="none"
            style={{ position:'absolute', left:0, top:0, bottom:0, width:20 }}
          />
          <LinearGradient
            colors={['transparent', C.bg]}
            start={{ x:0, y:0 }} end={{ x:1, y:0 }}
            pointerEvents="none"
            style={{ position:'absolute', right:0, top:0, bottom:0, width:20 }}
          />
        </View>

        {upcomingTurnos.length > 0 && (
          <Card style={{ marginBottom:14, borderLeftWidth:3, borderLeftColor:C.accent }}>
            <Text style={{ fontSize:14, fontWeight:'700', color:C.text, marginBottom:12 }}>📅 Próximos turnos</Text>
            {upcomingTurnos.map(t => (
              <View key={t.id} style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:8, borderBottomWidth:1, borderBottomColor:C.border }}>
                <View>
                  <Text style={{ fontSize:13, color:C.text, fontWeight:'600' }}>{t.description}</Text>
                  {t.location ? <Text style={{ fontSize:11, color:C.textMuted, marginTop:1 }}>📍 {t.location}</Text> : null}
                </View>
                <View style={{ alignItems:'flex-end' }}>
                  <Text style={{ fontSize:12, color:C.accent, fontWeight:'700' }}>{t.date}</Text>
                  {t.time ? <Text style={{ fontSize:11, color:C.textMuted }}>{t.time}</Text> : null}
                </View>
              </View>
            ))}
          </Card>
        )}

        {upcoming.length > 0 && (
          <Card style={{ marginBottom:14, borderLeftWidth:3, borderLeftColor:C.red }}>
            <Text style={{ fontSize:14, fontWeight:'700', color:C.text, marginBottom:12 }}>⚠️ Próximos vencimientos</Text>
            {upcoming.map(ev => (
              <View key={ev.id} style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:8, borderBottomWidth:1, borderBottomColor:C.border }}>
                <Text style={{ fontSize:13, color:C.text, fontWeight:'500' }}>{ev.title}</Text>
                <Text style={{ fontSize:13, color:C.red, fontWeight:'700' }}>Día {ev.day}</Text>
              </View>
            ))}
          </Card>
        )}

        <Card style={{ marginBottom:32 }}>
          <Text style={{ fontSize:15, fontWeight:'700', color:C.text, marginBottom:12, letterSpacing:-0.3 }}>Transacciones</Text>
          <View style={{ flexDirection:'row', gap:8, marginBottom:14 }}>
            {[
              { key:'semana',   label:'Esta semana' },
              { key:'mes',      label:'Este mes' },
              { key:'anterior', label:'Mes anterior' },
            ].map(f => (
              <TouchableOpacity key={f.key} onPress={() => setTxFilter(f.key)}
                style={{ paddingHorizontal:12, paddingVertical:6, borderRadius:20, borderWidth:1,
                  backgroundColor: txFilter===f.key ? C.accent : 'transparent',
                  borderColor: txFilter===f.key ? C.accent : C.border }}>
                <Text style={{ fontSize:12, fontWeight:'600', color: txFilter===f.key ? '#fff' : C.textMuted }}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {filteredTxs.length === 0
            ? <Text style={{ color:C.textMuted, fontSize:13, textAlign:'center', paddingVertical:24 }}>Sin transacciones</Text>
            : filteredTxs.slice().reverse().slice(0,20).map(t => <TxRow key={t.id} tx={t} cats={cats} onEdit={onEditTx} onDelete={id => Alert.alert('Eliminar','¿Eliminar esta transacción?',[{text:'Cancelar'},{text:'Eliminar',style:'destructive',onPress:()=>onSave({...data,transactions:data.transactions.filter(t=>t.id!==id)})}])}/>)
          }
        </Card>
      </ScrollView>
    </ScreenWithHeader>
  );
}
