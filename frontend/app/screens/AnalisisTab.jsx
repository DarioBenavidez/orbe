import React, { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useC } from '../../lib/theme';
import { fmt, parseDateParts, MONTH_NAMES, DEFAULT_CATEGORIES } from '../../lib/constants';
import { Card, BarChart, ScreenWithHeader, EmptyState } from '../../components/ui';

export default function AnalisisTab({ data, onSave }) {
  const C = useC();
  const cats = data.categories || DEFAULT_CATEGORIES;

  const { totalIncome, totalExpense, expByCat, topGastos, maxG } = useMemo(() => {
    const txs = data.transactions.filter(t => {
      const { month, year } = parseDateParts(t.date);
      return month===data.selectedMonth && year===data.selectedYear;
    });
    const totalIncome  = txs.filter(t => t.type==='ingreso'||t.type==='sueldo').reduce((a,t) => a+t.amount, 0);
    const totalExpense = txs.filter(t => t.type==='gasto'||t.type==='ahorro_meta').reduce((a,t) => a+t.amount, 0);
    const expByCat     = txs.filter(t => t.type==='gasto').reduce((acc,t) => { acc[t.category]=(acc[t.category]||0)+t.amount; return acc; }, {});
    const topGastos    = Object.entries(expByCat).sort((a,b) => b[1]-a[1]).slice(0,5);
    const maxG         = topGastos[0]?.[1] || 1;
    return { totalIncome, totalExpense, expByCat, topGastos, maxG };
  }, [data.transactions, data.selectedMonth, data.selectedYear]);

  const chartData = useMemo(() => Array.from({ length:6 }, (_, i) => {
    let m = data.selectedMonth - (5-i); let y = data.selectedYear;
    if (m < 0) { m += 12; y--; }
    const mTxs = data.transactions.filter(t => { const { month, year } = parseDateParts(t.date); return month===m && year===y; });
    return {
      label: MONTH_NAMES[m],
      income:  mTxs.filter(t => t.type==='ingreso'||t.type==='sueldo').reduce((a,t) => a+t.amount, 0),
      expense: mTxs.filter(t => t.type==='gasto'||t.type==='ahorro_meta').reduce((a,t) => a+t.amount, 0),
    };
  }), [data.transactions, data.selectedMonth, data.selectedYear]);

  return (
    <ScreenWithHeader header={
      <>
        <Text style={{ fontSize:13, color:'#ffffff70', fontWeight:'600', letterSpacing:0.3, marginBottom:2 }}>Estadísticas</Text>
        <Text style={{ fontSize:24, fontWeight:'800', color:'#fff', letterSpacing:-0.7, marginBottom:18 }}>Análisis</Text>
        <View style={{ flexDirection:'row', gap:20 }}>
          <View style={{ flex:1, backgroundColor:'#ffffff10', borderRadius:16, padding:14 }}>
            <Text style={{ fontSize:10, color:'#ffffff60', fontWeight:'700', textTransform:'uppercase', letterSpacing:1 }}>Ingresos</Text>
            <Text style={{ fontSize:22, fontWeight:'800', color:'#34D399', marginTop:4, letterSpacing:-0.5 }}>{fmt(totalIncome)}</Text>
          </View>
          <View style={{ flex:1, backgroundColor:'#ffffff10', borderRadius:16, padding:14 }}>
            <Text style={{ fontSize:10, color:'#ffffff60', fontWeight:'700', textTransform:'uppercase', letterSpacing:1 }}>Gastos</Text>
            <Text style={{ fontSize:22, fontWeight:'800', color:'#F87171', marginTop:4, letterSpacing:-0.5 }}>{fmt(totalExpense)}</Text>
          </View>
        </View>
      </>
    }>
      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:32 }} showsVerticalScrollIndicator={false}>
        <Card style={{ marginBottom:14 }}>
          <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <Text style={{ fontSize:15, fontWeight:'700', color:C.text }}>Ingresos y Gastos</Text>
            <View style={{ flexDirection:'row', gap:12 }}>
              {[{ label:'Ingreso', color:C.green }, { label:'Gasto', color:C.red }].map(l => (
                <View key={l.label} style={{ flexDirection:'row', alignItems:'center', gap:4 }}>
                  <View style={{ width:10, height:10, borderRadius:5, backgroundColor:l.color }}/>
                  <Text style={{ fontSize:10, color:C.textMuted }}>{l.label}</Text>
                </View>
              ))}
            </View>
          </View>
          <BarChart data={chartData}/>
        </Card>

        <Card style={{ marginBottom:14 }}>
          <Text style={{ fontSize:15, fontWeight:'700', color:C.text, marginBottom:14 }}>Top gastos</Text>
          {topGastos.length === 0
            ? <EmptyState icon="📊" title="Sin gastos este mes" subtitle="Tus gastos aparecerán aquí una vez que los registres"/>
            : topGastos.map(([cat, val]) => (
              <View key={cat} style={{ marginBottom:12 }}>
                <View style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:5 }}>
                  <Text style={{ fontSize:13, color:C.text }}>{cats[cat]||'📦'} {cat}</Text>
                  <Text style={{ fontSize:13, fontWeight:'700', color:C.red }}>{fmt(val)}</Text>
                </View>
                <View style={{ backgroundColor:C.surface2, borderRadius:99, height:6 }}>
                  <View style={{ backgroundColor:C.red, height:6, borderRadius:99, width:`${(val/maxG)*100}%`, opacity:0.7 }}/>
                </View>
              </View>
            ))
          }
        </Card>
      </ScrollView>
    </ScreenWithHeader>
  );
}
