export const DEFAULT_CATEGORIES = {
  'Vivienda':'🏠','Alimentación':'🛒','Transporte':'🚗','Salud':'💊',
  'Entretenimiento':'🎬','Ropa':'👗','Educación':'📚','Servicios':'💡',
  'Préstamo tarjeta':'💳','Otros':'📦',
};

export const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
export const MONTH_FULL  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

export const EVENT_TYPES = [
  { key:'vencimiento', label:'Vencimiento 📋', color:'#e53935' },
  { key:'pago',        label:'Pago 💳',        color:'#4aba82' },
  { key:'recordatorio',label:'Recordatorio 🔔', color:'#2e9960' },
];

export const cMonth = new Date().getMonth();
export const cYear  = new Date().getFullYear();

export const fmt = (n) => {
  const abs = Math.abs(Number(n));
  return (n < 0 ? '-$' : '$') + abs.toLocaleString('es-AR', { maximumFractionDigits: 0 });
};

export const fmtAmt = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

export const parseAmt = (v) => parseFloat(String(v || '0').replace(/\./g, '')) || 0;

export const parseDateParts = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
};

export const defaultData = () => ({
  transactions: [],
  budgets: Object.keys(DEFAULT_CATEGORIES).map(cat => ({ cat, limit: 0 })),
  categories: DEFAULT_CATEGORIES,
  savings: [],
  debts: [],
  events: [],
  selectedMonth: cMonth,
  selectedYear: cYear,
});
