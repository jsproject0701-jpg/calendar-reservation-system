// src/main.ts
/* =========================================================
   Calendar Reservation System (Demo Mode / No Network)
   - All data lives in localStorage (per-browser)
   - Seed data creates "満枠/一部空き"演出を強める
   - UI/HTML/CSS are kept as-is (from your original index.html)
   ========================================================= */

type SlotId = 'A' | 'B' | 'C' | 'D';

type ArtistStatus = 'pending' | 'approved';

type Artist = {
  id: string;
  name: string;
  phone: string;
  artist: string;
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

type Reservation = {
  id: string;
  dateKey: string; // YYYY-MM-DD
  slotId: SlotId;
  artistId: string;
  name: string;
  artistName: string;
  phone: string;
  lineId: string;
  note?: string;
  createdAt: string;
};

type DemoState = {
  version: number;
  reservations: Record<string, Reservation>;
  artists: Record<string, Artist>;
  closedSlots: Record<string, true>; // key = `${dateKey}_${slotId}`
};

const APP_VERSION = 1;
const STORAGE_KEY = 'calendar-reservation-system.demo.v1';

const SLOTS: Array<{ id: SlotId; time: string; label: string }> = [
  { id: 'A', time: '17:00〜18:00', label: '1部' },
  { id: 'B', time: '18:00〜19:00', label: '2部' },
  { id: 'C', time: '19:00〜20:00', label: '3部' },
  { id: 'D', time: '20:00〜21:00', label: '4部' },
];

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

const LIMIT_MONTHS_AHEAD = 3;

// ============================
// DOM helpers
// ============================
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: #${id}`);
  return node as T;
}
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function fmtKey(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function dateOnly(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function getLimitEndDate() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  end.setMonth(end.getMonth() + LIMIT_MONTHS_AHEAD);
  return end;
}
function limitMaxKey() {
  const end = getLimitEndDate();
  return fmtKey(end.getFullYear(), end.getMonth() + 1, end.getDate());
}
function isTooFutureDate(d: Date) {
  return dateOnly(d) > dateOnly(getLimitEndDate());
}
function slotKey(dateKey: string, slotId: SlotId) {
  return `${dateKey}_${slotId}`;
}

// ============================
// Toast / Loading
// ============================
function showToast(msg: string, type: '' | 'success' | 'cancel' | 'pending' | 'error' = '') {
  const t = el<HTMLDivElement>('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ` ${type}` : '');
  window.setTimeout(() => (t.className = 'toast'), 3500);
}
function showLoading(show: boolean) {
  el<HTMLDivElement>('loadingOverlay').classList.toggle('show', show);
}

// ============================
// Demo Storage
// ============================
function loadState(): DemoState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoState;
    if (!parsed || parsed.version !== APP_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}
function saveState(state: DemoState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function makeId(prefix: string) {
  // collision-safe enough for demo
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ============================
// Seed (強め演出 / 想定運用: 平日クローズ多め・土日オープン)
// ============================
function seedState(): DemoState {
  const now = new Date();
  const today = dateOnly(now);
  const max = getLimitEndDate();

  // --- artists
  const a1: Artist = {
    id: 'artist_demo_approved_1',
    name: '山田 太郎',
    phone: '090-1111-2222',
    artist: 'ソラノオト',
    genre: 'アコースティック',
    instagram: 'sora_note',
    youtube: 'https://www.youtube.com/@soranote',
    lineId: '@soranote',
    status: 'approved',
    createdAt: new Date().toISOString(),
  };
  const a2: Artist = {
    id: 'artist_demo_approved_2',
    name: '佐藤 花',
    phone: '090-3333-4444',
    artist: 'HANA VIBES',
    genre: 'Neo-Soul',
    tiktok: '@hanavibes',
    instagram: 'hana_vibes',
    lineId: '@hanavibes',
    status: 'approved',
    createdAt: new Date().toISOString(),
  };
  const a3: Artist = {
    id: 'artist_demo_pending_1',
    name: '田中 次郎',
    phone: '080-5555-6666',
    artist: 'Tokuyama Beats',
    genre: 'DJ / HipHop',
    twitter: '@tokuyamabeats',
    videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
    lineId: '@tokuyama_beats',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  const artists: Record<string, Artist> = {
    [a1.id]: a1,
    [a2.id]: a2,
    [a3.id]: a3,
  };

  const closedSlots: Record<string, true> = {};
  const reservations: Record<string, Reservation> = {};

  // policy:
  // - 平日: 基本クローズ多め（全枠クローズの日を多数）
  // - 土日: オープン（ただし一部枠クローズや予約で演出）
  // - 近い週末: 満枠/一部空きを意図的に作る

  // helper to iterate dates
  const cur = new Date(today);
  while (cur <= max) {
    const dow = cur.getDay(); // 0=Sun ... 6=Sat
    const dateKey = fmtKey(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());

    const isWeekend = dow === 0 || dow === 6;

    if (!isWeekend) {
      // 平日は「全枠クローズ」多め、たまに1枠だけ開ける
      const r = Math.random();
      if (r < 0.75) {
        // almost closed day
        for (const s of SLOTS) closedSlots[slotKey(dateKey, s.id)] = true;
      } else {
        // partially open: open only A, close others
        for (const s of SLOTS) {
          if (s.id !== 'A') closedSlots[slotKey(dateKey, s.id)] = true;
        }
      }
    } else {
      // 土日は基本オープン。ただしランダムで1枠クローズ
      const r = Math.random();
      if (r < 0.25) {
        const pick = (['A','B','C','D'] as SlotId[])[Math.floor(Math.random() * 4)];
        closedSlots[slotKey(dateKey, pick)] = true;
      }
    }
    cur.setDate(cur.getDate() + 1);
  }

  // 强演出：直近の土日を「満枠/一部空き」へ寄せる
  // 直近 2 回分の週末を探して、1日は満枠、1日は一部空き
  const weekends: string[] = [];
  const scan = new Date(today);
  while (scan <= max && weekends.length < 6) {
    const dow = scan.getDay();
    if (dow === 0 || dow === 6) {
      weekends.push(fmtKey(scan.getFullYear(), scan.getMonth() + 1, scan.getDate()));
    }
    scan.setDate(scan.getDate() + 1);
  }

  const makeRes = (dateKey: string, slotId: SlotId, artist: Artist, note?: string) => {
    const id = makeId('res_demo');
    reservations[id] = {
      id,
      dateKey,
      slotId,
      artistId: artist.id,
      name: artist.name,
      artistName: artist.artist || artist.name,
      phone: artist.phone,
      lineId: artist.lineId,
      note,
      createdAt: new Date().toISOString(),
    };
  };

  // day1: full（開いてる枠は全部予約）
  const fullDay = weekends[1] ?? weekends[0];
  if (fullDay) {
    for (const s of SLOTS) {
      if (closedSlots[slotKey(fullDay, s.id)]) continue; // closed stays closed
      makeRes(fullDay, s.id, a1, '（デモ）フルブッキング');
    }
  }

  // day2: partial（2枠だけ予約、残り空き）
  const partialDay = weekends[2] ?? weekends[0];
  if (partialDay) {
    const candidates = (['A','B','C','D'] as SlotId[]).filter(id => !closedSlots[slotKey(partialDay, id)]);
    if (candidates.length >= 2) {
      makeRes(partialDay, candidates[0], a2, '（デモ）人気枠');
      makeRes(partialDay, candidates[1], a1, '（デモ）予約済み');
    }
  }

  return { version: APP_VERSION, reservations, artists, closedSlots };
}

// ============================
// App State (in-memory mirror)
// ============================
let state: DemoState = loadState() ?? seedState();

// view state
let currentYear = 0;
let currentMonth = 0; // 0-11
let selectedDate: { y: number; m: number; d: number; dow: number } | null = null;
let selectedSlotId: SlotId | null = null;
let pendingCancelId: string | null = null;
let currentFoundArtistId: string | null = null;

let isAdmin = false;
const ADMIN_PASSWORD = 'Hirakegoma2025'; // demo only

// ============================
// Persistence wrapper
// ============================
function commit() {
  saveState(state);
}

// ============================
// Tabs
// ============================
function switchTab(tab: 'calendar' | 'slots' | 'artists' | 'reservations') {
  (['calendar','slots','artists','reservations'] as const).forEach(t => {
    el<HTMLDivElement>('page' + cap(t)).style.display = t === tab ? 'block' : 'none';
    el<HTMLButtonElement>('tab' + cap(t)).classList.toggle('active', t === tab);
  });
  if (tab === 'artists') renderArtistList();
  if (tab === 'reservations') renderResList();
  if (tab === 'slots') renderSlotMgmt();
}

// expose to window for inline onclick in HTML
(Object.assign(window as any, {
  switchTab,
}));

// ============================
// Admin Auth
// ============================
function toggleAdminLogin() {
  if (isAdmin) {
    isAdmin = false;
    document.querySelectorAll<HTMLElement>('.admin-tab').forEach(n => (n.style.display = 'none'));
    switchTab('calendar');
    const btn = el<HTMLButtonElement>('adminBtn');
    btn.textContent = '🔒 管理者';
    btn.style.background = 'rgba(255,255,255,.15)';
    showToast('🔒 管理者をログアウトしました');
  } else {
    el<HTMLInputElement>('adminPasswordInput').value = '';
    el<HTMLDivElement>('adminModalIcon').textContent = '🔐';
    el<HTMLDivElement>('adminModalTitle').textContent = '管理者ログイン';
    el<HTMLDivElement>('adminModalText').textContent = 'パスワードを入力してください';
    el<HTMLInputElement>('adminPasswordInput').style.borderColor = 'var(--sky-mid)';
    el<HTMLDivElement>('adminOverlay').classList.add('show');
    setTimeout(() => el<HTMLInputElement>('adminPasswordInput').focus(), 50);
  }
}
function submitAdminLogin() {
  const pw = el<HTMLInputElement>('adminPasswordInput').value;
  if (pw === ADMIN_PASSWORD) {
    isAdmin = true;
    el<HTMLDivElement>('adminOverlay').classList.remove('show');
    document.querySelectorAll<HTMLElement>('.admin-tab').forEach(n => (n.style.display = 'flex'));
    const btn = el<HTMLButtonElement>('adminBtn');
    btn.textContent = '🔓 管理者';
    btn.style.background = 'rgba(255,255,255,.3)';
    showToast('🔓 管理者としてログインしました', 'success');
  } else {
    el<HTMLInputElement>('adminPasswordInput').style.borderColor = 'var(--red)';
    el<HTMLDivElement>('adminModalIcon').textContent = '❌';
    el<HTMLDivElement>('adminModalTitle').textContent = 'パスワードが違います';
    el<HTMLInputElement>('adminPasswordInput').value = '';
    el<HTMLInputElement>('adminPasswordInput').focus();
  }
}
function closeAdminOverlay() {
  el<HTMLDivElement>('adminOverlay').classList.remove('show');
}

(Object.assign(window as any, {
  toggleAdminLogin,
  submitAdminLogin,
  closeAdminOverlay,
}));

// ============================
// Badge
// ============================
function updatePendingBadge() {
  const n = Object.values(state.artists).filter(a => a.status === 'pending').length;
  const b = el<HTMLSpanElement>('pendingBadge');
  b.textContent = String(n);
  b.style.display = n > 0 ? 'inline-flex' : 'none';
}

// ============================
// Slot closed?
// ============================
function isClosed(dateKey: string, slotId: SlotId) {
  return !!state.closedSlots[slotKey(dateKey, slotId)];
}
function openSlotsFor(dateKey: string) {
  return SLOTS.filter(s => !isClosed(dateKey, s.id));
}

// ============================
// Calendar
// ============================
function renderCalendar() {
  el<HTMLDivElement>('calMonthLabel').textContent = `${currentYear}年 ${currentMonth + 1}月`;

  // month navigation disable (past / too future)
  const now = new Date();
  const minMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const maxEnd = getLimitEndDate();
  const maxMonth = new Date(maxEnd.getFullYear(), maxEnd.getMonth(), 1);
  const curMonthDate = new Date(currentYear, currentMonth, 1);

  el<HTMLButtonElement>('btnPrevMonth').disabled = curMonthDate <= minMonth;
  el<HTMLButtonElement>('btnNextMonth').disabled = curMonthDate >= maxMonth;

  const grid = el<HTMLDivElement>('calGrid');
  grid.innerHTML = '';

  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const today = new Date();

  for (let i = 0; i < firstDay; i++) {
    const e = document.createElement('div');
    e.className = 'cal-day empty';
    grid.appendChild(e);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(currentYear, currentMonth, d);
    const dateKey = fmtKey(currentYear, currentMonth + 1, d);

    const dayRess = Object.values(state.reservations).filter(r => r.dateKey === dateKey);
    const openSlots = openSlotsFor(dateKey);

    const dow = date.getDay();
    const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const isToday = date.toDateString() === today.toDateString();
    const allClosed = openSlots.length === 0;
    const isTooFuture = isTooFutureDate(date);

    let cls = 'cal-day';
    if (isPast) cls += ' past';
    if (isToday) cls += ' today';
    if (dow === 0) cls += ' sun';
    if (dow === 6) cls += ' sat';

    if (isTooFuture) cls += ' too-future';
    else if (!isPast && allClosed) cls += ' closed';
    else {
      // full: openSlots are all booked
      const bookedCount = openSlots.filter(s => dayRess.some(r => r.slotId === s.id)).length;
      if (!isPast && !allClosed && bookedCount >= openSlots.length && openSlots.length > 0) cls += ' full';
    }

    const cell = document.createElement('div');
    cell.className = cls;

    const dots = (SLOTS as typeof SLOTS).map(s => {
      const c = isClosed(dateKey, s.id) ? ' closed-dot' : (dayRess.some(r => r.slotId === s.id) ? ' booked' : '');
      return `<div class="slot-dot${c}"></div>`;
    }).join('');

    cell.innerHTML = `<div class="day-num">${d}</div><div class="slot-dots">${dots}</div>`;

    if (!isPast && !allClosed && !isTooFuture) {
      cell.onclick = () => openModal(currentYear, currentMonth + 1, d, dow);
    }
    grid.appendChild(cell);
  }
}

function changeMonth(delta: number) {
  const cand = new Date(currentYear, currentMonth + delta, 1);
  const now = new Date();
  const min = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = getLimitEndDate();
  const max = new Date(end.getFullYear(), end.getMonth(), 1);
  if (cand < min || cand > max) return;

  currentYear = cand.getFullYear();
  currentMonth = cand.getMonth();
  renderCalendar();
}

(Object.assign(window as any, {
  changeMonth,
}));

// ============================
// Modal
// ============================
function openModal(y: number, m: number, d: number, dow: number) {
  const dateObj = new Date(y, m - 1, d);
  if (isTooFutureDate(dateObj)) {
    showToast('⚠️ 予約は3ヶ月先までです', 'error');
    return;
  }

  selectedDate = { y, m, d, dow };
  el<HTMLDivElement>('modalDateLabel').textContent = `${y}年${m}月${d}日（${WEEKDAYS[dow]}）`;
  el<HTMLDivElement>('modalDateSub').textContent = MONTHS[m - 1] ?? '';
  renderModalSlots(fmtKey(y, m, d));
  closeForm();

  el<HTMLDivElement>('modalOverlay').classList.add('show');
}
function closeModal() {
  el<HTMLDivElement>('modalOverlay').classList.remove('show');
  closeForm();
}
function closeModalIfOutside(e: MouseEvent) {
  if (e.target === el<HTMLDivElement>('modalOverlay')) closeModal();
}

(Object.assign(window as any, {
  closeModal,
  closeModalIfOutside,
}));

function renderModalSlots(dateKey: string) {
  const list = el<HTMLDivElement>('slotList');
  list.innerHTML = '';

  const dayRess = Object.values(state.reservations).filter(r => r.dateKey === dateKey);

  for (const slot of SLOTS) {
    const res = dayRess.find(r => r.slotId === slot.id);
    const closed = isClosed(dateKey, slot.id);

    // 予約済み枠は非表示（あなたの要件）
    if (res) continue;

    const item = document.createElement('div');
    const isSelected = selectedSlotId === slot.id;

    item.className = 'slot-item' + (closed ? ' closed-slot' : '') + (isSelected ? ' selected-slot' : '');
    item.innerHTML = `
      <div class="slot-time">${slot.time}</div>
      <div class="slot-info">
        <div class="slot-label">${closed ? 'クローズ' : slot.label}</div>
        <div class="slot-sublabel">${closed ? '—' : '空き枠（デモ）'}</div>
      </div>
    `;

    const btn = document.createElement('button');
    btn.className = 'slot-action-btn ';

    if (closed) {
      btn.className += 'btn-disabled';
      btn.textContent = '受付停止中';
    } else {
      btn.className += 'btn-reserve';
      btn.textContent = '予約する';
      btn.onclick = () => openForm(slot.id);
    }

    item.appendChild(btn);
    list.appendChild(item);
  }
}

// ============================
// Form / Steps
// ============================
function setStep(n: 1 | 2 | 3) {
  ([1,2,3] as const).forEach(i => {
    const s = el<HTMLDivElement>('step' + i);
    s.classList.remove('active', 'done');
    if (i < n) s.classList.add('done');
    if (i === n) s.classList.add('active');
  });
  ([1,2] as const).forEach(i => el<HTMLDivElement>('stepLine' + i).classList.toggle('done', i < n));
}

function resetFormUI() {
  setStep(1);
  el<HTMLInputElement>('lookupInput').value = '';
  el<HTMLDivElement>('artistFound').classList.remove('show');
  el<HTMLDivElement>('artistNotFound').classList.remove('show');
  el<HTMLDivElement>('pendingInline').classList.remove('show');
  el<HTMLDivElement>('step1Area').style.display = 'block';
  el<HTMLDivElement>('step2Area').style.display = 'none';
  currentFoundArtistId = null;

  const btn = el<HTMLButtonElement>('btnProceed');
  btn.disabled = false;
  btn.style.background = '';
  btn.textContent = '次へ → 予約情報を入力';

  ([
    'fName','fPhone','fArtist','fGenre',
    'fInstagram','fTiktok','fYoutube','fTwitter',
    'fVideoUrl','fVideoLineId','fLineId','fNote','fReserveNote'
  ] as const).forEach(id => {
    const node = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (node) node.value = '';
  });

  (['instagram','tiktok','youtube','twitter'] as const).forEach(s => {
    el<HTMLDivElement>('snsWrap_' + s).classList.remove('has-value');
  });

  el<HTMLDivElement>('videoOptionUrl').classList.remove('selected');
  el<HTMLDivElement>('videoOptionLine').classList.remove('selected');

  el<HTMLDivElement>('newArtistForm')
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input,textarea,button.btn-register')
    .forEach(n => (n.disabled = false));
}

function openForm(slotId: SlotId) {
  selectedSlotId = slotId;
  if (selectedDate) renderModalSlots(fmtKey(selectedDate.y, selectedDate.m, selectedDate.d));

  resetFormUI();
  el<HTMLDivElement>('formSection').classList.add('show');
  setTimeout(() => el<HTMLDivElement>('formSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}
function closeForm() {
  el<HTMLDivElement>('formSection').classList.remove('show');
  selectedSlotId = null;
  currentFoundArtistId = null;
}

function proceedToStep2() {
  if (!currentFoundArtistId) return;
  const a = state.artists[currentFoundArtistId];
  setStep(2);
  el<HTMLDivElement>('step2ArtistName').textContent = `${a.artist || a.name}（${a.name}）`;
  el<HTMLDivElement>('step2ArtistSub').textContent = a.phone + (a.genre ? `　${a.genre}` : '');
  el<HTMLDivElement>('step1Area').style.display = 'none';
  el<HTMLDivElement>('step2Area').style.display = 'block';
}
function backToStep1() {
  setStep(1);
  el<HTMLDivElement>('step1Area').style.display = 'block';
  el<HTMLDivElement>('step2Area').style.display = 'none';
}

(Object.assign(window as any, {
  proceedToStep2,
  backToStep1,
}));

// ============================
// Artist lookup (承認済みだけ次へ)
// ============================
function lookupArtist() {
  const q = el<HTMLInputElement>('lookupInput').value.trim().toLowerCase();
  if (!q) return;

  const found = Object.values(state.artists).find(a => {
    const phone = a.phone.replace(/-/g, '');
    const qPhone = q.replace(/-/g, '');
    return (
      phone.includes(qPhone) ||
      a.name.toLowerCase().includes(q) ||
      (a.artist && a.artist.toLowerCase().includes(q))
    );
  });

  el<HTMLDivElement>('artistFound').classList.remove('show');
  el<HTMLDivElement>('artistNotFound').classList.remove('show');
  currentFoundArtistId = null;

  const btn = el<HTMLButtonElement>('btnProceed');
  btn.disabled = false;
  btn.style.background = '';
  btn.textContent = '次へ → 予約情報を入力';

  if (found) {
    currentFoundArtistId = found.id;
    el<HTMLDivElement>('foundName').textContent = `${found.artist || found.name}（${found.name}）`;
    el<HTMLDivElement>('foundSub').textContent = found.phone + (found.genre ? `　${found.genre}` : '');

    const badge = el<HTMLDivElement>('foundBadge');
    if (found.status === 'approved') {
      badge.textContent = '✅ 承認済み';
      badge.className = 'artist-found-badge';
      btn.disabled = false;
    } else {
      badge.textContent = '⏳ 審査中';
      badge.className = 'artist-found-badge pending-badge';
      btn.disabled = true;
      btn.textContent = '⏳ 審査完了後に予約できます';
    }

    el<HTMLDivElement>('artistFound').classList.add('show');
  } else {
    el<HTMLDivElement>('artistNotFound').classList.add('show');
  }
}

(Object.assign(window as any, {
  lookupArtist,
}));

// ============================
// SNS / Video UI helpers
// ============================
function onSnsInput(platform: 'instagram'|'tiktok'|'youtube'|'twitter') {
  const id = 'f' + platform.charAt(0).toUpperCase() + platform.slice(1);
  const v = (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
  el<HTMLDivElement>('snsWrap_' + platform).classList.toggle('has-value', v !== '');
}
function onVideoInput(_: 'url'|'line') {
  const hasUrl = el<HTMLInputElement>('fVideoUrl').value.trim() !== '';
  const hasLine = el<HTMLInputElement>('fVideoLineId').value.trim() !== '';
  el<HTMLDivElement>('videoOptionUrl').classList.toggle('selected', hasUrl);
  el<HTMLDivElement>('videoOptionLine').classList.toggle('selected', hasLine);
}

(Object.assign(window as any, {
  onSnsInput,
  onVideoInput,
}));

// ============================
// New artist (demo)
// ============================
async function submitNewArtist() {
  const name = el<HTMLInputElement>('fName').value.trim();
  const phone = el<HTMLInputElement>('fPhone').value.trim();
  const artist = el<HTMLInputElement>('fArtist').value.trim();
  const lineId = el<HTMLInputElement>('fLineId').value.trim();
  const instagram = el<HTMLInputElement>('fInstagram').value.trim();
  const tiktok = el<HTMLInputElement>('fTiktok').value.trim();
  const youtube = el<HTMLInputElement>('fYoutube').value.trim();
  const twitter = el<HTMLInputElement>('fTwitter').value.trim();
  const videoUrl = el<HTMLInputElement>('fVideoUrl').value.trim();
  const videoLine = el<HTMLInputElement>('fVideoLineId').value.trim();

  if (!name || !phone) { showToast('⚠️ お名前と電話番号は必須です', 'error'); return; }
  if (!artist) { showToast('⚠️ アーティスト名は必須です', 'error'); return; }
  if (!lineId) { showToast('⚠️ LINE IDは必須です（予約確定通知用）', 'error'); return; }
  if (!instagram && !tiktok && !youtube && !twitter) { showToast('⚠️ SNSアカウントを1つ以上入力してください', 'error'); return; }
  if (!videoUrl && !videoLine) { showToast('⚠️ 動画URLまたはLINE IDを入力してください', 'error'); return; }

  const id = makeId('artist');
  const newArtist: Artist = {
    id,
    name,
    phone,
    artist,
    genre: el<HTMLInputElement>('fGenre').value.trim(),
    instagram, tiktok, youtube, twitter,
    videoUrl,
    videoLineId: videoLine,
    lineId,
    note: el<HTMLTextAreaElement>('fNote').value.trim(),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  state.artists[id] = newArtist;
  commit();

  updatePendingBadge();
  el<HTMLDivElement>('pendingInline').classList.add('show');

  el<HTMLDivElement>('newArtistForm')
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input,textarea,button.btn-register')
    .forEach(n => (n.disabled = true));

  // demo: no LINE
  showToast('📨（デモ）審査申請を受け付けました！', 'pending');
}

(Object.assign(window as any, {
  submitNewArtist,
}));

// ============================
// Reservation submit (demo / local only)
// ============================
async function submitReservation() {
  if (!currentFoundArtistId) return;
  if (!selectedDate || !selectedSlotId) { showToast('⚠️ 日付と枠を選択してください', 'error'); return; }

  const dateObj = new Date(selectedDate.y, selectedDate.m - 1, selectedDate.d);
  if (isTooFutureDate(dateObj)) { showToast('⚠️ 予約は3ヶ月先までです', 'error'); return; }

  const dateKey = fmtKey(selectedDate.y, selectedDate.m, selectedDate.d);

  // double check in-memory
  const already = Object.values(state.reservations).some(r => r.dateKey === dateKey && r.slotId === selectedSlotId);
  if (already) {
    showToast('⚠️ その枠はすでに予約済みです（デモ）', 'error');
    renderCalendar();
    renderModalSlots(dateKey);
    return;
  }

  const a = state.artists[currentFoundArtistId];
  if (a.status !== 'approved') {
    showToast('⚠️ 承認済みアーティストのみ予約できます', 'error');
    return;
  }

  const id = makeId('res');
  const note = el<HTMLTextAreaElement>('fReserveNote').value.trim();
  const res: Reservation = {
    id,
    dateKey,
    slotId: selectedSlotId,
    artistId: a.id,
    name: a.name,
    artistName: a.artist || a.name,
    phone: a.phone,
    lineId: a.lineId,
    note,
    createdAt: new Date().toISOString(),
  };

  showLoading(true);
  // demo latency
  await new Promise(r => setTimeout(r, 300));
  state.reservations[id] = res;
  commit();
  showLoading(false);

  setStep(3);
  showToast(`✅（デモ）${dateKey} ${SLOTS.find(s => s.id === selectedSlotId)!.time} を予約しました`, 'success');

  closeModal();
  renderCalendar();
}

(Object.assign(window as any, {
  submitReservation,
}));

// ============================
// Cancel confirm
// ============================
function confirmCancel(id: string, name: string, time: string) {
  pendingCancelId = id;
  el<HTMLDivElement>('confirmTitle').textContent = '予約をキャンセルしますか？';
  el<HTMLDivElement>('confirmText').textContent =
    `${name} 様の\n「${time}」の予約をキャンセルします。\nこの操作は取り消せません。`;
  el<HTMLButtonElement>('confirmYes').onclick = executeCancel;
  el<HTMLDivElement>('confirmOverlay').classList.add('show');
}
function closeConfirm() {
  el<HTMLDivElement>('confirmOverlay').classList.remove('show');
  pendingCancelId = null;
}
async function executeCancel() {
  if (!pendingCancelId) return;
  const res = state.reservations[pendingCancelId];
  if (!res) return;

  showLoading(true);
  await new Promise(r => setTimeout(r, 250));
  delete state.reservations[pendingCancelId];
  commit();
  showLoading(false);

  closeConfirm();
  closeModal();
  renderCalendar();
  showToast('🗑️（デモ）予約をキャンセルしました', 'cancel');
}

(Object.assign(window as any, {
  confirmCancel,
  closeConfirm,
}));

// ============================
// Artist list / approve / reject (admin)
// ============================
function renderArtistList() {
  const list = el<HTMLDivElement>('artistList');
  const sorted = Object.values(state.artists).sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  if (!sorted.length) { list.innerHTML = '<div class="no-data">登録アーティストはまだいません</div>'; return; }
  list.innerHTML = '';

  for (const a of sorted) {
    const card = document.createElement('div');
    card.className = 'artist-card' + (a.status === 'pending' ? ' pending-card' : '');
    const initial = (a.artist || a.name).charAt(0);

    const sns: string[] = [];
    if (a.instagram) sns.push(`📸@${a.instagram}`);
    if (a.tiktok) sns.push('🎵TikTok');
    if (a.youtube) sns.push('▶️YouTube');
    if (a.twitter) sns.push(`𝕏${a.twitter}`);
    const vInfo = a.videoUrl ? '🎬動画URL有' : (a.videoLineId ? '💬動画LINE有' : '');
    const sub = [a.phone, `💬LINE:${a.lineId || '—'}`, ...sns, vInfo, a.genre].filter(Boolean).join('　');

    let actions = `<div class="status-approved">✅ 承認済み</div>`;
    if (a.status === 'pending') {
      actions = `
        <div class="artist-actions">
          <button class="btn-approve" onclick="approveArtist('${a.id}')">✅ 承認</button>
          <button class="btn-reject" onclick="rejectArtist('${a.id}')">✗ 却下</button>
        </div>`;
    }

    card.innerHTML = `
      <div class="artist-avatar">${initial}</div>
      <div class="artist-card-info">
        <div class="artist-card-name">${a.artist || a.name}${a.artist ? `（${a.name}）` : ''}</div>
        <div class="artist-card-sub">${sub}</div>
      </div>
      ${actions}
    `;
    list.appendChild(card);
  }
}

async function approveArtist(id: string) {
  if (!isAdmin) { showToast('⚠️ 管理者ログインが必要です', 'error'); return; }
  const a = state.artists[id];
  if (!a) return;

  a.status = 'approved';
  commit();
  updatePendingBadge();
  renderArtistList();
  showToast(`✅（デモ）${a.artist || a.name} を承認しました`, 'success');
}
async function rejectArtist(id: string) {
  if (!isAdmin) { showToast('⚠️ 管理者ログインが必要です', 'error'); return; }
  const a = state.artists[id];
  if (!a) return;

  if (confirm(`「${a.artist || a.name}」を却下・削除しますか？（デモ）`)) {
    delete state.artists[id];
    commit();
    updatePendingBadge();
    renderArtistList();
    showToast('🗑️（デモ）却下しました', 'cancel');
  }
}

(Object.assign(window as any, {
  approveArtist,
  rejectArtist,
}));

// ============================
// Reservation list
// ============================
function renderResList() {
  const list = el<HTMLDivElement>('resList');
  const sorted = Object.values(state.reservations).sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  if (!sorted.length) { list.innerHTML = '<div class="no-data">現在の予約はありません</div>'; return; }
  list.innerHTML = '';

  for (const r of sorted) {
    const slot = SLOTS.find(s => s.id === r.slotId)!;
    const [, m, d] = r.dateKey.split('-');
    const safeName = (r.artistName || r.name).replace(/'/g, "\\'");

    const item = document.createElement('div');
    item.className = 'res-item';
    item.innerHTML = `
      <span class="res-date">${parseInt(m, 10)}/${parseInt(d, 10)}</span>
      <span class="res-time">${slot.time}</span>
      <span class="res-name">${r.artistName || r.name}</span>
      <button class="res-cancel-btn" onclick="confirmCancel('${r.id}','${safeName}','${slot.time}')">キャンセル</button>
    `;
    list.appendChild(item);
  }
}

// ============================
// Slot Management (admin)
// ============================
function renderSlotMgmt() {
  const maxKey = limitMaxKey();

  const slotDate = el<HTMLInputElement>('slotMgmtDate');
  slotDate.max = maxKey;

  if (!slotDate.value) slotDate.value = fmtKey(currentYear, currentMonth + 1, new Date().getDate());
  if (slotDate.value > maxKey) slotDate.value = maxKey;

  const dateVal = slotDate.value;
  const grid = el<HTMLDivElement>('slotToggleGrid');
  grid.innerHTML = '';

  for (const slot of SLOTS) {
    const closed = isClosed(dateVal, slot.id);
    const card = document.createElement('div');
    card.className = 'slot-toggle-card' + (closed ? ' closed-card' : '');
    card.innerHTML = `
      <div class="slot-toggle-time">${slot.time}</div>
      <div class="slot-toggle-label">${slot.label}</div>
      <button class="slot-toggle-btn ${closed ? 'btn-open' : 'btn-close'}"
        onclick="toggleSlot('${dateVal}','${slot.id}')">
        ${closed ? '✅ オープンにする' : '🚫 クローズにする'}
      </button>
    `;
    grid.appendChild(card);
  }
}

async function toggleSlot(dateKey: string, slotId: SlotId) {
  const maxKey = limitMaxKey();
  if (dateKey > maxKey) { showToast('⚠️ 3ヶ月先までしか操作できません', 'error'); return; }
  if (!isAdmin) { showToast('⚠️ 管理者ログインが必要です', 'error'); return; }

  const k = slotKey(dateKey, slotId);
  const willClose = !state.closedSlots[k];

  if (willClose) state.closedSlots[k] = true;
  else delete state.closedSlots[k];

  commit();
  renderSlotMgmt();
  renderCalendar();
  showToast(willClose ? '🚫（デモ）クローズしました' : '✅（デモ）オープンにしました', willClose ? 'cancel' : 'success');
}

async function bulkOpen() {
  const d = el<HTMLInputElement>('slotMgmtDate').value;
  const maxKey = limitMaxKey();
  if (d > maxKey) { showToast('⚠️ 3ヶ月先までしか操作できません', 'error'); return; }
  if (!isAdmin) { showToast('⚠️ 管理者ログインが必要です', 'error'); return; }

  for (const s of SLOTS) delete state.closedSlots[slotKey(d, s.id)];
  commit();
  renderSlotMgmt();
  renderCalendar();
  showToast('✅（デモ）全枠をオープンにしました', 'success');
}

async function bulkClose() {
  const d = el<HTMLInputElement>('slotMgmtDate').value;
  const maxKey = limitMaxKey();
  if (d > maxKey) { showToast('⚠️ 3ヶ月先までしか操作できません', 'error'); return; }
  if (!isAdmin) { showToast('⚠️ 管理者ログインが必要です', 'error'); return; }

  for (const s of SLOTS) state.closedSlots[slotKey(d, s.id)] = true;
  commit();
  renderSlotMgmt();
  renderCalendar();
  showToast('🚫（デモ）全枠をクローズしました', 'cancel');
}

(Object.assign(window as any, {
  renderSlotMgmt,
  toggleSlot,
  bulkOpen,
  bulkClose,
}));

// period bulk (admin)
async function periodBulk(isClose: boolean) {
  const startVal = el<HTMLInputElement>('periodStart').value;
  const endVal = el<HTMLInputElement>('periodEnd').value;
  const maxKey = limitMaxKey();

  if (!isAdmin) { showToast('⚠️ 管理者ログインが必要です', 'error'); return; }
  if (!startVal || !endVal) { showToast('⚠️ 開始日と終了日を入力してください', 'error'); return; }
  if (startVal > endVal) { showToast('⚠️ 終了日は開始日より後にしてください', 'error'); return; }
  if (startVal > maxKey || endVal > maxKey) { showToast('⚠️ 期間一括は3ヶ月先までです', 'error'); return; }

  const checkedDows = [...document.querySelectorAll<HTMLInputElement>('.period-dow-grid input:checked')]
    .map(n => parseInt(n.value, 10));
  const targetDows = checkedDows.length ? checkedDows : [0,1,2,3,4,5,6];

  const checkedSlots = [...document.querySelectorAll<HTMLInputElement>('.period-slot-grid input:checked')]
    .map(n => n.value as SlotId);
  const targetSlots = checkedSlots.length ? checkedSlots : (SLOTS.map(s => s.id));

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

  if (!dates.length) { showToast('⚠️ 対象日が見つかりません', 'error'); return; }

  const total = dates.length * targetSlots.length;
  const prog = el<HTMLDivElement>('periodProgress');
  prog.style.display = 'block';
  let done = 0;

  showLoading(true);
  for (const dateKey of dates) {
    for (const slotId of targetSlots) {
      const k = slotKey(dateKey, slotId);
      if (isClose) state.closedSlots[k] = true;
      else delete state.closedSlots[k];

      done++;
      prog.textContent = `処理中... ${done} / ${total} 件`;
      // tiny yield
      if (done % 20 === 0) await new Promise(r => setTimeout(r, 0));
    }
  }
  commit();
  showLoading(false);

  prog.textContent = `✅ ${total}件の設定が完了しました`;
  setTimeout(() => { prog.style.display = 'none'; }, 2500);

  renderSlotMgmt();
  renderCalendar();
  showToast(`${isClose ? '🚫（デモ）クローズ' : '✅（デモ）オープン'} を一括設定しました`, isClose ? 'cancel' : 'success');
}

(Object.assign(window as any, {
  periodBulk,
}));

// ============================
// Reset demo (optional helper)
// ============================
function resetDemo() {
  if (!confirm('デモデータを初期化しますか？（このブラウザの保存が消えます）')) return;
  state = seedState();
  commit();
  showToast('♻️ デモデータを初期化しました', 'success');
  updatePendingBadge();
  renderCalendar();
  if (isAdmin) renderSlotMgmt();
}
(Object.assign(window as any, { resetDemo }));

// ============================
// Init
// ============================
function init() {
  // attach some missing inline handlers that are used in HTML ids
  // (HTML already calls these names; we exposed them via window.)

  // date inputs max
  const maxKey = limitMaxKey();
  el<HTMLInputElement>('periodStart').max = maxKey;
  el<HTMLInputElement>('periodEnd').max = maxKey;

  // Start month = current month
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();

  updatePendingBadge();
  renderCalendar();
  switchTab('calendar');

  // small hint for demo mode
  showToast('🧪 デモモード：予約/登録はこのブラウザ内だけに保存されます', 'pending');
}

// 例: 要素ID/クラスはあなたのHTMLに合わせて調整してOK
const slotsModal = document.getElementById('slots-modal') as HTMLElement | null;
const slotsModalOverlay = document.getElementById('slots-modal-overlay') as HTMLElement | null;

function closeSlotsModal() {
  // モーダルを隠す（あなたの実装に合わせてどれか）
  slotsModal?.classList.remove('is-open');
  slotsModalOverlay?.classList.remove('is-open');

  // もし style で出してるなら：
  // slotsModal && (slotsModal.style.display = 'none');
  // slotsModalOverlay && (slotsModalOverlay.style.display = 'none');

  // bodyスクロールロックしてるなら解除
  document.body.classList.remove('modal-open');
}

// ✅ イベント委譲：svg/path をクリックしても拾えるので最強
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;

  // ❌ボタン
  if (t.closest('[data-action="close-slots-modal"]')) {
    closeSlotsModal();
    return;
  }

  // 背景クリックでも閉じたいなら（任意）
  if (slotsModalOverlay && t === slotsModalOverlay) {
    closeSlotsModal();
    return;
  }
});

// Escで閉じたいなら（任意）
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSlotsModal();
});

init();
