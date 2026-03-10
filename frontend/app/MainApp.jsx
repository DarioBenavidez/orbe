
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Modal, ActivityIndicator, Alert, Platform,
  KeyboardAvoidingView, Switch, Linking,
} from 'react-native';
import { loadData, saveData } from '../constants/supabase';

// ── Intentamos importar notificaciones (requiere expo-notifications instalado) ──
let Notifications = null;
try { Notifications = require('expo-notifications'); } catch {}

const C = {
  bg: '#f0f4f1', surface: '#ffffff', surface2: '#f0f4f1',
  border: '#dde8e2',
  accent: '#2e7d5a',
  gold: '#c9a84c',
  text: '#1a2e22', textMuted: '#607a6c', textDim: '#a8bdb4',
  red: '#c0392b', redLight: '#fff5f5',
  blue: '#2563eb',
};

const DEFAULT_CATEGORIES = {
  'Vivienda':'🏠','Alimentación':'🛒','Transporte':'🚗','Salud':'💊',
  'Entretenimiento':'🎬','Ropa':'👗','Educación':'📚','Servicios':'💡',
  'Préstamo tarjeta':'💳','Otros':'📦',
};

const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MONTH_FULL  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const EVENT_TYPES = [
  {key:'vencimiento', label:'Vencimiento 📋', color:'#c0392b'},
  {key:'pago',        label:'Pago 💳',        color:'#2e7d5a'},
  {key:'recordatorio',label:'Recordatorio 🔔', color:'#c9a84c'},
];

const currentMonth = new Date().getMonth();
const currentYear  = new Date().getFullYear();
const fmt = (n) => { const abs=Math.abs(Number(n)); return (n<0?'-$':'$')+abs.toLocaleString('es-AR',{maximumFractionDigits:0}); };

// ── Helper para parsear fecha sin problema de timezone ──────
const parseDateParts = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { year: y, month: m - 1, day: d }; // month es 0-indexed
};

const defaultData = () => ({
  transactions: [],
  budgets: Object.keys(DEFAULT_CATEGORIES).map(cat => ({ cat, limit: 0 })),
  categories: DEFAULT_CATEGORIES,
  savings: [],
  debts: [],
  events: [],
  selectedMonth: currentMonth,
  selectedYear: currentYear,
});

// ── Notificaciones ─────────────────────────────────────────
async function setupNotifications() {
  if (!Notifications) return false;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowAlert:true, shouldPlaySound:true, shouldSetBadge:false }),
    });
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
    let notifyDate = new Date(now.getFullYear(), now.getMonth(), event.day - daysBefore, 9, 0, 0);
    if (notifyDate <= now) notifyDate.setMonth(notifyDate.getMonth() + 1);
    await Notifications.scheduleNotificationAsync({
      content: { title: '🔔 Orbe', body: `Recordatorio: ${event.title} vence el día ${event.day}`, sound: true },
      trigger: { date: notifyDate },
      identifier: `event-${event.id}`,
    });
  } catch {}
}

async function cancelEventNotification(eventId) {
  if (!Notifications) return;
  try { await Notifications.cancelScheduledNotificationAsync(`event-${eventId}`); } catch {}
}

// ── Shared Components ──────────────────────────────────────
function Card({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>;
}

function Btn({ label, onPress, variant = 'primary', style }) {
  const bg    = variant==='primary'?C.accent:variant==='danger'?C.redLight:C.surface2;
  const color = variant==='primary'?'#fff':variant==='danger'?C.red:C.textMuted;
  const border= variant==='primary'?{ borderWidth:1.5, borderColor:C.gold }:variant==='danger'?{}:{ borderWidth:1, borderColor:C.border };
  return (
    <TouchableOpacity onPress={onPress} style={[s.btn, { backgroundColor:bg }, border, style]}>
      <Text style={[s.btnText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Input({ label, value, onChangeText, placeholder, keyboardType, prefix, multiline }) {
  return (
    <View style={{ marginBottom:14 }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <View style={{ flexDirection:'row', alignItems:'center' }}>
        {prefix ? <Text style={{ position:'absolute', left:12, color:C.textMuted, zIndex:1 }}>{prefix}</Text> : null}
        <TextInput
          style={[s.input, { flex:1 }, prefix && { paddingLeft:24 }, multiline && { minHeight:80, textAlignVertical:'top' }]}
          value={value} onChangeText={onChangeText}
          placeholder={placeholder} placeholderTextColor={C.textDim}
          keyboardType={keyboardType || 'default'} multiline={multiline}
        />
      </View>
    </View>
  );
}

function Chip({ label, active, onPress, style }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip,
      active ? { backgroundColor:C.accent, borderWidth:1.5, borderColor:C.gold }
             : { backgroundColor:C.surface2, borderWidth:1, borderColor:C.border },
      style]}>
      <Text style={{ fontSize:12, fontWeight:'600', color:active?'#fff':C.textMuted }}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Resumen ────────────────────────────────────────────────
function Resumen({ data }) {
  const txs = data.transactions.filter(t => {
    const { month, year } = parseDateParts(t.date);
    return month === data.selectedMonth && year === data.selectedYear;
  });
  const totalIncome  = txs.filter(t=>t.type==='ingreso'||t.type==='sueldo').reduce((a,t)=>a+t.amount,0);
  const totalExpense = txs.filter(t=>t.type==='gasto').reduce((a,t)=>a+t.amount,0);
  const totalDebt    = data.debts.reduce((a,d)=>a+(d.remaining||0),0);
  const totalSavings = data.savings.reduce((a,sv)=>a+(sv.current||0),0);
  const balance      = totalIncome - totalExpense;
  const cats         = data.categories || DEFAULT_CATEGORIES;
  const topGastos    = Object.entries(
    txs.filter(t=>t.type==='gasto').reduce((acc,t)=>{ acc[t.category]=(acc[t.category]||0)+t.amount; return acc; },{})
  ).sort((a,b)=>b[1]-a[1]).slice(0,3);
  const maxG = topGastos[0]?.[1] || 1;

  const today = new Date().getDate();
  const upcoming = (data.events||[]).filter(ev=>ev.day>=today && ev.day<=today+7).sort((a,b)=>a.day-b.day).slice(0,3);

  return (
    <ScrollView style={s.tabContent} showsVerticalScrollIndicator={false}>
      <View style={s.heroCard}>
        <Text style={s.heroLabel}>BALANCE DEL MES</Text>
        <View style={{ flexDirection:'row', alignItems:'baseline', gap:4 }}>
          <Text style={s.heroDollar}>$</Text>
          <Text style={s.heroAmount}>{Math.abs(balance).toLocaleString('es-AR',{maximumFractionDigits:0})}</Text>
        </View>
        <Text style={s.heroSub}>{MONTH_NAMES[data.selectedMonth]} {data.selectedYear}</Text>
        <View style={s.heroStats}>
          {[['↑ Ingresos',totalIncome,'#a8f0c8'],['↓ Gastos',totalExpense,'#ffb3b3'],['◆ Deudas',totalDebt,'#ffffffaa'],['🐷 Ahorros',totalSavings,'#fff']].map(([lbl,val,clr])=>(
            <View key={lbl}>
              <Text style={s.heroStatLabel}>{lbl}</Text>
              <Text style={[s.heroStatVal,{color:clr}]}>{fmt(val)}</Text>
            </View>
          ))}
        </View>
      </View>

      {upcoming.length > 0 && (
        <Card style={{ marginBottom:14, borderLeftWidth:3, borderLeftColor:C.red }}>
          <Text style={s.cardTitle}>⚠️ Próximos vencimientos</Text>
          {upcoming.map(ev => (
            <View key={ev.id} style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical:6, borderBottomWidth:1, borderBottomColor:C.border }}>
              <Text style={{ fontSize:13, color:C.text }}>{ev.title}</Text>
              <Text style={{ fontSize:13, color:C.red, fontWeight:'600' }}>Día {ev.day}</Text>
            </View>
          ))}
        </Card>
      )}

      <Card style={{ marginBottom:14 }}>
        <Text style={s.cardTitle}>🔥 Top gastos del mes</Text>
        {topGastos.length===0 ? <Text style={s.empty}>Sin gastos registrados</Text> : topGastos.map(([cat,val])=>(
          <View key={cat} style={{ marginBottom:12 }}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:4 }}>
              <Text style={{ color:C.text, fontSize:14 }}>{cats[cat]||'📦'} {cat}</Text>
              <Text style={{ color:C.red, fontWeight:'600' }}>{fmt(val)}</Text>
            </View>
            <View style={{ backgroundColor:C.surface2, borderRadius:99, height:6 }}>
              <View style={{ backgroundColor:C.red, height:6, borderRadius:99, width:`${(val/maxG)*100}%`, opacity:0.7 }}/>
            </View>
          </View>
        ))}
      </Card>

      <Card style={{ marginBottom:32 }}>
        <Text style={s.cardTitle}>🕐 Últimas transacciones</Text>
        {txs.length===0 ? <Text style={s.empty}>Sin transacciones este mes</Text> : txs.slice(-5).reverse().map(t=>(
          <View key={t.id} style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical:10, borderBottomWidth:1, borderBottomColor:C.border }}>
            <View style={{ flex:1 }}>
              <Text style={{ fontSize:14, color:C.text, fontWeight:'500' }}>{t.description}</Text>
              <Text style={{ fontSize:12, color:C.textMuted }}>{t.date} · {t.type==='sueldo'?'💼 Sueldo':t.type==='ahorro_meta'?'🐷 Ahorro':t.category}</Text>
            </View>
            <Text style={{ color:t.type==='gasto'?C.red:C.accent, fontWeight:'600' }}>
              {t.type==='gasto'?'-':'+'}{fmt(t.amount)}
            </Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

// ── Transacciones ──────────────────────────────────────────
function Transacciones({ data, onSave }) {
  const [modal, setModal] = useState(false);
  const cats = data.categories || DEFAULT_CATEGORIES;
  const [form, setForm] = useState({
    type:'gasto', description:'', amount:'',
    category: Object.keys(cats)[0] || 'Alimentación',
    date: new Date().toISOString().split('T')[0], savingsId:'',
  });
  const txs = data.transactions.filter(t => {
    const { month, year } = parseDateParts(t.date);
    return month === data.selectedMonth && year === data.selectedYear;
  }).slice().reverse();

  const TYPES = [
    {key:'gasto',label:'Gasto'},{key:'ingreso',label:'Ingreso'},
    {key:'sueldo',label:'Sueldo 💼'},{key:'ahorro_meta',label:'Ahorro 🐷'},
  ];

  const addTx = () => {
    if (!form.description || !form.amount) return;
    const amt = parseFloat(form.amount);
    let newData = { ...data };
    const tx = { ...form, id:Date.now().toString(), amount:amt };
    if (form.type==='ahorro_meta' && form.savingsId) {
      const savings = data.savings.map(sv =>
        sv.id===form.savingsId
          ? { ...sv, current:(sv.current||0)+amt, history:[...(sv.history||[]),{date:form.date,amount:amt}] }
          : sv
      );
      newData = { ...newData, savings };
    }
    newData = { ...newData, transactions:[...newData.transactions, tx] };
    onSave(newData);
    setModal(false);
    setForm({ type:'gasto', description:'', amount:'', category:Object.keys(cats)[0]||'Alimentación', date:new Date().toISOString().split('T')[0], savingsId:'' });
  };

  const delTx = (id) => Alert.alert('Eliminar','¿Eliminar esta transacción?',[
    {text:'Cancelar'},
    {text:'Eliminar',style:'destructive',onPress:()=>onSave({...data,transactions:data.transactions.filter(t=>t.id!==id)})},
  ]);

  return (
    <View style={{ flex:1 }}>
      <ScrollView style={s.tabContent} showsVerticalScrollIndicator={false}>
        <Card style={{ marginBottom:32 }}>
          {txs.length===0 ? <Text style={s.empty}>Sin transacciones este mes</Text> : txs.map(t=>(
            <View key={t.id} style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:12, borderBottomWidth:1, borderBottomColor:C.border }}>
              <View style={{ flex:1 }}>
                <Text style={{ fontSize:14, color:C.text, fontWeight:'500' }}>{t.description}</Text>
                <Text style={{ fontSize:12, color:C.textMuted }}>{t.date} · {t.type==='sueldo'?'💼 Sueldo':t.type==='ahorro_meta'?'🐷 Ahorro':`${cats[t.category]||'📦'} ${t.category}`}</Text>
              </View>
              <View style={{ alignItems:'flex-end' }}>
                <Text style={{ color:t.type==='gasto'?C.red:C.accent, fontWeight:'600' }}>{t.type==='gasto'?'-':'+'}{fmt(t.amount)}</Text>
                <TouchableOpacity onPress={()=>delTx(t.id)}>
                  <Text style={{ color:C.red, fontSize:11, marginTop:2 }}>Eliminar</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </Card>
      </ScrollView>

      <TouchableOpacity style={s.fab} onPress={()=>setModal(true)}>
        <Text style={{ color:'#fff', fontSize:28, lineHeight:32 }}>+</Text>
      </TouchableOpacity>

      <Modal visible={modal} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{ flex:1 }}>
          <View style={s.modalOverlay}>
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>Nueva transacción</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:16 }}>
                {TYPES.map(t => (
                  <Chip key={t.key} label={t.label} active={form.type===t.key}
                    onPress={()=>setForm(f=>({...f,type:t.key}))} style={{ marginRight:8 }}/>
                ))}
              </ScrollView>
              <Input label="Descripción" value={form.description} onChangeText={v=>setForm(f=>({...f,description:v}))} placeholder="Ej: Supermercado"/>
              <Input label="Monto" value={form.amount} onChangeText={v=>setForm(f=>({...f,amount:v}))} placeholder="0" keyboardType="numeric" prefix="$"/>
              {(form.type==='gasto'||form.type==='ingreso') && (
                <>
                  <Text style={s.label}>Categoría</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:14 }}>
                    {Object.entries(cats).map(([cat,icon])=>(
                      <Chip key={cat} label={`${icon} ${cat}`} active={form.category===cat}
                        onPress={()=>setForm(f=>({...f,category:cat}))} style={{ marginRight:8 }}/>
                    ))}
                  </ScrollView>
                </>
              )}
              {form.type==='ahorro_meta' && (
                <>
                  <Text style={s.label}>Meta de ahorro</Text>
                  {data.savings.length===0
                    ? <Text style={{ color:C.textMuted, fontSize:13, marginBottom:14 }}>Primero creá una meta en Ahorros.</Text>
                    : <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:14 }}>
                        {data.savings.map(sv=>(
                          <Chip key={sv.id} label={`🐷 ${sv.name}`} active={form.savingsId===sv.id}
                            onPress={()=>setForm(f=>({...f,savingsId:sv.id}))} style={{ marginRight:8 }}/>
                        ))}
                      </ScrollView>
                  }
                  <View style={{ backgroundColor:C.surface2, borderRadius:12, padding:12, marginBottom:14 }}>
                    <Text style={{ color:C.textMuted, fontSize:12 }}>💡 No impacta el balance del mes, solo actualiza tu meta.</Text>
                  </View>
                </>
              )}
              <View style={{ flexDirection:'row', gap:10 }}>
                <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={()=>setModal(false)}/>
                <Btn label="Guardar" style={{ flex:1 }} onPress={addTx}/>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Presupuesto ────────────────────────────────────────────
function Presupuesto({ data, onSave }) {
  const cats = data.categories || DEFAULT_CATEGORIES;
  const txs = data.transactions.filter(t => {
    const { month, year } = parseDateParts(t.date);
    return month === data.selectedMonth && year === data.selectedYear && t.type === 'gasto';
  });
  const expByCat = txs.reduce((acc,t)=>{ acc[t.category]=(acc[t.category]||0)+t.amount; return acc; },{});
  const totalBudget = data.budgets.reduce((s,b)=>s+b.limit,0);
  const totalSpent  = Object.values(expByCat).reduce((s,v)=>s+v,0);
  const [editing, setEditing]   = useState({});
  const [catModal, setCatModal] = useState(false);
  const [catForm,  setCatForm]  = useState({ icon:'📦', name:'' });
  const [editCat,  setEditCat]  = useState(null);

  const updateLimit = (cat, val) =>
    onSave({ ...data, budgets:data.budgets.map(b=>b.cat===cat?{...b,limit:parseFloat(val)||0}:b) });

  const addCategory = () => {
    if (!catForm.name.trim()) return;
    const key = catForm.name.trim();
    const newCats = { ...cats, [key]: catForm.icon };
    const newBudgets = [...data.budgets, { cat:key, limit:0 }];
    onSave({ ...data, categories:newCats, budgets:newBudgets });
    setCatModal(false); setCatForm({ icon:'📦', name:'' });
  };

  const deleteCategory = (cat) => Alert.alert('Eliminar categoría', `¿Eliminar "${cat}"?`,[
    {text:'Cancelar'},
    {text:'Eliminar',style:'destructive',onPress:()=>{
      const newCats = {...cats}; delete newCats[cat];
      onSave({...data, categories:newCats, budgets:data.budgets.filter(b=>b.cat!==cat)});
    }},
  ]);

  const saveEditCat = () => {
    if (!editCat) return;
    const newCats = {...cats};
    if (editCat.newName && editCat.newName !== editCat.key) {
      newCats[editCat.newName] = editCat.icon;
      delete newCats[editCat.key];
      const budgets = data.budgets.map(b=>b.cat===editCat.key?{...b,cat:editCat.newName}:b);
      onSave({...data, categories:newCats, budgets});
    } else {
      newCats[editCat.key] = editCat.icon;
      onSave({...data, categories:newCats});
    }
    setEditCat(null);
  };

  const ICON_OPTIONS = ['🏠','🛒','🚗','💊','🎬','👗','📚','💡','💳','📦','🍕','✈️','🐾','🏋️','🎮','💈','🌿','🎁','🏖️','💰'];

  return (
    <ScrollView style={s.tabContent} showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection:'row', gap:12, marginBottom:16 }}>
        <Card style={{ flex:1 }}><Text style={s.label}>PRESUPUESTO</Text><Text style={s.bigNum}>{fmt(totalBudget)}</Text></Card>
        <Card style={{ flex:1 }}><Text style={s.label}>GASTADO</Text><Text style={[s.bigNum,{color:totalSpent>totalBudget?C.red:C.text}]}>{fmt(totalSpent)}</Text></Card>
      </View>
      <Card style={{ marginBottom:32 }}>
        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <Text style={s.cardTitle}>Límites por categoría</Text>
          <TouchableOpacity onPress={()=>setCatModal(true)} style={[s.chip,{backgroundColor:C.accent,borderWidth:1.5,borderColor:C.gold,paddingHorizontal:10,paddingVertical:5}]}>
            <Text style={{ color:'#fff', fontSize:12, fontWeight:'700' }}>+ Nueva</Text>
          </TouchableOpacity>
        </View>
        {data.budgets.map(b => {
          const spent = expByCat[b.cat] || 0;
          const pct   = b.limit>0 ? Math.min((spent/b.limit)*100,100) : 0;
          return (
            <View key={b.cat} style={{ marginBottom:16 }}>
              <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <View style={{ flexDirection:'row', alignItems:'center', gap:6, flex:1 }}>
                  <TouchableOpacity onPress={()=>setEditCat({key:b.cat,icon:cats[b.cat]||'📦',newName:b.cat})}>
                    <Text style={{ fontSize:14, color:C.text }}>{cats[b.cat]||'📦'} {b.cat} ✏️</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                  <Text style={{ fontSize:12, color:C.textMuted }}>{fmt(spent)} /</Text>
                  {editing[b.cat]
                    ? <TextInput
                        style={{ borderWidth:1, borderColor:C.border, borderRadius:8, padding:4, width:80, fontSize:13, color:C.text, textAlign:'right', backgroundColor:C.surface2 }}
                        defaultValue={b.limit.toString()} keyboardType="numeric"
                        onBlur={e=>{ updateLimit(b.cat,e.nativeEvent.text); setEditing(ed=>({...ed,[b.cat]:false})); }}
                        autoFocus/>
                    : <TouchableOpacity onPress={()=>setEditing(ed=>({...ed,[b.cat]:true}))}>
                        <Text style={{ fontSize:13, color:C.accent, fontWeight:'600' }}>{fmt(b.limit)} ✏️</Text>
                      </TouchableOpacity>
                  }
                  <TouchableOpacity onPress={()=>deleteCategory(b.cat)}>
                    <Text style={{ fontSize:13, color:C.red }}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={{ backgroundColor:C.surface2, borderRadius:99, height:6 }}>
                <View style={{ backgroundColor:pct>=100?C.red:C.accent, height:6, borderRadius:99, width:`${pct}%` }}/>
              </View>
            </View>
          );
        })}
      </Card>

      <Modal visible={catModal} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{ flex:1 }}>
          <View style={s.modalOverlay}>
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>Nueva categoría</Text>
              <Text style={s.label}>Ícono</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:14 }}>
                {ICON_OPTIONS.map(icon=>(
                  <TouchableOpacity key={icon} onPress={()=>setCatForm(f=>({...f,icon}))}
                    style={{ width:40,height:40,borderRadius:12,marginRight:8,alignItems:'center',justifyContent:'center',
                      backgroundColor:catForm.icon===icon?C.accentLight:C.surface2,
                      borderWidth:catForm.icon===icon?1.5:1,
                      borderColor:catForm.icon===icon?C.gold:C.border }}>
                    <Text style={{ fontSize:20 }}>{icon}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Input label="Nombre" value={catForm.name} onChangeText={v=>setCatForm(f=>({...f,name:v}))} placeholder="Ej: Mascotas"/>
              <View style={{ flexDirection:'row', gap:10 }}>
                <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={()=>setCatModal(false)}/>
                <Btn label="Guardar" style={{ flex:1 }} onPress={addCategory}/>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!editCat} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{ flex:1 }}>
          <View style={s.modalOverlay}>
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>Editar categoría</Text>
              <Text style={s.label}>Ícono</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:14 }}>
                {ICON_OPTIONS.map(icon=>(
                  <TouchableOpacity key={icon} onPress={()=>setEditCat(ec=>({...ec,icon}))}
                    style={{ width:40,height:40,borderRadius:12,marginRight:8,alignItems:'center',justifyContent:'center',
                      backgroundColor:editCat?.icon===icon?C.accentLight:C.surface2,
                      borderWidth:editCat?.icon===icon?1.5:1,
                      borderColor:editCat?.icon===icon?C.gold:C.border }}>
                    <Text style={{ fontSize:20 }}>{icon}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Input label="Nombre" value={editCat?.newName||''} onChangeText={v=>setEditCat(ec=>({...ec,newName:v}))} placeholder="Nombre"/>
              <View style={{ flexDirection:'row', gap:10 }}>
                <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={()=>setEditCat(null)}/>
                <Btn label="Guardar" style={{ flex:1 }} onPress={saveEditCat}/>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

// ── Ahorros ────────────────────────────────────────────────
function Ahorros({ data, onSave }) {
  const [modal, setModal]         = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm]           = useState({ name:'', target:'', current:'' });
  const [editForm, setEditForm]   = useState({ name:'', target:'', current:'' });

  const addAhorro = () => {
    if (!form.name || !form.target) return;
    onSave({ ...data, savings:[...data.savings,{ ...form, id:Date.now().toString(), target:parseFloat(form.target), current:parseFloat(form.current||0), history:[] }] });
    setModal(false); setForm({ name:'', target:'', current:'' });
  };
  const openEdit = (sv) => { setEditTarget(sv.id); setEditForm({ name:sv.name, target:sv.target.toString(), current:sv.current.toString() }); setEditModal(true); };
  const saveEdit = () => {
    onSave({ ...data, savings:data.savings.map(sv=>sv.id===editTarget?{...sv,name:editForm.name,target:parseFloat(editForm.target)||sv.target,current:parseFloat(editForm.current)||0}:sv) });
    setEditModal(false);
  };
  const delAhorro = (id) => Alert.alert('Eliminar','¿Eliminar este ahorro?',[
    {text:'Cancelar'},
    {text:'Eliminar',style:'destructive',onPress:()=>onSave({...data,savings:data.savings.filter(sv=>sv.id!==id)})},
  ]);

  return (
    <View style={{ flex:1 }}>
      <ScrollView style={s.tabContent} showsVerticalScrollIndicator={false}>
        {data.savings.length===0 ? <Card><Text style={s.empty}>Sin metas de ahorro</Text></Card> : data.savings.map(sv=>{
          const pct     = Math.min((sv.current/sv.target)*100,100);
          const history = sv.history || [];
          return (
            <Card key={sv.id} style={{ marginBottom:14 }}>
              <View style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:8 }}>
                <Text style={{ fontSize:15, fontWeight:'700', color:C.text }}>🐷 {sv.name}</Text>
                <View style={{ flexDirection:'row', gap:12 }}>
                  <TouchableOpacity onPress={()=>openEdit(sv)}><Text style={{ color:C.accent, fontSize:12, fontWeight:'600' }}>Editar</Text></TouchableOpacity>
                  <TouchableOpacity onPress={()=>delAhorro(sv.id)}><Text style={{ color:C.red, fontSize:12 }}>Eliminar</Text></TouchableOpacity>
                </View>
              </View>
              <View style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:8 }}>
                <Text style={{ color:C.textMuted, fontSize:13 }}>Acumulado: {fmt(sv.current)}</Text>
                <Text style={{ color:C.text, fontSize:13, fontWeight:'600' }}>Meta: {fmt(sv.target)}</Text>
              </View>
              <View style={{ backgroundColor:C.surface2, borderRadius:99, height:8 }}>
                <View style={{ backgroundColor:C.accent, height:8, borderRadius:99, width:`${pct}%` }}/>
              </View>
              <Text style={{ color:C.accent, fontSize:12, marginTop:4, textAlign:'right' }}>{pct.toFixed(0)}%</Text>
              {history.length > 0 && (
                <View style={{ marginTop:12, borderTopWidth:1, borderTopColor:C.border, paddingTop:10 }}>
                  <Text style={{ fontSize:10, fontWeight:'700', color:C.textMuted, marginBottom:6, letterSpacing:0.5 }}>HISTORIAL DE DEPÓSITOS</Text>
                  {history.slice().reverse().map((h,i)=>(
                    <View key={i} style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical:3 }}>
                      <Text style={{ fontSize:12, color:C.textMuted }}>{h.date}</Text>
                      <Text style={{ fontSize:12, color:C.accent, fontWeight:'600' }}>+{fmt(h.amount)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>
          );
        })}
        <View style={{ height:100 }}/>
      </ScrollView>
      <TouchableOpacity style={s.fab} onPress={()=>setModal(true)}>
        <Text style={{ color:'#fff', fontSize:28, lineHeight:32 }}>+</Text>
      </TouchableOpacity>
      {[{visible:modal,title:'Nueva meta de ahorro',frm:form,setFrm:setForm,onSave:addAhorro,onClose:()=>setModal(false)},
        {visible:editModal,title:'Editar ahorro',frm:editForm,setFrm:setEditForm,onSave:saveEdit,onClose:()=>setEditModal(false)}
      ].map(({visible,title,frm,setFrm,onSave:onS,onClose},idx)=>(
        <Modal key={idx} visible={visible} animationType="slide" transparent>
          <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{ flex:1 }}>
            <View style={s.modalOverlay}><View style={s.modalCard}>
              <Text style={s.modalTitle}>{title}</Text>
              <Input label="Nombre" value={frm.name} onChangeText={v=>setFrm(f=>({...f,name:v}))} placeholder="Ej: Vacaciones"/>
              <Input label="Meta" value={frm.target} onChangeText={v=>setFrm(f=>({...f,target:v}))} placeholder="0" keyboardType="numeric" prefix="$"/>
              <Input label={idx===0?'Ya tengo':'Acumulado'} value={frm.current} onChangeText={v=>setFrm(f=>({...f,current:v}))} placeholder="0" keyboardType="numeric" prefix="$"/>
              <View style={{ flexDirection:'row', gap:10 }}>
                <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={onClose}/>
                <Btn label="Guardar" style={{ flex:1 }} onPress={onS}/>
              </View>
            </View></View>
          </KeyboardAvoidingView>
        </Modal>
      ))}
    </View>
  );
}

// ── Deudas ─────────────────────────────────────────────────
function Deudas({ data, onSave }) {
  const [modal, setModal]         = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const emptyForm = { name:'', remaining:'', installment:'', remainingInstallments:'' };
  const [form, setForm]           = useState(emptyForm);
  const [editForm, setEditForm]   = useState(emptyForm);
  const [payAmt, setPayAmt]       = useState({});

  const totalDebt       = data.debts.reduce((s,d)=>s+d.remaining,0);
  const monthlyPayments = data.debts.reduce((s,d)=>s+d.installment,0);

  const calcInst = (remaining, installment) => {
    if (!remaining||!installment||parseFloat(installment)===0) return '';
    return Math.ceil(parseFloat(remaining)/parseFloat(installment)).toString();
  };
  const endMonth = (instStr) => {
    if (!instStr) return '';
    const n = parseInt(instStr);
    const d = new Date(); d.setMonth(d.getMonth()+n-1);
    return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  };

  const addDeuda = () => {
    if (!form.name||!form.remaining) return;
    const installment = parseFloat(form.installment)||0;
    const ri = parseInt(form.remainingInstallments)||(installment>0?Math.ceil(parseFloat(form.remaining)/installment):0);
    onSave({...data,debts:[...data.debts,{name:form.name,total:parseFloat(form.remaining),remaining:parseFloat(form.remaining),installment,remainingInstallments:ri,id:Date.now().toString()}]});
    setModal(false); setForm(emptyForm);
  };

  const openEdit = (d) => {
    setEditTarget(d.id);
    setEditForm({ name:d.name, remaining:d.remaining.toString(), installment:d.installment.toString(), remainingInstallments:d.remainingInstallments.toString() });
    setEditModal(true);
  };

  const saveEdit = () => {
    const installment = parseFloat(editForm.installment)||0;
    const ri = parseInt(editForm.remainingInstallments)||(installment>0?Math.ceil(parseFloat(editForm.remaining)/installment):0);
    onSave({...data,debts:data.debts.map(d=>d.id===editTarget?{...d,name:editForm.name,remaining:parseFloat(editForm.remaining)||d.remaining,installment,remainingInstallments:ri}:d)});
    setEditModal(false);
  };

  const pay = (id) => {
    const amt = parseFloat(payAmt[id]||0); if (!amt) return;
    const deuda = data.debts.find(d=>d.id===id);
    const debts = data.debts.map(d=>d.id===id?{...d,remaining:Math.max(0,d.remaining-amt),remainingInstallments:Math.max(0,(d.remainingInstallments||0)-1)}:d);
    const tx = {id:Date.now().toString(),type:'gasto',description:`Pago: ${deuda.name}`,amount:amt,category:'Préstamo tarjeta',date:new Date().toISOString().split('T')[0]};
    onSave({...data,debts,transactions:[...data.transactions,tx]});
    setPayAmt({...payAmt,[id]:''});
  };

  const delDeuda = (id) => Alert.alert('Eliminar','¿Eliminar esta deuda?',[
    {text:'Cancelar'},
    {text:'Eliminar',style:'destructive',onPress:()=>onSave({...data,debts:data.debts.filter(d=>d.id!==id)})},
  ]);

  const DeudaForm = ({ frm, setFrm }) => (
    <>
      <Input label="Nombre / Acreedor" value={frm.name} onChangeText={v=>setFrm(f=>({...f,name:v}))} placeholder="Ej: Tarjeta Visa"/>
      <Input label="Monto pendiente" value={frm.remaining} onChangeText={v=>setFrm(f=>({...f,remaining:v,remainingInstallments:calcInst(v,f.installment)}))} placeholder="0" keyboardType="numeric" prefix="$"/>
      <Input label="Cuota mensual" value={frm.installment} onChangeText={v=>setFrm(f=>({...f,installment:v,remainingInstallments:calcInst(f.remaining,v)}))} placeholder="0" keyboardType="numeric" prefix="$"/>
      <View style={{ backgroundColor:C.surface2, borderRadius:12, padding:12, marginBottom:14 }}>
        <Text style={{ fontSize:13, color:C.accent }}>
          📅 {frm.remainingInstallments ? `${frm.remainingInstallments} cuotas · Termina ${endMonth(frm.remainingInstallments)}` : 'Ingresá monto y cuota para calcular'}
        </Text>
      </View>
    </>
  );

  return (
    <View style={{ flex:1 }}>
      <ScrollView style={s.tabContent} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection:'row', gap:12, marginBottom:16 }}>
          <Card style={{ flex:1 }}><Text style={s.label}>DEUDA TOTAL</Text><Text style={[s.bigNum,{color:C.red}]}>{fmt(totalDebt)}</Text></Card>
          {monthlyPayments>0 && <Card style={{ flex:1 }}><Text style={s.label}>CUOTAS MES</Text><Text style={s.bigNum}>{fmt(monthlyPayments)}</Text></Card>}
        </View>
        {data.debts.length===0 ? <Card><Text style={s.empty}>Sin deudas registradas</Text></Card> : data.debts.map(d=>{
          const pct = d.total>0 ? Math.min(((d.total-d.remaining)/d.total)*100,100) : 0;
          return (
            <Card key={d.id} style={{ marginBottom:14 }}>
              <View style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:8 }}>
                <Text style={{ fontSize:15, fontWeight:'700', color:C.text }}>💳 {d.name}</Text>
                <View style={{ flexDirection:'row', gap:12 }}>
                  <TouchableOpacity onPress={()=>openEdit(d)}><Text style={{ color:C.accent, fontSize:12, fontWeight:'600' }}>Editar</Text></TouchableOpacity>
                  <TouchableOpacity onPress={()=>delDeuda(d.id)}><Text style={{ color:C.red, fontSize:12 }}>Eliminar</Text></TouchableOpacity>
                </View>
              </View>
              <View style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:4 }}>
                <Text style={{ color:C.textMuted, fontSize:13 }}>Restante: {fmt(d.remaining)}</Text>
                {d.installment>0 && <Text style={{ color:C.text, fontSize:13 }}>Cuota: {fmt(d.installment)}</Text>}
              </View>
              {d.remainingInstallments>0 && (
                <Text style={{ color:C.accent, fontSize:12, marginBottom:8 }}>
                  📅 {d.remainingInstallments} cuotas · Termina {endMonth(d.remainingInstallments.toString())}
                </Text>
              )}
              <View style={{ backgroundColor:C.surface2, borderRadius:99, height:8, marginBottom:12 }}>
                <View style={{ backgroundColor:C.accent, height:8, borderRadius:99, width:`${pct}%` }}/>
              </View>
              <View style={{ flexDirection:'row', gap:8, alignItems:'center' }}>
                <TextInput style={[s.input,{flex:1,padding:9}]} value={payAmt[d.id]||''} onChangeText={v=>setPayAmt(p=>({...p,[d.id]:v}))} placeholder="Registrar pago $" keyboardType="numeric" placeholderTextColor={C.textDim}/>
                <Btn label="Pagar" onPress={()=>pay(d.id)} style={{ paddingHorizontal:16, paddingVertical:9 }}/>
              </View>
              <Text style={{ fontSize:11, color:C.textMuted, marginTop:6 }}>💡 El pago se registra como gasto automáticamente</Text>
            </Card>
          );
        })}
        <View style={{ height:100 }}/>
      </ScrollView>
      <TouchableOpacity style={s.fab} onPress={()=>setModal(true)}>
        <Text style={{ color:'#fff', fontSize:28, lineHeight:32 }}>+</Text>
      </TouchableOpacity>
      <Modal visible={modal} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{ flex:1 }}>
          <View style={s.modalOverlay}><View style={s.modalCard}>
            <Text style={s.modalTitle}>Nueva deuda</Text>
            <DeudaForm frm={form} setFrm={setForm}/>
            <View style={{ flexDirection:'row', gap:10 }}>
              <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={()=>setModal(false)}/>
              <Btn label="Guardar" style={{ flex:1 }} onPress={addDeuda}/>
            </View>
          </View></View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={editModal} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{ flex:1 }}>
          <View style={s.modalOverlay}><View style={s.modalCard}>
            <Text style={s.modalTitle}>Editar deuda</Text>
            <DeudaForm frm={editForm} setFrm={setEditForm}/>
            <View style={{ flexDirection:'row', gap:10 }}>
              <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={()=>setEditModal(false)}/>
              <Btn label="Guardar" style={{ flex:1 }} onPress={saveEdit}/>
            </View>
          </View></View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Proyección ─────────────────────────────────────────────
function Proyeccion({ data }) {
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
    <ScrollView style={s.tabContent} showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection:'row', gap:12, marginBottom:16, flexWrap:'wrap' }}>
        {[{label:'Ingreso estimado',val:avgIncome,sub:'Prom. 3 meses'},{label:'Gastos fijos',val:budgetTotal,sub:`${budgetItems.length} categorías`},{label:'Cuotas este mes',val:months[0].totalCuotas,sub:`${months[0].cuotas.length} cuota(s)`},{label:'Balance estimado',val:months[0].balance,sub:months[0].balance>=0?'Superávit':'Déficit'}].map(k=>(
          <Card key={k.label} style={{ flex:1, minWidth:'45%', marginBottom:4 }}>
            <Text style={s.label}>{k.label.toUpperCase()}</Text>
            <Text style={[s.bigNum,{color:k.label==='Balance estimado'&&k.val<0?C.red:C.text}]}>{fmt(k.val)}</Text>
            <Text style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>{k.sub}</Text>
          </Card>
        ))}
      </View>
      <Card style={{ marginBottom:32 }}>
        <Text style={s.cardTitle}>📅 Proyección 12 meses</Text>
        {months.map((mo,i)=>(
          <View key={i}>
            <TouchableOpacity onPress={()=>setExpanded(expanded===i?null:i)} style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:12, borderBottomWidth:1, borderBottomColor:C.border }}>
              <Text style={{ fontSize:14, color:C.text, fontWeight:'500', width:70 }}>{mo.label} {mo.year}</Text>
              <View style={{ flex:1, marginHorizontal:10 }}>
                <View style={{ backgroundColor:C.surface2, borderRadius:99, height:6 }}>
                  <View style={{ backgroundColor:mo.balance>=0?C.accent:C.red, height:6, borderRadius:99, width:`${Math.min(Math.abs(mo.balance)/(avgIncome||1)*100,100)}%` }}/>
                </View>
              </View>
              <Text style={{ fontSize:13, fontWeight:'600', color:mo.balance>=0?C.accent:C.red, width:80, textAlign:'right' }}>{fmt(mo.balance)}</Text>
              <Text style={{ fontSize:12, color:C.textMuted, marginLeft:6 }}>{expanded===i?'▲':'▼'}</Text>
            </TouchableOpacity>
            {expanded===i && (
              <View style={{ backgroundColor:C.surface2, borderRadius:12, padding:12, marginVertical:6 }}>
                <Text style={{ fontSize:11, fontWeight:'700', color:C.textMuted, marginBottom:6 }}>DETALLE</Text>
                <View style={{ flexDirection:'row', justifyContent:'space-between' }}><Text style={{ fontSize:13, color:C.textMuted }}>📈 Ingreso estimado</Text><Text style={{ fontSize:13, color:C.accent, fontWeight:'600' }}>{fmt(avgIncome)}</Text></View>
                {budgetItems.map(b=>(<View key={b.cat} style={{ flexDirection:'row', justifyContent:'space-between' }}><Text style={{ fontSize:13, color:C.textMuted }}>{cats[b.cat]||'📦'} {b.cat}</Text><Text style={{ fontSize:13, color:C.red }}>-{fmt(b.limit)}</Text></View>))}
                {mo.cuotas.map((c,ci)=>(<View key={ci} style={{ flexDirection:'row', justifyContent:'space-between' }}><Text style={{ fontSize:13, color:C.textMuted }}>💳 {c.name}</Text><Text style={{ fontSize:13, color:C.red }}>-{fmt(c.amount)}</Text></View>))}
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

// ── Calendario ─────────────────────────────────────────────
function Calendario({ data, onSave }) {
  const [modal, setModal]         = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const emptyForm = { title:'', day:'', type:'vencimiento', notifyDaysBefore:'2' };
  const [form, setForm]     = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);
  const events = data.events || [];
  const today  = new Date().getDate();
  const month  = MONTH_FULL[data.selectedMonth];

  useEffect(()=>{ setupNotifications().then(setNotifEnabled); },[]);

  const addEvent = async () => {
    if (!form.title || !form.day) return;
    const ev = { ...form, id:Date.now().toString(), day:parseInt(form.day), notifyDaysBefore:parseInt(form.notifyDaysBefore)||2 };
    if (notifEnabled && ev.notifyDaysBefore) await scheduleEventNotification(ev, ev.notifyDaysBefore);
    onSave({ ...data, events:[...events, ev] });
    setModal(false); setForm(emptyForm);
  };

  const openEdit = (ev) => {
    setEditTarget(ev.id);
    setEditForm({ title:ev.title, day:ev.day.toString(), type:ev.type, notifyDaysBefore:(ev.notifyDaysBefore||2).toString() });
    setEditModal(true);
  };

  const saveEdit = async () => {
    const ev = { ...editForm, id:editTarget, day:parseInt(editForm.day), notifyDaysBefore:parseInt(editForm.notifyDaysBefore)||2 };
    if (notifEnabled) { await cancelEventNotification(editTarget); await scheduleEventNotification(ev, ev.notifyDaysBefore); }
    onSave({ ...data, events:events.map(e=>e.id===editTarget?ev:e) });
    setEditModal(false);
  };

  const delEvent = (id) => Alert.alert('Eliminar','¿Eliminar este evento?',[
    {text:'Cancelar'},
    {text:'Eliminar',style:'destructive',onPress:async()=>{ await cancelEventNotification(id); onSave({...data,events:events.filter(e=>e.id!==id)}); }},
  ]);

  const byType = EVENT_TYPES.reduce((acc,t)=>{ acc[t.key]=events.filter(e=>e.type===t.key).sort((a,b)=>a.day-b.day); return acc; },{});

  const EventForm = ({ frm, setFrm }) => (
    <>
      <Input label="Título" value={frm.title} onChangeText={v=>setFrm(f=>({...f,title:v}))} placeholder="Ej: Vencimiento luz"/>
      <Input label="Día del mes" value={frm.day} onChangeText={v=>setFrm(f=>({...f,day:v}))} placeholder="1-31" keyboardType="numeric"/>
      <Text style={s.label}>Tipo</Text>
      <View style={{ flexDirection:'row', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        {EVENT_TYPES.map(t=>(
          <Chip key={t.key} label={t.label} active={frm.type===t.key} onPress={()=>setFrm(f=>({...f,type:t.key}))}/>
        ))}
      </View>
      {notifEnabled && (
        <Input label={`Notificar ${frm.notifyDaysBefore} días antes`} value={frm.notifyDaysBefore}
          onChangeText={v=>setFrm(f=>({...f,notifyDaysBefore:v}))} placeholder="2" keyboardType="numeric"/>
      )}
      {!notifEnabled && (
        <View style={{ backgroundColor:'#fff8e1', borderRadius:12, padding:12, marginBottom:14 }}>
          <Text style={{ fontSize:12, color:'#a07800' }}>🔔 Para recibir notificaciones instalá expo-notifications</Text>
        </View>
      )}
    </>
  );

  return (
    <View style={{ flex:1 }}>
      <ScrollView style={s.tabContent} showsVerticalScrollIndicator={false}>
        <Card style={{ marginBottom:14 }}>
          <Text style={s.cardTitle}>📆 {month} {data.selectedYear}</Text>
          <View style={{ flexDirection:'row', flexWrap:'wrap', gap:6 }}>
            {Array.from({length:31},(_,i)=>i+1).map(day=>{
              const dayEvents = events.filter(e=>e.day===day);
              const isToday   = day===today && data.selectedMonth===currentMonth && data.selectedYear===currentYear;
              const hasEvent  = dayEvents.length>0;
              const typeColor = hasEvent ? EVENT_TYPES.find(t=>t.key===dayEvents[0].type)?.color : null;
              return (
                <View key={day} style={{ width:36, height:36, borderRadius:10, alignItems:'center', justifyContent:'center',
                  backgroundColor: isToday ? C.accent : hasEvent ? typeColor+'22' : C.surface2,
                  borderWidth: hasEvent||isToday ? 1.5 : 1,
                  borderColor: isToday ? C.gold : hasEvent ? typeColor : C.border }}>
                  <Text style={{ fontSize:11, fontWeight: isToday||hasEvent?'700':'400', color:isToday?'#fff':hasEvent?typeColor:C.textMuted }}>{day}</Text>
                </View>
              );
            })}
          </View>
          <View style={{ flexDirection:'row', gap:16, marginTop:12, flexWrap:'wrap' }}>
            {EVENT_TYPES.map(t=>(
              <View key={t.key} style={{ flexDirection:'row', alignItems:'center', gap:4 }}>
                <View style={{ width:10, height:10, borderRadius:5, backgroundColor:t.color }}/>
                <Text style={{ fontSize:10, color:C.textMuted }}>{t.label.split(' ')[0]}</Text>
              </View>
            ))}
          </View>
        </Card>

        {EVENT_TYPES.map(t=>(
          byType[t.key].length>0 && (
            <Card key={t.key} style={{ marginBottom:14 }}>
              <Text style={[s.cardTitle,{color:t.color}]}>{t.label}</Text>
              {byType[t.key].map(ev=>{
                const daysLeft = ev.day - today;
                return (
                  <View key={ev.id} style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:10, borderBottomWidth:1, borderBottomColor:C.border }}>
                    <View style={{ flex:1 }}>
                      <Text style={{ fontSize:14, color:C.text, fontWeight:'500' }}>{ev.title}</Text>
                      <Text style={{ fontSize:11, color:C.textMuted }}>
                        Día {ev.day}
                        {data.selectedMonth===currentMonth && daysLeft>=0 && daysLeft<=7 && (
                          <Text style={{ color:C.red, fontWeight:'600' }}> · ⚠️ en {daysLeft===0?'hoy':daysLeft+' días'}</Text>
                        )}
                        {notifEnabled && ev.notifyDaysBefore && <Text> · 🔔 {ev.notifyDaysBefore}d antes</Text>}
                      </Text>
                    </View>
                    <View style={{ flexDirection:'row', gap:10 }}>
                      <TouchableOpacity onPress={()=>openEdit(ev)}><Text style={{ color:C.accent, fontSize:12, fontWeight:'600' }}>Editar</Text></TouchableOpacity>
                      <TouchableOpacity onPress={()=>delEvent(ev.id)}><Text style={{ color:C.red, fontSize:12 }}>Eliminar</Text></TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </Card>
          )
        ))}

        {events.length===0 && <Card><Text style={s.empty}>Sin eventos. Agregá vencimientos o recordatorios.</Text></Card>}
        <View style={{ height:100 }}/>
      </ScrollView>

      <TouchableOpacity style={s.fab} onPress={()=>setModal(true)}>
        <Text style={{ color:'#fff', fontSize:28, lineHeight:32 }}>+</Text>
      </TouchableOpacity>

      <Modal visible={modal} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{ flex:1 }}>
          <View style={s.modalOverlay}><View style={s.modalCard}>
            <Text style={s.modalTitle}>Nuevo evento</Text>
            <EventForm frm={form} setFrm={setForm}/>
            <View style={{ flexDirection:'row', gap:10 }}>
              <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={()=>setModal(false)}/>
              <Btn label="Guardar" style={{ flex:1 }} onPress={addEvent}/>
            </View>
          </View></View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={editModal} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{ flex:1 }}>
          <View style={s.modalOverlay}><View style={s.modalCard}>
            <Text style={s.modalTitle}>Editar evento</Text>
            <EventForm frm={editForm} setFrm={setEditForm}/>
            <View style={{ flexDirection:'row', gap:10 }}>
              <Btn label="Cancelar" variant="ghost" style={{ flex:1 }} onPress={()=>setEditModal(false)}/>
              <Btn label="Guardar" style={{ flex:1 }} onPress={saveEdit}/>
            </View>
          </View></View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Main ───────────────────────────────────────────────────
const TABS = [
  {key:'resumen',      label:'Resumen',    icon:'📊'},
  {key:'transacciones',label:'Movimientos',icon:'💸'},
  {key:'presupuesto',  label:'Presupuesto',icon:'🎯'},
  {key:'ahorros',      label:'Ahorros',    icon:'🐷'},
  {key:'deudas',       label:'Deudas',     icon:'💳'},
  {key:'proyeccion',   label:'Proyección', icon:'📅'},
  {key:'calendario',   label:'Calendario', icon:'📆'},
];

export default function MainApp({ user, onLogout }) {
  const [tab,  setTab]  = useState('resumen');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [monthPicker, setMonthPicker] = useState(false);

  const userName = user?.email?.split('@')[0] || 'Usuario';

const connectWhatsApp = () => {
  const message = `ORBE_ACTIVATE:${user.id}`;
  const url = `whatsapp://send?phone=14155238886&text=${encodeURIComponent(message)}`;
  Linking.openURL(url);
};
  const initial  = userName[0].toUpperCase();

  useEffect(()=>{
    loadData(user.id)
      .then(d=>{ setData(d||defaultData()); setLoading(false); })
      .catch(()=>{ setData(defaultData()); setLoading(false); });
  },[user]);

  const save = useCallback(async (newData) => {
    setData(newData);
    try { await saveData(user.id, newData); } catch {}
  },[user]);

  if (loading) return (
    <View style={[s.center,{backgroundColor:C.bg}]}>
      <ActivityIndicator size="large" color={C.accent}/>
    </View>
  );

  return (
    <View style={{ flex:1, backgroundColor:C.bg }}>
      <View style={s.header}>
        <View style={{ flexDirection:'row', alignItems:'center', gap:10 }}>
          <View style={s.orbeLogo}>
            <View style={s.orbeGlow}/>
            <Text style={{ color:'#fff', fontWeight:'800', fontSize:15, zIndex:1 }}>{initial}</Text>
          </View>
          <View>
            <Text style={{ fontSize:11, color:C.textMuted, fontWeight:'500' }}>Bienvenido a</Text>
<Text style={{ fontSize:17, fontWeight:'800', color:C.text, lineHeight:20 }}>Orbe 👋</Text>
          </View>
        </View>
        <View style={{ flexDirection:'row', gap:8, alignItems:'center' }}>
          <TouchableOpacity onPress={()=>setMonthPicker(true)} style={s.monthBtn}>
            <Text style={{ fontSize:12, color:'#fff', fontWeight:'700' }}>{MONTH_NAMES[data.selectedMonth]} {data.selectedYear}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onLogout} style={s.logoutBtn}>
            <Text style={{ fontSize:12, color:C.textMuted }}>Salir</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ flex:1 }}>
        {tab==='resumen'       && <Resumen       data={data}/>}
        {tab==='transacciones' && <Transacciones data={data} onSave={save}/>}
        {tab==='presupuesto'   && <Presupuesto   data={data} onSave={save}/>}
        {tab==='ahorros'       && <Ahorros       data={data} onSave={save}/>}
        {tab==='deudas'        && <Deudas        data={data} onSave={save}/>}
        {tab==='proyeccion'    && <Proyeccion    data={data}/>}
        {tab==='calendario'    && <Calendario    data={data} onSave={save}/>}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar} contentContainerStyle={{ flexDirection:'row' }}>
        {TABS.map(t=>(
          <TouchableOpacity key={t.key} style={s.tabItem} onPress={()=>setTab(t.key)}>
            <Text style={{ fontSize:20 }}>{t.icon}</Text>
            <Text style={[s.tabLabel,{color:tab===t.key?C.accent:C.textDim}]}>{t.label}</Text>
            {tab===t.key && <View style={s.tabDot}/>}
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={monthPicker} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Seleccionar mes</Text>
            <ScrollView style={{ maxHeight:300 }}>
              {[2026,2027,2028].map(year=>(
                <View key={year}>
                  <Text style={{ color:C.textMuted, fontWeight:'700', marginBottom:8 }}>{year}</Text>
                  <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:12 }}>
                    {MONTH_NAMES.map((m,i)=>(
                      <Chip key={i} label={m} active={data.selectedMonth===i&&data.selectedYear===year}
                        onPress={()=>{ save({...data,selectedMonth:i,selectedYear:year}); setMonthPicker(false); }}/>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
            <Btn label="Cerrar" variant="ghost" onPress={()=>setMonthPicker(false)}/>
          </View>
        </View>
      </Modal>
      <TouchableOpacity
  onPress={connectWhatsApp}
  style={{
    position:'absolute', bottom:100, right:24,
    backgroundColor:'#25D366', borderRadius:28,
    paddingHorizontal:16, paddingVertical:12,
    flexDirection:'row', alignItems:'center', gap:8,
    shadowColor:'#25D366', shadowOffset:{width:0,height:4},
    shadowOpacity:0.4, shadowRadius:12, elevation:8,
  }}>
  <Text style={{fontSize:20}}>💬</Text>
  <Text style={{color:'#fff', fontWeight:'700', fontSize:13}}>Conectar WhatsApp</Text>
</TouchableOpacity>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────
const s = StyleSheet.create({
  center:       { flex:1, alignItems:'center', justifyContent:'center' },
  card:         { backgroundColor:C.surface, borderRadius:20, padding:20, shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.05, shadowRadius:8, elevation:2, borderWidth:1, borderColor:C.border, marginBottom:2 },
  btn:          { borderRadius:12, padding:13, alignItems:'center' },
  btnText:      { fontSize:14, fontWeight:'700' },
  input:        { backgroundColor:C.surface2, borderWidth:1, borderColor:C.border, borderRadius:12, padding:12, fontSize:14, color:C.text },
  label:        { fontSize:10, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 },
  bigNum:       { fontSize:22, fontWeight:'300', color:C.text, letterSpacing:-0.5 },
  cardTitle:    { fontSize:15, fontWeight:'700', color:C.text, marginBottom:16 },
  empty:        { color:C.textDim, fontSize:13, textAlign:'center', paddingVertical:20 },
  chip:         { paddingHorizontal:14, paddingVertical:8, borderRadius:20 },
  fab:          { position:'absolute', bottom:24, right:24, width:56, height:56, borderRadius:28, backgroundColor:C.accent, alignItems:'center', justifyContent:'center', shadowColor:C.accent, shadowOffset:{width:0,height:8}, shadowOpacity:0.35, shadowRadius:16, elevation:8, borderWidth:1.5, borderColor:C.gold },
  modalOverlay: { flex:1, backgroundColor:'#00000040', justifyContent:'flex-end' },
  modalCard:    { backgroundColor:C.surface, borderTopLeftRadius:28, borderTopRightRadius:28, padding:28, paddingBottom:40 },
  modalTitle:   { fontSize:18, fontWeight:'800', color:C.text, marginBottom:20 },
  header:       { backgroundColor:C.surface, paddingTop:52, paddingBottom:14, paddingHorizontal:20, flexDirection:'row', justifyContent:'space-between', alignItems:'center', borderBottomWidth:1, borderBottomColor:C.border },
  orbeLogo:     { width:38, height:38, borderRadius:19, backgroundColor:C.accent, alignItems:'center', justifyContent:'center', borderWidth:2, borderColor:C.gold, overflow:'hidden' },
  orbeGlow:     { position:'absolute', top:'15%', left:'18%', width:'28%', height:'20%', backgroundColor:'rgba(255,255,255,0.35)', borderRadius:99 },
  monthBtn:     { backgroundColor:C.accent, borderRadius:10, paddingHorizontal:14, paddingVertical:6, borderWidth:1.5, borderColor:C.gold },
  logoutBtn:    { backgroundColor:C.bg, borderRadius:10, paddingHorizontal:12, paddingVertical:6, borderWidth:1, borderColor:C.border },
  tabBar:       { backgroundColor:C.surface, borderTopWidth:1, borderTopColor:C.border, paddingBottom:24, paddingTop:10, flexGrow:0 },
  tabItem:      { alignItems:'center', paddingHorizontal:14, gap:2 },
  tabLabel:     { fontSize:9, fontWeight:'600' },
  tabDot:       { width:20, height:3, borderRadius:2, backgroundColor:C.gold, marginTop:1 },
  tabContent:   { flex:1, padding:16 },
  heroCard:     { backgroundColor:C.accent, borderRadius:24, padding:24, marginBottom:16, borderWidth:1.5, borderColor:C.gold },
  heroLabel:    { fontSize:11, color:'#ffffff99', fontWeight:'700', textTransform:'uppercase', letterSpacing:1.5, marginBottom:10 },
  heroDollar:   { fontSize:24, color:'#ffffffcc', fontWeight:'400' },
  heroAmount:   { fontSize:52, color:'#fff', fontWeight:'300', letterSpacing:-2 },
  heroSub:      { fontSize:13, color:'#ffffff70', marginBottom:16 },
  heroStats:    { flexDirection:'row', flexWrap:'wrap', gap:20, paddingTop:16, borderTopWidth:1, borderTopColor:'#ffffff18' },
  heroStatLabel:{ fontSize:10, color:'#ffffff60', textTransform:'uppercase', letterSpacing:0.5, marginBottom:2 },
  heroStatVal:  { fontSize:16, fontWeight:'300' },
  accentLight:  '#e8f5ee',
});
