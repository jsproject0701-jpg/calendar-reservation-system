// src/main.ts
/* eslint-disable no-console */

/**
 * Tokuyama Street Live Space Reservation (DEMO)
 * - No GAS / No external network
 * - Uses localStorage only
 * - Seed data creates: weekend-open, weekday-closed, full/partial highlights
 * - Modern-ish TS: typed state, no inline onclick, event listeners + delegation
 */

type SlotId = "A" | "B" | "C" | "D";
type ArtistStatus = "approved" | "pending";

type Reservation = {
  id: string;
  dateKey: string; // YYYY-MM-DD
  slotId: SlotId;
  artistId: string;
  artistName: string; // display name
  name: string; // real name
  phone: string;
  lineId: string;
  note?: string;
  createdAt: string; // ISO
};

type Artist = {
  id: string;
  name: string;
  phone: string;
  artist: string; // stage name
  genre?: string;
  instagram?: string;
  tiktok?: string;
  youtube?: string;
  twitter?: string;
  videoUrl?: string;
  videoLineId?: string;
  lineId: string;
  note?: string;
  status: ArtistStatus;
  createdAt: string;
};

type ClosedSlotKey = `${string}_${SlotId}`; // dateKey_slotId

type Store = {
  version: number;
  reservations: Record<string, Reservation>;
  artists: Record<string, Artist>;
  closedSlots: Record<string, true>;
};

const APP = {
  STORE_KEY: "tokuyama-demo-store-v1",
  SEED_DONE_KEY: "tokuyama-demo-seeded-v1",
  VERSION: 1,
  LIMIT_MONTHS_AHEAD: 3,
  // DEMO admin password (do NOT use in production; front-only auth is insecure)
  ADMIN_PASSWORD: "demo-admin",
} as const;

const SLOTS: ReadonlyArray<{ id: SlotId; time: string; label: string }> = [
  { id: "A", time: "17:00〜18:00", label: "1部" },
  { id: "B", time: "18:00〜19:00", label: "2部" },
  { id: "C", time: "19:00〜20:00", label: "3部" },
  { id: "D", time: "20:00〜21:00", label: "4部" },
];

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
] as const;

type TabId = "calendar" | "slots" | "artists" | "reservations";

type SelectedDate = { y: number; m: number; d: number; dow: number };
type UIState = {
  currentYear: number;
  currentMonth: number; // 0-11
  selectedDate: SelectedDate | null;
  selectedSlotId: SlotId | null;
  isAdmin: boolean;
  foundArtistId: string | null;
  pendingConfirm:
    | null
    | { type: "reserve"; reservationDraft: Omit<Reservation, "id" | "createdAt"> }
    | { type: "cancel"; reservationId: string };
};

const ui: UIState = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),
  selectedDate: null,
  selectedSlotId: null,
  isAdmin: false,
  foundArtistId: null,
  pendingConfirm: null,
};

let store: Store = loadStore();

/* ---------------------------
 * DOM helpers
 * --------------------------- */
function $(sel: string): HTMLElement {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el as HTMLElement;
}
function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: #${id}`);
  return el as T;
}

const el = {
  // Tabs & pages
  tabCalendar: byId<HTMLButtonElement>("tabCalendar"),
  tabSlots: byId<HTMLButtonElement>("tabSlots"),
  tabArtists: byId<HTMLButtonElement>("tabArtists"),
  tabReservations: byId<HTMLButtonElement>("tabReservations"),
  pageCalendar: byId<HTMLDivElement>("pageCalendar"),
  pageSlots: byId<HTMLDivElement>("pageSlots"),
  pageArtists: byId<HTMLDivElement>("pageArtists"),
  pageReservations: byId<HTMLDivElement>("pageReservations"),
  pendingBadge: byId<HTMLSpanElement>("pendingBadge"),

  // Header
  adminBtn: byId<HTMLButtonElement>("adminBtn"),

  // Calendar
  calMonthLabel: byId<HTMLDivElement>("calMonthLabel"),
  btnPrevMonth: byId<HTMLButtonElement>("btnPrevMonth"),
  btnNextMonth: byId<HTMLButtonElement>("btnNextMonth"),
  calGrid: byId<HTMLDivElement>("calGrid"),

  // Modal
  modalOverlay: byId<HTMLDivElement>("modalOverlay"),
  modalDateLabel: byId<HTMLDivElement>("modalDateLabel"),
  modalDateSub: byId<HTMLDivElement>("modalDateSub"),
  slotList: byId<HTMLDivElement>("slotList"),
  formSection: byId<HTMLDivElement>("formSection"),

  // Steps
  step1: byId<HTMLDivElement>("step1"),
  step2: byId<HTMLDivElement>("step2"),
  step3: byId<HTMLDivElement>("step3"),
  stepLine1: byId<HTMLDivElement>("stepLine1"),
  stepLine2: byId<HTMLDivElement>("stepLine2"),
  step1Area: byId<HTMLDivElement>("step1Area"),
  step2Area: byId<HTMLDivElement>("step2Area"),

  // Lookup / Found
  lookupInput: byId<HTMLInputElement>("lookupInput"),
  artistFound: byId<HTMLDivElement>("artistFound"),
  artistNotFound: byId<HTMLDivElement>("artistNotFound"),
  foundName: byId<HTMLDivElement>("foundName"),
  foundSub: byId<HTMLDivElement>("foundSub"),
  foundBadge: byId<HTMLDivElement>("foundBadge"),
  btnProceed: byId<HTMLButtonElement>("btnProceed"),

  // New artist form
  newArtistForm: byId<HTMLDivElement>("newArtistForm"),
  pendingInline: byId<HTMLDivElement>("pendingInline"),
  fName: byId<HTMLInputElement>("fName"),
  fPhone: byId<HTMLInputElement>("fPhone"),
  fArtist: byId<HTMLInputElement>("fArtist"),
  fGenre: byId<HTMLInputElement>("fGenre"),
  fInstagram: byId<HTMLInputElement>("fInstagram"),
  fTiktok: byId<HTMLInputElement>("fTiktok"),
  fYoutube: byId<HTMLInputElement>("fYoutube"),
  fTwitter: byId<HTMLInputElement>("fTwitter"),
  fVideoUrl: byId<HTMLInputElement>("fVideoUrl"),
  fVideoLineId: byId<HTMLInputElement>("fVideoLineId"),
  fLineId: byId<HTMLInputElement>("fLineId"),
  fNote: byId<HTMLTextAreaElement>("fNote"),

  // Step2
  step2ArtistName: byId<HTMLDivElement>("step2ArtistName"),
  step2ArtistSub: byId<HTMLDivElement>("step2ArtistSub"),
  fReserveNote: byId<HTMLTextAreaElement>("fReserveNote"),

  // Lists (admin)
  artistList: byId<HTMLDivElement>("artistList"),
  resList: byId<HTMLDivElement>("resList"),

  // Slots management (admin)
  slotMgmtDate: byId<HTMLInputElement>("slotMgmtDate"),
  slotToggleGrid: byId<HTMLDivElement>("slotToggleGrid"),
  periodStart: byId<HTMLInputElement>("periodStart"),
  periodEnd: byId<HTMLInputElement>("periodEnd"),
  periodProgress: byId<HTMLDivElement>("periodProgress"),

  // Overlays
  confirmOverlay: byId<HTMLDivElement>("confirmOverlay"),
  confirmTitle: byId<HTMLDivElement>("confirmTitle"),
  confirmText: byId<HTMLDivElement>("confirmText"),
  confirmYes: byId<HTMLButtonElement>("confirmYes"),
  adminOverlay: byId<HTMLDivElement>("adminOverlay"),
  adminPasswordInput: byId<HTMLInputElement>("adminPasswordInput"),
  adminModalIcon: byId<HTMLDivElement>("adminModalIcon"),
  adminModalTitle: byId<HTMLDivElement>("adminModalTitle"),
  adminModalText: byId<HTMLDivElement>("adminModalText"),

  // Toast / loading
  toast: byId<HTMLDivElement>("toast"),
  loadingOverlay: byId<HTMLDivElement>("loadingOverlay"),
} as const;

/* ---------------------------
 * Date utils
 * --------------------------- */
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function fmtKey(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
function dateOnly(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function getLimitEndDate() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  end.setMonth(end.getMonth() + APP.LIMIT_MONTHS_AHEAD);
  return end; // date-only
}
function limitMaxKey() {
  const end = getLimitEndDate();
  return fmtKey(end.getFullYear(), end.getMonth() + 1, end.getDate());
}
function isTooFutureDate(dateObj: Date) {
  return dateOnly(dateObj) > dateOnly(getLimitEndDate());
}
function isPastDate(dateObj: Date) {
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return dateObj < today;
}

/* ---------------------------
 * Store (localStorage)
 * --------------------------- */
function loadStore(): Store {
  const raw = localStorage.getItem(APP.STORE_KEY);
  if (!raw) {
    return {
      version: APP.VERSION,
      reservations: {},
      artists: {},
      closedSlots: {},
    };
  }
  try {
    const parsed = JSON.parse(raw) as Store;
    // light guard
    if (!parsed || typeof parsed !== "object") throw new Error("bad store");
    return {
      version: APP.VERSION,
      reservations: parsed.reservations ?? {},
      artists: parsed.artists ?? {},
      closedSlots: parsed.closedSlots ?? {},
    };
  } catch {
    return {
      version: APP.VERSION,
      reservations: {},
      artists: {},
      closedSlots: {},
    };
  }
}
function saveStore() {
  localStorage.setItem(APP.STORE_KEY, JSON.stringify(store));
}
function newId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/* ---------------------------
 * UI helpers (toast/loading)
 * --------------------------- */
function showLoading(show: boolean) {
  el.loadingOverlay.classList.toggle("show", show);
}
function showToast(msg: string, type: "" | "success" | "cancel" | "pending" | "error" = "") {
  el.toast.textContent = msg;
  el.toast.className = "toast show" + (type ? " " + type : "");
  window.setTimeout(() => (el.toast.className = "toast"), 3200);
}

/* ---------------------------
 * Seed data (first run)
 * --------------------------- */
function seedIfNeeded() {
  const done = localStorage.getItem(APP.SEED_DONE_KEY);
  if (done) return;

  // Artists (approved/pending mix)
  const a1: Artist = {
    id: "artist_seed_1",
    name: "山田 太郎",
    phone: "090-1234-5678",
    artist: "ソラノオト",
    genre: "Acoustic",
    instagram: "sora.no.oto",
    youtube: "https://www.youtube.com/@soranooto",
    lineId: "@sora_no_oto",
    status: "approved",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 20).toISOString(),
  };
  const a2: Artist = {
    id: "artist_seed_2",
    name: "佐藤 花",
    phone: "080-2222-3333",
    artist: "HANA",
    genre: "Pop",
    tiktok: "@hana_tokuyama",
    lineId: "@hana_tokuyama",
    status: "approved",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
  };
  const a3: Artist = {
    id: "artist_seed_3",
    name: "田中 海斗",
    phone: "070-9999-0000",
    artist: "Kaito Loop",
    genre: "Loop / Beat",
    instagram: "kaito.loop",
    videoUrl: "https://youtu.be/dQw4w9WgXcQ",
    lineId: "@kaito_loop",
    status: "pending",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
  };

  store.artists[a1.id] = a1;
  store.artists[a2.id] = a2;
  store.artists[a3.id] = a3;

  // Closed slots policy:
  // - Mon-Thu: mostly closed (all closed)
  // - Fri: half open
  // - Sat/Sun: open
  // plus some "closed patches" to create dots variation
  const today = dateOnly(new Date());
  const maxEnd = getLimitEndDate();

  const betweenDays: Date[] = [];
  {
    const cur = new Date(today);
    while (cur <= maxEnd) {
      betweenDays.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
  }

  for (const d of betweenDays) {
    const dow = d.getDay();
    const dateKey = fmtKey(d.getFullYear(), d.getMonth() + 1, d.getDate());

    // Mon-Thu: all closed
    if (dow >= 1 && dow <= 4) {
      for (const s of SLOTS) store.closedSlots[`${dateKey}_${s.id}`] = true;
      continue;
    }

    // Fri: open A,B ; close C,D
    if (dow === 5) {
      store.closedSlots[`${dateKey}_C`] = true;
      store.closedSlots[`${dateKey}_D`] = true;
      continue;
    }

    // Sat/Sun: open all by default
    // but make "some closed dots" occasionally
    if (dow === 0 || dow === 6) {
      const day = d.getDate();
      if (day % 3 === 0) store.closedSlots[`${dateKey}_D`] = true; // last slot sometimes closed
      if (day % 5 === 0) store.closedSlots[`${dateKey}_A`] = true; // first slot sometimes closed
    }
  }

  // Seed reservations to force "full" and "partial"
  // Find next Saturday & Sunday within range that are not past
  const next = (targetDow: number, nth: number) => {
    let found: Date | null = null;
    let count = 0;
    for (const d of betweenDays) {
      if (d.getDay() === targetDow && !isPastDate(d)) {
        count++;
        if (count === nth) { found = d; break; }
      }
    }
    return found;
  };

  const sat1 = next(6, 1); // next Saturday
  const sun1 = next(0, 1); // next Sunday
  const sat2 = next(6, 2); // second Saturday

  const makeRes = (date: Date, slotId: SlotId, artist: Artist) => {
    const dateKey = fmtKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const r: Reservation = {
      id: newId("res_seed"),
      dateKey,
      slotId,
      artistId: artist.id,
      artistName: artist.artist,
      name: artist.name,
      phone: artist.phone,
      lineId: artist.lineId,
      note: "（デモ）予約サンプル",
      createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    };
    store.reservations[r.id] = r;
  };

  if (sat1) {
    // FULL day: reserve all open slots (respect closedSlots)
    for (const s of SLOTS) {
      const k: ClosedSlotKey = `${fmtKey(sat1.getFullYear(), sat1.getMonth() + 1, sat1.getDate())}_${s.id}`;
      if (!store.closedSlots[k]) makeRes(sat1, s.id, a1);
    }
  }
  if (sun1) {
    // PARTIAL: reserve 1~2 slots
    makeRes(sun1, "B", a2);
    makeRes(sun1, "C", a1);
  }
  if (sat2) {
    // Another partial: one slot reserved + one slot closed already (visual mix)
    makeRes(sat2, "A", a2);
  }

  saveStore();
  localStorage.setItem(APP.SEED_DONE_KEY, "1");
}

/* ---------------------------
 * Business helpers
 * --------------------------- */
function slotKey(dateKey: string, slotId: SlotId): ClosedSlotKey {
  return `${dateKey}_${slotId}`;
}
function isClosed(dateKey: string, slotId: SlotId): boolean {
  return !!store.closedSlots[slotKey(dateKey, slotId)];
}
function dayReservations(dateKey: string): Reservation[] {
  return Object.values(store.reservations).filter((r) => r.dateKey === dateKey);
}
function isSlotReserved(dateKey: string, slotId: SlotId): boolean {
  return Object.values(store.reservations).some((r) => r.dateKey === dateKey && r.slotId === slotId);
}
function openSlotIds(dateKey: string): SlotId[] {
  return SLOTS.map((s) => s.id).filter((id) => !isClosed(dateKey, id));
}
function approvedArtistOnly(artistId: string | null): artistId is string {
  if (!artistId) return false;
  const a = store.artists[artistId];
  return !!a && a.status === "approved";
}

/* ---------------------------
 * Tabs
 * --------------------------- */
function setAdminUI(isAdmin: boolean) {
  ui.isAdmin = isAdmin;

  // show/hide admin tabs
  const adminTabs = document.querySelectorAll<HTMLElement>(".admin-tab");
  adminTabs.forEach((t) => (t.style.display = isAdmin ? "flex" : "none"));

  el.adminBtn.textContent = isAdmin ? "🔓 管理者" : "🔒 管理者";
  el.adminBtn.style.background = isAdmin ? "rgba(255,255,255,.3)" : "rgba(255,255,255,.15)";

  // If logged out, return to calendar
  if (!isAdmin) switchTab("calendar");
}

function switchTab(tab: TabId) {
  const map: Record<TabId, { page: HTMLElement; tab: HTMLButtonElement }> = {
    calendar: { page: el.pageCalendar, tab: el.tabCalendar },
    slots: { page: el.pageSlots, tab: el.tabSlots },
    artists: { page: el.pageArtists, tab: el.tabArtists },
    reservations: { page: el.pageReservations, tab: el.tabReservations },
  };

  (Object.keys(map) as TabId[]).forEach((t) => {
    map[t].page.style.display = t === tab ? "block" : "none";
    map[t].tab.classList.toggle("active", t === tab);
  });

  if (tab === "artists") renderArtistList();
  if (tab === "reservations") renderReservationsList();
  if (tab === "slots") renderSlotMgmt();
}

/* ---------------------------
 * Calendar rendering
 * --------------------------- */
function renderCalendar() {
  el.calMonthLabel.textContent = `${ui.currentYear}年 ${ui.currentMonth + 1}月`;

  const now = new Date();
  const minMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const maxEnd = getLimitEndDate();
  const maxMonth = new Date(maxEnd.getFullYear(), maxEnd.getMonth(), 1);
  const curMonthDate = new Date(ui.currentYear, ui.currentMonth, 1);

  el.btnPrevMonth.disabled = curMonthDate <= minMonth;
  el.btnNextMonth.disabled = curMonthDate >= maxMonth;

  el.calGrid.innerHTML = "";
  const firstDay = new Date(ui.currentYear, ui.currentMonth, 1).getDay();
  const daysInMonth = new Date(ui.currentYear, ui.currentMonth + 1, 0).getDate();
  const today = new Date();

  for (let i = 0; i < firstDay; i++) {
    const e = document.createElement("div");
    e.className = "cal-day empty";
    el.calGrid.appendChild(e);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(ui.currentYear, ui.currentMonth, d);
    const dateKey = fmtKey(ui.currentYear, ui.currentMonth + 1, d);
    const dow = date.getDay();

    const isPast = isPastDate(date);
    const isToday = date.toDateString() === today.toDateString();
    const tooFuture = isTooFutureDate(date);

    const openSlots = openSlotIds(dateKey);
    const allClosed = openSlots.length === 0;

    // reserved count only on open slots
    const reservedOpen = dayReservations(dateKey).filter((r) => !isClosed(dateKey, r.slotId)).length;
    const isFull = !isPast && !allClosed && reservedOpen >= openSlots.length;

    let cls = "cal-day";
    if (isPast) cls += " past";
    if (isToday) cls += " today";
    if (dow === 0) cls += " sun";
    if (dow === 6) cls += " sat";
    if (tooFuture) cls += " too-future";
    else if (!isPast && allClosed) cls += " closed";
    else if (isFull) cls += " full";

    const cell = document.createElement("div");
    cell.className = cls;

    const dots = SLOTS.map((s) => {
      const c = isClosed(dateKey, s.id)
        ? " closed-dot"
        : isSlotReserved(dateKey, s.id)
          ? " booked"
          : "";
      return `<div class="slot-dot${c}"></div>`;
    }).join("");

    cell.innerHTML = `<div class="day-num">${d}</div><div class="slot-dots">${dots}</div>`;

    const clickable = !isPast && !allClosed && !tooFuture;
    if (clickable) {
      cell.addEventListener("click", () => openModal(ui.currentYear, ui.currentMonth + 1, d, dow));
    }

    el.calGrid.appendChild(cell);
  }
}

function changeMonth(delta: number) {
  const cand = new Date(ui.currentYear, ui.currentMonth + delta, 1);

  const now = new Date();
  const min = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = getLimitEndDate();
  const max = new Date(end.getFullYear(), end.getMonth(), 1);

  if (cand < min || cand > max) return;

  ui.currentYear = cand.getFullYear();
  ui.currentMonth = cand.getMonth();
  renderCalendar();
}

/* ---------------------------
 * Modal & Form
 * --------------------------- */
function openModal(y: number, m: number, d: number, dow: number) {
  const dateObj = new Date(y, m - 1, d);
  if (isTooFutureDate(dateObj)) {
    showToast("⚠️ 予約は3ヶ月先までです", "error");
    return;
  }

  ui.selectedDate = { y, m, d, dow };
  ui.selectedSlotId = null;
  ui.foundArtistId = null;

  el.modalDateLabel.textContent = `${y}年${m}月${d}日（${WEEKDAYS[dow]}）`;
  el.modalDateSub.textContent = MONTHS[m - 1];
  renderModalSlots(fmtKey(y, m, d));
  closeForm();
  el.modalOverlay.classList.add("show");
}

function closeModal() {
  el.modalOverlay.classList.remove("show");
  closeForm();
}

function renderModalSlots(dateKey: string) {
  el.slotList.innerHTML = "";
  const dayRess = dayReservations(dateKey);

  SLOTS.forEach((slot) => {
    const reserved = dayRess.find((r) => r.slotId === slot.id);
    const closed = isClosed(dateKey, slot.id);

    // ✅ 予約が入った枠は一覧から外す（演出が映える）
    if (reserved) return;

    const item = document.createElement("div");
    const isSelected = ui.selectedSlotId === slot.id;

    item.className =
      "slot-item" +
      (closed ? " closed-slot" : "") +
      (isSelected ? " selected-slot" : "");

    item.innerHTML = `
      <div class="slot-time">${slot.time}</div>
      <div class="slot-info">
        <div class="slot-label">${closed ? "クローズ" : slot.label}</div>
        <div class="slot-sublabel">${closed ? "—" : "空き枠"}</div>
      </div>
    `;

    const btn = document.createElement("button");
    btn.className = "slot-action-btn ";

    if (closed) {
      btn.className += "btn-disabled";
      btn.textContent = "受付停止中";
      btn.type = "button";
    } else {
      btn.className += "btn-reserve";
      btn.textContent = "予約する";
      btn.type = "button";
      btn.addEventListener("click", () => openForm(slot.id));
    }

    item.appendChild(btn);
    el.slotList.appendChild(item);
  });

  // If all slots are hidden (all reserved/closed), show hint
  if (el.slotList.children.length === 0) {
    const empty = document.createElement("div");
    empty.className = "no-data";
    empty.textContent = "この日は予約可能な枠がありません（満枠またはクローズ）";
    el.slotList.appendChild(empty);
  }
}

function openForm(slotId: SlotId) {
  ui.selectedSlotId = slotId;

  // rerender to apply orange highlight
  if (ui.selectedDate) {
    renderModalSlots(fmtKey(ui.selectedDate.y, ui.selectedDate.m, ui.selectedDate.d));
  }

  resetFormUI();
  el.formSection.classList.add("show");
  setTimeout(() => el.formSection.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
}

function closeForm() {
  el.formSection.classList.remove("show");
  ui.selectedSlotId = null;
  ui.foundArtistId = null;
}

function setStep(n: 1 | 2 | 3) {
  const steps = [el.step1, el.step2, el.step3];
  steps.forEach((s) => s.classList.remove("active", "done"));
  if (n >= 2) el.step1.classList.add("done");
  if (n >= 3) el.step2.classList.add("done");
  steps[n - 1].classList.add("active");

  el.stepLine1.classList.toggle("done", n >= 2);
  el.stepLine2.classList.toggle("done", n >= 3);
}

function resetFormUI() {
  setStep(1);
  el.lookupInput.value = "";
  el.artistFound.classList.remove("show");
  el.artistNotFound.classList.remove("show");
  el.pendingInline.classList.remove("show");

  el.step1Area.style.display = "block";
  el.step2Area.style.display = "none";

  ui.foundArtistId = null;

  el.btnProceed.disabled = false;
  el.btnProceed.textContent = "次へ → 予約情報を入力";

  // reset inputs
  const ids: (HTMLInputElement | HTMLTextAreaElement)[] = [
    el.fName, el.fPhone, el.fArtist, el.fGenre,
    el.fInstagram, el.fTiktok, el.fYoutube, el.fTwitter,
    el.fVideoUrl, el.fVideoLineId, el.fLineId,
    el.fNote, el.fReserveNote,
  ];
  ids.forEach((i) => (i.value = ""));

  // reset SNS wraps (visual)
  ["instagram","tiktok","youtube","twitter"].forEach((p) => {
    const w = document.getElementById("snsWrap_" + p);
    w?.classList.remove("has-value");
  });
  byId<HTMLDivElement>("videoOptionUrl").classList.remove("selected");
  byId<HTMLDivElement>("videoOptionLine").classList.remove("selected");

  // enable fields
  el.newArtistForm.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("input,textarea,button")
    .forEach((x) => (x.disabled = false));
}

function onSnsInput(platform: "instagram" | "tiktok" | "youtube" | "twitter") {
  const inputId = ("f" + platform.charAt(0).toUpperCase() + platform.slice(1)) as
    | "fInstagram" | "fTiktok" | "fYoutube" | "fTwitter";
  const v = (el as any)[inputId].value.trim() as string;
  byId<HTMLDivElement>("snsWrap_" + platform).classList.toggle("has-value", v !== "");
}
function onVideoInput() {
  byId<HTMLDivElement>("videoOptionUrl").classList.toggle("selected", el.fVideoUrl.value.trim() !== "");
  byId<HTMLDivElement>("videoOptionLine").classList.toggle("selected", el.fVideoLineId.value.trim() !== "");
}

/* ---------------------------
 * Lookup -> Approved only can proceed
 * --------------------------- */
function lookupArtist() {
  const q = el.lookupInput.value.trim().toLowerCase();
  if (!q) return;

  const normalizePhone = (p: string) => p.replace(/-/g, "");
  const qPhone = normalizePhone(q);

  const found = Object.values(store.artists).find((a) => {
    const phoneHit = normalizePhone(a.phone).includes(qPhone);
    const nameHit = a.name.toLowerCase().includes(q);
    const artistHit = (a.artist ?? "").toLowerCase().includes(q);
    return phoneHit || nameHit || artistHit;
  });

  el.artistFound.classList.remove("show");
  el.artistNotFound.classList.remove("show");
  ui.foundArtistId = null;

  if (!found) {
    el.artistNotFound.classList.add("show");
    return;
  }

  ui.foundArtistId = found.id;
  el.foundName.textContent = `${found.artist || found.name}（${found.name}）`;
  el.foundSub.textContent = `${found.phone}${found.genre ? "　" + found.genre : ""}`;

  if (found.status === "approved") {
    el.foundBadge.textContent = "✅ 承認済み";
    el.foundBadge.className = "artist-found-badge";
    el.btnProceed.disabled = false;
    el.btnProceed.textContent = "次へ → 予約情報を入力";
  } else {
    el.foundBadge.textContent = "⏳ 審査中";
    el.foundBadge.className = "artist-found-badge pending-badge";
    el.btnProceed.disabled = true;
    el.btnProceed.textContent = "⏳ 審査完了後に予約できます";
  }

  el.artistFound.classList.add("show");
}

function proceedToStep2() {
  if (!approvedArtistOnly(ui.foundArtistId)) return;

  const a = store.artists[ui.foundArtistId];
  setStep(2);
  el.step2ArtistName.textContent = `${a.artist || a.name}（${a.name}）`;
  el.step2ArtistSub.textContent = `${a.phone}${a.genre ? "　" + a.genre : ""}`;

  el.step1Area.style.display = "none";
  el.step2Area.style.display = "block";
}

function backToStep1() {
  setStep(1);
  el.step1Area.style.display = "block";
  el.step2Area.style.display = "none";
}

/* ---------------------------
 * New artist submit (pending)
 * --------------------------- */
function submitNewArtist() {
  const name = el.fName.value.trim();
  const phone = el.fPhone.value.trim();
  const artist = el.fArtist.value.trim();
  const lineId = el.fLineId.value.trim();

  const instagram = el.fInstagram.value.trim();
  const tiktok = el.fTiktok.value.trim();
  const youtube = el.fYoutube.value.trim();
  const twitter = el.fTwitter.value.trim();

  const videoUrl = el.fVideoUrl.value.trim();
  const videoLineId = el.fVideoLineId.value.trim();

  if (!name || !phone) { showToast("⚠️ お名前と電話番号は必須です", "error"); return; }
  if (!artist) { showToast("⚠️ アーティスト名は必須です", "error"); return; }
  if (!lineId) { showToast("⚠️ LINE IDは必須です（予約確定通知用）", "error"); return; }
  if (!instagram && !tiktok && !youtube && !twitter) { showToast("⚠️ SNSアカウントを1つ以上入力してください", "error"); return; }
  if (!videoUrl && !videoLineId) { showToast("⚠️ 動画URLまたはLINE IDを入力してください", "error"); return; }

  const id = newId("artist");
  const newArtist: Artist = {
    id,
    name,
    phone,
    artist,
    genre: el.fGenre.value.trim() || undefined,
    instagram: instagram || undefined,
    tiktok: tiktok || undefined,
    youtube: youtube || undefined,
    twitter: twitter || undefined,
    videoUrl: videoUrl || undefined,
    videoLineId: videoLineId || undefined,
    lineId,
    note: el.fNote.value.trim() || undefined,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  store.artists[id] = newArtist;
  saveStore();
  updatePendingBadge();

  el.pendingInline.classList.add("show");
  el.newArtistForm.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("input,textarea,button")
    .forEach((x) => (x.disabled = true));
  showToast("📨 審査申請を受け付けました！（DEMO）", "pending");
}

/* ---------------------------
 * Reservation submit (DEMO) + confirmation modal
 * --------------------------- */
function submitReservationRequest() {
  if (!approvedArtistOnly(ui.foundArtistId)) return;
  if (!ui.selectedDate || !ui.selectedSlotId) { showToast("⚠️ 日付と枠を選択してください", "error"); return; }

  const dateObj = new Date(ui.selectedDate.y, ui.selectedDate.m - 1, ui.selectedDate.d);
  if (isTooFutureDate(dateObj)) { showToast("⚠️ 予約は3ヶ月先までです", "error"); return; }

  const dateKey = fmtKey(ui.selectedDate.y, ui.selectedDate.m, ui.selectedDate.d);
  const slotId = ui.selectedSlotId;

  if (isClosed(dateKey, slotId)) { showToast("⚠️ その枠はクローズ中です", "error"); return; }
  if (isSlotReserved(dateKey, slotId)) { showToast("⚠️ その枠はすでに予約済みです", "error"); return; }

  const a = store.artists[ui.foundArtistId];
  const note = el.fReserveNote.value.trim();

  const draft: Omit<Reservation, "id" | "createdAt"> = {
    dateKey,
    slotId,
    artistId: a.id,
    artistName: a.artist || a.name,
    name: a.name,
    phone: a.phone,
    lineId: a.lineId,
    note: note || undefined,
  };

  ui.pendingConfirm = { type: "reserve", reservationDraft: draft };

  const slot = SLOTS.find((s) => s.id === slotId)!;
  openConfirm(
    "予約を確定しますか？（DEMO）",
    `📅 ${ui.selectedDate.y}年${ui.selectedDate.m}月${ui.selectedDate.d}日\n⏰ ${slot.time}（${slot.label}）\n🎤 ${draft.artistName}\n\n※ デモ版：localStorageにのみ保存されます`,
    "予約する",
    () => finalizeReservation()
  );
}

function finalizeReservation() {
  if (!ui.pendingConfirm || ui.pendingConfirm.type !== "reserve") return;
  const draft = ui.pendingConfirm.reservationDraft;

  const id = newId("res");
  const res: Reservation = {
    id,
    ...draft,
    createdAt: new Date().toISOString(),
  };
  store.reservations[id] = res;
  saveStore();

  closeConfirm();

  setStep(3);
  showToast("✅ 予約が完了しました！（DEMO）", "success");

  // Refresh
  if (ui.selectedDate) {
    const dateKey = fmtKey(ui.selectedDate.y, ui.selectedDate.m, ui.selectedDate.d);
    renderModalSlots(dateKey);
  }
  renderCalendar();

  // Close modal after a short beat to show step3
  setTimeout(() => closeModal(), 450);
}

/* ---------------------------
 * Cancel reservation (admin list)
 * --------------------------- */
function requestCancelReservation(resId: string) {
  const r = store.reservations[resId];
  if (!r) return;
  const slot = SLOTS.find((s) => s.id === r.slotId)!;
  const [y, m, d] = r.dateKey.split("-").map((x) => parseInt(x, 10));

  ui.pendingConfirm = { type: "cancel", reservationId: resId };
  openConfirm(
    "予約をキャンセルしますか？（DEMO）",
    `${r.artistName} 様の\n「${y}/${m}/${d} ${slot.time}」をキャンセルします。\nこの操作は取り消せません。`,
    "キャンセルする",
    () => finalizeCancel()
  );
}

function finalizeCancel() {
  if (!ui.pendingConfirm || ui.pendingConfirm.type !== "cancel") return;
  const id = ui.pendingConfirm.reservationId;
  delete store.reservations[id];
  saveStore();
  closeConfirm();
  renderCalendar();
  renderReservationsList();
  showToast("🗑️ 予約をキャンセルしました（DEMO）", "cancel");
}

/* ---------------------------
 * Confirm overlay
 * --------------------------- */
function openConfirm(title: string, text: string, yesLabel: string, onYes: () => void) {
  el.confirmTitle.textContent = title;
  el.confirmText.textContent = text;
  el.confirmYes.textContent = yesLabel;
  el.confirmYes.onclick = () => onYes();
  el.confirmOverlay.classList.add("show");
}
function closeConfirm() {
  el.confirmOverlay.classList.remove("show");
  ui.pendingConfirm = null;
}

/* ---------------------------
 * Admin login
 * --------------------------- */
function openAdminLogin() {
  el.adminPasswordInput.value = "";
  el.adminModalIcon.textContent = "🔐";
  el.adminModalTitle.textContent = "管理者ログイン";
  el.adminModalText.textContent = "パスワードを入力してください（DEMO: demo-admin）";
  el.adminPasswordInput.style.borderColor = "var(--sky-mid)";
  el.adminOverlay.classList.add("show");
  setTimeout(() => el.adminPasswordInput.focus(), 80);
}
function closeAdminLogin() {
  el.adminOverlay.classList.remove("show");
}
function submitAdminLogin() {
  const pw = el.adminPasswordInput.value;
  if (pw === APP.ADMIN_PASSWORD) {
    closeAdminLogin();
    setAdminUI(true);
    showToast("🔓 管理者としてログインしました（DEMO）", "success");
  } else {
    el.adminPasswordInput.style.borderColor = "var(--red)";
    el.adminModalIcon.textContent = "❌";
    el.adminModalTitle.textContent = "パスワードが違います";
    el.adminModalText.textContent = "もう一度入力してください";
    el.adminPasswordInput.value = "";
    el.adminPasswordInput.focus();
  }
}

/* ---------------------------
 * Admin: Artists list (approve/reject)
 * --------------------------- */
function updatePendingBadge() {
  const n = Object.values(store.artists).filter((a) => a.status === "pending").length;
  el.pendingBadge.textContent = String(n);
  el.pendingBadge.style.display = n > 0 ? "inline-flex" : "none";
}

function renderArtistList() {
  const sorted = Object.values(store.artists).sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  if (!sorted.length) {
    el.artistList.innerHTML = `<div class="no-data">登録アーティストはまだいません</div>`;
    return;
  }

  el.artistList.innerHTML = "";
  for (const a of sorted) {
    const card = document.createElement("div");
    card.className = "artist-card" + (a.status === "pending" ? " pending-card" : "");
    const initial = (a.artist || a.name).charAt(0);

    const sns: string[] = [];
    if (a.instagram) sns.push(`📸@${a.instagram}`);
    if (a.tiktok) sns.push(`🎵TikTok`);
    if (a.youtube) sns.push(`▶️YouTube`);
    if (a.twitter) sns.push(`𝕏${a.twitter}`);

    const vInfo = a.videoUrl ? "🎬動画URL有" : a.videoLineId ? "💬動画LINE有" : "";
    const sub = [a.phone, `💬LINE:${a.lineId || "—"}`, ...sns, vInfo, a.genre].filter(Boolean).join("　");

    const actions =
      a.status === "pending"
        ? `<div class="artist-actions">
            <button class="btn-approve" type="button" data-action="approve" data-id="${a.id}">✅ 承認</button>
            <button class="btn-reject" type="button" data-action="reject" data-id="${a.id}">✗ 却下</button>
          </div>`
        : `<div class="status-approved">✅ 承認済み</div>`;

    card.innerHTML = `
      <div class="artist-avatar">${initial}</div>
      <div class="artist-card-info">
        <div class="artist-card-name">${a.artist || a.name}${a.artist ? `（${a.name}）` : ""}</div>
        <div class="artist-card-sub">${sub}</div>
      </div>
      ${actions}
    `;
    el.artistList.appendChild(card);
  }
}

function approveArtist(id: string) {
  const a = store.artists[id];
  if (!a) return;
  a.status = "approved";
  store.artists[id] = a;
  saveStore();
  updatePendingBadge();
  renderArtistList();
  showToast(`✅ ${a.artist || a.name} を承認しました（DEMO）`, "success");
}

function rejectArtist(id: string) {
  const a = store.artists[id];
  if (!a) return;
  // soft confirm
  ui.pendingConfirm = null;
  openConfirm(
    "却下して削除しますか？（DEMO）",
    `「${a.artist || a.name}」を却下・削除します。`,
    "削除する",
    () => {
      delete store.artists[id];
      saveStore();
      closeConfirm();
      updatePendingBadge();
      renderArtistList();
      showToast("🗑️ 却下しました（DEMO）", "cancel");
    }
  );
}

/* ---------------------------
 * Admin: Reservations list
 * --------------------------- */
function renderReservationsList() {
  const sorted = Object.values(store.reservations).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  if (!sorted.length) {
    el.resList.innerHTML = `<div class="no-data">現在の予約はありません</div>`;
    return;
  }

  el.resList.innerHTML = "";
  for (const r of sorted) {
    const slot = SLOTS.find((s) => s.id === r.slotId)!;
    const [y, m, d] = r.dateKey.split("-");
    const item = document.createElement("div");
    item.className = "res-item";
    item.innerHTML = `
      <span class="res-date">${parseInt(m, 10)}/${parseInt(d, 10)}</span>
      <span class="res-time">${slot.time}</span>
      <span class="res-name">${escapeHtml(r.artistName || r.name)}</span>
      <button class="res-cancel-btn" type="button" data-action="cancel-res" data-id="${r.id}">キャンセル</button>
    `;
    el.resList.appendChild(item);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}

/* ---------------------------
 * Admin: Slot management
 * --------------------------- */
function enforceDateInputsMax() {
  const maxKey = limitMaxKey();
  el.slotMgmtDate.max = maxKey;
  el.periodStart.max = maxKey;
  el.periodEnd.max = maxKey;

  // default values
  const now = new Date();
  const todayKey = fmtKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
  el.slotMgmtDate.value = el.slotMgmtDate.value || todayKey;
}

function renderSlotMgmt() {
  enforceDateInputsMax();
  const dateVal = el.slotMgmtDate.value;
  if (!dateVal) return;

  if (dateVal > limitMaxKey()) {
    showToast("⚠️ 枠管理は3ヶ月先までしか設定できません", "error");
    el.slotMgmtDate.value = limitMaxKey();
  }

  const dateKey = el.slotMgmtDate.value;
  el.slotToggleGrid.innerHTML = "";

  for (const slot of SLOTS) {
    const closed = isClosed(dateKey, slot.id);
    const card = document.createElement("div");
    card.className = "slot-toggle-card" + (closed ? " closed-card" : "");
    card.innerHTML = `
      <div class="slot-toggle-time">${slot.time}</div>
      <div class="slot-toggle-label">${slot.label}</div>
      <button class="slot-toggle-btn ${closed ? "btn-open" : "btn-close"}" type="button"
        data-action="toggle-slot" data-date="${dateKey}" data-slot="${slot.id}">
        ${closed ? "✅ オープンにする" : "🚫 クローズにする"}
      </button>
    `;
    el.slotToggleGrid.appendChild(card);
  }
}

function toggleSlot(dateKey: string, slotId: SlotId) {
  if (dateKey > limitMaxKey()) {
    showToast("⚠️ 3ヶ月先までしか操作できません", "error");
    return;
  }
  const k = slotKey(dateKey, slotId);
  const willClose = !store.closedSlots[k];
  if (willClose) store.closedSlots[k] = true;
  else delete store.closedSlots[k];
  saveStore();

  renderSlotMgmt();
  renderCalendar();
  showToast(willClose ? "🚫 クローズしました（DEMO）" : "✅ オープンにしました（DEMO）", willClose ? "cancel" : "success");
}

function bulkOpen(dateKey: string) {
  if (dateKey > limitMaxKey()) { showToast("⚠️ 3ヶ月先までしか操作できません", "error"); return; }
  for (const s of SLOTS) {
    delete store.closedSlots[slotKey(dateKey, s.id)];
  }
  saveStore();
  renderSlotMgmt();
  renderCalendar();
  showToast("✅ 全枠をオープンにしました（DEMO）", "success");
}
function bulkClose(dateKey: string) {
  if (dateKey > limitMaxKey()) { showToast("⚠️ 3ヶ月先までしか操作できません", "error"); return; }
  for (const s of SLOTS) {
    store.closedSlots[slotKey(dateKey, s.id)] = true;
  }
  saveStore();
  renderSlotMgmt();
  renderCalendar();
  showToast("🚫 全枠をクローズしました（DEMO）", "cancel");
}

async function periodBulk(isClose: boolean) {
  const startVal = el.periodStart.value;
  const endVal = el.periodEnd.value;
  const maxKey = limitMaxKey();

  if (!startVal || !endVal) { showToast("⚠️ 開始日と終了日を入力してください", "error"); return; }
  if (startVal > endVal) { showToast("⚠️ 終了日は開始日より後にしてください", "error"); return; }
  if (startVal > maxKey || endVal > maxKey) { showToast("⚠️ 期間一括は3ヶ月先までしか設定できません", "error"); return; }

  const checkedDows = Array.from(document.querySelectorAll<HTMLInputElement>(".period-dow-grid input:checked"))
    .map((x) => parseInt(x.value, 10));
  const targetDows = checkedDows.length ? checkedDows : [0,1,2,3,4,5,6];

  const checkedSlots = Array.from(document.querySelectorAll<HTMLInputElement>(".period-slot-grid input:checked"))
    .map((x) => x.value as SlotId);
  const targetSlots = checkedSlots.length ? checkedSlots : SLOTS.map((s) => s.id);

  const dates: string[] = [];
  const cur = new Date(startVal);
  const end = new Date(endVal);

  while (cur <= end) {
    if (targetDows.includes(cur.getDay())) {
      const k = fmtKey(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
      if (k <= maxKey) dates.push(k);
    }
    cur.setDate(cur.getDate() + 1);
  }

  if (!dates.length) { showToast("⚠️ 対象日が見つかりません", "error"); return; }

  const total = dates.length * targetSlots.length;
  let done = 0;

  el.periodProgress.style.display = "block";
  showLoading(true);

  // simulate progress (still fast, but gives “ちゃんとしてる感”)
  for (const dateKey of dates) {
    for (const slotId of targetSlots) {
      const k = slotKey(dateKey, slotId);
      if (isClose) store.closedSlots[k] = true;
      else delete store.closedSlots[k];
      done++;
      el.periodProgress.textContent = `処理中... ${done} / ${total} 件`;
      // tiny yield for UI
      await new Promise((r) => setTimeout(r, 6));
    }
  }

  saveStore();
  showLoading(false);

  el.periodProgress.textContent = `✅ ${total}件の設定が完了しました`;
  setTimeout(() => (el.periodProgress.style.display = "none"), 2600);

  renderSlotMgmt();
  renderCalendar();
  showToast(`${isClose ? "🚫 クローズ" : "✅ オープン"} を一括設定しました（DEMO）`, isClose ? "cancel" : "success");
}

/* ---------------------------
 * Event wiring
 * --------------------------- */
function bindEvents() {
  // Calendar nav
  el.btnPrevMonth.addEventListener("click", () => changeMonth(-1));
  el.btnNextMonth.addEventListener("click", () => changeMonth(1));

  // Tabs
  el.tabCalendar.addEventListener("click", () => switchTab("calendar"));
  el.tabSlots.addEventListener("click", () => ui.isAdmin && switchTab("slots"));
  el.tabArtists.addEventListener("click", () => ui.isAdmin && switchTab("artists"));
  el.tabReservations.addEventListener("click", () => ui.isAdmin && switchTab("reservations"));

  // Modal close: close button + outside click
  el.modalOverlay.addEventListener("click", (ev) => {
    if (ev.target === el.modalOverlay) closeModal();
  });
  // Close button
  el.modalOverlay.querySelector<HTMLButtonElement>(".modal-close")?.addEventListener("click", () => closeModal());

  // Lookup / proceed
  el.modalOverlay.querySelector<HTMLButtonElement>(".btn-lookup")?.addEventListener("click", () => lookupArtist());
  el.btnProceed.addEventListener("click", () => proceedToStep2());

  // Step2 buttons
  el.modalOverlay.querySelector<HTMLButtonElement>(".btn-back")?.addEventListener("click", () => backToStep1());
  el.modalOverlay.querySelector<HTMLButtonElement>(".btn-submit")?.addEventListener("click", () => submitReservationRequest());

  // New artist submit
  el.modalOverlay.querySelector<HTMLButtonElement>(".btn-register")?.addEventListener("click", () => submitNewArtist());

  // Input “has-value” visuals
  el.fInstagram.addEventListener("input", () => onSnsInput("instagram"));
  el.fTiktok.addEventListener("input", () => onSnsInput("tiktok"));
  el.fYoutube.addEventListener("input", () => onSnsInput("youtube"));
  el.fTwitter.addEventListener("input", () => onSnsInput("twitter"));
  el.fVideoUrl.addEventListener("input", () => onVideoInput());
  el.fVideoLineId.addEventListener("input", () => onVideoInput());

  // Confirm overlay close (no button)
  el.confirmOverlay.querySelector<HTMLButtonElement>(".btn-no")?.addEventListener("click", () => closeConfirm());

  // Admin button
  el.adminBtn.addEventListener("click", () => {
    if (ui.isAdmin) {
      setAdminUI(false);
      showToast("🔒 管理者をログアウトしました（DEMO）");
    } else {
      openAdminLogin();
    }
  });

  // Admin overlay buttons
  el.adminOverlay.querySelector<HTMLButtonElement>(".btn-no")?.addEventListener("click", () => closeAdminLogin());
  el.adminOverlay.querySelector<HTMLButtonElement>(".btn-yes")?.addEventListener("click", () => submitAdminLogin());
  el.adminPasswordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAdminLogin();
  });

  // Admin: Artist list (delegation)
  el.artistList.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const btn = t.closest<HTMLButtonElement>("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (!id) return;
    if (action === "approve") approveArtist(id);
    if (action === "reject") rejectArtist(id);
  });

  // Admin: reservations list cancel (delegation)
  el.resList.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const btn = t.closest<HTMLButtonElement>("button[data-action='cancel-res']");
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;
    requestCancelReservation(id);
  });

  // Admin: slot mgmt controls
  el.slotMgmtDate.addEventListener("change", () => renderSlotMgmt());

  // slot toggle button delegation
  el.slotToggleGrid.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const btn = t.closest<HTMLButtonElement>("button[data-action='toggle-slot']");
    if (!btn) return;
    const dateKey = btn.dataset.date!;
    const slotId = btn.dataset.slot as SlotId;
    toggleSlot(dateKey, slotId);
  });

  // bulk buttons in slots panel (find by text labels)
  el.pageSlots.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const b = t.closest<HTMLButtonElement>("button.bulk-btn");
    if (!b) return;

    const dateKey = el.slotMgmtDate.value;
    if (!dateKey) return;

    if (b.textContent?.includes("全枠オープン")) bulkOpen(dateKey);
    if (b.textContent?.includes("全枠クローズ")) bulkClose(dateKey);

    if (b.textContent?.includes("期間内を一括オープン")) void periodBulk(false);
    if (b.textContent?.includes("期間内を一括クローズ")) void periodBulk(true);
  });
}

/* ---------------------------
 * Init
 * --------------------------- */
function init() {
  showLoading(true);

  seedIfNeeded();
  store = loadStore();

  // initial date inputs
  enforceDateInputsMax();

  // initial UI
  updatePendingBadge();
  setAdminUI(false);
  switchTab("calendar");
  renderCalendar();

  bindEvents();

  showLoading(false);
  showToast("✅ DEMO準備OK（予約はlocalStorageのみ）", "success");
}

init();
