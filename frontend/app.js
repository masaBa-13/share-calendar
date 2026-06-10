const WORKER_URL = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname.startsWith('192.168.')
  ? `http://${location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'localhost' : location.hostname}:8787`
  : 'https://free-slot-worker.miraidai.workers.dev';

const DAY_JP = ['日', '月', '火', '水', '木', '金', '土'];

let unit = 30;
let mode = 'online';
let cachedData = null;
let selectedSlot = null; // { date, startTime, step }

async function load(u, m) {
  const out = document.getElementById('output');
  out.innerHTML = '<p class="loading">読み込み中...</p>';
  try {
    const res = await fetch(`${WORKER_URL}/api/slots?t=${u}&mode=${m}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    cachedData = await res.json();
    render();
  } catch (e) {
    out.innerHTML = `<p class="error">エラー: ${escapeHtml(e.message)}</p>`;
  }
}

function render() {
  if (!cachedData) return;
  const out = document.getElementById('output');
  if (!cachedData.days || cachedData.days.length === 0) {
    out.innerHTML = '<p class="empty">空き時間がありません</p>';
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
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modal')) closeModal();
}

async function submitBooking(e) {
  e.preventDefault();
  if (!selectedSlot) return;

  const name  = document.getElementById('attendee-name').value.trim();
  const email = document.getElementById('attendee-email').value.trim();
  const btn   = document.getElementById('submit-btn');
  const errEl = document.getElementById('booking-error');

  btn.disabled = true;
  btn.textContent = '追加中...';
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
    btn.textContent = 'カレンダーに追加';
  }
}

function copyAll() {
  if (!cachedData || !cachedData.days || cachedData.days.length === 0) return;
  const text = cachedData.days.map(d => `${d.label}: ${d.slots.join(', ')}`).join('\n');
  navigator.clipboard.writeText(text).then(() => showToast('コピーしました！')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('コピーしました！');
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
