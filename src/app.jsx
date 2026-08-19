import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  Plus, BarChart3, List, Settings as SettingsIcon,
  Play, Square, Trash2, Download, ChevronDown, ChevronUp, X,
  Camera, Fuel, Wrench, Check
} from 'lucide-react';

// ---------- ХРАНИЛИЩЕ (localStorage) ----------
const getStorage = () => {
  try {
    if (window.storage) return window.storage;
    return window.localStorage;
  } catch (e) {
    return null;
  }
};
const storage = getStorage();
const loadState = () => {
  try {
    const saved = storage?.getItem('courierAppState');
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return null;
};
const saveState = (state) => {
  try {
    storage?.setItem('courierAppState', JSON.stringify(state));
  } catch (e) {}
};

// ---------- КОНСТАНТЫ ----------
const DEFAULT_SETTINGS = {
  vatRates: { uber: 0.23, bolt: 0.08, stuart: 0, glovo: 0, pyszne: 0 },
  ryczaltRate: 0.085,
  uzRate: 0.277,
  zusFixed: 110,
  transitionDate: '2026-09-01',
  partnerCommissionSingle: 29.90,
  partnerCommissionMulti: 49.90,
  customServices: [],
};

const FIXED_SERVICES = ['Uber Eats', 'Bolt Food', 'Stuart', 'Glovo', 'Pyszne.pl'];
const PARTNER_SERVICES = ['Uber Eats', 'Bolt Food', 'Stuart', 'Pyszne.pl']; // Glovo исключён
const SERVICE_COLORS = {
  'Bolt Food': '#4CAF50',
  'Glovo': '#EF6C00',
  'Pyszne.pl': '#E53935',
  'Uber Eats': '#00897B',
  'Stuart': '#D81B60',
};
const PALETTE = ['#4CAF50', '#EF6C00', '#E53935', '#00897B', '#D81B60', '#5E35B1', '#00838F', '#F57F17'];

// ---------- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ----------
const genId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
const formatPLN = (val) => (val ?? 0).toFixed(2) + ' zł';
const formatDate = (iso) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
const formatDateTime = (iso) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const formatTime = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const getWeekStart = (dateStr) => {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = (day === 0 ? 6 : day - 1);
  const monday = new Date(d);
  monday.setDate(d.getDate() - diff);
  monday.setHours(0,0,0,0);
  return monday.toISOString();
};

// ---------- НАЛОГИ ----------
const getBaseNet = (order, settings) => {
  switch(order.service) {
    case 'Uber Eats': return order.amount / (1 + settings.vatRates.uber);
    case 'Bolt Food': return order.amount / (1 + settings.vatRates.bolt);
    case 'Stuart':
    case 'Glovo':
    case 'Pyszne.pl':
      return order.amount;
    default:
      return order.amount;
  }
};

const getTax = (order, settings) => {
  const baseNet = getBaseNet(order, settings);
  const isBefore = new Date(order.date) < new Date(settings.transitionDate);
  switch(order.service) {
    case 'Uber Eats':
      return isBefore ? baseNet * settings.ryczaltRate : baseNet * settings.uzRate;
    case 'Bolt Food':
    case 'Stuart':
      return baseNet * settings.ryczaltRate;
    case 'Glovo':
    case 'Pyszne.pl':
      return baseNet * settings.uzRate;
    default:
      return baseNet * settings.ryczaltRate;
  }
};

const getNetAfterTax = (order, settings) => {
  const baseNet = getBaseNet(order, settings);
  const tax = getTax(order, settings);
  return baseNet - tax;
};

// ---------- КОМИССИЯ ПАРТНЁРА ----------
const computeWeeklyCommissions = (orders, settings) => {
  const weekMap = new Map();
  orders.forEach(order => {
    if (!PARTNER_SERVICES.includes(order.service)) return;
    const weekStart = getWeekStart(order.date);
    if (!weekMap.has(weekStart)) weekMap.set(weekStart, new Set());
    weekMap.get(weekStart).add(order.service);
  });
  const commissions = [];
  weekMap.forEach((services, weekStart) => {
    const count = services.size;
    let commission = 0;
    if (count === 1) commission = settings.partnerCommissionSingle;
    else if (count >= 2) commission = settings.partnerCommissionMulti;
    commissions.push({ weekStart, commission });
  });
  return commissions;
};

// ---------- ОСНОВНОЙ КОМПОНЕНТ ----------
export default function CourierTracker() {
  const [state, setState] = useState(() => loadState() || {
    orders: [],
    shifts: [],
    expenses: [],
    settings: DEFAULT_SETTINGS,
  });

  useEffect(() => {
    saveState(state);
  }, [state]);

  const { orders, shifts, expenses, settings } = state;

  // Вкладки
  const [tab, setTab] = useState('entry'); // 'entry' | 'stats' | 'history' | 'settings'
  const [bruttoMode, setBruttoMode] = useState(true); // true = Брутто, false = Нетто

  // Фильтры
  const [filterType, setFilterType] = useState('week'); // 'today' | 'week' | 'month' | 'custom' | 'all'
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [serviceFilter, setServiceFilter] = useState('all');

  // Активная смена
  const [activeShiftStart, setActiveShiftStart] = useState(null);
  const [showFuelModal, setShowFuelModal] = useState(false);
  const [fuelInput, setFuelInput] = useState('');

  // Скриншот (OCR)
  const [showScreenshotModal, setShowScreenshotModal] = useState(false);
  const [screenshotParsed, setScreenshotParsed] = useState(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);

  // Расходы на обслуживание
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNote, setExpenseNote] = useState('');

  // Импорт
  const fileInputRef = useRef(null);

  // Форма заказа
  const [orderForm, setOrderForm] = useState({
    service: 'Uber Eats',
    amount: '',
    km1: '',
    km2: '',
    tips: '',
    orderType: '',
    weather: '',
    problem: '',
    comment: '',
    date: new Date().toISOString().slice(0,16),
  });
  const [showExtraFields, setShowExtraFields] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const allServices = useMemo(() => {
    return [...FIXED_SERVICES, ...(settings.customServices || [])];
  }, [settings.customServices]);

  // Фильтрация по дате и сервису
  const filteredOrders = useMemo(() => {
    const now = new Date();
    let start, end;
    switch(filterType) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1).toISOString();
        break;
      case 'week': {
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const monday = new Date(now);
        monday.setDate(now.getDate() + diff);
        monday.setHours(0,0,0,0);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate()+7);
        start = monday.toISOString();
        end = sunday.toISOString();
        break;
      }
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        end = new Date(now.getFullYear(), now.getMonth()+1, 1).toISOString();
        break;
      case 'custom':
        start = customStart ? new Date(customStart).toISOString() : new Date(0).toISOString();
        end = customEnd ? new Date(customEnd).toISOString() : new Date(8640000000000000).toISOString();
        break;
      case 'all':
      default:
        start = new Date(0).toISOString();
        end = new Date(8640000000000000).toISOString();
    }
    return orders.filter(o => {
      const d = new Date(o.date).toISOString();
      const inDate = d >= start && d < end;
      const inService = serviceFilter === 'all' || o.service === serviceFilter;
      return inDate && inService;
    });
  }, [orders, filterType, customStart, customEnd, serviceFilter]);

  const filteredShifts = useMemo(() => {
    const now = new Date();
    let start, end;
    switch(filterType) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1).toISOString();
        break;
      case 'week': {
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const monday = new Date(now);
        monday.setDate(now.getDate() + diff);
        monday.setHours(0,0,0,0);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate()+7);
        start = monday.toISOString();
        end = sunday.toISOString();
        break;
      }
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        end = new Date(now.getFullYear(), now.getMonth()+1, 1).toISOString();
        break;
      case 'custom':
        start = customStart ? new Date(customStart).toISOString() : new Date(0).toISOString();
        end = customEnd ? new Date(customEnd).toISOString() : new Date(8640000000000000).toISOString();
        break;
      case 'all':
      default:
        start = new Date(0).toISOString();
        end = new Date(8640000000000000).toISOString();
    }
    return shifts.filter(s => s.start >= start && s.start < end);
  }, [shifts, filterType, customStart, customEnd]);

  const filteredExpenses = useMemo(() => {
    // тот же фильтр по датам
    const now = new Date();
    let start, end;
    switch(filterType) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1).toISOString();
        break;
      case 'week': {
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const monday = new Date(now);
        monday.setDate(now.getDate() + diff);
        monday.setHours(0,0,0,0);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate()+7);
        start = monday.toISOString();
        end = sunday.toISOString();
        break;
      }
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        end = new Date(now.getFullYear(), now.getMonth()+1, 1).toISOString();
        break;
      case 'custom':
        start = customStart ? new Date(customStart).toISOString() : new Date(0).toISOString();
        end = customEnd ? new Date(customEnd).toISOString() : new Date(8640000000000000).toISOString();
        break;
      case 'all':
      default:
        start = new Date(0).toISOString();
        end = new Date(8640000000000000).toISOString();
    }
    return expenses.filter(e => e.date >= start && e.date < end);
  }, [expenses, filterType, customStart, customEnd]);

  // ---------- СТАТИСТИКА ----------
  const stats = useMemo(() => {
    const grossIncome = filteredOrders.reduce((sum, o) => sum + o.amount + (o.tips || 0), 0);
    const netAfterTax = filteredOrders.reduce((sum, o) => sum + getNetAfterTax(o, settings), 0);

    const weekCommissions = computeWeeklyCommissions(filteredOrders, settings);
    const totalCommission = weekCommissions.reduce((sum, w) => sum + w.commission, 0);

    const totalFuel = filteredShifts.reduce((sum, s) => sum + (s.fuelCost || 0), 0);
    const totalMaintenance = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

    let zusDeduction = 0;
    if (filterType === 'month') {
      const hasUberBefore = filteredOrders.some(o => o.service === 'Uber Eats' && new Date(o.date) < new Date(settings.transitionDate));
      if (hasUberBefore) zusDeduction = settings.zusFixed;
    }

    const totalNetProfit = netAfterTax - totalCommission - totalFuel - totalMaintenance - zusDeduction;

    const totalHours = filteredShifts.reduce((sum, s) => {
      const start = new Date(s.start);
      const end = new Date(s.end);
      return sum + (end - start) / 3600000;
    }, 0);

    const incomePerHour = totalHours > 0 ? totalNetProfit / totalHours : 0;
    const avgCheck = filteredOrders.length > 0 ? grossIncome / filteredOrders.length : 0;
    const totalKm = filteredOrders.reduce((sum, o) => sum + (o.km1 || 0) + (o.km2 || 0), 0);

    return {
      grossIncome,
      netAfterTax,
      totalCommission,
      totalFuel,
      totalMaintenance,
      zusDeduction,
      totalNetProfit,
      totalHours,
      incomePerHour,
      avgCheck,
      totalKm,
      orderCount: filteredOrders.length,
    };
  }, [filteredOrders, filteredShifts, filteredExpenses, settings, filterType]);

  // Данные для графиков
  const dailyData = useMemo(() => {
    const map = new Map();
    filteredOrders.forEach(o => {
      const day = formatDate(o.date);
      const value = bruttoMode ? (o.amount + (o.tips || 0)) : getNetAfterTax(o, settings);
      map.set(day, (map.get(day) || 0) + value);
    });
    return Array.from(map.entries()).map(([day, value]) => ({ day, value: Math.round(value * 100) / 100 }));
  }, [filteredOrders, bruttoMode, settings]);

  const serviceData = useMemo(() => {
    const map = new Map();
    filteredOrders.forEach(o => {
      const value = bruttoMode ? (o.amount + (o.tips || 0)) : getNetAfterTax(o, settings);
      map.set(o.service, (map.get(o.service) || 0) + value);
    });
    return Array.from(map.entries()).map(([service, value]) => ({ name: service, value: Math.round(value * 100) / 100 }));
  }, [filteredOrders, bruttoMode, settings]);

  const COLORS = ['#4CAF50', '#EF6C00', '#E53935', '#00897B', '#D81B60', '#5E35B1', '#00838F', '#F57F17'];

  // ---------- ОБРАБОТЧИКИ ----------
  const handleOrderSubmit = (e) => {
    e.preventDefault();
    if (!orderForm.amount) return;
    const newOrder = {
      id: genId(),
      date: new Date(orderForm.date).toISOString(),
      service: orderForm.service,
      amount: parseFloat(orderForm.amount),
      km1: parseFloat(orderForm.km1) || 0,
      km2: parseFloat(orderForm.km2) || 0,
      tips: parseFloat(orderForm.tips) || 0,
      orderType: orderForm.orderType,
      weather: orderForm.weather,
      problem: orderForm.problem,
      comment: orderForm.comment,
    };
    setState(prev => ({ ...prev, orders: [...prev.orders, newOrder] }));
    setOrderForm({
      ...orderForm,
      amount: '',
      km1: '',
      km2: '',
      tips: '',
      orderType: '',
      weather: '',
      problem: '',
      comment: '',
      date: new Date().toISOString().slice(0,16),
    });
    setShowExtraFields(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  };

  const handleStartShift = () => {
    setActiveShiftStart(new Date().toISOString());
  };

  const handleEndShift = () => {
    setShowFuelModal(true);
  };

  const handleFuelSave = () => {
    if (!activeShiftStart) return;
    const shift = {
      id: genId(),
      start: activeShiftStart,
      end: new Date().toISOString(),
      fuelCost: parseFloat(fuelInput) || 0,
    };
    setState(prev => ({ ...prev, shifts: [...prev.shifts, shift] }));
    setActiveShiftStart(null);
    setFuelInput('');
    setShowFuelModal(false);
  };

  const handleAddExpense = () => {
    if (!expenseAmount) return;
    const expense = {
      id: genId(),
      date: new Date().toISOString(),
      category: 'Обслуживание',
      amount: parseFloat(expenseAmount),
      note: expenseNote,
    };
    setState(prev => ({ ...prev, expenses: [...prev.expenses, expense] }));
    setExpenseAmount('');
    setExpenseNote('');
    setShowExpenseModal(false);
  };

  const handleScreenshotUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setScreenshotLoading(true);
    setShowScreenshotModal(true);
    // Имитация распознавания
    setTimeout(() => {
      const parsed = {
        service: 'Uber Eats',
        amount: 45.50,
        km1: 2.3,
        km2: 5.1,
        tips: 3.00,
      };
      setScreenshotParsed(parsed);
      setScreenshotLoading(false);
    }, 1500);
  };

  const handleScreenshotConfirm = () => {
    if (screenshotParsed) {
      setOrderForm(prev => ({
        ...prev,
        service: screenshotParsed.service,
        amount: screenshotParsed.amount.toString(),
        km1: screenshotParsed.km1.toString(),
        km2: screenshotParsed.km2.toString(),
        tips: screenshotParsed.tips ? screenshotParsed.tips.toString() : '',
      }));
    }
    setShowScreenshotModal(false);
    setScreenshotParsed(null);
  };

  const handleExportCSV = () => {
    const headers = ['Дата', 'Сервис', 'Сумма', 'Чаевые', 'Км до ресторана', 'Км до клиента', 'Тип заказа', 'Погода', 'Проблемы', 'Комментарий'];
    const rows = filteredOrders.map(o => [
      o.date,
      o.service,
      o.amount,
      o.tips || 0,
      o.km1 || 0,
      o.km2 || 0,
      o.orderType || '',
      o.weather || '',
      o.problem || '',
      o.comment || '',
    ]);
    const csvContent = '\uFEFF' + [headers, ...rows].map(row => row.join(';')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `orders_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  };

  const handleImportFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const content = ev.target.result;
        if (file.name.endsWith('.json')) {
          const imported = JSON.parse(content);
          if (Array.isArray(imported)) {
            setState(prev => ({ ...prev, orders: [...prev.orders, ...imported.map(o => ({ ...o, id: genId() }))] }));
          }
        } else {
          const text = content.replace(/^\uFEFF/, '');
          const lines = text.split('\n').filter(l => l.trim());
          const headers = lines[0].split(';').map(h => h.trim());
          const orderRows = lines.slice(1).map(line => {
            const values = line.split(';');
            const obj = {};
            headers.forEach((h, i) => obj[h] = values[i]?.trim());
            return {
              id: genId(),
              date: obj['Дата'] || new Date().toISOString(),
              service: obj['Сервис'] || 'Custom',
              amount: parseFloat(obj['Сумма']) || 0,
              tips: parseFloat(obj['Чаевые']) || 0,
              km1: parseFloat(obj['Км до ресторана']) || 0,
              km2: parseFloat(obj['Км до клиента']) || 0,
              orderType: obj['Тип заказа'] || '',
              weather: obj['Погода'] || '',
              problem: obj['Проблемы'] || '',
              comment: obj['Комментарий'] || '',
            };
          });
          setState(prev => ({ ...prev, orders: [...prev.orders, ...orderRows] }));
        }
      } catch (err) {
        alert('Ошибка импорта: ' + err.message);
      }
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleDeleteOrder = (id) => {
    setState(prev => ({ ...prev, orders: prev.orders.filter(o => o.id !== id) }));
  };

  const handleDeleteShift = (id) => {
    setState(prev => ({ ...prev, shifts: prev.shifts.filter(s => s.id !== id) }));
  };

  const handleSettingsChange = (key, value) => {
    setState(prev => ({
      ...prev,
      settings: { ...prev.settings, [key]: value },
    }));
  };

  const handleNestedSettingChange = (group, key, value) => {
    setState(prev => ({
      ...prev,
      settings: {
        ...prev.settings,
        [group]: { ...prev.settings[group], [key]: value },
      },
    }));
  };

  const handleAddCustomService = () => {
    const name = prompt('Название сервиса:');
    if (name && !allServices.includes(name)) {
      setState(prev => ({
        ...prev,
        settings: { ...prev.settings, customServices: [...prev.settings.customServices, name] },
      }));
    }
  };

  const serviceColor = (name) => SERVICE_COLORS[name] || '#71717A';

  // ---------- РЕНДЕР ----------
  const inputClass = "w-full border border-neutral-800 bg-neutral-950 text-neutral-100 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-cyan-400 placeholder-neutral-700";
  const labelClass = "text-xs text-neutral-500 mb-1.5 block";

  return (
    <div style={{ minHeight: '100vh', colorScheme: 'dark', background: '#0a0a0a', color: '#fafafa', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: '500px', margin: '0 auto', padding: '16px', paddingBottom: '80px' }}>
        {/* Шапка с общей суммой */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#71717a', marginBottom: '4px' }}>
              {bruttoMode ? 'Брутто' : 'Нетто'} · {periodLabel(filterType)}
            </div>
            <div style={{ fontSize: '2rem', fontWeight: '600', fontFamily: '"SF Mono", "Roboto Mono", monospace', lineHeight: '1.2' }}>
              {formatPLN(bruttoMode ? stats.grossIncome : stats.netAfterTax)}
            </div>
          </div>
          <button
            onClick={() => setBruttoMode(!bruttoMode)}
            style={{
              padding: '8px 12px',
              borderRadius: '20px',
              border: '1px solid #3f3f46',
              background: bruttoMode ? '#27272a' : 'transparent',
              color: '#fafafa',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            {bruttoMode ? 'Брутто' : 'Нетто'}
          </button>
        </header>

        {/* Контент вкладок */}
        {tab === 'entry' && (
          <div>
            {/* Карточка смены */}
            <div style={{ background: '#18181b', borderRadius: '16px', padding: '16px', border: '1px solid #3f3f46', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: activeShiftStart ? '8px' : 0 }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '500', color: '#d4d4d8' }}>Смена</span>
                {activeShiftStart ? (
                  <button onClick={handleEndShift} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#7f1d1d', color: '#fecaca', border: '1px solid #991b1b', padding: '6px 12px', borderRadius: '20px', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <Square size={16} /> Закончить
                  </button>
                ) : (
                  <button onClick={handleStartShift} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#10b981', color: '#022c22', border: 'none', padding: '6px 12px', borderRadius: '20px', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <Play size={16} /> Начать смену
                  </button>
                )}
              </div>
              {activeShiftStart && (
                <div style={{ fontSize: '0.8rem', color: '#a1a1aa' }}>
                  Начало: {formatTime(activeShiftStart)}
                </div>
              )}
            </div>

            {/* Форма заказа */}
            <form onSubmit={handleOrderSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Выбор сервиса */}
              <div>
                <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '8px', display: 'block' }}>Сервис</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {allServices.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setOrderForm({...orderForm, service: s})}
                      style={{
                        padding: '8px 14px',
                        borderRadius: '20px',
                        fontSize: '0.85rem',
                        fontWeight: '500',
                        border: `1px solid ${orderForm.service === s ? serviceColor(s) : '#3f3f46'}`,
                        background: orderForm.service === s ? serviceColor(s) : 'transparent',
                        color: orderForm.service === s ? '#fff' : '#d4d4d8',
                        cursor: 'pointer',
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Сумма и километраж */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Доход (PLN)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={orderForm.amount}
                    onChange={(e) => setOrderForm({...orderForm, amount: e.target.value})}
                    placeholder="0.00"
                    style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa', fontSize: '1rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Км (всего)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={orderForm.km1}
                    onChange={(e) => setOrderForm({...orderForm, km1: e.target.value})}
                    placeholder="0.0"
                    style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa', fontSize: '1rem' }}
                  />
                </div>
              </div>

              {/* Дополнительные поля */}
              <button type="button" onClick={() => setShowExtraFields(!showExtraFields)} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#a1a1aa', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', padding: 0 }}>
                {showExtraFields ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {showExtraFields ? 'Скрыть детали' : 'Ещё детали'}
              </button>

              {showExtraFields && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px', background: '#18181b', borderRadius: '12px', border: '1px solid #3f3f46' }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Дата и время</label>
                    <input
                      type="datetime-local"
                      value={orderForm.date}
                      onChange={(e) => setOrderForm({...orderForm, date: e.target.value})}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Чаевые (PLN)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={orderForm.tips}
                      onChange={(e) => setOrderForm({...orderForm, tips: e.target.value})}
                      placeholder="0.00"
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Тип заказа</label>
                    <input
                      type="text"
                      value={orderForm.orderType}
                      onChange={(e) => setOrderForm({...orderForm, orderType: e.target.value})}
                      placeholder="Ресторан, Магазин, Аптека..."
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Погода</label>
                    <select
                      value={orderForm.weather}
                      onChange={(e) => setOrderForm({...orderForm, weather: e.target.value})}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa' }}
                    >
                      <option value="">-</option>
                      <option value="Ясно">Ясно</option>
                      <option value="Дождь">Дождь</option>
                      <option value="Снег">Снег</option>
                      <option value="Жара">Жара</option>
                      <option value="Холодно">Холодно</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Проблемы с заказом</label>
                    <input
                      type="text"
                      value={orderForm.problem}
                      onChange={(e) => setOrderForm({...orderForm, problem: e.target.value})}
                      placeholder="Опишите проблему"
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Комментарий</label>
                    <textarea
                      value={orderForm.comment}
                      onChange={(e) => setOrderForm({...orderForm, comment: e.target.value})}
                      rows="2"
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa', resize: 'vertical' }}
                    />
                  </div>
                </div>
              )}

              {/* Кнопки Скриншот и Сохранить */}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" onClick={() => setShowScreenshotModal(true)} style={{ flex: 1, padding: '12px', borderRadius: '12px', background: '#18181b', border: '1px solid #3f3f46', color: '#d4d4d8', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}>
                  <Camera size={18} /> Скриншот
                </button>
                <button type="submit" style={{ flex: 1, padding: '12px', borderRadius: '12px', background: '#22d3ee', color: '#09090b', border: 'none', fontWeight: '600', fontSize: '1rem', cursor: 'pointer' }}>
                  {savedFlash ? '✓ Сохранено' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        )}

        {tab === 'stats' && (
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '16px' }}>Статистика</h2>

            {/* Фильтры */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
              {['today', 'week', 'month', 'all', 'custom'].map(f => (
                <button key={f} onClick={() => setFilterType(f)} style={{ padding: '6px 12px', borderRadius: '20px', fontSize: '0.8rem', border: '1px solid #3f3f46', background: filterType === f ? '#22d3ee' : 'transparent', color: filterType === f ? '#09090b' : '#d4d4d8', cursor: 'pointer' }}>
                  {f === 'today' ? 'Сегодня' : f === 'week' ? 'Неделя' : f === 'month' ? 'Месяц' : f === 'all' ? 'Всё' : 'Период'}
                </button>
              ))}
            </div>
            {filterType === 'custom' && (
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ flex: 1, padding: '8px', borderRadius: '8px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa' }} />
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ flex: 1, padding: '8px', borderRadius: '8px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa' }} />
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
              <button onClick={() => setServiceFilter('all')} style={{ padding: '6px 12px', borderRadius: '20px', fontSize: '0.8rem', border: '1px solid #3f3f46', background: serviceFilter === 'all' ? '#22d3ee' : 'transparent', color: serviceFilter === 'all' ? '#09090b' : '#d4d4d8', cursor: 'pointer' }}>
                Все
              </button>
              {allServices.map(s => (
                <button key={s} onClick={() => setServiceFilter(s)} style={{ padding: '6px 12px', borderRadius: '20px', fontSize: '0.8rem', border: '1px solid #3f3f46', background: serviceFilter === s ? serviceColor(s) : 'transparent', color: serviceFilter === s ? '#fff' : '#d4d4d8', cursor: 'pointer' }}>
                  {s}
                </button>
              ))}
            </div>

            {/* Сводные карточки */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '20px' }}>
              <StatCard label="Доход" value={formatPLN(stats.grossIncome)} />
              <StatCard label="Чистыми" value={formatPLN(stats.totalNetProfit)} />
              <StatCard label="Доход/час" value={stats.incomePerHour ? formatPLN(stats.incomePerHour) : '—'} />
              <StatCard label="Средний чек" value={formatPLN(stats.avgCheck)} />
              <StatCard label="Пробег" value={stats.totalKm.toFixed(1) + ' км'} />
              <StatCard label="Заказы" value={stats.orderCount} />
            </div>

            {/* Графики */}
            {dailyData.length > 0 && (
              <div style={{ background: '#18181b', borderRadius: '16px', padding: '16px', border: '1px solid #3f3f46', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '12px' }}>Доход по дням</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={dailyData}>
                    <XAxis dataKey="day" stroke="#71717a" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} />
                    <YAxis stroke="#71717a" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} width={36} />
                    <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }} formatter={(v) => formatPLN(v)} />
                    <Bar dataKey="value" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {serviceData.length > 0 && (
              <div style={{ background: '#18181b', borderRadius: '16px', padding: '16px', border: '1px solid #3f3f46' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '12px' }}>По сервисам</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={serviceData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                      {serviceData.map((entry, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }} formatter={(v) => formatPLN(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginTop: '8px' }}>
                  {serviceData.map(s => (
                    <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: '#d4d4d8' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: serviceColor(s.name) }} />
                      {s.name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Детализация расходов */}
            <div style={{ background: '#18181b', borderRadius: '16px', padding: '16px', border: '1px solid #3f3f46', marginTop: '16px' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '8px' }}>Детализация</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#d4d4d8', marginBottom: '4px' }}>
                <span>Налоги</span><span>-{formatPLN(stats.grossIncome - stats.netAfterTax)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#d4d4d8', marginBottom: '4px' }}>
                <span>Комиссия партнёра</span><span>-{formatPLN(stats.totalCommission)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#d4d4d8', marginBottom: '4px' }}>
                <span>Топливо</span><span>-{formatPLN(stats.totalFuel)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#d4d4d8', marginBottom: '4px' }}>
                <span>Обслуживание</span><span>-{formatPLN(stats.totalMaintenance)}</span>
              </div>
              {stats.zusDeduction > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#d4d4d8', marginBottom: '4px' }}>
                  <span>ZUS</span><span>-{formatPLN(stats.zusDeduction)}</span>
                </div>
              )}
              <div style={{ borderTop: '1px solid #3f3f46', marginTop: '8px', paddingTop: '8px', fontWeight: '600', display: 'flex', justifyContent: 'space-between' }}>
                <span>Итого</span><span>{formatPLN(stats.totalNetProfit)}</span>
              </div>
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '600' }}>История</h2>
              <button onClick={handleExportCSV} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '8px', background: '#18181b', border: '1px solid #3f3f46', color: '#d4d4d8', cursor: 'pointer' }}>
                <Download size={16} /> CSV
              </button>
            </div>

            {/* Фильтры (кратко) */}
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '12px' }}>
              {['today', 'week', 'month', 'all', 'custom'].map(f => (
                <button key={f} onClick={() => setFilterType(f)} style={{ padding: '6px 12px', borderRadius: '20px', fontSize: '0.8rem', border: '1px solid #3f3f46', background: filterType === f ? '#22d3ee' : 'transparent', color: filterType === f ? '#09090b' : '#d4d4d8', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                  {f === 'today' ? 'Сегодня' : f === 'week' ? 'Неделя' : f === 'month' ? 'Месяц' : f === 'all' ? 'Всё' : 'Период'}
                </button>
              ))}
              {filterType === 'custom' && (
                <div style={{ display: 'flex', gap: '4px' }}>
                  <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ width: '110px', padding: '6px', borderRadius: '8px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa' }} />
                  <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ width: '110px', padding: '6px', borderRadius: '8px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa' }} />
                </div>
              )}
            </div>

            {/* Список заказов */}
            {filteredOrders.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#52525b', padding: '40px 0' }}>Нет заказов за этот период</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {filteredOrders.map(o => (
                  <div key={o.id} style={{ background: '#18181b', borderRadius: '12px', padding: '12px', border: '1px solid #3f3f46', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: serviceColor(o.service), flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: '500', fontSize: '0.95rem', color: '#fafafa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.service}</div>
                        <div style={{ fontSize: '0.8rem', color: '#a1a1aa' }}>{formatDateTime(o.date)}</div>
                        {(o.km1 || o.km2) > 0 && <div style={{ fontSize: '0.8rem', color: '#a1a1aa' }}>{(o.km1||0)+(o.km2||0)} км</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: '600', fontFamily: '"SF Mono", "Roboto Mono", monospace', fontSize: '1rem' }}>{formatPLN(bruttoMode ? (o.amount + (o.tips||0)) : getNetAfterTax(o, settings))}</span>
                      <button onClick={() => handleDeleteOrder(o.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Смены */}
            {filteredShifts.length > 0 && (
              <div style={{ marginTop: '20px' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '8px' }}>Смены</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {filteredShifts.map(s => (
                    <div key={s.id} style={{ background: '#18181b', borderRadius: '12px', padding: '12px', border: '1px solid #3f3f46', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '0.85rem', color: '#d4d4d8' }}>
                        {formatTime(s.start)} – {s.end ? formatTime(s.end) : 'сейчас'}
                        {s.fuelCost > 0 && <span style={{ color: '#a1a1aa' }}> · топливо {formatPLN(s.fuelCost)}</span>}
                      </div>
                      <button onClick={() => handleDeleteShift(s.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'settings' && (
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '16px' }}>Настройки</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Налоги */}
              <div style={{ background: '#18181b', borderRadius: '16px', padding: '16px', border: '1px solid #3f3f46' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '12px' }}>Налоги</h3>
                <SettingRow label="VAT Uber Eats, %" value={settings.vatRates.uber * 100} onChange={(v) => handleNestedSettingChange('vatRates', 'uber', v / 100)} />
                <SettingRow label="VAT Bolt Food, %" value={settings.vatRates.bolt * 100} onChange={(v) => handleNestedSettingChange('vatRates', 'bolt', v / 100)} />
                <SettingRow label="Ryczałt, %" value={settings.ryczaltRate * 100} onChange={(v) => handleSettingsChange('ryczaltRate', v / 100)} />
                <SettingRow label="UZ (ZUS), %" value={settings.uzRate * 100} onChange={(v) => handleSettingsChange('uzRate', v / 100)} />
                <SettingRow label="Фикс. ZUS, PLN" value={settings.zusFixed} onChange={(v) => handleSettingsChange('zusFixed', parseFloat(v) || 0)} />
                <SettingRow label="Дата перехода" value={settings.transitionDate} onChange={(v) => handleSettingsChange('transitionDate', v)} />
              </div>

              {/* Комиссия партнёра */}
              <div style={{ background: '#18181b', borderRadius: '16px', padding: '16px', border: '1px solid #3f3f46' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '12px' }}>Комиссия партнёра</h3>
                <SettingRow label="Один сервис, PLN/нед" value={settings.partnerCommissionSingle} onChange={(v) => handleSettingsChange('partnerCommissionSingle', parseFloat(v) || 0)} />
                <SettingRow label="Два+ сервиса, PLN/нед" value={settings.partnerCommissionMulti} onChange={(v) => handleSettingsChange('partnerCommissionMulti', parseFloat(v) || 0)} />
              </div>

              {/* Свои сервисы */}
              <div style={{ background: '#18181b', borderRadius: '16px', padding: '16px', border: '1px solid #3f3f46' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '12px' }}>Свои сервисы</h3>
                {settings.customServices?.map(s => (
                  <div key={s} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                    <span style={{ color: '#d4d4d8' }}>{s}</span>
                    <button onClick={() => handleSettingsChange('customServices', settings.customServices.filter(x => x !== s))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                      <X size={16} />
                    </button>
                  </div>
                ))}
                <button onClick={handleAddCustomService} style={{ marginTop: '8px', padding: '8px 12px', borderRadius: '8px', background: '#27272a', border: 'none', color: '#d4d4d8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Plus size={16} /> Добавить
                </button>
              </div>

              {/* Расходы на обслуживание */}
              <div style={{ background: '#18181b', borderRadius: '16px', padding: '16px', border: '1px solid #3f3f46' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '12px' }}>Обслуживание</h3>
                <button onClick={() => setShowExpenseModal(true)} style={{ padding: '10px', borderRadius: '8px', background: '#27272a', border: 'none', color: '#d4d4d8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Wrench size={16} /> Добавить расход
                </button>
                {expenses.filter(e => e.category === 'Обслуживание').length > 0 && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {expenses.filter(e => e.category === 'Обслуживание').map(e => (
                      <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#d4d4d8' }}>
                        <span>{e.note || 'Без описания'}</span>
                        <span>{formatPLN(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Импорт/Экспорт */}
              <div style={{ background: '#18181b', borderRadius: '16px', padding: '16px', border: '1px solid #3f3f46' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '12px' }}>Данные</h3>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button onClick={() => fileInputRef.current.click()} style={{ padding: '10px', borderRadius: '8px', background: '#27272a', border: 'none', color: '#d4d4d8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    Импорт CSV/JSON
                  </button>
                  <button onClick={handleExportCSV} style={{ padding: '10px', borderRadius: '8px', background: '#27272a', border: 'none', color: '#d4d4d8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Download size={16} /> Экспорт CSV
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.json"
                    style={{ display: 'none' }}
                    onChange={handleImportFile}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Нижняя навигация */}
      <nav style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: '#18181b',
        borderTop: '1px solid #3f3f46',
        display: 'flex',
        justifyContent: 'space-around',
        padding: '10px 0 calc(10px + env(safe-area-inset-bottom))',
        zIndex: 100,
        maxWidth: '500px',
        margin: '0 auto',
      }}>
        <NavButton icon={<Plus size={22} />} label="Внести" active={tab === 'entry'} onClick={() => setTab('entry')} />
        <NavButton icon={<BarChart3 size={22} />} label="Статистика" active={tab === 'stats'} onClick={() => setTab('stats')} />
        <NavButton icon={<List size={22} />} label="История" active={tab === 'history'} onClick={() => setTab('history')} />
        <NavButton icon={<SettingsIcon size={22} />} label="Настройки" active={tab === 'settings'} onClick={() => setTab('settings')} />
      </nav>

      {/* Модальные окна */}
      {showScreenshotModal && (
        <Modal onClose={() => setShowScreenshotModal(false)}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '12px' }}>Загрузка скриншота</h3>
          <input type="file" accept="image/*" onChange={handleScreenshotUpload} style={{ width: '100%', padding: '10px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa', borderRadius: '8px', marginBottom: '12px' }} />
          {screenshotLoading && <p style={{ color: '#a1a1aa' }}>Распознавание...</p>}
          {screenshotParsed && (
            <div>
              <p>Распознанные данные:</p>
              <p>Сервис: {screenshotParsed.service}</p>
              <p>Сумма: {screenshotParsed.amount} PLN</p>
              <p>Км до ресторана: {screenshotParsed.km1} км</p>
              <p>Км до клиента: {screenshotParsed.km2} км</p>
              {screenshotParsed.tips && <p>Чаевые: {screenshotParsed.tips} PLN</p>}
              <button onClick={handleScreenshotConfirm} style={{ marginTop: '10px', padding: '10px 16px', borderRadius: '8px', background: '#10b981', color: '#022c22', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Check size={16} /> Подтвердить
              </button>
            </div>
          )}
        </Modal>
      )}

      {showFuelModal && (
        <Modal onClose={() => setShowFuelModal(false)}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '12px' }}>Завершение смены</h3>
          <p style={{ color: '#a1a1aa', marginBottom: '8px' }}>Расход на топливо (PLN):</p>
          <input
            type="number"
            step="0.01"
            value={fuelInput}
            onChange={(e) => setFuelInput(e.target.value)}
            placeholder="0.00"
            style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa', marginBottom: '12px' }}
          />
          <button onClick={handleFuelSave} style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#10b981', color: '#022c22', border: 'none', fontWeight: '600', cursor: 'pointer' }}>
            Сохранить
          </button>
        </Modal>
      )}

      {showExpenseModal && (
        <Modal onClose={() => setShowExpenseModal(false)}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '12px' }}>Добавить расход</h3>
          <input
            type="number"
            step="0.01"
            value={expenseAmount}
            onChange={(e) => setExpenseAmount(e.target.value)}
            placeholder="Сумма, PLN"
            style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa', marginBottom: '8px' }}
          />
          <input
            type="text"
            value={expenseNote}
            onChange={(e) => setExpenseNote(e.target.value)}
            placeholder="Описание (масло, ремонт...)"
            style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa', marginBottom: '12px' }}
          />
          <button onClick={handleAddExpense} style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#10b981', color: '#022c22', border: 'none', fontWeight: '600', cursor: 'pointer' }}>
            Сохранить
          </button>
        </Modal>
      )}
    </div>
  );
}

// ---------- ВСПОМОГАТЕЛЬНЫЕ КОМПОНЕНТЫ ----------
function NavButton({ icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
        background: 'none',
        border: 'none',
        color: active ? '#22d3ee' : '#71717a',
        cursor: 'pointer',
        fontSize: '0.7rem',
        padding: '5px 10px',
        fontWeight: active ? '600' : '400',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ background: '#18181b', borderRadius: '16px', padding: '14px', border: '1px solid #3f3f46', textAlign: 'center' }}>
      <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#71717a', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '1.2rem', fontWeight: '600', fontFamily: '"SF Mono", "Roboto Mono", monospace', color: '#fafafa' }}>{value}</div>
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 200,
      padding: '20px',
    }}>
      <div style={{
        background: '#18181b',
        padding: '20px',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '400px',
        color: '#fafafa',
        position: 'relative',
      }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', color: '#fafafa', cursor: 'pointer' }}>
          <X size={20} />
        </button>
        {children}
      </div>
    </div>
  );
}

function SettingRow({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
      <span style={{ fontSize: '0.9rem', color: '#d4d4d8' }}>{label}</span>
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '90px', padding: '8px', borderRadius: '6px', background: '#09090b', border: '1px solid #3f3f46', color: '#fafafa', textAlign: 'right' }}
      />
    </div>
  );
}

function periodLabel(period) {
  switch(period) {
    case 'today': return 'сегодня';
    case 'week': return 'эта неделя';
    case 'month': return 'этот месяц';
    case 'custom': return 'выбранный период';
    case 'all': return 'всё время';
    default: return '';
  }
}
