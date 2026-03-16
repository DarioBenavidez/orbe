
import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  Modal, ActivityIndicator, Alert, Platform,
  KeyboardAvoidingView, Switch, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome5 } from '@expo/vector-icons';
import { loadData, saveData, supabase, BACKEND_URL } from '../constants/supabase';


// ── Theme ─────────────────────────────────────────────────────
const ThemeCtx = createContext(null);
const useC = () => useContext(ThemeCtx);

const mkTheme = (dark) => ({
  bg:          dark ? '#0A1A17' : '#F2F7F5',
  surface:     dark ? '#112620' : '#FFFFFF',
  surface2:    dark ? '#1A3329' : '#E6F0EC',
  border:      dark ? '#1E3D30' : '#C8DDD6',
  accent:      '#005247',
  accentLight: dark ? '#0D2B23' : '#D6EDE7',
  gold:        '#C9A84C',
  goldLight:   '#E8C97A',
  text:        dark ? '#FFFFFF' : '#0D1F1C',
  textMuted:   dark ? '#A8C4BC' : '#4A6B62',
  textDim:     dark ? '#1E3D30' : '#B8D0C8',
  red:         dark ? '#F87171' : '#F43F5E',
  redLight:    dark ? '#1F1020' : '#FFF1F6',
  blue:        dark ? '#60A5FA' : '#3B82F6',
  green:       dark ? '#4ADE80' : '#059669',
  header:      '#005247',
  tab:         dark ? '#112620' : '#FFFFFF',
  dark,
});

// ── Constants ──────────────────────────────────────────────────
const DEFAULT_CATEGORIES = {
  'Vivienda':'🏠','Alimentación':'🛒','Transporte':'🚗','Salud':'💊',
  'Entretenimiento':'🎬','Ropa':'👗','Educación':'📚','Servicios':'💡',
  'Préstamo tarjeta':'💳','Otros':'📦',
};
const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MONTH_FULL  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const EVENT_TYPES = [
  { key:'vencimiento', label:'Vencimiento 📋', color:'#e53935' },
  { key:'pago',        label:'Pago 💳',        color:'#4aba82' },
  { key:'recordatorio',label:'Recordatorio 🔔', color:'#2e9960' },
];
const cMonth = new Date().getMonth();
const cYear  = new Date().getFullYear();

const fmt = (n) => {
  const abs = Math.abs(Number(n));
  return (n < 0 ? '-$' : '$') + abs.toLocaleString('es-AR', { maximumFractionDigits: 0 });
};
const parseDateParts = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
};
const defaultData = () => ({
  transactions: [],
  budgets: Object.keys(DEFAULT_CATEGORIES).map(cat => ({ cat, limit: 0 })),
  categories: DEFAULT_CATEGORIES,
  savings: [],
  debts: [],
  events: [],
  selectedMonth: cMonth,
  selectedYear: cYear,
});

// ── Notification helpers ───────────────────────────────────────

// ── UI Primitives ──────────────────────────────────────────────

function Card({ children, style }) {
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

function Btn({ label, onPress, variant = 'primary', style, disabled }) {
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

function Input({ label, value, onChangeText, placeholder, keyboardType, prefix, multiline, secureTextEntry }) {
  const C = useC();
  return (
    <View style={{ marginBottom:14 }}>
      {label ? <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>{label}</Text> : null}
      <View style={{ flexDirection:'row', alignItems:'center' }}>
        {prefix ? <Text style={{ position:'absolute', left:14, color:C.textMuted, zIndex:1, fontSize:15 }}>{prefix}</Text> : null}
        <TextInput
          style={{
            flex:1, backgroundColor:C.surface2, borderWidth:1, borderColor:C.border,
            borderRadius:16, padding:14, fontSize:14, color:C.text,
            paddingLeft: prefix ? 28 : 14,
            ...(multiline ? { minHeight:80, textAlignVertical:'top' } : {}),
          }}
          value={value} onChangeText={onChangeText}
          placeholder={placeholder} placeholderTextColor={C.textDim}
          keyboardType={keyboardType||'default'} multiline={multiline}
          secureTextEntry={secureTextEntry}
        />
      </View>
    </View>
  );
}

function Chip({ label, active, onPress, style }) {
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

function IconCircle({ icon, bg, size = 46 }) {
  return (
    <View style={{ width:size, height:size, borderRadius:size/2, backgroundColor:bg, alignItems:'center', justifyContent:'center' }}>
      <Text style={{ fontSize:size * 0.42 }}>{icon}</Text>
    </View>
  );
}

function SubTabs({ tabs, active, onChange }) {
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

function ModalSheet({ visible, onClose, title, children }) {
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

function FAB({ onPress }) {
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

// ── Transaction Row ────────────────────────────────────────────
function TxRow({ tx, cats, onDelete, onEdit }) {
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

// ── Bar Chart (custom, no library) ────────────────────────────
function BarChart({ data }) {
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

// ── Screen layout helper ───────────────────────────────────────
function ScreenWithHeader({ header, children }) {
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

// ── Inicio Tab ─────────────────────────────────────────────────
function InicioTab({ data, onSave, onMonthPress, nombre, onOpenPanel }) {
  const C = useC();
  const [txFilter, setTxFilter] = useState('mes');
  const txs = data.transactions.filter(t => {
    const { month, year } = parseDateParts(t.date);
    return month === data.selectedMonth && year === data.selectedYear;
  });

  const filteredTxs = (() => {
    if (txFilter === 'semana') {
      const now = new Date();
      const day = now.getDay() === 0 ? 6 : now.getDay() - 1; // Monday=0
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
    return txs; // 'mes'
  })();
  const totalIncome  = txs.filter(t => t.type==='ingreso'||t.type==='sueldo').reduce((a,t) => a+t.amount, 0);
  const totalExpense = txs.filter(t => t.type==='gasto').reduce((a,t) => a+t.amount, 0);
  const totalBudget  = data.budgets.reduce((s,b) => s+b.limit, 0);
  const pct          = totalBudget > 0 ? Math.min((totalExpense/totalBudget)*100, 100) : 0;
  const balance      = totalIncome - totalExpense;
  const cats         = data.categories || DEFAULT_CATEGORIES;
  const today        = new Date().getDate();
  const isCurrentMonth = data.selectedMonth === cMonth && data.selectedYear === cYear;
  const upcoming     = isCurrentMonth
    ? (data.events||[]).filter(ev => ev.day>=today && ev.day<=today+7).sort((a,b) => a.day-b.day).slice(0,3)
    : [];
  const totalSavings = data.savings.reduce((a,sv) => a+(sv.current||0), 0);
  const totalDebt    = data.debts.reduce((a,d) => a+(d.remaining||0), 0);

  const turnos = (data.turnos || []);
  const today2 = new Date();
  const todayStr = today2.toISOString().split('T')[0];
  const upcomingTurnos = turnos
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
        {/* Module strip */}
        <View style={{ marginBottom:16, position:'relative' }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal:16 }}>
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
            style={{ position:'absolute', left:0, top:0, bottom:0, width:24, pointerEvents:'none' }}
          />
          <LinearGradient
            colors={['transparent', C.bg]}
            start={{ x:0, y:0 }} end={{ x:1, y:0 }}
            style={{ position:'absolute', right:0, top:0, bottom:0, width:24, pointerEvents:'none' }}
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
            ? <Text style={{ color:C.textDim, fontSize:13, textAlign:'center', paddingVertical:24 }}>Sin transacciones</Text>
            : filteredTxs.slice().reverse().slice(0,20).map(t => <TxRow key={t.id} tx={t} cats={cats} onDelete={id => Alert.alert('Eliminar','¿Eliminar esta transacción?',[{text:'Cancelar'},{text:'Eliminar',style:'destructive',onPress:()=>onSave({...data,transactions:data.transactions.filter(t=>t.id!==id)})}])}/>)
          }
        </Card>
      </ScrollView>
    </ScreenWithHeader>
  );
}

// ── Análisis Tab ───────────────────────────────────────────────
function AnalisisTab({ data, onSave }) {
  const C = useC();
  const cats = data.categories || DEFAULT_CATEGORIES;
  const txs  = data.transactions.filter(t => {
    const { month, year } = parseDateParts(t.date);
    return month===data.selectedMonth && year===data.selectedYear;
  });
  const totalIncome  = txs.filter(t => t.type==='ingreso'||t.type==='sueldo').reduce((a,t) => a+t.amount, 0);
  const totalExpense = txs.filter(t => t.type==='gasto').reduce((a,t) => a+t.amount, 0);
  const expByCat     = txs.filter(t => t.type==='gasto').reduce((acc,t) => { acc[t.category]=(acc[t.category]||0)+t.amount; return acc; }, {});
  const topGastos    = Object.entries(expByCat).sort((a,b) => b[1]-a[1]).slice(0,5);
  const maxG         = topGastos[0]?.[1] || 1;

  // Budget editing
  const [editing, setEditing]       = useState({});
  const [editingValues, setEditingValues] = useState({});
  const [catModal, setCatModal] = useState(false);
  const [catForm, setCatForm]   = useState({ icon:'📦', name:'' });
  const [editCat, setEditCat]   = useState(null);
  const ICON_OPTIONS = ['🏠','🛒','🚗','💊','🎬','👗','📚','💡','💳','📦','🍕','✈️','🐾','🏋️','🎮','💈','🌿','🎁','🏖️','💰'];

  const updateLimit = (cat, val) => {
    const limit = parseFloat(val) || 0;
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
  const deleteCategory = (cat) => Alert.alert('Eliminar categoría',`¿Eliminar "${cat}"?`,[
    { text:'Cancelar' },
    { text:'Eliminar', style:'destructive', onPress: () => {
      const nc = {...cats}; delete nc[cat];
      onSave({ ...data, categories:nc, budgets:data.budgets.filter(b => b.cat!==cat) });
    }},
  ]);
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

  // Chart: last 6 months
  const chartData = Array.from({ length:6 }, (_, i) => {
    let m = data.selectedMonth - (5-i); let y = data.selectedYear;
    if (m < 0) { m += 12; y--; }
    const mTxs = data.transactions.filter(t => { const { month, year } = parseDateParts(t.date); return month===m && year===y; });
    return {
      label: MONTH_NAMES[m],
      income:  mTxs.filter(t => t.type==='ingreso'||t.type==='sueldo').reduce((a,t) => a+t.amount, 0),
      expense: mTxs.filter(t => t.type==='gasto').reduce((a,t) => a+t.amount, 0),
    };
  });

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
        {/* Bar chart */}
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

        {/* Top gastos */}
        <Card style={{ marginBottom:14 }}>
          <Text style={{ fontSize:15, fontWeight:'700', color:C.text, marginBottom:14 }}>Top gastos</Text>
          {topGastos.length === 0
            ? <Text style={{ color:C.textDim, fontSize:13, textAlign:'center', paddingVertical:16 }}>Sin gastos este mes</Text>
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

        {/* Budget per category */}
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
            const pct   = b.limit > 0 ? Math.min((spent/b.limit)*100, 100) : 0;
            const over  = b.limit > 0 && spent > b.limit;
            return (
              <View key={b.cat} style={{ marginBottom:14 }}>
                <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                  <TouchableOpacity onPress={() => setEditCat({ key:b.cat, icon:cats[b.cat]||'📦', newName:b.cat })} style={{ flex:1 }}>
                    <Text style={{ fontSize:13, color:C.text }}>{cats[b.cat]||'📦'} {b.cat} ✏️</Text>
                  </TouchableOpacity>
                  <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                    <Text style={{ fontSize:11, color:C.textMuted }}>{fmt(spent)} /</Text>
                    {editing[b.cat]
                      ? <TextInput
                          style={{ borderWidth:1, borderColor:C.border, borderRadius:8, padding:4, width:80, fontSize:13, color:C.text, textAlign:'right', backgroundColor:C.surface2 }}
                          value={editingValues[b.cat] ?? b.limit.toString()}
                          onChangeText={v => setEditingValues(ev => ({ ...ev, [b.cat]:v }))}
                          keyboardType="numeric" autoFocus
                          onBlur={() => {
                            updateLimit(b.cat, editingValues[b.cat] ?? b.limit.toString());
                            setEditing(ed => ({ ...ed, [b.cat]:false }));
                            setEditingValues(ev => { const n={...ev}; delete n[b.cat]; return n; });
                          }}
                        />
                      : <TouchableOpacity onPress={() => setEditing(ed => ({ ...ed, [b.cat]:true }))}>
                          <Text style={{ fontSize:13, color:C.accent, fontWeight:'600' }}>{fmt(b.limit)} ✏️</Text>
                        </TouchableOpacity>
                    }
                    <TouchableOpacity onPress={() => deleteCategory(b.cat)}>
                      <Text style={{ fontSize:13, color:C.red }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {b.limit > 0 && (
                  <View style={{ backgroundColor:C.surface2, borderRadius:99, height:6 }}>
                    <View style={{ backgroundColor:over?C.red:C.accent, height:6, borderRadius:99, width:`${pct}%` }}/>
                  </View>
                )}
              </View>
            );
          })}
        </Card>
      </ScrollView>

      {/* New category modal */}
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

      {/* Edit category modal */}
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

// ── Transacciones Tab ──────────────────────────────────────────
function TransaccionesTab({ data, onSave, onAdd }) {
  const C = useC();
  const cats = data.categories || DEFAULT_CATEGORIES;
  const [editingTx, setEditingTx] = useState(null);
  const txs  = data.transactions.filter(t => {
    const { month, year } = parseDateParts(t.date);
    return month===data.selectedMonth && year===data.selectedYear;
  }).slice().reverse();
  const delTx = (id) => Alert.alert('Eliminar','¿Eliminar esta transacción?',[
    { text:'Cancelar' },
    { text:'Eliminar', style:'destructive', onPress: () => onSave({ ...data, transactions:data.transactions.filter(t => t.id!==id) }) },
  ]);
  return (
    <ScreenWithHeader header={
      <>
        <Text style={{ fontSize:13, color:'#ffffff70', fontWeight:'600', letterSpacing:0.3, marginBottom:2 }}>{MONTH_FULL[data.selectedMonth]} {data.selectedYear}</Text>
        <Text style={{ fontSize:24, fontWeight:'800', color:'#fff', letterSpacing:-0.7 }}>Transacciones</Text>
      </>
    }>
      <View style={{ flex:1 }}>
        <ScrollView contentContainerStyle={{ padding:16, paddingBottom:100 }} showsVerticalScrollIndicator={false}>
          <Card style={{ marginBottom:32 }}>
            {txs.length === 0
              ? <Text style={{ color:C.textDim, fontSize:13, textAlign:'center', paddingVertical:24 }}>Sin transacciones este mes</Text>
              : txs.map(t => <TxRow key={t.id} tx={t} cats={cats} onDelete={delTx} onEdit={setEditingTx}/>)
            }
          </Card>
        </ScrollView>
        <FAB onPress={onAdd}/>
      </View>
      <AddTxModal
        visible={!!editingTx}
        onClose={() => setEditingTx(null)}
        data={data}
        onSave={onSave}
        editTx={editingTx}
      />
    </ScreenWithHeader>
  );
}

// ── Add Transaction Modal ──────────────────────────────────────
function AddTxModal({ visible, onClose, data, onSave, editTx }) {
  const C = useC();
  const isEditing = !!editTx;
  const TYPES = [
    { key:'gasto', label:'Gasto' }, { key:'ingreso', label:'Ingreso' },
    { key:'sueldo', label:'Sueldo 💼' }, { key:'ahorro_meta', label:'Ahorro 🐷' },
    { key:'presupuesto', label:'Presupuesto' },
  ];
  const emptyForm = { type:'gasto', description:'', amount:'', category:'', date: new Date().toISOString().split('T')[0], savingsId:'' };
  const [form, setForm] = useState(emptyForm);
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');

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
    if (form.type === 'presupuesto') {
      if (!form.category) return Alert.alert('Categoría requerida', 'Seleccioná una categoría para el presupuesto');
      if (!form.amount || parseFloat(form.amount) <= 0) return Alert.alert('Error', 'Ingresá un monto válido');
      const amt = parseFloat(form.amount);
      const existingBudgets = data.budgets || [];
      const updated = existingBudgets.some(b => b.cat === form.category)
        ? existingBudgets.map(b => b.cat === form.category ? { ...b, limit: amt } : b)
        : [...existingBudgets, { cat: form.category, limit: amt }];
      onSave({ ...data, budgets: updated });
      onClose();
      setForm(emptyForm);
      return;
    }
    if (!form.description.trim()) return Alert.alert('Error', 'Ingresá una descripción');
    if (!form.amount || parseFloat(form.amount) <= 0) return Alert.alert('Error', 'Ingresá un monto válido');
    if ((form.type==='gasto'||form.type==='ingreso') && !form.category) return Alert.alert('Categoría requerida', 'Seleccioná una categoría para continuar');
    const amt = parseFloat(form.amount);
    let newData = { ...data };
    if (isEditing) {
      newData = { ...newData, transactions: newData.transactions.map(t => t.id===editTx.id ? { ...form, amount:amt } : t) };
    } else {
      const tx = { ...form, id:Date.now().toString(), amount:amt };
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

  const needsCategory = form.type==='gasto' || form.type==='ingreso' || form.type==='presupuesto';
  const currentCats = data.categories || DEFAULT_CATEGORIES;

  return (
    <ModalSheet visible={visible} onClose={onClose} title={isEditing ? 'Editar movimiento' : 'Nuevo movimiento'}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Type chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:16 }}>
          {TYPES.map(t => (
            <Chip key={t.key} label={t.label} active={form.type===t.key}
              onPress={() => setForm(f => ({ ...f, type:t.key, category:'' }))} style={{ marginRight:8 }}/>
          ))}
        </ScrollView>

        {/* Amount - big and prominent */}
        <Input label="Monto" value={form.amount} onChangeText={v => setForm(f => ({ ...f, amount:v }))} placeholder="0" keyboardType="numeric" prefix="$"/>

        {/* Description */}
        {form.type !== 'presupuesto' && (
          <Input label="Descripción" value={form.description} onChangeText={v => setForm(f => ({ ...f, description:v }))} placeholder="Ej: Supermercado, Netflix..."/>
        )}

        {/* Category - only for gasto/ingreso, MANDATORY */}
        {needsCategory && (
          <>
            <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Categoría *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: showNewCat ? 8 : 14 }}>
              {Object.entries(currentCats).map(([cat,icon]) => (
                <Chip key={cat} label={`${icon} ${cat}`} active={form.category===cat}
                  onPress={() => setForm(f => ({ ...f, category:cat }))} style={{ marginRight:8 }}/>
              ))}
              {form.type !== 'presupuesto' && (
                <Chip label="+ Nueva" active={showNewCat} onPress={() => setShowNewCat(s => !s)} style={{ marginRight:8 }}/>
              )}
            </ScrollView>
            {showNewCat && form.type !== 'presupuesto' && (
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

        {/* Savings selector */}
        {form.type==='ahorro_meta' && (
          <>
            <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Meta de ahorro</Text>
            {data.savings.length===0
              ? <Text style={{ color:C.textMuted, fontSize:13, marginBottom:14 }}>Primero creá una meta de ahorro.</Text>
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

// ── Ahorros ────────────────────────────────────────────────────
function Ahorros({ data, onSave }) {
  const C = useC();
  const [modal, setModal]         = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const emptyF = { name:'', target:'', current:'' };
  const [form, setForm]         = useState(emptyF);
  const [editForm, setEditForm] = useState(emptyF);

  const addAhorro = () => {
    if (!form.name||!form.target) return;
    onSave({ ...data, savings:[...data.savings, { ...form, id:Date.now().toString(), target:parseFloat(form.target), current:parseFloat(form.current||0), history:[] }] });
    setModal(false); setForm(emptyF);
  };
  const openEdit = (sv) => { setEditTarget(sv.id); setEditForm({ name:sv.name, target:sv.target.toString(), current:sv.current.toString() }); setEditModal(true); };
  const saveEdit = () => {
    onSave({ ...data, savings:data.savings.map(sv => sv.id===editTarget ? { ...sv, name:editForm.name, target:parseFloat(editForm.target)||sv.target, current:parseFloat(editForm.current)||0 } : sv) });
    setEditModal(false);
  };
  const delAhorro = (id) => Alert.alert('Eliminar','¿Eliminar este ahorro?',[
    { text:'Cancelar' },
    { text:'Eliminar', style:'destructive', onPress: () => onSave({ ...data, savings:data.savings.filter(sv => sv.id!==id) }) },
  ]);

  const AhorroForm = ({ frm, setFrm }) => (
    <>
      <Input label="Nombre" value={frm.name} onChangeText={v => setFrm(f => ({ ...f, name:v }))} placeholder="Ej: Vacaciones"/>
      <Input label="Meta" value={frm.target} onChangeText={v => setFrm(f => ({ ...f, target:v }))} placeholder="0" keyboardType="numeric" prefix="$"/>
      <Input label="Ya tengo" value={frm.current} onChangeText={v => setFrm(f => ({ ...f, current:v }))} placeholder="0" keyboardType="numeric" prefix="$"/>
    </>
  );

  return (
    <View style={{ flex:1 }}>
      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:100 }} showsVerticalScrollIndicator={false}>
        {data.savings.length===0
          ? <View style={{ padding:40, alignItems:'center' }}>
              <Text style={{ fontSize:48, marginBottom:12 }}>🐷</Text>
              <Text style={{ color:C.textMuted, fontSize:14, textAlign:'center' }}>No hay metas de ahorro aún</Text>
            </View>
          : data.savings.map(sv => {
              const pct = sv.target > 0 ? Math.min((sv.current/sv.target)*100, 100) : 0;
              return (
                <Card key={sv.id} style={{ marginBottom:12 }}>
                  <View style={{ flexDirection:'row', alignItems:'center', marginBottom:12 }}>
                    <IconCircle icon="🐷" bg={C.accent+'22'} size={44}/>
                    <View style={{ flex:1, marginLeft:12 }}>
                      <Text style={{ fontSize:15, fontWeight:'700', color:C.text }}>{sv.name}</Text>
                      <Text style={{ fontSize:12, color:C.textMuted }}>{fmt(sv.current)} de {fmt(sv.target)}</Text>
                    </View>
                    <View style={{ gap:4, alignItems:'flex-end' }}>
                      <TouchableOpacity onPress={() => openEdit(sv)}><Text style={{ color:C.accent, fontSize:11, fontWeight:'600' }}>Editar</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => delAhorro(sv.id)}><Text style={{ color:C.red, fontSize:11 }}>Eliminar</Text></TouchableOpacity>
                    </View>
                  </View>
                  <View style={{ backgroundColor:C.surface2, borderRadius:99, height:8, marginBottom:4 }}>
                    <View style={{ backgroundColor:C.accent, height:8, borderRadius:99, width:`${pct}%` }}/>
                  </View>
                  <Text style={{ color:C.accent, fontSize:11, textAlign:'right', fontWeight:'600' }}>{pct.toFixed(0)}%</Text>
                  {sv.history && sv.history.length>0 && (
                    <View style={{ marginTop:10, borderTopWidth:1, borderTopColor:C.border, paddingTop:8 }}>
                      <Text style={{ fontSize:9, fontWeight:'700', color:C.textMuted, letterSpacing:0.5, marginBottom:6 }}>HISTORIAL DE DEPÓSITOS</Text>
                      {sv.history.slice().reverse().slice(0,3).map((h,i) => (
                        <View key={i} style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical:2 }}>
                          <Text style={{ fontSize:11, color:C.textMuted }}>{h.date}</Text>
                          <Text style={{ fontSize:11, color:C.accent, fontWeight:'600' }}>+{fmt(h.amount)}</Text>
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
        <AhorroForm frm={form} setFrm={setForm}/>
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

// ── Deudas ─────────────────────────────────────────────────────
function Deudas({ data, onSave }) {
  const C = useC();
  const emptyF = { name:'', remaining:'', installment:'', remainingInstallments:'' };
  const [modal, setModal]         = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm]         = useState(emptyF);
  const [editForm, setEditForm] = useState(emptyF);
  const [payAmt, setPayAmt]     = useState({});

  const totalDebt       = data.debts.reduce((s,d) => s+d.remaining, 0);
  const monthlyPayments = data.debts.reduce((s,d) => s+d.installment, 0);

  const calcInst = (rem, inst) => {
    if (!rem||!inst||parseFloat(inst)===0) return '';
    return Math.ceil(parseFloat(rem)/parseFloat(inst)).toString();
  };
  const endMonth = (instStr) => {
    if (!instStr) return '';
    const n = parseInt(instStr);
    const d = new Date(); d.setMonth(d.getMonth()+n-1);
    return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  };
  const addDeuda = () => {
    if (!form.name||!form.remaining) return;
    const inst = parseFloat(form.installment)||0;
    const ri = parseInt(form.remainingInstallments)||(inst>0?Math.ceil(parseFloat(form.remaining)/inst):0);
    onSave({ ...data, debts:[...data.debts, { name:form.name, total:parseFloat(form.remaining), remaining:parseFloat(form.remaining), installment:inst, remainingInstallments:ri, id:Date.now().toString() }] });
    setModal(false); setForm(emptyF);
  };
  const openEdit = (d) => {
    setEditTarget(d.id);
    setEditForm({ name:d.name, remaining:d.remaining.toString(), installment:d.installment.toString(), remainingInstallments:d.remainingInstallments.toString() });
    setEditModal(true);
  };
  const saveEdit = () => {
    const inst = parseFloat(editForm.installment)||0;
    const ri = parseInt(editForm.remainingInstallments)||(inst>0?Math.ceil(parseFloat(editForm.remaining)/inst):0);
    onSave({ ...data, debts:data.debts.map(d => d.id===editTarget ? { ...d, name:editForm.name, remaining:parseFloat(editForm.remaining)||d.remaining, installment:inst, remainingInstallments:ri } : d) });
    setEditModal(false);
  };
  const pay = (id) => {
    const amt = parseFloat(payAmt[id]||0); if (!amt) return;
    const deuda = data.debts.find(d => d.id===id);
    const realAmt = Math.min(amt, deuda.remaining); // no registrar más de lo que se debe
    const debts = data.debts.map(d => d.id===id ? { ...d, remaining:Math.max(0,d.remaining-realAmt), remainingInstallments:Math.max(0,(d.remainingInstallments||0)-1) } : d);
    const tx = { id:Date.now().toString(), type:'gasto', description:`Pago: ${deuda.name}`, amount:realAmt, category:'Préstamo tarjeta', date:new Date().toISOString().split('T')[0] };
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
                      value={payAmt[d.id]||''} onChangeText={v => setPayAmt(p => ({ ...p, [d.id]:v }))}
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

// ── Proyección ─────────────────────────────────────────────────
function Proyeccion({ data, onSave }) {
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

  // Devuelve el ingreso efectivo para un mes/año dado, considerando overrides
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
    const amount = parseFloat(newSalary.replace(/[^0-9.]/g,''));
    if (!amount || amount <= 0) return Alert.alert('Error', 'Ingresá un monto válido');
    const newOverride = { fromMonth, fromYear, amount };
    // Reemplaza si ya existe un override para ese mismo mes/año
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

      {/* Resumen */}
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

      {/* Botón actualizar sueldo */}
      <TouchableOpacity onPress={() => setModal(true)}
        style={{ backgroundColor:C.accent, borderRadius:14, paddingVertical:13, alignItems:'center', marginBottom:16, borderWidth:1, borderColor:C.gold }}>
        <Text style={{ color:'#fff', fontWeight:'700', fontSize:14 }}>💼 Actualizar sueldo futuro</Text>
      </TouchableOpacity>

      {/* Overrides activos */}
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

      {/* Proyección 12 meses */}
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

      {/* Modal nuevo sueldo */}
      <Modal visible={modal} transparent animationType="fade">
        <KeyboardAvoidingView style={{ flex:1, backgroundColor:'#00000080', justifyContent:'center', padding:24 }} behavior={Platform.OS==='ios'?'padding':'height'}>
          <View style={{ backgroundColor:C.surface, borderRadius:24, padding:24 }}>
            <Text style={{ fontSize:17, fontWeight:'800', color:C.text, marginBottom:4 }}>💼 Nuevo sueldo</Text>
            <Text style={{ fontSize:13, color:C.textMuted, marginBottom:20 }}>La proyección usará este monto desde el mes que elijas en adelante.</Text>

            <Text style={{ fontSize:12, fontWeight:'600', color:C.textMuted, marginBottom:6 }}>MONTO</Text>
            <TextInput
              style={{ backgroundColor:C.surface2, borderRadius:12, padding:14, fontSize:16, color:C.text, marginBottom:16 }}
              placeholder="Ej: 500000"
              placeholderTextColor={C.textMuted}
              keyboardType="numeric"
              value={newSalary}
              onChangeText={setNewSalary}
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

// ── Calendario ─────────────────────────────────────────────────
function Calendario({ data, onSave }) {
  const C = useC();
  const [modal, setModal]         = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const emptyF = { title:'', day:'', type:'vencimiento', notifyDaysBefore:'2' };
  const [form, setForm]         = useState(emptyF);
  const [editForm, setEditForm] = useState(emptyF);
  const events = data.events || [];
  const today  = new Date().getDate();

  const addEvent = () => {
    if (!form.title||!form.day) return;
    const dayNum = parseInt(form.day);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) return Alert.alert('Día inválido', 'Ingresá un día entre 1 y 31.');
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
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) return Alert.alert('Día inválido', 'Ingresá un día entre 1 y 31.');
    const ev = { ...editForm, id:editTarget, day:dayNum, notifyDaysBefore:parseInt(editForm.notifyDaysBefore)||2 };
    onSave({ ...data, events:events.map(e => e.id===editTarget?ev:e) });
    setEditModal(false);
  };
  const delEvent = (id) => Alert.alert('Eliminar','¿Eliminar este evento?',[
    { text:'Cancelar' },
    { text:'Eliminar', style:'destructive', onPress: () => onSave({ ...data, events:events.filter(e => e.id!==id) }) },
  ]);
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
                    <View style={{ flexDirection:'row', gap:12 }}>
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
    </View>
  );
}

// ── Préstamos (loans dados) ─────────────────────────────────────
function Prestamos({ data, onSave }) {
  const C = useC();
  const loans  = data.loans  || [];
  const credits = data.credits || {};

  const totalPrestado  = loans.reduce((s, l) => s + (l.amount || 0), 0);
  const totalPendiente = loans.reduce((s, l) => s + (l.remaining ?? l.amount ?? 0), 0);
  const totalCreditos  = Object.values(credits).reduce((s, c) => s + (c.amount || 0), 0);

  const delLoan = (name) => Alert.alert('Eliminar préstamo', `¿Eliminar el préstamo de ${name}?`, [
    { text: 'Cancelar' },
    { text: 'Eliminar', style: 'destructive', onPress: () =>
        onSave({ ...data, loans: loans.filter(l => l.name !== name) })
    },
  ]);

  if (loans.length === 0 && Object.keys(credits).length === 0) {
    return (
      <View style={{ flex:1, padding:16 }}>
        <View style={{ padding:40, alignItems:'center' }}>
          <Text style={{ fontSize:48, marginBottom:12 }}>🤝</Text>
          <Text style={{ color:C.textMuted, fontSize:14, textAlign:'center' }}>Sin préstamos registrados</Text>
          <Text style={{ color:C.textDim, fontSize:12, textAlign:'center', marginTop:8 }}>
            Usá WhatsApp para registrar cuando le prestás plata a alguien
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex:1 }}>
      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:40 }} showsVerticalScrollIndicator={false}>
        {/* Resumen */}
        {loans.length > 0 && (
          <View style={{ flexDirection:'row', gap:10, marginBottom:16 }}>
            <Card style={{ flex:1, padding:16 }}>
              <Text style={{ fontSize:9, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:1 }}>Prestado</Text>
              <Text style={{ fontSize:18, fontWeight:'800', color:C.accent, marginTop:4 }}>{fmt(totalPrestado)}</Text>
            </Card>
            <Card style={{ flex:1, padding:16 }}>
              <Text style={{ fontSize:9, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:1 }}>Pendiente</Text>
              <Text style={{ fontSize:18, fontWeight:'800', color:C.red, marginTop:4 }}>{fmt(totalPendiente)}</Text>
            </Card>
          </View>
        )}

        {/* Saldo a favor */}
        {Object.values(credits).length > 0 && (
          <Card style={{ marginBottom:14, borderLeftWidth:3, borderLeftColor:C.green }}>
            <Text style={{ fontSize:14, fontWeight:'700', color:C.text, marginBottom:12 }}>✅ Saldo a favor</Text>
            {Object.values(credits).map(c => (
              <View key={c.name} style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical:8, borderBottomWidth:1, borderBottomColor:C.border }}>
                <Text style={{ fontSize:14, color:C.text, fontWeight:'500' }}>{c.name}</Text>
                <Text style={{ fontSize:14, color:C.green, fontWeight:'700' }}>{fmt(c.amount)}</Text>
              </View>
            ))}
            <Text style={{ fontSize:11, color:C.textMuted, marginTop:8 }}>💡 Estos montos se descontarán automáticamente del próximo préstamo</Text>
          </Card>
        )}

        {/* Lista de préstamos */}
        {loans.map(l => {
          const remaining = l.remaining ?? l.amount ?? 0;
          const total     = l.amount || 0;
          const pct       = total > 0 ? Math.min(((total - remaining) / total) * 100, 100) : 0;
          const pagado    = total - remaining;
          return (
            <Card key={l.name} style={{ marginBottom:12 }}>
              <View style={{ flexDirection:'row', alignItems:'flex-start', marginBottom:12 }}>
                <IconCircle icon="🤝" bg={C.accent+'18'} size={44}/>
                <View style={{ flex:1, marginLeft:12 }}>
                  <Text style={{ fontSize:15, fontWeight:'700', color:C.text }}>{l.name}</Text>
                  <Text style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>
                    Pagado: {fmt(pagado)} · Pendiente: {fmt(remaining)}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => delLoan(l.name)}>
                  <Text style={{ color:C.red, fontSize:12 }}>Eliminar</Text>
                </TouchableOpacity>
              </View>
              <View style={{ backgroundColor:C.surface2, borderRadius:99, height:8, marginBottom:6 }}>
                <View style={{ backgroundColor: remaining === 0 ? C.green : C.accent, height:8, borderRadius:99, width:`${pct}%` }}/>
              </View>
              <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
                <Text style={{ fontSize:11, color:C.textMuted }}>{fmt(total)} total</Text>
                <Text style={{ fontSize:11, color: remaining===0 ? C.green : C.accent, fontWeight:'700' }}>
                  {remaining===0 ? '✅ Saldado' : `${pct.toFixed(0)}% cobrado`}
                </Text>
              </View>
            </Card>
          );
        })}

        <Card style={{ backgroundColor:C.surface2 }}>
          <Text style={{ fontSize:12, color:C.textMuted, textAlign:'center' }}>
            💬 Para registrar nuevos préstamos o cobros, usá el bot de WhatsApp
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}

// ── Turnos ──────────────────────────────────────────────────────
function Turnos({ data, onSave }) {
  const C = useC();
  const turnos = (data.turnos || []).sort((a, b) => a.date.localeCompare(b.date));
  const today  = new Date().toISOString().split('T')[0];

  const [modal, setModal]   = useState(false);
  const emptyF = { description:'', date:'', time:'', location:'', turnoType:'médico' };
  const [form, setForm]     = useState(emptyF);
  const TIPOS = ['médico', 'peluquería', 'banco', 'trámite', 'reunión', 'otro'];

  const addTurno = () => {
    if (!form.description || !form.date) return;
    const turno = { ...form, id: Date.now().toString(), notified: false };
    onSave({ ...data, turnos: [...(data.turnos || []), turno] });
    setModal(false); setForm(emptyF);
  };

  const delTurno = (id) => Alert.alert('Cancelar turno', '¿Cancelar este turno?', [
    { text: 'No' },
    { text: 'Cancelar turno', style: 'destructive', onPress: () =>
        onSave({ ...data, turnos: (data.turnos || []).filter(t => t.id !== id) })
    },
  ]);

  const proximos  = turnos.filter(t => t.date >= today);
  const pasados   = turnos.filter(t => t.date < today);

  const TurnoCard = ({ t }) => {
    const diasRestantes = Math.ceil((new Date(t.date) - new Date(today)) / (1000 * 60 * 60 * 24));
    const esHoy     = t.date === today;
    const esPasado  = t.date < today;
    const color     = esHoy ? C.accent : esPasado ? C.textMuted : diasRestantes <= 2 ? C.red : C.text;
    return (
      <Card style={{ marginBottom:10, opacity: esPasado ? 0.6 : 1 }}>
        <View style={{ flexDirection:'row', alignItems:'flex-start' }}>
          <IconCircle icon={t.turnoType==='médico'?'🏥':t.turnoType==='banco'?'🏦':t.turnoType==='peluquería'?'💈':'📋'} bg={C.accent+'18'} size={44}/>
          <View style={{ flex:1, marginLeft:12 }}>
            <Text style={{ fontSize:14, fontWeight:'700', color:C.text }}>{t.description}</Text>
            <Text style={{ fontSize:12, color, fontWeight:'600', marginTop:2 }}>
              {esHoy ? '🔔 Hoy' : esPasado ? 'Pasado' : diasRestantes === 1 ? '⚠️ Mañana' : `${t.date}`}
              {t.time ? ` · ${t.time}hs` : ''}
            </Text>
            {t.location ? <Text style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>📍 {t.location}</Text> : null}
          </View>
          <TouchableOpacity onPress={() => delTurno(t.id)}>
            <Text style={{ color:C.red, fontSize:12 }}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </Card>
    );
  };

  return (
    <View style={{ flex:1 }}>
      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:100 }} showsVerticalScrollIndicator={false}>
        {proximos.length === 0 && pasados.length === 0 && (
          <View style={{ padding:40, alignItems:'center' }}>
            <Text style={{ fontSize:48, marginBottom:12 }}>📅</Text>
            <Text style={{ color:C.textMuted, fontSize:14, textAlign:'center' }}>Sin turnos agendados</Text>
          </View>
        )}
        {proximos.length > 0 && (
          <>
            <Text style={{ fontSize:11, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>Próximos</Text>
            {proximos.map(t => <TurnoCard key={t.id} t={t}/>)}
          </>
        )}
        {pasados.length > 0 && (
          <>
            <Text style={{ fontSize:11, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:1, marginTop:16, marginBottom:10 }}>Historial</Text>
            {pasados.slice().reverse().slice(0, 5).map(t => <TurnoCard key={t.id} t={t}/>)}
          </>
        )}
      </ScrollView>
      <FAB onPress={() => setModal(true)}/>
      <ModalSheet visible={modal} onClose={() => { setModal(false); setForm(emptyF); }} title="Nuevo turno">
        <Input label="Descripción" value={form.description} onChangeText={v => setForm(f => ({ ...f, description:v }))} placeholder="Ej: Médico clínico, Banco Galicia"/>
        <Input label="Fecha (YYYY-MM-DD)" value={form.date} onChangeText={v => setForm(f => ({ ...f, date:v }))} placeholder={today} keyboardType="numeric"/>
        <Input label="Hora (opcional)" value={form.time} onChangeText={v => setForm(f => ({ ...f, time:v }))} placeholder="14:30" keyboardType="numeric"/>
        <Input label="Lugar (opcional)" value={form.location} onChangeText={v => setForm(f => ({ ...f, location:v }))} placeholder="Ej: Av. Corrientes 1234"/>
        <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:1, marginBottom:8 }}>Tipo</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:16 }}>
          {TIPOS.map(t => (
            <Chip key={t} label={t} active={form.turnoType===t} onPress={() => setForm(f => ({ ...f, turnoType:t }))} style={{ marginRight:8 }}/>
          ))}
        </ScrollView>
        <View style={{ flexDirection:'row', gap:10 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={() => setModal(false)}/>
          <Btn label="Guardar" style={{ flex:1 }} onPress={addTurno}/>
        </View>
      </ModalSheet>
    </View>
  );
}

// ── Planear Tab ────────────────────────────────────────────────
function PlanearTab({ data, onSave }) {
  const C = useC();
  const [sub, setSub] = useState('ahorros');
  const SUBS = [
    { key:'ahorros',    label:'🐷 Ahorros' },
    { key:'deudas',     label:'💳 Deudas' },
    { key:'prestamos',  label:'🤝 Préstamos' },
    { key:'turnos',     label:'📅 Turnos' },
    { key:'calendario', label:'🗓 Eventos' },
    { key:'proyeccion', label:'📈 Proyección' },
  ];
  return (
    <ScreenWithHeader header={
      <>
        <Text style={{ fontSize:13, color:'#ffffff70', fontWeight:'600', letterSpacing:0.3, marginBottom:2 }}>Organización</Text>
        <Text style={{ fontSize:24, fontWeight:'800', color:'#fff', letterSpacing:-0.7 }}>Planear</Text>
      </>
    }>
      <View style={{ flex:1 }}>
        <View style={{ paddingTop:14, marginBottom:4 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal:16, gap:8 }}>
            {SUBS.map(t => (
              <Chip key={t.key} label={t.label} active={sub===t.key} onPress={() => setSub(t.key)}/>
            ))}
          </ScrollView>
        </View>
        {sub==='ahorros'    && <Ahorros    data={data} onSave={onSave}/>}
        {sub==='deudas'     && <Deudas     data={data} onSave={onSave}/>}
        {sub==='prestamos'  && <Prestamos  data={data} onSave={onSave}/>}
        {sub==='turnos'     && <Turnos     data={data} onSave={onSave}/>}
        {sub==='calendario' && <Calendario data={data} onSave={onSave}/>}
        {sub==='proyeccion' && <Proyeccion data={data} onSave={onSave}/>}
      </View>
    </ScreenWithHeader>
  );
}

// ── Perfil Tab ─────────────────────────────────────────────────
function PerfilTab({ user, onLogout, connectWhatsApp, dark, setDark, data }) {
  const C = useC();
  const meta     = user?.user_metadata || {};
  const nombre   = meta.nombre || user?.email?.split('@')[0] || 'Usuario';
  const apellido = meta.apellido || '';
  const fullName = meta.full_name || `${nombre} ${apellido}`.trim();
  const initial  = fullName[0]?.toUpperCase() || 'U';

  // Editar nombre/apellido
  const [editNameModal, setEditNameModal] = useState(false);
  const [editNombre,    setEditNombre]    = useState(nombre);
  const [editApellido,  setEditApellido]  = useState(apellido);
  const [savingName,    setSavingName]    = useState(false);

  const saveNombre = async () => {
    if (!editNombre.trim()) return;
    setSavingName(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { nombre: editNombre.trim(), apellido: editApellido.trim(), full_name: `${editNombre.trim()} ${editApellido.trim()}`.trim() },
      });
      if (error) throw error;
      setEditNameModal(false);
    } catch (e) {
      Alert.alert('Error', e.message || 'No se pudo actualizar el nombre');
    }
    setSavingName(false);
  };

  // Cambiar contraseña
  const [pwModal,    setPwModal]    = useState(false);
  const [pwCurrent,  setPwCurrent]  = useState('');
  const [pwNew,      setPwNew]      = useState('');
  const [pwConfirm,  setPwConfirm]  = useState('');
  const [savingPw,   setSavingPw]   = useState(false);

  const changePassword = async () => {
    if (pwNew.length < 8) return Alert.alert('Error', 'La contraseña debe tener al menos 8 caracteres');
    if (pwNew !== pwConfirm) return Alert.alert('Error', 'Las contraseñas no coinciden');
    setSavingPw(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwNew });
      if (error) throw error;
      Alert.alert('Listo', 'Contraseña actualizada correctamente');
      setPwModal(false); setPwCurrent(''); setPwNew(''); setPwConfirm('');
    } catch (e) {
      Alert.alert('Error', e.message || 'No se pudo cambiar la contraseña');
    }
    setSavingPw(false);
  };

  // Biometría
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  useEffect(() => {
    let LA;
    try { LA = require('expo-local-authentication'); } catch { return; }
    LA.hasHardwareAsync().then(has => {
      if (!has) return;
      LA.isEnrolledAsync().then(enrolled => {
        setBioAvailable(enrolled);
        AsyncStorage.getItem('orbe_bio').then(v => setBioEnabled(v === '1')).catch(() => {});
      });
    });
  }, []);
  const toggleBio = async (val) => {
    setBioEnabled(val);
    await AsyncStorage.setItem('orbe_bio', val ? '1' : '0');
  };

  return (
    <View style={{ flex:1, backgroundColor:C.header }}>
      {/* Header with avatar */}
      <View style={{ paddingTop:60, paddingBottom:36, alignItems:'center' }}>
        <View style={{
          width:86, height:86, borderRadius:43, backgroundColor:'#ffffff18',
          alignItems:'center', justifyContent:'center',
          borderWidth:2, borderColor:'#ffffff30', marginBottom:16,
        }}>
          <Text style={{ fontSize:38, fontWeight:'800', color:'#fff' }}>{initial}</Text>
        </View>
        <Text style={{ fontSize:22, fontWeight:'800', color:'#fff', letterSpacing:-0.5 }}>{fullName}</Text>
        <Text style={{ fontSize:13, color:'#ffffff55', marginTop:4 }}>{user?.email}</Text>
      </View>

      {/* Content */}
      <View style={{ flex:1, backgroundColor:C.bg, borderTopLeftRadius:32, borderTopRightRadius:32, overflow:'hidden', borderTopWidth:1, borderColor:C.gold }}>
        <ScrollView contentContainerStyle={{ padding:20 }} showsVerticalScrollIndicator={false}>


          {/* Cuenta */}
          <Card style={{ marginBottom:14 }}>
            <TouchableOpacity onPress={() => { setEditNombre(nombre); setEditApellido(apellido); setEditNameModal(true); }}
              style={{ flexDirection:'row', alignItems:'center', paddingVertical:14, borderBottomWidth:1, borderBottomColor:C.border }}>
              <View style={{ flex:1 }}>
                <Text style={{ fontSize:15, fontWeight:'600', color:C.text }}>Editar nombre</Text>
                <Text style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>{fullName}</Text>
              </View>
              <Text style={{ color:C.textMuted, fontSize:20 }}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setPwModal(true)}
              style={{ flexDirection:'row', alignItems:'center', paddingVertical:14 }}>
              <View style={{ flex:1 }}>
                <Text style={{ fontSize:15, fontWeight:'600', color:C.text }}>Cambiar contraseña</Text>
                <Text style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Actualizá tu contraseña de acceso</Text>
              </View>
              <Text style={{ color:C.textMuted, fontSize:20 }}>›</Text>
            </TouchableOpacity>
          </Card>

          {/* Seguridad y preferencias */}
          <Card style={{ marginBottom:14 }}>
            {bioAvailable && (
              <View style={{ flexDirection:'row', alignItems:'center', paddingVertical:14, borderBottomWidth:1, borderBottomColor:C.border }}>
                <Text style={{ flex:1, fontSize:15, fontWeight:'600', color:C.text }}>Huella / Face ID</Text>
                <Switch value={bioEnabled} onValueChange={toggleBio}
                  trackColor={{ false:C.border, true:C.accent }} thumbColor="#fff"/>
              </View>
            )}
            <View style={{ flexDirection:'row', alignItems:'center', paddingVertical:14, borderBottomWidth:1, borderBottomColor:C.border }}>
              <Text style={{ flex:1, fontSize:15, fontWeight:'600', color:C.text }}>Modo oscuro</Text>
              <Switch value={dark} onValueChange={setDark}
                trackColor={{ false:C.border, true:C.accent }} thumbColor="#fff"/>
            </View>
            <TouchableOpacity onPress={connectWhatsApp}
              style={{ flexDirection:'row', alignItems:'center', paddingVertical:14 }}>
              <View style={{ flex:1 }}>
                <Text style={{ fontSize:15, fontWeight:'600', color:C.text }}>Conectar WhatsApp</Text>
                <Text style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Registrá gastos y consultá tu balance por chat</Text>
              </View>
              <Text style={{ color:C.textMuted, fontSize:20 }}>›</Text>
            </TouchableOpacity>
          </Card>

          {/* Logout */}
          <Card>
            <TouchableOpacity onPress={onLogout}
              style={{ flexDirection:'row', alignItems:'center', paddingVertical:6 }}>
              <Text style={{ flex:1, fontSize:15, fontWeight:'600', color:C.red }}>Cerrar sesión</Text>
              <Text style={{ color:C.red, fontSize:20 }}>›</Text>
            </TouchableOpacity>
          </Card>

          <View style={{ height:40 }}/>
        </ScrollView>
      </View>

      {/* Modal: Editar nombre */}
      <ModalSheet visible={editNameModal} onClose={() => setEditNameModal(false)} title="Editar nombre">
        <Input label="Nombre" value={editNombre} onChangeText={setEditNombre} placeholder="Tu nombre"/>
        <Input label="Apellido" value={editApellido} onChangeText={setEditApellido} placeholder="Tu apellido"/>
        <View style={{ flexDirection:'row', gap:10, marginTop:4 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={() => setEditNameModal(false)}/>
          <Btn label={savingName ? '...' : 'Guardar'} style={{ flex:1 }} onPress={saveNombre}/>
        </View>
      </ModalSheet>

      {/* Modal: Cambiar contraseña */}
      <ModalSheet visible={pwModal} onClose={() => setPwModal(false)} title="Cambiar contraseña">
        <Input label="Nueva contraseña" value={pwNew} onChangeText={setPwNew} placeholder="Mínimo 8 caracteres" secureTextEntry/>
        <Input label="Repetir contraseña" value={pwConfirm} onChangeText={setPwConfirm} placeholder="Repetí la contraseña" secureTextEntry/>
        <View style={{ flexDirection:'row', gap:10, marginTop:4 }}>
          <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={() => setPwModal(false)}/>
          <Btn label={savingPw ? '...' : 'Guardar'} style={{ flex:1 }} onPress={changePassword}/>
        </View>
      </ModalSheet>
    </View>
  );
}

// ── Tab Bar ────────────────────────────────────────────────────
const TABS = [
  { key:'inicio',        label:'Inicio',    icon:'🏠' },
  { key:'analisis',      label:'Análisis',  icon:'📊' },
  { key:'__whatsapp__',  label:'WhatsApp',  icon:'💬' },
  { key:'perfil',        label:'Perfil',    icon:'👤' },
  { key:'__add__',       label:'',          icon:'+' },
];

// ── Main ───────────────────────────────────────────────────────
export default function MainApp({ user, onLogout }) {
  const [tab,  setTab]    = useState('inicio');
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [dark, setDarkState] = useState(false);
  const [monthPicker, setMonthPicker] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [panel, setPanel] = useState(null); // null | 'ahorros' | 'deudas' | 'prestamos' | 'turnos' | 'calendario' | 'proyeccion'

  const C = mkTheme(dark);

  // Persist dark mode preference
  const setDark = useCallback(async (val) => {
    setDarkState(val);
    try { await AsyncStorage.setItem('orbe_dark', val ? '1' : '0'); } catch {}
  }, []);

  const meta     = user?.user_metadata || {};
  const nombre   = meta.nombre || user?.email?.split('@')[0] || 'Usuario';
  const fullName = meta.full_name || nombre;

  const [waLinked, setWaLinked]   = useState(null);
  const [waModal, setWaModal]     = useState(false);
  const [waCode, setWaCode]       = useState('');
  const [waLoading, setWaLoading] = useState(false);
  const [waPolling, setWaPolling] = useState(null);

  const connectWhatsApp = () => {
    if (waLinked) {
      Linking.openURL('https://wa.me/5491125728211').catch(() => Alert.alert('Error', 'No se pudo abrir WhatsApp.'));
      return;
    }
    openWaModal();
  };

  const openWaModal = async () => {
    setWaCode('');
    setWaModal(true);
    setWaLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${BACKEND_URL}/api/generate-link-code`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      });
      const body = await resp.json();
      if (resp.ok && body.code) setWaCode(body.code);
    } catch {}
    setWaLoading(false);
  };

  const checkLinked = async () => {
    const { data: wa, error } = await supabase.from('whatsapp_users').select('phone').eq('user_id', user.id).single();
    if (wa?.phone) {
      if (waPolling) { clearInterval(waPolling); setWaPolling(null); }
      setWaLinked(wa.phone);
      setWaModal(false);
      Alert.alert('¡WhatsApp conectado!', 'Ya podés usar Orbe desde WhatsApp.');
      return true;
    }
    return false;
  };

  const startPolling = () => {
    const id = setInterval(async () => { await checkLinked(); }, 3000);
    setWaPolling(id);
  };

  const closeWaModal = () => {
    if (waPolling) { clearInterval(waPolling); setWaPolling(null); }
    setWaModal(false);
  };

  useEffect(() => {
    // Load dark mode preference
    AsyncStorage.getItem('orbe_dark').then(v => { if (v === '1') setDarkState(true); }).catch(() => {});
    // Load data
    loadData(user.id)
      .then(d => { setData(d || defaultData()); setLoading(false); })
      .catch(() => { setData(defaultData()); setLoading(false); });
    // Check WhatsApp linked status
    supabase.from('whatsapp_users').select('phone').eq('user_id', user.id).single()
      .then(({ data: wa }) => setWaLinked(wa?.phone || false))
      .catch(() => setWaLinked(false));
  }, [user]);

  const save = useCallback(async (newData) => {
    setData(newData);
    try { await saveData(user.id, newData); } catch {}
  }, [user]);

  if (loading) return (
    <View style={{ flex:1, alignItems:'center', justifyContent:'center', backgroundColor:C.bg }}>
      <ActivityIndicator size="large" color={C.accent}/>
    </View>
  );

  const PICKER_YEARS = [2026, 2027, 2028, 2029, 2030];

  const handleTab = async (key) => {
    if (key === '__add__') { setAddModal(true); return; }
    if (key === '__whatsapp__') {
      // Recheck linked status before opening
      const { data: wa } = await supabase.from('whatsapp_users').select('phone').eq('user_id', user.id).single();
      if (wa?.phone) {
        setWaLinked(wa.phone);
        Linking.openURL('https://wa.me/5491125728211').catch(() => {});
      } else {
        setWaLinked(false);
        openWaModal();
      }
      return;
    }
    setTab(key);
  };

  return (
    <ThemeCtx.Provider value={C}>
      <View style={{ flex:1, backgroundColor:C.bg }}>
        {/* Content */}
        <View style={{ flex:1 }}>
          {tab==='inicio'   && <InicioTab data={data} onSave={save} onMonthPress={() => setMonthPicker(true)} nombre={nombre} onOpenPanel={setPanel}/>}
          {tab==='analisis' && <AnalisisTab data={data} onSave={save}/>}
          {tab==='perfil'   && <PerfilTab user={user} onLogout={onLogout} connectWhatsApp={connectWhatsApp} dark={dark} setDark={setDark} data={data}/>}
        </View>

        {/* Panel Modal */}
        <Modal visible={!!panel} animationType="slide" onRequestClose={() => setPanel(null)}>
          <ThemeCtx.Provider value={C}>
            <View style={{ flex:1, backgroundColor: C.bg }}>
              <View style={{ backgroundColor: C.accent, paddingTop: 52, paddingBottom: 16, paddingHorizontal: 20, flexDirection:'row', alignItems:'center', gap:12, borderBottomWidth:1, borderBottomColor:C.gold }}>
                <TouchableOpacity onPress={() => setPanel(null)}>
                  <Text style={{ color:'#fff', fontSize:22 }}>←</Text>
                </TouchableOpacity>
                <Text style={{ color:'#fff', fontSize:18, fontWeight:'800' }}>
                  { panel==='ahorros' ? 'Ahorros' : panel==='deudas' ? 'Deudas' : panel==='prestamos' ? 'Préstamos' : panel==='turnos' ? 'Turnos' : panel==='calendario' ? 'Eventos' : 'Proyección' }
                </Text>
              </View>
              { panel==='ahorros'    && <Ahorros    data={data} onSave={save}/> }
              { panel==='deudas'     && <Deudas     data={data} onSave={save}/> }
              { panel==='prestamos'  && <Prestamos  data={data} onSave={save}/> }
              { panel==='turnos'     && <Turnos     data={data} onSave={save}/> }
              { panel==='calendario' && <Calendario data={data} onSave={save}/> }
              { panel==='proyeccion' && <Proyeccion data={data} onSave={save}/> }
            </View>
          </ThemeCtx.Provider>
        </Modal>

        {/* Bottom Tab Bar */}
        <View style={{
          flexDirection:'row', backgroundColor:C.tab,
          paddingBottom:28, paddingTop:10,
          borderTopWidth:1, borderTopColor:C.border,
          shadowColor: C.dark ? '#000' : '#6366F1',
          shadowOffset:{width:0,height:-4},
          shadowOpacity:C.dark?0.5:0.08, shadowRadius:16, elevation:14,
        }}>
          {TABS.map(t => {
            const isActive = tab === t.key;
            const isAdd    = t.key === '__add__';
            return (
              <TouchableOpacity key={t.key} onPress={() => handleTab(t.key)}
                style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
                {isAdd ? (
                  <View style={{
                    width:52, height:52, borderRadius:26, backgroundColor:C.accent,
                    alignItems:'center', justifyContent:'center',
                    marginTop:-20,
                    borderWidth:1, borderColor:C.gold,
                    shadowColor: C.gold, shadowOffset:{width:0,height:8},
                    shadowOpacity:0.4, shadowRadius:16, elevation:12,
                  }}>
                    <Text style={{ color:'#fff', fontSize:26, fontWeight:'300', lineHeight:30 }}>+</Text>
                  </View>
                ) : (
                  <>
                    <View style={{ alignItems:'center', justifyContent:'center', height:34 }}>
                      {t.key === '__whatsapp__'
                        ? <FontAwesome5 name="whatsapp" size={24} color={isActive ? '#25D366' : C.textMuted} solid/>
                        : <Text style={{ fontSize:22, opacity: isActive ? 1 : 0.35 }}>{t.icon}</Text>
                      }
                    </View>
                    <Text style={{ fontSize:10, fontWeight:'700', color: isActive ? C.accent : C.textMuted, marginTop:2, letterSpacing:0.2 }}>{t.label}</Text>
                    {isActive && <View style={{ width:4, height:4, borderRadius:2, backgroundColor:C.accent, marginTop:3 }}/>}
                  </>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Add Transaction Modal */}
        <AddTxModal visible={addModal} onClose={() => setAddModal(false)} data={data} onSave={save}/>

        {/* Month Picker */}
        <ModalSheet visible={monthPicker} onClose={() => setMonthPicker(false)} title="Seleccionar mes">
          <ScrollView style={{ maxHeight:300 }} showsVerticalScrollIndicator={false}>
            {PICKER_YEARS.map(year => (
              <View key={year}>
                <Text style={{ color:C.textMuted, fontWeight:'700', marginBottom:8, marginTop:4 }}>{year}</Text>
                <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:12 }}>
                  {MONTH_NAMES.map((m,i) => (
                    <Chip key={i} label={m} active={data.selectedMonth===i&&data.selectedYear===year}
                      onPress={() => { save({ ...data, selectedMonth:i, selectedYear:year }); setMonthPicker(false); }}/>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
          <Btn label="Cerrar" variant="ghost" onPress={() => setMonthPicker(false)} style={{ marginTop:8 }}/>
        </ModalSheet>

        {/* WhatsApp linking modal */}
        <ModalSheet visible={waModal} onClose={closeWaModal} title="Conectar WhatsApp">
          {waLoading ? (
            <ActivityIndicator color={C.accent} style={{ marginVertical: 32 }}/>
          ) : (
            <>
              <Text style={{ fontSize:13, color:C.textMuted, marginBottom:20, lineHeight:20 }}>
                Enviá este mensaje al chat de Orbe en WhatsApp para vincular tu cuenta.
              </Text>

              <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Tu código</Text>
              <View style={{ backgroundColor:C.surface2, borderRadius:14, borderWidth:1, borderColor:C.border, paddingHorizontal:20, paddingVertical:16, alignItems:'center', marginBottom:20 }}>
                <Text style={{ fontSize:28, fontWeight:'800', color:C.text, letterSpacing:6 }}>
                  ORBE: {waCode || '------'}
                </Text>
              </View>

              <TouchableOpacity
                style={{ flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, backgroundColor:'#25D366', borderRadius:16, paddingVertical:14, marginBottom:12 }}
                onPress={() => {
                  Linking.openURL(`https://wa.me/5491125728211?text=ORBE:%20${waCode}`);
                  if (!waPolling) startPolling();
                }}
              >
                <FontAwesome5 name="whatsapp" size={18} color="#fff" solid/>
                <Text style={{ color:'#fff', fontWeight:'800', fontSize:15 }}>Abrir WhatsApp y enviar</Text>
              </TouchableOpacity>

              {waPolling && (
                <View style={{ gap:10, marginTop:8 }}>
                  <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8 }}>
                    <ActivityIndicator size="small" color={C.accent}/>
                    <Text style={{ fontSize:12, color:C.textMuted }}>Esperando confirmación...</Text>
                  </View>
                  <Btn label="Ya lo envié, verificar" onPress={checkLinked} style={{ marginTop:4 }}/>
                </View>
              )}

              <Btn label="Cancelar" variant="ghost" onPress={closeWaModal} style={{ marginTop:12 }}/>
            </>
          )}
        </ModalSheet>
      </View>
    </ThemeCtx.Provider>
  );
}
