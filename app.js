const CONFIG = {
  owner: 'MrLion303',
  repo: 'negativeclient-countdowns',
  branch: 'main',
  dataPath: 'data/countdowns.json'
};

const RAW_URL = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${CONFIG.dataPath}`;
const API_URL = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.dataPath}`;

let githubToken = '';
let state = { schema: 1, updatedAt: null, countdowns: [] };
let tickTimer = null;

const $ = (id) => document.getElementById(id);
const grid = $('grid');
const empty = $('empty');
const summary = $('summary');
const statusDot = $('statusDot');
const statusText = $('statusText');
const authButton = $('authButton');
const newButton = $('newButton');
const refreshButton = $('refreshButton');
const editModal = $('editModal');
const authModal = $('authModal');
const form = $('form');
const idInput = $('idInput');
const nameInput = $('nameInput');
const dateInput = $('dateInput');
const timeInput = $('timeInput');
const editTitle = $('editTitle');
const tokenInput = $('tokenInput');
const connectButton = $('connectButton');
const authError = $('authError');
const template = $('cardTemplate');

function nowUtcMs() {
  return Date.now();
}

function parseUtc(iso) {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : NaN;
}

function isExpired(item) {
  const end = parseUtc(item.endAtUtc);
  return !Number.isFinite(end) || end <= nowUtcMs();
}

function formatUtcDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Fecha inválida';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function formatRemaining(iso) {
  const end = parseUtc(iso);
  if (!Number.isFinite(end)) return '—';
  let seconds = Math.max(0, Math.floor((end - nowUtcMs()) / 1000));
  const days = Math.floor(seconds / 86400);
  seconds -= days * 86400;
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds - minutes * 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(days)}:${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

function makeId(name) {
  const base = (name || 'countdown')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'countdown';

  let id = base;
  let i = 2;
  const used = new Set(state.countdowns.map((x) => x.id));
  while (used.has(id)) id = `${base}-${i++}`;
  return id;
}

function setConnected(connected) {
  statusDot.classList.toggle('connected', connected);
  statusText.textContent = connected
    ? 'Administración autorizada · los cambios se publicarán en GitHub'
    : 'Modo lectura · autoriza GitHub para administrar';
  authButton.textContent = connected ? 'AUTORIZADO' : 'AUTORIZAR';
}

function setBusy(busy) {
  newButton.disabled = busy;
  refreshButton.disabled = busy;
}

function showToast(message, error = false) {
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  const el = document.createElement('div');
  el.className = `toast${error ? ' error-toast' : ''}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function normalizeState(data) {
  const source = data && typeof data === 'object' ? data : {};
  const countdowns = Array.isArray(source.countdowns) ? source.countdowns : [];
  return {
    schema: Number(source.schema) || 1,
    updatedAt: source.updatedAt || null,
    countdowns: countdowns
      .filter((x) => x && typeof x === 'object')
      .map((x) => ({
        id: String(x.id || ''),
        name: String(x.name || 'Sin nombre'),
        endAtUtc: String(x.endAtUtc || ''),
        active: Boolean(x.active)
      }))
      .filter((x) => x.id)
  };
}

async function loadPublicData(showMessage = false) {
  setBusy(true);
  try {
    const response = await fetch(`${RAW_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`GitHub devolvió ${response.status}`);
    state = normalizeState(await response.json());
    render();
    if (showMessage) showToast('Información actualizada.');
  } catch (error) {
    console.error(error);
    showToast('No se pudo cargar countdowns.json.', true);
  } finally {
    setBusy(false);
  }
}

function render() {
  grid.innerHTML = '';

  const items = [...state.countdowns].sort((a, b) => {
    const aRank = a.active && !isExpired(a) ? 0 : a.active ? 1 : 2;
    const bRank = b.active && !isExpired(b) ? 0 : b.active ? 1 : 2;
    if (aRank !== bRank) return aRank - bRank;
    return parseUtc(a.endAtUtc) - parseUtc(b.endAtUtc);
  });

  empty.hidden = items.length !== 0;
  grid.hidden = items.length === 0;

  const live = items.filter((x) => x.active && !isExpired(x)).length;
  summary.textContent = `${items.length} creada${items.length === 1 ? '' : 's'} · ${live} activa${live === 1 ? '' : 's'}`;

  for (const item of items) {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.card');
    const pill = node.querySelector('.pill');
    const name = node.querySelector('.card-name');
    const date = node.querySelector('.card-date');
    const preview = node.querySelector('.count-preview');
    const edit = node.querySelector('.edit-link');
    const del = node.querySelector('.delete-btn');
    const action = node.querySelector('.action-btn');

    const expired = isExpired(item);
    name.textContent = item.name;
    date.textContent = `Termina ${formatUtcDate(item.endAtUtc)}`;
    preview.dataset.end = item.endAtUtc;
    preview.textContent = expired ? '00:00:00:00' : formatRemaining(item.endAtUtc);

    if (item.active && !expired) {
      pill.textContent = '● ACTIVO';
      pill.classList.add('active');
    } else if (item.active && expired) {
      pill.textContent = 'FINALIZADO';
      pill.classList.add('finished');
    } else {
      pill.textContent = '○ DETENIDO';
    }

    action.textContent = item.active ? 'DETENER' : 'INICIAR';
    action.classList.toggle('stop', item.active);
    action.disabled = !githubToken;
    edit.disabled = !githubToken;
    del.disabled = !githubToken;

    edit.addEventListener('click', () => openEdit(item));
    del.addEventListener('click', () => deleteCountdown(item));
    action.addEventListener('click', () => toggleCountdown(item));

    card.dataset.id = item.id;
    grid.appendChild(node);
  }

  restartTicker();
}

function restartTicker() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    document.querySelectorAll('.count-preview[data-end]').forEach((el) => {
      el.textContent = formatRemaining(el.dataset.end);
    });
  }, 1000);
}

function openModal(el) {
  el.hidden = false;
}

function closeModal(el) {
  el.hidden = true;
}

function openNew() {
  if (!githubToken) {
    openModal(authModal);
    return;
  }
  editTitle.textContent = 'Nueva cuenta regresiva';
  idInput.value = '';
  nameInput.value = '';
  const tomorrow = new Date(Date.now() + 86400000);
  dateInput.value = tomorrow.toISOString().slice(0, 10);
  timeInput.value = '18:00:00';
  openModal(editModal);
  setTimeout(() => nameInput.focus(), 0);
}

function openEdit(item) {
  if (!githubToken) return;
  editTitle.textContent = 'Editar cuenta regresiva';
  idInput.value = item.id;
  nameInput.value = item.name;
  const d = new Date(item.endAtUtc);
  const pad = (n) => String(n).padStart(2, '0');
  dateInput.value = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  timeInput.value = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  openModal(editModal);
}

function getUtcIsoFromForm() {
  const date = dateInput.value;
  const time = timeInput.value.length === 5 ? `${timeInput.value}:00` : timeInput.value;
  const iso = `${date}T${time}Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) throw new Error('Fecha u hora inválida.');
  return parsed.toISOString().replace('.000Z', 'Z');
}

async function getRemoteDocument() {
  if (!githubToken) throw new Error('No estás autorizado.');
  const response = await fetch(`${API_URL}?ref=${encodeURIComponent(CONFIG.branch)}&t=${Date.now()}`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28'
    },
    cache: 'no-store'
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`GitHub ${response.status}: ${details}`);
  }
  const doc = await response.json();
  const decoded = decodeBase64Utf8(String(doc.content || '').replace(/\s/g, ''));
  return { sha: doc.sha, data: normalizeState(JSON.parse(decoded)) };
}

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeBase64Utf8(base64) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function saveMutation(mutator, commitMessage) {
  setBusy(true);
  try {
    const remote = await getRemoteDocument();
    const next = normalizeState(remote.data);
    mutator(next);
    next.updatedAt = new Date().toISOString().replace('.000Z', 'Z');

    const body = JSON.stringify(next, null, 2) + '\n';
    const response = await fetch(API_URL, {
      method: 'PUT',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: commitMessage,
        content: encodeBase64Utf8(body),
        sha: remote.sha,
        branch: CONFIG.branch
      })
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`GitHub ${response.status}: ${details}`);
    }

    state = next;
    render();
    showToast('Cambio publicado para todos los launchers.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'No se pudo guardar el cambio.', true);
  } finally {
    setBusy(false);
  }
}

async function toggleCountdown(item) {
  const desired = !item.active;
  if (desired && isExpired(item)) {
    showToast('Edita primero la fecha: esta cuenta ya terminó.', true);
    return;
  }
  await saveMutation((next) => {
    const target = next.countdowns.find((x) => x.id === item.id);
    if (!target) throw new Error('La cuenta ya no existe.');
    target.active = desired;
  }, `${desired ? 'Start' : 'Stop'} countdown: ${item.name}`);
}

async function deleteCountdown(item) {
  if (!confirm(`¿Eliminar "${item.name}"?`)) return;
  await saveMutation((next) => {
    next.countdowns = next.countdowns.filter((x) => x.id !== item.id);
  }, `Delete countdown: ${item.name}`);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!githubToken) return;

  try {
    const name = nameInput.value.trim();
    if (!name) throw new Error('Escribe un nombre.');
    const endAtUtc = getUtcIsoFromForm();
    const existingId = idInput.value;

    await saveMutation((next) => {
      if (existingId) {
        const target = next.countdowns.find((x) => x.id === existingId);
        if (!target) throw new Error('La cuenta ya no existe.');
        target.name = name;
        target.endAtUtc = endAtUtc;
      } else {
        next.countdowns.push({
          id: makeId(name),
          name,
          endAtUtc,
          active: false
        });
      }
    }, existingId ? `Edit countdown: ${name}` : `Create countdown: ${name}`);

    closeModal(editModal);
  } catch (error) {
    showToast(error.message || 'No se pudo guardar.', true);
  }
});

authButton.addEventListener('click', () => openModal(authModal));
newButton.addEventListener('click', openNew);
$('emptyCreateButton').addEventListener('click', openNew);
refreshButton.addEventListener('click', () => loadPublicData(true));

connectButton.addEventListener('click', async () => {
  authError.hidden = true;
  const candidate = tokenInput.value.trim();
  if (!candidate) {
    authError.textContent = 'Introduce tu token.';
    authError.hidden = false;
    return;
  }

  githubToken = candidate;
  try {
    await getRemoteDocument();
    tokenInput.value = '';
    setConnected(true);
    closeModal(authModal);
    render();
    showToast('Administración autorizada.');
  } catch (error) {
    githubToken = '';
    setConnected(false);
    authError.textContent = 'No se pudo autorizar. Revisa el token y sus permisos.';
    authError.hidden = false;
    console.error(error);
  }
});

document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => closeModal($(button.dataset.close)));
});

document.querySelectorAll('.modal-wrap').forEach((wrap) => {
  wrap.addEventListener('click', (event) => {
    if (event.target === wrap) closeModal(wrap);
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeModal(editModal);
    closeModal(authModal);
  }
});

setConnected(false);
loadPublicData();
