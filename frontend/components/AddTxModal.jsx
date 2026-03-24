import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { useC } from '../lib/theme';
import { parseAmt, DEFAULT_CATEGORIES } from '../lib/constants';
import { ModalSheet, Chip, Btn, Input, FieldError, EmptyState } from './ui';

export default function AddTxModal({ visible, onClose, data, onSave, editTx }) {
  const C = useC();
  const isEditing = !!editTx;
  const TYPES = [
    { key:'gasto', label:'Gasto' }, { key:'ingreso', label:'Ingreso' },
    { key:'sueldo', label:'Sueldo 💼' }, { key:'ahorro_meta', label:'Ahorro 🐷' },
  ];
  const emptyForm = { type:'gasto', description:'', amount:'', category:'', date: new Date().toISOString().split('T')[0], savingsId:'' };
  const [form, setForm]             = useState(emptyForm);
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [errors, setErrors]         = useState({});

  useEffect(() => {
    if (editTx) { setForm({ ...editTx, amount: String(editTx.amount) }); }
    else { setForm(emptyForm); setShowNewCat(false); setNewCatName(''); }
  }, [editTx, visible]);

  const addNewCategory = () => {
    if (!newCatName.trim()) return;
    const currentCats = data.categories || DEFAULT_CATEGORIES;
    const newCats = { ...currentCats, [newCatName.trim()]: '📦' };
    onSave({ ...data, categories: newCats });
    setForm(f => ({ ...f, category: newCatName.trim() }));
    setNewCatName('');
    setShowNewCat(false);
  };

  const saveTx = () => {
    const errs = {};
    if (!form.description.trim()) errs.description = 'Ingresá una descripción';
    if (!form.amount || parseAmt(form.amount) <= 0) errs.amount = 'Ingresá un monto válido';
    if ((form.type==='gasto'||form.type==='ingreso') && !form.category) errs.category = 'Seleccioná una categoría';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    const amt = parseAmt(form.amount);
    let newData = { ...data };
    if (isEditing) {
      newData = { ...newData, transactions: newData.transactions.map(t => t.id===editTx.id ? { ...form, amount:amt } : t) };
    } else {
      const tx = { ...form, id: Date.now().toString(), amount:amt };
      if (form.type==='ahorro_meta' && form.savingsId) {
        const savings = data.savings.map(sv =>
          sv.id===form.savingsId
            ? { ...sv, current:(sv.current||0)+amt, history:[...(sv.history||[]), { date:form.date, amount:amt }] }
            : sv
        );
        newData = { ...newData, savings };
      }
      newData = { ...newData, transactions:[...newData.transactions, tx] };
    }
    onSave(newData);
    onClose();
    setForm(emptyForm);
  };

  const needsCategory = form.type==='gasto' || form.type==='ingreso';
  const currentCats = data.categories || DEFAULT_CATEGORIES;

  return (
    <ModalSheet visible={visible} onClose={onClose} title={isEditing ? 'Editar movimiento' : 'Nuevo movimiento'}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:16 }}>
          {TYPES.map(t => (
            <Chip key={t.key} label={t.label} active={form.type===t.key}
              onPress={() => setForm(f => ({ ...f, type:t.key, category:'' }))} style={{ marginRight:8 }}/>
          ))}
        </ScrollView>

        <Input label="Monto" value={form.amount} onChangeText={v => { setForm(f => ({ ...f, amount:v })); if (errors.amount) setErrors(e => ({ ...e, amount:null })); }} placeholder="0" keyboardType="numeric" prefix="$" error={errors.amount}/>

        {form.type !== 'presupuesto' && (
          <Input label="Descripción" value={form.description} onChangeText={v => { setForm(f => ({ ...f, description:v })); if (errors.description) setErrors(e => ({ ...e, description:null })); }} placeholder="Ej: Supermercado, Netflix..." error={errors.description}/>
        )}

        {needsCategory && (
          <>
            <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Categoría *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: showNewCat ? 8 : 4 }}>
              {Object.entries(currentCats).map(([cat,icon]) => (
                <Chip key={cat} label={`${icon} ${cat}`} active={form.category===cat}
                  onPress={() => { setForm(f => ({ ...f, category:cat })); if (errors.category) setErrors(e => ({ ...e, category:null })); }} style={{ marginRight:8 }}/>
              ))}
              <Chip label="+ Nueva" active={showNewCat} onPress={() => setShowNewCat(s => !s)} style={{ marginRight:8 }}/>
            </ScrollView>
            <FieldError error={errors.category}/>
            {showNewCat && (
              <View style={{ flexDirection:'row', gap:8, marginBottom:14 }}>
                <TextInput
                  style={{ flex:1, backgroundColor:C.surface2, borderRadius:12, paddingHorizontal:14, paddingVertical:10, fontSize:14, color:C.text }}
                  placeholder="Nombre de categoría"
                  placeholderTextColor={C.textMuted}
                  value={newCatName}
                  onChangeText={setNewCatName}
                />
                <TouchableOpacity onPress={addNewCategory}
                  style={{ backgroundColor:C.accent, borderRadius:12, paddingHorizontal:16, alignItems:'center', justifyContent:'center', borderWidth:1, borderColor:C.gold }}>
                  <Text style={{ color:'#fff', fontWeight:'700', fontSize:13 }}>Agregar</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {form.type==='ahorro_meta' && (
          <>
            <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Meta de ahorro</Text>
            {data.savings.length===0
              ? <EmptyState icon="🐷" title="Sin metas de ahorro" subtitle="Creá una desde el panel de Ahorros"/>
              : <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:14 }}>
                  {data.savings.map(sv => (
                    <Chip key={sv.id} label={`🐷 ${sv.name}`} active={form.savingsId===sv.id}
                      onPress={() => setForm(f => ({ ...f, savingsId:sv.id }))} style={{ marginRight:8 }}/>
                  ))}
                </ScrollView>
            }
          </>
        )}

        <View style={{ flexDirection:'row', gap:10, marginTop:4 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={onClose}/>
          <Btn label="Guardar" style={{ flex:1 }} onPress={saveTx}/>
        </View>
      </ScrollView>
    </ModalSheet>
  );
}
