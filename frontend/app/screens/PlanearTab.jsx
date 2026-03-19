import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useC } from '../../lib/theme';
import { ScreenWithHeader, Chip } from '../../components/ui';
import Ahorros    from '../panels/Ahorros';
import Deudas     from '../panels/Deudas';
import Prestamos  from '../panels/Prestamos';
import Turnos     from '../panels/Turnos';
import Calendario from '../panels/Calendario';
import Proyeccion from '../panels/Proyeccion';

export default function PlanearTab({ data, onSave }) {
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
