const WORKER_URL = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname.startsWith('192.168.')
  ? `http://${location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'localhost' : location.hostname}:8787`
  : 'https://aima.miraidai.workers.dev';

const ERROR_MESSAGES = {
  NETWORK_ERROR:     'ネットワークに接続できませんでした。通信環境を確認してください',
  AUTH_ERROR:        'システムエラーが発生しました。管理者に連絡してください（認証エラー）',
  CALENDAR_ERROR:    'カレンダーへの登録に失敗しました。しばらくしてから再度お試しください',
  VALIDATION_ERROR:  '入力内容に問題があります。内容を確認してください',
  INTERNAL_ERROR:    '予期しないエラーが発生しました。しばらくしてから再度お試しください',
};

async function apiFetch(url, options, { retryOnNetwork = true } = {}) {
  try {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = data.code || 'INTERNAL_ERROR';
      const msg = ERROR_MESSAGES[code] || data.error || `エラーが発生しました（HTTP ${res.status}）`;
      const err = new Error(msg);
      err.code = code;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.code) throw err;
    // TypeError: Failed to fetch など、ネットワーク起因のエラー
    if (retryOnNetwork) {
      await new Promise(r => setTimeout(r, 1500));
      return apiFetch(url, options, { retryOnNetwork: false });
    }
    const networkErr = new Error(ERROR_MESSAGES.NETWORK_ERROR);
    networkErr.code = 'NETWORK_ERROR';
    throw networkErr;
  }
}

const DAY_JP = ['日', '月', '火', '水', '木', '金', '土'];

let unit = 30;
let mode = 'online';
let cachedData = null;
let selectedSlot = null; // { date, startTime, step }

async function load(u, m) {
  const out = document.getElementById('output');
  out.innerHTML = '<p class="loading">読み込み中...</p>';
  try {
    cachedData = await apiFetch(`${WORKER_URL}/api/slots?t=${u}&mode=${m}`);
    render();
  } catch (e) {
    out.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

function render() {
  if (!cachedData) return;
  const out = document.getElementById('output');
  const copyWrap = document.getElementById('copy-wrap');
  if (!cachedData.days || cachedData.days.length === 0) {
    out.innerHTML = '<p class="empty">空き時間がありません</p>';
    copyWrap.hidden = true;
    return;
  }
  out.innerHTML = cachedData.days.map(day => {
    const isSat = day.label.includes('土');
    const slotsHtml = day.slots.map(s =>
      `<span class="slot" onclick="selectSlot('${day.date}','${s}',${cachedData.step})">${escapeHtml(s)}</span>`
    ).join('');
    return `<div class="day-block">
      <div class="day-header">
        <span class="${isSat ? 'sat' : ''}">${escapeHtml(day.label)}</span>
        <span class="day-count">${day.slots.length}枠</span>
      </div>
      <div class="slots">${slotsHtml}</div>
    </div>`;
  }).join('');
  copyWrap.hidden = false;
}

function setUnit(u) {
  unit = u;
  document.getElementById('btn60').classList.toggle('active', u === 60);
  document.getElementById('btn30').classList.toggle('active', u === 30);
  load(u, mode);
}

function setMode(m) {
  mode = m;
  document.getElementById('btnOnline').classList.toggle('active', m === 'online');
  document.getElementById('btnInperson').classList.toggle('active', m === 'inperson');
  load(unit, mode);
}

function selectSlot(date, startTime, step) {
  selectedSlot = { date, startTime, step };

  const d = new Date(date + 'T00:00:00+09:00');
  const [h, m] = startTime.split(':').map(Number);
  const endMin = h * 60 + m + step;
  const endTime = `${Math.floor(endMin / 60)}:${String(endMin % 60).padStart(2, '0')}`;
  const label = `${d.getMonth() + 1}/${d.getDate()}（${DAY_JP[d.getDay()]}） ${startTime}〜${endTime}`;

  document.getElementById('modal-slot-label').textContent = label;
  document.getElementById('modal-mode-label').textContent =
    mode === 'inperson' ? '対面（前後30分の移動時間を確保済み）' : 'オンライン';
  document.getElementById('booking-error').textContent = '';
  document.getElementById('attendee-name').value = '';
  document.getElementById('attendee-email').value = '';
  document.getElementById('modal').classList.add('show');
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
  selectedSlot = null;
  ['err-name', 'err-email'].forEach(id => { document.getElementById(id).textContent = ''; });
  ['attendee-name', 'attendee-email'].forEach(id => { document.getElementById(id).classList.remove('input-error'); });
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modal')) closeModal();
}

async function submitBooking(e) {
  e.preventDefault();
  if (!selectedSlot) return;

  const nameEl  = document.getElementById('attendee-name');
  const emailEl = document.getElementById('attendee-email');
  const name    = nameEl.value.trim();
  const email   = emailEl.value.trim();
  const btn     = document.getElementById('submit-btn');
  const errEl   = document.getElementById('booking-error');

  // カスタムバリデーション
  let valid = true;
  const errName  = document.getElementById('err-name');
  const errEmail = document.getElementById('err-email');
  errName.textContent  = '';
  errEmail.textContent = '';
  nameEl.classList.remove('input-error');
  emailEl.classList.remove('input-error');

  if (!name) {
    errName.textContent = 'お名前を入力してください';
    nameEl.classList.add('input-error');
    valid = false;
  }
  if (!email) {
    errEmail.textContent = 'メールアドレスを入力してください';
    emailEl.classList.add('input-error');
    valid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEmail.textContent = '正しいメールアドレスを入力してください';
    emailEl.classList.add('input-error');
    valid = false;
  }
  if (!valid) return;

  btn.disabled = true;
  btn.textContent = '予約中...';
  errEl.textContent = '';

  try {
    const res = await fetch(`${WORKER_URL}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: selectedSlot.date,
        startTime: selectedSlot.startTime,
        step: selectedSlot.step,
        attendeeName: name,
        attendeeEmail: email,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    closeModal();
    showToast('カレンダーに追加しました！');
    load(unit, mode); // スロット一覧を再読み込み
  } catch (err) {
    errEl.textContent = `エラー: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'ミーティングの予約をする';
  }
}

function mergeSlots(slots, step) {
  if (slots.length === 0) return [];
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const toTime = min => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
  const ranges = [];
  let start = toMin(slots[0]);
  let end = start + step;
  for (let i = 1; i < slots.length; i++) {
    const s = toMin(slots[i]);
    if (s === end) {
      end = s + step;
    } else {
      ranges.push(`${toTime(start)}~${toTime(end)}`);
      start = s;
      end = s + step;
    }
  }
  ranges.push(`${toTime(start)}~${toTime(end)}`);
  return ranges;
}

function copyAll() {
  if (!cachedData || !cachedData.days || cachedData.days.length === 0) return;
  const step = cachedData.step;
  const lines = [];
  for (const day of cachedData.days) {
    const [, mm, dd] = day.date.split('-');
    const dow = (day.label.match(/（.）/) || [''])[0];
    const prefix = `${Number(mm)}月${Number(dd)}日${dow}`;
    for (const range of mergeSlots(day.slots, step)) {
      lines.push(`${prefix}${range}`);
    }
  }
  const text = lines.join('\n');
  navigator.clipboard.writeText(text).then(() => showToast('コピーしました')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('コピーしました');
  });
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// URL パラメータから初期値を読み込む
const params = new URLSearchParams(location.search);
const tParam = parseInt(params.get('t') || '30');
unit = tParam === 60 ? 60 : 30;
mode = params.get('mode') === 'inperson' ? 'inperson' : 'online';

document.getElementById('btn60').classList.toggle('active', unit === 60);
document.getElementById('btn30').classList.toggle('active', unit === 30);
document.getElementById('btnOnline').classList.toggle('active', mode === 'online');
document.getElementById('btnInperson').classList.toggle('active', mode === 'inperson');

load(unit, mode);
