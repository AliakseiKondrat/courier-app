import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  Plus, BarChart3, List, Settings as SettingsIcon,
  Play, Square, Trash2, Download, ChevronDown, ChevronUp, X,
  Camera, Fuel, Wrench, Check, RefreshCw, Pencil, Calendar
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
  ryczaltRate: 0.085,
  uzRate: 0.277,
  zusFixed: 110,
  transitionDate: '2026-09-01',
  glovoUZStartDate: '2025-01-01',
  boltUZStartDate: null,
  stuartUZStartDate: null,
  partnerCommissionSingle: 29.90,
  partnerCommissionMulti: 49.90,
  customServices: [],
};

const FIXED_SERVICES = [
  { name: 'Uber Eats', color: '#008000', icon: '🚗' },
  { name: 'Stuart', color: '#00BFFF', icon: '🛵' },
  { name: 'Bolt Food', color: '#7CFC00', icon: '⚡' },
  { name: 'Pyszne.pl', color: '#FF8C00', icon: '🍽️' },
  { name: 'Glovo', color: '#FFD700', icon: '🛍️' },
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
const stripZ = (iso) => (iso && iso.endsWith('Z')) ? iso.slice(0, -1) : iso;
const formatPLN = (val) => (val ?? 0).toFixed(2) + ' zł';
const formatDate = (iso) => new Date(stripZ(iso)).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
const formatDateTime = (iso) => new Date(stripZ(iso)).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const formatTime = (iso) => new Date(stripZ(iso)).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const getWeekStart = (dateStr) => {
  const d = new Date(stripZ(dateStr));
  const day = d.getDay();
  const diff = (day === 0 ? 6 : day - 1);
  const monday = new Date(d);
  monday.setDate(d.getDate() - diff);
  monday.setHours(0,0,0,0);
  return monday.toISOString();
};

// ---------- НАЛОГИ ----------
const getBaseNet = (order) => {
  return order.amount;
};

const getTax = (order, settings) => {
  const baseNet = getBaseNet(order);
  const orderDate = new Date(stripZ(order.date));
  switch(order.service) {
    case 'Uber Eats': {
      const isBefore = orderDate < new Date(settings.transitionDate);
      return isBefore ? baseNet * settings.ryczaltRate : baseNet * settings.uzRate;
    }
    case 'Bolt Food': {
      if (settings.boltUZStartDate && orderDate >= new Date(settings.boltUZStartDate)) {
        return baseNet * settings.uzRate;
      }
      return baseNet * settings.ryczaltRate;
    }
    case 'Stuart': {
      if (settings.stuartUZStartDate && orderDate >= new Date(settings.stuartUZStartDate)) {
        return baseNet * settings.uzRate;
      }
      return baseNet * settings.ryczaltRate;
    }
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
  const baseNet = getBaseNet(order);
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
  const [showZus, setShowZus] = useState(true);

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
  const [expenseCategory, setExpenseCategory] = useState('Обслуживание');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0,10));

  const [editingOrder, setEditingOrder] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEditExtra, setShowEditExtra] = useState(false);

  const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());

  const [showShiftModal, setShowShiftModal] = useState(false);
  const [shiftDate, setShiftDate] = useState(new Date().toISOString().slice(0,10));
  const [shiftStartTime, setShiftStartTime] = useState('09:00');
  const [shiftEndTime, setShiftEndTime] = useState('17:00');
  const [shiftFuel, setShiftFuel] = useState('');

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

  // Сброс выбора при изменении фильтров
  useEffect(() => {
    setSelectedOrderIds(new Set());
  }, [filterType, serviceFilter]);

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

  // Фильтрация заказов (сортировка по дате)
  const filteredOrders = useMemo(() => {
    const [start, end] = getRange(filterType);
    let result = orders.filter(o => {
      const inService = serviceFilter === 'all' || o.service === serviceFilter;
      if (!inService) return false;
      if (start === null && end === null) return true;
      const d = new Date(stripZ(o.date)).toISOString();
      return d >= start && d < end;
    });
    result = result.sort((a, b) => new Date(stripZ(b.date)) - new Date(stripZ(a.date)));
    return result;
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

  // Статистика с учётом ZUS
  const stats = useMemo(() => {
    const grossIncome = filteredOrders.reduce((sum, o) => sum + o.amount + (o.tips || 0), 0);
    let netAfterTax;
    if (showZus) {
      netAfterTax = filteredOrders.reduce((sum, o) => sum + getNetAfterTax(o, settings), 0);
    } else {
      netAfterTax = filteredOrders.reduce((sum, o) => {
        if (o.service === 'Glovo' || o.service === 'Pyszne.pl') {
          return sum + o.amount;
        }
        return sum + getNetAfterTax(o, settings);
      }, 0);
    }

    const weekCommissions = computeWeeklyCommissions(filteredOrders, settings);
    const totalCommission = weekCommissions.reduce((sum, w) => sum + w.commission, 0);

    const totalFuel = filteredShifts.reduce((sum, s) => sum + (s.fuelCost || 0), 0);
    const totalMaintenance = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

    // ZUS: вычитаем по 110 zł за каждый месяц, в котором были заказы на Stuart/Uber/Bolt Food
    let zusDeduction = 0;
    if (showZus) {
      const monthSet = new Set();
      filteredOrders.forEach(o => {
        const d = new Date(stripZ(o.date));
        const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
        if (['Uber Eats', 'Bolt Food', 'Stuart'].includes(o.service)) {
          monthSet.add(monthKey);
        }
      });
      zusDeduction = monthSet.size * settings.zusFixed;
    }

    const totalNetProfit = netAfterTax - totalCommission - totalFuel - totalMaintenance - zusDeduction;

    const totalHours = filteredShifts.reduce((sum, s) => {
      const start = new Date(stripZ(s.start));
      const end = new Date(stripZ(s.end));
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
  }, [filteredOrders, filteredShifts, filteredExpenses, settings, filterType, showZus]);

  // Чистый доход за сегодня и неделю
  const todayNet = useMemo(() => {
    const [start, end] = getRange('today');
    const todayOrders = orders.filter(o => new Date(stripZ(o.date)) >= new Date(start) && new Date(stripZ(o.date)) < new Date(end));
    const todayShifts = shifts.filter(s => s.start >= start && s.start < end);
    const todayExpenses = expenses.filter(e => e.date >= start && e.date < end);
    const netAfter = todayOrders.reduce((sum, o) => sum + (showZus ? getNetAfterTax(o, settings) : o.amount), 0);
    const commission = computeWeeklyCommissions(todayOrders, settings).reduce((sum, w) => sum + w.commission, 0);
    const fuel = todayShifts.reduce((sum, s) => sum + (s.fuelCost || 0), 0);
    const maint = todayExpenses.reduce((sum, e) => sum + e.amount, 0);
    return netAfter - commission - fuel - maint;
  }, [orders, shifts, expenses, settings, showZus]);

  const weekNet = useMemo(() => {
    const [start, end] = getRange('week');
    const weekOrders = orders.filter(o => new Date(stripZ(o.date)) >= new Date(start) && new Date(stripZ(o.date)) < new Date(end));
    const weekShifts = shifts.filter(s => s.start >= start && s.start < end);
    const weekExpenses = expenses.filter(e => e.date >= start && e.date < end);
    const netAfter = weekOrders.reduce((sum, o) => sum + (showZus ? getNetAfterTax(o, settings) : o.amount), 0);
    const commission = computeWeeklyCommissions(weekOrders, settings).reduce((sum, w) => sum + w.commission, 0);
    const fuel = weekShifts.reduce((sum, s) => sum + (s.fuelCost || 0), 0);
    const maint = weekExpenses.reduce((sum, e) => sum + e.amount, 0);
    return netAfter - commission - fuel - maint;
  }, [orders, shifts, expenses, settings, showZus]);

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
      const value = showZus ? getNetAfterTax(o, settings) : (o.service === 'Glovo' || o.service === 'Pyszne.pl' ? o.amount : getNetAfterTax(o, settings));
      map.set(day, (map.get(day) || 0) + value);
    });
    return Array.from(map.entries()).map(([day, value]) => ({ day, value: Math.round(value * 100) / 100 }));
  }, [filteredOrders, settings, showZus]);

  const serviceData = useMemo(() => {
    const map = new Map();
    filteredOrders.forEach(o => {
      const value = showZus ? getNetAfterTax(o, settings) : (o.service === 'Glovo' || o.service === 'Pyszne.pl' ? o.amount : getNetAfterTax(o, settings));
      map.set(o.service, (map.get(o.service) || 0) + value);
    });
    return Array.from(map.entries()).map(([service, value]) => ({ name: service, value: Math.round(value * 100) / 100 }));
  }, [filteredOrders, settings, showZus]);

  const COLORS = ['#008000', '#00BFFF', '#7CFC00', '#FF8C00', '#FFD700', '#5E35B1', '#00838F', '#F57F17'];

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
    setOrderForm(prev => ({
      ...prev,
      amount: '',
      km1: '',
      km2: '',
      tips: '',
      orderType: '',
      weather: '',
      problem: '',
      comment: '',
      date: orderForm.date,
    }));
    setShowExtraFields(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  };

  const handleEditOrder = (order) => {
    setEditingOrder({
      ...order,
      date: new Date(stripZ(order.date)).toISOString().slice(0,16),
    });
    setShowEditExtra(false);
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
      orderType: editingOrder.orderType || '',
      weather: editingOrder.weather || '',
      problem: editingOrder.problem || '',
      comment: editingOrder.comment || '',
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

  const handleAddManualShift = () => {
    const startDate = new Date(`${shiftDate}T${shiftStartTime}:00`);
    const endDate = new Date(`${shiftDate}T${shiftEndTime}:00`);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate <= startDate) {
      alert('Проверьте дату и время смены');
      return;
    }
    const newShift = {
      id: genId(),
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      fuelCost: parseFloat(shiftFuel) || 0,
    };
    setState(prev => ({ ...prev, shifts: [...prev.shifts, newShift] }));
    setShowShiftModal(false);
    setShiftDate(new Date().toISOString().slice(0,10));
    setShiftStartTime('09:00');
    setShiftEndTime('17:00');
    setShiftFuel('');
  };

  const handleAddExpense = () => {
    if (!expenseAmount) return;
    const expense = {
      id: genId(),
      date: new Date(expenseDate).toISOString(),
      category: expenseCategory,
      amount: parseFloat(expenseAmount),
      note: expenseNote,
    };
    setState(prev => ({ ...prev, expenses: [...prev.expenses, expense] }));
    setExpenseAmount('');
    setExpenseNote('');
    setExpenseCategory('Обслуживание');
    setExpenseDate(new Date().toISOString().slice(0,10));
    setShowExpenseModal(false);
  };

  const handleScreenshotUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setScreenshotLoading(true);
    setScreenshotParsed(null);
    setShowScreenshotModal(true);
    setTimeout(() => {
      const parsed = {
        service: 'Uber Eats',
        amount: Math.floor(Math.random() * 100) + 10,
        km1: Math.floor(Math.random() * 15) + 1,
        km2: Math.floor(Math.random() * 15) + 1,
        tips: Math.random() > 0.5 ? Math.floor(Math.random() * 10) + 1 : 0,
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
    setScreenshotLoading(false);
  };

  const handleExportCSV = () => {
    const headers = ['Дата', 'Сервис', 'Сумма', 'Чаевые', 'Км (всего)', 'Тип заказа', 'Погода', 'Проблемы', 'Комментарий'];
    const rows = filteredOrders.map(o => [
      o.date,
      o.service,
      o.amount,
      o.tips || 0,
      (o.km1 || 0) + (o.km2 || 0),
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
              km1: parseFloat(obj['Км (всего)']) || 0,
              km2: 0,
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

  // Выбор заказов
  const toggleOrderSelection = (id) => {
    setSelectedOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllOrders = () => {
    setSelectedOrderIds(new Set(filteredOrders.map(o => o.id)));
  };

  const clearSelection = () => {
    setSelectedOrderIds(new Set());
  };

  const deleteSelectedOrders = () => {
    setState(prev => ({
      ...prev,
      orders: prev.orders.filter(o => !selectedOrderIds.has(o.id)),
    }));
    setSelectedOrderIds(new Set());
  };

  const handleSettingsChange = (key, value) => {
    setState(prev => ({
      ...prev,
      settings: { ...prev.settings, [key]: value },
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
      case 'Uber Eats':
      case 'Bolt Food':
        return 'Вводите сумму нетто (после вычета VAT).';
      case 'Stuart':
        return 'Вводите сумму без VAT (уже чистая).';
      case 'Glovo': {
        const before = new Date(stripZ(orderForm.date)) < new Date(settings.glovoUZStartDate);
        return before
          ? 'Вводите сумму без VAT. До даты перехода на UZ облагается только Ryczałt.'
          : 'Вводите сумму без VAT. После перехода на UZ облагается ZUS.';
      }
      case 'Pyszne.pl':
        return 'Вводите сумму без VAT. Работает по Umowa Zlecenie.';
      default:
        return 'Вводите сумму дохода.';
    }
  };

  const miniButtonStyle = {
    padding: '8px 12px',
    borderRadius: '8px',
    background: '#1a1a1a',
    border: '1px solid #3f3f46',
    color: '#d4d4d8',
    cursor: 'pointer',
    fontSize: '0.8rem',
    whiteSpace: 'nowrap',
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
        {/* Шапка с чистыми доходами за сегодня и неделю */}
        <header style={{
          marginBottom: '20px',
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#71717a', marginBottom: '2px' }}>Сегодня</div>
            <div style={{ fontSize: '1.4rem', fontWeight: '700', fontFamily: 'monospace' }}>{formatPLN(todayNet)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#71717a', marginBottom: '2px' }}>Неделя</div>
            <div style={{ fontSize: '1.4rem', fontWeight: '700', fontFamily: 'monospace' }}>{formatPLN(weekNet)}</div>
