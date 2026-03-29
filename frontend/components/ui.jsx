import React from 'react';
import {
  View, Text, TouchableOpacity, TextInput,
  Modal, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useC } from '../lib/theme';
import { fmt, fmtAmt } from '../lib/constants';

export function Card({ children, style }) {
  const C = useC();
  return (
    <View style={[{
      backgroundColor: C.surface, borderRadius: 24, padding: 20,
      shadowColor: C.dark ? '#000' : '#005247',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: C.dark ? 0.5 : 0.10, shadowRadius: 24,
      elevation: 8, borderWidth: 1, borderColor: C.border,
    }, style]}>
      {children}
    </View>
  );
}

export function Btn({ label, onPress, variant = 'primary', style, disabled, loading }) {
  const C = useC();
  const isPrimary = variant === 'primary';
  const isDanger  = variant === 'danger';
  const bg    = isPrimary ? C.accent : isDanger ? C.redLight : C.surface2;
  const color = isPrimary ? '#fff'   : isDanger ? C.red      : C.textMuted;
  const isDisabled = disabled || loading;
  return (
    <TouchableOpacity onPress={onPress} disabled={isDisabled}
      style={[{
        borderRadius: 18, padding: 15, alignItems: 'center', backgroundColor: bg,
        opacity: isDisabled ? 0.7 : 1,
        borderWidth: 1, borderColor: isPrimary ? C.gold : C.border,
        ...(isPrimary ? {
          shadowColor: C.gold,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.35,
          shadowRadius: 16,
          elevation: 10,
        } : {}),
      }, style]}>
      {loading
        ? <ActivityIndicator size="small" color={isPrimary ? '#fff' : C.textMuted}/>
        : <Text style={{ fontSize: 14, fontWeight: '800', color, letterSpacing: 0.2 }}>{label}</Text>
      }
    </TouchableOpacity>
  );
}

export function FieldError({ error }) {
  const C = useC();
  if (!error) return null;
  return <Text style={{ fontSize: 11, color: C.red, marginTop: -8, marginBottom: 10, marginLeft: 4 }}>⚠ {error}</Text>;
}

export function EmptyState({ icon, title, subtitle, actionLabel, onAction }) {
  const C = useC();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 }}>
      <Text style={{ fontSize: 48, marginBottom: 14 }}>{icon}</Text>
      <Text style={{ fontSize: 15, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: subtitle ? 6 : 0 }}>{title}</Text>
      {subtitle ? <Text style={{ fontSize: 13, color: C.textMuted, textAlign: 'center', lineHeight: 20 }}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity onPress={onAction} style={{ marginTop: 16, backgroundColor: C.accent, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: C.gold }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function SaveIndicator({ saving }) {
  const C = useC();
  if (!saving) return null;
  return (
    <View style={{ position: 'absolute', top: 52, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: C.border, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 8, zIndex: 999 }}>
      <ActivityIndicator size="small" color={C.accent}/>
      <Text style={{ fontSize: 12, color: C.textMuted, fontWeight: '600' }}>Guardando...</Text>
    </View>
  );
}

export function Input({ label, value, onChangeText, placeholder, keyboardType, prefix, multiline, secureTextEntry, error }) {
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
    <View style={{ marginBottom: 14 }}>
      {label ? (
        <Text style={{ fontSize: 10, fontWeight: '800', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>
          {label}
        </Text>
      ) : null}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: C.surface2, borderWidth: 1, borderColor: error ? C.red : C.border, borderRadius: 18,
      }}>
        {prefix ? <Text style={{ paddingLeft: 16, paddingRight: 4, color: C.textMuted, fontSize: 15 }}>{prefix}</Text> : null}
        <TextInput
          style={{
            flex: 1, padding: 15, paddingLeft: prefix ? 4 : 16,
            fontSize: 14, color: C.text,
            ...(multiline ? { minHeight: 80, textAlignVertical: 'top' } : {}),
          }}
          value={value} onChangeText={handleChange}
          placeholder={placeholder} placeholderTextColor={C.textDim}
          keyboardType={isAmount ? 'numeric' : (keyboardType || 'default')} multiline={multiline}
          secureTextEntry={secureTextEntry}
        />
      </View>
      {error ? <Text style={{ fontSize: 11, color: C.red, marginTop: 4, marginLeft: 4 }}>⚠ {error}</Text> : null}
    </View>
  );
}

export function Chip({ label, active, onPress, style }) {
  const C = useC();
  return (
    <TouchableOpacity onPress={onPress} style={[{
      paddingHorizontal: 16, paddingVertical: 9, borderRadius: 99,
      backgroundColor: active ? C.accent : C.surface2,
      borderWidth: 1, borderColor: active ? C.gold : C.border,
      ...(active ? {
        shadowColor: C.gold,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
      } : {}),
    }, style]}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: active ? '#fff' : C.textMuted, letterSpacing: 0.1 }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function IconCircle({ icon, bg, size = 46 }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.42 }}>{icon}</Text>
    </View>
  );
}

export function SubTabs({ tabs, active, onChange }) {
  const C = useC();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: C.surface2, borderRadius: 18, padding: 4 }}>
      {tabs.map(t => (
        <TouchableOpacity key={t.key} onPress={() => onChange(t.key)}
          style={{
            flex: 1, paddingVertical: 10, borderRadius: 14, alignItems: 'center',
            backgroundColor: active === t.key ? C.accent : 'transparent',
            borderWidth: active === t.key ? 1 : 0, borderColor: C.gold,
            ...(active === t.key ? {
              shadowColor: C.gold, shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.25, shadowRadius: 8, elevation: 6,
            } : {}),
          }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: active === t.key ? '#fff' : C.textMuted }}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function ModalSheet({ visible, onClose, title, children }) {
  const C = useC();
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' }}>
          <View style={{
            backgroundColor: C.surface, borderTopLeftRadius: 36, borderTopRightRadius: 36,
            padding: 24, paddingBottom: 40, maxHeight: '90%',
            borderTopWidth: 1, borderColor: C.gold + '60',
            shadowColor: C.gold, shadowOffset: { width: 0, height: -8 },
            shadowOpacity: 0.15, shadowRadius: 24,
          }}>
            <View style={{ width: 40, height: 4, backgroundColor: C.gold + '60', borderRadius: 2, alignSelf: 'center', marginBottom: 22 }} />
            {title && (
              <Text style={{ fontSize: 20, fontWeight: '800', color: C.text, marginBottom: 20, letterSpacing: -0.4 }}>
                {title}
              </Text>
            )}
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
      position: 'absolute', bottom: 28, right: 20, width: 56, height: 56, borderRadius: 28,
      backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: C.gold,
      shadowColor: C.gold, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 20, elevation: 12,
    }}>
      <Text style={{ color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '300' }}>+</Text>
    </TouchableOpacity>
  );
}

export function TxRow({ tx, cats, onDelete, onEdit }) {
  const C = useC();
  const isGasto  = tx.type === 'gasto';
  const isIncome = tx.type === 'ingreso' || tx.type === 'sueldo';
  const icon     = tx.type === 'sueldo' ? '💼' : tx.type === 'ahorro_meta' ? '🐷' : (cats[tx.category] || '📦');
  const iconBg   = isGasto ? C.red + '18' : isIncome ? C.green + '18' : C.accent + '18';
  const catLabel = tx.type === 'sueldo' ? 'Sueldo' : tx.type === 'ahorro_meta' ? 'Ahorro' : tx.category;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
      <IconCircle icon={icon} bg={iconBg} size={44} />
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: C.text, letterSpacing: -0.2 }}>{tx.description}</Text>
        <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{catLabel} · {tx.date}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {(tx.source === 'gasto_en_dolares' || tx.currency === 'USD' || tx.currency === 'usd') && (
            <View style={{ backgroundColor: '#22c55e22', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: '#22c55e' }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: '#22c55e', letterSpacing: 0.5 }}>USD</Text>
            </View>
          )}
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: isGasto ? C.red : C.green, letterSpacing: -0.3 }}>
              {isGasto ? '-' : '+'}{tx.currency === 'usd' && tx.amountUSD ? `USD ${tx.amountUSD}` : fmt(tx.amount)}
            </Text>
            {tx.currency === 'usd' && tx.amountUSD && (
              <Text style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(tx.amount)}</Text>
            )}
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
          {onEdit && (
            <TouchableOpacity onPress={() => onEdit(tx)}>
              <Text style={{ fontSize: 10, color: C.accent, fontWeight: '700' }}>Editar</Text>
            </TouchableOpacity>
          )}
          {onDelete && (
            <TouchableOpacity onPress={() => onDelete(tx.id)}>
              <Text style={{ fontSize: 10, color: C.textMuted }}>Eliminar</Text>
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
  const maxVal = Math.max(...data.map(d => Math.max(d.income || 0, d.expense || 0)), 1);
  const BAR_H = 110;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingTop: 8 }}>
      {data.map((d, i) => (
        <View key={i} style={{ flex: 1, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: BAR_H }}>
            <View style={{ flex: 1, backgroundColor: C.green, borderRadius: 8, height: Math.max(4, (d.income / maxVal) * BAR_H), opacity: 0.9 }} />
            <View style={{ flex: 1, backgroundColor: C.red, borderRadius: 8, height: Math.max(4, (d.expense / maxVal) * BAR_H), opacity: 0.8 }} />
          </View>
          <Text style={{ fontSize: 9, color: C.textMuted, marginTop: 5 }}>{d.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function ScreenWithHeader({ header, children }) {
  const C = useC();
  return (
    <View style={{ flex: 1, backgroundColor: C.header }}>
      {/* Decorative blobs */}
      <View style={{
        position: 'absolute', top: -60, right: -60,
        width: 220, height: 220, borderRadius: 110,
        backgroundColor: '#FFFFFF06', pointerEvents: 'none',
      }} />
      <View style={{
        position: 'absolute', top: 40, left: -80,
        width: 200, height: 200, borderRadius: 100,
        backgroundColor: '#C9A84C08', pointerEvents: 'none',
      }} />
      <View style={{ paddingTop: 56, paddingHorizontal: 22, paddingBottom: 30 }}>
        {header}
      </View>
      <View style={{
        flex: 1, backgroundColor: C.bg,
        borderTopLeftRadius: 36, borderTopRightRadius: 36,
        overflow: 'hidden', borderTopWidth: 1, borderColor: C.gold + '60',
        shadowColor: C.gold, shadowOffset: { width: 0, height: -6 },
        shadowOpacity: 0.12, shadowRadius: 20,
      }}>
        {children}
      </View>
    </View>
  );
}
