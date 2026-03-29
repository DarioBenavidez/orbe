import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useC } from '../../lib/theme';
import { fmt } from '../../lib/constants';
import { BACKEND_URL } from '../../constants/supabase';

const fmtUSD = (n) => { const num = Number(n)||0; return `USD ${num%1===0?num:num.toFixed(2)}`; };
const fmtLoan = (l, dolarBlue) => {
  if (l.currency==='usd' && l.amountUSD) {
    const arsRate = dolarBlue || l.arsRate || null;
    const arsAmt  = arsRate ? l.amountUSD * arsRate : null;
    return arsAmt ? `${fmtUSD(l.amountUSD)} (≈ ${fmt(arsAmt)})` : fmtUSD(l.amountUSD);
  }
  return fmt(l.amount || 0);
};
const fmtLoanRemaining = (l, dolarBlue) => {
  if (l.currency==='usd' && l.amountUSD) {
    const arsRate    = dolarBlue || l.arsRate || null;
    const remainUSD  = l.remainingUSD ?? l.amountUSD;
    const arsAmt     = arsRate ? remainUSD * arsRate : null;
    return arsAmt ? `${fmtUSD(remainUSD)} (≈ ${fmt(arsAmt)})` : fmtUSD(remainUSD);
  }
  return fmt(l.remaining ?? l.amount ?? 0);
};
import { Card, IconCircle } from '../../components/ui';

export default function Prestamos({ data, onSave }) {
  const C = useC();
  const [dolarBlue, setDolarBlue] = useState(null);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/dolar`)
      .then(r => r.json())
      .then(d => { if (d.blue) setDolarBlue(d.blue); })
      .catch(() => {});
  }, []);

  const loans   = data.loans   || [];
  const credits = data.credits || {};

  const loanARS = (l, field) => {
    const raw = l[field] ?? 0;
    if (l.currency === 'usd') {
      const rate = dolarBlue || l.arsRate || 0;
      const usdAmt = field === 'amount' ? l.amountUSD : (l.remainingUSD ?? l.amountUSD ?? 0);
      return rate ? usdAmt * rate : raw;
    }
    return raw;
  };
  const totalPrestado  = loans.reduce((s, l) => s + loanARS(l, 'amount'), 0);
  const totalPendiente = loans.reduce((s, l) => s + loanARS(l, 'remaining'), 0);

  const delLoan = (index) => Alert.alert('Eliminar préstamo', `¿Eliminar el préstamo de ${loans[index].name}?`, [
    { text: 'Cancelar' },
    { text: 'Eliminar', style: 'destructive', onPress: () =>
        onSave({ ...data, loans: loans.filter((_, i) => i !== index) })
    },
  ]);

  if (loans.length === 0 && Object.values(credits).filter(c => c.amount > 0).length === 0) {
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

        {Object.values(credits).filter(c => c.amount > 0).length > 0 && (
          <Card style={{ marginBottom:14, borderLeftWidth:3, borderLeftColor:C.green }}>
            <Text style={{ fontSize:14, fontWeight:'700', color:C.text, marginBottom:12 }}>✅ Saldo a favor</Text>
            {Object.values(credits).filter(c => c.amount > 0).map(c => (
              <View key={c.name} style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical:8, borderBottomWidth:1, borderBottomColor:C.border }}>
                <Text style={{ fontSize:14, color:C.text, fontWeight:'500' }}>{c.name}</Text>
                <Text style={{ fontSize:14, color:C.green, fontWeight:'700' }}>{fmt(c.amount)}</Text>
              </View>
            ))}
            <Text style={{ fontSize:11, color:C.textMuted, marginTop:8 }}>💡 Estos montos se descontarán automáticamente del próximo préstamo</Text>
          </Card>
        )}

        {loans.map((l, i) => {
          const remaining = l.remaining ?? l.amount ?? 0;
          const total     = l.amount || 0;
          const pct       = total > 0 ? Math.min(((total - remaining) / total) * 100, 100) : 0;
          const pagado    = total - remaining;
          return (
            <Card key={l.id || l.name} style={{ marginBottom:12 }}>
              <View style={{ flexDirection:'row', alignItems:'flex-start', marginBottom:12 }}>
                <IconCircle icon="🤝" bg={C.accent+'18'} size={44}/>
                <View style={{ flex:1, marginLeft:12 }}>
                  <View style={{ flexDirection:'row', alignItems:'center', gap:6 }}>
                    <Text style={{ fontSize:15, fontWeight:'700', color:C.text }}>{l.name}</Text>
                    {l.currency==='usd' && <Text style={{ fontSize:10, fontWeight:'700', color:'#22c55e', backgroundColor:'#22c55e22', paddingHorizontal:6, paddingVertical:2, borderRadius:8 }}>USD</Text>}
                    {l.loanType==='fiado' && <Text style={{ fontSize:10, fontWeight:'700', color:C.accent, backgroundColor:C.accent+'22', paddingHorizontal:6, paddingVertical:2, borderRadius:8 }}>Fiado</Text>}
                  </View>
                  <Text style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>
                    Pagado: {fmt(pagado)} · Pendiente: {fmtLoanRemaining(l, dolarBlue)}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => delLoan(i)}>
                  <Text style={{ color:C.red, fontSize:12 }}>Eliminar</Text>
                </TouchableOpacity>
              </View>
              <View style={{ backgroundColor:C.surface2, borderRadius:99, height:8, marginBottom:6 }}>
                <View style={{ backgroundColor: remaining === 0 ? C.green : C.accent, height:8, borderRadius:99, width:`${pct}%` }}/>
              </View>
              <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
                <Text style={{ fontSize:11, color:C.textMuted }}>{fmtLoan(l, dolarBlue)} total</Text>
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
