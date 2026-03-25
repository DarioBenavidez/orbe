import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useC } from '../../lib/theme';
import { fmt, fmtAmt, parseAmt, parseDateParts, MONTH_NAMES, DEFAULT_CATEGORIES } from '../../lib/constants';
import { Card, Btn, Input, ModalSheet, Chip, BarChart, ScreenWithHeader, EmptyState } from '../../components/ui';

export default function AnalisisTab({ data, onSave }) {
  const C = useC();
  const cats = data.categories || DEFAULT_CATEGORIES;
  const { txs, totalIncome, totalExpense, expByCat, topGastos, maxG } = useMemo(() => {
    const txs  = data.transactions.filter(t => {
      const { month, year } = parseDateParts(t.date);
      return month===data.selectedMonth && year===data.selectedYear;
    });
    const totalIncome  = txs.filter(t => t.type==='ingreso'||t.type==='sueldo').reduce((a,t) => a+t.amount, 0);
    const totalExpense = txs.filter(t => t.type==='gasto' || t.type==='ahorro_meta').reduce((a,t) => a+t.amount, 0);
    const expByCat     = txs.filter(t => t.type==='gasto').reduce((acc,t) => { acc[t.category]=(acc[t.category]||0)+t.amount; return acc; }, {});
    const topGastos    = Object.entries(expByCat).sort((a,b) => b[1]-a[1]).slice(0,5);
    const maxG         = topGastos[0]?.[1] || 1;
    return { txs, totalIncome, totalExpense, expByCat, topGastos, maxG };
  }, [data.transactions, data.selectedMonth, data.selectedYear]);

  const [editing, setEditing]             = useState({});
  const [editingValues, setEditingValues] = useState({});
  const [catModal, setCatModal]           = useState(false);
  const [catForm, setCatForm]             = useState({ icon:'📦', name:'' });
  const [editCat, setEditCat]             = useState(null);
  const ICON_OPTIONS = ['🏠','🛒','🚗','💊','🎬','👗','📚','💡','💳','📦','🍕','✈️','🐾','🏋️','🎮','💈','🌿','🎁','🏖️','💰'];

  const updateLimit = (cat, val) => {
    const limit = parseAmt(val) || 0;
    const exists = data.budgets.some(b => b.cat === cat);
    const budgets = exists
      ? data.budgets.map(b => b.cat === cat ? { ...b, limit } : b)
      : [...data.budgets, { cat, limit }];
    onSave({ ...data, budgets });
  };
  const addCategory = () => {
    if (!catForm.name.trim()) return;
    const key = catForm.name.trim();
    onSave({ ...data, categories:{ ...cats, [key]:catForm.icon }, budgets:[...data.budgets, { cat:key, limit:0 }] });
    setCatModal(false); setCatForm({ icon:'📦', name:'' });
  };
  const deleteCategory = (cat) => {
    const txCount = data.transactions.filter(t => t.category === cat).length;
    const msg = txCount > 0
      ? `¿Eliminar "${cat}"? Hay ${txCount} transacción${txCount !== 1 ? 'es' : ''} con esta categoría que quedarán sin categorizar.`
      : `¿Eliminar "${cat}"?`;
    Alert.alert('Eliminar categoría', msg, [
      { text:'Cancelar' },
      { text:'Eliminar', style:'destructive', onPress: () => {
        const nc = {...cats}; delete nc[cat];
        onSave({ ...data, categories:nc, budgets:data.budgets.filter(b => b.cat!==cat) });
      }},
    ]);
  };
  const saveEditCat = () => {
    if (!editCat) return;
    const nc = {...cats};
    if (editCat.newName && editCat.newName !== editCat.key) {
      nc[editCat.newName] = editCat.icon; delete nc[editCat.key];
      const budgets = data.budgets.map(b => b.cat===editCat.key ? { ...b, cat:editCat.newName } : b);
      onSave({ ...data, categories:nc, budgets });
    } else {
      nc[editCat.key] = editCat.icon;
      onSave({ ...data, categories:nc });
    }
    setEditCat(null);
  };

  const chartData = useMemo(() => Array.from({ length:6 }, (_, i) => {
    let m = data.selectedMonth - (5-i); let y = data.selectedYear;
    if (m < 0) { m += 12; y--; }
    const mTxs = data.transactions.filter(t => { const { month, year } = parseDateParts(t.date); return month===m && year===y; });
    return {
      label: MONTH_NAMES[m],
      income:  mTxs.filter(t => t.type==='ingreso'||t.type==='sueldo').reduce((a,t) => a+t.amount, 0),
      expense: mTxs.filter(t => t.type==='gasto').reduce((a,t) => a+t.amount, 0),
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
      <ScrollView contentContainerStyle={{ padding:16 }} showsVerticalScrollIndicator={false}>
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

        <Card style={{ marginBottom:32 }}>
          <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
            <Text style={{ fontSize:15, fontWeight:'700', color:C.text }}>Presupuesto</Text>
            <TouchableOpacity onPress={() => setCatModal(true)}
              style={{ backgroundColor:C.accent, borderRadius:10, paddingHorizontal:12, paddingVertical:5, borderWidth:1, borderColor:C.gold }}>
              <Text style={{ color:'#fff', fontSize:12, fontWeight:'700' }}>+ Nueva</Text>
            </TouchableOpacity>
          </View>
          {Object.keys(cats).map(cat => {
            const b = data.budgets.find(x => x.cat === cat) || { cat, limit: 0 };
            const spent = expByCat[b.cat] || 0;
            const rawPct = b.limit > 0 ? (spent/b.limit)*100 : 0;
            const pct    = Math.min(rawPct, 100);
            const over   = b.limit > 0 && spent > b.limit;
            const warn   = b.limit > 0 && rawPct >= 80 && !over;
            const barColor = over ? C.red : warn ? '#F97316' : C.accent;
            return (
              <View key={b.cat} style={{ marginBottom:14 }}>
                <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                  <TouchableOpacity onPress={() => setEditCat({ key:b.cat, icon:cats[b.cat]||'📦', newName:b.cat })} style={{ flex:1 }}>
                    <Text style={{ fontSize:13, color:C.text }}>{cats[b.cat]||'📦'} {b.cat} ✏️</Text>
                  </TouchableOpacity>
                  <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                    <View style={{ alignItems:'flex-end' }}>
                      <Text style={{ fontSize:11, color:C.textMuted }}>{fmt(spent)} / {editing[b.cat] ? null : fmt(b.limit)}</Text>
                      {b.limit > 0 && (
                        <Text style={{ fontSize:10, fontWeight:'700', color: over ? C.red : warn ? '#F97316' : C.textMuted }}>
                          {over ? `⚠ ${rawPct.toFixed(0)}% — superado` : warn ? `⚠ ${rawPct.toFixed(0)}%` : `${rawPct.toFixed(0)}%`}
                        </Text>
                      )}
                    </View>
                    {editing[b.cat]
                      ? <TextInput
                          style={{ borderWidth:1, borderColor:C.border, borderRadius:8, padding:4, width:80, fontSize:13, color:C.text, textAlign:'right', backgroundColor:C.surface2 }}
                          value={editingValues[b.cat] ?? fmtAmt(b.limit.toString())}
                          onChangeText={v => setEditingValues(ev => ({ ...ev, [b.cat]:fmtAmt(v) }))}
                          keyboardType="numeric" autoFocus
                          onBlur={() => {
                            updateLimit(b.cat, editingValues[b.cat] ?? b.limit.toString());
                            setEditing(ed => ({ ...ed, [b.cat]:false }));
                            setEditingValues(ev => { const n={...ev}; delete n[b.cat]; return n; });
                          }}
                        />
                      : <TouchableOpacity onPress={() => setEditing(ed => ({ ...ed, [b.cat]:true }))}>
                          <Text style={{ fontSize:13, color:C.accent, fontWeight:'600' }}>✏️</Text>
                        </TouchableOpacity>
                    }
                    <TouchableOpacity onPress={() => deleteCategory(b.cat)}>
                      <Text style={{ fontSize:13, color:C.red }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {b.limit > 0 && (
                  <View style={{ backgroundColor:C.surface2, borderRadius:99, height:8 }}>
                    <View style={{ backgroundColor:barColor, height:8, borderRadius:99, width:`${pct}%` }}/>
                  </View>
                )}
              </View>
            );
          })}
        </Card>
      </ScrollView>

      <ModalSheet visible={catModal} onClose={() => { setCatModal(false); setCatForm({ icon:'📦', name:'' }); }} title="Nueva categoría">
        <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Ícono</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:14 }}>
          {ICON_OPTIONS.map(icon => (
            <TouchableOpacity key={icon} onPress={() => setCatForm(f => ({ ...f, icon }))}
              style={{ width:42, height:42, borderRadius:12, marginRight:8, alignItems:'center', justifyContent:'center',
                backgroundColor:catForm.icon===icon?C.accentLight:C.surface2,
                borderWidth:catForm.icon===icon?1.5:1, borderColor:catForm.icon===icon?C.gold:C.border }}>
              <Text style={{ fontSize:20 }}>{icon}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Input label="Nombre" value={catForm.name} onChangeText={v => setCatForm(f => ({ ...f, name:v }))} placeholder="Ej: Mascotas"/>
        <View style={{ flexDirection:'row', gap:10 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={() => setCatModal(false)}/>
          <Btn label="Guardar" style={{ flex:1 }} onPress={addCategory}/>
        </View>
      </ModalSheet>

      <ModalSheet visible={!!editCat} onClose={() => setEditCat(null)} title="Editar categoría">
        <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Ícono</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:14 }}>
          {ICON_OPTIONS.map(icon => (
            <TouchableOpacity key={icon} onPress={() => setEditCat(ec => ({ ...ec, icon }))}
              style={{ width:42, height:42, borderRadius:12, marginRight:8, alignItems:'center', justifyContent:'center',
                backgroundColor:editCat?.icon===icon?C.accentLight:C.surface2,
                borderWidth:editCat?.icon===icon?1.5:1, borderColor:editCat?.icon===icon?C.gold:C.border }}>
              <Text style={{ fontSize:20 }}>{icon}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Input label="Nombre" value={editCat?.newName||''} onChangeText={v => setEditCat(ec => ({ ...ec, newName:v }))} placeholder="Nombre"/>
        <View style={{ flexDirection:'row', gap:10 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={() => setEditCat(null)}/>
          <Btn label="Guardar" style={{ flex:1 }} onPress={saveEditCat}/>
        </View>
      </ModalSheet>
    </ScreenWithHeader>
  );
}
