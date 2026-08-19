import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  Plus, BarChart3, List, Settings as SettingsIcon,
  Play, Square, Trash2, Download, ChevronDown, ChevronUp, X,
  Camera, Fuel, Wrench, Check, RefreshCw, Pencil
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
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        orders: parsed.orders || [],
        shifts: parsed.shifts || [],
        expenses: parsed.expenses || [],
        settings: parsed.settings || DEFAULT_SETTINGS,
      };
    }
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
  glovoUZStartDate: '2025-01-01',
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
  const orderDate = new Date(order.date);
  switch(order.service) {
    case 'Uber Eats': {
      const isBefore = orderDate < new Date(settings.transitionDate);
      return isBefore ? baseNet * settings.ryczaltRate : baseNet * settings.uzRate;
    }
    case 'Bolt Food':
    case 'Stuart':
      return baseNet * settings.ryczaltRate;
    case 'Glovo': {
      const isBeforeUZ = orderDate < new Date(settings.glovoUZStartDate);
      return isBeforeUZ ? baseNet * settings.ryczaltRate : baseNet * settings.uzRate;
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

  const [filterType, setFilterType] = useState('all');
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

  const [editingOrder, setEditingOrder] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);

  const fileInputRef = useRef(null);

  const getLocalDateTimeString = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

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
    date: getLocalDateTimeString(),
  });
  const [showExtraFields, setShowExtraFields] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const [motivationalPhrase, setMotivationalPhrase] = useState(() => 
    MOTIVATIONAL_PHRASES[Math.floor(Math.random() * MOTIVATIONAL_PHRASES.length)]
  );

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

  // Функция получения диапазона дат
  const getRange = (type) => {
    const now = new Date();
    let start, end;
    switch(type) {
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
        start = null;
        end = null;
    }
    return [start, end];
  };

  // Фильтрация заказов
  const filteredOrders = useMemo(() => {
    const [start, end] = getRange(filterType);
    return orders.filter(o => {
      const inService = serviceFilter === 'all' || o.service === serviceFilter;
      if (!inService) return false;
      if (start === null && end === null) return true;
      const d = new Date(o.date).toISOString();
      return d >= start && d < end;
    });
  }, [orders, filterType, customStart, customEnd, serviceFilter]);

  // Фильтрация смен
  const filteredShifts = useMemo(() => {
    const [start, end] = getRange(filterType);
    if (start === null && end === null) return shifts;
    return shifts.filter(s => s.start >= start && s.start < end);
  }, [shifts, filterType, customStart, customEnd]);

  // Фильтрация расходов
  const filteredExpenses = useMemo(() => {
    const [start, end] = getRange(filterType);
    if (start === null && end === null) return expenses;
    return expenses.filter(e => e.date >= start && e.date < end);
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

  // Отображаемый доход с учётом переключателя только для Uber Eats
  const displayIncome = useMemo(() => {
    return filteredOrders.reduce((sum, o) => {
      const amount = o.service === 'Uber Eats'
        ? (bruttoMode ? (o.amount + (o.tips || 0)) : getNetAfterTax(o, settings))
        : (o.amount + (o.tips || 0));
      return sum + amount;
    }, 0);
  }, [filteredOrders, bruttoMode, settings]);

  // Рекорды
  const records = useMemo(() => {
    if (filteredOrders.length === 0) return null;
    const byDay = {};
    filteredOrders.forEach(o => {
      const day = formatDate(o.date);
      byDay[day] = (byDay[day] || 0) + o.amount + (o.tips || 0);
    });
    const bestDay = Object.entries(byDay).sort((a,b) => b[1] - a[1])[0];
    const byService = {};
    filteredOrders.forEach(o => {
      byService[o.service] = (byService[o.service] || 0) + o.amount + (o.tips || 0);
    });
    const bestService = Object.entries(byService).sort((a,b) => b[1] - a[1])[0];
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
      const value = o.service === 'Uber Eats'
        ? (bruttoMode ? (o.amount + (o.tips || 0)) : getNetAfterTax(o, settings))
        : (o.amount + (o.tips || 0));
      map.set(day, (map.get(day) || 0) + value);
    });
    return Array.from(map.entries()).map(([day, value]) => ({ day, value: Math.round(value * 100) / 100 }));
  }, [filteredOrders, bruttoMode, settings]);

  const serviceData = useMemo(() => {
    const map = new Map();
    filteredOrders.forEach(o => {
      const value = o.service === 'Uber Eats'
        ? (bruttoMode ? (o.amount + (o.tips || 0)) : getNetAfterTax(o, settings))
        : (o.amount + (o.tips || 0));
      map.set(o.service, (map.get(o.service) || 0) + value);
    });
    return Array.from(map.entries()).map(([service, value]) => ({ name: service, value: Math.round(value * 100) / 100 }));
  }, [filteredOrders, bruttoMode, settings]);

  const COLORS = ['#00897B', '#D81B60', '#4CAF50', '#E53935', '#EF6C00', '#5E35B1', '#00838F', '#F57F17'];

  // Обработчики
  const handleOrderSubmit = (e) => {
    e.preventDefault();
    if (!orderForm.amount) return;

    let orderDate;
    try {
      orderDate = new Date(orderForm.date);
      if (isNaN(orderDate.getTime())) {
        orderDate = new Date();
      }
    } catch (error) {
      orderDate = new Date();
    }

    const newOrder = {
      id: genId(),
      date: orderDate.toISOString(),
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
      date: getLocalDateTimeString(),
    });
    setShowExtraFields(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  };

  const handleEditOrder = (order) => {
    setEditingOrder({
      ...order,
      date: new Date(order.date).toISOString().slice(0,16),
    });
    setShowEditModal(true);
  };

  const handleEditSave = () => {
    if (!editingOrder) return;
    const updatedOrder = {
      ...editingOrder,
      date: new Date(editingOrder.date).toISOString(),
      amount: parseFloat(editingOrder.amount),
      km1: parseFloat(editingOrder.km1) || 0,
      km2: parseFloat(editingOrder.km2) || 0,
      tips: parseFloat(editingOrder.tips) || 0,
    };
    setState(prev => ({
      ...prev,
      orders: prev.orders.map(o => o.id === updatedOrder.id ? updatedOrder : o),
    }));
    setShowEditModal(false);
    setEditingOrder(null);
  };

  const handleStartShift = () => {
    setActiveShiftStart(new Date().toISOString());
    setMotivationalPhrase(MOTIVATIONAL_PHRASES[Math.floor(Math.random() * MOTIVATIONAL_PHRASES.length)]);
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
    if (name && !allServices.find(s => s.name === name)) {
      setState(prev => ({
        ...prev,
        settings: { ...prev.settings, customServices: [...prev.settings.customServices, name] },
      }));
    }
  };

  const handleRemoveCustomService = (name) => {
    setState(prev => ({
      ...prev,
      settings: { ...prev.settings, customServices: prev.settings.customServices.filter(x => x !== name) },
    }));
  };

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
      touchAction: 'manipulation',
    }}>
      <div style={{
        maxWidth: '100%',
        width: '100%',
        padding: 'calc(env(safe-area-inset-top) + 16px) 16px 90px',
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
            {formatPLN(displayIncome)}
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
                    💬 {motivationalPhrase}
                  </div>
                </>
              )}
            </div>

            {/* Форма заказа */}
            <form onSubmit={handleOrderSubmit} style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              background: '#111111',
              borderRadius: '16px',
              padding: '16px',
              border: '1px solid #27272a',
            }}>
              {/* Выбор сервиса */}
              <div>
                <label style={{
                  fontSize: '0.75rem',
                  color: '#71717a',
                  marginBottom: '8px',
                  display: 'block',
                }}>Сервис</label>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                  gap: '8px',
                }}>
                  {allServices.map(s => {
                    const isActive = orderForm.service === s.name;
                    return (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => setOrderForm({...orderForm, service: s.name})}
                        style={{
                          padding: '10px 8px',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          border: `2px solid ${isActive ? s.color : '#3f3f46'}`,
                          background: isActive ? s.color + '20' : 'transparent',
                          color: isActive ? s.color : '#d4d4d8',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '4px',
                          textAlign: 'center',
                          minWidth: 0,
                        }}
                      >
                        <span style={{ fontSize: '1.5rem' }}>{s.icon}</span>
                        <span style={{ fontSize: '0.7rem', wordBreak: 'break-word' }}>{s.name}</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{
                  marginTop: '8px',
                  fontSize: '0.7rem',
                  color: '#71717a',
                  background: '#1a1a1a',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  lineHeight: '1.4',
                }}>
                  💡 {getTaxHint(orderForm.service)}
                </div>
              </div>

              {/* Сумма и километраж */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
              }}>
                <div>
                  <label style={{
                    fontSize: '0.75rem',
                    color: '#71717a',
                    marginBottom: '6px',
                    display: 'block',
                  }}>Доход (PLN)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={orderForm.amount}
                    onChange={(e) => setOrderForm({...orderForm, amount: e.target.value})}
                    placeholder="0.00"
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '10px',
                      background: '#000000',
                      border: '1px solid #3f3f46',
                      color: '#fafafa',
                      fontSize: '16px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{
                    fontSize: '0.75rem',
                    color: '#71717a',
                    marginBottom: '6px',
                    display: 'block',
                  }}>Км (всего)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={orderForm.km1}
                    onChange={(e) => setOrderForm({...orderForm, km1: e.target.value})}
                    placeholder="0.0"
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '10px',
                      background: '#000000',
                      border: '1px solid #3f3f46',
                      color: '#fafafa',
                      fontSize: '16px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* Кнопки Скриншот и Сохранить */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
              }}>
                <button type="button" onClick={() => setShowScreenshotModal(true)} style={{
                  padding: '12px',
                  borderRadius: '12px',
                  background: '#1a1a1a',
                  border: '1px solid #3f3f46',
                  color: '#d4d4d8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  whiteSpace: 'nowrap',
                }}>
                  <Camera size={18} /> Скриншот
                </button>
                <button type="submit" style={{
                  padding: '12px',
                  borderRadius: '12px',
                  background: '#22d3ee',
                  color: '#000000',
                  border: 'none',
                  fontWeight: '700',
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}>
                  {savedFlash ? '✓ Сохранено' : 'Сохранить'}
                </button>
              </div>

              {/* Дополнительные поля */}
              <button type="button" onClick={() => setShowExtraFields(!showExtraFields)} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: '#a1a1aa',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.85rem',
                padding: 0,
              }}>
                {showExtraFields ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {showExtraFields ? 'Скрыть детали' : 'Ещё детали'}
              </button>

              {showExtraFields && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  padding: '12px',
                  background: '#1a1a1a',
                  borderRadius: '10px',
                }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Дата и время</label>
                    <input
                      type="datetime-local"
                      value={orderForm.date}
                      onChange={(e) => setOrderForm({...orderForm, date: e.target.value})}
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        background: '#000000',
                        border: '1px solid #3f3f46',
                        color: '#fafafa',
                        fontSize: '16px',
                        boxSizing: 'border-box',
                      }}
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
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        background: '#000000',
                        border: '1px solid #3f3f46',
                        color: '#fafafa',
                        fontSize: '16px',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Тип заказа</label>
                    <input
                      type="text"
                      value={orderForm.orderType}
                      onChange={(e) => setOrderForm({...orderForm, orderType: e.target.value})}
                      placeholder="Ресторан, Магазин, Аптека..."
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        background: '#000000',
                        border: '1px solid #3f3f46',
                        color: '#fafafa',
                        fontSize: '16px',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Погода</label>
                    <select
                      value={orderForm.weather}
                      onChange={(e) => setOrderForm({...orderForm, weather: e.target.value})}
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        background: '#000000',
                        border: '1px solid #3f3f46',
                        color: '#fafafa',
                        fontSize: '16px',
                        boxSizing: 'border-box',
                      }}
                    >
                      <option value="">-</option>
                      <option value="Ясно">Ясно</option>
                      <option value="Дождь">Дождь</option>
                      <option value="Снег">Снег</option>
                      <option value="Жара">Жара</option>
                      <option value="Холодно">Холодно</option>
                      <option value="Вечер">Вечер</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Проблемы с заказом</label>
                    <input
                      type="text"
                      value={orderForm.problem}
                      onChange={(e) => setOrderForm({...orderForm, problem: e.target.value})}
                      placeholder="Опишите проблему"
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        background: '#000000',
                        border: '1px solid #3f3f46',
                        color: '#fafafa',
                        fontSize: '16px',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Комментарий</label>
                    <textarea
                      value={orderForm.comment}
                      onChange={(e) => setOrderForm({...orderForm, comment: e.target.value})}
                      rows="2"
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        background: '#000000',
                        border: '1px solid #3f3f46',
                        color: '#fafafa',
                        fontSize: '16px',
                        resize: 'vertical',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
              )}
            </form>
          </div>
        )}

        {tab === 'stats' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '600', margin: 0 }}>Статистика</h2>

            {/* Переключатель Брутто/Нетто (только для Uber Eats) */}
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {['today', 'week', 'month', 'all', 'custom'].map(f => (
                <button key={f} onClick={() => setFilterType(f)} style={{
                  padding: '8px 14px',
                  borderRadius: '20px',
                  fontSize: '0.8rem',
                  border: '1px solid #3f3f46',
                  background: filterType === f ? '#22d3ee' : 'transparent',
                  color: filterType === f ? '#000000' : '#d4d4d8',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}>
                  {f === 'today' ? 'Сегодня' : f === 'week' ? 'Неделя' : f === 'month' ? 'Месяц' : f === 'all' ? 'Всё' : 'Период'}
                </button>
              ))}
            </div>
            {filterType === 'custom' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ padding: '10px', borderRadius: '8px', background: '#000000', border: '1px solid #3f3f46', color: '#fafafa', fontSize: '16px', boxSizing: 'border-box' }} />
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ padding: '10px', borderRadius: '8px', background: '#000000', border: '1px solid #3f3f46', color: '#fafafa', fontSize: '16px', boxSizing: 'border-box' }} />
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <button onClick={() => setServiceFilter('all')} style={{ padding: '8px 14px', borderRadius: '20px', fontSize: '0.8rem', border: '1px solid #3f3f46', background: serviceFilter === 'all' ? '#22d3ee' : 'transparent', color: serviceFilter === 'all' ? '#000000' : '#d4d4d8', cursor: 'pointer', whiteSpace: 'nowrap' }}>Все</button>
              {allServices.map(s => (
                <button key={s.name} onClick={() => setServiceFilter(s.name)} style={{ padding: '8px 14px', borderRadius: '20px', fontSize: '0.8rem', border: `1px solid ${serviceFilter === s.name ? s.color : '#3f3f46'}`, background: serviceFilter === s.name ? s.color + '20' : 'transparent', color: serviceFilter === s.name ? s.color : '#d4d4d8', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {s.icon} {s.name}
                </button>
              ))}
            </div>

            {/* Сводные карточки */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              <StatCard label="Доход" value={formatPLN(displayIncome)} />
              <StatCard label="Чистыми" value={formatPLN(stats.totalNetProfit)} />
              <StatCard label="Доход/час" value={stats.incomePerHour ? formatPLN(stats.incomePerHour) : '—'} />
              <StatCard label="Средний чек" value={formatPLN(stats.avgCheck)} />
              <StatCard label="Пробег" value={stats.totalKm.toFixed(1) + ' км'} />
              <StatCard label="Заказы" value={stats.orderCount} />
            </div>

            {/* Рекорды */}
            {records && (
              <div style={{ background: '#111111', borderRadius: '16px', padding: '16px', border: '1px solid #27272a' }}>
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

            {/* Графики */}
            {dailyData.length > 0 && (
              <div style={{ background: '#111111', borderRadius: '16px', padding: '16px', border: '1px solid #27272a' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '12px', marginTop: 0 }}>Доход по дням</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={dailyData}>
                    <XAxis dataKey="day" stroke="#71717a" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} />
                    <YAxis stroke="#71717a" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} width={36} />
                    <Tooltip contentStyle={{ background: '#111111', border: '1px solid #3f3f46', borderRadius: 8 }} formatter={(v) => formatPLN(v)} />
                    <Bar dataKey="value" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {serviceData.length > 0 && (
              <div style={{ background: '#111111', borderRadius: '16px', padding: '16px', border: '1px solid #27272a' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '12px', marginTop: 0 }}>По сервисам</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={serviceData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                      {serviceData.map((entry, index) => {
                        const info = getServiceInfo(entry.name);
                        return <Cell key={index} fill={info.color} />;
                      })}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#111111', border: '1px solid #3f3f46', borderRadius: 8 }} formatter={(v) => formatPLN(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginTop: '8px' }}>
                  {serviceData.map(s => {
                    const info = getServiceInfo(s.name);
                    return (
                      <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: '#d4d4d8' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: info.color }} />
                        {info.icon} {s.name}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Детализация расходов */}
            <div style={{ background: '#111111', borderRadius: '16px', padding: '16px', border: '1px solid #27272a' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '8px', marginTop: 0 }}>Детализация</h3>
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
              <div style={{ borderTop: '1px solid #3f3f46', marginTop: '8px', paddingTop: '8px', fontWeight: '700', display: 'flex', justifyContent: 'space-between' }}>
                <span>Итого</span><span>{formatPLN(stats.totalNetProfit)}</span>
              </div>
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '600', margin: 0 }}>История</h2>
              <button onClick={handleExportCSV} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '8px', background: '#111111', border: '1px solid #3f3f46', color: '#d4d4d8', cursor: 'pointer', fontSize: '0.8rem' }}>
                <Download size={16} /> CSV
              </button>
            </div>

            {/* Фильтры */}
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '8px' }}>
              {['today', 'week', 'month', 'all', 'custom'].map(f => (
                <button key={f} onClick={() => setFilterType(f)} style={{ padding: '8px 14px', borderRadius: '20px', fontSize: '0.8rem', border: '1px solid #3f3f46', background: filterType === f ? '#22d3ee' : 'transparent', color: filterType === f ? '#000000' : '#d4d4d8', whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0 }}>
                  {f === 'today' ? 'Сегодня' : f === 'week' ? 'Неделя' : f === 'month' ? 'Месяц' : f === 'all' ? 'Всё' : 'Период'}
                </button>
              ))}
              {filterType === 'custom' && (
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ width: '110px', padding: '6px', borderRadius: '8px', background: '#000000', border: '1px solid #3f3f46', color: '#fafafa', fontSize: '16px' }} />
                  <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ width: '110px', padding: '6px', borderRadius: '8px', background: '#000000', border: '1px solid #3f3f46', color: '#fafafa', fontSize: '16px' }} />
                </div>
              )}
            </div>

            {/* Список заказов */}
            {filteredOrders.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#52525b', padding: '40px 0', margin: 0 }}>Нет заказов за этот период</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {filteredOrders.map(o => {
                  const info = getServiceInfo(o.service);
                  return (
                    <div key={o.id} style={{ background: '#111111', borderRadius: '12px', padding: '12px', border: '1px solid #27272a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>{info.icon}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: '600', fontSize: '0.9rem', color: info.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.service}</div>
                          <div style={{ fontSize: '0.75rem', color: '#71717a' }}>{formatDateTime(o.date)}</div>
                          {(o.km1 || o.km2) > 0 && <div style={{ fontSize: '0.75rem', color: '#71717a' }}>{(o.km1||0)+(o.km2||0)} км</div>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <span style={{ fontWeight: '700', fontFamily: '"SF Mono", "Roboto Mono", monospace', fontSize: '0.95rem' }}>
                          {formatPLN(o.amount + (o.tips || 0))}
                        </span>
                        <button onClick={() => handleEditOrder(o)} style={{ background: 'none', border: 'none', color: '#22d3ee', cursor: 'pointer', padding: '4px' }}>
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => handleDeleteOrder(o.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Смены */}
            {filteredShifts.length > 0 && (
              <div>
                <h3 style={{ fontSize: '1rem', marginBottom: '8px', marginTop: 0 }}>Смены</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {filteredShifts.map(s => (
                    <div key={s.id} style={{ background: '#111111', borderRadius: '12px', padding: '12px', border: '1px solid #27272a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '600', margin: 0 }}>Настройки</h2>

            {/* Налоги */}
            <div style={{ background: '#111111', borderRadius: '16px', padding: '16px', border: '1px solid #27272a' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '12px', marginTop: 0 }}>Налоги</h3>
              <SettingRow label="VAT Uber Eats, %" value={settings.vatRates.uber * 100} onChange={(v) => handleNestedSettingChange('vatRates', 'uber', v / 100)} />
              <SettingRow label="VAT Bolt Food, %" value={settings.vatRates.bolt * 100} onChange={(v) => handleNestedSettingChange('vatRates', 'bolt', v / 100)} />
              <SettingRow label="Ryczałt, %" value={settings.ryczaltRate * 100} onChange={(v) => handleSettingsChange('ryczaltRate', v / 100)} />
              <SettingRow label="UZ (ZUS), %" value={settings.uzRate * 100} onChange={(v) => handleSettingsChange('uzRate', v / 100)} />
              <SettingRow label="Фикс. ZUS, PLN" value={settings.zusFixed} onChange={(v) => handleSettingsChange('zusFixed', parseFloat(v) || 0)} />
              <SettingRow label="Дата перехода Uber" value={settings.transitionDate} onChange={(v) => handleSettingsChange('transitionDate', v)} />
              <SettingRow label="Дата перехода Glovo на UZ" value={settings.glovoUZStartDate} onChange={(v) => handleSettingsChange('glovoUZStartDate', v)} />
            </div>

            {/* Комиссия партнёра */}
            <div style={{ background: '#111111', borderRadius: '16px', padding: '16px', border: '1px solid #27272a' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '12px', marginTop: 0 }}>Комиссия партнёра</h3>
              <SettingRow label="Один сервис, PLN/нед" value={settings.partnerCommissionSingle} onChange={(v) => handleSettingsChange('partnerCommissionSingle', parseFloat(v) || 0)} />
              <SettingRow label="Два+ сервиса, PLN/нед" value={settings.partnerCommissionMulti} onChange={(v) => handleSettingsChange('partnerCommissionMulti', parseFloat(v) || 0)} />
            </div>

            {/* Свои сервисы */}
            <div style={{ background: '#111111', borderRadius: '16px', padding: '16px', border: '1px solid #27272a' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '12px', marginTop: 0 }}>Свои сервисы</h3>
              {settings.customServices?.map(s => (
                <div key={s} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                  <span style={{ color: '#d4d4d8' }}>{s}</span>
                  <button onClick={() => handleRemoveCustomService(s)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button onClick={handleAddCustomService} style={{ marginTop: '8px', padding: '10px 14px', borderRadius: '8px', background: '#1a1a1a', border: '1px solid #3f3f46', color: '#d4d4d8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                <Plus size={16} /> Добавить
              </button>
            </div>

            {/* Расходы на обслуживание */}
            <div style={{ background: '#111111', borderRadius: '16px', padding: '16px', border: '1px solid #27272a' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '12px', marginTop: 0 }}>Обслуживание</h3>
              <button onClick={() => setShowExpenseModal(true)} style={{ padding: '10px 14px', borderRadius: '8px', background: '#1a1a1a', border: '1px solid #3f3f46', color: '#d4d4d8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
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
            <div style={{ background: '#111111', borderRadius: '16px', padding: '16px', border: '1px solid #27272a' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '12px', marginTop: 0 }}>Данные</h3>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={() => fileInputRef.current.click()} style={{ padding: '10px 14px', borderRadius: '8px', background: '#1a1a1a', border: '1px solid #3f3f46', color: '#d4d4d8', cursor: 'pointer', fontSize: '0.85rem' }}>
                  Импорт CSV/JSON
                </button>
                <button onClick={handleExportCSV} style={{ padding: '10px 14px', borderRadius: '8px', background: '#1a1a1a', border: '1px solid #3f3f46', color: '#d4d4d8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                  <Download size={16} /> Экспорт CSV
                </button>
                <input ref={fileInputRef} type="file" accept=".csv,.json" style={{ display: 'none' }} onChange={handleImportFile} />
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

      {/* Модальные окна */}
      {showScreenshotModal && (
        <Modal onClose={() => setShowScreenshotModal(false)}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '12px', marginTop: 0 }}>Загрузка скриншота</h3>
          <input type="file" accept="image/*" onChange={handleScreenshotUpload} style={{ width: '100%', padding: '10px', background: '#000000', border: '1px solid #3f3f46', color: '#fafafa', borderRadius: '8px', marginBottom: '12px', boxSizing: 'border-box', fontSize: '16px' }} />
          {screenshotLoading && <p style={{ color: '#a1a1aa' }}>Распознавание...</p>}
          {screenshotParsed && (
            <div>
              <p style={{ marginBottom: '4px' }}>Распознанные данные:</p>
              <p style={{ marginBottom: '4px' }}>Сервис: {screenshotParsed.service}</p>
              <p style={{ marginBottom: '4px' }}>Сумма: {screenshotParsed.amount} PLN</p>
              <p style={{ marginBottom: '4px' }}>Км до ресторана: {screenshotParsed.km1} км</p>
              <p style={{ marginBottom: '4px' }}>Км до клиента: {screenshotParsed.km2} км</p>
              {screenshotParsed.tips && <p style={{ marginBottom: '12px' }}>Чаевые: {screenshotParsed.tips} PLN</p>}
              <button onClick={handleScreenshotConfirm} style={{ padding: '10px 16px', borderRadius: '8px', background: '#10b981', color: '#022c22', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '600' }}>
                <Check size={16} /> Подтвердить
              </button>
            </div>
          )}
        </Modal>
      )}

      {showFuelModal && (
        <Modal onClose={() => setShowFuelModal(false)}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '12px', marginTop: 0 }}>Завершение смены</h3>
          <p style={{ color: '#a1a1aa', marginBottom: '8px' }}>Расход на топливо (PLN):</p>
          <input type="number" step="0.01" value={fuelInput} onChange={(e) => setFuelInput(e.target.value)} placeholder="0.00" style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#000000', border: '1px solid #3f3f46', color: '#fafafa', marginBottom: '12px', boxSizing: 'border-box', fontSize: '16px' }} />
          <button onClick={handleFuelSave} style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#10b981', color: '#022c22', border: 'none', fontWeight: '700', cursor: 'pointer' }}>Сохранить</button>
        </Modal>
      )}

      {showExpenseModal && (
        <Modal onClose={() => setShowExpenseModal(false)}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '12px', marginTop: 0 }}>Добавить расход</h3>
          <input type="number" step="0.01" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} placeholder="Сумма, PLN" style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#000000', border: '1px solid #3f3f46', color: '#fafafa', marginBottom: '8px', boxSizing: 'border-box', fontSize: '16px' }} />
          <input type="text" value={expenseNote} onChange={(e) => setExpenseNote(e.target.value)} placeholder="Описание (масло, ремонт...)" style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#000000', border: '1px solid #3f3f46', color: '#fafafa', marginBottom: '12px', boxSizing: 'border-box', fontSize: '16px' }} />
          <button onClick={handleAddExpense} style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#10b981', color: '#022c22', border: 'none', fontWeight: '700', cursor: 'pointer' }}>Сохранить</button>
        </Modal>
      )}

      {showEditModal && editingOrder && (
        <Modal onClose={() => setShowEditModal(false)}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '12px', marginTop: 0 }}>Редактировать заказ</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Сервис</label>
              <select
                value={editingOrder.service}
                onChange={(e) => setEditingOrder({...editingOrder, service: e.target.value})}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', background: '#000000', border: '1px solid #3f3f46', color: '#fafafa', fontSize: '16px', boxSizing: 'border-box' }}
              >
                {allServices.map(s => <option key={s.name} value={s.name}>{s.icon} {s.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Доход (PLN)</label>
                <input
                  type="number"
                  step="0.01"
                  value={editingOrder.amount}
                  onChange={(e) => setEditingOrder({...editingOrder, amount: e.target.value})}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', background: '#000000', border: '1px solid #3f3f46', color: '#fafafa', fontSize: '16px', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Км (всего)</label>
                <input
                  type="number"
                  step="0.1"
                  value={editingOrder.km1}
                  onChange={(e) => setEditingOrder({...editingOrder, km1: e.target.value})}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', background: '#000000', border: '1px solid #3f3f46', color: '#fafafa', fontSize: '16px', boxSizing: 'border-box' }}
                />
              </div>
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Дата и время</label>
              <input
                type="datetime-local"
                value={editingOrder.date}
                onChange={(e) => setEditingOrder({...editingOrder, date: e.target.value})}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', background: '#000000', border: '1px solid #3f3f46', color: '#fafafa', fontSize: '16px', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '6px', display: 'block' }}>Чаевые (PLN)</label>
              <input
                type="number"
                step="0.01"
                value={editingOrder.tips}
                onChange={(e) => setEditingOrder({...editingOrder, tips: e.target.value})}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', background: '#000000', border: '1px solid #3f3f46', color: '#fafafa', fontSize: '16px', boxSizing: 'border-box' }}
              />
            </div>
            <button onClick={handleEditSave} style={{ padding: '12px', borderRadius: '8px', background: '#10b981', color: '#022c22', border: 'none', fontWeight: '700', cursor: 'pointer' }}>
              Сохранить изменения
            </button>
          </div>
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

function Modal({ children, onClose }) {
  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 200,
      padding: '20px',
    }}>
      <div style={{
        background: '#111111',
        padding: '20px',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '400px',
        color: '#fafafa',
        position: 'relative',
      }}>
        <button onClick={onClose} style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'none',
          border: 'none',
          color: '#fafafa',
          cursor: 'pointer',
        }}>
          <X size={20} />
        </button>
        {children}
      </div>
    </div>
  );
}

function SettingRow({ label, value, onChange }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '10px',
      gap: '10px',
    }}>
      <span style={{ fontSize: '0.85rem', color: '#d4d4d8', flex: 1 }}>{label}</span>
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '90px',
          padding: '8px',
          borderRadius: '6px',
          background: '#000000',
          border: '1px solid #3f3f46',
          color: '#fafafa',
          textAlign: 'right',
          flexShrink: 0,
          fontSize: '16px',
        }}
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
📁 Обновлённый index.html
html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <link rel="manifest" href="./manifest.json" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Курьер" />
  <title>Курьер</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #000000;
    }
    input, select, textarea {
      font-size: 16px !important;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./src/main.jsx"></script>
</body>
</html>
