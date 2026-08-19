import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  Plus, BarChart3, List, Settings as SettingsIcon,
  Play, Square, Trash2, Download, ChevronDown, ChevronUp, X,
  Camera, Fuel, Wrench, Check
} from 'lucide-react';

// ---------- ХРАНИЛИЩЕ ----------
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
  transitionDate: '2026-09-01', // для Uber Eats
  glovoUZStartDate: '2025-01-01', // дата перехода Glovo на UZ (настраиваемая)
  partnerCommissionSingle: 29.90,
  partnerCommissionMulti: 49.90,
  customServices: [],
};

const FIXED_SERVICES = [
  { name: 'Uber Eats', color: '#00897B', icon: '🚗' },
  { name: 'Stuart', color: '#D81B60', icon: '🛵' },
  { name: 'Bolt Food', color: '#4CAF50', icon: '⚡' },
  { name: 'Pyszne.pl', color: '#E53935', icon: '🍽️' },
  { name: 'Glovo', color: '#EF6C00', icon: '🛍️' },
];

const PARTNER_SERVICES = ['Uber Eats', 'Bolt Food', 'Stuart', 'Pyszne.pl'];

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
  const isBeforeUber = new Date(order.date) < new Date(settings.transitionDate);
  switch(order.service) {
    case 'Uber Eats':
      return isBeforeUber ? baseNet * settings.ryczaltRate : baseNet * settings.uzRate;
    case 'Bolt Food':
    case 'Stuart':
      return baseNet * settings.ryczaltRate;
    case 'Glovo': {
      // До даты перехода на UZ – только Ryczałt, после – UZ
      const isBeforeGlovoUZ = new Date(order.date) < new Date(settings.glovoUZStartDate);
      return isBeforeGlovoUZ ? baseNet * settings.ryczaltRate : baseNet * settings.uzRate;
    }
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

// ---------- МОТИВИРУЮЩИЕ ФРАЗЫ ----------
const MOTIVATIONAL_PHRASES = [
  'Каждый заказ приближает тебя к цели! 💪',
  'Сегодня ты заработаешь больше, чем вчера! 🚀',
  'Дорогу осилит идущий. Продолжай! 🌟',
  'Твой труд окупается. Вперёд! 💼',
  'Даже маленький шаг – это прогресс. 👣',
  'Ты на верном пути! Не сдавайся. 🔥',
  'Деньги любят настойчивых. 😉',
  'Работай умно, а не только много. 🧠',
];

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

  const [tab, setTab] = useState('entry');
  const [bruttoMode, setBruttoMode] = useState(true); // только для статистики

  const [filterType, setFilterType] = useState('week');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [serviceFilter, setServiceFilter] = useState('all');

  const [activeShiftStart, setActiveShiftStart] = useState(null);
  const [showFuelModal, setShowFuelModal] = useState(false);
  const [fuelInput, setFuelInput] = useState('');

  const [showScreenshotModal, setShowScreenshotModal] = useState(false);
  const [screenshotParsed, setScreenshotParsed] = useState(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);

  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNote, setExpenseNote] = useState('');

  const fileInputRef = useRef(null);

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
    const custom = (settings.customServices || []).map(name => ({
      name,
      color: '#5E35B1',
      icon: '📦',
    }));
    return [...FIXED_SERVICES, ...custom];
  }, [settings.customServices]);

  const getServiceInfo = (name) => {
    return allServices.find(s => s.name === name) || { name, color: '#71717A', icon: '📦' };
  };

  // Фильтрация (аналогично предыдущему коду)
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
    // аналогичный фильтр
  }, [shifts, filterType, customStart, customEnd]);

  const filteredExpenses = useMemo(() => {
    // аналогичный фильтр
  }, [expenses, filterType, customStart, customEnd]);

  // Статистика
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

  // Рекорды
  const records = useMemo(() => {
    if (filteredOrders.length === 0) return null;
    // Лучший день (по сумме дохода)
    const byDay = {};
    filteredOrders.forEach(o => {
      const day = formatDate(o.date);
      byDay[day] = (byDay[day] || 0) + o.amount + (o.tips || 0);
    });
    const bestDay = Object.entries(byDay).sort((a,b) => b[1] - a[1])[0];
    // Лучший сервис
    const byService = {};
    filteredOrders.forEach(o => {
      byService[o.service] = (byService[o.service] || 0) + o.amount + (o.tips || 0);
    });
    const bestService = Object.entries(byService).sort((a,b) => b[1] - a[1])[0];
    // Максимальный заказ
    const maxOrder = filteredOrders.reduce((max, o) => {
      const val = o.amount + (o.tips || 0);
      return val > (max?.amount + (max?.tips || 0) || 0) ? o : max;
    }, null);
    return { bestDay, bestService, maxOrder };
  }, [filteredOrders]);

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

  const COLORS = ['#00897B', '#D81B60', '#4CAF50', '#E53935', '#EF6C00', '#5E35B1', '#00838F', '#F57F17'];

  // Обработчики (остаются те же, что и в прошлом полном коде)

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

  const handleExportCSV = () => { /* ... */ };
  const handleImportFile = (e) => { /* ... */ };
  const handleDeleteOrder = (id) => { /* ... */ };
  const handleDeleteShift = (id) => { /* ... */ };
  const handleSettingsChange = (key, value) => { /* ... */ };
  const handleNestedSettingChange = (group, key, value) => { /* ... */ };
  const handleAddCustomService = () => { /* ... */ };
  const handleRemoveCustomService = (name) => { /* ... */ };

  const getTaxHint = (service) => {
    switch(service) {
      case 'Uber Eats': return 'Вводите сумму с VAT (23%). Система вычтет налог автоматически.';
      case 'Bolt Food': return 'Вводите сумму с VAT (8%). Система вычтет налог автоматически.';
      case 'Stuart': return 'Вводите сумму без VAT (уже чистая).';
      case 'Glovo': {
        const before = new Date(orderForm.date) < new Date(settings.glovoUZStartDate);
        return before
          ? 'Вводите сумму без VAT. До даты перехода на UZ облагается только Ryczałt.'
          : 'Вводите сумму без VAT. После перехода на UZ облагается ZUS.';
      }
      case 'Pyszne.pl': return 'Вводите сумму без VAT. Работает по Umowa Zlecenie.';
      default: return 'Вводите сумму дохода.';
    }
  };

  const [motivationalPhrase, setMotivationalPhrase] = useState(() => MOTIVATIONAL_PHRASES[Math.floor(Math.random() * MOTIVATIONAL_PHRASES.length)]);

  // При старте смены обновляем фразу
  useEffect(() => {
    if (activeShiftStart) {
      setMotivationalPhrase(MOTIVATIONAL_PHRASES[Math.floor(Math.random() * MOTIVATIONAL_PHRASES.length)]);
    }
  }, [activeShiftStart]);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#000000',
      color: '#fafafa',
      fontFamily: '-apple-system, "SF Pro Text", "Helvetica Neue", sans-serif',
      margin: 0,
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        maxWidth: '100%',
        width: '100%',
        padding: '16px',
        paddingBottom: '90px',
        boxSizing: 'border-box',
      }}>
        {/* Шапка */}
        <header style={{
          marginBottom: '20px',
          flexShrink: 0,
        }}>
          <div style={{
            fontSize: '0.7rem',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: '#71717a',
            marginBottom: '4px',
          }}>
            Доход · {periodLabel(filterType)}
          </div>
          <div style={{
            fontSize: '1.8rem',
            fontWeight: '700',
            fontFamily: '"SF Mono", "Roboto Mono", monospace',
            lineHeight: '1.2',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {formatPLN(stats.grossIncome)}
          </div>
        </header>

        {/* Контент вкладок */}
        {tab === 'entry' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Карточка смены */}
            <div style={{
              background: '#111111',
              borderRadius: '16px',
              padding: '16px',
              border: '1px solid #27272a',
              flexShrink: 0,
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
              }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '500', color: '#d4d4d8' }}>Смена</span>
                {activeShiftStart ? (
                  <button onClick={handleEndShift} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#7f1d1d',
                    color: '#fecaca',
                    border: '1px solid #991b1b',
                    padding: '8px 14px',
                    borderRadius: '20px',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}>
                    <Square size={16} /> Закончить
                  </button>
                ) : (
                  <button onClick={handleStartShift} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#10b981',
                    color: '#022c22',
                    border: 'none',
                    padding: '8px 14px',
                    borderRadius: '20px',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}>
                    <Play size={16} /> Начать смену
                  </button>
                )}
              </div>
              {activeShiftStart && (
                <>
                  <div style={{ fontSize: '0.8rem', color: '#a1a1aa', marginTop: '8px' }}>
                    Начало: {formatTime(activeShiftStart)}
                  </div>
                  <div style={{
                    fontSize: '0.85rem',
                    color: '#22d3ee',
                    marginTop: '8px',
                    fontStyle: 'italic',
                    textAlign: 'center',
                  }}>
                    {motivationalPhrase}
                  </div>
                </>
              )}
            </div>

            {/* Форма заказа (как раньше) */}
            {/* ... */}
          </div>
        )}

        {tab === 'stats' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '600', margin: 0 }}>Статистика</h2>

            {/* Переключатель Брутто/Нетто */}
            <div style={{
              display: 'flex',
              gap: '4px',
              background: '#111111',
              borderRadius: '12px',
              padding: '4px',
              border: '1px solid #27272a',
            }}>
              <button
                onClick={() => setBruttoMode(true)}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '8px',
                  border: 'none',
                  background: bruttoMode ? '#22d3ee' : 'transparent',
                  color: bruttoMode ? '#000000' : '#71717a',
                  fontWeight: '700',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Брутто
              </button>
              <button
                onClick={() => setBruttoMode(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '8px',
                  border: 'none',
                  background: !bruttoMode ? '#22d3ee' : 'transparent',
                  color: !bruttoMode ? '#000000' : '#71717a',
                  fontWeight: '700',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Нетто
              </button>
            </div>

            {/* Фильтры */}
            {/* ... */}

            {/* Сводные карточки */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '10px',
            }}>
              <StatCard label="Доход" value={formatPLN(stats.grossIncome)} />
              <StatCard label="Чистыми" value={formatPLN(stats.totalNetProfit)} />
              <StatCard label="Доход/час" value={stats.incomePerHour ? formatPLN(stats.incomePerHour) : '—'} />
              <StatCard label="Средний чек" value={formatPLN(stats.avgCheck)} />
              <StatCard label="Пробег" value={stats.totalKm.toFixed(1) + ' км'} />
              <StatCard label="Заказы" value={stats.orderCount} />
            </div>

            {/* Рекорды */}
            {records && (
              <div style={{
                background: '#111111',
                borderRadius: '16px',
                padding: '16px',
                border: '1px solid #27272a',
              }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '12px', marginTop: 0 }}>🏆 Рекорды</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#a1a1aa' }}>Лучший день:</span>
                    <span style={{ fontWeight: '700' }}>{records.bestDay[0]} — {formatPLN(records.bestDay[1])}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#a1a1aa' }}>Лучший сервис:</span>
                    <span style={{ fontWeight: '700' }}>
                      {getServiceInfo(records.bestService[0]).icon} {records.bestService[0]} — {formatPLN(records.bestService[1])}
                    </span>
                  </div>
                  {records.maxOrder && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#a1a1aa' }}>Максимальный заказ:</span>
                      <span style={{ fontWeight: '700' }}>
                        {formatPLN(records.maxOrder.amount + (records.maxOrder.tips || 0))}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Графики и детализация */}
            {/* ... */}
          </div>
        )}

        {/* Остальные вкладки (history, settings) с обновлёнными данными */}
        {/* ... */}
      </div>

      {/* Нижняя навигация */}
      <nav style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: '#000000',
        borderTop: '1px solid #27272a',
        display: 'flex',
        justifyContent: 'space-around',
        padding: '10px 0 calc(10px + env(safe-area-inset-bottom))',
        zIndex: 100,
        maxWidth: '100%',
        margin: '0 auto',
      }}>
        <NavButton icon={<Plus size={22} />} label="Внести" active={tab === 'entry'} onClick={() => setTab('entry')} />
        <NavButton icon={<BarChart3 size={22} />} label="Статистика" active={tab === 'stats'} onClick={() => setTab('stats')} />
        <NavButton icon={<List size={22} />} label="История" active={tab === 'history'} onClick={() => setTab('history')} />
        <NavButton icon={<SettingsIcon size={22} />} label="Настройки" active={tab === 'settings'} onClick={() => setTab('settings')} />
      </nav>

      {/* Модальные окна (как раньше) */}
      {/* ... */}
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
        fontWeight: active ? '700' : '400',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{
      background: '#111111',
      borderRadius: '16px',
      padding: '14px',
      border: '1px solid #27272a',
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: '0.7rem',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: '#71717a',
        marginBottom: '4px',
      }}>{label}</div>
      <div style={{
        fontSize: '1.1rem',
        fontWeight: '700',
        fontFamily: '"SF Mono", "Roboto Mono", monospace',
        color: '#fafafa',
      }}>{value}</div>
    </div>
  );
}

function Modal({ children, onClose }) { /* ... */ }
function SettingRow({ label, value, onChange }) { /* ... */ }
function periodLabel(period) { /* ... */ }
