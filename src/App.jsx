import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  LayoutDashboard, Package, Truck, Building2, Users as UsersIcon, FileText,
  AlertTriangle, ClipboardList, ShoppingCart, BarChart3, Settings as SettingsIcon,
  LogOut, Plus, Search, X, Pencil, Trash2, Ban, Image as ImageIcon,
  ChevronDown, Download, Printer, Lock, Eye, EyeOff, CheckCircle2,
  RotateCcw, Boxes, Store, ScrollText, KeyRound, RefreshCw
} from "lucide-react";
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { loadState, saveState, deleteState, subscribeToChanges } from "./storage.supabase.js";

/* ============================== TOKENS ============================== */
const T = {
  green900: "#0F2A1E",
  green800: "#153A26",
  green700: "#1E5631",
  green600: "#2C7A45",
  green100: "#E7F2E9",
  yellow500: "#F2B705",
  yellow600: "#D99E00",
  yellow100: "#FDF3D0",
  cream: "#FAF9F4",
  ink: "#1B2420",
  gray500: "#6B7568",
  gray300: "#D8DED5",
  border: "#E1E4DC",
  red: "#D8453B",
  orange: "#F07B1D",
  amber: "#F2B705",
  ok: "#2C9E5B",
  expired: "#4A4A46",
};

const AREAS = ["almacen", "congelador", "refrigerador", "barra"];
const AREA_LABELS = { almacen: "Almacén", congelador: "Congelador", refrigerador: "Refrigerador", barra: "Barra" };
const MERMA_CLASS = { caducidad: "Caducidad", mal_estado: "Mal estado", produccion: "Producción" };
const MERMA_UNITS = ["Piezas", "Kg", "Litros", "Otro"];
const MERMA_PERIODS = { diario: "Diario", semanal: "Semanal", mensual: "Mensual", trimestral: "Trimestral" };
const INV_TYPES = { fisico: "Inventario Físico", existencia_inicial: "Existencia Inicial", auditoria: "Auditoría" };
const INV_STATUS_META = {
  en_proceso: { bg: "#FDF3D0", fg: "#D99E00", label: "En proceso" },
  finalizado: { bg: "#E7F2E9", fg: "#1E5631", label: "Finalizado" },
  cancelado: { bg: "#EEEFEB", fg: "#6B7568", label: "Cancelado" },
};
const DIFF_LEVEL_META = {
  sin_diferencia: { bg: "#E7F2E9", fg: "#1E5631", label: "Sin diferencia", icon: "⚪" },
  diferencia_menor: { bg: "#FDF3D0", fg: "#D99E00", label: "Diferencia menor", icon: "🟡" },
  diferencia_significativa: { bg: "#FBDCDA", fg: "#D8453B", label: "Diferencia significativa", icon: "🔴" },
};
const MODULES = {
  dashboard: "Dashboard", productos: "Productos", proveedores: "Proveedores", sucursales: "Sucursales",
  usuarios: "Usuarios", facturas: "Facturas", inventario: "Inventario físico", alertas: "Alertas de caducidad",
  mermas: "Mermas", pedidos: "Pedidos sugeridos", reportes: "Reportes", bitacora: "Bitácora", config: "Configuración", auth: "Autenticación",
};

/* ============================== HELPERS ============================== */
let seq = 1000;
const uid = (p) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowStamp = () => {
  const d = new Date();
  return { date: d.toISOString().slice(0, 10), time: d.toTimeString().slice(0, 5) };
};
const fmtDate = (s) => (s ? new Date(s + "T00:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtMoney = (n) => (Number(n) || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const clampNum = (n) => (isNaN(n) ? 0 : Math.max(0, Number(n)));

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.round((d - t) / 86400000);
}
function semaphoreLevel(dateStr, cfg) {
  if (!dateStr) return "none";
  const d = daysUntil(dateStr);
  if (d < 0) return "expired";
  if (d <= cfg.alertRed) return "red";
  if (d <= cfg.alertOrange) return "orange";
  if (d <= cfg.alertYellow) return "yellow";
  return "ok";
}
const SEM_META = {
  ok: { bg: T.green100, fg: T.green700, label: "Vigente" },
  yellow: { bg: T.yellow100, fg: T.yellow600, label: "30 días" },
  orange: { bg: "#FDE6D2", fg: T.orange, label: "15 días" },
  red: { bg: "#FBDCDA", fg: T.red, label: "5 días" },
  expired: { bg: "#E4E4E1", fg: T.expired, label: "Caducado" },
  none: { bg: "#EEEFEB", fg: T.gray500, label: "Sin fecha" },
};

function packagesAndPieces(pieces, perPkg) {
  perPkg = perPkg || 1;
  const pk = Math.floor(pieces / perPkg);
  const pz = pieces % perPkg;
  return `${pk} paq${pz ? ` + ${pz} pz` : ""}`;
}

function theoreticalStock(lots, productId, branchId) {
  return lots.filter((l) => l.productId === productId && l.branchId === branchId && l.status === "active")
    .reduce((s, l) => s + l.remainingPieces, 0);
}

/* Costo unitario ponderado de la existencia actual de un producto/sucursal,
   a partir del costo real de cada lote activo (no un valor capturado a mano). */
function weightedUnitCost(lots, productId, branchId) {
  const relevant = lots.filter((l) => l.productId === productId && l.branchId === branchId && l.status === "active");
  const qty = relevant.reduce((s, l) => s + l.remainingPieces, 0);
  const val = relevant.reduce((s, l) => s + l.remainingPieces * (l.costPerUnit || 0), 0);
  return qty > 0 ? val / qty : 0;
}

function reconcileLotsForCount(lots, productId, branchId, newTotal) {
  const relevant = lots.filter((l) => l.productId === productId && l.branchId === branchId && l.status === "active");
  const others = lots.filter((l) => !(l.productId === productId && l.branchId === branchId && l.status === "active"));
  const sorted = [...relevant].sort((a, b) => {
    if (!a.expirationDate) return 1;
    if (!b.expirationDate) return -1;
    return a.expirationDate.localeCompare(b.expirationDate);
  });
  const currentTotal = sorted.reduce((s, l) => s + l.remainingPieces, 0);
  let toRemove = Math.max(0, currentTotal - newTotal);
  const updated = sorted.map((lot) => {
    if (toRemove <= 0) return { ...lot };
    if (lot.remainingPieces <= toRemove) {
      toRemove -= lot.remainingPieces;
      return { ...lot, remainingPieces: 0, status: "agotado" };
    }
    const newRemaining = lot.remainingPieces - toRemove;
    toRemove = 0;
    return { ...lot, remainingPieces: newRemaining };
  });
  const surplus = Math.max(0, newTotal - currentTotal);
  if (surplus > 0) {
    updated.push({
      id: uid("lot"), invoiceId: null, productId, branchId,
      expirationDate: null, entryDate: todayISO(),
      initialPieces: surplus, remainingPieces: surplus,
      costPerUnit: 0, status: "active", source: "ajuste",
    });
  }
  return [...others, ...updated];
}

/* Descuenta piezas del inventario teórico de un producto/sucursal por una merma
   (formato FEFO, reutilizando la misma lógica de conciliación de lotes). Nunca
   deja existencias negativas. */
function deductFromLots(lots, productId, branchId, qty) {
  const current = theoreticalStock(lots, productId, branchId);
  return reconcileLotsForCount(lots, productId, branchId, Math.max(0, current - qty));
}

/* Calcula el costo real de dar de baja "qty" piezas de un producto/sucursal,
   usando el mismo orden FEFO que la deducción de inventario — así el costo
   de una merma siempre refleja lo que esas piezas costaron realmente al
   entrar (factura), nunca un valor capturado a mano. Si la cantidad pedida
   excede lo disponible, calcula sobre lo que realmente hay (consumed). */
function computeFEFOCost(lots, productId, branchId, qty) {
  const relevant = lots.filter((l) => l.productId === productId && l.branchId === branchId && l.status === "active");
  const sorted = [...relevant].sort((a, b) => {
    if (!a.expirationDate) return 1;
    if (!b.expirationDate) return -1;
    return a.expirationDate.localeCompare(b.expirationDate);
  });
  let remaining = qty, totalCost = 0, consumed = 0;
  for (const lot of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(lot.remainingPieces, remaining);
    totalCost += take * (lot.costPerUnit || 0);
    consumed += take;
    remaining -= take;
  }
  return { unitCost: consumed > 0 ? totalCost / consumed : 0, totalCost, consumed };
}

/* Devuelve piezas al inventario teórico (por ejemplo, al cancelar una merma). */
function restoreToLots(lots, productId, branchId, qty) {
  const current = theoreticalStock(lots, productId, branchId);
  return reconcileLotsForCount(lots, productId, branchId, current + qty);
}

/* Devuelve el rango de fechas (ISO) del periodo actual según la configuración
   general (diario/semanal/mensual/trimestral), usado para calcular el % de
   merma "a la fecha" dentro de ese periodo. */
function getPeriodRange(period) {
  const now = new Date();
  const end = todayISO();
  let start;
  if (period === "diario") {
    start = end;
  } else if (period === "semanal") {
    const d = new Date(now); const day = d.getDay(); const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff); start = d.toISOString().slice(0, 10);
  } else if (period === "trimestral") {
    const q = Math.floor(now.getMonth() / 3);
    start = new Date(now.getFullYear(), q * 3, 1).toISOString().slice(0, 10);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }
  return { start, end };
}

/* Calcula el estado de merma de una sucursal contra su estándar configurado:
   valor de mermas / valor de compras del periodo, comparado contra el %
   máximo. Devuelve también los productos y causas con mayor incidencia,
   igual que pide la especificación para el detalle de la alerta. */
function computeMermaStatusForRange(state, branchId, start, end) {
  const mermasInPeriod = state.mermas.filter((m) => m.branchId === branchId && m.status !== "cancelled" && m.date >= start && m.date <= end);
  const comprasInPeriod = state.invoices.filter((i) => i.branchId === branchId && i.status !== "cancelled" && i.entryDate >= start && i.entryDate <= end);
  const valorMermas = mermasInPeriod.reduce((s, m) => s + m.totalCost, 0);
  const valorCompras = comprasInPeriod.reduce((s, i) => s + i.total, 0);
  const realPercent = valorCompras > 0 ? (valorMermas / valorCompras) * 100 : (valorMermas > 0 ? 100 : 0);
  const branch = state.branches.find((b) => b.id === branchId);
  const standard = branch && branch.mermaStandardPercent != null ? branch.mermaStandardPercent : null;
  let estado = "sin_estandar";
  if (standard != null) {
    if (realPercent > standard) estado = "anomala";
    else if (realPercent >= standard * 0.8) estado = "advertencia";
    else estado = "dentro";
  }
  const byProduct = {};
  mermasInPeriod.forEach((m) => { byProduct[m.productId] = (byProduct[m.productId] || 0) + m.totalCost; });
  const topProducts = Object.entries(byProduct).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([pid, cost]) => ({ name: state.products.find((p) => p.id === pid)?.name || "—", cost }));
  const byClass = {};
  mermasInPeriod.forEach((m) => { byClass[m.classification] = (byClass[m.classification] || 0) + m.totalCost; });
  const topCauses = Object.entries(byClass).sort((a, b) => b[1] - a[1]).map(([k, cost]) => ({ name: MERMA_CLASS[k] || k, cost }));
  const excedente = standard != null ? Math.max(0, valorMermas - (valorCompras * standard) / 100) : 0;
  return { branchId, branchName: branch?.name || "—", start, end, valorMermas, valorCompras, realPercent, standard, estado, excedente, topProducts, topCauses };
}

function computeMermaStandardStatus(state, branchId, period) {
  const { start, end } = getPeriodRange(period);
  return computeMermaStatusForRange(state, branchId, start, end);
}

/* Mismo tipo de rango que getPeriodRange, pero para el periodo INMEDIATO
   ANTERIOR — se usa para comparar la evolución de cada sucursal contra el
   periodo pasado. */
function getPreviousPeriodRange(period) {
  const now = new Date();
  if (period === "diario") {
    const d = new Date(now); d.setDate(d.getDate() - 1);
    const s = d.toISOString().slice(0, 10); return { start: s, end: s };
  }
  if (period === "semanal") {
    const d = new Date(now); const day = d.getDay(); const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff - 7);
    const start = d.toISOString().slice(0, 10);
    const e = new Date(d); e.setDate(e.getDate() + 6);
    return { start, end: e.toISOString().slice(0, 10) };
  }
  if (period === "trimestral") {
    const q = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), (q - 1) * 3, 1);
    const end = new Date(now.getFullYear(), q * 3, 0);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/* Agrega los datos de mermas (filtrados) para el panel de análisis: totales,
   desgloses por sucursal/producto/categoría, y evolución mensual. */
function computeMermaAnalytics(state, filters) {
  const mermas = state.mermas.filter((m) => m.status !== "cancelled")
    .filter((m) => !filters.dateFrom || m.date >= filters.dateFrom)
    .filter((m) => !filters.dateTo || m.date <= filters.dateTo)
    .filter((m) => !filters.branchId || m.branchId === filters.branchId)
    .filter((m) => !filters.productId || m.productId === filters.productId)
    .filter((m) => !filters.classification || m.classification === filters.classification)
    .filter((m) => !filters.search || m.reason.toLowerCase().includes(filters.search.toLowerCase()));

  const totalCost = mermas.reduce((s, m) => s + m.totalCost, 0);

  const byBranch = {};
  mermas.forEach((m) => { byBranch[m.branchId] = (byBranch[m.branchId] || 0) + m.totalCost; });
  const porSucursal = state.branches.map((b) => ({ sucursal: b.name, costo: byBranch[b.id] || 0 })).filter((r) => r.costo > 0 || !filters.branchId);

  const byProduct = {};
  mermas.forEach((m) => { byProduct[m.productId] = (byProduct[m.productId] || 0) + m.totalCost; });
  const porProducto = Object.entries(byProduct).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([pid, cost]) => ({ producto: state.products.find((p) => p.id === pid)?.name || "—", costo: cost }));

  const byClass = {};
  mermas.forEach((m) => { byClass[m.classification] = (byClass[m.classification] || 0) + m.totalCost; });
  const porCategoria = Object.entries(byClass).map(([k, cost]) => ({ name: MERMA_CLASS[k] || k, value: cost }));

  const byMonth = {};
  mermas.forEach((m) => { const key = m.date.slice(0, 7); byMonth[key] = (byMonth[key] || 0) + m.totalCost; });
  const evolucion = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mes, costo]) => ({ mes: fmtDate(mes + "-01").replace(/ de \d+$/, ""), costo }));

  return { mermas, totalCost, totalCount: mermas.length, porSucursal, porProducto, porCategoria, evolucion };
}

/* Integración cruzada: por producto, muestra cuánto se compró, cuánto se
   consumió (estimado con el costo unitario más reciente, ya que el consumo
   histórico no guarda su propio costo), cuánto se perdió en mermas, y cuánto
   queda en existencia — igual que pide la especificación
   (Compras → Entradas → Inventario → Consumo → Mermas → Existencia final). */
/* Cuántas veces un producto tuvo faltante o sobrante en el historial de
   inventarios finalizados de una sucursal — para detectar diferencias
   recurrentes en el mismo producto. */
function countRecurrence(branchInvs, productId, direction) {
  return branchInvs.filter((pi) => (pi.counts || []).some((c) => c.productId === productId && (direction === "falt" ? c.difference < 0 : c.difference > 0))).length;
}

/* ¿Hay una merma registrada de este producto/sucursal cerca de la fecha del
   inventario (±3 días)? Si hay un faltante sin merma cercana, podría ser una
   merma no registrada. */
function hasNearbyMerma(state, productId, branchId, date) {
  const d0 = new Date(`${date}T00:00:00`);
  return state.mermas.some((m) => m.productId === productId && m.branchId === branchId && m.status !== "cancelled" && Math.abs((new Date(`${m.date}T00:00:00`) - d0) / 86400000) <= 3);
}

/* Kardex: historial de movimientos de un producto en una sucursal (entradas,
   mermas, y los ajustes de inventario físico — que ya incluyen tanto los
   faltantes por consumo como los sobrantes, sin volver a contarlos aparte
   como "consumo", ya que son el mismo movimiento de inventario visto desde
   otro ángulo). Se muestra del más reciente al más antiguo, con la
   existencia resultante después de cada movimiento. */
const ALERT_PRIORITY_META = {
  alta: { bg: "#FBDCDA", fg: T.red, label: "Alta", weight: 3 },
  media: { bg: "#FDE6D2", fg: T.orange, label: "Media", weight: 2 },
  baja: { bg: "#FDF3D0", fg: T.yellow600, label: "Baja", weight: 1 },
};

/* Central de Alertas: reúne en una sola lista las señales que ya calculan
   otros módulos (caducidad, mermas, inventario físico, pedidos) y suma las
   que todavía no existían (stock bajo/agotado, variación de costos), cada
   una con su prioridad y el módulo del que viene. No inventa nada nuevo
   sobre los datos — solo los junta y los prioriza. */
function computeCentralAlerts(state, branchIds) {
  const alerts = [];
  const push = (priority, module, title, detail) => alerts.push({ priority, module, title, detail });

  branchIds.forEach((branchId) => {
    const branch = state.branches.find((b) => b.id === branchId);
    const bname = branch?.name || "—";

    // Stock bajo o agotado
    state.products.filter((p) => p.status === "active" && p.idealStock && p.idealStock[branchId] > 0).forEach((p) => {
      const stock = theoreticalStock(state.lots, p.id, branchId);
      const ideal = p.idealStock[branchId];
      if (stock <= 0) push("alta", "Inventario", `${p.name} sin existencia`, `${bname} — se agotó, el ideal es ${ideal} pz.`);
      else if (stock < ideal * 0.3) push("media", "Inventario", `${p.name} con stock bajo`, `${bname} — quedan ${stock} pz de un ideal de ${ideal}.`);
    });

    // Productos próximos a caducar
    state.lots.filter((l) => l.branchId === branchId && l.status === "active" && l.remainingPieces > 0 && l.expirationDate).forEach((l) => {
      const level = semaphoreLevel(l.expirationDate, state.config);
      if (level === "red") push("alta", "Caducidad", `${state.products.find((p) => p.id === l.productId)?.name || "—"} por caducar`, `${bname} — caduca el ${fmtDate(l.expirationDate)} (${l.remainingPieces} pz).`);
      else if (level === "orange") push("media", "Caducidad", `${state.products.find((p) => p.id === l.productId)?.name || "—"} próximo a caducar`, `${bname} — caduca el ${fmtDate(l.expirationDate)} (${l.remainingPieces} pz).`);
    });

    // Mermas anómalas
    const mermaStatus = computeMermaStandardStatus(state, branchId, state.config.mermaPeriod || "mensual");
    if (mermaStatus.estado === "anomala") push("alta", "Mermas", `${bname}: merma por encima del estándar`, `${mermaStatus.realPercent.toFixed(1)}% real contra ${mermaStatus.standard}% máximo.`);
    else if (mermaStatus.estado === "advertencia") push("media", "Mermas", `${bname}: merma cerca del límite`, `${mermaStatus.realPercent.toFixed(1)}% real contra ${mermaStatus.standard}% máximo.`);

    // Diferencias significativas en inventarios físicos
    const lastInv = state.physicalInventories.filter((pi) => pi.branchId === branchId && isInventoryFinal(pi))
      .sort((a, b) => (b.createdAt?.date || b.date).localeCompare(a.createdAt?.date || a.date))[0];
    if (lastInv) {
      if (lastInv.requiresAuthorization && !lastInv.authorized) push("alta", "Inventario físico", `${bname}: inventario pendiente de autorización`, `${lastInv.folio} tuvo diferencias significativas sin autorizar.`);
      else {
        const sigCount = (lastInv.counts || []).filter((c) => c.diffLevel === "diferencia_significativa").length;
        if (sigCount > 0) push("media", "Inventario físico", `${bname}: diferencias significativas`, `${lastInv.folio} — ${sigCount} producto(s) con diferencia significativa.`);
      }
    }

    // Pedidos sugeridos
    const suggested = computeSuggestedOrders(state, branchId);
    if (suggested.length > 0) push("baja", "Pedidos sugeridos", `${bname}: ${suggested.length} producto(s) por pedir`, suggested.slice(0, 3).map((o) => o.productName).join(", ") + (suggested.length > 3 ? "…" : ""));
  });

  // Variación importante de costos (no depende de una sucursal en particular)
  state.products.filter((p) => p.status === "active" && (p.costHistory || []).length >= 2).forEach((p) => {
    const hist = [...p.costHistory].sort((a, b) => a.date.localeCompare(b.date));
    const prev = hist[hist.length - 2], last = hist[hist.length - 1];
    if (!prev.costPerPackage) return;
    const pct = ((last.costPerPackage - prev.costPerPackage) / prev.costPerPackage) * 100;
    if (Math.abs(pct) >= 30) push("alta", "Compras", `${p.name}: costo cambió mucho`, `${pct > 0 ? "Subió" : "Bajó"} ${Math.abs(pct).toFixed(1)}% — de ${fmtMoney(prev.costPerPackage)} a ${fmtMoney(last.costPerPackage)} por paquete.`);
    else if (Math.abs(pct) >= 15) push("media", "Compras", `${p.name}: variación de costo`, `${pct > 0 ? "Subió" : "Bajó"} ${Math.abs(pct).toFixed(1)}% — de ${fmtMoney(prev.costPerPackage)} a ${fmtMoney(last.costPerPackage)} por paquete.`);
  });

  return alerts.sort((a, b) => ALERT_PRIORITY_META[b.priority].weight - ALERT_PRIORITY_META[a.priority].weight);
}

function computeKardex(state, productId, branchId) {
  const rows = [];
  const seqOf = (id) => id.split("_").slice(1).join("_"); // parte con precisión de milisegundos del id

  state.invoices.filter((i) => i.branchId === branchId && i.status !== "cancelled").forEach((i) => {
    (i.items || []).filter((it) => it.productId === productId).forEach((it) => {
      const prod = state.products.find((p) => p.id === productId);
      const qty = it.packages * (prod?.piecesPerPackage || 1) + (it.looseUnits || 0);
      if (qty <= 0) return;
      rows.push({
        date: i.entryDate, sortKey: `${i.entryDate}_${seqOf(i.id)}`,
        type: "entrada", label: `Entrada — Factura ${i.invoiceNumber}`,
        detail: state.suppliers.find((s) => s.id === i.supplierId)?.name || "—",
        signedQty: qty, user: i.createdBy || "—",
      });
    });
  });

  state.mermas.filter((m) => m.productId === productId && m.branchId === branchId && m.status !== "cancelled").forEach((m) => {
    rows.push({
      date: m.date, sortKey: `${m.date}_${seqOf(m.id)}`,
      type: "merma", label: `Merma — ${MERMA_CLASS[m.classification] || m.classification}`,
      detail: m.reason, signedQty: -m.quantity, user: m.responsible,
    });
  });

  (state.inventoryAdjustments || []).filter((a) => a.productId === productId && a.branchId === branchId).forEach((a) => {
    rows.push({
      date: a.date, sortKey: `${a.date}_${seqOf(a.id)}`,
      type: a.adjustedQuantity < 0 ? "salida" : "ajuste",
      label: a.adjustedQuantity < 0 ? `Salida — Consumo (${a.inventoryFolio})` : `Entrada — Ajuste por sobrante (${a.inventoryFolio})`,
      detail: a.reason, signedQty: a.adjustedQuantity, user: a.user,
    });
  });

  rows.sort((r1, r2) => r2.sortKey.localeCompare(r1.sortKey));

  let running = theoreticalStock(state.lots, productId, branchId);
  return rows.map((r) => {
    const balanceAfter = running;
    running -= r.signedQty;
    return { ...r, balanceAfter };
  });
}

function computeCrossAnalysis(state, branchId, start, end) {
  const products = state.products.filter((p) => p.status === "active");
  return products.map((p) => {
    const relevantInvoices = state.invoices.filter((i) => i.status !== "cancelled" && (!branchId || i.branchId === branchId) && i.entryDate >= start && i.entryDate <= end);
    let comprado = 0;
    relevantInvoices.forEach((inv) => {
      inv.items.forEach((it) => {
        if (it.productId === p.id) comprado += it.packages * it.costPerPackage + (it.looseUnits || 0) * (it.costPerPackage / p.piecesPerPackage);
      });
    });
    const estUnitCost = p.lastCostPerPackage != null ? p.lastCostPerPackage / p.piecesPerPackage : 0;
    const relevantPI = state.physicalInventories.filter((pi) => isInventoryFinal(pi) && (!branchId || pi.branchId === branchId) && pi.date >= start && pi.date <= end);
    let consumido = 0;
    relevantPI.forEach((pi) => {
      const c = pi.consumption.find((c) => c.productId === p.id);
      if (c) consumido += c.consumedPieces * estUnitCost;
    });
    const mermaCost = state.mermas.filter((m) => m.status !== "cancelled" && m.productId === p.id && (!branchId || m.branchId === branchId) && m.date >= start && m.date <= end)
      .reduce((s, m) => s + m.totalCost, 0);
    const existencia = state.lots.filter((l) => l.productId === p.id && l.status === "active" && (!branchId || l.branchId === branchId))
      .reduce((s, l) => s + l.remainingPieces * (l.costPerUnit || 0), 0);
    return { productId: p.id, name: p.name, comprado, consumido, mermaCost, existencia };
  }).filter((r) => r.comprado > 0 || r.consumido > 0 || r.mermaCost > 0 || r.existencia > 0);
}

const MERMA_ESTADO_META = {
  dentro: { bg: "#E7F2E9", fg: "#1E5631", label: "Dentro del estándar" },
  advertencia: { bg: "#FDF3D0", fg: "#D99E00", label: "Advertencia" },
  anomala: { bg: "#FBDCDA", fg: "#D8453B", label: "Merma anómala" },
  sin_estandar: { bg: "#EEEFEB", fg: "#6B7568", label: "Sin estándar definido" },
};

/* Los inventarios físicos creados antes de esta actualización usaban
   status:"active" para "ya finalizado". Esta función reconoce ambos formatos
   sin necesidad de migrar los datos existentes. */
function isInventoryFinal(pi) {
  return pi.status === "finalizado" || pi.status === "active";
}
function isInventoryOpen(pi) {
  return pi.status === "en_proceso";
}

/* Clasifica una diferencia de inventario según el % de variación configurado
   por el Administrador General (Sin diferencia / Diferencia menor / Diferencia
   significativa). */
function classifyDiff(diffPercent, toleranceLimit) {
  if (diffPercent === 0) return "sin_diferencia";
  if (Math.abs(diffPercent) <= (toleranceLimit ?? 5)) return "diferencia_menor";
  return "diferencia_significativa";
}

/* Prefijo de folio sugerido a partir del nombre de la sucursal: inicial de
   cada palabra (ej. "SWY SAN CRISTOBAL" -> "SSC"). Si el nombre es una sola
   palabra, usa sus primeras 3 letras. */
function suggestFolioPrefix(name) {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.map((w) => w[0]).join("").toUpperCase().slice(0, 6);
  return (words[0] || "SUC").slice(0, 3).toUpperCase();
}

/* Garantiza que el prefijo no choque con el de otra sucursal ya existente
   (le agrega un número al final si hiciera falta: SSC, SSC2, SSC3...). */
function uniqueFolioPrefix(name, branches, exceptId) {
  const base = suggestFolioPrefix(name);
  const taken = new Set(branches.filter((b) => b.id !== exceptId && b.folioPrefix).map((b) => b.folioPrefix));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(base + n)) n++;
  return base + n;
}

/* Folio único por sucursal: cada sucursal lleva su propia numeración
   (PREFIJO-secuencial), usando el prefijo guardado de la sucursal — así
   nunca se repite entre sucursales y cada una tiene su propio conteo desde
   0001. */
function generateInventoryFolio(state, branchId) {
  const branch = state.branches.find((b) => b.id === branchId);
  const prefix = branch?.folioPrefix || (branch ? suggestFolioPrefix(branch.name) : "INV");
  const seq = state.physicalInventories.filter((pi) => pi.branchId === branchId).length + 1;
  return `${prefix}-${seq.toString().padStart(4, "0")}`;
}

/* Recalcula los folios de TODOS los inventarios de una sucursal según su
   prefijo actual, respetando el orden en que se crearon — útil si el
   prefijo cambió o si un inventario se creó antes de tener uno asignado. */
function recalcBranchFolios(state, branchId) {
  const branch = state.branches.find((b) => b.id === branchId);
  const prefix = branch?.folioPrefix || suggestFolioPrefix(branch?.name || "");
  const branchInvs = state.physicalInventories
    .filter((pi) => pi.branchId === branchId)
    .sort((a, b) => (a.createdAt?.date || a.date).localeCompare(b.createdAt?.date || b.date) || (a.createdAt?.time || "").localeCompare(b.createdAt?.time || ""));
  const folioById = {};
  branchInvs.forEach((pi, idx) => { folioById[pi.id] = `${prefix}-${(idx + 1).toString().padStart(4, "0")}`; });
  return folioById;
}

function computeSuggestedOrders(state, branchId) {
  return state.products
    .filter((p) => p.status === "active")
    .map((p) => {
      const ideal = (p.idealStock && p.idealStock[branchId]) || 0;
      const current = theoreticalStock(state.lots, p.id, branchId);
      const neededPieces = Math.max(0, ideal - current);
      return {
        productId: p.id, productName: p.name, supplierId: p.supplierId,
        piecesPerPackage: p.piecesPerPackage, idealStock: ideal, currentStock: current,
        neededPieces, neededPackages: Math.ceil(neededPieces / (p.piecesPerPackage || 1)),
      };
    })
    .filter((r) => r.neededPieces > 0);
}

/* ============================== SEED DATA ============================== */
function seedState() {
  const supplierId = "sup_propimex";
  const branchId = "suc_centro";
  const products = [
    ["Coca Cola", 24], ["Coca Cola sin azúcar", 12], ["Fanta", 12], ["Sprite", 12],
    ["Mundet", 12], ["Fuze Tea Durazno", 6], ["Fuze Tea Limón", 6], ["Agua", 12], ["Jugo del Valle", 12],
  ].map(([name, perPkg], i) => ({
    id: uid("prod"), name, piecesPerPackage: perPkg, supplierId,
    code: `PRP-${String(i + 1).padStart(3, "0")}`, notes: "", image: null,
    status: "active", idealStock: { [branchId]: perPkg * 4 },
  }));
  const lots = products.map((p) => ({
    id: uid("lot"), invoiceId: null, productId: p.id, branchId,
    expirationDate: null, entryDate: todayISO(),
    initialPieces: p.piecesPerPackage * 2, remainingPieces: p.piecesPerPackage * 2,
    costPerUnit: 0, status: "active", source: "inicial",
  }));
  return {
    branches: [{ id: branchId, number: 1, name: "Sucursal Centro", status: "active", mermaStandardPercent: 3, folioPrefix: "SC" }],
    suppliers: [{ id: supplierId, name: "PROPIMEX", productTypes: "Bebidas", paymentDueDays: 30, status: "active" }],
    products, lots,
    invoices: [], mermas: [], physicalInventories: [], inventoryAdjustments: [],
    users: [
      { id: uid("usr"), username: "1", password: "1971", role: "general_admin", name: "Administrador General", branchId: null, status: "active", failedAttempts: 0, lockedUntil: null, lastLogin: null },
      { id: uid("usr"), username: "100", password: "1234", role: "branch_admin", name: "Encargado Sucursal Centro", branchId, status: "active", failedAttempts: 0, lockedUntil: null, lastLogin: null },
    ],
    auditLog: [],
    config: { alertYellow: 30, alertOrange: 15, alertRed: 5, sessionTimeoutMin: 30, inventoryFrequency: "semanal", mermaPeriod: "mensual", mermaApprovalThreshold: null, inventoryToleranceLimit: 5 },
  };
}

/* ============================== STORAGE ============================== */
// El almacenamiento vive en ./storage.js — así se puede cambiar de localStorage
// a una base de datos compartida (para sincronizar entre equipos) sin tocar
// el resto de la aplicación. Ver ese archivo y el README para más detalles.

/* ============================== SMALL UI PARTS ============================== */
function Logo({ size = 36 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 48 48">
        <rect x="1" y="1" width="46" height="46" rx="14" fill={T.green700} />
        <path d="M32 16c-2-1.6-5-2.4-8-2.4-5 0-8 2-8 5.4 0 3.2 3 4.4 7 5.2 4.6 1 5.6 1.8 5.6 3.2 0 1.6-1.8 2.6-4.4 2.6-3 0-5.6-1-7.8-2.8l-2.6 3.6c2.6 2.2 6.2 3.4 10.2 3.4 5.6 0 9-2.6 9-6.4 0-3.6-2.6-4.8-7.2-5.8-4.4-1-5.4-1.6-5.4-3 0-1.4 1.6-2.2 3.8-2.2 2.4 0 4.6.8 6.6 2.2l2.2-3z" fill={T.yellow500} />
        <rect x="12" y="35.5" width="24" height="2.6" rx="1.3" fill={T.yellow500} />
      </svg>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: size * 0.5, lineHeight: 1, color: T.ink }}>
        Sub<span style={{ color: T.green700 }}>Gestor</span>
      </div>
    </div>
  );
}

function Pill({ bg, fg, children }) {
  return (
    <span style={{ background: bg, color: fg, padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: fg, display: "inline-block" }} />
      {children}
    </span>
  );
}
function SemPill({ dateStr, cfg }) {
  const lvl = semaphoreLevel(dateStr, cfg);
  const m = SEM_META[lvl];
  const d = daysUntil(dateStr);
  const extra = lvl === "none" ? "" : lvl === "expired" ? ` (${Math.abs(d)}d)` : ` · ${d}d`;
  return <Pill bg={m.bg} fg={m.fg}>{m.label}{extra}</Pill>;
}
function StatusPill({ status }) {
  const map = {
    active: [T.green100, T.green700, "Activo"], disabled: [T.gray300, T.gray500, "Desactivado"],
    pending: [T.yellow100, T.yellow600, "Pendiente de pago"], paid: [T.green100, T.green700, "Pagada"],
    cancelled: [T.gray300, T.gray500, "Cancelada"], pending_approval: [T.yellow100, T.yellow600, "Pendiente de aprobación"],
  };
  const [bg, fg, label] = map[status] || [T.gray300, T.gray500, status];
  return <Pill bg={bg} fg={fg}>{label}</Pill>;
}

function Btn({ children, onClick, variant = "primary", icon: Icon, type = "button", disabled, small }) {
  const styles = {
    primary: { background: T.green700, color: "#fff", border: "none" },
    secondary: { background: "#fff", color: T.green700, border: `1.5px solid ${T.green700}` },
    ghost: { background: "transparent", color: T.ink, border: `1px solid ${T.border}` },
    danger: { background: "#fff", color: T.red, border: `1.5px solid ${T.red}` },
    yellow: { background: T.yellow500, color: T.ink, border: "none" },
  };
  return (
    <button type={type} disabled={disabled} onClick={onClick}
      style={{ ...styles[variant], display: "inline-flex", alignItems: "center", gap: 6, padding: small ? "6px 10px" : "9px 16px", borderRadius: 10, fontWeight: 600, fontSize: small ? 12.5 : 13.5, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "'Inter',sans-serif" }}>
      {Icon && <Icon size={small ? 14 : 16} />}{children}
    </button>
  );
}
function Field({ label, children, hint }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, color: T.gray500, fontWeight: 600, width: "100%" }}>
      {label}
      {children}
      {hint && <span style={{ fontWeight: 400, fontSize: 11, color: T.gray500 }}>{hint}</span>}
    </label>
  );
}
const inputStyle = { border: `1.5px solid ${T.border}`, borderRadius: 8, padding: "8px 10px", fontSize: 13.5, fontFamily: "'Inter',sans-serif", color: T.ink, background: "#fff" };
function TextInput(props) { return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />; }
function Select(props) { return <select {...props} style={{ ...inputStyle, ...(props.style || {}) }} />; }
function TextArea(props) { return <textarea {...props} style={{ ...inputStyle, resize: "vertical", ...(props.style || {}) }} />; }

function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,42,30,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 50, padding: "40px 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: width, padding: 24, boxShadow: "0 20px 60px rgba(15,42,30,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontFamily: "'Space Grotesk',sans-serif", fontSize: 18, color: T.ink }}>{title}</h3>
          <button onClick={onClose} style={{ background: T.cream, border: "none", borderRadius: 8, padding: 6, cursor: "pointer" }}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Card({ children, style }) {
  return <div style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 14, padding: 18, ...style }}>{children}</div>;
}
function EmptyState({ text }) {
  return <div style={{ padding: 30, textAlign: "center", color: T.gray500, fontSize: 13 }}>{text}</div>;
}
function Th({ children }) { return <th style={{ textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: T.gray500, padding: "8px 10px", borderBottom: `2px solid ${T.border}` }}>{children}</th>; }
function Td({ children, mono }) { return <td style={{ padding: "10px 10px", borderBottom: `1px solid ${T.border}`, fontSize: 13, fontFamily: mono ? "'IBM Plex Mono',monospace" : "'Inter',sans-serif", color: T.ink }}>{children}</td>; }

function buildCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
}

function escapeHTML(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SG_LOGO_SVG = `<svg width="30" height="30" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="46" height="46" rx="14" fill="#1E5631"/><path d="M32 16c-2-1.6-5-2.4-8-2.4-5 0-8 2-8 5.4 0 3.2 3 4.4 7 5.2 4.6 1 5.6 1.8 5.6 3.2 0 1.6-1.8 2.6-4.4 2.6-3 0-5.6-1-7.8-2.8l-2.6 3.6c2.6 2.2 6.2 3.4 10.2 3.4 5.6 0 9-2.6 9-6.4 0-3.6-2.6-4.8-7.2-5.8-4.4-1-5.4-1.6-5.4-3 0-1.4 1.6-2.2 3.8-2.2 2.4 0 4.6.8 6.6 2.2l2.2-3z" fill="#F2B705"/></svg>`;

/* Genera un documento HTML con diseño de marca (logo, verde/amarillo, encabezado
   con fecha) para copiar con formato (pega con colores en Excel/Sheets) o
   descargar como .xls con el mismo diseño. */
function buildStyledReport(title, rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const headCells = headers.map((h) => `<th style="background:#1E5631;color:#ffffff;padding:9px 12px;font-family:Arial,sans-serif;font-size:12px;text-align:left;border:1px solid #163E28;">${escapeHTML(h)}</th>`).join("");
  const bodyRows = rows.map((r, i) => {
    const bg = i % 2 === 0 ? "#ffffff" : "#E7F2E9";
    return "<tr>" + headers.map((h) => `<td style="background:${bg};padding:7px 12px;font-family:Arial,sans-serif;font-size:12px;color:#1B2420;border:1px solid #D8DED5;">${escapeHTML(String(r[h] ?? ""))}</td>`).join("") + "</tr>";
  }).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;margin:0;padding:16px;background:#ffffff;">
    <table style="border-collapse:collapse;margin-bottom:4px;"><tr>
      <td style="vertical-align:middle;padding:0 8px 0 0;">${SG_LOGO_SVG}</td>
      <td style="vertical-align:middle;font-size:20px;font-weight:bold;color:#1B2420;font-family:Arial,sans-serif;">Sub<span style="color:#1E5631;">Gestor</span></td>
    </tr></table>
    <div style="font-size:12.5px;color:#6B7568;margin:2px 0 14px;font-family:Arial,sans-serif;">${escapeHTML(title)} · Generado ${fmtDate(todayISO())} · ${rows.length} registros</div>
    <table style="border-collapse:collapse;">
      <thead><tr>${headCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </body></html>`;
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    throw new Error("clipboard API no disponible");
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e2) { return false; }
  }
}

async function copyHTMLToClipboard(html, plainText) {
  try {
    if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
      const item = new window.ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plainText], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return true;
    }
    throw new Error("Copiado con formato no disponible en este navegador");
  } catch (e) {
    return copyToClipboard(plainText);
  }
}

function downloadStyledExcel(filename, html) {
  const blob = new Blob([html], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* Barra de exportación reutilizable: Excel/PDF con diseño de marca (logo,
   colores, encabezados). La descarga directa y window.print() solo funcionan
   fuera de la vista previa del artefacto, así que "copiar con formato" (que sí
   conserva colores al pegar en Excel/Sheets) es la vía principal aquí. */
function ExportBar({ rows, label, small }) {
  const [copyModal, setCopyModal] = useState(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [pdfHelp, setPdfHelp] = useState(false);
  const safeLabel = (label || "datos").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "_");

  const styledHTML = rows && rows.length ? buildStyledReport(label || "Reporte", rows) : "";
  const plainCSV = rows && rows.length ? buildCSV(rows) : "";

  const handleDownload = () => downloadStyledExcel(`${safeLabel}.xls`, styledHTML);
  const openCopyModal = () => { setCopyStatus(""); setCopyModal(styledHTML); };
  const doCopyFormatted = async () => {
    const ok = await copyHTMLToClipboard(styledHTML, plainCSV);
    setCopyStatus(ok ? "¡Copiado con formato! Pégalo (Ctrl+V) en Excel o Google Sheets — mantiene los colores." : "No se pudo copiar con formato. Usa el texto plano de abajo (Ctrl+C).");
  };
  const doCopyPlain = async () => {
    const ok = await copyToClipboard(plainCSV);
    setCopyStatus(ok ? "¡Copiado como texto plano!" : "No se pudo copiar automáticamente. Selecciona el texto y usa Ctrl+C.");
  };

  return (
    <>
      <Btn small={small !== false} variant="secondary" icon={Download} onClick={handleDownload} disabled={!rows || !rows.length}>Descargar Excel</Btn>
      <Btn small={small !== false} variant="secondary" icon={Printer} onClick={() => setPdfHelp(true)}>Exportar a PDF</Btn>
      <button onClick={openCopyModal} disabled={!rows || !rows.length} style={{ background: "none", border: "none", color: T.gray500, fontSize: 11.5, textDecoration: "underline", cursor: rows && rows.length ? "pointer" : "not-allowed", padding: "0 4px" }}>
        o copiar con formato
      </button>
      {copyModal !== null && (
        <Modal title={`${label || "Datos"} — copiar con formato`} onClose={() => setCopyModal(null)} width={620}>
          <p style={{ fontSize: 12.5, color: T.gray500, marginTop: 0 }}>Vista previa del diseño. Cópialo con formato para pegarlo (Ctrl+V) directamente en Excel o Google Sheets conservando colores y encabezado.</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <Btn icon={CheckCircle2} onClick={doCopyFormatted}>Copiar con formato</Btn>
            <Btn variant="ghost" small onClick={doCopyPlain}>Copiar como texto plano</Btn>
          </div>
          {copyStatus && <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: copyStatus.startsWith("¡Copiado") ? T.green700 : T.red }}>{copyStatus}</div>}
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 10, maxHeight: 320, overflow: "auto", background: "#fafaf8" }}>
            <div dangerouslySetInnerHTML={{ __html: copyModal }} />
          </div>
        </Modal>
      )}
      {pdfHelp && (
        <Modal title="Exportar a PDF" onClose={() => setPdfHelp(false)} width={420}>
          <p style={{ fontSize: 13, color: T.gray500, marginTop: 0 }}>Para guardar esta información como PDF con el mismo diseño de la pantalla:</p>
          <ol style={{ fontSize: 13, color: T.ink, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Presiona <b>Ctrl+P</b> (Windows) o <b>Cmd+P</b> (Mac) en tu teclado.</li>
            <li>En "Destino" o "Impresora", elige <b>Guardar como PDF</b>.</li>
            <li>Confirma para descargar el archivo.</li>
          </ol>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={() => setPdfHelp(false)}>Entendido</Btn>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ============================== LOGIN ============================== */
function LoginScreen({ users, onLogin, onReset }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [showDiag, setShowDiag] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    const u = users.find((x) => x.username === username.trim());
    if (!u || u.status === "disabled") { setError("Usuario o contraseña incorrectos."); return; }
    if (u.lockedUntil && Date.now() < u.lockedUntil) {
      const mins = Math.ceil((u.lockedUntil - Date.now()) / 60000);
      setError(`Cuenta bloqueada por intentos fallidos. Vuelve a intentar en ${mins} minuto(s), o usa "Restablecer datos" abajo.`);
      return;
    }
    if (u.password !== password) { setError("attempt"); onLogin({ type: "failed_attempt", userId: u.id }); return; }
    setError(""); onLogin({ type: "success", userId: u.id });
  };

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(160deg, ${T.green900}, ${T.green700})`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter',sans-serif", padding: 16 }}>
      <div style={{ background: T.cream, borderRadius: 20, padding: 36, width: "100%", maxWidth: 400, boxShadow: "0 30px 80px rgba(0,0,0,0.35)" }}>
        <div style={{ marginBottom: 24 }}><Logo size={40} /></div>
        <p style={{ color: T.gray500, fontSize: 13, marginTop: -14, marginBottom: 22 }}>Control de inventario, pedidos y caducidad multi-sucursal</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Usuario">
            <TextInput inputMode="numeric" autoFocus value={username} onChange={(e) => setUsername(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && submit(e)} placeholder="Usuario numérico" />
          </Field>
          <Field label="Contraseña">
            <div style={{ position: "relative" }}>
              <TextInput inputMode="numeric" type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && submit(e)} placeholder="Contraseña numérica" style={{ width: "100%", paddingRight: 34 }} />
              <button type="button" onClick={() => setShowPw((s) => !s)} style={{ position: "absolute", right: 8, top: 7, background: "none", border: "none", cursor: "pointer", color: T.gray500 }}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>
          {error && <div style={{ color: T.red, fontSize: 12.5, fontWeight: 600 }}>{error === "attempt" ? "Usuario o contraseña incorrectos." : error}</div>}
          <Btn onClick={submit} icon={Lock}>Entrar</Btn>
        </div>
        <div style={{ marginTop: 18, fontSize: 11, color: T.gray500 }}>Los datos de esta prueba se comparten entre todas las personas que la abran.</div>
        <button onClick={() => setConfirmingReset(true)} style={{ marginTop: 14, background: "none", border: "none", color: T.gray500, fontSize: 11.5, textDecoration: "underline", cursor: "pointer", padding: 0 }}>
          ¿No puedes entrar? Restablecer datos de la aplicación
        </button>
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setShowDiag((s) => !s)} style={{ background: "none", border: "none", color: T.gray500, fontSize: 11, textDecoration: "underline", cursor: "pointer", padding: 0 }}>
            {showDiag ? "Ocultar estado de las cuentas" : "Ver estado actual de las cuentas"}
          </button>
          {showDiag && (
            <div style={{ marginTop: 8, background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8, padding: 10, fontSize: 11 }}>
              {users.map((u) => (
                <div key={u.id} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${T.border}` }}>
                  <span>#{u.username} · {u.name}</span>
                  <span style={{ color: u.status === "disabled" ? T.gray500 : (u.lockedUntil && Date.now() < u.lockedUntil) ? T.red : T.green700, fontWeight: 700 }}>
                    {u.status === "disabled" ? "Desactivado" : (u.lockedUntil && Date.now() < u.lockedUntil) ? `Bloqueado (${Math.ceil((u.lockedUntil - Date.now()) / 60000)} min)` : "Disponible"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {confirmingReset && (
        <Modal title="Restablecer datos de la aplicación" onClose={() => setConfirmingReset(false)} width={400}>
          <p style={{ fontSize: 13, color: T.gray500, marginTop: 0 }}>Esto borrará TODOS los datos compartidos (productos, facturas, inventarios, usuarios) y dejará solo la configuración inicial. Esta acción no se puede deshacer.</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn variant="ghost" onClick={() => setConfirmingReset(false)}>Cancelar</Btn>
            <Btn variant="danger" icon={RotateCcw} onClick={() => { setConfirmingReset(false); onReset(); }}>Restablecer datos</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============================== SIDEBAR / TOPBAR ============================== */
function NavItem({ icon: Icon, label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", borderRadius: 10,
      background: active ? "rgba(242,183,5,0.15)" : "transparent", border: "none", cursor: "pointer",
      color: active ? T.yellow500 : "#D9E4DC", fontWeight: active ? 700 : 500, fontSize: 13.5, textAlign: "left", fontFamily: "'Inter',sans-serif",
    }}>
      <Icon size={17} />{label}
    </button>
  );
}

function Sidebar({ view, setView, role, onLogout }) {
  const general = [
    ["dashboard", LayoutDashboard], ["productos", Package], ["proveedores", Truck],
    ["facturas", FileText], ["inventario", ClipboardList], ["alertas", AlertTriangle],
    ["mermas", Trash2], ["pedidos", ShoppingCart],
  ];
  const adminOnly = [["sucursales", Building2], ["usuarios", UsersIcon], ["bitacora", ScrollText], ["config", SettingsIcon]];
  const items = role === "general_admin" ? [...general.slice(0, 3), ...adminOnly.slice(0, 2), ...general.slice(3), ...adminOnly.slice(2)] : general;
  return (
    <div style={{ width: 232, background: T.green900, minHeight: "100vh", padding: "22px 14px", display: "flex", flexDirection: "column", flexShrink: 0 }} className="no-print">
      <div style={{ padding: "0 8px 20px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <svg width={30} height={30} viewBox="0 0 48 48"><rect x="1" y="1" width="46" height="46" rx="14" fill={T.yellow500} /><path d="M32 16c-2-1.6-5-2.4-8-2.4-5 0-8 2-8 5.4 0 3.2 3 4.4 7 5.2 4.6 1 5.6 1.8 5.6 3.2 0 1.6-1.8 2.6-4.4 2.6-3 0-5.6-1-7.8-2.8l-2.6 3.6c2.6 2.2 6.2 3.4 10.2 3.4 5.6 0 9-2.6 9-6.4 0-3.6-2.6-4.8-7.2-5.8-4.4-1-5.4-1.6-5.4-3 0-1.4 1.6-2.2 3.8-2.2 2.4 0 4.6.8 6.6 2.2l2.2-3z" fill={T.green900} /></svg>
          <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 18, color: "#fff" }}>SubGestor</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
        {items.map(([key, Icon]) => <NavItem key={key} icon={Icon} label={MODULES[key]} active={view === key} onClick={() => setView(key)} />)}
      </div>
      <NavItem icon={LogOut} label="Cerrar sesión" onClick={onLogout} />
    </div>
  );
}

function TopBar({ user, branches, activeBranchId, setActiveBranchId, onRefresh, syncing }) {
  const branch = branches.find((b) => b.id === activeBranchId);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 26px", borderBottom: `1px solid ${T.border}`, background: "#fff" }} className="no-print">
      <div>
        {user.role === "general_admin" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Store size={16} color={T.gray500} />
            <Select value={activeBranchId || "all"} onChange={(e) => setActiveBranchId(e.target.value === "all" ? null : e.target.value)} style={{ fontWeight: 700 }}>
              <option value="all">Todas las sucursales (consolidado)</option>
              {branches.map((b) => <option key={b.id} value={b.id}>#{b.number} · {b.name}</option>)}
            </Select>
          </div>
        ) : (
          <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8, color: T.green700 }}><Store size={16} />{branch ? `#${branch.number} · ${branch.name}` : "Sin sucursal"}</div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 13 }}>
        <button onClick={onRefresh} title="Actualizar con los datos más recientes" style={{ display: "flex", alignItems: "center", gap: 5, background: T.cream, border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 12, color: T.gray500, fontWeight: 600 }}>
          <RefreshCw size={13} style={syncing ? { animation: "sg-spin 0.8s linear infinite" } : undefined} /> {syncing ? "Actualizando…" : "Actualizar"}
        </button>
        <div style={{ width: 30, height: 30, borderRadius: 999, background: T.green100, color: T.green700, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{user.name.charAt(0)}</div>
        <div>
          <div style={{ fontWeight: 700 }}>{user.name}</div>
          <div style={{ color: T.gray500, fontSize: 11.5 }}>{user.role === "general_admin" ? "Administrador General" : "Administrador de Sucursal"}</div>
        </div>
      </div>
    </div>
  );
}

/* ============================== DASHBOARD ============================== */
function KpiCard({ label, value, sub, accent }) {
  return (
    <Card style={{ borderTop: `3px solid ${accent || T.green700}` }}>
      <div style={{ fontSize: 11.5, color: T.gray500, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 28, fontWeight: 700, color: T.ink, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: T.gray500, marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}
const PIE_COLORS = [T.ok, T.amber, T.orange, T.red, T.expired];

function AlertsCentralTab({ state, targetBranches }) {
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const alerts = computeCentralAlerts(state, targetBranches.map((b) => b.id));
  const modules = Array.from(new Set(alerts.map((a) => a.module)));
  const filtered = alerts
    .filter((a) => priorityFilter === "all" || a.priority === priorityFilter)
    .filter((a) => moduleFilter === "all" || a.module === moduleFilter);
  const counts = { alta: alerts.filter((a) => a.priority === "alta").length, media: alerts.filter((a) => a.priority === "media").length, baja: alerts.filter((a) => a.priority === "baja").length };
  const exportRows = filtered.map((a) => ({ Prioridad: ALERT_PRIORITY_META[a.priority].label, Módulo: a.module, Alerta: a.title, Detalle: a.detail }));

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 14, marginBottom: 14 }}>
        <KpiCard label="Prioridad alta" value={counts.alta} accent={T.red} />
        <KpiCard label="Prioridad media" value={counts.media} accent={T.orange} />
        <KpiCard label="Prioridad baja" value={counts.baja} accent={T.yellow600} />
      </div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="all">Todas las prioridades</option>
              <option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option>
            </Select>
            <Select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
              <option value="all">Todos los módulos</option>
              {modules.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </div>
          <ExportBar rows={exportRows} label="alertas" />
        </div>
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((a, i) => (
          <Card key={i} style={{ borderLeft: `4px solid ${ALERT_PRIORITY_META[a.priority].fg}`, padding: "12px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
                  <Pill bg={ALERT_PRIORITY_META[a.priority].bg} fg={ALERT_PRIORITY_META[a.priority].fg}>{ALERT_PRIORITY_META[a.priority].label}</Pill>
                  <span style={{ fontSize: 11, color: T.gray500, fontWeight: 700, textTransform: "uppercase" }}>{a.module}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{a.title}</div>
                <div style={{ fontSize: 12.5, color: T.gray500, marginTop: 2 }}>{a.detail}</div>
              </div>
            </div>
          </Card>
        ))}
        {!filtered.length && <EmptyState text="No hay alertas para este filtro — todo en orden." />}
      </div>
    </div>
  );
}

function DashboardView({ state, activeBranchId, role, currentUser, branches }) {
  const [tab, setTab] = useState("general");
  const isGeneral = role === "general_admin";
  const branchId = isGeneral ? activeBranchId : currentUser.branchId;
  const targetBranches = branchId ? state.branches.filter((b) => b.id === branchId) : state.branches;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }} className="no-print">
        {[["general", "General"], ["mermas", "Mermas"], ["inventario", "Inventario Inteligente"], ["alertas", "Alertas"], ["reportes", "Reportes"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{ border: `1.5px solid ${tab === k ? T.green700 : T.border}`, background: tab === k ? T.green100 : "#fff", color: tab === k ? T.green700 : T.ink, borderRadius: 999, padding: "7px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{label}</button>
        ))}
      </div>
      {tab === "general" && <DashboardGeneralTab state={state} activeBranchId={activeBranchId} role={role} onGoToMermas={() => setTab("mermas")} />}
      {tab === "inventario" && <InventorySmartAnalysisTab state={state} isGeneral={isGeneral} branchId={branchId} />}
      {tab === "alertas" && <AlertsCentralTab state={state} targetBranches={targetBranches} />}
      {tab === "mermas" && (
        <div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 14 }}>
            {targetBranches.map((b) => <MermaStandardCard key={b.id} status={computeMermaStandardStatus(state, b.id, state.config.mermaPeriod || "mensual")} />)}
          </div>
          <MermasAnalyticsPanel state={state} isGeneral={isGeneral} branchId={branchId} />
          <div style={{ height: 14 }} />
          <MermasCrossAnalysisPanel state={state} branchId={branchId} />
        </div>
      )}
      {tab === "reportes" && <ReportsView state={state} branches={branches} />}
    </div>
  );
}

function InventoryProductHistoryModal({ state, productId, branchId, branchInvs, onClose }) {
  const productName = state.products.find((p) => p.id === productId)?.name || "—";
  const invRows = branchInvs.filter((pi) => (pi.counts || []).some((c) => c.productId === productId && c.difference))
    .map((pi) => ({ pi, c: pi.counts.find((c) => c.productId === productId) }));
  const mermaRows = state.mermas.filter((m) => m.productId === productId && m.branchId === branchId && m.status !== "cancelled").sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Modal title={`Historial — ${productName}`} onClose={onClose} width={620}>
      <h4 style={{ fontFamily: "'Space Grotesk',sans-serif", margin: "0 0 8px" }}>Diferencias en inventarios anteriores</h4>
      {invRows.length ? (
        <table style={{ width: "100%", fontSize: 12.5, marginBottom: 16 }}>
          <thead><tr><Th>Folio</Th><Th>Fecha</Th><Th>Diferencia</Th><Th>Estado</Th></tr></thead>
          <tbody>{invRows.map(({ pi, c }) => <tr key={pi.id}><Td mono>{pi.folio}</Td><Td>{fmtDate(pi.date)}</Td><Td>{c.difference > 0 ? "+" : ""}{c.difference}</Td><Td><DiffPill level={c.diffLevel} /></Td></tr>)}</tbody>
        </table>
      ) : <EmptyState text="Sin diferencias registradas en inventarios anteriores." />}
      <h4 style={{ fontFamily: "'Space Grotesk',sans-serif", margin: "0 0 8px" }}>Mermas registradas</h4>
      {mermaRows.length ? (
        <table style={{ width: "100%", fontSize: 12.5 }}>
          <thead><tr><Th>Fecha</Th><Th>Cantidad</Th><Th>Clasificación</Th><Th>Motivo</Th></tr></thead>
          <tbody>{mermaRows.map((m) => <tr key={m.id}><Td>{fmtDate(m.date)}</Td><Td>{m.quantity} {m.unit}</Td><Td>{MERMA_CLASS[m.classification]}</Td><Td>{m.reason}</Td></tr>)}</tbody>
        </table>
      ) : <EmptyState text="Sin mermas registradas para este producto." />}
    </Modal>
  );
}

function InventorySmartAnalysisTab({ state, isGeneral, branchId }) {
  const [selBranch, setSelBranch] = useState(branchId || state.branches[0]?.id || "");
  const targetBranchId = isGeneral ? selBranch : branchId;
  const [historyProduct, setHistoryProduct] = useState(null);

  const branchInvs = state.physicalInventories.filter((pi) => pi.branchId === targetBranchId && isInventoryFinal(pi))
    .sort((a, b) => (a.createdAt?.date || a.date).localeCompare(b.createdAt?.date || b.date) || (a.createdAt?.time || "").localeCompare(b.createdAt?.time || ""));
  const [selInvId, setSelInvId] = useState(null);
  const inv = branchInvs.find((pi) => pi.id === selInvId) || branchInvs[branchInvs.length - 1] || null;

  if (!targetBranchId || !branchInvs.length) {
    return (
      <div>
        {isGeneral && (
          <Card style={{ marginBottom: 14 }}>
            <Field label="Sucursal">
              <Select value={selBranch} onChange={(e) => setSelBranch(e.target.value)}>
                {state.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          </Card>
        )}
        <EmptyState text="Aún no hay inventarios físicos finalizados en esta sucursal para analizar." />
      </div>
    );
  }

  const counts = inv.counts || [];
  const totalRevisados = counts.length;
  const sinDif = counts.filter((c) => c.difference === 0).length;
  const conMenor = counts.filter((c) => c.diffLevel === "diferencia_menor").length;
  const conSignif = counts.filter((c) => c.diffLevel === "diferencia_significativa").length;
  const totalFaltantes = counts.filter((c) => c.difference < 0).reduce((s, c) => s + Math.abs(c.difference), 0);
  const totalSobrantes = counts.filter((c) => c.difference > 0).reduce((s, c) => s + c.difference, 0);
  const impactoEconomico = counts.reduce((s, c) => s + (c.diffCost || 0), 0);
  const coincidencia = totalRevisados > 0 ? (sinDif / totalRevisados) * 100 : 100;

  const invIndex = branchInvs.findIndex((pi) => pi.id === inv.id);
  const prevInv = invIndex > 0 ? branchInvs[invIndex - 1] : null;

  const topIncidence = [...counts].filter((c) => c.difference !== 0).sort((a, b) => Math.abs(b.diffCost || 0) - Math.abs(a.diffCost || 0)).slice(0, 10);

  const alerts = [];
  counts.forEach((c) => {
    if (!c.difference) return;
    const pname = state.products.find((p) => p.id === c.productId)?.name || "—";
    if (c.diffLevel === "diferencia_significativa") alerts.push(`🔴 ${pname}: diferencia significativa de ${c.difference > 0 ? "+" : ""}${c.difference} pz (${c.diffPercent.toFixed(1)}%).`);
    const dir = c.difference < 0 ? "falt" : "sobr";
    const occurrences = countRecurrence(branchInvs, c.productId, dir);
    if (occurrences >= 2) alerts.push(`🔁 ${pname}: ${dir === "falt" ? "faltante" : "sobrante"} recurrente — ya son ${occurrences} inventarios con este patrón.`);
    if (c.difference < 0 && !hasNearbyMerma(state, c.productId, targetBranchId, inv.date)) alerts.push(`⚠ ${pname}: hay un faltante sin ninguna merma registrada cerca de esta fecha — posible merma no registrada.`);
    if (prevInv) {
      const prevC = (prevInv.counts || []).find((pc) => pc.productId === c.productId);
      if (prevC && Math.abs(c.diffPercent) > Math.abs(prevC.diffPercent) * 2 && Math.abs(c.diffPercent) > (state.config.inventoryToleranceLimit ?? 5)) {
        alerts.push(`📈 ${pname}: la diferencia creció mucho respecto al inventario anterior (antes ${prevC.diffPercent.toFixed(1)}%, ahora ${c.diffPercent.toFixed(1)}%).`);
      }
    }
  });
  topIncidence.slice(0, 3).forEach((c) => {
    const pname = state.products.find((p) => p.id === c.productId)?.name || "—";
    if (Math.abs(c.diffCost || 0) > 0) alerts.push(`💰 ${pname}: es de los productos con mayor impacto económico en este conteo (${fmtMoney(c.diffCost)}).`);
  });

  let trend = null;
  if (prevInv) {
    const prevImpact = Math.abs(prevInv.impactoNeto ?? 0);
    const currImpact = Math.abs(inv.impactoNeto ?? impactoEconomico);
    trend = Math.abs(currImpact - prevImpact) < 1 ? "constante" : currImpact > prevImpact ? "aumentando" : "disminuyendo";
  }

  const branchDiffRanking = isGeneral ? state.branches.map((b) => {
    const lastInv = state.physicalInventories.filter((pi) => pi.branchId === b.id && isInventoryFinal(pi))
      .sort((a, c) => (c.createdAt?.date || c.date).localeCompare(a.createdAt?.date || a.date))[0];
    return { branchName: b.name, diffs: lastInv ? (lastInv.counts || []).filter((c) => c.difference).length : 0, folio: lastInv?.folio || "—" };
  }).sort((a, b) => b.diffs - a.diffs) : [];

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          {isGeneral && (
            <Field label="Sucursal">
              <Select value={selBranch} onChange={(e) => { setSelBranch(e.target.value); setSelInvId(null); }}>
                {state.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Inventario a analizar">
            <Select value={inv.id} onChange={(e) => setSelInvId(e.target.value)}>
              {branchInvs.map((pi) => <option key={pi.id} value={pi.id}>{pi.folio} — {fmtDate(pi.date)}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      <div style={{ fontSize: 13, fontWeight: 700, color: T.gray500, marginBottom: 8 }}>Inventario Físico — {state.branches.find((b) => b.id === targetBranchId)?.name}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 14 }}>
        <KpiCard label="Productos revisados" value={totalRevisados} accent={T.gray500} />
        <KpiCard label="Sin diferencias" value={sinDif} accent={T.green700} />
        <KpiCard label="Diferencias menores" value={conMenor} accent={T.yellow600} />
        <KpiCard label="Diferencias significativas" value={conSignif} accent={T.red} />
        <KpiCard label="Faltantes (pz)" value={totalFaltantes} accent={T.red} />
        <KpiCard label="Sobrantes (pz)" value={totalSobrantes} accent={T.orange} />
        <KpiCard label="Impacto económico" value={fmtMoney(impactoEconomico)} accent={impactoEconomico < 0 ? T.red : T.green700} />
        <KpiCard label="% de coincidencia" value={`${coincidencia.toFixed(1)}%`} accent={T.green700} />
      </div>

      {trend && (
        <Card style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13 }}>
            Comparado con el inventario anterior ({prevInv.folio}), el impacto económico de las diferencias está{" "}
            <b style={{ color: trend === "aumentando" ? T.red : trend === "disminuyendo" ? T.green700 : T.gray500 }}>
              {trend === "aumentando" ? "aumentando 📈" : trend === "disminuyendo" ? "disminuyendo 📉" : "constante ➡"}
            </b>.
          </div>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: "auto", marginBottom: 14 }}>
        <div style={{ padding: "14px 16px 0" }}>
          <h4 style={{ margin: 0, fontFamily: "'Space Grotesk',sans-serif" }}>Productos con mayor incidencia</h4>
          <div style={{ fontSize: 11.5, color: T.gray500 }}>Ordenados por impacto económico. Haz clic en un producto para ver su historial.</div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
          <thead><tr><Th>Producto</Th><Th>Diferencia</Th><Th>Impacto económico</Th><Th>Estado</Th></tr></thead>
          <tbody>
            {topIncidence.map((c) => (
              <tr key={c.productId} style={{ cursor: "pointer" }} onClick={() => setHistoryProduct(c.productId)}>
                <Td><b>{state.products.find((p) => p.id === c.productId)?.name || "—"}</b></Td>
                <Td>{c.difference > 0 ? "+" : ""}{c.difference}</Td>
                <Td>{fmtMoney(c.diffCost || 0)}</Td>
                <Td><DiffPill level={c.diffLevel} /></Td>
              </tr>
            ))}
          </tbody>
        </table>
        {!topIncidence.length && <EmptyState text="Este inventario no tuvo diferencias." />}
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <h4 style={{ margin: "0 0 10px", fontFamily: "'Space Grotesk',sans-serif" }}>Alertas inteligentes</h4>
        {alerts.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.map((a, i) => <div key={i} style={{ fontSize: 12.5, color: T.ink, background: T.cream, borderRadius: 8, padding: "8px 10px" }}>{a}</div>)}
          </div>
        ) : <EmptyState text="No se detectaron situaciones que requieran atención." />}
      </Card>

      {isGeneral && branchDiffRanking.length > 0 && (
        <Card style={{ padding: 0, overflow: "auto" }}>
          <div style={{ padding: "14px 16px 0" }}>
            <h4 style={{ margin: 0, fontFamily: "'Space Grotesk',sans-serif" }}>Sucursales con más diferencias (último inventario de cada una)</h4>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
            <thead><tr><Th>Sucursal</Th><Th>Último inventario</Th><Th>Productos con diferencia</Th></tr></thead>
            <tbody>{branchDiffRanking.map((r, i) => <tr key={i}><Td><b>{r.branchName}</b></Td><Td mono>{r.folio}</Td><Td>{r.diffs}</Td></tr>)}</tbody>
          </table>
        </Card>
      )}

      {historyProduct && <InventoryProductHistoryModal state={state} productId={historyProduct} branchId={targetBranchId} branchInvs={branchInvs} onClose={() => setHistoryProduct(null)} />}
    </div>
  );
}

function DashboardGeneralTab({ state, activeBranchId, role, onGoToMermas }) {
  const branches = activeBranchId ? state.branches.filter((b) => b.id === activeBranchId) : state.branches;
  const branchIds = branches.map((b) => b.id);

  const activeProducts = state.products.filter((p) => p.status === "active").length;
  const pendingInvoices = state.invoices.filter((i) => i.status === "pending" && branchIds.includes(i.branchId)).length;
  const inventoryValue = state.lots.filter((l) => l.status === "active" && branchIds.includes(l.branchId)).reduce((s, l) => s + l.remainingPieces * (l.costPerUnit || 0), 0);
  const soon = state.lots.filter((l) => l.status === "active" && branchIds.includes(l.branchId) && ["yellow", "orange", "red"].includes(semaphoreLevel(l.expirationDate, state.config))).length;
  const mermasMonth = state.mermas.filter((m) => branchIds.includes(m.branchId) && m.status !== "cancelled" && m.date.slice(0, 7) === todayISO().slice(0, 7)).reduce((s, m) => s + m.quantity, 0);
  const mermaAlerts = role === "general_admin"
    ? state.branches.map((b) => computeMermaStandardStatus(state, b.id, state.config.mermaPeriod || "mensual")).filter((st) => st.estado === "anomala" || st.estado === "advertencia")
    : [];

  const consumptionByBranch = state.branches.map((b) => {
    const total = state.physicalInventories.filter((pi) => pi.branchId === b.id && isInventoryFinal(pi))
      .flatMap((pi) => pi.consumption).reduce((s, c) => s + c.consumedPieces, 0);
    return { sucursal: b.name, consumo: total };
  });

  const semCounts = { ok: 0, yellow: 0, orange: 0, red: 0, expired: 0 };
  state.lots.filter((l) => l.status === "active" && branchIds.includes(l.branchId) && l.expirationDate).forEach((l) => {
    semCounts[semaphoreLevel(l.expirationDate, state.config)]++;
  });
  const pieData = [
    { name: "Vigente", value: semCounts.ok }, { name: "30 días", value: semCounts.yellow },
    { name: "15 días", value: semCounts.orange }, { name: "5 días", value: semCounts.red }, { name: "Caducado", value: semCounts.expired },
  ].filter((d) => d.value > 0);

  const purchasesBySupplier = state.suppliers.map((s) => ({
    proveedor: s.name,
    compras: state.invoices.filter((i) => i.supplierId === s.id && i.status !== "cancelled" && branchIds.includes(i.branchId)).reduce((sum, i) => sum + i.total, 0),
  }));

  const trend = [...state.physicalInventories].filter((pi) => isInventoryFinal(pi) && branchIds.includes(pi.branchId))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((pi) => ({ fecha: fmtDate(pi.date), consumo: pi.consumption.reduce((s, c) => s + c.consumedPieces, 0) }));

  const exportRows = [
    { Indicador: "Productos activos", Valor: activeProducts },
    { Indicador: "Facturas pendientes", Valor: pendingInvoices },
    { Indicador: "Valor de inventario", Valor: fmtMoney(inventoryValue) },
    { Indicador: "Productos por caducar (≤30d)", Valor: soon },
    { Indicador: "Mermas del mes (pz)", Valor: mermasMonth },
    ...consumptionByBranch.map((d) => ({ Indicador: `Consumo — ${d.sucursal}`, Valor: d.consumo })),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "flex-end" }}>
        <ExportBar rows={exportRows} label="dashboard" />
      </div>
      {mermaAlerts.length > 0 && (
        <Card style={{ borderTop: `3px solid ${T.red}`, cursor: onGoToMermas ? "pointer" : "default" }} onClick={() => onGoToMermas && onGoToMermas()}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: T.red }}>
            <AlertTriangle size={16} /> {mermaAlerts.length} sucursal(es) cerca o por encima de su estándar de merma
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {mermaAlerts.map((st) => (
              <Pill key={st.branchId} bg={MERMA_ESTADO_META[st.estado].bg} fg={MERMA_ESTADO_META[st.estado].fg}>
                {st.branchName}: {st.realPercent.toFixed(1)}% (máx. {st.standard}%)
              </Pill>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: T.gray500, marginTop: 8 }}>Clic para ver el detalle en la pestaña de Mermas.</div>
        </Card>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14 }}>
        <KpiCard label="Productos activos" value={activeProducts} accent={T.green700} />
        <KpiCard label="Facturas pendientes" value={pendingInvoices} accent={T.yellow500} />
        <KpiCard label="Valor inventario" value={fmtMoney(inventoryValue)} accent={T.green600} />
        <KpiCard label="Por caducar (≤30d)" value={soon} accent={T.orange} />
        <KpiCard label="Mermas del mes (pz)" value={mermasMonth} accent={T.red} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14 }}>
        <Card>
          <h4 style={{ margin: "0 0 10px", fontFamily: "'Space Grotesk',sans-serif" }}>Consumo por sucursal</h4>
          {consumptionByBranch.some((d) => d.consumo > 0) ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={consumptionByBranch}><CartesianGrid strokeDasharray="3 3" stroke={T.border} /><XAxis dataKey="sucursal" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="consumo" fill={T.green700} radius={[6, 6, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          ) : <EmptyState text="Aún no hay inventarios físicos con consumo calculado." />}
        </Card>
        <Card>
          <h4 style={{ margin: "0 0 10px", fontFamily: "'Space Grotesk',sans-serif" }}>Estado de caducidad (lotes)</h4>
          {pieData.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart><Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80}>{pieData.map((d, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}</Pie><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart>
            </ResponsiveContainer>
          ) : <EmptyState text="No hay lotes con fecha de caducidad registrada." />}
        </Card>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <h4 style={{ margin: "0 0 10px", fontFamily: "'Space Grotesk',sans-serif" }}>Compras por proveedor</h4>
          {purchasesBySupplier.some((d) => d.compras > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={purchasesBySupplier} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke={T.border} /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="proveedor" width={90} tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => fmtMoney(v)} /><Bar dataKey="compras" fill={T.yellow500} radius={[0, 6, 6, 0]} /></BarChart>
            </ResponsiveContainer>
          ) : <EmptyState text="Aún no hay compras registradas." />}
        </Card>
        <Card>
          <h4 style={{ margin: "0 0 10px", fontFamily: "'Space Grotesk',sans-serif" }}>Tendencia de consumo</h4>
          {trend.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trend}><CartesianGrid strokeDasharray="3 3" stroke={T.border} /><XAxis dataKey="fecha" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Line type="monotone" dataKey="consumo" stroke={T.green700} strokeWidth={2.5} dot={{ r: 3 }} /></LineChart>
            </ResponsiveContainer>
          ) : <EmptyState text="Realiza un inventario físico para ver la tendencia." />}
        </Card>
      </div>
    </div>
  );
}

/* ============================== PRODUCTOS ============================== */
/* Compara, para un producto, el costo más reciente registrado con cada uno
   de sus proveedores asociados — para facilitar decidir a quién comprarle.
   Ordenado del más barato al más caro (los que no tienen historial van al
   final). */
function computeSupplierComparison(product, state) {
  const supplierIds = product.supplierIds && product.supplierIds.length ? product.supplierIds : [product.supplierId];
  const rows = supplierIds.filter(Boolean).map((sid) => {
    const supplier = state.suppliers.find((s) => s.id === sid);
    const history = (product.costHistory || []).filter((h) => h.supplierId === sid).sort((a, b) => a.date.localeCompare(b.date));
    const last = history[history.length - 1];
    return {
      supplierId: sid, supplierName: supplier?.name || "—", isPrimary: sid === product.supplierId,
      lastCost: last ? last.costPerPackage : null, lastDate: last ? last.date : null, historyCount: history.length,
    };
  });
  return rows.sort((a, b) => (a.lastCost ?? Infinity) - (b.lastCost ?? Infinity));
}

const KARDEX_TYPE_META = {
  entrada: { fg: T.green700, bg: T.green100 },
  merma: { fg: T.red, bg: "#FBDCDA" },
  salida: { fg: T.orange, bg: "#FDE6D2" },
  ajuste: { fg: T.green700, bg: T.green100 },
};

function SupplierComparisonModal({ product, state, onClose }) {
  const rows = computeSupplierComparison(product, state);
  const cheapest = rows.find((r) => r.lastCost != null);
  return (
    <Modal title={`Comparar proveedores — ${product.name}`} onClose={onClose} width={560}>
      {rows.length <= 1 && <p style={{ fontSize: 12.5, color: T.gray500, marginTop: 0 }}>Este producto todavía solo está asociado a un proveedor. Puedes agregar más desde "Editar producto".</p>}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><Th>Proveedor</Th><Th>Último costo</Th><Th>Fecha</Th><Th>Compras registradas</Th><Th></Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.supplierId}>
              <Td><b>{r.supplierName}</b>{r.isPrimary && <span style={{ fontSize: 10.5, color: T.gray500 }}> (principal)</span>}</Td>
              <Td>{r.lastCost != null ? fmtMoney(r.lastCost) : "Sin compras aún"}</Td>
              <Td>{r.lastDate ? fmtDate(r.lastDate) : "—"}</Td>
              <Td>{r.historyCount}</Td>
              <Td>{cheapest && r.supplierId === cheapest.supplierId && <Pill bg={T.green100} fg={T.green700}>Más barato</Pill>}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function KardexModal({ state, productId, branches, activeBranchId, onClose }) {
  const [branchId, setBranchId] = useState(activeBranchId || branches[0]?.id || "");
  const product = state.products.find((p) => p.id === productId);
  const rows = branchId ? computeKardex(state, productId, branchId) : [];
  const exportRows = rows.map((r) => ({
    Fecha: fmtDate(r.date), Movimiento: r.label, Detalle: r.detail || "—",
    Entrada: r.signedQty > 0 ? r.signedQty : "", Salida: r.signedQty < 0 ? Math.abs(r.signedQty) : "",
    "Existencia resultante": r.balanceAfter, Usuario: r.user || "—",
  }));

  return (
    <Modal title={`Kardex — ${product?.name || "—"}`} onClose={onClose} width={760}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        {branches.length > 1 ? (
          <Field label="Sucursal">
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        ) : <div />}
        <ExportBar rows={exportRows} label={`kardex-${product?.name || "producto"}`} />
      </div>
      <div style={{ maxHeight: 420, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Fecha</Th><Th>Movimiento</Th><Th>Detalle</Th><Th>Entrada</Th><Th>Salida</Th><Th>Existencia</Th><Th>Usuario</Th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <Td>{fmtDate(r.date)}</Td>
                <Td><Pill bg={KARDEX_TYPE_META[r.type].bg} fg={KARDEX_TYPE_META[r.type].fg}>{r.label}</Pill></Td>
                <Td>{r.detail || "—"}</Td>
                <Td>{r.signedQty > 0 ? `+${r.signedQty}` : ""}</Td>
                <Td>{r.signedQty < 0 ? Math.abs(r.signedQty) : ""}</Td>
                <Td><b>{r.balanceAfter}</b></Td>
                <Td>{r.user || "—"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <EmptyState text="Este producto no tiene movimientos registrados en esta sucursal." />}
      </div>
    </Modal>
  );
}

function ProductForm({ initial, suppliers, branches, onSave, onClose }) {
  const [f, setF] = useState(() => initial
    ? { ...initial, supplierIds: initial.supplierIds && initial.supplierIds.length ? initial.supplierIds : [initial.supplierId] }
    : { name: "", piecesPerPackage: 1, supplierId: suppliers[0]?.id || "", supplierIds: suppliers[0] ? [suppliers[0].id] : [], code: "", category: "", notes: "", image: null, idealStock: {} });
  const [formError, setFormError] = useState("");
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const onImg = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = () => set("image", reader.result); reader.readAsDataURL(file);
  };
  const handleSave = () => {
    if (!f.name.trim() || !f.code.trim() || !(f.piecesPerPackage > 0)) { setFormError("Completa nombre, código y piezas por paquete (mayor que cero)."); return; }
    const supplierIds = Array.from(new Set([f.supplierId, ...(f.supplierIds || [])]));
    const err = onSave({ ...f, supplierIds });
    if (err) setFormError(err);
  };
  return (
    <Modal title={initial ? "Editar producto" : "Alta de producto"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Nombre del producto"><TextInput value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Piezas por paquete"><TextInput type="number" min="1" value={f.piecesPerPackage} onChange={(e) => set("piecesPerPackage", clampNum(e.target.value) || 1)} /></Field>
          <Field label="Código de producto"><TextInput value={f.code} onChange={(e) => set("code", e.target.value)} /></Field>
        </div>
        <Field label="Categoría (opcional)"><TextInput value={f.category || ""} onChange={(e) => set("category", e.target.value)} placeholder="Ej. Bebidas, Lácteos, Abarrotes…" /></Field>
        <Field label="Proveedor principal" hint="El que se usa como referencia para el costo sugerido cuando no hay historial con otro proveedor.">
          <Select value={f.supplierId} onChange={(e) => set("supplierId", e.target.value)}>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Proveedores adicionales (opcional)" hint="Marca otros proveedores a los que también le puedes comprar este producto, para comparar precios.">
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 8, maxHeight: 140, overflow: "auto" }}>
            {suppliers.filter((s) => s.id !== f.supplierId).map((s) => (
              <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "3px 0", cursor: "pointer" }}>
                <input type="checkbox" checked={(f.supplierIds || []).includes(s.id)}
                  onChange={(e) => set("supplierIds", e.target.checked ? [...(f.supplierIds || []), s.id] : (f.supplierIds || []).filter((id) => id !== s.id))} />
                {s.name}
              </label>
            ))}
            {suppliers.length <= 1 && <div style={{ fontSize: 12, color: T.gray500 }}>Da de alta otro proveedor para poder agregarlo aquí.</div>}
          </div>
        </Field>
        <Field label="Stock ideal por sucursal (piezas)">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {branches.map((b) => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12.5, width: 140, color: T.ink }}>{b.name}</span>
                <TextInput type="number" min="0" value={(f.idealStock && f.idealStock[b.id]) || 0}
                  onChange={(e) => set("idealStock", { ...f.idealStock, [b.id]: clampNum(e.target.value) })} style={{ width: 100 }} />
              </div>
            ))}
          </div>
        </Field>
        <Field label="Comentarios o notas"><TextArea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <Field label="Imagen del producto">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {f.image ? <img src={f.image} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} /> : <div style={{ width: 44, height: 44, borderRadius: 8, background: T.green100, display: "flex", alignItems: "center", justifyContent: "center" }}><ImageIcon size={18} color={T.green700} /></div>}
            <input type="file" accept="image/*" onChange={onImg} style={{ fontSize: 12 }} />
          </div>
        </Field>
        {formError && <div style={{ color: T.red, fontSize: 12.5, fontWeight: 600 }}>{formError}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn icon={CheckCircle2} onClick={handleSave}>Guardar</Btn>
        </div>
      </div>
    </Modal>
  );
}

function ProductsView({ state, mutate, branches, activeBranchId, currentUser, audit }) {
  const [q, setQ] = useState(""); const [supplierFilter, setSupplierFilter] = useState("all");
  const [editing, setEditing] = useState(null); const [showForm, setShowForm] = useState(false);
  const [unit, setUnit] = useState("piezas");
  const [kardexProductId, setKardexProductId] = useState(null);
  const [compareProduct, setCompareProduct] = useState(null);

  const list = state.products.filter((p) =>
    (supplierFilter === "all" || p.supplierId === supplierFilter) &&
    p.name.toLowerCase().includes(q.toLowerCase())
  );
  const dupCode = (code, exceptId) => state.products.some((p) => p.code.toLowerCase() === code.toLowerCase() && p.id !== exceptId);

  const save = (f) => {
    if (dupCode(f.code, f.id)) return "Ya existe un producto con ese código.";
    if (f.id) {
      mutate((s) => ({ ...s, products: s.products.map((p) => (p.id === f.id ? f : p)) }));
      audit("Productos", `Editó producto ${f.name}`);
    } else {
      const np = { ...f, id: uid("prod"), status: "active" };
      mutate((s) => ({ ...s, products: [...s.products, np] }));
      audit("Productos", `Dio de alta el producto ${f.name}`);
    }
    setShowForm(false); setEditing(null);
    return null;
  };
  const toggleStatus = (p) => {
    mutate((s) => ({ ...s, products: s.products.map((x) => (x.id === p.id ? { ...x, status: x.status === "active" ? "disabled" : "active" } : x)) }));
    audit("Productos", `${p.status === "active" ? "Desactivó" : "Reactivó"} ${p.name}`);
  };
  const branchForStock = activeBranchId || (branches[0] && branches[0].id);
  const exportRows = list.map((p) => {
    const supplier = state.suppliers.find((s) => s.id === p.supplierId);
    const stock = theoreticalStock(state.lots, p.id, branchForStock);
    return { Producto: p.name, Código: p.code, Proveedor: supplier?.name || "—", "Piezas/paquete": p.piecesPerPackage, "Existencia (pz)": stock, Estado: p.status === "active" ? "Activo" : "Desactivado" };
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 9, top: 10, color: T.gray500 }} />
            <TextInput placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 28, width: 200 }} />
          </div>
          <Select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
            <option value="all">Todos los proveedores</option>
            {state.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="piezas">Ver en piezas</option><option value="paquetes">Ver en paquetes</option>
          </Select>
          <ExportBar rows={exportRows} label="productos" />
        </div>
        <Btn icon={Plus} onClick={() => setShowForm(true)}>Alta de producto</Btn>
      </div>
      <Card style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Producto</Th><Th>Código</Th><Th>Proveedor</Th><Th>Presentación</Th><Th>Existencia</Th><Th>Estado</Th><Th></Th></tr></thead>
          <tbody>
            {list.map((p) => {
              const supplier = state.suppliers.find((s) => s.id === p.supplierId);
              const stock = theoreticalStock(state.lots, p.id, branchForStock);
              return (
                <tr key={p.id}>
                  <Td><div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {p.image ? <img src={p.image} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover" }} /> : <div style={{ width: 28, height: 28, borderRadius: 6, background: T.green100 }} />}
                    <b>{p.name}</b></div></Td>
                  <Td mono>{p.code}</Td>
                  <Td>{supplier?.name || "—"}</Td>
                  <Td>{p.piecesPerPackage} pz/paq</Td>
                  <Td>{unit === "piezas" ? `${stock} pz` : packagesAndPieces(stock, p.piecesPerPackage)}</Td>
                  <Td><StatusPill status={p.status} /></Td>
                  <Td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button onClick={() => { setEditing(p); setShowForm(true); }} style={{ border: "none", background: T.cream, borderRadius: 7, padding: 6, cursor: "pointer" }}><Pencil size={13} /></button>
                      <button onClick={() => toggleStatus(p)} style={{ border: "none", background: T.cream, borderRadius: 7, padding: 6, cursor: "pointer" }}><Ban size={13} color={p.status === "active" ? T.red : T.green700} /></button>
                      <Btn small variant="secondary" onClick={() => setKardexProductId(p.id)}>Kardex</Btn>
                      {(p.supplierIds && p.supplierIds.length > 1) && <Btn small variant="secondary" onClick={() => setCompareProduct(p)}>Comparar proveedores</Btn>}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length && <EmptyState text="No hay productos que coincidan con la búsqueda." />}
      </Card>
      {showForm && <ProductForm initial={editing} suppliers={state.suppliers.filter((s) => s.status === "active")} branches={branches} onSave={save} onClose={() => { setShowForm(false); setEditing(null); }} />}
      {kardexProductId && <KardexModal state={state} productId={kardexProductId} branches={branches} activeBranchId={activeBranchId} onClose={() => setKardexProductId(null)} />}
      {compareProduct && <SupplierComparisonModal product={compareProduct} state={state} onClose={() => setCompareProduct(null)} />}
    </div>
  );
}

/* ============================== PROVEEDORES ============================== */
function SuppliersView({ state, mutate, audit }) {
  const [form, setForm] = useState(null);
  const save = (f) => {
    if (f.id) { mutate((s) => ({ ...s, suppliers: s.suppliers.map((x) => (x.id === f.id ? f : x)) })); audit("Proveedores", `Editó proveedor ${f.name}`); }
    else { mutate((s) => ({ ...s, suppliers: [...s.suppliers, { ...f, id: uid("sup"), status: "active" }] })); audit("Proveedores", `Dio de alta al proveedor ${f.name}`); }
    setForm(null);
  };
  const toggle = (sup) => { mutate((s) => ({ ...s, suppliers: s.suppliers.map((x) => (x.id === sup.id ? { ...x, status: x.status === "active" ? "disabled" : "active" } : x)) })); audit("Proveedores", `${sup.status === "active" ? "Desactivó" : "Reactivó"} ${sup.name}`); };
  const exportRows = state.suppliers.map((s) => ({ Proveedor: s.name, "Tipo de productos": s.productTypes, "Crédito (días)": s.paymentDueDays, Estado: s.status === "active" ? "Activo" : "Desactivado" }));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <ExportBar rows={exportRows} label="proveedores" />
        <Btn icon={Plus} onClick={() => setForm({ name: "", productTypes: "", paymentDueDays: 30 })}>Alta de proveedor</Btn>
      </div>
      <Card style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Proveedor</Th><Th>Tipo de productos</Th><Th>Crédito (días)</Th><Th>Estado</Th><Th></Th></tr></thead>
          <tbody>
            {state.suppliers.map((s) => (
              <tr key={s.id}>
                <Td><b>{s.name}</b></Td><Td>{s.productTypes}</Td><Td>{s.paymentDueDays} días</Td><Td><StatusPill status={s.status} /></Td>
                <Td><div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setForm(s)} style={{ border: "none", background: T.cream, borderRadius: 7, padding: 6, cursor: "pointer" }}><Pencil size={13} /></button>
                  <button onClick={() => toggle(s)} style={{ border: "none", background: T.cream, borderRadius: 7, padding: 6, cursor: "pointer" }}><Ban size={13} color={s.status === "active" ? T.red : T.green700} /></button>
                </div></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {form && (
        <Modal title={form.id ? "Editar proveedor" : "Alta de proveedor"} onClose={() => setForm(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Nombre del proveedor"><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Tipo de productos que suministra"><TextInput value={form.productTypes} onChange={(e) => setForm({ ...form, productTypes: e.target.value })} /></Field>
            <Field label="Días de crédito (genera alerta de pago)"><TextInput type="number" min="0" value={form.paymentDueDays} onChange={(e) => setForm({ ...form, paymentDueDays: clampNum(e.target.value) })} /></Field>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Btn variant="ghost" onClick={() => setForm(null)}>Cancelar</Btn>
              <Btn onClick={() => form.name.trim() && save(form)}>Guardar</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============================== SUCURSALES ============================== */
function BranchesView({ state, mutate, audit }) {
  const [form, setForm] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const save = (f) => {
    if (f.id) {
      const folioPrefix = f.folioPrefix?.trim() ? f.folioPrefix.trim().toUpperCase() : (state.branches.find((b) => b.id === f.id)?.folioPrefix || suggestFolioPrefix(f.name));
      mutate((s) => ({ ...s, branches: s.branches.map((x) => (x.id === f.id ? { ...f, folioPrefix } : x)) }));
      audit("Sucursales", `Editó sucursal ${f.name}`);
    } else {
      const folioPrefix = f.folioPrefix?.trim() ? f.folioPrefix.trim().toUpperCase() : uniqueFolioPrefix(f.name, state.branches);
      mutate((s) => ({ ...s, branches: [...s.branches, { ...f, folioPrefix, id: uid("suc"), status: "active" }] }));
      audit("Sucursales", `Dio de alta la sucursal ${f.name}`);
    }
    setForm(null);
  };
  const toggle = (b) => { mutate((s) => ({ ...s, branches: s.branches.map((x) => (x.id === b.id ? { ...x, status: x.status === "active" ? "disabled" : "active" } : x)) })); audit("Sucursales", `${b.status === "active" ? "Desactivó" : "Reactivó"} ${b.name}`); };
  const doDelete = () => {
    const bId = deleteTarget.id;
    mutate((s) => ({
      ...s,
      branches: s.branches.filter((b) => b.id !== bId),
      products: s.products.map((p) => (p.idealStock && bId in p.idealStock ? { ...p, idealStock: Object.fromEntries(Object.entries(p.idealStock).filter(([k]) => k !== bId)) } : p)),
      invoices: s.invoices.filter((i) => i.branchId !== bId),
      lots: s.lots.filter((l) => l.branchId !== bId),
      mermas: s.mermas.filter((m) => m.branchId !== bId),
      physicalInventories: s.physicalInventories.filter((pi) => pi.branchId !== bId),
      inventoryAdjustments: (s.inventoryAdjustments || []).filter((a) => a.branchId !== bId),
      users: s.users.map((u) => (u.branchId === bId ? { ...u, status: "disabled" } : u)),
    }));
    audit("Sucursales", `Eliminó permanentemente la sucursal ${deleteTarget.name} y todos sus registros asociados (facturas, inventarios, mermas, ajustes)`);
    setDeleteTarget(null); setDeleteConfirmText("");
  };
  const exportRows = state.branches.map((b) => ({ Número: b.number, Sucursal: b.name, Estado: b.status === "active" ? "Activa" : "Desactivada" }));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <ExportBar rows={exportRows} label="sucursales" />
        <Btn icon={Plus} onClick={() => setForm({ number: state.branches.length + 1, name: "" })}>Alta de sucursal</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 14 }}>
        {state.branches.map((b) => (
          <Card key={b.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div><div style={{ fontSize: 11, color: T.gray500, fontWeight: 700 }}>SUCURSAL #{b.number} · {b.folioPrefix || suggestFolioPrefix(b.name)}</div><div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 17, fontWeight: 700 }}>{b.name}</div></div>
              <StatusPill status={b.status} />
            </div>
            <div style={{ fontSize: 12, color: T.gray500, marginTop: 8 }}>Estándar de merma: <b style={{ color: T.ink }}>{b.mermaStandardPercent != null ? `${b.mermaStandardPercent}%` : "No configurado"}</b></div>
            <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
              <Btn small variant="secondary" icon={Pencil} onClick={() => setForm(b)}>Editar</Btn>
              <Btn small variant="danger" icon={Ban} onClick={() => toggle(b)}>{b.status === "active" ? "Desactivar" : "Reactivar"}</Btn>
              <Btn small variant="danger" icon={Trash2} onClick={() => setDeleteTarget(b)}>Eliminar</Btn>
            </div>
          </Card>
        ))}
      </div>
      {form && (
        <Modal title={form.id ? "Editar sucursal" : "Alta de sucursal"} onClose={() => setForm(null)} width={400}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Número de sucursal"><TextInput type="number" value={form.number} onChange={(e) => setForm({ ...form, number: clampNum(e.target.value) })} /></Field>
            <Field label="Nombre de la sucursal"><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Prefijo de folio" hint={`Se usa para los folios de inventario (ej. ${suggestFolioPrefix(form.name || "Sucursal")}-0001). Déjalo vacío para que se genere solo a partir del nombre.`}>
              <TextInput value={form.folioPrefix || ""} onChange={(e) => setForm({ ...form, folioPrefix: e.target.value.toUpperCase() })} placeholder={form.id ? (form.folioPrefix || suggestFolioPrefix(form.name)) : suggestFolioPrefix(form.name || "")} />
            </Field>
            <Field label="Estándar máximo de merma (%)" hint="Porcentaje del valor de compras del periodo. Déjalo vacío si aún no quieres definirlo.">
              <TextInput type="number" min="0" step="0.1" value={form.mermaStandardPercent ?? ""} onChange={(e) => setForm({ ...form, mermaStandardPercent: e.target.value === "" ? null : clampNum(e.target.value) })} />
            </Field>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Btn variant="ghost" onClick={() => setForm(null)}>Cancelar</Btn>
              <Btn onClick={() => form.name.trim() && save(form)}>Guardar</Btn>
            </div>
          </div>
        </Modal>
      )}
      {deleteTarget && (
        <Modal title={`Eliminar "${deleteTarget.name}" permanentemente`} onClose={() => { setDeleteTarget(null); setDeleteConfirmText(""); }} width={420}>
          <p style={{ fontSize: 13, color: T.red, fontWeight: 600, marginTop: 0 }}>Esta acción no se puede deshacer. Se eliminarán para siempre la sucursal y todos sus registros: facturas, inventarios físicos, ajustes, mermas y existencias. Los usuarios asignados a esta sucursal quedarán desactivados.</p>
          <Field label={`Para confirmar, escribe el nombre exacto: ${deleteTarget.name}`}>
            <TextInput value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <Btn variant="ghost" onClick={() => { setDeleteTarget(null); setDeleteConfirmText(""); }}>Cancelar</Btn>
            <Btn variant="danger" disabled={deleteConfirmText.trim() !== deleteTarget.name} icon={Trash2} onClick={doDelete}>Eliminar permanentemente</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============================== USUARIOS ============================== */
function UsersView({ state, mutate, audit }) {
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState("");
  const save = (f) => {
    if (state.users.some((u) => u.username === f.username && u.id !== f.id)) { setFormError("Ese usuario numérico ya existe."); return; }
    if (f.id) { mutate((s) => ({ ...s, users: s.users.map((x) => (x.id === f.id ? { ...x, ...f } : x)) })); audit("Usuarios", `Editó al usuario ${f.name}`); }
    else { mutate((s) => ({ ...s, users: [...s.users, { ...f, id: uid("usr"), status: "active", failedAttempts: 0, lockedUntil: null, lastLogin: null }] })); audit("Usuarios", `Creó al usuario ${f.name}`); }
    setForm(null); setFormError("");
  };
  const toggle = (u) => { mutate((s) => ({ ...s, users: s.users.map((x) => (x.id === u.id ? { ...x, status: x.status === "active" ? "disabled" : "active" } : x)) })); audit("Usuarios", `${u.status === "active" ? "Desactivó" : "Reactivó"} al usuario ${u.name}`); };
  const unlock = (u) => { mutate((s) => ({ ...s, users: s.users.map((x) => (x.id === u.id ? { ...x, failedAttempts: 0, lockedUntil: null } : x)) })); audit("Usuarios", `Restableció el bloqueo de ${u.name}`); };
  const exportRows = state.users.map((u) => ({ Nombre: u.name, Usuario: u.username, Rol: u.role === "general_admin" ? "Administrador General" : "Administrador de Sucursal", Sucursal: state.branches.find((b) => b.id === u.branchId)?.name || "—", "Último acceso": u.lastLogin ? `${u.lastLogin.date} ${u.lastLogin.time}` : "—", Estado: u.status === "active" ? "Activo" : "Desactivado" }));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <ExportBar rows={exportRows} label="usuarios" />
        <Btn icon={Plus} onClick={() => setForm({ username: "", password: "", name: "", role: "branch_admin", branchId: state.branches[0]?.id || "" })}>Nuevo usuario</Btn>
      </div>
      <Card style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Nombre</Th><Th>Usuario</Th><Th>Rol</Th><Th>Sucursal</Th><Th>Último acceso</Th><Th>Estado</Th><Th></Th></tr></thead>
          <tbody>
            {state.users.map((u) => (
              <tr key={u.id}>
                <Td><b>{u.name}</b></Td><Td mono>{u.username}</Td>
                <Td>{u.role === "general_admin" ? "Administrador General" : "Administrador de Sucursal"}</Td>
                <Td>{state.branches.find((b) => b.id === u.branchId)?.name || "—"}</Td>
                <Td>{u.lastLogin ? `${u.lastLogin.date} ${u.lastLogin.time}` : "—"}</Td>
                <Td>{u.lockedUntil && Date.now() < u.lockedUntil ? <Pill bg="#FBDCDA" fg={T.red}>Bloqueado</Pill> : <StatusPill status={u.status} />}</Td>
                <Td><div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setForm(u)} style={{ border: "none", background: T.cream, borderRadius: 7, padding: 6, cursor: "pointer" }}><Pencil size={13} /></button>
                  {u.lockedUntil && <button onClick={() => unlock(u)} title="Desbloquear" style={{ border: "none", background: T.cream, borderRadius: 7, padding: 6, cursor: "pointer" }}><KeyRound size={13} /></button>}
                  <button onClick={() => toggle(u)} style={{ border: "none", background: T.cream, borderRadius: 7, padding: 6, cursor: "pointer" }}><Ban size={13} color={u.status === "active" ? T.red : T.green700} /></button>
                </div></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {form && (
        <Modal title={form.id ? "Editar usuario" : "Nuevo usuario"} onClose={() => { setForm(null); setFormError(""); }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Nombre completo"><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Usuario (numérico)"><TextInput value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\D/g, "") })} /></Field>
              <Field label="Contraseña (numérica)"><TextInput value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value.replace(/\D/g, "") })} /></Field>
            </div>
            <Field label="Rol">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="branch_admin">Administrador de Sucursal</option><option value="general_admin">Administrador General</option>
              </Select>
            </Field>
            {form.role === "branch_admin" && (
              <Field label="Sucursal asignada">
                <Select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                  {state.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
            )}
            {formError && <div style={{ color: T.red, fontSize: 12.5, fontWeight: 600 }}>{formError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Btn variant="ghost" onClick={() => { setForm(null); setFormError(""); }}>Cancelar</Btn>
              <Btn onClick={() => form.name.trim() && form.username.trim() && form.password.trim() && save(form)}>Guardar</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============================== FACTURAS ============================== */
function AdminPasswordGate({ users, onConfirm, onClose }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState("");
  const check = () => {
    const ok = users.some((u) => u.role === "general_admin" && u.status === "active" && u.password === pw);
    if (ok) onConfirm(); else setErr("Contraseña de Administrador General incorrecta.");
  };
  return (
    <Modal title="Modificación protegida" onClose={onClose} width={380}>
      <p style={{ fontSize: 13, color: T.gray500, marginTop: 0 }}>Esta acción requiere la contraseña del Administrador General.</p>
      <TextInput type="password" inputMode="numeric" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Contraseña" style={{ width: "100%" }} />
      {err && <div style={{ color: T.red, fontSize: 12, marginTop: 6 }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn icon={Lock} onClick={check}>Confirmar</Btn>
      </div>
    </Modal>
  );
}

function InvoiceForm({ state, branchId, initial, onSave, onClose }) {
  const [f, setF] = useState(initial || {
    invoiceNumber: "", supplierId: state.suppliers[0]?.id || "", branchId, issueDate: todayISO(), entryDate: todayISO(),
    items: [], total: 0, status: "pending",
  });
  const products = state.products.filter((p) => p.status === "active" && (p.supplierIds && p.supplierIds.length ? p.supplierIds.includes(f.supplierId) : p.supplierId === f.supplierId));
  const lastCostForSupplier = (productId, supplierId) => {
    const prod = state.products.find((p) => p.id === productId);
    const fromHistory = (prod?.costHistory || []).filter((h) => h.supplierId === supplierId).slice(-1)[0];
    return fromHistory ? fromHistory.costPerPackage : prod?.lastCostPerPackage || 0;
  };
  const addItem = () => {
    const defaultProduct = products[0];
    setF((s) => ({ ...s, items: [...s.items, { id: uid("it"), productId: defaultProduct?.id || "", packages: 1, looseUnits: 0, costPerPackage: defaultProduct ? lastCostForSupplier(defaultProduct.id, f.supplierId) : 0, expirationDate: "" }] }));
  };
  const updateItem = (id, patch) => setF((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }));
  const onProductChange = (id, productId) => {
    updateItem(id, { productId, costPerPackage: lastCostForSupplier(productId, f.supplierId) });
  };
  const removeItem = (id) => setF((s) => ({ ...s, items: s.items.filter((it) => it.id !== id) }));
  const lineTotal = (it, prod) => it.packages * it.costPerPackage + (it.looseUnits || 0) * (prod ? it.costPerPackage / prod.piecesPerPackage : 0);
  const total = f.items.reduce((s, it) => s + lineTotal(it, state.products.find((p) => p.id === it.productId)), 0);

  const valid = f.invoiceNumber.trim() && f.items.length > 0 && f.items.every((it) => it.productId && (it.packages > 0 || (it.looseUnits || 0) > 0) && it.expirationDate && it.expirationDate >= f.entryDate) && f.entryDate >= f.issueDate;

  return (
    <Modal title={initial ? "Editar factura" : "Entrada de productos por factura"} onClose={onClose} width={780}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
          <Field label="Número de factura"><TextInput value={f.invoiceNumber} onChange={(e) => setF({ ...f, invoiceNumber: e.target.value })} /></Field>
          <Field label="Proveedor">
            <Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value, items: [] })}>
              {state.suppliers.filter((s) => s.status === "active").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Fecha de emisión"><TextInput type="date" value={f.issueDate} onChange={(e) => setF({ ...f, issueDate: e.target.value })} /></Field>
          <Field label="Fecha de ingreso"><TextInput type="date" value={f.entryDate} min={f.issueDate} onChange={(e) => setF({ ...f, entryDate: e.target.value })} /></Field>
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: T.gray500 }}>PRODUCTOS DE LA FACTURA</span>
            <Btn small variant="secondary" icon={Plus} onClick={addItem}>Agregar producto</Btn>
          </div>
          <div style={{ overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,0.7fr) minmax(0,0.7fr) minmax(0,0.9fr) minmax(0,0.9fr) minmax(0,1fr) auto", gap: 6, padding: "0 8px", fontSize: 10.5, fontWeight: 700, color: T.gray500, textTransform: "uppercase", minWidth: 640 }}>
              <span>Producto</span><span>Paquetes</span><span>Piezas sueltas</span><span>Costo/paquete</span><span>Costo/pieza</span><span>Caducidad</span><span></span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4, minWidth: 640 }}>
              {f.items.map((it) => {
                const prod = state.products.find((p) => p.id === it.productId);
                const costPerUnit = prod ? (it.costPerPackage / prod.piecesPerPackage) : 0;
                const totalPieces = it.packages * (prod?.piecesPerPackage || 0) + (it.looseUnits || 0);
                return (
                  <div key={it.id} style={{ background: T.cream, padding: 8, borderRadius: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,0.7fr) minmax(0,0.7fr) minmax(0,0.9fr) minmax(0,0.9fr) minmax(0,1fr) auto", gap: 6, alignItems: "center" }}>
                      <Select value={it.productId} onChange={(e) => onProductChange(it.id, e.target.value)}>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                      <TextInput type="number" min="0" value={it.packages} onChange={(e) => updateItem(it.id, { packages: clampNum(e.target.value) })} placeholder="Paquetes" />
                      <TextInput type="number" min="0" value={it.looseUnits || 0} onChange={(e) => updateItem(it.id, { looseUnits: clampNum(e.target.value) })} placeholder="Piezas" />
                      <TextInput type="number" min="0" step="0.01" value={it.costPerPackage} onChange={(e) => updateItem(it.id, { costPerPackage: clampNum(e.target.value) })} placeholder="Costo/paq" />
                      <div style={{ fontSize: 11.5, color: T.gray500 }}>{fmtMoney(costPerUnit)}/pz</div>
                      <TextInput type="date" value={it.expirationDate} min={f.entryDate} onChange={(e) => updateItem(it.id, { expirationDate: e.target.value })} />
                      <button onClick={() => removeItem(it.id)} style={{ border: "none", background: "#fff", borderRadius: 6, padding: 5, cursor: "pointer" }}><Trash2 size={13} color={T.red} /></button>
                    </div>
                    {prod && <div style={{ fontSize: 11, color: T.gray500, marginTop: 4, paddingLeft: 2 }}>= {totalPieces} piezas totales · {fmtMoney(lineTotal(it, prod))}
                      {lastCostForSupplier(prod.id, f.supplierId) > 0 && <span> · último costo con este proveedor: {fmtMoney(lastCostForSupplier(prod.id, f.supplierId))}/paq</span>}
                    </div>}
                  </div>
                );
              })}
              {!f.items.length && <EmptyState text="Agrega al menos un producto." />}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right", fontFamily: "'Space Grotesk',sans-serif", fontSize: 18, fontWeight: 700 }}>Total: {fmtMoney(total)}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn disabled={!valid} icon={CheckCircle2} onClick={() => onSave({ ...f, total })}>Guardar factura</Btn>
        </div>
      </div>
    </Modal>
  );
}

function InvoicesView({ state, mutate, branches, activeBranchId, currentUser, audit }) {
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [gate, setGate] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null); const [cancelReason, setCancelReason] = useState("");
  const branchId = currentUser.role === "branch_admin" ? currentUser.branchId : activeBranchId;
  const list = state.invoices.filter((i) => !branchId || i.branchId === branchId).sort((a, b) => b.entryDate.localeCompare(a.entryDate));

  const createInvoice = (f) => {
    const invId = f.id || uid("inv");
    const newLots = f.items.map((it) => {
      const prod = state.products.find((p) => p.id === it.productId);
      const totalPieces = it.packages * prod.piecesPerPackage + (it.looseUnits || 0);
      return { id: uid("lot"), invoiceId: invId, productId: it.productId, branchId: f.branchId, expirationDate: it.expirationDate, entryDate: f.entryDate, initialPieces: totalPieces, remainingPieces: totalPieces, costPerUnit: it.costPerPackage / prod.piecesPerPackage, status: "active" };
    });
    const lastCostByProduct = {};
    f.items.forEach((it) => { lastCostByProduct[it.productId] = it.costPerPackage; });
    const costDate = f.entryDate;
    if (f.id) {
      mutate((s) => ({
        ...s,
        invoices: s.invoices.map((i) => (i.id === f.id ? { ...f, editedBy: currentUser.name, editedAt: nowStamp() } : i)),
        lots: [...s.lots.filter((l) => l.invoiceId !== f.id), ...newLots],
        products: s.products.map((p) => (lastCostByProduct[p.id] != null ? { ...p, lastCostPerPackage: lastCostByProduct[p.id], costHistory: [...(p.costHistory || []), { date: costDate, costPerPackage: lastCostByProduct[p.id], invoiceNumber: f.invoiceNumber, supplierId: f.supplierId }] } : p)),
      }));
      audit("Facturas", `Editó la factura ${f.invoiceNumber} (los lotes asociados se restablecieron)`);
    } else {
      mutate((s) => ({
        ...s,
        invoices: [...s.invoices, { ...f, id: invId, createdBy: currentUser.name, createdAt: nowStamp() }],
        lots: [...s.lots, ...newLots],
        products: s.products.map((p) => (lastCostByProduct[p.id] != null ? { ...p, lastCostPerPackage: lastCostByProduct[p.id], costHistory: [...(p.costHistory || []), { date: costDate, costPerPackage: lastCostByProduct[p.id], invoiceNumber: f.invoiceNumber, supplierId: f.supplierId }] } : p)),
      }));
      audit("Facturas", `Registró la factura ${f.invoiceNumber} (${fmtMoney(f.total)})`);
    }
    setShowForm(false); setEditTarget(null);
  };
  const markPaid = (inv) => { mutate((s) => ({ ...s, invoices: s.invoices.map((i) => (i.id === inv.id ? { ...i, status: "paid" } : i)) })); audit("Facturas", `Marcó como pagada la factura ${inv.invoiceNumber}`); };
  const doCancel = () => {
    mutate((s) => ({ ...s, invoices: s.invoices.map((i) => (i.id === cancelTarget.id ? { ...i, status: "cancelled", cancelReason, cancelledBy: currentUser.name } : i)) }));
    audit("Facturas", `Canceló la factura ${cancelTarget.invoiceNumber} — motivo: ${cancelReason}`);
    setCancelTarget(null); setCancelReason("");
  };
  const exportRows = list.map((inv) => ({
    Factura: inv.invoiceNumber,
    Proveedor: state.suppliers.find((s) => s.id === inv.supplierId)?.name || "—",
    Sucursal: state.branches.find((b) => b.id === inv.branchId)?.name || "—",
    Ingreso: fmtDate(inv.entryDate),
    Total: fmtMoney(inv.total),
    Estado: inv.status === "paid" ? "Pagada" : inv.status === "cancelled" ? "Cancelada" : "Pendiente de pago",
  }));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <ExportBar rows={exportRows} label="facturas" />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!branchId && <span style={{ color: T.red, fontSize: 12.5, fontWeight: 600 }}>Selecciona una sucursal para registrar una factura.</span>}
          <Btn icon={Plus} onClick={() => branchId && setShowForm(true)} disabled={!branchId}>Nueva factura</Btn>
        </div>
      </div>
      <Card style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Factura</Th><Th>Proveedor</Th><Th>Sucursal</Th><Th>Ingreso</Th><Th>Total</Th><Th>Estado</Th><Th></Th></tr></thead>
          <tbody>
            {list.map((inv) => {
              const sup = state.suppliers.find((s) => s.id === inv.supplierId);
              const br = state.branches.find((b) => b.id === inv.branchId);
              return (
                <tr key={inv.id}>
                  <Td mono>{inv.invoiceNumber}</Td><Td>{sup?.name}</Td><Td>{br?.name}</Td><Td>{fmtDate(inv.entryDate)}</Td><Td>{fmtMoney(inv.total)}</Td><Td><StatusPill status={inv.status} /></Td>
                  <Td><div style={{ display: "flex", gap: 6 }}>
                    {inv.status !== "cancelled" && <Btn small variant="ghost" onClick={() => setGate(() => () => { setEditTarget(inv); setShowForm(true); })}>Editar</Btn>}
                    {inv.status === "pending" && <Btn small variant="secondary" onClick={() => setGate(() => () => markPaid(inv))}>Marcar pagada</Btn>}
                    {inv.status !== "cancelled" && <Btn small variant="danger" onClick={() => setGate(() => () => setCancelTarget(inv))}>Cancelar</Btn>}
                  </div></Td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length && <EmptyState text="No hay facturas registradas para esta sucursal." />}
      </Card>
      {showForm && <InvoiceForm state={state} branchId={branchId} initial={editTarget} onSave={createInvoice} onClose={() => { setShowForm(false); setEditTarget(null); }} />}
      {gate && <AdminPasswordGate users={state.users} onClose={() => setGate(null)} onConfirm={() => { const fn = gate; setGate(null); fn(); }} />}
      {cancelTarget && (
        <Modal title={`Cancelar factura ${cancelTarget.invoiceNumber}`} onClose={() => setCancelTarget(null)} width={400}>
          <Field label="Motivo de la cancelación"><TextArea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <Btn variant="ghost" onClick={() => setCancelTarget(null)}>Volver</Btn>
            <Btn variant="danger" disabled={!cancelReason.trim()} onClick={doCancel}>Confirmar cancelación</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============================== INVENTARIO FÍSICO ============================== */
/* ============================== INVENTARIO FÍSICO ============================== */
function InventoryCreateModal({ state, branchId, currentUser, onCreate, onClose }) {
  const branchProducts = state.products.filter((p) => p.status === "active");
  const [type, setType] = useState("fisico");
  const [date, setDate] = useState(todayISO());
  const [selectedProducts, setSelectedProducts] = useState(branchProducts.map((p) => p.id));
  const branchUsers = state.users.filter((u) => u.status === "active" && (u.role === "general_admin" || u.branchId === branchId));
  const [selectedUsers, setSelectedUsers] = useState([currentUser.id]);

  const toggleProduct = (id) => setSelectedProducts((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleAllProducts = () => setSelectedProducts((s) => (s.length === branchProducts.length ? [] : branchProducts.map((p) => p.id)));
  const toggleUser = (id) => setSelectedUsers((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const valid = selectedProducts.length > 0 && selectedUsers.length > 0 && date;

  return (
    <Modal title="Nuevo inventario físico" onClose={onClose} width={620}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Fecha"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Tipo de inventario">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(INV_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
        </div>
        <Field label={`Productos a contar (${selectedProducts.length} de ${branchProducts.length})`}>
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, maxHeight: 190, overflow: "auto", padding: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, marginBottom: 6, cursor: "pointer", borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>
              <input type="checkbox" checked={selectedProducts.length === branchProducts.length} onChange={toggleAllProducts} /> Seleccionar todos
            </label>
            {branchProducts.map((p) => (
              <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "3px 0", cursor: "pointer" }}>
                <input type="checkbox" checked={selectedProducts.includes(p.id)} onChange={() => toggleProduct(p.id)} /> {p.name}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Usuario(s) responsables del conteo">
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 8 }}>
            {branchUsers.map((u) => (
              <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "3px 0", cursor: "pointer" }}>
                <input type="checkbox" checked={selectedUsers.includes(u.id)} onChange={() => toggleUser(u.id)} /> {u.name}
              </label>
            ))}
          </div>
        </Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn disabled={!valid} icon={CheckCircle2} onClick={() => onCreate({ type, date, productIds: selectedProducts, responsibles: branchUsers.filter((u) => selectedUsers.includes(u.id)).map((u) => u.name) })}>Crear inventario</Btn>
        </div>
      </div>
    </Modal>
  );
}

function DiffPill({ level }) {
  const m = DIFF_LEVEL_META[level];
  return <Pill bg={m.bg} fg={m.fg}>{m.icon} {m.label}</Pill>;
}
function InvStatusPill({ pi }) {
  const key = isInventoryOpen(pi) ? "en_proceso" : pi.status === "cancelado" ? "cancelado" : "finalizado";
  const m = INV_STATUS_META[key];
  return <Pill bg={m.bg} fg={m.fg}>{m.label}</Pill>;
}

function InventoryCaptureView({ state, mutate, inventory, currentUser, audit, onClose }) {
  const [counts, setCounts] = useState(() => {
    const init = {};
    inventory.counts.forEach((c) => { init[c.productId] = { almacen: c.almacen || 0, congelador: c.congelador || 0, refrigerador: c.refrigerador || 0, barra: c.barra || 0 }; });
    return init;
  });
  const products = state.products.filter((p) => inventory.productIds.includes(p.id));
  const tolerance = state.config.inventoryToleranceLimit ?? 5;

  const setCount = (productId, area, val) => setCounts((c) => ({ ...c, [productId]: { ...c[productId], [area]: clampNum(val) } }));
  const totalFor = (productId) => AREAS.reduce((s, a) => s + ((counts[productId]?.[a]) || 0), 0);
  const buildCountsArray = () => products.map((p) => ({ productId: p.id, ...AREAS.reduce((o, a) => ({ ...o, [a]: counts[p.id]?.[a] || 0 }), {}), total: totalFor(p.id) }));

  const saveDraft = () => {
    mutate((s) => ({ ...s, physicalInventories: s.physicalInventories.map((pi) => (pi.id === inventory.id ? { ...pi, counts: buildCountsArray() } : pi)) }));
    audit("Inventario físico", `Guardó avance del inventario ${inventory.folio}`);
  };

  const [pendingFinalize, setPendingFinalize] = useState(null);
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustObservations, setAdjustObservations] = useState("");

  const computeFinalizeResult = () => {
    const consumption = []; let lotsNext = state.lots;
    let faltantes = 0, sobrantes = 0, valorFaltantes = 0, valorSobrantes = 0;
    const enrichedCounts = [];
    products.forEach((p) => {
      const theoretical = theoreticalStock(lotsNext, p.id, inventory.branchId);
      const captured = totalFor(p.id);
      const consumed = Math.max(0, theoretical - captured);
      consumption.push({ productId: p.id, consumedPieces: consumed, before: theoretical, captured });
      const diff = captured - theoretical;
      const diffPercent = theoretical > 0 ? (diff / theoretical) * 100 : (diff !== 0 ? 100 : 0);
      const relevantLots = lotsNext.filter((l) => l.productId === p.id && l.branchId === inventory.branchId && l.status === "active");
      const lotsQty = relevantLots.reduce((s, l) => s + l.remainingPieces, 0);
      const lotsVal = relevantLots.reduce((s, l) => s + l.remainingPieces * (l.costPerUnit || 0), 0);
      const unitCost = lotsQty > 0 ? lotsVal / lotsQty : 0;
      const diffCost = diff * unitCost;
      if (diff < 0) { faltantes += Math.abs(diff); valorFaltantes += Math.abs(diffCost); }
      if (diff > 0) { sobrantes += diff; valorSobrantes += diffCost; }
      enrichedCounts.push({ productId: p.id, ...AREAS.reduce((o, a) => ({ ...o, [a]: counts[p.id]?.[a] || 0 }), {}), total: captured, theoretical, difference: diff, diffPercent, diffCost, diffLevel: classifyDiff(diffPercent, tolerance), unitCost });
      lotsNext = reconcileLotsForCount(lotsNext, p.id, inventory.branchId, captured);
    });
    const suggested = computeSuggestedOrders({ ...state, lots: lotsNext }, inventory.branchId);
    const hasDifferences = enrichedCounts.some((c) => c.difference !== 0);
    const hasSignificant = enrichedCounts.some((c) => c.diffLevel === "diferencia_significativa");
    return { consumption, enrichedCounts, lotsNext, suggested, faltantes, sobrantes, valorFaltantes, valorSobrantes, hasDifferences, hasSignificant };
  };

  const applyFinalize = (result, reason, observations) => {
    const { consumption, enrichedCounts, lotsNext, suggested, faltantes, sobrantes, valorFaltantes, valorSobrantes, hasSignificant } = result;
    const needsAuth = hasSignificant && currentUser.role !== "general_admin";
    const newAdjustments = enrichedCounts.filter((c) => c.difference !== 0).map((c) => ({
      id: uid("adj"), inventoryId: inventory.id, inventoryFolio: inventory.folio,
      productId: c.productId, branchId: inventory.branchId,
      adjustedQuantity: c.difference, previousStock: c.theoretical, newStock: c.total,
      date: todayISO(), user: currentUser.name, reason, observations, createdAt: nowStamp(),
    }));
    mutate((s) => ({
      ...s, lots: lotsNext,
      physicalInventories: s.physicalInventories.map((pi) => (pi.id === inventory.id ? {
        ...pi, counts: enrichedCounts, consumption, suggestedOrder: suggested,
        status: "finalizado", closedAt: nowStamp(),
        faltantes, sobrantes, valorFaltantes, valorSobrantes, impactoNeto: valorSobrantes - valorFaltantes,
        toleranceLimit: tolerance, requiresAuthorization: needsAuth, authorized: !needsAuth,
      } : pi)),
      inventoryAdjustments: [...(s.inventoryAdjustments || []), ...newAdjustments],
    }));
    audit("Inventario físico", `Finalizó el inventario ${inventory.folio}${newAdjustments.length ? ` — ${newAdjustments.length} ajuste(s) generado(s)` : ""}`);
    setPendingFinalize(null); setAdjustReason(""); setAdjustObservations("");
  };

  const startFinalize = () => {
    const result = computeFinalizeResult();
    if (result.hasDifferences) setPendingFinalize(result);
    else applyFinalize(result, "", "");
  };

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: T.gray500, fontWeight: 700 }}>{inventory.folio} · {INV_TYPES[inventory.type] || "Inventario Físico"}</div>
            <div style={{ fontSize: 13, color: T.gray500 }}>Responsable(s): {(inventory.responsibles || []).join(", ") || "—"} · {fmtDate(inventory.date)}</div>
          </div>
          <Btn variant="ghost" onClick={onClose}>← Volver a la lista</Btn>
        </div>
      </Card>
      <Card style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Producto</Th>{AREAS.map((a) => <Th key={a}>{AREA_LABELS[a]}</Th>)}<Th>Total</Th><Th>Existencia según registros</Th><Th>Diferencia</Th></tr></thead>
          <tbody>
            {products.map((p) => {
              const theoretical = theoreticalStock(state.lots, p.id, inventory.branchId);
              const captured = totalFor(p.id);
              const diff = captured - theoretical;
              const diffPercent = theoretical > 0 ? (diff / theoretical) * 100 : (diff !== 0 ? 100 : 0);
              return (
                <tr key={p.id}>
                  <Td><b>{p.name}</b></Td>
                  {AREAS.map((a) => <Td key={a}><TextInput type="number" min="0" style={{ width: 70 }} value={counts[p.id]?.[a] || 0} onChange={(e) => setCount(p.id, a, e.target.value)} /></Td>)}
                  <Td><b>{captured}</b></Td>
                  <Td>{theoretical}</Td>
                  <Td><div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: diff < 0 ? T.red : diff > 0 ? T.orange : T.gray500, fontWeight: 700 }}>{diff > 0 ? "+" : ""}{diff}</span><DiffPill level={classifyDiff(diffPercent, tolerance)} /></div></Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <Btn variant="secondary" icon={CheckCircle2} onClick={saveDraft}>Guardar</Btn>
        <Btn icon={CheckCircle2} onClick={startFinalize}>Finalizar inventario</Btn>
      </div>
      {pendingFinalize && (
        <Modal title="Confirmar ajuste de inventario" onClose={() => setPendingFinalize(null)} width={680}>
          <p style={{ fontSize: 13, color: T.gray500, marginTop: 0 }}>Se encontraron diferencias entre lo contado y la existencia según registros. Esto generará un ajuste de inventario para cada producto con diferencia — queda registrado en el historial y nunca se aplica sin motivo.</p>
          <div style={{ maxHeight: 220, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><Th>Producto</Th><Th>Anterior</Th><Th>Posterior</Th><Th>Cantidad ajustada</Th></tr></thead>
              <tbody>
                {pendingFinalize.enrichedCounts.filter((c) => c.difference !== 0).map((c) => (
                  <tr key={c.productId}>
                    <Td>{state.products.find((p) => p.id === c.productId)?.name || "—"}</Td>
                    <Td>{c.theoretical}</Td>
                    <Td>{c.total}</Td>
                    <Td><span style={{ color: c.difference < 0 ? T.red : T.orange, fontWeight: 700 }}>{c.difference > 0 ? "+" : ""}{c.difference}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pendingFinalize.hasSignificant && currentUser.role !== "general_admin" && (
            <div style={{ fontSize: 12.5, color: T.orange, fontWeight: 600, marginBottom: 10 }}>Hay diferencias significativas — este inventario quedará marcado como pendiente de autorización del Administrador General.</div>
          )}
          <Field label="Motivo del ajuste"><TextInput value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Ej. conteo físico de rutina, robo detectado, error de captura previo…" /></Field>
          <div style={{ marginTop: 10 }}>
            <Field label="Observaciones (opcional)"><TextArea rows={2} value={adjustObservations} onChange={(e) => setAdjustObservations(e.target.value)} /></Field>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <Btn variant="ghost" onClick={() => setPendingFinalize(null)}>Volver</Btn>
            <Btn disabled={!adjustReason.trim()} icon={CheckCircle2} onClick={() => applyFinalize(pendingFinalize, adjustReason, adjustObservations)}>Confirmar y finalizar</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function InventoryDetailView({ state, mutate, currentUser, audit, inventory, onClose }) {
  const isGeneral = currentUser.role === "general_admin";
  const adjustments = (state.inventoryAdjustments || []).filter((a) => a.inventoryId === inventory.id);

  const authorize = () => {
    mutate((s) => ({ ...s, physicalInventories: s.physicalInventories.map((pi) => (pi.id === inventory.id ? { ...pi, authorized: true, authorizedBy: currentUser.name, authorizedAt: nowStamp() } : pi)) }));
    audit("Inventario físico", `Autorizó el ajuste del inventario ${inventory.folio}`);
  };

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: T.gray500, fontWeight: 700 }}>{inventory.folio} · {INV_TYPES[inventory.type] || "Inventario Físico"}</div>
            <div style={{ fontSize: 13, color: T.gray500 }}>Responsable(s): {(inventory.responsibles || [inventory.registeredBy]).filter(Boolean).join(", ") || "—"} · {fmtDate(inventory.date)}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <InvStatusPill pi={inventory} />
            <Btn variant="ghost" onClick={onClose}>← Volver a la lista</Btn>
          </div>
        </div>
        {inventory.status === "cancelado" && inventory.cancelReason && <div style={{ fontSize: 12, color: T.gray500, marginTop: 8 }}>Motivo de cancelación: {inventory.cancelReason}</div>}
      </Card>
      {inventory.requiresAuthorization && !inventory.authorized && (
        <Card style={{ borderTop: `3px solid ${T.orange}`, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 13, color: T.orange, fontWeight: 700 }}>⚠ Este inventario tuvo diferencias significativas y está pendiente de autorización del Administrador General.</div>
            {isGeneral && <Btn small icon={CheckCircle2} onClick={authorize}>Autorizar ajuste</Btn>}
          </div>
        </Card>
      )}
      {inventory.authorized && inventory.authorizedBy && (
        <div style={{ fontSize: 12, color: T.green700, marginBottom: 14 }}>✓ Ajuste autorizado por {inventory.authorizedBy} el {inventory.authorizedAt?.date}.</div>
      )}
      {inventory.faltantes != null && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 14, marginBottom: 14 }}>
          <KpiCard label="Faltantes (pz)" value={inventory.faltantes} accent={T.red} />
          <KpiCard label="Sobrantes (pz)" value={inventory.sobrantes} accent={T.orange} />
          <KpiCard label="Valor de faltantes" value={fmtMoney(inventory.valorFaltantes)} accent={T.red} />
          <KpiCard label="Impacto económico neto" value={fmtMoney(inventory.impactoNeto)} accent={inventory.impactoNeto < 0 ? T.red : T.green700} />
        </div>
      )}
      <Card style={{ padding: 0, overflow: "auto", marginBottom: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Producto</Th><Th>Física</Th><Th>Teórica</Th><Th>Diferencia</Th><Th>% Variación</Th><Th>Costo de la diferencia</Th><Th>Estado</Th></tr></thead>
          <tbody>
            {inventory.counts.map((c) => (
              <tr key={c.productId}>
                <Td><b>{state.products.find((p) => p.id === c.productId)?.name || "—"}</b></Td>
                <Td>{c.total}</Td>
                <Td>{c.theoretical ?? "—"}</Td>
                <Td>{c.difference != null ? (c.difference > 0 ? "+" : "") + c.difference : "—"}</Td>
                <Td>{c.diffPercent != null ? `${c.diffPercent.toFixed(1)}%` : "—"}</Td>
                <Td>{c.diffCost != null ? fmtMoney(c.diffCost) : "—"}</Td>
                <Td>{c.diffLevel ? <DiffPill level={c.diffLevel} /> : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {adjustments.length > 0 && (
        <Card style={{ padding: 0, overflow: "auto" }}>
          <div style={{ padding: "14px 16px 0" }}>
            <h4 style={{ margin: 0, fontFamily: "'Space Grotesk',sans-serif" }}>Ajustes generados</h4>
            <div style={{ fontSize: 11.5, color: T.gray500 }}>Cada ajuste queda registrado permanentemente, con el motivo capturado al finalizar el inventario.</div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
            <thead><tr><Th>Producto</Th><Th>Inventario anterior</Th><Th>Inventario posterior</Th><Th>Cantidad ajustada</Th><Th>Motivo</Th><Th>Usuario</Th><Th>Fecha</Th></tr></thead>
            <tbody>
              {adjustments.map((a) => (
                <tr key={a.id}>
                  <Td>{state.products.find((p) => p.id === a.productId)?.name || "—"}</Td>
                  <Td>{a.previousStock}</Td>
                  <Td>{a.newStock}</Td>
                  <Td><span style={{ color: a.adjustedQuantity < 0 ? T.red : T.orange, fontWeight: 700 }}>{a.adjustedQuantity > 0 ? "+" : ""}{a.adjustedQuantity}</span></Td>
                  <Td>{a.reason}</Td>
                  <Td>{a.user}</Td>
                  <Td>{fmtDate(a.date)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function PhysicalInventoryView({ state, mutate, currentUser, activeBranchId, audit }) {
  const branchId = currentUser.role === "branch_admin" ? currentUser.branchId : activeBranchId;
  const isGeneral = currentUser.role === "general_admin";
  const [showCreate, setShowCreate] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [folioSearch, setFolioSearch] = useState("");
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");

  const list = state.physicalInventories
    .filter((pi) => !branchId || pi.branchId === branchId)
    .filter((pi) => !folioSearch || pi.folio.toLowerCase().includes(folioSearch.toLowerCase()))
    .sort((a, b) => (b.createdAt?.date || b.date).localeCompare(a.createdAt?.date || a.date));

  const openInventory = state.physicalInventories.find((pi) => pi.id === openId);

  const createInventory = (f) => {
    const record = {
      id: uid("pinv"), folio: generateInventoryFolio(state, branchId),
      branchId, type: f.type, date: f.date, createdAt: nowStamp(), closedAt: null,
      createdBy: currentUser.name, registeredBy: currentUser.name, responsibles: f.responsibles,
      productIds: f.productIds,
      counts: f.productIds.map((pid) => ({ productId: pid, almacen: 0, congelador: 0, refrigerador: 0, barra: 0, total: 0 })),
      status: "en_proceso", consumption: [], suggestedOrder: [],
    };
    mutate((s) => ({ ...s, physicalInventories: [...s.physicalInventories, record] }));
    audit("Inventario físico", `Creó el inventario ${record.folio} (${INV_TYPES[f.type]})`);
    setShowCreate(false);
    setOpenId(record.id);
  };

  const doCancel = () => {
    mutate((s) => ({ ...s, physicalInventories: s.physicalInventories.map((pi) => (pi.id === cancelTarget.id ? { ...pi, status: "cancelado", cancelReason, cancelledBy: currentUser.name, cancelledAt: nowStamp() } : pi)) }));
    audit("Inventario físico", `Canceló el inventario ${cancelTarget.folio} — motivo: ${cancelReason}`);
    setCancelTarget(null); setCancelReason("");
  };

  const [showRecalcConfirm, setShowRecalcConfirm] = useState(false);
  const doRecalcFolios = () => {
    if (!branchId) return;
    const folioById = recalcBranchFolios(state, branchId);
    mutate((s) => ({ ...s, physicalInventories: s.physicalInventories.map((pi) => (folioById[pi.id] ? { ...pi, folio: folioById[pi.id] } : pi)) }));
    audit("Inventario físico", `Recalculó los folios de los inventarios de ${state.branches.find((b) => b.id === branchId)?.name}`);
    setShowRecalcConfirm(false);
  };

  const exportRows = list.map((pi) => ({
    Folio: pi.folio, Fecha: fmtDate(pi.date), Tipo: INV_TYPES[pi.type] || "Inventario Físico",
    Sucursal: state.branches.find((b) => b.id === pi.branchId)?.name || "—",
    Responsable: (pi.responsibles || [pi.registeredBy]).filter(Boolean).join(", "),
    Estado: pi.status === "cancelado" ? "Cancelado" : isInventoryOpen(pi) ? "En proceso" : "Finalizado",
    "Faltantes (pz)": pi.faltantes ?? "—", "Impacto neto": pi.impactoNeto != null ? fmtMoney(pi.impactoNeto) : "—",
  }));

  if (openInventory) {
    return isInventoryOpen(openInventory)
      ? <InventoryCaptureView state={state} mutate={mutate} inventory={openInventory} currentUser={currentUser} audit={audit} onClose={() => setOpenId(null)} />
      : <InventoryDetailView state={state} mutate={mutate} currentUser={currentUser} audit={audit} inventory={openInventory} onClose={() => setOpenId(null)} />;
  }

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <ExportBar rows={exportRows} label="inventarios físicos" />
            <TextInput placeholder="Buscar por folio…" value={folioSearch} onChange={(e) => setFolioSearch(e.target.value)} style={{ width: 180 }} />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {isGeneral && branchId && <Btn small variant="secondary" icon={CheckCircle2} onClick={() => setShowRecalcConfirm(true)}>Recalcular folios de esta sucursal</Btn>}
            <Btn icon={Plus} onClick={() => setShowCreate(true)} disabled={!branchId}>Nuevo inventario</Btn>
          </div>
        </div>
        {!branchId && <div style={{ color: T.red, fontSize: 12.5, fontWeight: 600, marginTop: 6 }}>Selecciona una sucursal para crear un inventario.</div>}
      </Card>
      <Card style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Folio</Th><Th>Fecha</Th><Th>Tipo</Th><Th>Sucursal</Th><Th>Responsable(s)</Th><Th>Estado</Th><Th></Th></tr></thead>
          <tbody>
            {list.map((pi) => (
              <tr key={pi.id}>
                <Td mono>{pi.folio}</Td><Td>{fmtDate(pi.date)}</Td><Td>{INV_TYPES[pi.type] || "Inventario Físico"}</Td>
                <Td>{state.branches.find((b) => b.id === pi.branchId)?.name || "—"}</Td>
                <Td>{(pi.responsibles || [pi.registeredBy]).filter(Boolean).join(", ") || "—"}</Td>
                <Td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><InvStatusPill pi={pi} />{pi.requiresAuthorization && !pi.authorized && <Pill bg="#FDE6D2" fg={T.orange}>Requiere autorización</Pill>}</div></Td>
                <Td>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn small variant="secondary" onClick={() => setOpenId(pi.id)}>{isInventoryOpen(pi) ? "Continuar" : "Ver detalle"}</Btn>
                    {isGeneral && pi.status !== "cancelado" && <Btn small variant="danger" onClick={() => setCancelTarget(pi)}>Cancelar</Btn>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <EmptyState text="No hay inventarios físicos registrados." />}
      </Card>
      {showCreate && <InventoryCreateModal state={state} branchId={branchId} currentUser={currentUser} onCreate={createInventory} onClose={() => setShowCreate(false)} />}
      {showRecalcConfirm && (
        <Modal title="Recalcular folios de esta sucursal" onClose={() => setShowRecalcConfirm(false)} width={420}>
          <p style={{ fontSize: 13, color: T.gray500, marginTop: 0 }}>Esto vuelve a numerar el folio de <b>todos</b> los inventarios de {state.branches.find((b) => b.id === branchId)?.name}, en el orden en que se crearon, usando el prefijo actual de la sucursal. No cambia ningún otro dato (cantidades, diferencias, ajustes) — solo la etiqueta del folio.</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn variant="ghost" onClick={() => setShowRecalcConfirm(false)}>Cancelar</Btn>
            <Btn icon={CheckCircle2} onClick={doRecalcFolios}>Sí, recalcular folios</Btn>
          </div>
        </Modal>
      )}
      {cancelTarget && (
        <Modal title={`Cancelar inventario ${cancelTarget.folio}`} onClose={() => setCancelTarget(null)} width={400}>
          <p style={{ fontSize: 13, color: T.gray500, marginTop: 0 }}>El inventario se conserva en el historial, solo cambia su estado.</p>
          <Field label="Motivo de la cancelación"><TextArea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <Btn variant="ghost" onClick={() => setCancelTarget(null)}>Volver</Btn>
            <Btn variant="danger" disabled={!cancelReason.trim()} onClick={doCancel}>Confirmar cancelación</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============================== ALERTAS DE CADUCIDAD ============================== */
function ExpiryAlertsView({ state, mutate, branches, activeBranchId, currentUser, audit }) {
  const [levelFilter, setLevelFilter] = useState("all");
  const branchId = currentUser.role === "branch_admin" ? currentUser.branchId : activeBranchId;
  const lots = state.lots.filter((l) => l.status === "active" && l.expirationDate && (!branchId || l.branchId === branchId) && l.remainingPieces > 0)
    .map((l) => ({ ...l, level: semaphoreLevel(l.expirationDate, state.config) }))
    .filter((l) => levelFilter === "all" || l.level === levelFilter)
    .sort((a, b) => a.expirationDate.localeCompare(b.expirationDate));

  const registerMerma = (lot) => {
    const qty = lot.remainingPieces;
    mutate((s) => ({
      ...s,
      lots: s.lots.map((l) => (l.id === lot.id ? { ...l, remainingPieces: 0, status: "merma" } : l)),
      mermas: [...s.mermas, {
        id: uid("merma"), lotId: lot.id, productId: lot.productId, branchId: lot.branchId,
        date: todayISO(), quantity: qty, unit: "Piezas",
        unitCost: lot.costPerUnit, totalCost: qty * lot.costPerUnit,
        classification: "caducidad", reason: "Producto caducado (semáforo de alertas)",
        responsible: currentUser.name, observations: "", photoEvidence: null,
        status: "active", createdBy: currentUser.name, createdAt: nowStamp(),
      }],
    }));
    audit("Alertas de caducidad", `Registró merma de ${qty} pz — ${state.products.find((p) => p.id === lot.productId)?.name}`);
  };

  const exportRows = lots.map((l) => ({
    Producto: state.products.find((p) => p.id === l.productId)?.name || "—",
    Sucursal: state.branches.find((b) => b.id === l.branchId)?.name || "—",
    Caducidad: fmtDate(l.expirationDate), Semáforo: SEM_META[l.level].label, "Piezas restantes": l.remainingPieces,
  }));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["all", "red", "orange", "yellow", "expired"].map((l) => (
            <button key={l} onClick={() => setLevelFilter(l)} style={{ border: `1.5px solid ${levelFilter === l ? T.green700 : T.border}`, background: levelFilter === l ? T.green100 : "#fff", borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              {l === "all" ? "Todos" : SEM_META[l].label}
            </button>
          ))}
        </div>
        <ExportBar rows={exportRows} label="alertas de caducidad" />
      </div>
      <Card style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Producto</Th><Th>Sucursal</Th><Th>Caducidad</Th><Th>Semáforo</Th><Th>Piezas restantes</Th><Th></Th></tr></thead>
          <tbody>
            {lots.map((l) => (
              <tr key={l.id}>
                <Td><b>{state.products.find((p) => p.id === l.productId)?.name}</b></Td>
                <Td>{state.branches.find((b) => b.id === l.branchId)?.name}</Td>
                <Td>{fmtDate(l.expirationDate)}</Td>
                <Td><SemPill dateStr={l.expirationDate} cfg={state.config} /></Td>
                <Td>{l.remainingPieces}</Td>
                <Td>{l.level === "expired" && <Btn small variant="danger" onClick={() => registerMerma(l)}>Registrar merma</Btn>}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lots.length && <EmptyState text="No hay lotes en este filtro." />}
      </Card>
    </div>
  );
}

/* ============================== MERMAS ============================== */
function MermaForm({ state, branches, forcedBranchId, onSave, onClose }) {
  const products = state.products.filter((p) => p.status === "active");
  const [f, setF] = useState({
    productId: products[0]?.id || "", branchId: forcedBranchId || branches[0]?.id || "",
    date: todayISO(), quantity: 0, unit: "Piezas",
    classification: "caducidad", reason: "", observations: "", photoEvidence: null,
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const onPhoto = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = () => set("photoEvidence", reader.result); reader.readAsDataURL(file);
  };

  const qty = clampNum(f.quantity);
  const availableStock = theoreticalStock(state.lots, f.productId, f.branchId);
  const costCalc = computeFEFOCost(state.lots, f.productId, f.branchId, qty);
  const exceedsStock = qty > availableStock;
  const valid = f.productId && f.branchId && qty > 0 && f.classification && f.reason.trim() && availableStock > 0;

  return (
    <Modal title="Registrar merma" onClose={onClose} width={620}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: forcedBranchId ? "1fr 1fr" : "1fr 1fr 1fr", gap: 10 }}>
          <Field label="Producto">
            <Select value={f.productId} onChange={(e) => set("productId", e.target.value)}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          {!forcedBranchId && (
            <Field label="Sucursal">
              <Select value={f.branchId} onChange={(e) => set("branchId", e.target.value)}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Fecha"><TextInput type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Field label="Cantidad" hint={`Disponible en inventario: ${availableStock}`}>
            <TextInput type="number" min="0" value={f.quantity} onChange={(e) => set("quantity", clampNum(e.target.value))} />
          </Field>
          <Field label="Unidad de medida">
            <Select value={f.unit} onChange={(e) => set("unit", e.target.value)}>
              {MERMA_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </Field>
          <Field label="Costo unitario" hint="Calculado del inventario, no editable">
            <div style={{ ...inputStyle, background: T.cream, color: T.gray500, display: "flex", alignItems: "center" }}>{fmtMoney(costCalc.unitCost)}</div>
          </Field>
        </div>
        {exceedsStock && availableStock > 0 && (
          <div style={{ fontSize: 12, color: T.orange, fontWeight: 600 }}>Solo hay {availableStock} {f.unit} disponibles — se registrará la merma sobre esa cantidad, no sobre {qty}.</div>
        )}
        {availableStock <= 0 && <div style={{ fontSize: 12, color: T.red, fontWeight: 600 }}>Este producto no tiene existencia en esta sucursal — no se puede registrar una merma.</div>}
        <div style={{ textAlign: "right", fontSize: 13, color: T.gray500 }}>Costo total de la merma: <b style={{ color: T.ink }}>{fmtMoney(costCalc.totalCost)}</b></div>
        <Field label="Clasificación">
          <Select value={f.classification} onChange={(e) => set("classification", e.target.value)}>
            {Object.entries(MERMA_CLASS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Motivo de la merma"><TextInput value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Ej. golpeado en transporte, refrigerador descompuesto…" /></Field>
        <Field label="Observaciones (opcional)"><TextArea rows={2} value={f.observations} onChange={(e) => set("observations", e.target.value)} /></Field>
        <Field label="Evidencia fotográfica (opcional)">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {f.photoEvidence ? <img src={f.photoEvidence} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover" }} /> : <div style={{ width: 56, height: 56, borderRadius: 8, background: T.green100, display: "flex", alignItems: "center", justifyContent: "center" }}><ImageIcon size={18} color={T.green700} /></div>}
            <input type="file" accept="image/*" onChange={onPhoto} style={{ fontSize: 12 }} />
          </div>
        </Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn disabled={!valid} icon={CheckCircle2} onClick={() => onSave({ ...f, quantity: qty })}>Guardar merma</Btn>
        </div>
      </div>
    </Modal>
  );
}

function MermaClassPill({ classification }) {
  const map = { caducidad: [T.gray300, T.expired], mal_estado: ["#FDE6D2", T.orange], produccion: [T.green100, T.green700] };
  const [bg, fg] = map[classification] || [T.gray300, T.gray500];
  return <Pill bg={bg} fg={fg}>{MERMA_CLASS[classification] || classification}</Pill>;
}

function MermaStandardCard({ status }) {
  const meta = MERMA_ESTADO_META[status.estado];
  return (
    <Card style={{ borderTop: `3px solid ${meta.fg}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: T.gray500, fontWeight: 700, textTransform: "uppercase" }}>{status.branchName} · periodo {fmtDate(status.start)} – {fmtDate(status.end)}</div>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 22, fontWeight: 700, color: T.ink, marginTop: 2 }}>
            {status.realPercent.toFixed(1)}% real {status.standard != null && <span style={{ fontSize: 13, fontWeight: 400, color: T.gray500 }}> · máximo {status.standard}%</span>}
          </div>
        </div>
        <Pill bg={meta.bg} fg={meta.fg}>{meta.label}</Pill>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginTop: 12, fontSize: 12.5 }}>
        <div><div style={{ color: T.gray500 }}>Valor de mermas</div><b>{fmtMoney(status.valorMermas)}</b></div>
        <div><div style={{ color: T.gray500 }}>Valor de compras</div><b>{fmtMoney(status.valorCompras)}</b></div>
        {status.standard != null && <div><div style={{ color: T.gray500 }}>Diferencia vs. estándar</div><b style={{ color: status.realPercent > status.standard ? T.red : T.ink }}>{(status.realPercent - status.standard).toFixed(1)} pp</b></div>}
        {status.estado === "anomala" && <div><div style={{ color: T.gray500 }}>Valor del exceso</div><b style={{ color: T.red }}>{fmtMoney(status.excedente)}</b></div>}
      </div>
      {(status.topProducts.length > 0 || status.topCauses.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
          {status.topProducts.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.gray500, textTransform: "uppercase", marginBottom: 4 }}>Productos con mayor incidencia</div>
              {status.topProducts.map((p, i) => <div key={i} style={{ fontSize: 12.5, display: "flex", justifyContent: "space-between" }}><span>{p.name}</span><b>{fmtMoney(p.cost)}</b></div>)}
            </div>
          )}
          {status.topCauses.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.gray500, textTransform: "uppercase", marginBottom: 4 }}>Principales causas</div>
              {status.topCauses.map((c, i) => <div key={i} style={{ fontSize: 12.5, display: "flex", justifyContent: "space-between" }}><span>{c.name}</span><b>{fmtMoney(c.cost)}</b></div>)}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

const MERMA_PIE_COLORS = [T.expired, T.orange, T.green700];

function MermasCrossAnalysisPanel({ state, branchId }) {
  const period = state.config.mermaPeriod || "mensual";
  const { start, end } = getPeriodRange(period);
  const rows = computeCrossAnalysis(state, branchId, start, end);
  const totals = rows.reduce((acc, r) => ({
    comprado: acc.comprado + r.comprado, consumido: acc.consumido + r.consumido,
    mermaCost: acc.mermaCost + r.mermaCost, existencia: acc.existencia + r.existencia,
  }), { comprado: 0, consumido: 0, mermaCost: 0, existencia: 0 });

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: T.gray500 }}>
          Compara, por producto, el flujo completo: <b style={{ color: T.ink }}>Compras → Consumo → Mermas → Existencia final</b>, para el periodo {MERMA_PERIODS[period].toLowerCase()} actual ({fmtDate(start)} – {fmtDate(end)}).
          El consumo se estima con el costo más reciente de cada producto, ya que el historial de consumo no guarda su propio costo.
        </div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 14, marginBottom: 14 }}>
        <KpiCard label="Comprado" value={fmtMoney(totals.comprado)} accent={T.green700} />
        <KpiCard label="Consumido (estimado)" value={fmtMoney(totals.consumido)} accent={T.green600} />
        <KpiCard label="Mermas" value={fmtMoney(totals.mermaCost)} accent={T.red} />
        <KpiCard label="Existencia final" value={fmtMoney(totals.existencia)} accent={T.yellow600} />
      </div>
      <Card style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Producto</Th><Th>Comprado</Th><Th>Consumido (est.)</Th><Th>Mermas</Th><Th>Existencia final</Th><Th>Diferencia</Th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const diferencia = r.comprado - r.consumido - r.mermaCost - r.existencia;
              return (
                <tr key={r.productId}>
                  <Td><b>{r.name}</b></Td>
                  <Td>{fmtMoney(r.comprado)}</Td>
                  <Td>{fmtMoney(r.consumido)}</Td>
                  <Td>{fmtMoney(r.mermaCost)}</Td>
                  <Td>{fmtMoney(r.existencia)}</Td>
                  <Td><span style={{ color: Math.abs(diferencia) > 1 ? T.orange : T.gray500 }}>{fmtMoney(diferencia)}</span></Td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <EmptyState text="No hay movimientos en este periodo para comparar." />}
      </Card>
    </div>
  );
}

function MermasAnalyticsPanel({ state, isGeneral, branchId }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [fBranch, setFBranch] = useState(branchId || "all");
  const [fProduct, setFProduct] = useState("all");
  const [fClass, setFClass] = useState("all");
  const [fSearch, setFSearch] = useState("");

  const filters = {
    dateFrom: dateFrom || null, dateTo: dateTo || null,
    branchId: fBranch === "all" ? null : fBranch,
    productId: fProduct === "all" ? null : fProduct,
    classification: fClass === "all" ? null : fClass,
    search: fSearch || null,
  };
  const data = computeMermaAnalytics(state, filters);

  const period = state.config.mermaPeriod || "mensual";
  const rankBranches = isGeneral ? state.branches : state.branches.filter((b) => b.id === branchId);
  const ranking = rankBranches.map((b) => {
    const cur = computeMermaStandardStatus(state, b.id, period);
    const prevRange = getPreviousPeriodRange(period);
    const prev = computeMermaStatusForRange(state, b.id, prevRange.start, prevRange.end);
    return { ...cur, prevPercent: prev.realPercent };
  }).sort((a, b) => b.realPercent - a.realPercent);

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Desde"><TextInput type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></Field>
          <Field label="Hasta"><TextInput type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></Field>
          {isGeneral && (
            <Field label="Sucursal">
              <Select value={fBranch} onChange={(e) => setFBranch(e.target.value)}>
                <option value="all">Todas</option>
                {state.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Producto">
            <Select value={fProduct} onChange={(e) => setFProduct(e.target.value)}>
              <option value="all">Todos</option>
              {state.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Clasificación">
            <Select value={fClass} onChange={(e) => setFClass(e.target.value)}>
              <option value="all">Todas</option>
              {Object.entries(MERMA_CLASS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Buscar en motivo"><TextInput value={fSearch} onChange={(e) => setFSearch(e.target.value)} placeholder="Ej. refrigerador" /></Field>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 14 }}>
        <KpiCard label="Merma total (registros)" value={data.totalCount} accent={T.gray500} />
        <KpiCard label="Costo total de mermas" value={fmtMoney(data.totalCost)} accent={T.red} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card>
          <h4 style={{ margin: "0 0 10px", fontFamily: "'Space Grotesk',sans-serif" }}>Evolución de mermas por periodo</h4>
          {data.evolucion.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.evolucion}><CartesianGrid strokeDasharray="3 3" stroke={T.border} /><XAxis dataKey="mes" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => fmtMoney(v)} /><Line type="monotone" dataKey="costo" stroke={T.red} strokeWidth={2.5} dot={{ r: 3 }} /></LineChart>
            </ResponsiveContainer>
          ) : <EmptyState text="No hay mermas en este filtro para graficar." />}
        </Card>
        <Card>
          <h4 style={{ margin: "0 0 10px", fontFamily: "'Space Grotesk',sans-serif" }}>Merma por categoría</h4>
          {data.porCategoria.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart><Pie data={data.porCategoria} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80}>{data.porCategoria.map((d, i) => <Cell key={i} fill={MERMA_PIE_COLORS[i % MERMA_PIE_COLORS.length]} />)}</Pie><Tooltip formatter={(v) => fmtMoney(v)} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart>
            </ResponsiveContainer>
          ) : <EmptyState text="Sin datos." />}
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card>
          <h4 style={{ margin: "0 0 10px", fontFamily: "'Space Grotesk',sans-serif" }}>Merma por sucursal</h4>
          {data.porSucursal.some((r) => r.costo > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.porSucursal}><CartesianGrid strokeDasharray="3 3" stroke={T.border} /><XAxis dataKey="sucursal" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => fmtMoney(v)} /><Bar dataKey="costo" fill={T.red} radius={[6, 6, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          ) : <EmptyState text="Sin datos." />}
        </Card>
        <Card>
          <h4 style={{ margin: "0 0 10px", fontFamily: "'Space Grotesk',sans-serif" }}>Productos con mayor pérdida económica</h4>
          {data.porProducto.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.porProducto} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke={T.border} /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="producto" width={90} tick={{ fontSize: 10 }} /><Tooltip formatter={(v) => fmtMoney(v)} /><Bar dataKey="costo" fill={T.orange} radius={[0, 6, 6, 0]} /></BarChart>
            </ResponsiveContainer>
          ) : <EmptyState text="Sin datos." />}
        </Card>
      </div>

      <Card style={{ padding: 0, overflow: "auto" }}>
        <div style={{ padding: "14px 16px 0" }}>
          <h4 style={{ margin: 0, fontFamily: "'Space Grotesk',sans-serif" }}>Ranking entre sucursales — periodo {MERMA_PERIODS[period]}</h4>
          <div style={{ fontSize: 11.5, color: T.gray500 }}>Ordenado de mayor a menor % de merma real.</div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
          <thead><tr><Th>Sucursal</Th><Th>% real</Th><Th>Estándar</Th><Th>Estado</Th><Th>Costo de mermas</Th><Th>Periodo anterior</Th><Th>Evolución</Th></tr></thead>
          <tbody>
            {ranking.map((r) => {
              const delta = r.realPercent - r.prevPercent;
              return (
                <tr key={r.branchId}>
                  <Td><b>{r.branchName}</b></Td>
                  <Td>{r.realPercent.toFixed(1)}%</Td>
                  <Td>{r.standard != null ? `${r.standard}%` : "—"}</Td>
                  <Td><Pill bg={MERMA_ESTADO_META[r.estado].bg} fg={MERMA_ESTADO_META[r.estado].fg}>{MERMA_ESTADO_META[r.estado].label}</Pill></Td>
                  <Td>{fmtMoney(r.valorMermas)}</Td>
                  <Td>{r.prevPercent.toFixed(1)}%</Td>
                  <Td><span style={{ color: delta > 0 ? T.red : delta < 0 ? T.green700 : T.gray500, fontWeight: 700 }}>{delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} {Math.abs(delta).toFixed(1)} pp</span></Td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!ranking.length && <EmptyState text="No hay sucursales para comparar." />}
      </Card>
    </div>
  );
}

function MermasView({ state, mutate, branches, activeBranchId, currentUser, audit }) {
  const isGeneral = currentUser.role === "general_admin";
  const branchId = isGeneral ? activeBranchId : currentUser.branchId;
  const [showForm, setShowForm] = useState(false);
  const [classFilter, setClassFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [evidenceView, setEvidenceView] = useState(null);

  const list = state.mermas
    .filter((m) => !branchId || m.branchId === branchId)
    .filter((m) => classFilter === "all" || m.classification === classFilter)
    .filter((m) => statusFilter === "all" || (statusFilter === "active" ? m.status === "active" : m.status === statusFilter))
    .sort((a, b) => b.date.localeCompare(a.date));

  const createMerma = (f) => {
    const costCalc = computeFEFOCost(state.lots, f.productId, f.branchId, f.quantity);
    const threshold = state.config.mermaApprovalThreshold;
    const needsApproval = !isGeneral && threshold != null && threshold > 0 && costCalc.totalCost >= threshold;
    mutate((s) => ({
      ...s,
      lots: deductFromLots(s.lots, f.productId, f.branchId, f.quantity),
      mermas: [...s.mermas, {
        id: uid("merma"), lotId: null, productId: f.productId, branchId: f.branchId,
        date: f.date, quantity: costCalc.consumed, unit: f.unit, unitCost: costCalc.unitCost, totalCost: costCalc.totalCost,
        classification: f.classification, reason: f.reason, observations: f.observations, photoEvidence: f.photoEvidence,
        responsible: currentUser.name, status: needsApproval ? "pending_approval" : "active",
        createdBy: currentUser.name, createdAt: nowStamp(),
      }],
    }));
    audit("Mermas", `Registró merma de ${costCalc.consumed} ${f.unit} — ${state.products.find((p) => p.id === f.productId)?.name} (${MERMA_CLASS[f.classification]})${needsApproval ? " — pendiente de aprobación" : ""}`);
    setShowForm(false);
  };

  const approveMerma = (m) => {
    mutate((s) => ({ ...s, mermas: s.mermas.map((x) => (x.id === m.id ? { ...x, status: "active", approvedBy: currentUser.name, approvedAt: nowStamp() } : x)) }));
    audit("Mermas", `Aprobó la merma de ${state.products.find((p) => p.id === m.productId)?.name} (${fmtMoney(m.totalCost)})`);
  };

  const rejectMerma = () => {
    mutate((s) => ({
      ...s,
      lots: restoreToLots(s.lots, rejectTarget.productId, rejectTarget.branchId, rejectTarget.quantity),
      mermas: s.mermas.map((m) => (m.id === rejectTarget.id ? { ...m, status: "cancelled", cancelReason: rejectReason, cancelledBy: currentUser.name, cancelledAt: nowStamp() } : m)),
    }));
    audit("Mermas", `Rechazó la merma de ${state.products.find((p) => p.id === rejectTarget.productId)?.name} — motivo: ${rejectReason}`);
    setRejectTarget(null); setRejectReason("");
  };

  const doCancel = () => {
    mutate((s) => ({
      ...s,
      lots: restoreToLots(s.lots, cancelTarget.productId, cancelTarget.branchId, cancelTarget.quantity),
      mermas: s.mermas.map((m) => (m.id === cancelTarget.id ? { ...m, status: "cancelled", cancelReason, cancelledBy: currentUser.name, cancelledAt: nowStamp() } : m)),
    }));
    audit("Mermas", `Canceló la merma de ${state.products.find((p) => p.id === cancelTarget.productId)?.name} — motivo: ${cancelReason}`);
    setCancelTarget(null); setCancelReason("");
  };

  const exportRows = list.map((m) => ({
    Fecha: fmtDate(m.date), Producto: state.products.find((p) => p.id === m.productId)?.name || "—",
    Sucursal: state.branches.find((b) => b.id === m.branchId)?.name || "—",
    Clasificación: MERMA_CLASS[m.classification] || m.classification, Cantidad: m.quantity, Unidad: m.unit,
    "Costo total": fmtMoney(m.totalCost), Motivo: m.reason, Responsable: m.responsible,
    Estado: m.status === "cancelled" ? "Cancelada" : "Activa",
  }));

  const totalCostShown = list.filter((m) => m.status !== "cancelled").reduce((s, m) => s + m.totalCost, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <ExportBar rows={exportRows} label="mermas" />
          <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="all">Todas las clasificaciones</option>
            {Object.entries(MERMA_CLASS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Todos los estados</option>
            <option value="active">Activas</option>
            <option value="pending_approval">Pendientes de aprobación</option>
            <option value="cancelled">Canceladas</option>
          </Select>
        </div>
        <Btn icon={Plus} onClick={() => setShowForm(true)}>Registrar merma</Btn>
      </div>
      <Card style={{ marginBottom: 14, borderTop: `3px solid ${T.red}` }}>
        <div style={{ fontSize: 11.5, color: T.gray500, fontWeight: 700, textTransform: "uppercase" }}>Costo total de mermas (filtro actual)</div>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 24, fontWeight: 700, color: T.ink }}>{fmtMoney(totalCostShown)}</div>
      </Card>
      <Card style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Fecha</Th><Th>Producto</Th><Th>Sucursal</Th><Th>Clasificación</Th><Th>Cantidad</Th><Th>Costo total</Th><Th>Responsable</Th><Th>Estado</Th><Th></Th></tr></thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <Td>{fmtDate(m.date)}</Td>
                <Td><b>{state.products.find((p) => p.id === m.productId)?.name || "—"}</b></Td>
                <Td>{state.branches.find((b) => b.id === m.branchId)?.name || "—"}</Td>
                <Td><MermaClassPill classification={m.classification} /></Td>
                <Td>{m.quantity} {m.unit}</Td>
                <Td>{fmtMoney(m.totalCost)}</Td>
                <Td>{m.responsible}</Td>
                <Td><StatusPill status={m.status === "cancelled" ? "cancelled" : m.status === "pending_approval" ? "pending_approval" : "active"} /></Td>
                <Td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {m.photoEvidence && <Btn small variant="ghost" onClick={() => setEvidenceView(m.photoEvidence)}>Ver foto</Btn>}
                    {m.status === "pending_approval" && isGeneral && <Btn small variant="secondary" onClick={() => approveMerma(m)}>Aprobar</Btn>}
                    {m.status === "pending_approval" && isGeneral && <Btn small variant="danger" onClick={() => setRejectTarget(m)}>Rechazar</Btn>}
                    {m.status !== "cancelled" && m.status !== "pending_approval" && (isGeneral || !m.approvedBy) && <Btn small variant="danger" onClick={() => setCancelTarget(m)}>Cancelar</Btn>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <EmptyState text="No hay mermas registradas para este filtro." />}
      </Card>
      {showForm && (
        <MermaForm state={state} branches={branches} forcedBranchId={isGeneral ? null : currentUser.branchId} onSave={createMerma} onClose={() => setShowForm(false)} />
      )}
      {cancelTarget && (
        <Modal title="Cancelar merma" onClose={() => setCancelTarget(null)} width={400}>
          <p style={{ fontSize: 13, color: T.gray500, marginTop: 0 }}>Esto restituye {cancelTarget.quantity} {cancelTarget.unit} al inventario y conserva el registro original para auditoría — no se elimina.</p>
          <Field label="Motivo de la cancelación"><TextArea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <Btn variant="ghost" onClick={() => setCancelTarget(null)}>Volver</Btn>
            <Btn variant="danger" disabled={!cancelReason.trim()} onClick={doCancel}>Confirmar cancelación</Btn>
          </div>
        </Modal>
      )}
      {rejectTarget && (
        <Modal title="Rechazar merma" onClose={() => setRejectTarget(null)} width={400}>
          <p style={{ fontSize: 13, color: T.gray500, marginTop: 0 }}>Esto restituye {rejectTarget.quantity} {rejectTarget.unit} al inventario y conserva el registro original para auditoría — no se elimina.</p>
          <Field label="Motivo del rechazo"><TextArea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} /></Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <Btn variant="ghost" onClick={() => setRejectTarget(null)}>Volver</Btn>
            <Btn variant="danger" disabled={!rejectReason.trim()} onClick={rejectMerma}>Confirmar rechazo</Btn>
          </div>
        </Modal>
      )}
      {evidenceView && (
        <Modal title="Evidencia fotográfica" onClose={() => setEvidenceView(null)} width={480}>
          <img src={evidenceView} alt="Evidencia de merma" style={{ width: "100%", borderRadius: 10 }} />
        </Modal>
      )}
    </div>
  );
}

/* ============================== PEDIDOS SUGERIDOS ============================== */
function SuggestedOrdersView({ state, branches, activeBranchId, currentUser }) {
  const branchId = currentUser.role === "branch_admin" ? currentUser.branchId : activeBranchId;
  const targetBranches = branchId ? branches.filter((b) => b.id === branchId) : branches;
  const exportRows = targetBranches.flatMap((b) => computeSuggestedOrders(state, b.id).map((o) => ({
    Sucursal: b.name, Proveedor: state.suppliers.find((s) => s.id === o.supplierId)?.name || "—",
    Producto: o.productName, "Stock actual": o.currentStock, "Stock ideal": o.idealStock,
    "Piezas a pedir": o.neededPieces, "Paquetes a pedir": o.neededPackages,
  })));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "flex-end" }}>
        <ExportBar rows={exportRows} label="pedidos sugeridos" />
      </div>
      {targetBranches.map((b) => {
        const orders = computeSuggestedOrders(state, b.id);
        const bySupplier = {};
        orders.forEach((o) => { bySupplier[o.supplierId] = bySupplier[o.supplierId] || []; bySupplier[o.supplierId].push(o); });
        return (
          <Card key={b.id}>
            <h4 style={{ margin: "0 0 10px", fontFamily: "'Space Grotesk',sans-serif" }}>{b.name}</h4>
            {Object.keys(bySupplier).length ? Object.entries(bySupplier).map(([supId, items]) => (
              <div key={supId} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.green700, marginBottom: 4 }}>{state.suppliers.find((s) => s.id === supId)?.name}</div>
                <table style={{ width: "100%", fontSize: 12.5 }}>
                  <thead><tr><Th>Producto</Th><Th>Stock actual</Th><Th>Stock ideal</Th><Th>Piezas a pedir</Th><Th>Paquetes a pedir</Th></tr></thead>
                  <tbody>{items.map((o) => <tr key={o.productId}><Td>{o.productName}</Td><Td>{o.currentStock}</Td><Td>{o.idealStock}</Td><Td><b>{o.neededPieces}</b></Td><Td><b>{o.neededPackages}</b></Td></tr>)}</tbody>
                </table>
              </div>
            )) : <EmptyState text="No hay pedidos sugeridos: el stock cubre el ideal en todos los productos." />}
          </Card>
        );
      })}
    </div>
  );
}

/* ============================== REPORTES ============================== */
const REPORT_TYPES = [
  "Existencias actuales", "Productos próximos a caducar", "Mermas por caducidad", "Facturas pendientes de pago",
  "Facturas pagadas", "Consumo por sucursal", "Compras por proveedor", "Comparativo de consumo entre sucursales",
  "Historial de pedidos sugeridos", "Comparativo de inventario físico", "Impacto de inventario físico", "Histórico de inventarios físicos",
];
function ReportsView({ state, branches }) {
  const [type, setType] = useState(REPORT_TYPES[0]);
  const [branchFilter, setBranchFilter] = useState("all");

  let rows = [];
  let summary = null;
  if (type === "Existencias actuales") {
    rows = state.products.filter((p) => p.status === "active").flatMap((p) => branches.filter((b) => branchFilter === "all" || b.id === branchFilter).map((b) => {
      const existencia = theoreticalStock(state.lots, p.id, b.id);
      const costoUnitario = weightedUnitCost(state.lots, p.id, b.id);
      return { Producto: p.name, Categoría: p.category || "—", Sucursal: b.name, "Existencia actual": existencia, "Unidad de medida": "Piezas", "Costo unitario": fmtMoney(costoUnitario), "Costo total": fmtMoney(existencia * costoUnitario) };
    }));
    const existRows = state.products.filter((p) => p.status === "active").flatMap((p) => branches.filter((b) => branchFilter === "all" || b.id === branchFilter).map((b) => ({ qty: theoreticalStock(state.lots, p.id, b.id), cost: weightedUnitCost(state.lots, p.id, b.id) })));
    summary = [
      { label: "Productos activos", value: state.products.filter((p) => p.status === "active").length },
      { label: "Valor total del inventario", value: fmtMoney(existRows.reduce((s, r) => s + r.qty * r.cost, 0)) },
      { label: "Con existencia", value: existRows.filter((r) => r.qty > 0).length },
      { label: "Sin existencia / crítica (≤5 pz)", value: existRows.filter((r) => r.qty <= 5).length },
    ];
  } else if (type === "Productos próximos a caducar") {
    rows = state.lots.filter((l) => l.status === "active" && l.expirationDate && l.remainingPieces > 0 && (branchFilter === "all" || l.branchId === branchFilter) && ["yellow", "orange", "red"].includes(semaphoreLevel(l.expirationDate, state.config)))
      .map((l) => ({ Producto: state.products.find((p) => p.id === l.productId)?.name, Sucursal: state.branches.find((b) => b.id === l.branchId)?.name, Caducidad: fmtDate(l.expirationDate), Piezas: l.remainingPieces, Nivel: SEM_META[semaphoreLevel(l.expirationDate, state.config)].label }));
  } else if (type === "Mermas por caducidad") {
    rows = state.mermas.filter((m) => (branchFilter === "all" || m.branchId === branchFilter) && m.status !== "cancelled").map((m) => ({ Producto: state.products.find((p) => p.id === m.productId)?.name, Sucursal: state.branches.find((b) => b.id === m.branchId)?.name, Fecha: fmtDate(m.date), Clasificación: MERMA_CLASS[m.classification] || m.classification, Cantidad: m.quantity, Unidad: m.unit, "Costo total": fmtMoney(m.totalCost), Responsable: m.responsible }));
  } else if (type === "Facturas pendientes de pago" || type === "Facturas pagadas") {
    const st = type === "Facturas pagadas" ? "paid" : "pending";
    rows = state.invoices.filter((i) => i.status === st && (branchFilter === "all" || i.branchId === branchFilter)).map((i) => ({ Factura: i.invoiceNumber, Proveedor: state.suppliers.find((s) => s.id === i.supplierId)?.name, Sucursal: state.branches.find((b) => b.id === i.branchId)?.name, Ingreso: fmtDate(i.entryDate), Total: fmtMoney(i.total) }));
  } else if (type === "Consumo por sucursal" || type === "Comparativo de consumo entre sucursales") {
    rows = state.branches.filter((b) => branchFilter === "all" || b.id === branchFilter).map((b) => ({ Sucursal: b.name, "Consumo total (pz)": state.physicalInventories.filter((pi) => pi.branchId === b.id && isInventoryFinal(pi)).flatMap((pi) => pi.consumption).reduce((s, c) => s + c.consumedPieces, 0), "Inventarios realizados": state.physicalInventories.filter((pi) => pi.branchId === b.id && isInventoryFinal(pi)).length }));
  } else if (type === "Compras por proveedor") {
    rows = state.suppliers.map((s) => ({ Proveedor: s.name, "Total comprado": fmtMoney(state.invoices.filter((i) => i.supplierId === s.id && i.status !== "cancelled" && (branchFilter === "all" || i.branchId === branchFilter)).reduce((sum, i) => sum + i.total, 0)) }));
  } else if (type === "Historial de pedidos sugeridos") {
    rows = state.physicalInventories.filter((pi) => branchFilter === "all" || pi.branchId === branchFilter).flatMap((pi) => pi.suggestedOrder.map((o) => ({ Folio: pi.folio, Fecha: fmtDate(pi.date), Sucursal: state.branches.find((b) => b.id === pi.branchId)?.name, Producto: o.productName, "Piezas sugeridas": o.neededPieces })));
  } else if (type === "Comparativo de inventario físico") {
    const invs = state.physicalInventories.filter((pi) => isInventoryFinal(pi) && (branchFilter === "all" || pi.branchId === branchFilter));
    rows = invs.flatMap((pi) => (pi.counts || []).filter((c) => c.theoretical != null).map((c) => ({
      Folio: pi.folio, Sucursal: state.branches.find((b) => b.id === pi.branchId)?.name || "—", Producto: state.products.find((p) => p.id === c.productId)?.name || "—",
      "Existencia teórica": c.theoretical, "Existencia física": c.total, Diferencia: c.difference, "Costo unitario": fmtMoney(c.unitCost || 0), "Costo de la diferencia": fmtMoney(c.diffCost || 0), "% Variación": `${(c.diffPercent || 0).toFixed(1)}%`,
    })));
  } else if (type === "Impacto de inventario físico") {
    const invs = state.physicalInventories.filter((pi) => isInventoryFinal(pi) && (branchFilter === "all" || pi.branchId === branchFilter) && pi.faltantes != null);
    rows = invs.map((pi) => ({
      Folio: pi.folio, Fecha: fmtDate(pi.date), Sucursal: state.branches.find((b) => b.id === pi.branchId)?.name || "—",
      "Faltantes (pz)": pi.faltantes, "Sobrantes (pz)": pi.sobrantes, "Valor de faltantes": fmtMoney(pi.valorFaltantes), "Valor de sobrantes": fmtMoney(pi.valorSobrantes),
      "Diferencia económica neta": fmtMoney(pi.impactoNeto), "Ajustes generados": (state.inventoryAdjustments || []).filter((a) => a.inventoryId === pi.id).length,
    }));
    summary = [
      { label: "Inventarios con impacto", value: invs.length },
      { label: "Valor de faltantes", value: fmtMoney(invs.reduce((s, pi) => s + (pi.valorFaltantes || 0), 0)) },
      { label: "Valor de sobrantes", value: fmtMoney(invs.reduce((s, pi) => s + (pi.valorSobrantes || 0), 0)) },
      { label: "Diferencia económica neta", value: fmtMoney(invs.reduce((s, pi) => s + (pi.impactoNeto || 0), 0)) },
    ];
  } else if (type === "Histórico de inventarios físicos") {
    rows = state.physicalInventories.filter((pi) => branchFilter === "all" || pi.branchId === branchFilter)
      .sort((a, b) => (b.createdAt?.date || b.date).localeCompare(a.createdAt?.date || a.date))
      .map((pi) => ({
        Folio: pi.folio, Fecha: fmtDate(pi.date), Tipo: INV_TYPES[pi.type] || "Inventario Físico", Sucursal: state.branches.find((b) => b.id === pi.branchId)?.name || "—",
        Responsable: (pi.responsibles || [pi.registeredBy]).filter(Boolean).join(", "), "Productos contados": (pi.counts || []).length,
        Diferencias: (pi.counts || []).filter((c) => c.difference).length, "Impacto económico": pi.impactoNeto != null ? fmtMoney(pi.impactoNeto) : "—",
        "Ajustes generados": (state.inventoryAdjustments || []).filter((a) => a.inventoryId === pi.id).length,
        Estado: pi.status === "cancelado" ? "Cancelado" : isInventoryOpen(pi) ? "En proceso" : "Finalizado",
      }));
  }

  return (
    <div>
      <div className="no-print" style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <Select value={type} onChange={(e) => setType(e.target.value)}>{REPORT_TYPES.map((r) => <option key={r}>{r}</option>)}</Select>
        <Select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
          <option value="all">Todas las sucursales</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <ExportBar rows={rows} label={type} />
      </div>
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 14 }}>
          {summary.map((s, i) => <KpiCard key={i} label={s.label} value={s.value} accent={i % 2 === 0 ? T.green700 : T.orange} />)}
        </div>
      )}
      <Card style={{ padding: 0, overflow: "auto" }}>
        <div style={{ padding: "14px 16px 0" }}>
          <h4 style={{ margin: 0, fontFamily: "'Space Grotesk',sans-serif" }}>{type}</h4>
          <div style={{ fontSize: 11.5, color: T.gray500 }}>Generado {fmtDate(todayISO())} · {rows.length} registros</div>
        </div>
        {rows.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
            <thead><tr>{Object.keys(rows[0]).map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <Td key={j}>{v}</Td>)}</tr>)}</tbody>
          </table>
        ) : <EmptyState text="Sin datos para este reporte y filtro." />}
      </Card>
    </div>
  );
}

/* ============================== BITÁCORA ============================== */
function AuditLogView({ state }) {
  const [q, setQ] = useState("");
  const rows = [...state.auditLog].reverse().filter((r) => (r.user + r.module + r.action).toLowerCase().includes(q.toLowerCase()));
  const exportRows = rows.map((r) => ({ Fecha: r.date, Hora: r.time, Usuario: r.user, Rol: r.role, Módulo: r.module, Acción: r.action }));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <TextInput placeholder="Buscar en bitácora…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        <ExportBar rows={exportRows} label="bitácora" />
      </div>
      <Card style={{ padding: 0, overflow: "auto", maxHeight: 560 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Fecha</Th><Th>Hora</Th><Th>Usuario</Th><Th>Rol</Th><Th>Módulo</Th><Th>Acción</Th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><Td>{r.date}</Td><Td mono>{r.time}</Td><Td>{r.user}</Td><Td>{r.role}</Td><Td>{r.module}</Td><Td>{r.action}</Td></tr>)}</tbody>
        </table>
        {!rows.length && <EmptyState text="Sin actividad registrada." />}
      </Card>
    </div>
  );
}

/* ============================== CONFIGURACIÓN ============================== */
function ConfigView({ state, mutate, audit, onReset }) {
  const [cfg, setCfg] = useState(state.config);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [restoreFile, setRestoreFile] = useState(null);
  const [restoreError, setRestoreError] = useState("");
  const fileInputRef = useRef(null);
  const save = () => { mutate((s) => ({ ...s, config: cfg })); audit("Configuración", "Actualizó los parámetros generales del sistema"); };

  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `subgestor-respaldo-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    audit("Configuración", "Descargó un respaldo completo de los datos");
  };

  const onPickFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    setRestoreError("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed.users) || !Array.isArray(parsed.branches) || !Array.isArray(parsed.products)) {
          setRestoreError("Este archivo no parece un respaldo válido de SubGestor.");
          return;
        }
        setRestoreFile(parsed);
      } catch (e2) { setRestoreError("No se pudo leer el archivo — asegúrate de que sea el .json exportado desde aquí mismo."); }
    };
    reader.readAsText(file);
  };

  const doRestore = () => {
    mutate(() => restoreFile);
    audit("Configuración", "Restauró los datos desde un archivo de respaldo");
    setRestoreFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Semáforo — días para alerta amarilla"><TextInput type="number" value={cfg.alertYellow} onChange={(e) => setCfg({ ...cfg, alertYellow: clampNum(e.target.value) })} /></Field>
          <Field label="Semáforo — días para alerta naranja"><TextInput type="number" value={cfg.alertOrange} onChange={(e) => setCfg({ ...cfg, alertOrange: clampNum(e.target.value) })} /></Field>
          <Field label="Semáforo — días para alerta roja"><TextInput type="number" value={cfg.alertRed} onChange={(e) => setCfg({ ...cfg, alertRed: clampNum(e.target.value) })} /></Field>
          <Field label="Minutos de inactividad antes de cerrar sesión"><TextInput type="number" value={cfg.sessionTimeoutMin} onChange={(e) => setCfg({ ...cfg, sessionTimeoutMin: clampNum(e.target.value) })} /></Field>
          <Field label="Frecuencia recomendada de inventario físico">
            <Select value={cfg.inventoryFrequency} onChange={(e) => setCfg({ ...cfg, inventoryFrequency: e.target.value })}>
              <option value="diario">Diaria</option><option value="semanal">Semanal</option><option value="mensual">Mensual</option><option value="extraordinario">Extraordinaria</option>
            </Select>
          </Field>
          <Field label="Límite de tolerancia para diferencias de inventario (%)" hint="Por debajo de este % la diferencia se marca como 'menor'; por encima, como 'significativa'.">
            <TextInput type="number" min="0" step="0.1" value={cfg.inventoryToleranceLimit ?? 5} onChange={(e) => setCfg({ ...cfg, inventoryToleranceLimit: clampNum(e.target.value) })} />
          </Field>
          <Field label="Periodo de análisis del estándar de mermas" hint="El estándar por sucursal se define en cada sucursal (módulo Sucursales).">
            <Select value={cfg.mermaPeriod || "mensual"} onChange={(e) => setCfg({ ...cfg, mermaPeriod: e.target.value })}>
              {Object.entries(MERMA_PERIODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Monto que requiere autorización del Administrador General" hint="Mermas de una sucursal iguales o mayores a este monto quedan pendientes de aprobación. Déjalo vacío para no requerir autorización.">
            <TextInput type="number" min="0" step="0.01" value={cfg.mermaApprovalThreshold ?? ""} onChange={(e) => setCfg({ ...cfg, mermaApprovalThreshold: e.target.value === "" ? null : clampNum(e.target.value) })} />
          </Field>
          <Btn icon={CheckCircle2} onClick={save}>Guardar configuración</Btn>
        </div>
      </Card>
      <Card style={{ borderTop: `3px solid ${T.green700}` }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.green700, marginBottom: 4 }}>Respaldo de datos</div>
        <p style={{ fontSize: 12, color: T.gray500, marginTop: 0 }}>Descarga una copia completa de todos los datos (productos, facturas, inventarios, usuarios, todo) en un archivo. Guárdalo en un lugar seguro — recomendamos hacerlo periódicamente, ya que este plan no genera respaldos automáticos.</p>
        <Btn variant="secondary" icon={Download} onClick={downloadBackup}>Descargar respaldo completo</Btn>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: T.ink, marginBottom: 6 }}>Restaurar desde un respaldo</div>
          <input ref={fileInputRef} type="file" accept="application/json" onChange={onPickFile} style={{ fontSize: 12 }} />
          {restoreError && <div style={{ color: T.red, fontSize: 12, marginTop: 6 }}>{restoreError}</div>}
        </div>
      </Card>
      <Card style={{ borderTop: `3px solid ${T.red}` }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.red, marginBottom: 4 }}>Zona de riesgo</div>
        <p style={{ fontSize: 12, color: T.gray500, marginTop: 0 }}>Borra todos los datos compartidos (productos, proveedores, facturas, inventarios, usuarios) y restaura la configuración inicial de la prueba.</p>
        <Btn variant="danger" icon={RotateCcw} onClick={() => setConfirmingReset(true)}>Restablecer datos de fábrica</Btn>
      </Card>
      {confirmingReset && (
        <Modal title="Restablecer datos de fábrica" onClose={() => setConfirmingReset(false)} width={400}>
          <p style={{ fontSize: 13, color: T.gray500, marginTop: 0 }}>Esto borrará TODOS los datos compartidos (productos, facturas, inventarios, usuarios) y dejará solo la configuración inicial. Esta acción no se puede deshacer.</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn variant="ghost" onClick={() => setConfirmingReset(false)}>Cancelar</Btn>
            <Btn variant="danger" icon={RotateCcw} onClick={() => { setConfirmingReset(false); onReset(); }}>Restablecer datos</Btn>
          </div>
        </Modal>
      )}
      {restoreFile && (
        <Modal title="Restaurar desde respaldo" onClose={() => { setRestoreFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} width={420}>
          <p style={{ fontSize: 13, color: T.red, fontWeight: 600, marginTop: 0 }}>Esto reemplazará TODOS los datos actuales (productos, facturas, inventarios, usuarios) con lo que hay en el archivo. Lo que exista ahora mismo y no esté en el respaldo se perderá.</p>
          <p style={{ fontSize: 12.5, color: T.gray500 }}>El archivo contiene {restoreFile.branches?.length || 0} sucursal(es), {restoreFile.products?.length || 0} producto(s) e {restoreFile.invoices?.length || 0} factura(s).</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn variant="ghost" onClick={() => { setRestoreFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>Cancelar</Btn>
            <Btn variant="danger" icon={CheckCircle2} onClick={doRestore}>Restaurar este respaldo</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============================== APP ROOT ============================== */
function SubGestorAppInner() {
  const seedRef = useRef(null);
  if (!seedRef.current) seedRef.current = seedState();
  const [state, setState] = useState(seedRef.current);
  const [session, setSession] = useState(null);
  const [view, setView] = useState("dashboard");
  const [activeBranchId, setActiveBranchId] = useState(null);
  const saveTimer = useRef(null);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadState();
        if (cancelled) return;
        if (result.status === "found" && result.data) {
          setState(result.data);
        } else if (result.status === "empty") {
          // Se confirmó que genuinamente no hay datos remotos todavía
          // (primera vez real) — recién ahí es seguro guardar la semilla.
          saveState(seedRef.current);
        } else {
          // Error de conexión: NUNCA se sobrescriben los datos remotos por
          // esto. Se muestra la semilla solo localmente en lo que se puede
          // reintentar (el botón "Actualizar" y el sondeo automático).
          console.error("No se pudo sincronizar con el almacenamiento compartido; no se modificó nada en la nube.");
        }
      } catch (e) {
        console.error("No se pudo sincronizar con el almacenamiento compartido", e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const pendingSave = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const mutate = useCallback((fn) => {
    setState((prev) => {
      const next = fn(prev);
      pendingSave.current = true;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await saveState(next);
        pendingSave.current = false;
      }, 500);
      return next;
    });
  }, []);

  const refreshFromShared = useCallback(async () => {
    if (pendingSave.current) return; // evita pisar un cambio local que aún no se ha guardado
    setSyncing(true);
    try {
      const result = await loadState();
      if (result.status === "found" && result.data) setState(result.data);
    } catch (e) { /* noop */ }
    setSyncing(false);
  }, []);

  useEffect(() => {
    const onFocus = () => refreshFromShared();
    const onVisible = () => { if (document.visibilityState === "visible") refreshFromShared(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(refreshFromShared, 20000);
    let unsubscribe = () => {};
    if (typeof subscribeToChanges === "function") {
      unsubscribe = subscribeToChanges((incoming) => {
        if (!pendingSave.current && incoming) setState(incoming);
      });
    }
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
      unsubscribe();
    };
  }, [refreshFromShared]);

  const audit = useCallback((module, action) => {
    if (!session) return;
    const u = session.user; const { date, time } = nowStamp();
    mutate((s) => ({ ...s, auditLog: [...s.auditLog, { id: uid("log"), user: u.name, role: u.role === "general_admin" ? "Administrador General" : "Administrador de Sucursal", branch: state.branches.find((b) => b.id === u.branchId)?.name || "—", date, time, module, action }] }));
  }, [session, mutate, state]);

  const handleLogin = ({ type, userId }) => {
    if (type === "failed_attempt") {
      mutate((s) => ({
        ...s, users: s.users.map((u) => {
          if (u.id !== userId) return u;
          const attempts = u.failedAttempts + 1;
          return { ...u, failedAttempts: attempts, lockedUntil: attempts >= 5 ? Date.now() + 15 * 60000 : u.lockedUntil };
        }),
      }));
      return;
    }
    const u = state.users.find((x) => x.id === userId);
    const { date, time } = nowStamp();
    mutate((s) => ({ ...s, users: s.users.map((x) => (x.id === userId ? { ...x, failedAttempts: 0, lockedUntil: null, lastLogin: { date, time } } : x)) }));
    setSession({ user: u });
    setActiveBranchId(u.role === "branch_admin" ? u.branchId : null);
    setView("dashboard");
    lastActivity.current = Date.now();
  };
  const handleLogout = () => { audit("Autenticación", "Cerró sesión"); setSession(null); setView("dashboard"); };
  const resetToFactory = async () => {
    const fresh = seedState();
    seedRef.current = fresh;
    setState(fresh);
    await saveState(fresh);
  };

  useEffect(() => {
    if (!session || !state) return;
    const bump = () => (lastActivity.current = Date.now());
    window.addEventListener("mousemove", bump); window.addEventListener("keydown", bump);
    const interval = setInterval(() => {
      if (Date.now() - lastActivity.current > (state.config.sessionTimeoutMin || 30) * 60000) {
        setSession(null);
      }
    }, 15000);
    return () => { window.removeEventListener("mousemove", bump); window.removeEventListener("keydown", bump); clearInterval(interval); };
  }, [session, state]);

  const globalStyle = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap');
      * { box-sizing: border-box; }
      body { margin:0; }
      select { appearance:auto; }
      @keyframes sg-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @media print {
        .no-print { display:none !important; }
        .print-only { display:flex !important; }
        body { background:#fff; }
      }
    `}</style>
  );

  if (!session) return (<div>{globalStyle}<LoginScreen users={state.users} onLogin={handleLogin} onReset={resetToFactory} /></div>);

  const branches = state.branches;
  const viewProps = { state, mutate, branches, activeBranchId, currentUser: session.user, audit };

  let content;
  if (view === "dashboard") content = <DashboardView state={state} activeBranchId={session.user.role === "branch_admin" ? session.user.branchId : activeBranchId} role={session.user.role} currentUser={session.user} branches={branches} />;
  else if (view === "productos") content = <ProductsView {...viewProps} activeBranchId={session.user.role === "branch_admin" ? session.user.branchId : activeBranchId} />;
  else if (view === "proveedores") content = <SuppliersView {...viewProps} />;
  else if (view === "sucursales") content = session.user.role === "general_admin" ? <BranchesView {...viewProps} /> : null;
  else if (view === "usuarios") content = session.user.role === "general_admin" ? <UsersView {...viewProps} /> : null;
  else if (view === "facturas") content = <InvoicesView {...viewProps} />;
  else if (view === "inventario") content = <PhysicalInventoryView {...viewProps} />;
  else if (view === "alertas") content = <ExpiryAlertsView {...viewProps} />;
  else if (view === "mermas") content = <MermasView {...viewProps} />;
  else if (view === "pedidos") content = <SuggestedOrdersView {...viewProps} />;
  else if (view === "bitacora") content = session.user.role === "general_admin" ? <AuditLogView state={state} /> : null;
  else if (view === "config") content = session.user.role === "general_admin" ? <ConfigView {...viewProps} onReset={resetToFactory} /> : null;

  return (
    <div style={{ display: "flex", fontFamily: "'Inter',sans-serif", background: T.cream, minHeight: "100vh" }}>
      {globalStyle}
      <Sidebar view={view} setView={setView} role={session.user.role} onLogout={handleLogout} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <TopBar user={session.user} branches={branches} activeBranchId={activeBranchId} setActiveBranchId={setActiveBranchId} onRefresh={refreshFromShared} syncing={syncing} />
        <div style={{ padding: 24 }}>
          <div className="print-only" style={{ display: "none", alignItems: "center", gap: 10, marginBottom: 16, paddingBottom: 12, borderBottom: `2px solid ${T.green700}` }}>
            <Logo size={30} />
            <div style={{ marginLeft: "auto", textAlign: "right", fontSize: 11, color: T.gray500 }}>
              <div style={{ fontWeight: 700, color: T.ink, fontSize: 13 }}>{MODULES[view]}</div>
              Generado {fmtDate(todayISO())}
            </div>
          </div>
          <div style={{ marginBottom: 18 }} className="no-print">
            <div style={{ fontSize: 11, fontWeight: 700, color: T.gray500, textTransform: "uppercase", letterSpacing: 0.4 }}>{MODULES[view]}</div>
          </div>
          {content}
        </div>
      </div>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleRetry = this.handleRetry.bind(this);
    this.handleResetData = this.handleResetData.bind(this);
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("SubGestor crashed:", error, info); }
  handleRetry() {
    this.setState({ error: null });
    if (this.props.onRetry) this.props.onRetry();
  }
  handleResetData() {
    (async () => {
      try { await deleteState(); } catch (e) { /* noop */ }
      this.handleRetry();
    })();
  }
  render() {
    if (this.state.error) {
      const msg = String((this.state.error && this.state.error.message) || this.state.error);
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: T.cream, fontFamily: "sans-serif", padding: 24 }}>
          <div style={{ maxWidth: 480, background: "#fff", border: `1px solid ${T.border}`, borderRadius: 16, padding: 28 }}>
            <h3 style={{ marginTop: 0, color: T.red }}>SubGestor encontró un error al cargar</h3>
            <p style={{ fontSize: 13, color: T.gray500 }}>Para poder corregirlo, copia este detalle técnico y compártelo:</p>
            <pre style={{ fontSize: 11.5, background: T.cream, padding: 10, borderRadius: 8, overflowX: "auto", whiteSpace: "pre-wrap" }}>{msg}</pre>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={this.handleRetry} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: T.green700, color: "#fff", cursor: "pointer", fontWeight: 600 }}>Reintentar</button>
              <button onClick={this.handleResetData} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${T.red}`, background: "#fff", color: T.red, cursor: "pointer", fontWeight: 600 }}>Borrar datos y reiniciar</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
};

export default function SubGestorApp() {
  const [instanceKey, setInstanceKey] = useState(0);
  return (
    <ErrorBoundary onRetry={() => setInstanceKey((k) => k + 1)}>
      <SubGestorAppInner key={instanceKey} />
    </ErrorBoundary>
  );
}
