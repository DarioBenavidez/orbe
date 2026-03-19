import React from 'react';
import {
  View, Text, TouchableOpacity, TextInput,
  Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useC } from '../lib/theme';
import { fmt, fmtAmt } from '../lib/constants';

export function Card({ children, style }) {
  const C = useC();
  return (
    <View style={[{
      backgroundColor: C.surface, borderRadius: 20, padding: 18,
      shadowColor: C.dark ? '#000' : '#005247',
      shadowOffset: { width:0, height:6 },
      shadowOpacity: C.dark ? 0.5 : 0.12, shadowRadius: 20,
      elevation: 8, borderWidth: 1, borderColor: C.border,
    }, style]}>
      {children}
    </View>
  );
}

export function Btn({ label, onPress, variant = 'primary', style, disabled }) {
  const C = useC();
  const bg    = variant==='primary' ? C.accent : variant==='danger' ? C.redLight : C.surface2;
  const color = variant==='primary' ? '#fff'   : variant==='danger' ? C.red      : C.textMuted;
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled}
      style={[{ borderRadius:16, padding:15, alignItems:'center', backgroundColor:bg,
        opacity: disabled ? 0.5 : 1,
        borderWidth: 1, borderColor: variant==='primary' ? C.gold : C.border,
      }, style]}>
      <Text style={{ fontSize:14, fontWeight:'700', color, letterSpacing:0.2 }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Input({ label, value, onChangeText, placeholder, keyboardType, prefix, multiline, secureTextEntry }) {
  const C = useC();
  const isAmount = prefix === '$';
  const handleChange = (raw) => {
    if (isAmount) {
      onChangeText(fmtAmt(raw));
    } else {
      onChangeText(raw);
    }
  };
  return (
    <View style={{ marginBottom:14 }}>
      {label ? <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>{label}</Text> : null}
      <View style={{ flexDirection:'row', alignItems:'center', backgroundColor:C.surface2, borderWidth:1, borderColor:C.border, borderRadius:16 }}>
        {prefix ? <Text style={{ paddingLeft:14, paddingRight:4, color:C.textMuted, fontSize:15 }}>{prefix}</Text> : null}
        <TextInput
          style={{
            flex:1, padding:14, paddingLeft: prefix ? 4 : 14,
            fontSize:14, color:C.text,
            ...(multiline ? { minHeight:80, textAlignVertical:'top' } : {}),
          }}
          value={value} onChangeText={handleChange}
          placeholder={placeholder} placeholderTextColor={C.textDim}
          keyboardType={isAmount ? 'numeric' : (keyboardType||'default')} multiline={multiline}
          secureTextEntry={secureTextEntry}
        />
      </View>
    </View>
  );
}

export function Chip({ label, active, onPress, style }) {
  const C = useC();
  return (
    <TouchableOpacity onPress={onPress} style={[{
      paddingHorizontal:15, paddingVertical:8, borderRadius:99,
      backgroundColor: active ? C.accent : C.surface2,
      borderWidth:1, borderColor: active ? C.gold : C.border,
    }, style]}>
      <Text style={{ fontSize:12, fontWeight:'700', color: active ? '#fff' : C.textMuted, letterSpacing:0.1 }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function IconCircle({ icon, bg, size = 46 }) {
  return (
    <View style={{ width:size, height:size, borderRadius:size/2, backgroundColor:bg, alignItems:'center', justifyContent:'center' }}>
      <Text style={{ fontSize:size * 0.42 }}>{icon}</Text>
    </View>
  );
}

export function SubTabs({ tabs, active, onChange }) {
  const C = useC();
  return (
    <View style={{ flexDirection:'row', backgroundColor:C.surface2, borderRadius:16, padding:4 }}>
      {tabs.map(t => (
        <TouchableOpacity key={t.key} onPress={() => onChange(t.key)}
          style={{
            flex:1, paddingVertical:10, borderRadius:12, alignItems:'center',
            backgroundColor: active===t.key ? C.accent : 'transparent',
            borderWidth: active===t.key ? 1 : 0, borderColor: C.gold,
          }}>
          <Text style={{ fontSize:12, fontWeight:'700', color: active===t.key ? '#fff' : C.textMuted }}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function ModalSheet({ visible, onClose, title, children }) {
  const C = useC();
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{ flex:1 }}>
        <View style={{ flex:1, backgroundColor:'#00000066', justifyContent:'flex-end' }}>
          <View style={{
            backgroundColor:C.surface, borderTopLeftRadius:32, borderTopRightRadius:32,
            padding:24, paddingBottom:40, maxHeight:'90%',
            borderTopWidth:1, borderColor:C.border,
          }}>
            <View style={{ width:36, height:4, backgroundColor:C.border, borderRadius:2, alignSelf:'center', marginBottom:20 }}/>
            {title && <Text style={{ fontSize:19, fontWeight:'800', color:C.text, marginBottom:20, letterSpacing:-0.3 }}>{title}</Text>}
            {children}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function FAB({ onPress }) {
  const C = useC();
  return (
    <TouchableOpacity onPress={onPress} style={{
      position:'absolute', bottom:28, right:20, width:56, height:56, borderRadius:28,
      backgroundColor:C.accent, alignItems:'center', justifyContent:'center',
      borderWidth:1, borderColor:C.gold,
      shadowColor: C.gold, shadowOffset:{width:0,height:8}, shadowOpacity:0.4, shadowRadius:18, elevation:10,
    }}>
      <Text style={{ color:'#fff', fontSize:28, lineHeight:32, fontWeight:'300' }}>+</Text>
    </TouchableOpacity>
  );
}

export function TxRow({ tx, cats, onDelete, onEdit }) {
  const C = useC();
  const isGasto  = tx.type === 'gasto';
  const isIncome = tx.type === 'ingreso' || tx.type === 'sueldo';
  const icon     = tx.type==='sueldo' ? '💼' : tx.type==='ahorro_meta' ? '🐷' : (cats[tx.category]||'📦');
  const iconBg   = isGasto ? C.red+'18' : isIncome ? C.green+'18' : C.accent+'18';
  const catLabel = tx.type==='sueldo' ? 'Sueldo' : tx.type==='ahorro_meta' ? 'Ahorro' : tx.category;
  return (
    <View style={{ flexDirection:'row', alignItems:'center', paddingVertical:13, borderBottomWidth:1, borderBottomColor:C.border }}>
      <IconCircle icon={icon} bg={iconBg} size={42}/>
      <View style={{ flex:1, marginLeft:13 }}>
        <Text style={{ fontSize:14, fontWeight:'600', color:C.text, letterSpacing:-0.2 }}>{tx.description}</Text>
        <Text style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>{catLabel} · {tx.date}</Text>
      </View>
      <View style={{ alignItems:'flex-end' }}>
        <Text style={{ fontSize:15, fontWeight:'700', color: isGasto ? C.red : C.green, letterSpacing:-0.3 }}>
          {isGasto ? '-' : '+'}{fmt(tx.amount)}
        </Text>
        <View style={{ flexDirection:'row', gap:12, marginTop:3 }}>
          {onEdit && (
            <TouchableOpacity onPress={() => onEdit(tx)}>
              <Text style={{ fontSize:10, color:C.accent, fontWeight:'600' }}>Editar</Text>
            </TouchableOpacity>
          )}
          {onDelete && (
            <TouchableOpacity onPress={() => onDelete(tx.id)}>
              <Text style={{ fontSize:10, color:C.textMuted }}>Eliminar</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

export function BarChart({ data }) {
  const C = useC();
  if (!data || data.length === 0) return null;
  const maxVal = Math.max(...data.map(d => Math.max(d.income||0, d.expense||0)), 1);
  const BAR_H = 110;
  return (
    <View style={{ flexDirection:'row', alignItems:'flex-end', gap:6, paddingTop:8 }}>
      {data.map((d, i) => (
        <View key={i} style={{ flex:1, alignItems:'center' }}>
          <View style={{ flexDirection:'row', alignItems:'flex-end', gap:2, height:BAR_H }}>
            <View style={{ flex:1, backgroundColor:C.green, borderRadius:6, height: Math.max(4, (d.income/maxVal)*BAR_H), opacity:0.9 }}/>
            <View style={{ flex:1, backgroundColor:C.red, borderRadius:6, height: Math.max(4, (d.expense/maxVal)*BAR_H), opacity:0.8 }}/>
          </View>
          <Text style={{ fontSize:9, color:C.textMuted, marginTop:4 }}>{d.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function ScreenWithHeader({ header, children }) {
  const C = useC();
  return (
    <View style={{ flex:1, backgroundColor:C.header }}>
      <View style={{ paddingTop:56, paddingHorizontal:22, paddingBottom:30 }}>
        {header}
      </View>
      <View style={{ flex:1, backgroundColor:C.bg, borderTopLeftRadius:32, borderTopRightRadius:32, overflow:'hidden', borderTopWidth:1, borderColor:C.gold }}>
        {children}
      </View>
    </View>
  );
}
