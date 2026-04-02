import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useC } from '../../lib/theme';
import { fmt, fmtAmt, parseAmt, parseDateParts, DEFAULT_CATEGORIES } from '../../lib/constants';
import { Card, Btn, Input, FAB, ModalSheet, EmptyState } from '../../components/ui';

const ICON_OPTIONS = ['🏠','🛒','🚗','💊','🎬','👗','📚','💡','💳','📦','🍕','✈️','🐾','🏋️','🎮','💈','🌿','🎁','🏖️','💰'];

export default function Presupuesto({ data, onSave }) {
  const C = useC();
  const cats = data.categories || DEFAULT_CATEGORIES;

  const [editing, setEditing]             = useState({});
  const [editingValues, setEditingValues] = useState({});
  const [catModal, setCatModal]           = useState(false);
  const [catForm, setCatForm]             = useState({ icon:'📦', name:'' });
  const [editCat, setEditCat]             = useState(null);

  const expByCat = useMemo(() => {
    const { month, year } = { month: data.selectedMonth, year: data.selectedYear };
    return data.transactions
      .filter(t => { const p = parseDateParts(t.date); return t.type==='gasto' && p.month===month && p.year===year; })
      .reduce((acc, t) => { acc[t.category]=(acc[t.category]||0)+t.amount; return acc; }, {});
  }, [data.transactions, data.selectedMonth, data.selectedYear]);

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
    if (cats[key]) { Alert.alert('Ya existe', `La categoría "${key}" ya está creada.`); return; }
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
    if (editCat.newName && editCat.newName.trim() && editCat.newName !== editCat.key) {
      const newKey = editCat.newName.trim();
      nc[newKey] = editCat.icon; delete nc[editCat.key];
      const budgets = data.budgets.map(b => b.cat===editCat.key ? { ...b, cat:newKey } : b);
      const transactions = data.transactions.map(t => t.category===editCat.key ? { ...t, category:newKey } : t);
      onSave({ ...data, categories:nc, budgets, transactions });
    } else {
      nc[editCat.key] = editCat.icon;
      onSave({ ...data, categories:nc });
    }
    setEditCat(null);
  };

  const allCats = Array.from(new Set([
    ...Object.keys(cats),
    ...data.budgets.filter(b => b.limit > 0).map(b => b.cat),
  ]));

  return (
    <View style={{ flex:1 }}>
      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:100 }} showsVerticalScrollIndicator={false}>
        {allCats.length === 0
          ? <EmptyState icon="🏷️" title="Sin categorías" subtitle="Agregá una categoría para organizar tus gastos" actionLabel="+ Nueva categoría" onAction={() => setCatModal(true)}/>
          : allCats.map(cat => {
              const b = data.budgets.find(x => x.cat === cat) || { cat, limit: 0 };
              const spent = expByCat[cat] || 0;
              const rawPct = b.limit > 0 ? (spent/b.limit)*100 : 0;
              const pct    = Math.min(rawPct, 100);
              const over   = b.limit > 0 && spent > b.limit;
              const warn   = b.limit > 0 && rawPct >= 80 && !over;
              const barColor = over ? C.red : warn ? '#F97316' : C.accent;
              return (
                <Card key={cat} style={{ marginBottom:12 }}>
                  <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:b.limit > 0 ? 10 : 0 }}>
                    <TouchableOpacity onPress={() => setEditCat({ key:cat, icon:cats[cat]||'📦', newName:cat })} style={{ flex:1 }}>
                      <Text style={{ fontSize:14, fontWeight:'700', color:C.text }}>{cats[cat]||'📦'} {cat} ✏️</Text>
                    </TouchableOpacity>
                    <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                      <View style={{ alignItems:'flex-end' }}>
                        {b.limit > 0 && (
                          <Text style={{ fontSize:11, color:C.textMuted }}>{fmt(spent)} / {editing[cat] ? null : fmt(b.limit)}</Text>
                        )}
                        {b.limit > 0 && (
                          <Text style={{ fontSize:10, fontWeight:'700', color: over ? C.red : warn ? '#F97316' : C.textMuted }}>
                            {over ? `⚠ ${rawPct.toFixed(0)}% — superado` : warn ? `⚠ ${rawPct.toFixed(0)}%` : `${rawPct.toFixed(0)}%`}
                          </Text>
                        )}
                      </View>
                      {editing[cat]
                        ? <TextInput
                            style={{ borderWidth:1, borderColor:C.border, borderRadius:8, padding:4, width:90, fontSize:13, color:C.text, textAlign:'right', backgroundColor:C.surface2 }}
                            value={editingValues[cat] ?? fmtAmt(b.limit.toString())}
                            onChangeText={v => setEditingValues(ev => ({ ...ev, [cat]:fmtAmt(v) }))}
                            keyboardType="numeric" autoFocus
                            onBlur={() => {
                              updateLimit(cat, editingValues[cat] ?? b.limit.toString());
                              setEditing(ed => ({ ...ed, [cat]:false }));
                              setEditingValues(ev => { const n={...ev}; delete n[cat]; return n; });
                            }}
                          />
                        : <TouchableOpacity onPress={() => setEditing(ed => ({ ...ed, [cat]:true }))}
                            style={{ backgroundColor:C.surface2, borderRadius:8, paddingHorizontal:10, paddingVertical:5, borderWidth:1, borderColor:C.border }}>
                            <Text style={{ fontSize:11, color:C.accent, fontWeight:'700' }}>{b.limit > 0 ? '$ Editar' : '$ Límite'}</Text>
                          </TouchableOpacity>
                      }
                      <TouchableOpacity onPress={() => deleteCategory(cat)}>
                        <Text style={{ fontSize:16, color:C.red }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  {b.limit > 0 && (
                    <View style={{ backgroundColor:C.surface2, borderRadius:99, height:8 }}>
                      <View style={{ backgroundColor:barColor, height:8, borderRadius:99, width:`${pct}%` }}/>
                    </View>
                  )}
                </Card>
              );
            })
        }
      </ScrollView>

      <FAB onPress={() => setCatModal(true)}/>

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
    </View>
  );
}
