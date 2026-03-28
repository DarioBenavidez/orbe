import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useC } from '../../lib/theme';
import { fmt } from '../../lib/constants';
import { Card, EmptyState } from '../../components/ui';

export default function GastosFijos({ data }) {
  const C = useC();
  const gastos = (data.recurringExpenses || []).filter(g => g.active);
  const totalMensual = gastos.reduce((s, g) => s + (g.amount || 0), 0);

  return (
    <ScrollView contentContainerStyle={{ padding:16, paddingBottom:40 }} showsVerticalScrollIndicator={false}>
      {gastos.length > 0 && (
        <Card style={{ marginBottom:14 }}>
          <Text style={{ fontSize:11, fontWeight:'700', color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>Total mensual</Text>
          <Text style={{ fontSize:28, fontWeight:'800', color:C.text, letterSpacing:-0.5 }}>{fmt(totalMensual)}</Text>
          <Text style={{ fontSize:12, color:C.textMuted, marginTop:4 }}>{gastos.length} gasto{gastos.length !== 1 ? 's' : ''} fijo{gastos.length !== 1 ? 's' : ''} activo{gastos.length !== 1 ? 's' : ''}</Text>
        </Card>
      )}

      <Card style={{ marginBottom:32 }}>
        <Text style={{ fontSize:15, fontWeight:'700', color:C.text, marginBottom:14 }}>📌 Mis gastos fijos</Text>
        {gastos.length === 0
          ? <EmptyState icon="📌" title="Sin gastos fijos" subtitle="Pedile al bot de WhatsApp que agregue tus gastos fijos"/>
          : gastos.map((g, i) => (
            <View key={i} style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:12, borderBottomWidth:1, borderBottomColor:C.border }}>
              <View style={{ flex:1 }}>
                <Text style={{ fontSize:14, fontWeight:'700', color:C.text }}>{g.description}</Text>
                <Text style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>
                  {g.category ? `${g.category} · ` : ''}Día {g.day} de cada mes
                </Text>
              </View>
              <Text style={{ fontSize:15, fontWeight:'800', color:C.red, letterSpacing:-0.3 }}>-{fmt(g.amount)}</Text>
            </View>
          ))
        }
      </Card>
    </ScrollView>
  );
}
