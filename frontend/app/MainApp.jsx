
import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  Modal, ActivityIndicator, Alert, Platform,
  KeyboardAvoidingView, Switch, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadData, saveData } from '../constants/supabase';

// ── Notificaciones (opcional) ────────────────────────────────
let Notifications = null;
try { Notifications = require('expo-notifications'); } catch {}

// ── Theme ─────────────────────────────────────────────────────
const ThemeCtx = createContext(null);
const useC = () => useContext(ThemeCtx);

const mkTheme = (dark) => ({
  bg:          dark ? '#0e1621' : '#f4fbf8',
  surface:     dark ? '#18253a' : '#ffffff',
  surface2:    dark ? '#1e2f44' : '#edf8f3',
  border:      dark ? '#28394f' : '#cce9d9',
  accent:      '#4aba82',
  accentLight: dark ? '#0d2318' : '#e3f8ef',
  gold:        dark ? '#72d4a8' : '#2e9960',
  text:        dark ? '#eee8e0' : '#1c1410',
  textMuted:   dark ? '#7a8fa0' : '#7a6a58',
  textDim:     dark ? '#384a5c' : '#c0a890',
  red:         dark ? '#ff6060' : '#e53935',
  redLight:    dark ? '#2a1010' : '#fff5f5',
  blue:        dark ? '#4a8cff' : '#2563eb',
  green:       dark ? '#00e0a0' : '#4aba82',
  header:      dark ? '#18253a' : '#4aba82',
  tab:         dark ? '#18253a' : '#ffffff',
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
async function setupNotifications() {
  if (!Notifications) return false;
  try {
    Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert:true, shouldPlaySound:true, shouldSetBadge:false }) });
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    return finalStatus === 'granted';
  } catch { return false; }
}
async function scheduleEventNotification(event, daysBefore = 2) {
  if (!Notifications) return;
  try {
    const now = new Date();
    let nd = new Date(now.getFullYear(), now.getMonth(), event.day - daysBefore, 9, 0, 0);
    if (nd <= now) nd.setMonth(nd.getMonth() + 1);
    await Notifications.scheduleNotificationAsync({
      content: { title: '🔔 Orbe', body: `Recordatorio: ${event.title} vence el día ${event.day}`, sound: true },
      trigger: { date: nd },
      identifier: `event-${event.id}`,
    });
  } catch {}
}
async function cancelEventNotification(eventId) {
  if (!Notifications) return;
  try { await Notifications.cancelScheduledNotificationAsync(`event-${eventId}`); } catch {}
}

// ── UI Primitives ──────────────────────────────────────────────

function Card({ children, style }) {
  const C = useC();
  return (
    <View style={[{
      backgroundColor: C.surface, borderRadius: 22, padding: 18,
      shadowColor: '#000', shadowOffset: { width:0, height:2 },
      shadowOpacity: C.dark ? 0.3 : 0.07, shadowRadius: 10,
      elevation: 3, borderWidth: 1, borderColor: C.border,
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
      style={[{ borderRadius:14, padding:14, alignItems:'center', backgroundColor:bg,
        opacity: disabled ? 0.5 : 1,
        borderWidth: variant==='primary' ? 0 : 1, borderColor: C.border,
      }, style]}>
      <Text style={{ fontSize:14, fontWeight:'700', color }}>{label}</Text>
    </TouchableOpacity>
  );
}

function Input({ label, value, onChangeText, placeholder, keyboardType, prefix, multiline, secureTextEntry }) {
  const C = useC();
  return (
    <View style={{ marginBottom:14 }}>
      {label ? <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 }}>{label}</Text> : null}
      <View style={{ flexDirection:'row', alignItems:'center' }}>
        {prefix ? <Text style={{ position:'absolute', left:13, color:C.textMuted, zIndex:1 }}>{prefix}</Text> : null}
        <TextInput
          style={{
            flex:1, backgroundColor:C.surface2, borderWidth:1, borderColor:C.border,
            borderRadius:14, padding:13, fontSize:14, color:C.text,
            paddingLeft: prefix ? 26 : 13,
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
      paddingHorizontal:14, paddingVertical:8, borderRadius:20,
      backgroundColor: active ? C.accent : C.surface2,
      borderWidth:1, borderColor: active ? C.accent : C.border,
    }, style]}>
      <Text style={{ fontSize:12, fontWeight:'600', color: active ? '#fff' : C.textMuted }}>{label}</Text>
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
    <View style={{ flexDirection:'row', backgroundColor:C.surface2, borderRadius:14, padding:4 }}>
      {tabs.map(t => (
        <TouchableOpacity key={t.key} onPress={() => onChange(t.key)}
          style={{
            flex:1, paddingVertical:9, borderRadius:10, alignItems:'center',
            backgroundColor: active===t.key ? C.surface : 'transparent',
            shadowColor: active===t.key ? '#000' : 'transparent',
            shadowOffset:{width:0,height:1}, shadowOpacity:0.08, shadowRadius:4, elevation: active===t.key ? 2 : 0,
          }}>
          <Text style={{ fontSize:12, fontWeight:'600', color: active===t.key ? C.accent : C.textMuted }}>{t.label}</Text>
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
        <View style={{ flex:1, backgroundColor:'#00000055', justifyContent:'flex-end' }}>
          <View style={{
            backgroundColor:C.surface, borderTopLeftRadius:28, borderTopRightRadius:28,
            padding:24, paddingBottom:40, maxHeight:'90%',
          }}>
            <View style={{ width:40, height:4, backgroundColor:C.border, borderRadius:2, alignSelf:'center', marginBottom:18 }}/>
            {title && <Text style={{ fontSize:18, fontWeight:'800', color:C.text, marginBottom:20 }}>{title}</Text>}
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
      position:'absolute', bottom:24, right:24, width:56, height:56, borderRadius:28,
      backgroundColor:C.accent, alignItems:'center', justifyContent:'center',
      shadowColor:C.accent, shadowOffset:{width:0,height:8}, shadowOpacity:0.4, shadowRadius:16, elevation:8,
    }}>
      <Text style={{ color:'#fff', fontSize:26, lineHeight:30 }}>+</Text>
    </TouchableOpacity>
  );
}

// ── Transaction Row ────────────────────────────────────────────
function TxRow({ tx, cats, onDelete, onEdit }) {
  const C = useC();
  const isGasto  = tx.type === 'gasto';
  const isIncome = tx.type === 'ingreso' || tx.type === 'sueldo';
  const icon     = tx.type==='sueldo' ? '💼' : tx.type==='ahorro_meta' ? '🐷' : (cats[tx.category]||'📦');
  const iconBg   = isGasto ? C.red+'22' : isIncome ? C.green+'22' : C.accent+'22';
  const catLabel = tx.type==='sueldo' ? 'Sueldo' : tx.type==='ahorro_meta' ? 'Ahorro' : tx.category;
  return (
    <View style={{ flexDirection:'row', alignItems:'center', paddingVertical:12, borderBottomWidth:1, borderBottomColor:C.border }}>
      <IconCircle icon={icon} bg={iconBg} size={44}/>
      <View style={{ flex:1, marginLeft:12 }}>
        <Text style={{ fontSize:14, fontWeight:'600', color:C.text }}>{tx.description}</Text>
        <Text style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>{catLabel} · {tx.date}</Text>
      </View>
      <View style={{ alignItems:'flex-end' }}>
        <Text style={{ fontSize:14, fontWeight:'700', color: isGasto ? C.red : C.green }}>
          {isGasto ? '-' : '+'}{fmt(tx.amount)}
        </Text>
        <View style={{ flexDirection:'row', gap:10, marginTop:2 }}>
          {onEdit && (
            <TouchableOpacity onPress={() => onEdit(tx)}>
              <Text style={{ fontSize:10, color:C.accent }}>Editar</Text>
            </TouchableOpacity>
          )}
          {onDelete && (
            <TouchableOpacity onPress={() => onDelete(tx.id)}>
              <Text style={{ fontSize:10, color:C.textDim }}>Eliminar</Text>
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
            <View style={{ flex:1, backgroundColor:C.green, borderRadius:4, height: Math.max(4, (d.income/maxVal)*BAR_H), opacity:0.85 }}/>
            <View style={{ flex:1, backgroundColor:C.accent, borderRadius:4, height: Math.max(4, (d.expense/maxVal)*BAR_H), opacity:0.85 }}/>
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
      <View style={{ paddingTop:52, paddingHorizontal:20, paddingBottom:28 }}>
        {header}
      </View>
      <View style={{ flex:1, backgroundColor:C.bg, borderTopLeftRadius:28, borderTopRightRadius:28, overflow:'hidden' }}>
        {children}
      </View>
    </View>
  );
}

// ── Inicio Tab ─────────────────────────────────────────────────
function InicioTab({ data, onMonthPress }) {
  const C = useC();
  const txs = data.transactions.filter(t => {
    const { month, year } = parseDateParts(t.date);
    return month === data.selectedMonth && year === data.selectedYear;
  });
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
  const greeting     = () => { const h = new Date().getHours(); return h<12?'Buenos días ☀️':h<18?'Buenas tardes 🌤️':'Buenas noches 🌙'; };

  return (
    <ScreenWithHeader header={
      <>
        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
          <View>
            <Text style={{ fontSize:22, fontWeight:'800', color:'#fff', letterSpacing:-0.5 }}>Hola de nuevo</Text>
            <Text style={{ fontSize:13, color:'#ffffff80', marginTop:3 }}>{greeting()}</Text>
          </View>
          <TouchableOpacity onPress={onMonthPress}
            style={{ backgroundColor:'#ffffff20', borderRadius:12, paddingHorizontal:12, paddingVertical:8, borderWidth:1, borderColor:'#ffffff30' }}>
            <Text style={{ color:'#fff', fontSize:12, fontWeight:'700' }}>{MONTH_NAMES[data.selectedMonth]} {data.selectedYear} ▾</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:16 }}>
          <View>
            <Text style={{ fontSize:11, color:'#ffffff70', fontWeight:'600', textTransform:'uppercase', letterSpacing:0.5 }}>Balance del mes</Text>
            <Text style={{ fontSize:34, fontWeight:'800', color:'#fff', marginTop:2, letterSpacing:-1 }}>{fmt(balance)}</Text>
          </View>
          <View style={{ alignItems:'flex-end' }}>
            <Text style={{ fontSize:11, color:'#ffffff70', fontWeight:'600', textTransform:'uppercase', letterSpacing:0.5 }}>Gastos</Text>
            <Text style={{ fontSize:34, fontWeight:'800', color: totalExpense>totalBudget&&totalBudget>0 ? '#ffb3b3' : '#fff', marginTop:2, letterSpacing:-1 }}>{fmt(totalExpense)}</Text>
          </View>
        </View>
        {totalBudget > 0 && (
          <View>
            <View style={{ backgroundColor:'#ffffff25', borderRadius:8, height:8, overflow:'hidden', marginBottom:6 }}>
              <View style={{ width:`${pct}%`, backgroundColor: pct>80 ? '#ff9090' : '#ffffffcc', borderRadius:8 }}/>
            </View>
            <Text style={{ fontSize:12, color:'#ffffffaa' }}>
              {pct>=100 ? '⚠️ Presupuesto superado' : pct>=80 ? `⚠️ ${pct.toFixed(0)}% del presupuesto` : `✅ ${pct.toFixed(0)}% del presupuesto`}
            </Text>
          </View>
        )}
      </>
    }>
      <ScrollView contentContainerStyle={{ padding:16 }} showsVerticalScrollIndicator={false}>
        {/* Quick stats */}
        <View style={{ flexDirection:'row', gap:10, marginBottom:14 }}>
          {[
            { label:'Ingresos', val:totalIncome, color:C.green },
            { label:'Ahorros', val:totalSavings, color:C.accent },
            { label:'Deudas', val:totalDebt, color:C.red },
          ].map(k => (
            <Card key={k.label} style={{ flex:1, padding:14 }}>
              <Text style={{ fontSize:9, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5 }}>{k.label}</Text>
              <Text style={{ fontSize:15, fontWeight:'800', color:k.color, marginTop:4, letterSpacing:-0.5 }}>{fmt(k.val)}</Text>
            </Card>
          ))}
        </View>

        {upcoming.length > 0 && (
          <Card style={{ marginBottom:14, borderLeftWidth:3, borderLeftColor:C.red }}>
            <Text style={{ fontSize:14, fontWeight:'700', color:C.text, marginBottom:12 }}>⚠️ Próximos vencimientos</Text>
            {upcoming.map(ev => (
              <View key={ev.id} style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical:7, borderBottomWidth:1, borderBottomColor:C.border }}>
                <Text style={{ fontSize:13, color:C.text }}>{ev.title}</Text>
                <Text style={{ fontSize:13, color:C.red, fontWeight:'700' }}>Día {ev.day}</Text>
              </View>
            ))}
          </Card>
        )}

        <Card style={{ marginBottom:32 }}>
          <Text style={{ fontSize:15, fontWeight:'700', color:C.text, marginBottom:14 }}>Últimas transacciones</Text>
          {txs.length === 0
            ? <Text style={{ color:C.textDim, fontSize:13, textAlign:'center', paddingVertical:20 }}>Sin transacciones este mes</Text>
            : txs.slice().reverse().slice(0,10).map(t => <TxRow key={t.id} tx={t} cats={cats}/>)
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

  const updateLimit = (cat, val) =>
    onSave({ ...data, budgets:data.budgets.map(b => b.cat===cat ? { ...b, limit:parseFloat(val)||0 } : b) });
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
        <Text style={{ fontSize:22, fontWeight:'800', color:'#fff', marginBottom:16, letterSpacing:-0.5 }}>Análisis</Text>
        <View style={{ flexDirection:'row', gap:24 }}>
          <View>
            <Text style={{ fontSize:11, color:'#ffffff70', fontWeight:'600', textTransform:'uppercase', letterSpacing:0.5 }}>Ingresos</Text>
            <Text style={{ fontSize:26, fontWeight:'800', color: C.dark ? C.green : '#e0ffe8', marginTop:2, letterSpacing:-0.5 }}>{fmt(totalIncome)}</Text>
          </View>
          <View style={{ width:1, backgroundColor:'#ffffff20', marginVertical:4 }}/>
          <View>
            <Text style={{ fontSize:11, color:'#ffffff70', fontWeight:'600', textTransform:'uppercase', letterSpacing:0.5 }}>Gastos</Text>
            <Text style={{ fontSize:26, fontWeight:'800', color:'#ffb3b3', marginTop:2, letterSpacing:-0.5 }}>{fmt(totalExpense)}</Text>
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
              {[{ label:'Ingreso', color:C.green }, { label:'Gasto', color:C.accent }].map(l => (
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
              style={{ backgroundColor:C.accent, borderRadius:10, paddingHorizontal:12, paddingVertical:5 }}>
              <Text style={{ color:'#fff', fontSize:12, fontWeight:'700' }}>+ Nueva</Text>
            </TouchableOpacity>
          </View>
          {data.budgets.map(b => {
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
        <Text style={{ fontSize:22, fontWeight:'800', color:'#fff', letterSpacing:-0.5 }}>Transacciones</Text>
        <Text style={{ fontSize:13, color:'#ffffff70', marginTop:4 }}>{MONTH_FULL[data.selectedMonth]} {data.selectedYear}</Text>
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
  const cats = data.categories || DEFAULT_CATEGORIES;
  const isEditing = !!editTx;
  const TYPES = [
    { key:'gasto', label:'Gasto' }, { key:'ingreso', label:'Ingreso' },
    { key:'sueldo', label:'Sueldo 💼' }, { key:'ahorro_meta', label:'Ahorro 🐷' },
  ];
  const emptyForm = { type:'gasto', description:'', amount:'', category: Object.keys(cats)[0]||'Alimentación', date: new Date().toISOString().split('T')[0], savingsId:'' };
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (editTx) {
      setForm({ ...editTx, amount: String(editTx.amount) });
    } else {
      setForm(emptyForm);
    }
  }, [editTx, visible]);

  const saveTx = () => {
    if (!form.description || !form.amount) return;
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
  return (
    <ModalSheet visible={visible} onClose={onClose} title={isEditing ? 'Editar transacción' : 'Nueva transacción'}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:16 }}>
          {TYPES.map(t => (
            <Chip key={t.key} label={t.label} active={form.type===t.key}
              onPress={() => setForm(f => ({ ...f, type:t.key }))} style={{ marginRight:8 }}/>
          ))}
        </ScrollView>
        <Input label="Descripción" value={form.description} onChangeText={v => setForm(f => ({ ...f, description:v }))} placeholder="Ej: Supermercado"/>
        <Input label="Monto" value={form.amount} onChangeText={v => setForm(f => ({ ...f, amount:v }))} placeholder="0" keyboardType="numeric" prefix="$"/>
        {(form.type==='gasto'||form.type==='ingreso') && (
          <>
            <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Categoría</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:14 }}>
              {Object.entries(cats).map(([cat,icon]) => (
                <Chip key={cat} label={`${icon} ${cat}`} active={form.category===cat}
                  onPress={() => setForm(f => ({ ...f, category:cat }))} style={{ marginRight:8 }}/>
              ))}
            </ScrollView>
          </>
        )}
        {form.type==='ahorro_meta' && (
          <>
            <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Meta de ahorro</Text>
            {data.savings.length===0
              ? <Text style={{ color:C.textMuted, fontSize:13, marginBottom:14 }}>Primero creá una meta en Planear.</Text>
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
function Proyeccion({ data }) {
  const C = useC();
  const now = new Date(); const startMonth=now.getMonth(); const startYear=now.getFullYear();
  const [expanded, setExpanded] = useState(null);
  const cats = data.categories || DEFAULT_CATEGORIES;

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

  const budgetItems = data.budgets.filter(b=>b.limit>0);
  const budgetTotal = budgetItems.reduce((s,b)=>s+b.limit,0);
  const activeDebts = data.debts.filter(d=>d.installment>0&&d.remainingInstallments>0);
  const months = Array.from({length:12},(_,i)=>{
    const m=(startMonth+i)%12; const y=startYear+Math.floor((startMonth+i)/12);
    const cuotas=activeDebts.filter(d=>i<d.remainingInstallments).map(d=>({name:d.name,amount:d.installment}));
    const totalCuotas=cuotas.reduce((s,d)=>s+d.amount,0);
    return {label:MONTH_NAMES[m],year:y,cuotas,totalCuotas,balance:avgIncome-budgetTotal-totalCuotas};
  });

  return (
    <ScrollView contentContainerStyle={{ padding:16, paddingBottom:40 }} showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection:'row', gap:10, flexWrap:'wrap', marginBottom:14 }}>
        {[
          { label:'Ingreso estimado', val:avgIncome, sub:'Prom. 3 meses' },
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
      <Card style={{ marginBottom:32 }}>
        <Text style={{ fontSize:15, fontWeight:'700', color:C.text, marginBottom:14 }}>📅 Proyección 12 meses</Text>
        {months.map((mo,i) => (
          <View key={i}>
            <TouchableOpacity onPress={() => setExpanded(expanded===i?null:i)}
              style={{ flexDirection:'row', alignItems:'center', paddingVertical:12, borderBottomWidth:1, borderBottomColor:C.border }}>
              <Text style={{ fontSize:13, color:C.text, fontWeight:'600', width:68 }}>{mo.label} {mo.year}</Text>
              <View style={{ flex:1, marginHorizontal:10 }}>
                <View style={{ backgroundColor:C.surface2, borderRadius:99, height:6 }}>
                  <View style={{ backgroundColor:mo.balance>=0?C.accent:C.red, height:6, borderRadius:99, width:`${Math.min(Math.abs(mo.balance)/(avgIncome||1)*100,100)}%` }}/>
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
                  <Text style={{ fontSize:13, color:C.green, fontWeight:'600' }}>{fmt(avgIncome)}</Text>
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
    </ScrollView>
  );
}

// ── Calendario ─────────────────────────────────────────────────
function Calendario({ data, onSave }) {
  const C = useC();
  const [modal, setModal]         = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const emptyF = { title:'', day:'', type:'vencimiento', notifyDaysBefore:'2' };
  const [form, setForm]         = useState(emptyF);
  const [editForm, setEditForm] = useState(emptyF);
  const events = data.events || [];
  const today  = new Date().getDate();

  useEffect(() => { setupNotifications().then(setNotifEnabled); }, []);

  const addEvent = async () => {
    if (!form.title||!form.day) return;
    const dayNum = parseInt(form.day);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) return Alert.alert('Día inválido', 'Ingresá un día entre 1 y 31.');
    const ev = { ...form, id:Date.now().toString(), day:dayNum, notifyDaysBefore:parseInt(form.notifyDaysBefore)||2 };
    if (notifEnabled && ev.notifyDaysBefore) await scheduleEventNotification(ev, ev.notifyDaysBefore);
    onSave({ ...data, events:[...events, ev] });
    setModal(false); setForm(emptyF);
  };
  const openEdit = (ev) => {
    setEditTarget(ev.id);
    setEditForm({ title:ev.title, day:ev.day.toString(), type:ev.type, notifyDaysBefore:(ev.notifyDaysBefore||2).toString() });
    setEditModal(true);
  };
  const saveEdit = async () => {
    const dayNum = parseInt(editForm.day);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) return Alert.alert('Día inválido', 'Ingresá un día entre 1 y 31.');
    const ev = { ...editForm, id:editTarget, day:dayNum, notifyDaysBefore:parseInt(editForm.notifyDaysBefore)||2 };
    if (notifEnabled) { await cancelEventNotification(editTarget); await scheduleEventNotification(ev, ev.notifyDaysBefore); }
    onSave({ ...data, events:events.map(e => e.id===editTarget?ev:e) });
    setEditModal(false);
  };
  const delEvent = (id) => Alert.alert('Eliminar','¿Eliminar este evento?',[
    { text:'Cancelar' },
    { text:'Eliminar', style:'destructive', onPress: async () => { await cancelEventNotification(id); onSave({ ...data, events:events.filter(e => e.id!==id) }); } },
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
      {notifEnabled && <Input label={`Notificar ${frm.notifyDaysBefore} días antes`} value={frm.notifyDaysBefore} onChangeText={v => setFrm(f => ({ ...f, notifyDaysBefore:v }))} placeholder="2" keyboardType="numeric"/>}
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

// ── Planear Tab ────────────────────────────────────────────────
function PlanearTab({ data, onSave }) {
  const C = useC();
  const [sub, setSub] = useState('ahorros');
  const SUBS = [
    { key:'ahorros',    label:'🐷 Ahorros' },
    { key:'deudas',     label:'💳 Deudas' },
    { key:'calendario', label:'📅 Eventos' },
    { key:'proyeccion', label:'📈 Proyección' },
  ];
  return (
    <ScreenWithHeader header={
      <Text style={{ fontSize:22, fontWeight:'800', color:'#fff', letterSpacing:-0.5 }}>Planear</Text>
    }>
      <View style={{ flex:1 }}>
        <View style={{ paddingHorizontal:16, paddingTop:16, marginBottom:4 }}>
          <SubTabs tabs={SUBS} active={sub} onChange={setSub}/>
        </View>
        {sub==='ahorros'    && <Ahorros    data={data} onSave={onSave}/>}
        {sub==='deudas'     && <Deudas     data={data} onSave={onSave}/>}
        {sub==='calendario' && <Calendario data={data} onSave={onSave}/>}
        {sub==='proyeccion' && <Proyeccion data={data}/>}
      </View>
    </ScreenWithHeader>
  );
}

// ── Perfil Tab ─────────────────────────────────────────────────
function PerfilTab({ user, onLogout, connectWhatsApp, dark, setDark }) {
  const C = useC();
  const meta     = user?.user_metadata || {};
  const nombre   = meta.nombre || user?.email?.split('@')[0] || 'Usuario';
  const apellido = meta.apellido || '';
  const fullName = meta.full_name || `${nombre} ${apellido}`.trim();
  const initial  = fullName[0]?.toUpperCase() || 'U';

  return (
    <View style={{ flex:1, backgroundColor:C.header }}>
      {/* Header with avatar */}
      <View style={{ paddingTop:52, paddingBottom:32, alignItems:'center' }}>
        <View style={{
          width:80, height:80, borderRadius:40, backgroundColor:C.surface,
          alignItems:'center', justifyContent:'center',
          borderWidth:3, borderColor:'#ffffff35', marginBottom:14,
          shadowColor:'#000', shadowOffset:{width:0,height:4}, shadowOpacity:0.2, shadowRadius:8, elevation:8,
        }}>
          <Text style={{ fontSize:34, fontWeight:'800', color:C.accent }}>{initial}</Text>
        </View>
        <Text style={{ fontSize:20, fontWeight:'800', color:'#fff', letterSpacing:-0.3 }}>{fullName}</Text>
        <Text style={{ fontSize:13, color:'#ffffff65', marginTop:4 }}>{user?.email}</Text>
      </View>

      {/* Content */}
      <View style={{ flex:1, backgroundColor:C.bg, borderTopLeftRadius:28, borderTopRightRadius:28, overflow:'hidden' }}>
        <ScrollView contentContainerStyle={{ padding:20 }} showsVerticalScrollIndicator={false}>
          <Card style={{ marginBottom:14 }}>
            {/* WhatsApp */}
            <TouchableOpacity onPress={connectWhatsApp}
              style={{ flexDirection:'row', alignItems:'center', paddingVertical:14, borderBottomWidth:1, borderBottomColor:C.border }}>
              <IconCircle icon="💬" bg="#00c48c22" size={44}/>
              <View style={{ flex:1, marginLeft:14 }}>
                <Text style={{ fontSize:15, fontWeight:'600', color:C.text }}>Conectar WhatsApp</Text>
                <Text style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Registrá gastos y consultá tu balance</Text>
              </View>
              <Text style={{ color:C.textMuted, fontSize:20 }}>›</Text>
            </TouchableOpacity>

            {/* Dark mode toggle */}
            <View style={{ flexDirection:'row', alignItems:'center', paddingVertical:14 }}>
              <IconCircle icon={dark ? '🌙' : '☀️'} bg={C.accent+'22'} size={44}/>
              <Text style={{ flex:1, fontSize:15, fontWeight:'600', color:C.text, marginLeft:14 }}>Modo oscuro</Text>
              <Switch
                value={dark} onValueChange={setDark}
                trackColor={{ false:C.border, true:C.accent }}
                thumbColor="#fff"
              />
            </View>
          </Card>

          {/* Logout */}
          <Card>
            <TouchableOpacity onPress={onLogout}
              style={{ flexDirection:'row', alignItems:'center', paddingVertical:6 }}>
              <IconCircle icon="🚪" bg={C.red+'22'} size={44}/>
              <Text style={{ flex:1, fontSize:15, fontWeight:'600', color:C.red, marginLeft:14 }}>Cerrar sesión</Text>
              <Text style={{ color:C.red, fontSize:20 }}>›</Text>
            </TouchableOpacity>
          </Card>

          <View style={{ height:40 }}/>
        </ScrollView>
      </View>
    </View>
  );
}

// ── Tab Bar ────────────────────────────────────────────────────
const TABS = [
  { key:'inicio',       label:'Inicio',    icon:'🏠' },
  { key:'analisis',     label:'Análisis',  icon:'📊' },
  { key:'__add__',      label:'',          icon:'+' },
  { key:'planear',      label:'Planear',   icon:'📅' },
  { key:'perfil',       label:'Perfil',    icon:'👤' },
];

// ── Main ───────────────────────────────────────────────────────
export default function MainApp({ user, onLogout }) {
  const [tab,  setTab]    = useState('inicio');
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [dark, setDarkState] = useState(false);
  const [monthPicker, setMonthPicker] = useState(false);
  const [addModal, setAddModal] = useState(false);

  const C = mkTheme(dark);

  // Persist dark mode preference
  const setDark = useCallback(async (val) => {
    setDarkState(val);
    try { await AsyncStorage.setItem('orbe_dark', val ? '1' : '0'); } catch {}
  }, []);

  const meta     = user?.user_metadata || {};
  const nombre   = meta.nombre || user?.email?.split('@')[0] || 'Usuario';
  const fullName = meta.full_name || nombre;

  const connectWhatsApp = async () => {
    const message = `ORBE_ACTIVATE:${user.id}:${fullName}`;
    const waUrl   = `https://wa.me/5491125728211?text=${encodeURIComponent(message)}`;
    const canOpen = await Linking.canOpenURL(waUrl).catch(() => false);
    if (canOpen) {
      Linking.openURL(waUrl);
    } else {
      Alert.alert('WhatsApp no encontrado', 'Instalá WhatsApp para conectar con Orbe.');
    }
  };

  useEffect(() => {
    // Load dark mode preference
    AsyncStorage.getItem('orbe_dark').then(v => { if (v === '1') setDarkState(true); }).catch(() => {});
    // Load data
    loadData(user.id)
      .then(d => { setData(d || defaultData()); setLoading(false); })
      .catch(() => { setData(defaultData()); setLoading(false); });
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

  const handleTab = (key) => {
    if (key === '__add__') { setAddModal(true); return; }
    setTab(key);
  };

  return (
    <ThemeCtx.Provider value={C}>
      <View style={{ flex:1, backgroundColor:C.bg }}>
        {/* Content */}
        <View style={{ flex:1 }}>
          {tab==='inicio'   && <InicioTab data={data} onMonthPress={() => setMonthPicker(true)}/>}
          {tab==='analisis' && <AnalisisTab data={data} onSave={save}/>}
          {tab==='planear'  && <PlanearTab data={data} onSave={save}/>}
          {tab==='perfil'   && <PerfilTab user={user} onLogout={onLogout} connectWhatsApp={connectWhatsApp} dark={dark} setDark={setDark}/>}
        </View>

        {/* Bottom Tab Bar */}
        <View style={{
          flexDirection:'row', backgroundColor:C.tab,
          paddingBottom:24, paddingTop:8,
          borderTopWidth:1, borderTopColor:C.border,
          shadowColor:'#000', shadowOffset:{width:0,height:-3},
          shadowOpacity:C.dark?0.4:0.07, shadowRadius:12, elevation:12,
        }}>
          {TABS.map(t => {
            const isActive = tab === t.key;
            const isAdd    = t.key === '__add__';
            return (
              <TouchableOpacity key={t.key} onPress={() => handleTab(t.key)}
                style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
                {isAdd ? (
                  <View style={{
                    width:54, height:54, borderRadius:27, backgroundColor:C.accent,
                    alignItems:'center', justifyContent:'center',
                    marginTop:-22,
                    shadowColor:C.accent, shadowOffset:{width:0,height:6},
                    shadowOpacity:0.45, shadowRadius:12, elevation:10,
                  }}>
                    <Text style={{ color:'#fff', fontSize:28, fontWeight:'300', lineHeight:32 }}>+</Text>
                  </View>
                ) : (
                  <>
                    <View style={{
                      width:46, height:34, borderRadius:17, alignItems:'center', justifyContent:'center',
                      backgroundColor: isActive ? C.accent+'20' : 'transparent',
                    }}>
                      <Text style={{ fontSize:21, opacity: isActive ? 1 : 0.38 }}>{t.icon}</Text>
                    </View>
                    <Text style={{ fontSize:10, fontWeight:'600', color: isActive ? C.accent : C.textDim, marginTop:1 }}>{t.label}</Text>
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
      </View>
    </ThemeCtx.Provider>
  );
}
