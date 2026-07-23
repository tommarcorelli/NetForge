// ---- Navigation entre modules ----
// ==================================================================
// Persistance locale (localStorage) — projets nommés multiples
// ==================================================================
const PROJECTS_KEY = 'netforge-projects-v1';
const LEGACY_STORAGE_KEY = 'netforge-state-v1'; // ancienne sauvegarde unique (avant les projets), utilisée uniquement pour la migration

function makeProjectId() {
  return 'p_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function saveProjectsData(data) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('NetForge : sauvegarde des projets impossible', e);
  }
}

function loadProjectsData() {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.projects && data.activeProjectId && data.projects[data.activeProjectId]) return data;
    }
  } catch (e) {
    console.warn('NetForge : lecture des projets impossible', e);
  }

  // Pas encore de projets multiples chez cet utilisateur : migration depuis l'ancienne sauvegarde unique (si elle existe)
  let legacyState = null;
  try {
    const oldRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (oldRaw) legacyState = JSON.parse(oldRaw);
  } catch (e) { /* ignore, on repart d'un projet vide */ }

  const id = makeProjectId();
  const data = {
    projects: {
      [id]: {
        name: 'Projet 1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        state: legacyState || {}
      }
    },
    activeProjectId: id
  };
  saveProjectsData(data);
  return data;
}

let projectsData = loadProjectsData();

function getActiveProject() {
  return projectsData.projects[projectsData.activeProjectId];
}

// Capture immédiate de l'état sauvegardé, AVANT que les rendus initiaux de chaque
// module (qui appellent saveState() dès leur chargement) ne puissent écraser le
// localStorage avec des valeurs par défaut (les variables des modules chargés plus
// tard — ex: topoVlanState, fwRules — ne sont pas encore restaurées à ce stade).
// La restauration réelle (plus bas dans l'app) utilise CET instantané figé plutôt
// que de relire le localStorage, qui peut avoir été temporairement corrompu entre-temps.
let __nfInitialSavedState = null;
try {
  const _active = getActiveProject();
  if (_active && _active.state && Object.keys(_active.state).length) {
    __nfInitialSavedState = JSON.parse(JSON.stringify(_active.state));
  }
} catch (e) { /* ignore, restauration simplement sautée */ }

// ==================================================================
// Intégrité des données — sanitisation défensive au chargement
// ==================================================================
const CURRENT_SCHEMA_VERSION = 1; // à incrémenter quand la forme des données change (ex. arrivée de l'IPv6) ; sert de point d'ancrage pour de futures migrations

const STATE_SHAPE = {
  vlanState: 'array', portState: 'array', topoVlanState: 'array',
  devices: 'array', links: 'array', fwRules: 'array', dnsRecords: 'array',
  networkGroups: 'array', serviceGroups: 'array',
  devicePorts: 'object', deviceInterfaces: 'object', deviceRoutes: 'object',
  deviceOspf: 'object', deviceNat: 'object', deviceEtherchannels: 'object',
  deviceBgp: 'object',
  deviceVtp: 'object', deviceWifi: 'object', deviceStp: 'object',
  deviceVpn: 'object', deviceSecurity: 'object',
  deviceIdSeq: 'number',
  fwPolicy: 'string', dnsZoneName: 'string', dnsPrimaryNs: 'string', dnsAdminEmail: 'string', fwFormat: 'string',
  fwZbfInsideIf: 'string', fwZbfOutsideIf: 'string',
  vlanDhcpSnooping: 'boolean', fwReflexive: 'boolean', fwIpv6: 'boolean', fwZbf: 'boolean'
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Vérifie chaque champ attendu du projet chargé ; si un champ existe mais avec un type incohérent
// (fichier corrompu, édition manuelle ratée...), il est remplacé par une valeur par défaut sûre
// au lieu de faire planter le reste de l'appli. Ne touche pas aux champs absents (comportement
// inchangé : le module garde alors sa valeur initiale déjà en mémoire).
function sanitizeState(raw) {
  if (!isPlainObject(raw)) {
    return { state: {}, repairedFields: raw ? ['(état complet)'] : [] };
  }
  const clean = {};
  const repairedFields = [];
  for (const [key, expected] of Object.entries(STATE_SHAPE)) {
    const value = raw[key];
    if (value === undefined) continue;
    let ok;
    if (expected === 'array') ok = Array.isArray(value);
    else if (expected === 'object') ok = isPlainObject(value);
    else if (expected === 'number') ok = typeof value === 'number' && !Number.isNaN(value);
    else if (expected === 'boolean') ok = typeof value === 'boolean';
    else ok = typeof value === 'string';

    if (ok) {
      clean[key] = value;
    } else {
      repairedFields.push(key);
      clean[key] = expected === 'array' ? [] : expected === 'object' ? {} : expected === 'number' ? 1 : expected === 'boolean' ? false : '';
    }
  }
  return { state: clean, repairedFields };
}

function showIntegrityNotice(repairedFields) {
  if (!repairedFields.length) return;
  const bar = document.createElement('div');
  bar.className = 'integrity-notice';
  bar.textContent = `⚠ Projet restauré partiellement — champ(s) réinitialisé(s) : ${repairedFields.join(', ')}`;
  document.body.appendChild(bar);
  setTimeout(() => bar.remove(), 8000);
}

// ==================================================================
// Historique annuler / rétablir (Ctrl+Z / Ctrl+Y) — tous les modules
// ==================================================================
const UNDO_LIMIT = 50;
let undoStack = [];
let redoStack = [];
let isRestoringState = false; // empêche l'historique de s'auto-alimenter pendant une restauration

function pushUndoSnapshot(prevState) {
  if (isRestoringState) return;
  if (!prevState || Object.keys(prevState).length === 0) return;
  const json = JSON.stringify(prevState);
  if (undoStack.length && undoStack[undoStack.length - 1] === json) return; // pas de doublon consécutif
  undoStack.push(json);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack = []; // toute nouvelle action invalide le futur "rétablir"
  updateUndoRedoButtons();
}

function replaceDict(target, source) {
  Object.keys(target).forEach(k => delete target[k]);
  Object.assign(target, source || {});
}

// Réapplique intégralement un instantané passé (undo) ou futur (redo) : réinitialise toutes les
// variables d'état des modules puis relance le rendu de chaque module concerné.
function applyStateSnapshot(json) {
  let sanitized;
  try {
    const parsed = JSON.parse(json);
    sanitized = sanitizeState(parsed).state;
  } catch (e) {
    console.warn("NetForge : instantané d'historique illisible", e);
    return;
  }

  vlanState = sanitized.vlanState || [];
  portState = sanitized.portState || [];
  topoVlanState = sanitized.topoVlanState || [];
  devices = sanitized.devices || [];
  replaceDict(devicePorts, sanitized.devicePorts);
  replaceDict(deviceInterfaces, sanitized.deviceInterfaces);
  replaceDict(deviceRoutes, sanitized.deviceRoutes);
  replaceDict(deviceOspf, sanitized.deviceOspf);
  replaceDict(deviceBgp, sanitized.deviceBgp);
  replaceDict(deviceNat, sanitized.deviceNat);
  replaceDict(deviceEtherchannels, sanitized.deviceEtherchannels);
  replaceDict(deviceVtp, sanitized.deviceVtp);
  replaceDict(deviceWifi, sanitized.deviceWifi);
  replaceDict(deviceStp, sanitized.deviceStp);
  replaceDict(deviceVpn, sanitized.deviceVpn);
  replaceDict(deviceSecurity, sanitized.deviceSecurity);
  links = sanitized.links || [];
  deviceIdSeq = sanitized.deviceIdSeq || 1;
  fwRules = sanitized.fwRules || [];
  networkGroups = sanitized.networkGroups || [];
  serviceGroups = sanitized.serviceGroups || [];
  dnsRecords = sanitized.dnsRecords || [];

  const fwPolicySelect = document.getElementById('fw-policy');
  if (fwPolicySelect) fwPolicySelect.value = sanitized.fwPolicy || 'DROP';
  const fwFormatSelect = document.getElementById('fw-format');
  if (fwFormatSelect) fwFormatSelect.value = sanitized.fwFormat || 'iptables';
  const zoneEl = document.getElementById('dns-zone-name');
  const nsEl = document.getElementById('dns-primary-ns');
  const emailEl = document.getElementById('dns-admin-email');
  if (zoneEl) zoneEl.value = sanitized.dnsZoneName || '';
  if (nsEl) nsEl.value = sanitized.dnsPrimaryNs || '';
  if (emailEl) emailEl.value = sanitized.dnsAdminEmail || '';
  const dhcpSnoopEl = document.getElementById('vlan-dhcp-snooping');
  if (dhcpSnoopEl) dhcpSnoopEl.checked = !!sanitized.vlanDhcpSnooping;
  const fwReflexiveEl = document.getElementById('fw-reflexive');
  if (fwReflexiveEl) fwReflexiveEl.checked = !!sanitized.fwReflexive;
  const fwIpv6El = document.getElementById('fw-ipv6');
  if (fwIpv6El) fwIpv6El.checked = !!sanitized.fwIpv6;
  const fwZbfEl = document.getElementById('fw-zbf');
  if (fwZbfEl) fwZbfEl.checked = !!sanitized.fwZbf;
  const fwZbfInsideEl = document.getElementById('fw-zbf-inside-if');
  if (fwZbfInsideEl) fwZbfInsideEl.value = sanitized.fwZbfInsideIf || '';
  const fwZbfOutsideEl = document.getElementById('fw-zbf-outside-if');
  if (fwZbfOutsideEl) fwZbfOutsideEl.value = sanitized.fwZbfOutsideIf || '';
  if (typeof updateFwFormatFieldsVisibility === 'function') updateFwFormatFieldsVisibility();

  if (selectedDeviceId && !devices.find(d => d.id === selectedDeviceId)) {
    selectedDeviceId = null;
  }

  isRestoringState = true;
  renderVlanChips();
  renderPortRows();
  renderDeviceList();
  renderLinkRows();
  renderTopologyDiagram();
  renderTopologyStats();
  renderTopoVlanChips();
  renderDeviceConfigPanel();
  renderOgNetRows();
  renderOgSvcRows();
  renderFwRuleRows();
  renderDnsRecRows();
  saveState(); // fige la restauration comme état courant du projet, sans repousser d'entrée d'historique (garde ci-dessus)
  isRestoringState = false;
  updateUndoRedoButtons();
}

function undo() {
  if (!undoStack.length) return;
  const active = getActiveProject();
  redoStack.push(JSON.stringify((active && active.state) || {}));
  if (redoStack.length > UNDO_LIMIT) redoStack.shift();
  applyStateSnapshot(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  const active = getActiveProject();
  undoStack.push(JSON.stringify((active && active.state) || {}));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  applyStateSnapshot(redoStack.pop());
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

document.addEventListener('keydown', (e) => {
  const ctrlOrCmd = e.ctrlKey || e.metaKey;
  if (!ctrlOrCmd) return;
  const tag = (e.target && e.target.tagName) || '';
  const typingContext = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) {
    if (typingContext) return; // laisse le champ gérer son propre undo texte natif
    e.preventDefault();
    undo();
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    if (typingContext) return;
    e.preventDefault();
    redo();
  }
});

function saveState() {
  try {
    const state = {
      vlanState: typeof vlanState !== 'undefined' ? vlanState : [],
      portState: typeof portState !== 'undefined' ? portState : [],
      topoVlanState: typeof topoVlanState !== 'undefined' ? topoVlanState : [],
      devices: typeof devices !== 'undefined' ? devices : [],
      devicePorts: typeof devicePorts !== 'undefined' ? devicePorts : {},
      deviceInterfaces: typeof deviceInterfaces !== 'undefined' ? deviceInterfaces : {},
      deviceRoutes: typeof deviceRoutes !== 'undefined' ? deviceRoutes : {},
      deviceOspf: typeof deviceOspf !== 'undefined' ? deviceOspf : {},
      deviceBgp: typeof deviceBgp !== 'undefined' ? deviceBgp : {},
      deviceNat: typeof deviceNat !== 'undefined' ? deviceNat : {},
      deviceEtherchannels: typeof deviceEtherchannels !== 'undefined' ? deviceEtherchannels : {},
      deviceVtp: typeof deviceVtp !== 'undefined' ? deviceVtp : {},
      deviceWifi: typeof deviceWifi !== 'undefined' ? deviceWifi : {},
      deviceStp: typeof deviceStp !== 'undefined' ? deviceStp : {},
      deviceVpn: typeof deviceVpn !== 'undefined' ? deviceVpn : {},
      deviceSecurity: typeof deviceSecurity !== 'undefined' ? deviceSecurity : {},
      links: typeof links !== 'undefined' ? links : [],
      deviceIdSeq: typeof deviceIdSeq !== 'undefined' ? deviceIdSeq : 1,
      fwRules: typeof fwRules !== 'undefined' ? fwRules : [],
      fwPolicy: (typeof document !== 'undefined' && document.getElementById('fw-policy')) ? document.getElementById('fw-policy').value : 'DROP',
      fwFormat: (typeof document !== 'undefined' && document.getElementById('fw-format')) ? document.getElementById('fw-format').value : 'iptables',
      dnsRecords: typeof dnsRecords !== 'undefined' ? dnsRecords : [],
      networkGroups: typeof networkGroups !== 'undefined' ? networkGroups : [],
      serviceGroups: typeof serviceGroups !== 'undefined' ? serviceGroups : [],
      dnsZoneName: (typeof document !== 'undefined' && document.getElementById('dns-zone-name')) ? document.getElementById('dns-zone-name').value : '',
      dnsPrimaryNs: (typeof document !== 'undefined' && document.getElementById('dns-primary-ns')) ? document.getElementById('dns-primary-ns').value : '',
      dnsAdminEmail: (typeof document !== 'undefined' && document.getElementById('dns-admin-email')) ? document.getElementById('dns-admin-email').value : '',
      vlanDhcpSnooping: (typeof document !== 'undefined' && document.getElementById('vlan-dhcp-snooping')) ? document.getElementById('vlan-dhcp-snooping').checked : false,
      fwReflexive: (typeof document !== 'undefined' && document.getElementById('fw-reflexive')) ? document.getElementById('fw-reflexive').checked : false,
      fwIpv6: (typeof document !== 'undefined' && document.getElementById('fw-ipv6')) ? document.getElementById('fw-ipv6').checked : false,
      fwZbf: (typeof document !== 'undefined' && document.getElementById('fw-zbf')) ? document.getElementById('fw-zbf').checked : false,
      fwZbfInsideIf: (typeof document !== 'undefined' && document.getElementById('fw-zbf-inside-if')) ? document.getElementById('fw-zbf-inside-if').value : '',
      fwZbfOutsideIf: (typeof document !== 'undefined' && document.getElementById('fw-zbf-outside-if')) ? document.getElementById('fw-zbf-outside-if').value : ''
    };
    state.schemaVersion = CURRENT_SCHEMA_VERSION;
    const active = getActiveProject();
    if (active) {
      pushUndoSnapshot(active.state);
      active.state = state;
      active.updatedAt = Date.now();
      saveProjectsData(projectsData);
    }
  } catch (e) {
    console.warn('NetForge : sauvegarde locale impossible', e);
  }
}

function loadState() {
  const active = getActiveProject();
  return (active && active.state && Object.keys(active.state).length) ? active.state : null;
}

function clearSavedState() {
  const active = getActiveProject();
  if (active) {
    active.state = {};
    saveProjectsData(projectsData);
  }
}

// ==================================================================
// Gestion des projets (sélecteur, nouveau, renommer, supprimer)
// ==================================================================
function renderProjectSelect() {
  const select = document.getElementById('project-select');
  if (!select) return;
  const projects = projectsData.projects;
  select.innerHTML = Object.keys(projects)
    .sort((a, b) => (projects[a].createdAt || 0) - (projects[b].createdAt || 0))
    .map(id => `<option value="${id}"${id === projectsData.activeProjectId ? ' selected' : ''}>${escapeHtml(projects[id].name)}</option>`)
    .join('');
}

function switchToProject(id) {
  if (!projectsData.projects[id] || id === projectsData.activeProjectId) return;
  projectsData.activeProjectId = id;
  saveProjectsData(projectsData);
  location.reload();
}

function createNewProject() {
  const name = prompt('Nom du nouveau projet :', 'Nouveau projet');
  if (name === null) return;
  const trimmed = name.trim() || 'Nouveau projet';
  const id = makeProjectId();
  projectsData.projects[id] = { name: trimmed, createdAt: Date.now(), updatedAt: Date.now(), state: {} };
  projectsData.activeProjectId = id;
  saveProjectsData(projectsData);
  location.reload();
}

function renameActiveProject() {
  const active = getActiveProject();
  if (!active) return;
  const name = prompt('Renommer le projet :', active.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  active.name = trimmed;
  saveProjectsData(projectsData);
  renderProjectSelect();
}

function deleteActiveProject() {
  const ids = Object.keys(projectsData.projects);
  if (ids.length <= 1) {
    alert('Impossible de supprimer le dernier projet restant.');
    return;
  }
  const active = getActiveProject();
  if (!confirm(`Supprimer définitivement le projet "${active.name}" ? Cette action est irréversible.`)) return;
  delete projectsData.projects[projectsData.activeProjectId];
  const remainingIds = Object.keys(projectsData.projects).sort((a, b) => (projectsData.projects[a].createdAt || 0) - (projectsData.projects[b].createdAt || 0));
  projectsData.activeProjectId = remainingIds[0];
  saveProjectsData(projectsData);
  location.reload();
}

renderProjectSelect();
const projectSelectEl = document.getElementById('project-select');
if (projectSelectEl) projectSelectEl.addEventListener('change', (e) => switchToProject(e.target.value));
const projectNewBtn = document.getElementById('project-new-btn');
if (projectNewBtn) projectNewBtn.addEventListener('click', createNewProject);
const projectRenameBtn = document.getElementById('project-rename-btn');
if (projectRenameBtn) projectRenameBtn.addEventListener('click', renameActiveProject);
const projectDeleteBtn = document.getElementById('project-delete-btn');
if (projectDeleteBtn) projectDeleteBtn.addEventListener('click', deleteActiveProject);

const undoBtn = document.getElementById('undo-btn');
if (undoBtn) undoBtn.addEventListener('click', undo);
const redoBtn = document.getElementById('redo-btn');
if (redoBtn) redoBtn.addEventListener('click', redo);
updateUndoRedoButtons();


const navItems = document.querySelectorAll('.nav-item');
const modules = document.querySelectorAll('.module');

navItems.forEach(item => {
  item.addEventListener('click', () => {
    navItems.forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    const target = item.dataset.module;
    modules.forEach(m => m.classList.add('hidden'));
    document.getElementById(`module-${target}`).classList.remove('hidden');
  });
});

// ==================================================================
// Fonctions IP de base
// ==================================================================
function ipToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
  return (parts[0] << 24 | parts[1] << 16 | parts[2] << 8 | parts[3]) >>> 0;
}

function intToIp(int) {
  return [
    (int >>> 24) & 255,
    (int >>> 16) & 255,
    (int >>> 8) & 255,
    int & 255
  ].join('.');
}

function maskFromCidr(cidr) {
  return cidr === 0 ? 0 : (0xFFFFFFFF << (32 - cidr)) >>> 0;
}

function ipType(ipInt) {
  const inRange = (base, bits) => (ipInt & maskFromCidr(bits)) === (ipToInt(base) & maskFromCidr(bits));
  if (inRange('10.0.0.0', 8)) return 'Privée (classe A)';
  if (inRange('172.16.0.0', 12)) return 'Privée (classe B)';
  if (inRange('192.168.0.0', 16)) return 'Privée (classe C)';
  if (inRange('127.0.0.0', 8)) return 'Loopback';
  if (inRange('169.254.0.0', 16)) return 'APIPA (link-local)';
  return 'Publique';
}

function toBinaryOctets(int) {
  return [24, 16, 8, 0].map(shift => ((int >>> shift) & 255).toString(2).padStart(8, '0'));
}

function renderBinary(int, cidr) {
  const octets = toBinaryOctets(int);
  let bitIndex = 0;
  return octets.map(octet => {
    const spans = octet.split('').map(bit => {
      const cls = bitIndex < cidr ? 'bit-net' : 'bit-host';
      bitIndex++;
      return `<span class="${cls}">${bit}</span>`;
    }).join('');
    return `<span class="octet">${spans}</span>`;
  }).join('<span class="dot">.</span>');
}

