import { createContext, useContext } from 'react';

export const ThemeCtx = createContext(null);
export const useC = () => useContext(ThemeCtx);

export const mkTheme = (dark) => ({
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
