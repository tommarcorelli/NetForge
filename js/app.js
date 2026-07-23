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

// ==================================================================
// Calculateur simple
// ==================================================================
function calculateSubnet(input) {
  const match = input.trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
  if (!match) throw new Error("Format attendu : ex. 192.168.10.0/24");

  const [, ip, cidrStr] = match;
  const cidr = parseInt(cidrStr, 10);
  if (cidr < 0 || cidr > 32) throw new Error("Le CIDR doit être compris entre 0 et 32");

  const ipInt = ipToInt(ip);
  if (ipInt === null) throw new Error("Adresse IP invalide");

  const maskInt = maskFromCidr(cidr);
  const wildcardInt = (~maskInt) >>> 0;
  const networkInt = (ipInt & maskInt) >>> 0;
  const broadcastInt = (networkInt | wildcardInt) >>> 0;

  const totalHosts = Math.pow(2, 32 - cidr);
  const usableHosts = cidr >= 31 ? 0 : totalHosts - 2;

  const firstUsable = cidr >= 31 ? networkInt : networkInt + 1;
  const lastUsable = cidr >= 31 ? broadcastInt : broadcastInt - 1;

  return {
    ipInt, cidr, networkInt, maskInt, broadcastInt,
    network: intToIp(networkInt),
    mask: intToIp(maskInt),
    wildcard: intToIp(wildcardInt),
    broadcast: intToIp(broadcastInt),
    hosts: usableHosts,
    total: totalHosts,
    first: intToIp(firstUsable >>> 0),
    last: intToIp(lastUsable >>> 0),
    type: ipType(ipInt)
  };
}

const calcBtn = document.getElementById('calc-btn');
const ipInput = document.getElementById('ip-input');
const errorBox = document.getElementById('calc-error');
const resultsBox = document.getElementById('results');
const binaryBox = document.getElementById('binary-box');

calcBtn.addEventListener('click', () => {
  errorBox.classList.add('hidden');
  resultsBox.classList.add('hidden');
  binaryBox.classList.add('hidden');

  try {
    const r = calculateSubnet(ipInput.value);
    document.getElementById('r-network').textContent = r.network;
    document.getElementById('r-mask').textContent = r.mask;
    document.getElementById('r-wildcard').textContent = r.wildcard;
    document.getElementById('r-broadcast').textContent = r.broadcast;
    document.getElementById('r-hosts').textContent = r.hosts;
    document.getElementById('r-first').textContent = r.first;
    document.getElementById('r-last').textContent = r.last;
    document.getElementById('r-type').textContent = r.type;

    document.getElementById('bin-network').innerHTML = renderBinary(r.networkInt, r.cidr);
    document.getElementById('bin-mask').innerHTML = renderBinary(r.maskInt, r.cidr);

    lastUsedCidr = r.cidr;

    resultsBox.classList.remove('hidden');
    binaryBox.classList.remove('hidden');
  } catch (e) {
    errorBox.textContent = e.message;
    errorBox.classList.remove('hidden');
  }
});

ipInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') calcBtn.click();
});

// Copier au clic sur une result-card
document.addEventListener('click', (e) => {
  const card = e.target.closest('.result-card[data-copy]');
  if (!card) return;
  const value = card.querySelector('.v').textContent;
  navigator.clipboard.writeText(value).then(() => {
    card.classList.add('copied');
    setTimeout(() => card.classList.remove('copied'), 700);
  });
});

// ==================================================================
// Découpage VLSM
// ==================================================================
function calculateVLSM(baseInput, hostsInput) {
  const base = calculateSubnet(baseInput.includes('/') ? baseInput : baseInput + '/24');
  const baseMatch = baseInput.trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
  if (!baseMatch) throw new Error("Réseau de base invalide : ex. 192.168.0.0/22");
  const baseCidr = parseInt(baseMatch[2], 10);
  const baseNetworkInt = ipToInt(baseMatch[1]) & maskFromCidr(baseCidr);
  const totalSpace = Math.pow(2, 32 - baseCidr);

  const requests = hostsInput.split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n) && n > 0);

  if (requests.length === 0) throw new Error("Indique au moins un besoin en hôtes, ex : 50,20,10,5");

  // On garde l'ordre demandé pour l'affichage, mais on alloue du plus grand au plus petit (algo VLSM standard)
  const withIndex = requests.map((hosts, i) => ({ hosts, i }));
  const sorted = [...withIndex].sort((a, b) => b.hosts - a.hosts);

  let offset = 0;
  const allocations = [];

  for (const req of sorted) {
    const neededBits = Math.max(2, Math.ceil(Math.log2(req.hosts + 2)));
    const size = Math.pow(2, neededBits);
    const alignedOffset = Math.ceil(offset / size) * size;

    if (alignedOffset + size > totalSpace) {
      throw new Error(`Espace insuffisant dans ${baseInput} pour satisfaire le besoin de ${req.hosts} hôtes (et les précédents)`);
    }

    const networkInt = baseNetworkInt + alignedOffset;
    const cidr = 32 - neededBits;
    const maskInt = maskFromCidr(cidr);
    const broadcastInt = networkInt + size - 1;

    allocations.push({
      originalIndex: req.i,
      requestedHosts: req.hosts,
      network: intToIp(networkInt >>> 0),
      cidr,
      mask: intToIp(maskInt),
      broadcast: intToIp(broadcastInt >>> 0),
      first: intToIp((networkInt + 1) >>> 0),
      last: intToIp((broadcastInt - 1) >>> 0),
      availableHosts: size - 2,
      size,
      offset: alignedOffset
    });

    offset = alignedOffset + size;
  }

  allocations.sort((a, b) => a.originalIndex - b.originalIndex);

  return { allocations, totalSpace, usedSpace: offset, baseCidr, baseNetworkInt };
}

const vlsmBtn = document.getElementById('vlsm-btn');
const vlsmBase = document.getElementById('vlsm-base');
const vlsmHosts = document.getElementById('vlsm-hosts');
const vlsmError = document.getElementById('vlsm-error');
const vlsmResults = document.getElementById('vlsm-results');
const vlsmTableBody = document.querySelector('#vlsm-table tbody');
const vlsmBar = document.getElementById('vlsm-bar');
const vlsmExportBtn = document.getElementById('vlsm-export-btn');

let lastVlsmResult = null;
let lastVlsmBase = '';

const barColors = ['#4CF3FF', '#C25CFF', '#FFB454', '#5CFFA0', '#FF5C7A', '#8CA0FF'];

vlsmBtn.addEventListener('click', () => {
  vlsmError.classList.add('hidden');
  vlsmResults.classList.add('hidden');

  try {
    const result = calculateVLSM(vlsmBase.value, vlsmHosts.value);
    lastVlsmResult = result;
    lastVlsmBase = vlsmBase.value.trim();

    vlsmTableBody.innerHTML = result.allocations.map((a, idx) => `
      <tr>
        <td>LAN ${idx + 1}</td>
        <td>${a.requestedHosts}</td>
        <td>${a.network}/${a.cidr}</td>
        <td>${a.mask}</td>
        <td>${a.broadcast}</td>
        <td>${a.first} → ${a.last}</td>
        <td>${a.availableHosts}</td>
      </tr>
    `).join('');

    vlsmBar.innerHTML = result.allocations.map((a, idx) => {
      const pct = (a.size / result.totalSpace * 100).toFixed(2);
      const color = barColors[idx % barColors.length];
      return `<div class="bar-seg" style="width:${pct}%; background:${color};" title="LAN ${idx + 1} — ${a.network}/${a.cidr} (${a.requestedHosts} hôtes demandés)"></div>`;
    }).join('');
    const freePct = ((result.totalSpace - result.usedSpace) / result.totalSpace * 100).toFixed(2);
    if (freePct > 0) {
      vlsmBar.innerHTML += `<div class="bar-seg bar-free" style="width:${freePct}%;" title="Espace libre"></div>`;
    }

    vlsmResults.classList.remove('hidden');
  } catch (e) {
    vlsmError.textContent = e.message;
    vlsmError.classList.remove('hidden');
  }
});

vlsmExportBtn.addEventListener('click', () => {
  if (!lastVlsmResult) return;

  let content = `NetForge — Plan d'adressage VLSM\n`;
  content += `Réseau de base : ${lastVlsmBase}\n`;
  content += `Généré le : ${new Date().toLocaleString('fr-FR')}\n`;
  content += `${'='.repeat(70)}\n\n`;

  lastVlsmResult.allocations.forEach((a, idx) => {
    content += `LAN ${idx + 1} — ${a.requestedHosts} hôtes demandés\n`;
    content += `  Réseau        : ${a.network}/${a.cidr}\n`;
    content += `  Masque        : ${a.mask}\n`;
    content += `  Broadcast     : ${a.broadcast}\n`;
    content += `  Plage utile   : ${a.first} -> ${a.last}\n`;
    content += `  Hôtes dispo   : ${a.availableHosts}\n\n`;
  });

  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plan-adressage-vlsm.txt';
  a.click();
  URL.revokeObjectURL(url);
});

// ---- Indicateur de capacité en direct ----
const capacityHint = document.getElementById('vlsm-capacity-hint');

vlsmBase.addEventListener('input', () => {
  const match = vlsmBase.value.trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
  if (!match) {
    capacityHint.textContent = '';
    capacityHint.className = 'hint';
    return;
  }
  const cidr = parseInt(match[2], 10);
  if (cidr < 0 || cidr > 30) {
    capacityHint.textContent = 'CIDR hors plage utile (0-30)';
    capacityHint.className = 'hint hint-warn';
    return;
  }
  const ipInt = ipToInt(match[1]);
  if (ipInt === null) { capacityHint.textContent = ''; capacityHint.className = 'hint'; return; }

  const total = Math.pow(2, 32 - cidr);
  const usable = total - 2;
  const networkInt = ipInt & maskFromCidr(cidr);
  const alignedNet = intToIp(networkInt >>> 0);
  const wasAligned = networkInt === ipInt;

  capacityHint.textContent = wasAligned
    ? `Capacité : ${total} adresses (${usable} hôtes utilisables au total à répartir)`
    : `Capacité : ${total} adresses (${usable} hôtes utilisables) — réseau réellement aligné sur ${alignedNet}/${cidr}`;
  capacityHint.className = 'hint hint-ok';
});

// ---- Résumé de route (agrégation / summarization) ----
function calculateSummary(input) {
  const tokens = input.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  if (tokens.length < 2) throw new Error("Indique au moins deux réseaux à résumer, ex : 192.168.0.0/24, 192.168.1.0/24");

  const nets = tokens.map(t => {
    const match = t.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
    if (!match) throw new Error(`Réseau invalide : "${t}" — format attendu ex. 192.168.0.0/24`);
    const cidr = parseInt(match[2], 10);
    if (cidr < 0 || cidr > 32) throw new Error(`CIDR invalide dans "${t}"`);
    const ipInt = ipToInt(match[1]);
    if (ipInt === null) throw new Error(`Adresse IP invalide dans "${t}"`);
    const networkInt = (ipInt & maskFromCidr(cidr)) >>> 0;
    return { networkInt, cidr, size: Math.pow(2, 32 - cidr), original: t };
  });

  // Trouve le plus petit CIDR commun (le plus englobant) tel que tous les réseaux
  // tiennent dans un unique bloc aligné, en partant du CIDR le plus restrictif observé.
  const minCidr = Math.min(...nets.map(n => n.cidr));
  let commonCidr = minCidr;

  for (let c = minCidr; c >= 0; c--) {
    const blockMask = maskFromCidr(c);
    const firstBlock = nets[0].networkInt & blockMask;
    const allSameBlock = nets.every(n => (n.networkInt & blockMask) === firstBlock);
    if (allSameBlock) {
      commonCidr = c;
      break;
    }
    if (c === 0) commonCidr = 0;
  }

  const blockMask = maskFromCidr(commonCidr);
  const summaryNetworkInt = (nets[0].networkInt & blockMask) >>> 0;
  const summarySize = Math.pow(2, 32 - commonCidr);

  // Calcule l'espace réellement occupé par les réseaux fournis pour signaler
  // si l'agrégation englobe aussi des adresses non couvertes par la demande initiale.
  const totalRequested = nets.reduce((sum, n) => sum + n.size, 0);
  const overshoot = summarySize > totalRequested;

  return {
    network: intToIp(summaryNetworkInt),
    cidr: commonCidr,
    mask: intToIp(blockMask),
    size: summarySize,
    count: nets.length,
    overshoot,
    totalRequested
  };
}

const summaryBtn = document.getElementById('summary-btn');
const summaryNetworksInput = document.getElementById('summary-networks');
const summaryError = document.getElementById('summary-error');
const summaryResults = document.getElementById('summary-results');
const summaryNote = document.getElementById('summary-note');

summaryBtn.addEventListener('click', () => {
  summaryError.classList.add('hidden');
  summaryResults.classList.add('hidden');
  summaryNote.classList.add('hidden');
  try {
    const result = calculateSummary(summaryNetworksInput.value);
    document.getElementById('summary-route').textContent = `${result.network}/${result.cidr}`;
    document.getElementById('summary-count').textContent = `${result.count} réseaux`;
    document.getElementById('summary-space').textContent = `${result.size} adresses (masque ${result.mask})`;
    summaryResults.classList.remove('hidden');
    if (result.overshoot) {
      summaryNote.textContent = `⚠ Cette route résumée couvre ${result.size} adresses alors que ${result.totalRequested} seulement étaient demandées : elle inclut donc des sous-réseaux supplémentaires non listés ici. C'est normal (l'agrégation CIDR doit être un bloc aligné en puissance de 2) mais à vérifier avant de l'annoncer en production.`;
      summaryNote.classList.remove('hidden');
    }
  } catch (e) {
    summaryError.textContent = e.message;
    summaryError.classList.remove('hidden');
  }
});

// ---- Calculateur IPv6 ----
function parseIPv6ToBigInt(addr) {
  addr = addr.trim();
  if (!addr) return null;
  const hasDoubleColon = addr.includes('::');
  if ((addr.match(/::/g) || []).length > 1) return null;

  let head = addr, tail = '';
  if (hasDoubleColon) {
    const parts = addr.split('::');
    head = parts[0];
    tail = parts[1] || '';
  }
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];

  if (!hasDoubleColon && headGroups.length !== 8) return null;
  if (hasDoubleColon && headGroups.length + tailGroups.length >= 8) return null;

  const allGroups = [...headGroups];
  if (hasDoubleColon) {
    const missing = 8 - headGroups.length - tailGroups.length;
    for (let i = 0; i < missing; i++) allGroups.push('0');
    allGroups.push(...tailGroups);
  }
  if (allGroups.length !== 8) return null;

  let big = 0n;
  for (const g of allGroups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    big = (big << 16n) | BigInt(parseInt(g, 16));
  }
  return big;
}

function bigIntToIPv6Groups(big) {
  const groups = [];
  for (let i = 7; i >= 0; i--) {
    groups.push(Number((big >> BigInt(i * 16)) & 0xffffn));
  }
  return groups;
}

function expandIPv6(big) {
  return bigIntToIPv6Groups(big).map(g => g.toString(16).padStart(4, '0')).join(':');
}

function compressIPv6(big) {
  const groups = bigIntToIPv6Groups(big).map(g => g.toString(16));
  // Trouve la plus longue série de groupes "0" consécutifs (RFC 5952) pour la remplacer par "::"
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === '0') {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
    } else {
      curStart = -1; curLen = 0;
    }
  }
  if (bestLen < 2) return groups.join(':');
  const before = groups.slice(0, bestStart).join(':');
  const after = groups.slice(bestStart + bestLen).join(':');
  return `${before}::${after}`;
}

function classifyIPv6(big) {
  if (big === 0n) return 'Non spécifiée (::)';
  if (big === 1n) return 'Loopback (::1)';
  const top16 = big >> 112n;
  const top8 = big >> 120n;
  const top10 = big >> 118n;
  const top7 = big >> 121n;
  if (top16 === 0x2001n && ((big >> 96n) & 0xffffn) === 0x0db8n) return 'Documentation (RFC 3849, réservée pour exemples)';
  if (top8 === 0xffn) return 'Multicast (ff00::/8)';
  if (top10 === 0x3fan) return 'Link-local (fe80::/10)'; // 0xfe80 >> 6 == 0x3fa
  if (top7 === 0x7en) return 'Unique local / ULA (fc00::/7, adressage privé)'; // 0xfc >> 1 == 0x7e
  if (top16 === 0x2002n) return '6to4 (2002::/16)';
  return 'Unicast global';
}

const v6CalcBtn = document.getElementById('v6-calc-btn');
const v6Input = document.getElementById('v6-input');
const v6Error = document.getElementById('v6-error');
const v6Results = document.getElementById('v6-results');
const v6SubnetsBox = document.getElementById('v6-subnets-box');

v6CalcBtn.addEventListener('click', () => {
  v6Error.classList.add('hidden');
  v6Results.classList.add('hidden');
  v6SubnetsBox.classList.add('hidden');
  try {
    const raw = v6Input.value.trim();
    const match = raw.match(/^([0-9a-fA-F:]+)\/(\d{1,3})$/);
    if (!match) throw new Error("Format attendu : adresse/préfixe, ex. 2001:db8:acad::/48");
    const prefixLen = parseInt(match[2], 10);
    if (prefixLen < 0 || prefixLen > 128) throw new Error("Préfixe hors plage (0-128)");
    const big = parseIPv6ToBigInt(match[1]);
    if (big === null) throw new Error("Adresse IPv6 invalide");

    const maskBig = prefixLen === 0 ? 0n : (((1n << 128n) - 1n) << BigInt(128 - prefixLen)) & ((1n << 128n) - 1n);
    const networkBig = big & maskBig;

    document.getElementById('v6-compressed').textContent = compressIPv6(big);
    document.getElementById('v6-expanded').textContent = expandIPv6(big);
    document.getElementById('v6-network').textContent = `${compressIPv6(networkBig)}/${prefixLen}`;
    document.getElementById('v6-type').textContent = classifyIPv6(big);

    const v6SubnetsTableBody = document.querySelector('#v6-subnets-table tbody');
    if (prefixLen <= 64) {
      const subnetBits = 64 - prefixLen;
      const totalSubnets = subnetBits >= 53 ? Infinity : Math.pow(2, subnetBits); // au-delà, trop grand pour un Number JS fiable
      document.getElementById('v6-subnets-count').textContent = totalSubnets === Infinity
        ? `${2n ** BigInt(subnetBits)}`.length > 15 ? 'astronomique (> 10^15)' : String(totalSubnets)
        : totalSubnets.toLocaleString('fr-FR');

      const maxShow = 8;
      const showCount = subnetBits >= 53 ? maxShow : Math.min(maxShow, Math.pow(2, subnetBits));
      let rows = '';
      for (let i = 0; i < showCount; i++) {
        const subnetBig = networkBig | (BigInt(i) << 64n);
        rows += `<tr><td>${i + 1}</td><td>${compressIPv6(subnetBig)}/64</td></tr>`;
      }
      v6SubnetsTableBody.innerHTML = rows;
      v6SubnetsBox.classList.remove('hidden');
    } else {
      document.getElementById('v6-subnets-count').textContent = 'préfixe déjà plus spécifique que /64';
    }

    v6Results.classList.remove('hidden');
  } catch (e) {
    v6Error.textContent = e.message;
    v6Error.classList.remove('hidden');
  }
});

// ---- Aide-mémoire CIDR (drawer) ----
const cidrDrawer = document.getElementById('cidr-drawer');
const drawerOverlay = document.getElementById('drawer-overlay');
const cidrHelpToggle = document.getElementById('cidr-help-toggle');
const drawerClose = document.getElementById('drawer-close');
const cidrCheatsheet = document.getElementById('cidr-cheatsheet');

let lastUsedCidr = null;

function buildCheatsheet() {
  let rows = '';
  for (let cidr = 1; cidr <= 32; cidr++) {
    const total = Math.pow(2, 32 - cidr);
    const usable = cidr >= 31 ? 0 : total - 2;
    const highlight = cidr === lastUsedCidr ? ' class="highlight"' : '';
    rows += `<tr id="cidr-row-${cidr}"${highlight}><td>/${cidr}</td><td>${intToIp(maskFromCidr(cidr))}</td><td>${total}</td><td>${usable}</td></tr>`;
  }
  cidrCheatsheet.innerHTML = `
    <table>
      <thead><tr><th>CIDR</th><th>Masque</th><th>Adr.</th><th>Hôtes util.</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function openDrawer() {
  buildCheatsheet();
  cidrDrawer.classList.add('open');
  drawerOverlay.classList.remove('hidden');
  if (lastUsedCidr) {
    requestAnimationFrame(() => {
      const row = document.getElementById(`cidr-row-${lastUsedCidr}`);
      if (row) row.scrollIntoView({ block: 'center' });
    });
  }
}

function closeDrawer() {
  cidrDrawer.classList.remove('open');
  drawerOverlay.classList.add('hidden');
}

cidrHelpToggle.addEventListener('click', openDrawer);
drawerClose.addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

// ==================================================================
// Module VLAN — constructeur visuel complet
// ==================================================================
let vlanState = [];  // { id, name, svi }
let fwRules = []; // { action, proto, port, source, dest } — module Firewall
let dnsRecords = []; // { type, name, value, priority } — module DNS
let networkGroups = []; // { name, members: [] } — object-groups Cisco (Firewall)
let serviceGroups = []; // { name, members: [{proto, port}] } — object-groups Cisco (Firewall)
let portState = [];  // { port, mode, vlanId, voiceVlanId, nativeVlanId, description, security }

const vlanChips = document.getElementById('vlan-chips');
const portRows = document.getElementById('port-rows');
const newVlanId = document.getElementById('new-vlan-id');
const newVlanName = document.getElementById('new-vlan-name');
const newVlanSvi = document.getElementById('new-vlan-svi');
const newPortName = document.getElementById('new-port-name');
const newPortMode = document.getElementById('new-port-mode');
const newPortVlan = document.getElementById('new-port-vlan');
const newPortDesc = document.getElementById('new-port-desc');
const newPortVoice = document.getElementById('new-port-voice');
const newPortNative = document.getElementById('new-port-native');
const newPortSecurity = document.getElementById('new-port-security');
const newPortTrust = document.getElementById('new-port-trust');
const newPortStorm = document.getElementById('new-port-storm');
const vlanDhcpSnooping = document.getElementById('vlan-dhcp-snooping');
const advancedRow = document.getElementById('advanced-row');
const advVoiceField = document.getElementById('adv-voice-field');
const advNativeField = document.getElementById('adv-native-field');
const advSecurityField = document.getElementById('adv-security-field');

document.getElementById('advanced-toggle').addEventListener('click', (e) => {
  advancedRow.classList.toggle('hidden');
  e.target.textContent = advancedRow.classList.contains('hidden')
    ? '+ Options avancées (description, VLAN voix, natif, port-security, DHCP snooping, storm-control)'
    : '− Masquer les options avancées';
});

function updateAdvancedFieldsVisibility() {
  const isAccess = newPortMode.value === 'access';
  advVoiceField.style.display = isAccess ? 'flex' : 'none';
  advSecurityField.style.display = isAccess ? 'flex' : 'none';
  advNativeField.style.display = isAccess ? 'none' : 'flex';
}

function suggestNextVlanId() {
  if (vlanState.length === 0) return '10';
  const maxId = Math.max(...vlanState.map(v => parseInt(v.id, 10)));
  return String(maxId + 10);
}

newVlanId.addEventListener('focus', () => {
  if (!newVlanId.value) newVlanId.placeholder = suggestNextVlanId();
});

function renderVlanChips() {
  if (vlanState.length === 0) {
    vlanChips.innerHTML = '<span class="empty-hint">Aucun VLAN déclaré pour l\'instant</span>';
  } else {
    vlanChips.innerHTML = vlanState.map((v, idx) => `
      <div class="chip">
        <span class="chip-id">${v.id}</span> — ${v.name}${v.svi ? ` <span class="port-detail-extra">(SVI ${v.svi})</span>` : ''}
        <button class="chip-remove" data-remove-vlan="${idx}" title="Retirer">&times;</button>
      </div>
    `).join('');
  }
  renderPortVlanOptions();
  saveState();
}

function addVlan(id, name, svi) {
  if (!/^\d+$/.test(id)) return false;
  if (vlanState.some(v => v.id === id)) return false;
  if (svi && !svi.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/)) return false;
  vlanState.push({ id, name: name || `VLAN${id}`, svi: svi || null });
  renderVlanChips();
  renderPortRows();
  return true;
}

function removeVlanAt(idx) {
  const removedId = vlanState[idx].id;
  vlanState.splice(idx, 1);
  portState = portState.filter(p => p.vlanId !== removedId);
  renderVlanChips();
  renderPortRows();
}

function renderPortVlanOptions() {
  if (vlanState.length === 0) {
    newPortVlan.innerHTML = '<option value="">— déclare un VLAN d\'abord —</option>';
    newPortVlan.disabled = true;
  } else {
    newPortVlan.disabled = false;
    newPortVlan.innerHTML = vlanState.map(v => `<option value="${v.id}">${v.id} — ${v.name}</option>`).join('');
  }
  newPortVoice.innerHTML = '<option value="">— aucun —</option>' + vlanState.map(v => `<option value="${v.id}">${v.id} — ${v.name}</option>`).join('');
  newPortNative.innerHTML = '<option value="">— par défaut (VLAN 1) —</option>' + vlanState.map(v => `<option value="${v.id}">${v.id} — ${v.name}</option>`).join('');
}

function renderPortRows() {
  if (portState.length === 0) {
    portRows.innerHTML = '<span class="empty-hint">Aucun port ajouté pour l\'instant</span>';
    saveState();
    return;
  }
  portRows.innerHTML = portState.map((p, idx) => {
    const vlanInfo = p.mode === 'access'
      ? (vlanState.find(v => v.id === p.vlanId) || { id: p.vlanId, name: '?' })
      : null;
    let detail = p.mode === 'trunk'
      ? `autorise tous les VLANs déclarés`
      : `VLAN ${vlanInfo.id} (${vlanInfo.name})`;

    const extras = [];
    if (p.description) extras.push(`"${p.description}"`);
    if (p.mode === 'access' && p.voiceVlanId) extras.push(`voix VLAN ${p.voiceVlanId}`);
    if (p.mode === 'trunk' && p.nativeVlanId) extras.push(`natif VLAN ${p.nativeVlanId}`);
    if (p.mode === 'access' && p.security) extras.push('port-security');
    if (p.trust) extras.push('trust DHCP snooping');
    if (p.storm) extras.push(`storm-control ${p.storm}%`);

    return `
      <div class="port-row">
        <span class="port-name">${p.port}</span>
        <span class="port-badge ${p.mode}">${p.mode}</span>
        <span class="port-detail">${detail}${extras.length ? ' — <span class="port-detail-extra">' + extras.join(', ') + '</span>' : ''}</span>
        <button class="chip-remove" data-remove-port="${idx}" title="Retirer">&times;</button>
      </div>
    `;
  }).join('');
  saveState();
}

document.getElementById('add-vlan-btn').addEventListener('click', () => {
  const id = newVlanId.value.trim() || (/^\d+$/.test(newVlanId.placeholder) ? newVlanId.placeholder : '');
  const name = newVlanName.value.trim();
  const svi = newVlanSvi.value.trim();
  if (!addVlan(id, name, svi)) { newVlanId.focus(); return; }
  newVlanId.value = '';
  newVlanName.value = '';
  newVlanSvi.value = '';
  newVlanId.focus();
});

newVlanSvi.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('add-vlan-btn').click(); });

newPortMode.addEventListener('change', updateAdvancedFieldsVisibility);
vlanDhcpSnooping.addEventListener('change', saveState);

function expandPortRange(input) {
  const match = input.match(/^(.+?)(\d+)-(\d+)$/);
  if (!match) return [input];
  const [, prefix, startStr, endStr] = match;
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);
  if (isNaN(start) || isNaN(end) || end < start || end - start > 47) return [input];
  const ports = [];
  for (let i = start; i <= end; i++) ports.push(`${prefix}${i}`);
  return ports;
}

const newPortType = document.getElementById('new-port-type');

document.getElementById('add-port-btn').addEventListener('click', () => {
  const num = newPortName.value.trim();
  if (!num) { newPortName.focus(); return; }
  const mode = newPortMode.value;
  if (mode === 'access' && !newPortVlan.value) { return; }

  const description = newPortDesc.value.trim();
  const voiceVlanId = mode === 'access' ? (newPortVoice.value || null) : null;
  const nativeVlanId = mode === 'trunk' ? (newPortNative.value || null) : null;
  const security = mode === 'access' ? newPortSecurity.checked : false;
  const trust = newPortTrust.checked;
  const stormRaw = newPortStorm.value.trim();
  const storm = stormRaw && !isNaN(parseFloat(stormRaw)) ? stormRaw : null;

  const ports = expandPortRange(newPortType.value + num).filter(p => !portState.some(existing => existing.port === p));

  ports.forEach(port => {
    portState.push({
      port, mode,
      vlanId: mode === 'access' ? newPortVlan.value : null,
      voiceVlanId, nativeVlanId, description, security, trust, storm
    });
  });

  newPortName.value = '';
  newPortDesc.value = '';
  newPortSecurity.checked = false;
  newPortTrust.checked = false;
  newPortStorm.value = '';
  newPortName.focus();
  renderPortRows();
});

document.addEventListener('click', (e) => {
  if (e.target.dataset.removeVlan !== undefined) {
    removeVlanAt(parseInt(e.target.dataset.removeVlan, 10));
  }
  if (e.target.dataset.removeTopoVlan !== undefined) {
    removeTopoVlanAt(parseInt(e.target.dataset.removeTopoVlan, 10));
  }
  if (e.target.dataset.removePort !== undefined) {
    const idx = parseInt(e.target.dataset.removePort, 10);
    portState.splice(idx, 1);
    renderPortRows();
  }
});

function generateVlanConfig() {
  if (vlanState.length === 0) throw new Error("Déclare au moins un VLAN avant de générer la config");

  let lines = [];
  lines.push('! === Configuration générée par NetForge ===');
  lines.push('!');
  lines.push('! --- Déclaration des VLANs ---');
  vlanState.forEach(v => {
    lines.push(`vlan ${v.id}`);
    lines.push(` name ${v.name}`);
  });

  const dhcpSnoopingEnabled = vlanDhcpSnooping.checked;
  if (dhcpSnoopingEnabled) {
    lines.push('!');
    lines.push('! --- DHCP snooping (protection contre les serveurs DHCP non autorisés) ---');
    lines.push('ip dhcp snooping');
    lines.push(`ip dhcp snooping vlan ${vlanState.map(v => v.id).join(',')}`);
    lines.push('no ip dhcp snooping information option');
  }

  const svisConfigured = vlanState.filter(v => v.svi);
  if (svisConfigured.length > 0) {
    lines.push('!');
    lines.push('! --- Interfaces virtuelles (SVI) ---');
    svisConfigured.forEach(v => {
      const [ip, cidr] = v.svi.split('/');
      const mask = intToIp(maskFromCidr(parseInt(cidr, 10)));
      lines.push(`interface vlan ${v.id}`);
      lines.push(` ip address ${ip} ${mask}`);
      lines.push(' no shutdown');
      lines.push('!');
    });
  }

  const accessPorts = portState.filter(p => p.mode === 'access');
  const trunkPorts = portState.filter(p => p.mode === 'trunk');

  if (accessPorts.length > 0) {
    lines.push('!');
    lines.push('! --- Ports en mode accès ---');
    accessPorts.forEach(p => {
      lines.push(`interface ${p.port}`);
      if (p.description) lines.push(` description ${p.description}`);
      lines.push(' switchport mode access');
      lines.push(` switchport access vlan ${p.vlanId}`);
      if (p.voiceVlanId) lines.push(` switchport voice vlan ${p.voiceVlanId}`);
      lines.push(' spanning-tree portfast');
      if (p.security) {
        lines.push(' switchport port-security');
        lines.push(' switchport port-security maximum 1');
        lines.push(' switchport port-security violation restrict');
        lines.push(' switchport port-security mac-address sticky');
      }
      if (dhcpSnoopingEnabled && p.trust) lines.push(' ip dhcp snooping trust');
      if (p.storm) lines.push(` storm-control broadcast level ${p.storm}`);
      lines.push('!');
    });
  }

  if (trunkPorts.length > 0) {
    lines.push('! --- Ports en mode trunk ---');
    trunkPorts.forEach(p => {
      lines.push(`interface ${p.port}`);
      if (p.description) lines.push(` description ${p.description}`);
      lines.push(' switchport trunk encapsulation dot1q');
      lines.push(' switchport mode trunk');
      lines.push(` switchport trunk allowed vlan ${vlanState.map(v => v.id).join(',')}`);
      if (p.nativeVlanId) lines.push(` switchport trunk native vlan ${p.nativeVlanId}`);
      if (dhcpSnoopingEnabled && p.trust) lines.push(' ip dhcp snooping trust');
      if (p.storm) lines.push(` storm-control broadcast level ${p.storm}`);
      lines.push('!');
    });
  }

  lines.push('end');
  return lines.join('\n');
}

const vlanBtn = document.getElementById('vlan-btn');
const vlanError = document.getElementById('vlan-error');
const vlanOutputBox = document.getElementById('vlan-output-box');
const vlanOutput = document.getElementById('vlan-output');

vlanBtn.addEventListener('click', () => {
  vlanError.classList.add('hidden');
  vlanOutputBox.classList.add('hidden');
  try {
    const config = generateVlanConfig();
    vlanOutput.textContent = config;
    vlanOutputBox.classList.remove('hidden');
  } catch (e) {
    vlanError.textContent = e.message;
    vlanError.classList.remove('hidden');
  }
});

document.getElementById('vlan-copy-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(vlanOutput.textContent);
});

document.getElementById('vlan-export-btn').addEventListener('click', () => {
  const blob = new Blob([vlanOutput.textContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'config-vlan.txt';
  a.click();
  URL.revokeObjectURL(url);
});

updateAdvancedFieldsVisibility();
renderVlanChips();
renderPortRows();

// ==================================================================
// Module Topologie — multi-équipements (switchs + routeurs)
// ==================================================================
let topoVlanState = []; // { id, name, svi } — indépendant du module VLAN standalone
let devices = [];
let deviceIdSeq = 1;
let selectedDeviceId = null;
const devicePorts = {};       // deviceId -> [{port, mode, vlanId, voiceVlanId, nativeVlanId, description, security}]
const deviceInterfaces = {};  // deviceId -> [{name, sub, vlanId, ip, cidr, description}]
const deviceRoutes = {};      // deviceId -> [{network, cidr, nextHop}]
const deviceOspf = {};         // deviceId -> {enabled, pid, area}
const deviceBgp = {};           // deviceId -> {enabled, asNumber, networks: [], neighbors: [{ip, remoteAs}]}
const deviceNat = {};           // deviceId -> {patEnabled, outsideIface, staticMappings}
const deviceEtherchannels = {};  // deviceId -> [{groupId, members, mode, portMode, vlanId}]
const deviceVtp = {};             // deviceId -> {mode, domain, version, password}
const deviceWifi = {};            // deviceId -> {ssid, security, passphrase, vlanId, band, channel}
const deviceStp = {};              // deviceId -> {mode, priority, bpduGuard, rootGuard}
const deviceVpn = {};              // deviceId -> {enabled, peerIp, presharedKey, localNetwork, remoteNetwork, outsideIface, encryption, hash, dhGroup}
const deviceSecurity = {};         // deviceId -> {enableSecret, username, userPassword, sshEnabled, domain, banner}

const deviceList = document.getElementById('device-list');
const deviceConfigPanel = document.getElementById('device-config-panel');

const deviceTypeIcons = { switch: 'SW', router: 'R', pc: 'PC', server: 'SRV', ap: 'AP' };
const deviceTypeLabels = { switch: 'switch', router: 'routeur', pc: 'PC', server: 'serveur', ap: 'point d\'accès' };

function renderDeviceList() {
  if (devices.length === 0) {
    deviceList.innerHTML = '<span class="empty-hint">Aucun équipement pour l\'instant</span>';
  } else {
    deviceList.innerHTML = devices.map(d => `
      <div class="device-card ${d.id === selectedDeviceId ? 'selected' : ''}" data-select-device="${d.id}">
        <span class="device-icon ${d.type}">${deviceTypeIcons[d.type]}</span>
        <span class="device-name">${d.name}</span>
        <span class="device-type">(${deviceTypeLabels[d.type]})</span>
        <button class="chip-remove" data-remove-device="${d.id}" title="Retirer">&times;</button>
      </div>
    `).join('');
  }
  renderLinkDeviceOptions();
  renderTopologyDiagram();
  renderTopologyStats();
  saveState();
}

let links = []; // {a: deviceId, b: deviceId, label}

const linkA = document.getElementById('link-a');
const linkB = document.getElementById('link-b');
const linkRows = document.getElementById('link-rows');
const topologyDiagram = document.getElementById('topology-diagram');

function renderLinkDeviceOptions() {
  const opts = devices.map(d => `<option value="${d.id}">${d.name} (${deviceTypeLabels[d.type]})</option>`).join('');
  linkA.innerHTML = opts || '<option value="">— aucun équipement —</option>';
  linkB.innerHTML = opts || '<option value="">— aucun équipement —</option>';
}

function renderLinkRows() {
  if (links.length === 0) {
    linkRows.innerHTML = '<span class="empty-hint">Aucun lien pour l\'instant</span>';
    renderTopologyStats();
    saveState();
    return;
  }
  linkRows.innerHTML = links.map((l, idx) => {
    const da = devices.find(d => d.id === l.a);
    const db = devices.find(d => d.id === l.b);
    if (!da || !db) return '';
    return `
      <div class="port-row">
        <span class="port-name">${da.name}</span>
        <span class="port-detail">↔ ${db.name}${l.label ? ' — ' + l.label : ''}</span>
        <button class="chip-remove" data-remove-link="${idx}" title="Retirer">&times;</button>
      </div>
    `;
  }).join('');
  renderTopologyStats();
  saveState();
}

document.getElementById('add-link-btn').addEventListener('click', () => {
  const a = linkA.value;
  const b = linkB.value;
  const label = document.getElementById('link-label').value.trim();
  if (!a || !b || a === b) return;
  if (links.some(l => (l.a === a && l.b === b) || (l.a === b && l.b === a))) return;
  links.push({ a, b, label });
  document.getElementById('link-label').value = '';
  renderLinkRows();
  renderTopologyDiagram();
});

function renderTopologyDiagram() {
  if (!topologyDiagram) return;
  if (devices.length === 0) {
    topologyDiagram.innerHTML = '<span class="empty-hint">Ajoute des équipements pour voir le schéma</span>';
    return;
  }

  const width = 560, height = 280, cx = width / 2, cy = height / 2;
  const radius = devices.length <= 1 ? 0 : Math.min(200, 90 + devices.length * 14);
  const colors = { switch: '#4CF3FF', router: '#C25CFF', pc: '#FFB454', server: '#5CFFA0', ap: '#FF5C7A' };

  const positions = {};
  devices.forEach((d, i) => {
    const angle = (2 * Math.PI * i) / devices.length - Math.PI / 2;
    positions[d.id] = {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle)
    };
  });

  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="width:100%; max-width:${width}px;">`;

  links.forEach(l => {
    const pa = positions[l.a], pb = positions[l.b];
    if (!pa || !pb) return;
    svg += `<line x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}" stroke="#2a3446" stroke-width="1.5"/>`;
    if (l.label) {
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      svg += `<text x="${mx}" y="${my - 4}" fill="#7C8797" font-size="9" font-family="monospace" text-anchor="middle">${l.label}</text>`;
    }
  });

  devices.forEach(d => {
    const p = positions[d.id];
    const color = colors[d.type];
    svg += `
      <g>
        <circle cx="${p.x}" cy="${p.y}" r="18" fill="#10141C" stroke="${color}" stroke-width="2"/>
        <text x="${p.x}" y="${p.y + 4}" fill="${color}" font-size="9" font-family="monospace" font-weight="bold" text-anchor="middle">${deviceTypeIcons[d.type]}</text>
        <text x="${p.x}" y="${p.y + 32}" fill="#E7ECF3" font-size="10" font-family="monospace" text-anchor="middle">${d.name}</text>
      </g>
    `;
  });

  svg += '</svg>';
  topologyDiagram.innerHTML = svg;
}

function suggestNextTopoVlanId() {
  if (topoVlanState.length === 0) return '10';
  const maxId = Math.max(...topoVlanState.map(v => parseInt(v.id, 10)));
  return String(maxId + 10);
}

function renderTopologyStats() {
  const box = document.getElementById('topology-stats');
  if (!box) return;
  const nbSwitch = devices.filter(d => d.type === 'switch').length;
  const nbRouter = devices.filter(d => d.type === 'router').length;
  const nbHost = devices.filter(d => d.type === 'pc' || d.type === 'server').length;
  box.innerHTML = `
    <span class="stat-pill">${topoVlanState.length} VLAN${topoVlanState.length !== 1 ? 's' : ''}</span>
    <span class="stat-pill">${nbSwitch} switch${nbSwitch !== 1 ? 's' : ''}</span>
    <span class="stat-pill">${nbRouter} routeur${nbRouter !== 1 ? 's' : ''}</span>
    <span class="stat-pill">${nbHost} poste${nbHost !== 1 ? 's' : ''}/serveur${nbHost !== 1 ? 's' : ''}</span>
    <span class="stat-pill">${links.length} lien${links.length !== 1 ? 's' : ''}</span>
  `;
}


function renderTopoVlanChips() {
  const box = document.getElementById('topo-vlan-chips');
  if (!box) return;
  if (topoVlanState.length === 0) {
    box.innerHTML = '<span class="empty-hint">Aucun VLAN déclaré pour l\'instant</span>';
  } else {
    box.innerHTML = topoVlanState.map((v, idx) => `
      <div class="chip">
        <span class="chip-id">${v.id}</span> — ${v.name}${v.svi ? ` <span class="port-detail-extra">(SVI ${v.svi})</span>` : ''}
        <button class="chip-remove" data-remove-topo-vlan="${idx}" title="Retirer">&times;</button>
      </div>
    `).join('');
  }
  renderTopologyStats();
  saveState();
}

function addTopoVlan(id, name, svi) {
  if (!/^\d+$/.test(id)) return false;
  if (topoVlanState.some(v => v.id === id)) return false;
  if (svi && !svi.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/)) return false;
  topoVlanState.push({ id, name: name || `VLAN${id}`, svi: svi || null });
  renderTopoVlanChips();
  renderDeviceConfigPanel();
  return true;
}

function removeTopoVlanAt(idx) {
  const removedId = topoVlanState[idx].id;
  topoVlanState.splice(idx, 1);
  Object.keys(devicePorts).forEach(devId => {
    devicePorts[devId] = devicePorts[devId].filter(p => p.vlanId !== removedId);
  });
  Object.keys(deviceInterfaces).forEach(devId => {
    deviceInterfaces[devId] = deviceInterfaces[devId].filter(i => !(i.sub && i.vlanId === removedId));
    deviceInterfaces[devId].forEach(i => { if (!i.sub && i.vlanId === removedId) i.vlanId = ''; });
  });
  renderTopoVlanChips();
  renderDeviceConfigPanel();
}

document.getElementById('load-preset-btn').addEventListener('click', () => {
  if (devices.length > 0 || topoVlanState.length > 0) {
    if (!confirm("Ça va remplacer la topologie actuelle par un exemple pré-rempli. Continuer ?")) return;
  }

  topoVlanState = [
    { id: '10', name: 'ADMIN', svi: null },
    { id: '20', name: 'DATA', svi: null },
    { id: '30', name: 'VOIX', svi: null }
  ];

  devices = [
    { id: 'dev1', name: 'R1', type: 'router' },
    { id: 'dev2', name: 'SW1', type: 'switch' },
    { id: 'dev3', name: 'PC-Admin', type: 'pc' },
    { id: 'dev4', name: 'PC-Data', type: 'pc' }
  ];
  deviceIdSeq = 5;

  devicePorts.dev1 = [];
  devicePorts.dev2 = [
    { port: 'Fa0/1', mode: 'access', vlanId: '10', voiceVlanId: null, nativeVlanId: null, description: 'Poste admin', security: false },
    { port: 'Fa0/2', mode: 'access', vlanId: '20', voiceVlanId: null, nativeVlanId: null, description: 'Poste data', security: false },
    { port: 'Gi0/1', mode: 'trunk', vlanId: null, voiceVlanId: null, nativeVlanId: null, description: 'Vers R1', security: false }
  ];
  devicePorts.dev3 = [];
  devicePorts.dev4 = [];

  deviceInterfaces.dev1 = [
    { name: 'Gi0/0', sub: true, vlanId: '10', ip: '192.168.10.1/24', description: '', dhcp: false, dns: '' },
    { name: 'Gi0/0', sub: true, vlanId: '20', ip: '192.168.20.1/24', description: '', dhcp: true, dns: '8.8.8.8' },
    { name: 'Gi0/0', sub: true, vlanId: '30', ip: '192.168.30.1/24', description: '', dhcp: false, dns: '' }
  ];
  deviceInterfaces.dev2 = [];
  deviceInterfaces.dev3 = [{ name: 'eth0', mode: 'static', ip: '192.168.10.50/24', gateway: '192.168.10.1', dns: '8.8.8.8', vlanId: '10' }];
  deviceInterfaces.dev4 = [{ name: 'eth0', mode: 'dhcp', ip: '', gateway: '', dns: '', vlanId: '20' }];

  deviceRoutes.dev1 = [];
  deviceRoutes.dev2 = [];
  deviceRoutes.dev3 = [];
  deviceRoutes.dev4 = [];

  deviceOspf.dev1 = { enabled: false, pid: '1', area: '0' };
  deviceBgp.dev1 = { enabled: false, asNumber: '', networks: [], neighbors: [] };

  links = [
    { a: 'dev1', b: 'dev2', label: 'Gi0/1 ↔ Gi0/1, trunk' },
    { a: 'dev2', b: 'dev3', label: 'Fa0/1' },
    { a: 'dev2', b: 'dev4', label: 'Fa0/2' }
  ];

  selectedDeviceId = null;
  renderTopoVlanChips();
  renderDeviceList();
  renderLinkRows();
  renderDeviceConfigPanel();
});

document.getElementById('reset-topology-btn').addEventListener('click', () => {
  if (!confirm("Ça va effacer toute la topologie actuelle (VLANs, équipements, liens). Continuer ?")) return;

  topoVlanState = [];
  devices = [];
  Object.keys(devicePorts).forEach(k => delete devicePorts[k]);
  Object.keys(deviceInterfaces).forEach(k => delete deviceInterfaces[k]);
  Object.keys(deviceRoutes).forEach(k => delete deviceRoutes[k]);
  Object.keys(deviceOspf).forEach(k => delete deviceOspf[k]);
  Object.keys(deviceBgp).forEach(k => delete deviceBgp[k]);
  links = [];
  selectedDeviceId = null;
  deviceIdSeq = 1;

  renderTopoVlanChips();
  renderDeviceList();
  renderLinkRows();
  renderDeviceConfigPanel();
});

document.getElementById('topo-add-vlan-btn').addEventListener('click', () => {
  const idInput = document.getElementById('topo-vlan-id');
  const nameInput = document.getElementById('topo-vlan-name');
  const sviInput = document.getElementById('topo-vlan-svi');
  const id = idInput.value.trim() || suggestNextTopoVlanId();
  const name = nameInput.value.trim();
  const svi = sviInput.value.trim();
  if (!addTopoVlan(id, name, svi)) { idInput.focus(); return; }
  idInput.value = '';
  nameInput.value = '';
  sviInput.value = '';
  idInput.focus();
});

document.getElementById('add-device-btn').addEventListener('click', () => {
  const nameInput = document.getElementById('new-device-name');
  const typeInput = document.getElementById('new-device-type');
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  if (devices.some(d => d.name.toLowerCase() === name.toLowerCase())) { nameInput.focus(); return; }

  const id = `dev${deviceIdSeq++}`;
  const type = typeInput.value;
  devices.push({ id, name, type });
  devicePorts[id] = [];
  deviceInterfaces[id] = [];
  deviceRoutes[id] = [];
  deviceOspf[id] = { enabled: false, pid: '1', area: '0' };
  deviceBgp[id] = { enabled: false, asNumber: '', networks: [], neighbors: [] };
  deviceNat[id] = { patEnabled: false, outsideIface: '', staticMappings: [] };
  deviceEtherchannels[id] = [];
  deviceVtp[id] = { mode: 'off', domain: '', version: '2', password: '' };
  deviceWifi[id] = { ssid: '', security: 'wpa2-psk', passphrase: '', vlanId: '', channel: '6', band: '2.4' };
  deviceStp[id] = { mode: 'rapid-pvst', priority: '', bpduGuard: false, rootGuard: false };
  deviceVpn[id] = { enabled: false, ike: '2', peerIp: '', presharedKey: '', localNetwork: '', remoteNetwork: '', outsideIface: '', encryption: 'aes 256', hash: 'sha256', dhGroup: '14' };
  deviceSecurity[id] = { enableSecret: '', username: '', userPassword: '', sshEnabled: false, domain: '', banner: '' };

  nameInput.value = '';
  selectedDeviceId = id;
  renderDeviceList();
  renderDeviceConfigPanel();
});

document.getElementById('new-device-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('add-device-btn').click();
});

document.addEventListener('click', (e) => {
  if (e.target.dataset.selectDevice !== undefined) {
    selectedDeviceId = e.target.closest('[data-select-device]').dataset.selectDevice;
    renderDeviceList();
    renderDeviceConfigPanel();
  }
  if (e.target.dataset.removeDevice !== undefined) {
    const id = e.target.dataset.removeDevice;
    devices = devices.filter(d => d.id !== id);
    delete devicePorts[id];
    delete deviceInterfaces[id];
    delete deviceRoutes[id];
    delete deviceOspf[id];
    delete deviceBgp[id];
    delete deviceNat[id];
    delete deviceEtherchannels[id];
    delete deviceVtp[id];
    delete deviceWifi[id];
    delete deviceStp[id];
    delete deviceVpn[id];
    delete deviceSecurity[id];
    links = links.filter(l => l.a !== id && l.b !== id);
    if (selectedDeviceId === id) selectedDeviceId = null;
    renderDeviceList();
    renderLinkRows();
    renderDeviceConfigPanel();
  }
  if (e.target.dataset.removeLink !== undefined) {
    links.splice(parseInt(e.target.dataset.removeLink, 10), 1);
    renderLinkRows();
    renderTopologyDiagram();
  }
});

function securityBlockHtml() {
  return `
    <div class="subsection-label">Sécurité de l'équipement</div>
    <div class="builder-row">
      <div class="mini-field grow">
        <label>Mot de passe enable (secret)</label>
        <input type="text" id="dev-sec-enable" placeholder="cisco123">
      </div>
      <div class="mini-field grow">
        <label>Utilisateur local</label>
        <input type="text" id="dev-sec-username" placeholder="admin">
      </div>
      <div class="mini-field grow">
        <label>Mot de passe utilisateur</label>
        <input type="text" id="dev-sec-userpass" placeholder="cisco123">
      </div>
    </div>
    <div class="builder-row" style="margin-top:10px;">
      <div class="mini-field">
        <label>Activer SSH ?</label>
        <select id="dev-sec-ssh">
          <option value="no">Non</option>
          <option value="yes">Oui</option>
        </select>
      </div>
      <div class="mini-field grow">
        <label>Nom de domaine (requis pour SSH)</label>
        <input type="text" id="dev-sec-domain" placeholder="sisr.local">
      </div>
      <div class="mini-field grow">
        <label>Bannière MOTD (optionnel)</label>
        <input type="text" id="dev-sec-banner" placeholder="Accès réservé au personnel autorisé">
      </div>
      <button class="btn-add" id="dev-sec-save-btn">Enregistrer</button>
    </div>
  `;
}

function wireSecurityBlock() {
  const sec = deviceSecurity[selectedDeviceId] || { enableSecret: '', username: '', userPassword: '', sshEnabled: false, domain: '', banner: '' };
  document.getElementById('dev-sec-enable').value = sec.enableSecret;
  document.getElementById('dev-sec-username').value = sec.username;
  document.getElementById('dev-sec-userpass').value = sec.userPassword;
  document.getElementById('dev-sec-ssh').value = sec.sshEnabled ? 'yes' : 'no';
  document.getElementById('dev-sec-domain').value = sec.domain;
  document.getElementById('dev-sec-banner').value = sec.banner;

  document.getElementById('dev-sec-save-btn').addEventListener('click', () => {
    deviceSecurity[selectedDeviceId] = {
      enableSecret: document.getElementById('dev-sec-enable').value.trim(),
      username: document.getElementById('dev-sec-username').value.trim(),
      userPassword: document.getElementById('dev-sec-userpass').value.trim(),
      sshEnabled: document.getElementById('dev-sec-ssh').value === 'yes',
      domain: document.getElementById('dev-sec-domain').value.trim(),
      banner: document.getElementById('dev-sec-banner').value.trim()
    };
    renderDeviceConfigPanel();
    saveState();
  });
}

function renderDeviceConfigPanel() {
  if (!selectedDeviceId) {
    deviceConfigPanel.innerHTML = '';
    return;
  }
  const device = devices.find(d => d.id === selectedDeviceId);
  if (!device) { deviceConfigPanel.innerHTML = ''; return; }

  if (device.type === 'switch') {
    deviceConfigPanel.innerHTML = `
      <div class="device-config">
        <div class="device-config-title">Configuration — ${device.name} (switch)</div>
        ${securityBlockHtml()}

        <div class="subsection-label">VTP (VLAN Trunking Protocol)</div>
        <div class="builder-row">
          <div class="mini-field">
            <label>Mode</label>
            <select id="dev-vtp-mode">
              <option value="off">Désactivé</option>
              <option value="server">Server</option>
              <option value="client">Client</option>
              <option value="transparent">Transparent</option>
            </select>
          </div>
          <div class="mini-field grow">
            <label>Domaine</label>
            <input type="text" id="dev-vtp-domain" placeholder="SISR-DOMAIN">
          </div>
          <div class="mini-field">
            <label>Version</label>
            <select id="dev-vtp-version">
              <option value="2">v2</option>
              <option value="1">v1</option>
              <option value="3">v3</option>
            </select>
          </div>
          <div class="mini-field grow">
            <label>Mot de passe (optionnel)</label>
            <input type="text" id="dev-vtp-password" placeholder="">
          </div>
          <button class="btn-add" id="dev-vtp-save-btn">Enregistrer</button>
        </div>
        <div class="hint" id="dev-vtp-hint"></div>

        <div class="subsection-label">STP (Spanning Tree Protocol)</div>
        <div class="builder-row">
          <div class="mini-field">
            <label>Mode</label>
            <select id="dev-stp-mode">
              <option value="rapid-pvst">Rapid-PVST+ (recommandé)</option>
              <option value="pvst">PVST+</option>
              <option value="mst">MST</option>
            </select>
          </div>
          <div class="mini-field grow">
            <label>Priorité (toutes VLANs, optionnel)</label>
            <input type="text" id="dev-stp-priority" placeholder="ex: 4096 pour root bridge">
          </div>
          <div class="mini-field adv-checkbox">
            <label><input type="checkbox" id="dev-stp-bpduguard"> BPDU Guard (ports accès)</label>
          </div>
          <div class="mini-field adv-checkbox">
            <label><input type="checkbox" id="dev-stp-rootguard"> Root Guard (ports trunk)</label>
          </div>
          <button class="btn-add" id="dev-stp-save-btn">Enregistrer</button>
        </div>
        <div class="hint" id="dev-stp-hint">Priorité basse (ex: 4096, 8192) = plus de chances de devenir root bridge. Par défaut Cisco : 32768.</div>

        <div class="builder-row">
          <div class="mini-field">
            <label>Type</label>
            <select id="dev-port-type">
              <option value="Fa">FastEthernet</option>
              <option value="Gi">GigabitEthernet</option>
              <option value="Te">TenGigabitEthernet</option>
            </select>
          </div>
          <div class="mini-field">
            <label>N° (ex: 0/1-4)</label>
            <input type="text" id="dev-port-name" placeholder="0/1-4">
          </div>
          <div class="mini-field">
            <label>Mode</label>
            <select id="dev-port-mode">
              <option value="access">Accès</option>
              <option value="trunk">Trunk</option>
            </select>
          </div>
          <div class="mini-field grow">
            <label>VLAN</label>
            <select id="dev-port-vlan"></select>
          </div>
          <button class="btn-add" id="dev-add-port-btn">+ Ajouter</button>
        </div>
        <div class="hint">${topoVlanState.length === 0 ? 'Aucun VLAN déclaré — ajoute-en un dans la section VLANs ci-dessus' : ''}</div>
        <div class="port-rows" id="dev-port-rows"></div>

        <div class="subsection-label">EtherChannel (agrégation de liens)</div>
        <div class="builder-row">
          <div class="mini-field">
            <label>Groupe</label>
            <input type="text" id="dev-ec-group" placeholder="1">
          </div>
          <div class="mini-field grow">
            <label>Ports membres (ex: Fa0/1,Fa0/2)</label>
            <input type="text" id="dev-ec-members" placeholder="Fa0/1,Fa0/2">
          </div>
          <div class="mini-field">
            <label>Négociation</label>
            <select id="dev-ec-mode">
              <option value="active">LACP - active</option>
              <option value="passive">LACP - passive</option>
              <option value="desirable">PAgP - desirable</option>
              <option value="auto">PAgP - auto</option>
              <option value="on">Statique (on)</option>
            </select>
          </div>
          <div class="mini-field">
            <label>Mode du port</label>
            <select id="dev-ec-portmode">
              <option value="trunk">Trunk</option>
              <option value="access">Accès</option>
            </select>
          </div>
          <div class="mini-field grow" id="dev-ec-vlan-field" style="display:none;">
            <label>VLAN</label>
            <select id="dev-ec-vlan"></select>
          </div>
          <button class="btn-add" id="dev-ec-add-btn">+ Ajouter</button>
        </div>
        <div class="port-rows" id="dev-ec-rows"></div>
      </div>
    `;

    wireSecurityBlock();

    // ---- VTP ----
    const vtp = deviceVtp[selectedDeviceId] || { mode: 'off', domain: '', version: '2', password: '' };
    document.getElementById('dev-vtp-mode').value = vtp.mode;
    document.getElementById('dev-vtp-domain').value = vtp.domain;
    document.getElementById('dev-vtp-version').value = vtp.version;
    document.getElementById('dev-vtp-password').value = vtp.password;
    document.getElementById('dev-vtp-hint').textContent = vtp.mode !== 'off' && !vtp.domain
      ? 'Un domaine VTP est requis pour que le mode prenne effet.' : '';

    document.getElementById('dev-vtp-save-btn').addEventListener('click', () => {
      deviceVtp[selectedDeviceId] = {
        mode: document.getElementById('dev-vtp-mode').value,
        domain: document.getElementById('dev-vtp-domain').value.trim(),
        version: document.getElementById('dev-vtp-version').value,
        password: document.getElementById('dev-vtp-password').value.trim()
      };
      renderDeviceConfigPanel();
    });

    // ---- STP ----
    const stp = deviceStp[selectedDeviceId] || { mode: 'rapid-pvst', priority: '', bpduGuard: false, rootGuard: false };
    document.getElementById('dev-stp-mode').value = stp.mode;
    document.getElementById('dev-stp-priority').value = stp.priority;
    document.getElementById('dev-stp-bpduguard').checked = stp.bpduGuard;
    document.getElementById('dev-stp-rootguard').checked = stp.rootGuard;

    document.getElementById('dev-stp-save-btn').addEventListener('click', () => {
      deviceStp[selectedDeviceId] = {
        mode: document.getElementById('dev-stp-mode').value,
        priority: document.getElementById('dev-stp-priority').value.trim(),
        bpduGuard: document.getElementById('dev-stp-bpduguard').checked,
        rootGuard: document.getElementById('dev-stp-rootguard').checked
      };
      renderDeviceConfigPanel();
    });

    const devPortVlan = document.getElementById('dev-port-vlan');
    devPortVlan.innerHTML = topoVlanState.length === 0
      ? '<option value="">— aucun VLAN —</option>'
      : topoVlanState.map(v => `<option value="${v.id}">${v.id} — ${v.name}</option>`).join('');

    function renderDevPortRows() {
      const rows = devicePorts[selectedDeviceId];
      const box = document.getElementById('dev-port-rows');
      if (rows.length === 0) {
        box.innerHTML = '<span class="empty-hint">Aucun port ajouté pour l\'instant</span>';
        return;
      }
      box.innerHTML = rows.map((p, idx) => {
        const vlanInfo = p.mode === 'access' ? (topoVlanState.find(v => v.id === p.vlanId) || { id: p.vlanId, name: '?' }) : null;
        const detail = p.mode === 'trunk' ? 'autorise tous les VLANs déclarés' : `VLAN ${vlanInfo.id} (${vlanInfo.name})`;
        return `
          <div class="port-row">
            <span class="port-name">${p.port}</span>
            <span class="port-badge ${p.mode}">${p.mode}</span>
            <span class="port-detail">${detail}</span>
            <button class="chip-remove" data-remove-dev-port="${idx}" title="Retirer">&times;</button>
          </div>
        `;
      }).join('');
    }

    document.getElementById('dev-add-port-btn').addEventListener('click', () => {
      const num = document.getElementById('dev-port-name').value.trim();
      if (!num) return;
      const type = document.getElementById('dev-port-type').value;
      const mode = document.getElementById('dev-port-mode').value;
      const vlanId = document.getElementById('dev-port-vlan').value;
      if (mode === 'access' && !vlanId) return;

      const rows = devicePorts[selectedDeviceId];
      const ports = expandPortRange(type + num).filter(p => !rows.some(existing => existing.port === p));
      ports.forEach(port => {
        rows.push({ port, mode, vlanId: mode === 'access' ? vlanId : null, voiceVlanId: null, nativeVlanId: null, description: '', security: false });
      });
      document.getElementById('dev-port-name').value = '';
      renderDevPortRows();
      saveState();
    });

    renderDevPortRows();

    // ---- EtherChannel ----
    const ecVlanSelect = document.getElementById('dev-ec-vlan');
    ecVlanSelect.innerHTML = topoVlanState.length === 0
      ? '<option value="">— aucun VLAN —</option>'
      : topoVlanState.map(v => `<option value="${v.id}">${v.id} — ${v.name}</option>`).join('');

    document.getElementById('dev-ec-portmode').addEventListener('change', (e) => {
      document.getElementById('dev-ec-vlan-field').style.display = e.target.value === 'access' ? 'flex' : 'none';
    });

    function renderEcRows() {
      const box = document.getElementById('dev-ec-rows');
      const list = deviceEtherchannels[selectedDeviceId] || [];
      if (list.length === 0) {
        box.innerHTML = '<span class="empty-hint">Aucun EtherChannel configuré pour l\'instant</span>';
        return;
      }
      box.innerHTML = list.map((ec, idx) => {
        const vlanInfo = ec.portMode === 'access' ? (topoVlanState.find(v => v.id === ec.vlanId) || { name: '?' }) : null;
        const detail = ec.portMode === 'trunk'
          ? `trunk — membres : ${ec.members.join(', ')} (${ec.mode})`
          : `accès VLAN ${ec.vlanId} (${vlanInfo.name}) — membres : ${ec.members.join(', ')} (${ec.mode})`;
        return `
          <div class="port-row">
            <span class="port-name">Port-channel${ec.groupId}</span>
            <span class="port-detail">${detail}</span>
            <button class="chip-remove" data-remove-ec="${idx}" title="Retirer">&times;</button>
          </div>
        `;
      }).join('');
    }
    renderEcRows();

    document.getElementById('dev-ec-add-btn').addEventListener('click', () => {
      const groupId = document.getElementById('dev-ec-group').value.trim();
      const membersRaw = document.getElementById('dev-ec-members').value.trim();
      const mode = document.getElementById('dev-ec-mode').value;
      const portMode = document.getElementById('dev-ec-portmode').value;
      const vlanId = document.getElementById('dev-ec-vlan').value;

      if (!groupId || !membersRaw) return;
      if (portMode === 'access' && !vlanId) return;

      const members = membersRaw.split(',').map(m => m.trim()).filter(Boolean);
      if (members.length < 2) return;

      if (!deviceEtherchannels[selectedDeviceId]) deviceEtherchannels[selectedDeviceId] = [];
      deviceEtherchannels[selectedDeviceId].push({ groupId, members, mode, portMode, vlanId: portMode === 'access' ? vlanId : null });

      document.getElementById('dev-ec-group').value = '';
      document.getElementById('dev-ec-members').value = '';
      renderEcRows();
      saveState();
    });

  } else if (device.type === 'router') {
    deviceConfigPanel.innerHTML = `
      <div class="device-config">
        <div class="device-config-title">Configuration — ${device.name} (routeur)</div>
        ${securityBlockHtml()}

        <div class="subsection-label">Interfaces</div>
        <div class="builder-row">
          <div class="mini-field">
            <label>Type</label>
            <select id="dev-if-type">
              <option value="Fa">FastEthernet</option>
              <option value="Gi">GigabitEthernet</option>
              <option value="Te">TenGigabitEthernet</option>
              <option value="Se">Serial</option>
              <option value="Lo">Loopback</option>
            </select>
          </div>
          <div class="mini-field">
            <label>N° (ex: 0/0)</label>
            <input type="text" id="dev-if-name" placeholder="0/0">
          </div>
          <div class="mini-field" id="dev-if-sub-field">
            <label>Sous-interface ?</label>
            <select id="dev-if-sub">
              <option value="no">Non</option>
              <option value="yes">Oui (802.1Q)</option>
            </select>
          </div>
          <div class="mini-field" id="dev-if-vlan-field" style="display:none;">
            <label>VLAN</label>
            <select id="dev-if-vlan"></select>
          </div>
          <div class="mini-field grow">
            <label>IP / CIDR</label>
            <input type="text" id="dev-if-ip" placeholder="10.0.10.1/24">
          </div>
          <button class="btn-add" id="dev-add-if-btn">+ Ajouter</button>
        </div>

        <div class="advanced-row hidden" id="dev-if-serial-fields">
          <div class="adv-field">
            <label>Encapsulation</label>
            <select id="dev-if-encap">
              <option value="hdlc">HDLC (défaut Cisco)</option>
              <option value="ppp">PPP</option>
              <option value="frame-relay">Frame-Relay</option>
            </select>
          </div>
          <div class="adv-field">
            <label>Clock rate (si DCE, optionnel)</label>
            <input type="text" id="dev-if-clockrate" placeholder="ex: 64000">
          </div>
          <div class="adv-field">
            <label>Bande passante (kbps, optionnel)</label>
            <input type="text" id="dev-if-bandwidth" placeholder="ex: 1544">
          </div>
        </div>

        <div class="advanced-row" id="dev-if-dhcp-fields">
          <div class="adv-field adv-checkbox">
            <label><input type="checkbox" id="dev-if-dhcp"> Générer un pool DHCP pour ce réseau</label>
          </div>
          <div class="adv-field">
            <label>DNS (optionnel)</label>
            <input type="text" id="dev-if-dns" placeholder="8.8.8.8">
          </div>
          <div class="adv-field">
            <label>Redondance passerelle</label>
            <select id="dev-if-redundancy-protocol">
              <option value="">— aucune —</option>
              <option value="hsrp">HSRP</option>
              <option value="vrrp">VRRP</option>
            </select>
          </div>
          <div class="adv-field" id="dev-if-redundancy-fields" style="display:none;">
            <label>Groupe / IP virtuelle / Priorité</label>
            <div style="display:flex; gap:6px;">
              <input type="text" id="dev-if-redundancy-group" placeholder="1" style="width:50px;">
              <input type="text" id="dev-if-redundancy-vip" placeholder="192.168.10.1">
              <input type="text" id="dev-if-redundancy-priority" placeholder="110" style="width:60px;">
            </div>
          </div>
          <div class="adv-field adv-checkbox" id="dev-if-redundancy-preempt-field" style="display:none;">
            <label><input type="checkbox" id="dev-if-redundancy-preempt"> Preempt</label>
          </div>
        </div>

        <div class="port-rows" id="dev-if-rows"></div>

        <div class="subsection-label">Routes statiques</div>
        <div class="builder-row">
          <div class="mini-field">
            <label>Réseau destination</label>
            <input type="text" id="dev-route-net" placeholder="192.168.20.0/24">
          </div>
          <div class="mini-field grow">
            <label>Prochain saut</label>
            <input type="text" id="dev-route-hop" placeholder="10.0.10.254">
          </div>
          <button class="btn-add" id="dev-add-route-btn">+ Ajouter</button>
        </div>
        <div class="port-rows" id="dev-route-rows"></div>

        <div class="subsection-label">Routage dynamique (OSPF, zone unique)</div>
        <div class="builder-row">
          <div class="mini-field">
            <label>Activer OSPF ?</label>
            <select id="dev-ospf-enabled">
              <option value="no">Non</option>
              <option value="yes">Oui</option>
            </select>
          </div>
          <div class="mini-field">
            <label>Process ID</label>
            <input type="text" id="dev-ospf-pid" placeholder="1">
          </div>
          <div class="mini-field">
            <label>Zone (area)</label>
            <input type="text" id="dev-ospf-area" placeholder="0">
          </div>
          <button class="btn-add" id="dev-ospf-save-btn">Enregistrer</button>
        </div>
        <div class="builder-row">
          <label style="display:flex;align-items:center;gap:8px;font-family:var(--font-mono);font-size:0.8rem;color:var(--text);cursor:pointer;">
            <input type="checkbox" id="dev-ospf-redist-bgp"> Redistribuer les routes BGP dans OSPF (utile si le routeur fait aussi de la sortie eBGP)
          </label>
        </div>
        <div class="hint" id="dev-ospf-hint"></div>

        <div class="subsection-label">Routage dynamique (BGP, eBGP simple)</div>
        <div class="builder-row">
          <div class="mini-field">
            <label>Activer BGP ?</label>
            <select id="dev-bgp-enabled">
              <option value="no">Non</option>
              <option value="yes">Oui</option>
            </select>
          </div>
          <div class="mini-field">
            <label>AS local</label>
            <input type="text" id="dev-bgp-as" placeholder="65001">
          </div>
        </div>
        <div class="builder-row">
          <div class="mini-field grow">
            <label>Réseaux à annoncer (un par ligne, ex: 192.168.10.0/24)</label>
            <input type="text" id="dev-bgp-networks" placeholder="192.168.10.0/24, 192.168.20.0/24">
          </div>
        </div>
        <div class="builder-row">
          <div class="mini-field grow">
            <label>IP voisin (eBGP)</label>
            <input type="text" id="dev-bgp-neighbor-ip" placeholder="203.0.113.2">
          </div>
          <div class="mini-field">
            <label>AS distant</label>
            <input type="text" id="dev-bgp-neighbor-as" placeholder="65002">
          </div>
          <button class="btn-add" id="dev-bgp-add-neighbor-btn">+ Ajouter voisin</button>
        </div>
        <div class="port-rows" id="dev-bgp-neighbor-rows"></div>
        <div class="builder-row">
          <label style="display:flex;align-items:center;gap:8px;font-family:var(--font-mono);font-size:0.8rem;color:var(--text);cursor:pointer;">
            <input type="checkbox" id="dev-bgp-redist-ospf"> Redistribuer les routes OSPF dans BGP (annoncer le réseau interne vers l'extérieur)
          </label>
        </div>
        <div class="builder-row">
          <label style="display:flex;align-items:center;gap:8px;font-family:var(--font-mono);font-size:0.8rem;color:var(--text);cursor:pointer;">
            <input type="checkbox" id="dev-bgp-default-only"> Filtrage entrant : n'accepter que la route par défaut (0.0.0.0/0) de chaque voisin — via <code>prefix-list</code> + <code>route-map</code>
          </label>
        </div>
        <button class="btn-add" id="dev-bgp-save-btn">Enregistrer</button>
        <div class="hint" id="dev-bgp-hint"></div>

        <div class="subsection-label">NAT / PAT</div>
        <div class="builder-row">
          <div class="mini-field">
            <label>Activer PAT (surcharge) ?</label>
            <select id="dev-nat-enabled">
              <option value="no">Non</option>
              <option value="yes">Oui</option>
            </select>
          </div>
          <div class="mini-field grow">
            <label>Interface extérieure (WAN)</label>
            <select id="dev-nat-outside"></select>
          </div>
          <button class="btn-add" id="dev-nat-save-btn">Enregistrer</button>
        </div>
        <div class="hint" id="dev-nat-hint">Toutes les autres interfaces IP configurées seront traitées comme "inside".</div>

        <div class="builder-label" style="margin-top:16px;">NAT statique (optionnel)</div>
        <div class="builder-row">
          <div class="mini-field grow">
            <label>IP locale (LAN)</label>
            <input type="text" id="dev-nat-local" placeholder="192.168.10.10">
          </div>
          <div class="mini-field grow">
            <label>IP publique (globale)</label>
            <input type="text" id="dev-nat-global" placeholder="203.0.113.10">
          </div>
          <button class="btn-add" id="dev-nat-add-static-btn">+ Ajouter (1:1 complet)</button>
        </div>
        <div class="hint">Astuce : pour rediriger un seul service (ex: un serveur web derrière une IP publique partagée), utilise plutôt la redirection de port ci-dessous.</div>

        <div class="builder-label" style="margin-top:16px;">Redirection de port (PAT statique / port forwarding)</div>
        <div class="builder-row">
          <div class="mini-field">
            <label>Protocole</label>
            <select id="dev-natpt-proto">
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
          </div>
          <div class="mini-field grow">
            <label>IP locale (LAN)</label>
            <input type="text" id="dev-natpt-local" placeholder="192.168.10.10">
          </div>
          <div class="mini-field">
            <label>Port local</label>
            <input type="text" id="dev-natpt-local-port" placeholder="80">
          </div>
          <div class="mini-field grow">
            <label>IP publique (globale)</label>
            <input type="text" id="dev-natpt-global" placeholder="203.0.113.10">
          </div>
          <div class="mini-field">
            <label>Port public</label>
            <input type="text" id="dev-natpt-global-port" placeholder="8080">
          </div>
          <button class="btn-add" id="dev-natpt-add-btn">+ Ajouter</button>
        </div>
        <div class="port-rows" id="dev-nat-static-rows"></div>

        <div class="subsection-label">VPN Site-à-Site (IPsec)</div>
        <div class="builder-row">
          <div class="mini-field">
            <label>Activer ?</label>
            <select id="dev-vpn-enabled">
              <option value="no">Non</option>
              <option value="yes">Oui</option>
            </select>
          </div>
          <div class="mini-field">
            <label>Version IKE</label>
            <select id="dev-vpn-ike">
              <option value="1">IKEv1</option>
              <option value="2">IKEv2 (recommandé)</option>
            </select>
          </div>
          <div class="mini-field grow">
            <label>IP du pair distant (WAN)</label>
            <input type="text" id="dev-vpn-peer" placeholder="203.0.113.20">
          </div>
          <div class="mini-field grow">
            <label>Clé pré-partagée</label>
            <input type="text" id="dev-vpn-psk" placeholder="MaCleSecrete123">
          </div>
        </div>
        <div class="builder-row" style="margin-top:10px;">
          <div class="mini-field grow">
            <label>Réseau local à protéger</label>
            <input type="text" id="dev-vpn-local-net" placeholder="192.168.10.0/24">
          </div>
          <div class="mini-field grow">
            <label>Réseau distant à protéger</label>
            <input type="text" id="dev-vpn-remote-net" placeholder="192.168.20.0/24">
          </div>
          <div class="mini-field grow">
            <label>Interface sortante (WAN)</label>
            <select id="dev-vpn-outside"></select>
          </div>
        </div>
        <div class="builder-row" style="margin-top:10px;">
          <div class="mini-field">
            <label>Chiffrement</label>
            <select id="dev-vpn-encryption">
              <option value="aes 256">AES-256</option>
              <option value="aes 128">AES-128</option>
              <option value="3des">3DES (obsolète)</option>
            </select>
          </div>
          <div class="mini-field">
            <label>Hachage</label>
            <select id="dev-vpn-hash">
              <option value="sha256">SHA-256</option>
              <option value="sha384">SHA-384</option>
              <option value="sha">SHA-1 (obsolète)</option>
              <option value="md5">MD5 (obsolète)</option>
            </select>
          </div>
          <div class="mini-field">
            <label>Groupe DH</label>
            <select id="dev-vpn-dhgroup">
              <option value="14">Groupe 14</option>
              <option value="19">Groupe 19 (ECC)</option>
              <option value="5">Groupe 5 (obsolète)</option>
              <option value="2">Groupe 2 (obsolète)</option>
            </select>
          </div>
          <button class="btn-add" id="dev-vpn-save-btn">Enregistrer</button>
        </div>
        <div class="hint" id="dev-vpn-hint">Configure aussi le routeur distant avec les réseaux local/distant inversés et la même clé.</div>
      </div>
    `;

    wireSecurityBlock();

    const devIfVlan = document.getElementById('dev-if-vlan');
    devIfVlan.innerHTML = topoVlanState.length === 0
      ? '<option value="">— aucun VLAN —</option>'
      : topoVlanState.map(v => `<option value="${v.id}">${v.id} — ${v.name}</option>`).join('');

    document.getElementById('dev-if-sub').addEventListener('change', (e) => {
      document.getElementById('dev-if-vlan-field').style.display = e.target.value === 'yes' ? 'flex' : 'none';
    });

    document.getElementById('dev-if-type').addEventListener('change', (e) => {
      const type = e.target.value;
      const isSerial = type === 'Se';
      const isLoopback = type === 'Lo';
      document.getElementById('dev-if-serial-fields').classList.toggle('hidden', !isSerial);
      document.getElementById('dev-if-dhcp-fields').classList.toggle('hidden', isSerial || isLoopback);
      document.getElementById('dev-if-sub-field').style.display = (isSerial || isLoopback) ? 'none' : 'flex';
      if (isSerial || isLoopback) {
        document.getElementById('dev-if-sub').value = 'no';
        document.getElementById('dev-if-vlan-field').style.display = 'none';
      }
      document.getElementById('dev-if-name').placeholder = isLoopback ? '0' : '0/0';
    });

    document.getElementById('dev-if-redundancy-protocol').addEventListener('change', (e) => {
      const enabled = e.target.value !== '';
      document.getElementById('dev-if-redundancy-fields').style.display = enabled ? 'flex' : 'none';
      document.getElementById('dev-if-redundancy-preempt-field').style.display = enabled ? 'flex' : 'none';
    });

    function renderDevIfRows() {
      const rows = deviceInterfaces[selectedDeviceId];
      const box = document.getElementById('dev-if-rows');
      if (rows.length === 0) {
        box.innerHTML = '<span class="empty-hint">Aucune interface ajoutée pour l\'instant</span>';
        return;
      }
      box.innerHTML = rows.map((iface, idx) => {
        const label = iface.sub ? `${iface.name}.${iface.vlanId}` : iface.name;
        let detail = iface.sub ? `sous-interface VLAN ${iface.vlanId} — ${iface.ip}` : iface.ip;
        if (iface.name.startsWith('Se')) {
          const extras = [`encap. ${iface.encapsulation || 'hdlc'}`];
          if (iface.clockrate) extras.push(`clock ${iface.clockrate}`);
          if (iface.bandwidth) extras.push(`bw ${iface.bandwidth}kbps`);
          detail += ` — <span class="port-detail-extra">${extras.join(', ')}</span>`;
        }
        if (iface.dhcp) {
          detail += ` — <span class="port-detail-extra">pool DHCP${iface.dns ? ' (DNS ' + iface.dns + ')' : ''}</span>`;
        }
        if (iface.redundancy && iface.redundancy.protocol) {
          detail += ` — <span class="port-detail-extra">${iface.redundancy.protocol.toUpperCase()} groupe ${iface.redundancy.group} (VIP ${iface.redundancy.vip})</span>`;
        }
        return `
          <div class="port-row">
            <span class="port-name">${label}</span>
            <span class="port-detail">${detail}</span>
            <button class="chip-remove" data-remove-dev-if="${idx}" title="Retirer">&times;</button>
          </div>
        `;
      }).join('');
    }

    function renderDevRouteRows() {
      const rows = deviceRoutes[selectedDeviceId];
      const box = document.getElementById('dev-route-rows');
      if (rows.length === 0) {
        box.innerHTML = '<span class="empty-hint">Aucune route ajoutée pour l\'instant</span>';
        return;
      }
      box.innerHTML = rows.map((r, idx) => `
        <div class="port-row">
          <span class="port-name">${r.network}/${r.cidr}</span>
          <span class="port-detail">via ${r.nextHop}</span>
          <button class="chip-remove" data-remove-dev-route="${idx}" title="Retirer">&times;</button>
        </div>
      `).join('');
    }

    document.getElementById('dev-add-if-btn').addEventListener('click', () => {
      const type = document.getElementById('dev-if-type').value;
      const num = document.getElementById('dev-if-name').value.trim();
      const sub = document.getElementById('dev-if-sub').value === 'yes';
      const vlanId = document.getElementById('dev-if-vlan').value;
      const ipRaw = document.getElementById('dev-if-ip').value.trim();
      if (!num || !ipRaw) return;
      if (sub && !vlanId) return;
      const match = ipRaw.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
      if (!match) return;

      const name = type + num;
      const entry = { name, sub, vlanId: sub ? vlanId : null, ip: ipRaw, description: '' };

      if (type === 'Se') {
        entry.encapsulation = document.getElementById('dev-if-encap').value;
        entry.clockrate = document.getElementById('dev-if-clockrate').value.trim();
        entry.bandwidth = document.getElementById('dev-if-bandwidth').value.trim();
      }
      if (type !== 'Se' && type !== 'Lo') {
        entry.dhcp = document.getElementById('dev-if-dhcp').checked;
        entry.dns = document.getElementById('dev-if-dns').value.trim();

        const redProtocol = document.getElementById('dev-if-redundancy-protocol').value;
        if (redProtocol) {
          entry.redundancy = {
            protocol: redProtocol,
            group: document.getElementById('dev-if-redundancy-group').value.trim() || '1',
            vip: document.getElementById('dev-if-redundancy-vip').value.trim(),
            priority: document.getElementById('dev-if-redundancy-priority').value.trim(),
            preempt: document.getElementById('dev-if-redundancy-preempt').checked
          };
        }
      }

      deviceInterfaces[selectedDeviceId].push(entry);
      document.getElementById('dev-if-name').value = '';
      document.getElementById('dev-if-ip').value = '';
      document.getElementById('dev-if-clockrate').value = '';
      document.getElementById('dev-if-bandwidth').value = '';
      document.getElementById('dev-if-dhcp').checked = false;
      document.getElementById('dev-if-dns').value = '';
      document.getElementById('dev-if-redundancy-protocol').value = '';
      document.getElementById('dev-if-redundancy-group').value = '';
      document.getElementById('dev-if-redundancy-vip').value = '';
      document.getElementById('dev-if-redundancy-priority').value = '';
      document.getElementById('dev-if-redundancy-preempt').checked = false;
      document.getElementById('dev-if-redundancy-fields').style.display = 'none';
      document.getElementById('dev-if-redundancy-preempt-field').style.display = 'none';
      renderDeviceConfigPanel();
      saveState();
    });

    document.getElementById('dev-add-route-btn').addEventListener('click', () => {
      const netRaw = document.getElementById('dev-route-net').value.trim();
      const hop = document.getElementById('dev-route-hop').value.trim();
      const match = netRaw.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
      if (!match || ipToInt(hop) === null) return;

      deviceRoutes[selectedDeviceId].push({ network: match[1], cidr: match[2], nextHop: hop });
      document.getElementById('dev-route-net').value = '';
      document.getElementById('dev-route-hop').value = '';
      renderDevRouteRows();
      saveState();
    });

    renderDevIfRows();
    renderDevRouteRows();

    const ospf = deviceOspf[selectedDeviceId] || { enabled: false, pid: '1', area: '0', redistBgp: false };
    document.getElementById('dev-ospf-enabled').value = ospf.enabled ? 'yes' : 'no';
    document.getElementById('dev-ospf-pid').value = ospf.pid;
    document.getElementById('dev-ospf-area').value = ospf.area;
    document.getElementById('dev-ospf-redist-bgp').checked = !!ospf.redistBgp;
    document.getElementById('dev-ospf-hint').textContent = ospf.enabled
      ? `OSPF actif — les réseaux de toutes les interfaces IP configurées seront annoncés en zone ${ospf.area}`
      : '';

    document.getElementById('dev-ospf-save-btn').addEventListener('click', () => {
      deviceOspf[selectedDeviceId] = {
        enabled: document.getElementById('dev-ospf-enabled').value === 'yes',
        pid: document.getElementById('dev-ospf-pid').value.trim() || '1',
        area: document.getElementById('dev-ospf-area').value.trim() || '0',
        redistBgp: document.getElementById('dev-ospf-redist-bgp').checked
      };
      renderDeviceConfigPanel();
    });

    // ---- BGP ----
    const bgp = deviceBgp[selectedDeviceId] || { enabled: false, asNumber: '', networks: [], neighbors: [], redistOspf: false, defaultOnly: false };
    document.getElementById('dev-bgp-enabled').value = bgp.enabled ? 'yes' : 'no';
    document.getElementById('dev-bgp-as').value = bgp.asNumber || '';
    document.getElementById('dev-bgp-networks').value = (bgp.networks || []).join(', ');
    document.getElementById('dev-bgp-redist-ospf').checked = !!bgp.redistOspf;
    document.getElementById('dev-bgp-default-only').checked = !!bgp.defaultOnly;
    document.getElementById('dev-bgp-hint').textContent = bgp.enabled
      ? `BGP actif (AS ${bgp.asNumber || '?'}) — ${(bgp.neighbors || []).length} voisin(s) configuré(s)`
      : '';

    function renderBgpNeighborRows() {
      const rows = document.getElementById('dev-bgp-neighbor-rows');
      const list = (deviceBgp[selectedDeviceId] || {}).neighbors || [];
      if (list.length === 0) {
        rows.innerHTML = '<span class="empty-hint">Aucun voisin BGP pour l\'instant</span>';
        return;
      }
      rows.innerHTML = list.map((n, idx) => `
        <div class="port-row">
          <span class="port-detail">${n.ip} — AS distant ${n.remoteAs}</span>
          <button class="chip-remove" data-remove-bgp-neighbor="${idx}" title="Retirer">&times;</button>
        </div>
      `).join('');
    }
    renderBgpNeighborRows();

    document.getElementById('dev-bgp-add-neighbor-btn').addEventListener('click', () => {
      const ip = document.getElementById('dev-bgp-neighbor-ip').value.trim();
      const remoteAs = document.getElementById('dev-bgp-neighbor-as').value.trim();
      if (!ip || !remoteAs || ipToInt(ip) === null) return;
      if (!deviceBgp[selectedDeviceId]) deviceBgp[selectedDeviceId] = { enabled: false, asNumber: '', networks: [], neighbors: [] };
      deviceBgp[selectedDeviceId].neighbors.push({ ip, remoteAs });
      document.getElementById('dev-bgp-neighbor-ip').value = '';
      document.getElementById('dev-bgp-neighbor-as').value = '';
      renderBgpNeighborRows();
      saveState();
    });

    document.getElementById('dev-bgp-neighbor-rows').addEventListener('click', (e) => {
      if (e.target.dataset.removeBgpNeighbor === undefined) return;
      deviceBgp[selectedDeviceId].neighbors.splice(parseInt(e.target.dataset.removeBgpNeighbor, 10), 1);
      renderBgpNeighborRows();
      saveState();
    });

    document.getElementById('dev-bgp-save-btn').addEventListener('click', () => {
      const existing = deviceBgp[selectedDeviceId] || { neighbors: [] };
      const networksRaw = document.getElementById('dev-bgp-networks').value;
      deviceBgp[selectedDeviceId] = {
        enabled: document.getElementById('dev-bgp-enabled').value === 'yes',
        asNumber: document.getElementById('dev-bgp-as').value.trim(),
        networks: networksRaw.split(',').map(s => s.trim()).filter(Boolean),
        neighbors: existing.neighbors || [],
        redistOspf: document.getElementById('dev-bgp-redist-ospf').checked,
        defaultOnly: document.getElementById('dev-bgp-default-only').checked
      };
      renderDeviceConfigPanel();
    });

    // ---- NAT / PAT ----
    const routerIfaces = deviceInterfaces[selectedDeviceId] || [];
    const ifaceFullNames = routerIfaces.filter(i => i.ip).map(i => i.sub ? `${i.name}.${i.vlanId}` : i.name);

    const natOutsideSelect = document.getElementById('dev-nat-outside');
    natOutsideSelect.innerHTML = ifaceFullNames.length === 0
      ? '<option value="">— aucune interface avec IP —</option>'
      : ifaceFullNames.map(name => `<option value="${name}">${name}</option>`).join('');

    const nat = deviceNat[selectedDeviceId] || { patEnabled: false, outsideIface: '', staticMappings: [] };
    document.getElementById('dev-nat-enabled').value = nat.patEnabled ? 'yes' : 'no';
    if (nat.outsideIface) natOutsideSelect.value = nat.outsideIface;

    function renderNatStaticRows() {
      const box = document.getElementById('dev-nat-static-rows');
      const mappings = (deviceNat[selectedDeviceId] || {}).staticMappings || [];
      if (mappings.length === 0) {
        box.innerHTML = '<span class="empty-hint">Aucun mapping statique pour l\'instant</span>';
        return;
      }
      box.innerHTML = mappings.map((m, idx) => {
        const detail = m.proto
          ? `${m.proto.toUpperCase()} ${m.localIp}:${m.localPort} → ${m.globalIp}:${m.globalPort}`
          : `${m.localIp} → ${m.globalIp} (1:1 complet)`;
        return `
        <div class="port-row">
          <span class="port-detail">${detail}</span>
          <button class="chip-remove" data-remove-nat-static="${idx}" title="Retirer">&times;</button>
        </div>
      `;
      }).join('');
    }
    renderNatStaticRows();

    document.getElementById('dev-nat-save-btn').addEventListener('click', () => {
      const existing = deviceNat[selectedDeviceId] || { staticMappings: [] };
      deviceNat[selectedDeviceId] = {
        patEnabled: document.getElementById('dev-nat-enabled').value === 'yes',
        outsideIface: natOutsideSelect.value,
        staticMappings: existing.staticMappings || []
      };
      renderDeviceConfigPanel();
    });

    document.getElementById('dev-nat-add-static-btn').addEventListener('click', () => {
      const localIp = document.getElementById('dev-nat-local').value.trim();
      const globalIp = document.getElementById('dev-nat-global').value.trim();
      if (ipToInt(localIp) === null || ipToInt(globalIp) === null) return;

      if (!deviceNat[selectedDeviceId]) {
        deviceNat[selectedDeviceId] = { patEnabled: false, outsideIface: '', staticMappings: [] };
      }
      deviceNat[selectedDeviceId].staticMappings.push({ localIp, globalIp });
      document.getElementById('dev-nat-local').value = '';
      document.getElementById('dev-nat-global').value = '';
      renderNatStaticRows();
      saveState();
    });

    document.getElementById('dev-natpt-add-btn').addEventListener('click', () => {
      const proto = document.getElementById('dev-natpt-proto').value;
      const localIp = document.getElementById('dev-natpt-local').value.trim();
      const localPort = document.getElementById('dev-natpt-local-port').value.trim();
      const globalIp = document.getElementById('dev-natpt-global').value.trim();
      const globalPort = document.getElementById('dev-natpt-global-port').value.trim();
      if (ipToInt(localIp) === null || ipToInt(globalIp) === null) return;
      if (!localPort || !globalPort || isNaN(parseInt(localPort, 10)) || isNaN(parseInt(globalPort, 10))) return;

      if (!deviceNat[selectedDeviceId]) {
        deviceNat[selectedDeviceId] = { patEnabled: false, outsideIface: '', staticMappings: [] };
      }
      deviceNat[selectedDeviceId].staticMappings.push({ proto, localIp, localPort, globalIp, globalPort });
      document.getElementById('dev-natpt-local').value = '';
      document.getElementById('dev-natpt-local-port').value = '';
      document.getElementById('dev-natpt-global').value = '';
      document.getElementById('dev-natpt-global-port').value = '';
      renderNatStaticRows();
      saveState();
    });

    // ---- VPN Site-à-Site (IPsec) ----
    const vpnOutsideSelect = document.getElementById('dev-vpn-outside');
    vpnOutsideSelect.innerHTML = ifaceFullNames.length === 0
      ? '<option value="">— aucune interface avec IP —</option>'
      : ifaceFullNames.map(name => `<option value="${name}">${name}</option>`).join('');

    const vpn = deviceVpn[selectedDeviceId] || { enabled: false, ike: '2', peerIp: '', presharedKey: '', localNetwork: '', remoteNetwork: '', outsideIface: '', encryption: 'aes 256', hash: 'sha256', dhGroup: '14' };
    document.getElementById('dev-vpn-enabled').value = vpn.enabled ? 'yes' : 'no';
    document.getElementById('dev-vpn-ike').value = vpn.ike || '2';
    document.getElementById('dev-vpn-peer').value = vpn.peerIp;
    document.getElementById('dev-vpn-psk').value = vpn.presharedKey;
    document.getElementById('dev-vpn-local-net').value = vpn.localNetwork;
    document.getElementById('dev-vpn-remote-net').value = vpn.remoteNetwork;
    document.getElementById('dev-vpn-encryption').value = vpn.encryption;
    document.getElementById('dev-vpn-hash').value = vpn.hash;
    document.getElementById('dev-vpn-dhgroup').value = vpn.dhGroup;
    if (vpn.outsideIface) vpnOutsideSelect.value = vpn.outsideIface;

    document.getElementById('dev-vpn-save-btn').addEventListener('click', () => {
      const peerIp = document.getElementById('dev-vpn-peer').value.trim();
      const localNet = document.getElementById('dev-vpn-local-net').value.trim();
      const remoteNet = document.getElementById('dev-vpn-remote-net').value.trim();

      deviceVpn[selectedDeviceId] = {
        enabled: document.getElementById('dev-vpn-enabled').value === 'yes',
        ike: document.getElementById('dev-vpn-ike').value,
        peerIp,
        presharedKey: document.getElementById('dev-vpn-psk').value.trim(),
        localNetwork: localNet,
        remoteNetwork: remoteNet,
        outsideIface: vpnOutsideSelect.value,
        encryption: document.getElementById('dev-vpn-encryption').value,
        hash: document.getElementById('dev-vpn-hash').value,
        dhGroup: document.getElementById('dev-vpn-dhgroup').value
      };
      renderDeviceConfigPanel();
      saveState();
    });

  } else if (device.type === 'ap') {
    const wifi = deviceWifi[selectedDeviceId] || { ssid: '', security: 'wpa2-psk', passphrase: '', vlanId: '', channel: '6', band: '2.4' };

    deviceConfigPanel.innerHTML = `
      <div class="device-config">
        <div class="device-config-title">Configuration — ${device.name} (point d'accès)</div>

        <div class="builder-row">
          <div class="mini-field grow">
            <label>SSID</label>
            <input type="text" id="ap-ssid" value="${wifi.ssid}" placeholder="SISR-WIFI">
          </div>
          <div class="mini-field">
            <label>Sécurité</label>
            <select id="ap-security">
              <option value="open" ${wifi.security === 'open' ? 'selected' : ''}>Ouvert</option>
              <option value="wpa2-psk" ${wifi.security === 'wpa2-psk' ? 'selected' : ''}>WPA2-PSK</option>
              <option value="wpa2-enterprise" ${wifi.security === 'wpa2-enterprise' ? 'selected' : ''}>WPA2-Enterprise</option>
            </select>
          </div>
          <div class="mini-field grow" id="ap-passphrase-field" style="${wifi.security === 'wpa2-psk' ? '' : 'display:none;'}">
            <label>Passphrase</label>
            <input type="text" id="ap-passphrase" value="${wifi.passphrase}" placeholder="8 caractères minimum">
          </div>
        </div>

        <div class="builder-row" style="margin-top:12px;">
          <div class="mini-field grow">
            <label>VLAN associé</label>
            <select id="ap-vlan"></select>
          </div>
          <div class="mini-field">
            <label>Bande</label>
            <select id="ap-band">
              <option value="2.4" ${wifi.band === '2.4' ? 'selected' : ''}>2.4 GHz</option>
              <option value="5" ${wifi.band === '5' ? 'selected' : ''}>5 GHz</option>
            </select>
          </div>
          <div class="mini-field">
            <label>Canal</label>
            <input type="text" id="ap-channel" value="${wifi.channel}" placeholder="6">
          </div>
          <button class="btn-add" id="ap-save-btn">Enregistrer</button>
        </div>
        <div class="error hidden" id="ap-error"></div>
      </div>
    `;

    const apVlanSelect = document.getElementById('ap-vlan');
    apVlanSelect.innerHTML = topoVlanState.length === 0
      ? '<option value="">— aucun VLAN —</option>'
      : topoVlanState.map(v => `<option value="${v.id}" ${wifi.vlanId === v.id ? 'selected' : ''}>${v.id} — ${v.name}</option>`).join('');

    document.getElementById('ap-security').addEventListener('change', (e) => {
      document.getElementById('ap-passphrase-field').style.display = e.target.value === 'wpa2-psk' ? 'flex' : 'none';
    });

    document.getElementById('ap-save-btn').addEventListener('click', () => {
      const security = document.getElementById('ap-security').value;
      const passphrase = document.getElementById('ap-passphrase').value.trim();
      const errorBox = document.getElementById('ap-error');
      errorBox.classList.add('hidden');

      if (security === 'wpa2-psk' && passphrase.length > 0 && passphrase.length < 8) {
        errorBox.textContent = 'La passphrase WPA2 doit faire au moins 8 caractères.';
        errorBox.classList.remove('hidden');
        return;
      }

      deviceWifi[selectedDeviceId] = {
        ssid: document.getElementById('ap-ssid').value.trim() || 'SISR-WIFI',
        security,
        passphrase,
        vlanId: apVlanSelect.value,
        band: document.getElementById('ap-band').value,
        channel: document.getElementById('ap-channel').value.trim() || '6'
      };
      renderDeviceConfigPanel();
      saveState();
    });

  } else {
    // PC / Serveur
    deviceInterfaces[selectedDeviceId][0] = deviceInterfaces[selectedDeviceId][0] || { name: 'eth0', mode: 'static', ip: '', gateway: '', dns: '', vlanId: '' };
    const host = deviceInterfaces[selectedDeviceId][0];

    deviceConfigPanel.innerHTML = `
      <div class="device-config">
        <div class="device-config-title">Configuration — ${device.name} (${deviceTypeLabels[device.type]})</div>

        <div class="builder-row">
          <div class="mini-field">
            <label>Interface</label>
            <input type="text" id="host-if-name" value="${host.name}">
          </div>
          <div class="mini-field">
            <label>Mode</label>
            <select id="host-mode">
              <option value="static" ${host.mode === 'static' ? 'selected' : ''}>Statique</option>
              <option value="dhcp" ${host.mode === 'dhcp' ? 'selected' : ''}>DHCP</option>
            </select>
          </div>
          <div class="mini-field" id="host-vlan-field">
            <label>VLAN (info)</label>
            <select id="host-vlan"></select>
          </div>
        </div>

        <div class="builder-row" id="host-static-fields" style="margin-top:12px;">
          <div class="mini-field grow">
            <label>IP / CIDR</label>
            <input type="text" id="host-ip" placeholder="192.168.10.50/24" value="${host.ip}">
          </div>
          <div class="mini-field grow">
            <label>Passerelle (optionnel)</label>
            <input type="text" id="host-gateway" placeholder="192.168.10.1" value="${host.gateway}">
          </div>
          <div class="mini-field grow">
            <label>DNS (optionnel)</label>
            <input type="text" id="host-dns" placeholder="8.8.8.8" value="${host.dns}">
          </div>
        </div>

        <button class="btn-add" id="host-save-btn" style="margin-top:16px;">Enregistrer</button>
      </div>
    `;

    const hostVlanSelect = document.getElementById('host-vlan');
    hostVlanSelect.innerHTML = '<option value="">— aucun —</option>' + topoVlanState.map(v => `<option value="${v.id}" ${host.vlanId === v.id ? 'selected' : ''}>${v.id} — ${v.name}</option>`).join('');

    function updateHostFieldsVisibility() {
      const mode = document.getElementById('host-mode').value;
      document.getElementById('host-static-fields').style.display = mode === 'static' ? 'flex' : 'none';
    }
    document.getElementById('host-mode').addEventListener('change', updateHostFieldsVisibility);
    updateHostFieldsVisibility();

    document.getElementById('host-save-btn').addEventListener('click', () => {
      deviceInterfaces[selectedDeviceId][0] = {
        name: document.getElementById('host-if-name').value.trim() || 'eth0',
        mode: document.getElementById('host-mode').value,
        ip: document.getElementById('host-ip').value.trim(),
        gateway: document.getElementById('host-gateway').value.trim(),
        dns: document.getElementById('host-dns').value.trim(),
        vlanId: document.getElementById('host-vlan').value
      };
      renderDeviceConfigPanel();
    });
  }
  saveState();
}

function generateSecurityLines(device) {
  const sec = deviceSecurity[device.id];
  if (!sec) return [];
  const lines = [];

  const hostname = device.name.replace(/[^a-zA-Z0-9_-]/g, '');
  if (hostname) {
    lines.push(`hostname ${hostname}`);
    lines.push('!');
  }

  if (sec.enableSecret) {
    lines.push(`enable secret ${sec.enableSecret}`);
  }
  if (sec.username) {
    lines.push(`username ${sec.username} secret ${sec.userPassword || '<A_DEFINIR>'}`);
  }
  if (sec.banner) {
    lines.push(`banner motd #${sec.banner}#`);
  }
  if (sec.enableSecret || sec.username || sec.banner) lines.push('!');

  if (sec.sshEnabled) {
    lines.push(`ip domain-name ${sec.domain || 'local'}`);
    lines.push('crypto key generate rsa modulus 2048');
    lines.push('ip ssh version 2');
    lines.push('!');
    lines.push('line vty 0 4');
    lines.push(' transport input ssh');
    lines.push(' login local');
    lines.push('!');
  } else if (sec.username) {
    lines.push('line vty 0 4');
    lines.push(' login local');
    lines.push('!');
  }

  return lines;
}

function generateSwitchDeviceConfig(device) {
  const lines = [];
  lines.push(`! === ${device.name} (switch) — généré par NetForge ===`);
  lines.push('!');
  lines.push(...generateSecurityLines(device));

  const vtp = deviceVtp[device.id];
  if (vtp && vtp.mode !== 'off' && vtp.domain) {
    lines.push('! --- VTP ---');
    lines.push(`vtp domain ${vtp.domain}`);
    lines.push(`vtp mode ${vtp.mode}`);
    lines.push(`vtp version ${vtp.version}`);
    if (vtp.password) lines.push(`vtp password ${vtp.password}`);
    lines.push('!');
  }

  const stp = deviceStp[device.id];
  if (stp) {
    lines.push('! --- STP ---');
    lines.push(`spanning-tree mode ${stp.mode}`);
    if (stp.priority && topoVlanState.length > 0) {
      lines.push(`spanning-tree vlan ${topoVlanState.map(v => v.id).join(',')} priority ${stp.priority}`);
    }
    lines.push('!');
  }

  if (topoVlanState.length > 0) {
    if (vtp && vtp.mode === 'client') {
      lines.push('! Mode VTP client : les VLANs sont reçus du serveur VTP, pas besoin de les déclarer ici.');
      lines.push('! (déclarations ci-dessous ignorées par le switch en pratique, gardées pour référence)');
    }
    lines.push('! --- Déclaration des VLANs ---');
    topoVlanState.forEach(v => {
      lines.push(`vlan ${v.id}`);
      lines.push(` name ${v.name}`);
    });
  }

  const ports = devicePorts[device.id] || [];
  const access = ports.filter(p => p.mode === 'access');
  const trunk = ports.filter(p => p.mode === 'trunk');

  if (access.length > 0) {
    lines.push('!');
    lines.push('! --- Ports en mode accès ---');
    access.forEach(p => {
      lines.push(`interface ${p.port}`);
      lines.push(' switchport mode access');
      lines.push(` switchport access vlan ${p.vlanId}`);
      lines.push(' spanning-tree portfast');
      if (stp && stp.bpduGuard) lines.push(' spanning-tree bpduguard enable');
      lines.push('!');
    });
  }

  if (trunk.length > 0) {
    lines.push('! --- Ports en mode trunk ---');
    trunk.forEach(p => {
      lines.push(`interface ${p.port}`);
      lines.push(' switchport trunk encapsulation dot1q');
      lines.push(' switchport mode trunk');
      lines.push(` switchport trunk allowed vlan ${topoVlanState.map(v => v.id).join(',')}`);
      if (stp && stp.rootGuard) lines.push(' spanning-tree guard root');
      lines.push('!');
    });
  }

  const etherchannels = deviceEtherchannels[device.id] || [];
  if (etherchannels.length > 0) {
    lines.push('! --- EtherChannel ---');
    etherchannels.forEach(ec => {
      ec.members.forEach(m => {
        lines.push(`interface ${m}`);
        lines.push(` channel-group ${ec.groupId} mode ${ec.mode}`);
        lines.push('!');
      });
      lines.push(`interface Port-channel${ec.groupId}`);
      if (ec.portMode === 'trunk') {
        lines.push(' switchport trunk encapsulation dot1q');
        lines.push(' switchport mode trunk');
        lines.push(` switchport trunk allowed vlan ${topoVlanState.map(v => v.id).join(',')}`);
      } else {
        lines.push(' switchport mode access');
        lines.push(` switchport access vlan ${ec.vlanId}`);
      }
      lines.push('!');
    });
  }

  lines.push('end');
  return lines.join('\n');
}

function generateRouterDeviceConfig(device) {
  const lines = [];
  lines.push(`! === ${device.name} (routeur) — généré par NetForge ===`);
  lines.push('!');
  lines.push(...generateSecurityLines(device));
  lines.push('ip routing');
  lines.push('!');

  const ifaces = deviceInterfaces[device.id] || [];
  ifaces.forEach(iface => {
    const [ip, cidr] = iface.ip.split('/');
    const mask = intToIp(maskFromCidr(parseInt(cidr, 10)));
    if (iface.sub) {
      lines.push(`interface ${iface.name}.${iface.vlanId}`);
      lines.push(` encapsulation dot1Q ${iface.vlanId}`);
      lines.push(` ip address ${ip} ${mask}`);
      if (iface.redundancy && iface.redundancy.protocol && iface.redundancy.vip) {
        const red = iface.redundancy;
        const kw = red.protocol === 'hsrp' ? 'standby' : 'vrrp';
        lines.push(` ${kw} ${red.group} ip ${red.vip}`);
        if (red.priority) lines.push(` ${kw} ${red.group} priority ${red.priority}`);
        if (red.preempt) lines.push(` ${kw} ${red.group} preempt`);
      }
      lines.push(' no shutdown');
    } else {
      lines.push(`interface ${iface.name}`);
      lines.push(` ip address ${ip} ${mask}`);
      if (iface.name.startsWith('Se')) {
        if (iface.encapsulation && iface.encapsulation !== 'hdlc') {
          lines.push(` encapsulation ${iface.encapsulation}`);
        }
        if (iface.clockrate) lines.push(` clock rate ${iface.clockrate}`);
        if (iface.bandwidth) lines.push(` bandwidth ${iface.bandwidth}`);
      }
      if (iface.redundancy && iface.redundancy.protocol && iface.redundancy.vip) {
        const red = iface.redundancy;
        const kw = red.protocol === 'hsrp' ? 'standby' : 'vrrp';
        lines.push(` ${kw} ${red.group} ip ${red.vip}`);
        if (red.priority) lines.push(` ${kw} ${red.group} priority ${red.priority}`);
        if (red.preempt) lines.push(` ${kw} ${red.group} preempt`);
      }
      lines.push(' no shutdown');
    }
    lines.push('!');
  });

  const dhcpIfaces = ifaces.filter(iface => iface.dhcp && iface.ip);
  if (dhcpIfaces.length > 0) {
    lines.push('! --- Pools DHCP ---');
    dhcpIfaces.forEach((iface, idx) => {
      const [ip, cidr] = iface.ip.split('/');
      const maskInt = maskFromCidr(parseInt(cidr, 10));
      const networkAddr = intToIp((ipToInt(ip) & maskInt) >>> 0);
      const mask = intToIp(maskInt);
      const poolName = `POOL_${iface.sub ? 'VLAN' + iface.vlanId : iface.name.replace(/\W/g, '')}`;
      lines.push(`ip dhcp excluded-address ${ip}`);
      lines.push(`ip dhcp pool ${poolName}`);
      lines.push(` network ${networkAddr} ${mask}`);
      lines.push(` default-router ${ip}`);
      lines.push(` dns-server ${iface.dns || '8.8.8.8'}`);
      lines.push('!');
    });
  }

  const nat = deviceNat[device.id];
  if (nat && (nat.patEnabled || (nat.staticMappings && nat.staticMappings.length > 0))) {
    lines.push('! --- NAT / PAT ---');

    if (nat.patEnabled && nat.outsideIface) {
      const insideIfaces = ifaces.filter(iface => {
        const fullName = iface.sub ? `${iface.name}.${iface.vlanId}` : iface.name;
        return iface.ip && fullName !== nat.outsideIface;
      });

      if (insideIfaces.length > 0) {
        lines.push('ip access-list standard NETFORGE_NAT');
        insideIfaces.forEach(iface => {
          const [ip, cidr] = iface.ip.split('/');
          const maskInt = maskFromCidr(parseInt(cidr, 10));
          const networkAddr = intToIp((ipToInt(ip) & maskInt) >>> 0);
          const wildcard = intToIp((~maskInt) >>> 0);
          lines.push(` permit ${networkAddr} ${wildcard}`);
        });
        lines.push('!');
        lines.push(`ip nat inside source list NETFORGE_NAT interface ${nat.outsideIface} overload`);
        lines.push('!');
        insideIfaces.forEach(iface => {
          const fullName = iface.sub ? `${iface.name}.${iface.vlanId}` : iface.name;
          lines.push(`interface ${fullName}`);
          lines.push(' ip nat inside');
          lines.push('!');
        });
        lines.push(`interface ${nat.outsideIface}`);
        lines.push(' ip nat outside');
        lines.push('!');
      }
    }

    if (nat.staticMappings && nat.staticMappings.length > 0) {
      nat.staticMappings.forEach(m => {
        if (m.proto) {
          lines.push(`ip nat inside source static ${m.proto} ${m.localIp} ${m.localPort} ${m.globalIp} ${m.globalPort}`);
        } else {
          lines.push(`ip nat inside source static ${m.localIp} ${m.globalIp}`);
        }
      });
      lines.push('!');
    }
  }

  const vpn = deviceVpn[device.id];
  if (vpn && vpn.enabled && vpn.peerIp && vpn.outsideIface && vpn.localNetwork && vpn.remoteNetwork) {
    lines.push('! --- VPN Site-à-Site (IPsec) ---');
    if (vpn.ike === '1') {
      lines.push('crypto isakmp policy 10');
      lines.push(` encryption ${vpn.encryption}`);
      lines.push(` hash ${vpn.hash}`);
      lines.push(' authentication pre-share');
      lines.push(` group ${vpn.dhGroup}`);
      lines.push('!');
      lines.push(`crypto isakmp key ${vpn.presharedKey || '<A_DEFINIR>'} address ${vpn.peerIp}`);
      lines.push('!');
    } else {
      // IKEv2 (recommandé) : remplace la politique ISAKMP historique par un proposal/profile IKEv2, plus flexible et plus sûr.
      lines.push('crypto ikev2 proposal NETFORGE-IKEV2-PROPOSAL');
      lines.push(` encryption ${vpn.encryption}`);
      lines.push(` integrity ${vpn.hash}`);
      lines.push(` group ${vpn.dhGroup}`);
      lines.push('!');
      lines.push('crypto ikev2 policy NETFORGE-IKEV2-POLICY');
      lines.push(' proposal NETFORGE-IKEV2-PROPOSAL');
      lines.push('!');
      lines.push('crypto ikev2 keyring NETFORGE-IKEV2-KEYRING');
      lines.push(` peer NETFORGE-PEER`);
      lines.push(`  address ${vpn.peerIp}`);
      lines.push(`  pre-shared-key ${vpn.presharedKey || '<A_DEFINIR>'}`);
      lines.push('!');
      lines.push('crypto ikev2 profile NETFORGE-IKEV2-PROFILE');
      lines.push(` match identity remote address ${vpn.peerIp} 255.255.255.255`);
      lines.push(' authentication local pre-share');
      lines.push(' authentication remote pre-share');
      lines.push(' keyring local NETFORGE-IKEV2-KEYRING');
      lines.push('!');
    }

    const espEncryption = vpn.encryption === '3des' ? 'esp-3des' : `esp-${vpn.encryption}`;
    lines.push(`crypto ipsec transform-set NETFORGE-TSET ${espEncryption} esp-${vpn.hash}-hmac`);
    lines.push(' mode tunnel');
    lines.push('!');

    const [localIp, localCidr] = vpn.localNetwork.split('/');
    const [remoteIp, remoteCidr] = vpn.remoteNetwork.split('/');
    const localMaskInt = maskFromCidr(parseInt(localCidr, 10));
    const remoteMaskInt = maskFromCidr(parseInt(remoteCidr, 10));
    const localNet = intToIp((ipToInt(localIp) & localMaskInt) >>> 0);
    const remoteNet = intToIp((ipToInt(remoteIp) & remoteMaskInt) >>> 0);
    const localWildcard = intToIp((~localMaskInt) >>> 0);
    const remoteWildcard = intToIp((~remoteMaskInt) >>> 0);

    lines.push('ip access-list extended NETFORGE-VPN-ACL');
    lines.push(` permit ip ${localNet} ${localWildcard} ${remoteNet} ${remoteWildcard}`);
    lines.push('!');
    lines.push('crypto map NETFORGE-VPNMAP 10 ipsec-isakmp');
    lines.push(` set peer ${vpn.peerIp}`);
    lines.push(' set transform-set NETFORGE-TSET');
    if (vpn.ike !== '1') lines.push(' set ikev2-profile NETFORGE-IKEV2-PROFILE');
    lines.push(' match address NETFORGE-VPN-ACL');
    lines.push('!');
    lines.push(`interface ${vpn.outsideIface}`);
    lines.push(' crypto map NETFORGE-VPNMAP');
    lines.push('!');
  }

  const routes = deviceRoutes[device.id] || [];
  if (routes.length > 0) {
    lines.push('! --- Routes statiques ---');
    routes.forEach(r => {
      const mask = intToIp(maskFromCidr(parseInt(r.cidr, 10)));
      lines.push(`ip route ${r.network} ${mask} ${r.nextHop}`);
    });
    lines.push('!');
  }

  const ospf = deviceOspf[device.id];
  if (ospf && ospf.enabled) {
    const ipIfaces = ifaces.filter(iface => iface.ip);
    if (ipIfaces.length > 0) {
      lines.push('! --- OSPF ---');
      lines.push(`router ospf ${ospf.pid}`);
      ipIfaces.forEach(iface => {
        const [ip, cidr] = iface.ip.split('/');
        const maskInt = maskFromCidr(parseInt(cidr, 10));
        const networkAddr = intToIp((ipToInt(ip) & maskInt) >>> 0);
        const wildcard = intToIp((~maskInt) >>> 0);
        lines.push(` network ${networkAddr} ${wildcard} area ${ospf.area}`);
      });
      const bgpForRedist = deviceBgp[device.id];
      if (ospf.redistBgp && bgpForRedist && bgpForRedist.enabled && bgpForRedist.asNumber) {
        lines.push(` redistribute bgp ${bgpForRedist.asNumber} subnets`);
      }
      lines.push('!');
    }
  }

  const bgp = deviceBgp[device.id];
  if (bgp && bgp.enabled && bgp.asNumber) {
    lines.push('! --- BGP (eBGP) ---');
    if (bgp.defaultOnly && (bgp.neighbors || []).length > 0) {
      lines.push('ip prefix-list PL_DEFAULT_ONLY seq 5 permit 0.0.0.0/0');
      lines.push('route-map RM_IN_DEFAULT_ONLY permit 10');
      lines.push(' match ip address prefix-list PL_DEFAULT_ONLY');
      lines.push('!');
    }
    lines.push(`router bgp ${bgp.asNumber}`);
    (bgp.networks || []).forEach(net => {
      const match = net.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
      if (!match) return;
      const cidr = parseInt(match[2], 10);
      const mask = intToIp(maskFromCidr(cidr));
      lines.push(` network ${match[1]} mask ${mask}`);
    });
    (bgp.neighbors || []).forEach(n => {
      lines.push(` neighbor ${n.ip} remote-as ${n.remoteAs}`);
      if (bgp.defaultOnly) lines.push(` neighbor ${n.ip} route-map RM_IN_DEFAULT_ONLY in`);
    });
    if (bgp.redistOspf && ospf && ospf.enabled) {
      lines.push(` redistribute ospf ${ospf.pid}`);
    }
    lines.push('!');
  }

  lines.push('end');
  return lines.join('\n');
}

function generateHostDeviceConfig(device) {
  const host = (deviceInterfaces[device.id] || [])[0];
  const lines = [];
  lines.push(`# === ${device.name} (${deviceTypeLabels[device.type]}) — généré par NetForge ===`);
  lines.push(`# Fichier /etc/network/interfaces (Debian/Ubuntu)`);
  lines.push('');

  if (!host || (host.mode === 'static' && !host.ip)) {
    lines.push(`auto ${host ? host.name : 'eth0'}`);
    lines.push(`iface ${host ? host.name : 'eth0'} inet dhcp`);
    lines.push('');
    lines.push('# Aucune configuration statique renseignée — DHCP par défaut');
    return lines.join('\n');
  }

  lines.push(`auto ${host.name}`);
  if (host.mode === 'dhcp') {
    lines.push(`iface ${host.name} inet dhcp`);
  } else {
    const [ip, cidr] = host.ip.split('/');
    const mask = intToIp(maskFromCidr(parseInt(cidr, 10)));
    lines.push(`iface ${host.name} inet static`);
    lines.push(`    address ${ip}`);
    lines.push(`    netmask ${mask}`);
    if (host.gateway) lines.push(`    gateway ${host.gateway}`);
    if (host.dns) lines.push(`    dns-nameservers ${host.dns}`);
  }

  if (host.vlanId) {
    const v = topoVlanState.find(x => x.id === host.vlanId);
    lines.push('');
    lines.push(`# Rattaché (info) au VLAN ${host.vlanId}${v ? ' (' + v.name + ')' : ''} — pense à brancher ce poste sur un port en accès de ce VLAN`);
  }

  return lines.join('\n');
}

function generateApDeviceConfig(device) {
  const wifi = deviceWifi[device.id];
  const lines = [];
  lines.push(`! === ${device.name} (point d'accès autonome) — généré par NetForge ===`);
  lines.push('!');

  if (!wifi || !wifi.ssid) {
    lines.push('! Aucun SSID configuré.');
    return lines.join('\n');
  }

  lines.push(`dot11 ssid ${wifi.ssid}`);
  if (wifi.vlanId) lines.push(` vlan ${wifi.vlanId}`);

  if (wifi.security === 'open') {
    lines.push(' authentication open');
  } else if (wifi.security === 'wpa2-psk') {
    lines.push(' authentication open');
    lines.push(' authentication key-management wpa version 2');
    lines.push(` wpa-psk ascii ${wifi.passphrase || '<A_DEFINIR>'}`);
  } else {
    lines.push(' authentication network-eap eap_methods');
    lines.push(' authentication key-management wpa version 2');
  }
  lines.push('!');

  const radioIface = wifi.band === '5' ? 'Dot11Radio0/1/0' : 'Dot11Radio0/0/0';
  lines.push(`interface ${radioIface}`);
  lines.push(' encryption mode ciphers aes-ccm');
  lines.push(` ssid ${wifi.ssid}`);
  lines.push(` channel ${wifi.channel}`);
  lines.push(' no shutdown');
  lines.push('!');

  if (wifi.vlanId) {
    lines.push(`interface ${radioIface}.${wifi.vlanId}`);
    lines.push(` encapsulation dot1Q ${wifi.vlanId}`);
    lines.push(' bridge-group 1');
    lines.push('!');
  }

  return lines.join('\n');
}

function generateDeviceConfig(device) {
  if (device.type === 'switch') return generateSwitchDeviceConfig(device);
  if (device.type === 'router') return generateRouterDeviceConfig(device);
  if (device.type === 'ap') return generateApDeviceConfig(device);
  return generateHostDeviceConfig(device);
}
const topologyError = document.getElementById('topology-error');
const topologyResults = document.getElementById('topology-results');
const topologyGenerateBtn = document.getElementById('topology-generate-btn');
let lastTopologyOutputs = [];

// ==================================================================
// Validation automatique de la topologie
// ==================================================================
function collectAllIps() {
  const entries = []; // { deviceName, label, ip }

  devices.forEach(d => {
    if (d.type === 'router') {
      (deviceInterfaces[d.id] || []).forEach(iface => {
        if (iface.ip) {
          const label = iface.sub ? `${iface.name}.${iface.vlanId}` : iface.name;
          entries.push({ deviceName: d.name, label, ip: iface.ip.split('/')[0] });
        }
      });
    } else if (d.type === 'pc' || d.type === 'server') {
      const host = (deviceInterfaces[d.id] || [])[0];
      if (host && host.mode === 'static' && host.ip) {
        entries.push({ deviceName: d.name, label: host.name, ip: host.ip.split('/')[0] });
      }
    }
  });

  return entries;
}

function validateTopology() {
  const problems = []; // { level: 'error'|'warning', message }

  if (devices.length === 0) {
    return [{ level: 'warning', message: "Aucun équipement déclaré pour l'instant." }];
  }

  // 1. IP dupliquées
  const ipEntries = collectAllIps();
  const seenIps = {};
  ipEntries.forEach(entry => {
    if (!seenIps[entry.ip]) seenIps[entry.ip] = [];
    seenIps[entry.ip].push(entry);
  });
  Object.entries(seenIps).forEach(([ip, entries]) => {
    if (entries.length > 1) {
      const where = entries.map(e => `${e.deviceName} (${e.label})`).join(', ');
      problems.push({ level: 'error', message: `Adresse IP ${ip} utilisée plusieurs fois : ${where}` });
    }
  });

  // 2. Hôtes : IP hors du réseau du VLAN déclaré (via la SVI du routeur, si elle existe)
  devices.filter(d => d.type === 'pc' || d.type === 'server').forEach(d => {
    const host = (deviceInterfaces[d.id] || [])[0];
    if (!host || host.mode !== 'static' || !host.ip || !host.vlanId) return;

    const svi = topoVlanState.find(v => v.id === host.vlanId && v.svi);
    if (!svi) return;

    const [sviIp, sviCidr] = svi.svi.split('/');
    const maskInt = maskFromCidr(parseInt(sviCidr, 10));
    const sviNetwork = ipToInt(sviIp) & maskInt;
    const [hostIp] = host.ip.split('/');
    const hostInt = ipToInt(hostIp);

    if (hostInt !== null && (hostInt & maskInt) !== sviNetwork) {
      problems.push({ level: 'error', message: `${d.name} : IP ${hostIp} n'appartient pas au réseau du VLAN ${host.vlanId} (SVI ${svi.svi})` });
    }

    if (!host.gateway) {
      problems.push({ level: 'warning', message: `${d.name} : aucune passerelle renseignée (VLAN ${host.vlanId} a pourtant une SVI ${svi.svi})` });
    } else if (host.gateway !== sviIp) {
      problems.push({ level: 'warning', message: `${d.name} : passerelle ${host.gateway} différente de la SVI du VLAN ${host.vlanId} (${sviIp})` });
    }
  });

  // 3. Switch en mode VTP client sans domaine, ou incohérence de domaine VTP entre switchs
  const vtpDomains = new Set();
  devices.filter(d => d.type === 'switch').forEach(d => {
    const vtp = deviceVtp[d.id];
    if (vtp && vtp.mode !== 'off' && vtp.domain) vtpDomains.add(vtp.domain);
  });
  if (vtpDomains.size > 1) {
    problems.push({ level: 'warning', message: `Plusieurs domaines VTP différents détectés (${[...vtpDomains].join(', ')}) — les switchs ne pourront pas synchroniser leurs VLANs entre eux` });
  }

  // 4. Équipements isolés (aucun lien)
  devices.forEach(d => {
    const hasLink = links.some(l => l.a === d.id || l.b === d.id);
    if (!hasLink && devices.length > 1) {
      problems.push({ level: 'warning', message: `${d.name} n'est relié à aucun autre équipement dans le schéma` });
    }
  });

  return problems;
}

document.getElementById('topology-validate-btn').addEventListener('click', () => {
  const problems = validateTopology();
  const box = document.getElementById('topology-validation-results');

  if (problems.length === 0) {
    box.innerHTML = `<div class="validation-row ok"><span class="validation-icon">✓</span> Aucun problème détecté.</div>`;
  } else {
    const errors = problems.filter(p => p.level === 'error');
    const warnings = problems.filter(p => p.level === 'warning');
    box.innerHTML = [
      ...errors.map(p => `<div class="validation-row error"><span class="validation-icon">✕</span> ${p.message}</div>`),
      ...warnings.map(p => `<div class="validation-row warning"><span class="validation-icon">⚠</span> ${p.message}</div>`)
    ].join('');
  }
  box.classList.remove('hidden');
});

topologyGenerateBtn.addEventListener('click', () => {
  topologyError.classList.add('hidden');
  topologyResults.classList.add('hidden');

  if (devices.length === 0) {
    topologyError.textContent = "Ajoute au moins un équipement avant de générer";
    topologyError.classList.remove('hidden');
    return;
  }

  lastTopologyOutputs = devices.map(d => ({
    name: d.name,
    type: d.type,
    config: generateDeviceConfig(d)
  }));

  topologyResults.innerHTML = `
    <div class="topology-actions">
      <span class="hint">${lastTopologyOutputs.length} équipement(s) généré(s)</span>
      <button class="btn btn-outline" id="topology-zip-btn">↓ Télécharger tout (.zip)</button>
    </div>
    ${lastTopologyOutputs.map(o => `
      <div class="device-result">
        <div class="device-result-head">
          <span class="device-icon ${o.type}">${deviceTypeIcons[o.type]}</span>
          <h3>${o.name}</h3>
        </div>
        <pre class="code-output">${o.config}</pre>
        <div class="output-actions">
          <button class="btn btn-outline" data-copy-device="${o.name}">Copier</button>
          <button class="btn btn-outline" data-export-device="${o.name}">↓ Exporter (.txt)</button>
        </div>
      </div>
    `).join('')}
  `;
  topologyResults.classList.remove('hidden');
});

topologyResults.addEventListener('click', (e) => {
  if (e.target.dataset.copyDevice) {
    const out = lastTopologyOutputs.find(o => o.name === e.target.dataset.copyDevice);
    if (out) navigator.clipboard.writeText(out.config);
  }
  if (e.target.dataset.exportDevice) {
    const out = lastTopologyOutputs.find(o => o.name === e.target.dataset.exportDevice);
    if (out) {
      const blob = new Blob([out.config], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${out.name}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }
  if (e.target.id === 'topology-zip-btn') {
    if (typeof JSZip === 'undefined') {
      alert("JSZip n'a pas pu se charger (connexion internet requise pour cette fonction). Utilise les exports individuels à la place.");
      return;
    }
    const zip = new JSZip();
    lastTopologyOutputs.forEach(o => zip.file(`${o.name}.txt`, o.config));
    zip.generateAsync({ type: 'blob' }).then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'netforge-topologie.zip';
      a.click();
      URL.revokeObjectURL(url);
    });
  }
});

document.addEventListener('click', (e) => {
  if (!selectedDeviceId) return;
  if (e.target.dataset.removeDevPort !== undefined) {
    devicePorts[selectedDeviceId].splice(parseInt(e.target.dataset.removeDevPort, 10), 1);
    renderDeviceConfigPanel();
  }
  if (e.target.dataset.removeDevIf !== undefined) {
    deviceInterfaces[selectedDeviceId].splice(parseInt(e.target.dataset.removeDevIf, 10), 1);
    renderDeviceConfigPanel();
  }
  if (e.target.dataset.removeDevRoute !== undefined) {
    deviceRoutes[selectedDeviceId].splice(parseInt(e.target.dataset.removeDevRoute, 10), 1);
    renderDeviceConfigPanel();
  }
  if (e.target.dataset.removeNatStatic !== undefined) {
    deviceNat[selectedDeviceId].staticMappings.splice(parseInt(e.target.dataset.removeNatStatic, 10), 1);
    renderDeviceConfigPanel();
  }
  if (e.target.dataset.removeEc !== undefined) {
    deviceEtherchannels[selectedDeviceId].splice(parseInt(e.target.dataset.removeEc, 10), 1);
    renderDeviceConfigPanel();
  }
});

let savedState = null;
try {
  const rawSaved = loadState();
  if (rawSaved) {
    const { state: sanitized, repairedFields } = sanitizeState(rawSaved);
    savedState = sanitized;
    if (repairedFields.length) showIntegrityNotice(repairedFields);
  }
} catch (e) {
  console.warn('NetForge : état du projet illisible, redémarrage à vide', e);
  savedState = null;
  showIntegrityNotice(['(état complet)']);
}

try {
  if (savedState) {
    if (savedState.vlanState) vlanState = savedState.vlanState;
    if (savedState.portState) portState = savedState.portState;
    if (savedState.topoVlanState) topoVlanState = savedState.topoVlanState;
    if (savedState.devices) devices = savedState.devices;
    if (savedState.devicePorts) Object.assign(devicePorts, savedState.devicePorts);
    if (savedState.deviceInterfaces) Object.assign(deviceInterfaces, savedState.deviceInterfaces);
    if (savedState.deviceRoutes) Object.assign(deviceRoutes, savedState.deviceRoutes);
    if (savedState.deviceOspf) Object.assign(deviceOspf, savedState.deviceOspf);
    if (savedState.deviceBgp) Object.assign(deviceBgp, savedState.deviceBgp);
    if (savedState.deviceNat) Object.assign(deviceNat, savedState.deviceNat);
    if (savedState.deviceEtherchannels) Object.assign(deviceEtherchannels, savedState.deviceEtherchannels);
    if (savedState.deviceVtp) Object.assign(deviceVtp, savedState.deviceVtp);
    if (savedState.deviceWifi) Object.assign(deviceWifi, savedState.deviceWifi);
    if (savedState.deviceStp) Object.assign(deviceStp, savedState.deviceStp);
    if (savedState.deviceVpn) Object.assign(deviceVpn, savedState.deviceVpn);
    if (savedState.deviceSecurity) Object.assign(deviceSecurity, savedState.deviceSecurity);
    if (savedState.links) links = savedState.links;
    if (savedState.deviceIdSeq) deviceIdSeq = savedState.deviceIdSeq;
  }
  if (savedState && savedState.fwRules) fwRules = savedState.fwRules;
  if (savedState && savedState.fwPolicy) {
    const fwPolicySelect = document.getElementById('fw-policy');
    if (fwPolicySelect) fwPolicySelect.value = savedState.fwPolicy;
  }
  if (savedState && savedState.fwFormat) {
    const fwFormatSelect = document.getElementById('fw-format');
    if (fwFormatSelect) fwFormatSelect.value = savedState.fwFormat;
  }
  if (savedState && savedState.dnsRecords) dnsRecords = savedState.dnsRecords;
  if (savedState && savedState.networkGroups) networkGroups = savedState.networkGroups;
  if (savedState && savedState.serviceGroups) serviceGroups = savedState.serviceGroups;
  if (savedState) {
    const zoneEl = document.getElementById('dns-zone-name');
    const nsEl = document.getElementById('dns-primary-ns');
    const emailEl = document.getElementById('dns-admin-email');
    if (zoneEl && savedState.dnsZoneName) zoneEl.value = savedState.dnsZoneName;
    if (nsEl && savedState.dnsPrimaryNs) nsEl.value = savedState.dnsPrimaryNs;
    if (emailEl && savedState.dnsAdminEmail) emailEl.value = savedState.dnsAdminEmail;
    const dhcpSnoopEl = document.getElementById('vlan-dhcp-snooping');
    if (dhcpSnoopEl && savedState.vlanDhcpSnooping) dhcpSnoopEl.checked = true;
    const fwReflexiveEl = document.getElementById('fw-reflexive');
    if (fwReflexiveEl && savedState.fwReflexive) fwReflexiveEl.checked = true;
    const fwIpv6El = document.getElementById('fw-ipv6');
    if (fwIpv6El && savedState.fwIpv6) fwIpv6El.checked = true;
    const fwZbfEl = document.getElementById('fw-zbf');
    if (fwZbfEl && savedState.fwZbf) fwZbfEl.checked = true;
    const fwZbfInsideEl = document.getElementById('fw-zbf-inside-if');
    if (fwZbfInsideEl && savedState.fwZbfInsideIf) fwZbfInsideEl.value = savedState.fwZbfInsideIf;
    const fwZbfOutsideEl = document.getElementById('fw-zbf-outside-if');
    if (fwZbfOutsideEl && savedState.fwZbfOutsideIf) fwZbfOutsideEl.value = savedState.fwZbfOutsideIf;
  }
  if (typeof updateFwFormatFieldsVisibility === 'function') updateFwFormatFieldsVisibility();
} catch (e) {
  console.warn('NetForge : application partielle de l\'état du projet', e);
  showIntegrityNotice(['(application de l\'état)']);
}

renderVlanChips();
renderPortRows();
renderDeviceList();
renderLinkRows();

// ==================================================================
// Module Firewall — constructeur visuel de règles + ACL Cisco + testeur
// ==================================================================
// { action, proto, port, source, dest, log }

const fwRuleRows = document.getElementById('fw-rule-rows');
const fwRuleProto = document.getElementById('fw-rule-proto');
const fwRulePortField = document.getElementById('fw-rule-port-field');
const fwRuleIcmpField = document.getElementById('fw-rule-icmp-field');

function updateFwPortFieldVisibility() {
  const proto = fwRuleProto.value;
  fwRulePortField.style.display = (proto === 'icmp' || proto === 'any') ? 'none' : 'flex';
  fwRuleIcmpField.style.display = proto === 'icmp' ? 'flex' : 'none';
}
fwRuleProto.addEventListener('change', updateFwPortFieldVisibility);
updateFwPortFieldVisibility();

document.querySelectorAll('[data-fill-port]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('fw-rule-port').value = btn.dataset.fillPort;
  });
});

// ---- Object-groups Cisco (réseau + service) ----
function renderOgSelects() {
  const srcSelect = document.getElementById('fw-rule-src-group');
  const dstSelect = document.getElementById('fw-rule-dst-group');
  const svcSelect = document.getElementById('fw-rule-svc-group');

  const netOptions = '<option value="">— aucun —</option>' + networkGroups.map(g => `<option value="${g.name}">${g.name} (${g.members.length})</option>`).join('');
  srcSelect.innerHTML = netOptions;
  dstSelect.innerHTML = netOptions;
  svcSelect.innerHTML = '<option value="">— aucun —</option>' + serviceGroups.map(g => `<option value="${g.name}">${g.name} (${g.members.length})</option>`).join('');
}

function renderOgNetRows() {
  const box = document.getElementById('og-net-rows');
  if (networkGroups.length === 0) {
    box.innerHTML = '<span class="empty-hint">Aucun groupe réseau pour l\'instant</span>';
  } else {
    box.innerHTML = networkGroups.map((g, gIdx) => `
      <div class="port-row">
        <span class="port-name">${g.name}</span>
        <span class="port-detail">${g.members.join(', ') || '(vide)'}</span>
        <button class="chip-remove" data-remove-og-net-group="${gIdx}" title="Retirer le groupe">&times;</button>
      </div>
    `).join('');
  }
  renderOgSelects();
  saveState();
}

function renderOgSvcRows() {
  const box = document.getElementById('og-svc-rows');
  if (serviceGroups.length === 0) {
    box.innerHTML = '<span class="empty-hint">Aucun groupe de services pour l\'instant</span>';
  } else {
    box.innerHTML = serviceGroups.map((g, gIdx) => `
      <div class="port-row">
        <span class="port-name">${g.name}</span>
        <span class="port-detail">${g.members.map(m => `${m.proto} ${m.port}`).join(', ') || '(vide)'}</span>
        <button class="chip-remove" data-remove-og-svc-group="${gIdx}" title="Retirer le groupe">&times;</button>
      </div>
    `).join('');
  }
  renderOgSelects();
  saveState();
}

document.getElementById('og-net-add-btn').addEventListener('click', () => {
  const name = document.getElementById('og-net-name').value.trim().toUpperCase();
  const member = document.getElementById('og-net-member').value.trim();
  if (!name || !member) return;

  let group = networkGroups.find(g => g.name === name);
  if (!group) {
    group = { name, members: [] };
    networkGroups.push(group);
  }
  if (!group.members.includes(member)) group.members.push(member);

  document.getElementById('og-net-member').value = '';
  renderOgNetRows();
});

document.getElementById('og-svc-add-btn').addEventListener('click', () => {
  const name = document.getElementById('og-svc-name').value.trim().toUpperCase();
  const proto = document.getElementById('og-svc-proto').value;
  const port = document.getElementById('og-svc-port').value.trim();
  if (!name || !port) return;

  let group = serviceGroups.find(g => g.name === name);
  if (!group) {
    group = { name, members: [] };
    serviceGroups.push(group);
  }
  if (!group.members.some(m => m.proto === proto && m.port === port)) {
    group.members.push({ proto, port });
  }

  document.getElementById('og-svc-port').value = '';
  renderOgSvcRows();
});

document.addEventListener('click', (e) => {
  if (e.target.dataset.removeOgNetGroup !== undefined) {
    networkGroups.splice(parseInt(e.target.dataset.removeOgNetGroup, 10), 1);
    renderOgNetRows();
  }
  if (e.target.dataset.removeOgSvcGroup !== undefined) {
    serviceGroups.splice(parseInt(e.target.dataset.removeOgSvcGroup, 10), 1);
    renderOgSvcRows();
  }
});

function formatFwEndpoint(value) {
  if (value.startsWith('OG:')) return `groupe ${value.slice(3)}`;
  return value;
}

function renderFwRuleRows() {
  if (fwRules.length === 0) {
    fwRuleRows.innerHTML = '<span class="empty-hint">Aucune règle ajoutée pour l\'instant</span>';
    saveState();
    return;
  }
  fwRuleRows.innerHTML = fwRules.map((r, idx) => {
    const isSvcGroup = r.port && r.port.startsWith('SVCOG:');
    const protoPortPart = isSvcGroup ? ` groupe ${r.port.slice(6)}` : `${r.proto.toUpperCase()}${r.port ? ' port ' + r.port : ''}${r.icmpType ? ' type ' + r.icmpType : ''}`;
    const logPart = r.log ? ` <span class="port-detail-extra">[log]</span>` : '';
    const trPart = r.timeRange ? ` <span class="port-detail-extra">[⏱ ${r.timeRange}]</span>` : '';
    const rlPart = r.rateLimit ? ` <span class="port-detail-extra">[⚡ ${r.rateLimit}]</span>` : '';
    return `
      <div class="port-row">
        <span class="port-badge ${r.action === 'ACCEPT' ? 'access' : 'trunk'}">${r.action}</span>
        <span class="port-detail">${protoPortPart} — ${formatFwEndpoint(r.source)} → ${formatFwEndpoint(r.dest)}${logPart}${trPart}${rlPart}</span>
        <button class="chip-remove" data-fw-move-up="${idx}" title="Monter" ${idx === 0 ? 'style="opacity:0.3;pointer-events:none;"' : ''}>↑</button>
        <button class="chip-remove" data-fw-move-down="${idx}" title="Descendre" ${idx === fwRules.length - 1 ? 'style="opacity:0.3;pointer-events:none;"' : ''}>↓</button>
        <button class="chip-remove" data-remove-fw-rule="${idx}" title="Retirer">&times;</button>
      </div>
    `;
  }).join('');
  saveState();
}

document.getElementById('fw-add-rule-btn').addEventListener('click', () => {
  const action = document.getElementById('fw-rule-action').value;
  let proto = fwRuleProto.value;
  let port = (proto === 'icmp' || proto === 'any') ? '' : document.getElementById('fw-rule-port').value.trim();
  const icmpType = proto === 'icmp' ? document.getElementById('fw-rule-icmptype').value : '';
  let source = document.getElementById('fw-rule-source').value.trim() || 'any';
  let dest = document.getElementById('fw-rule-dest').value.trim() || 'any';
  const log = document.getElementById('fw-rule-log').checked;
  const timeRange = document.getElementById('fw-rule-timerange').value.trim();
  const rateLimit = document.getElementById('fw-rule-ratelimit').value.trim();

  const srcGroup = document.getElementById('fw-rule-src-group').value;
  const dstGroup = document.getElementById('fw-rule-dst-group').value;
  const svcGroup = document.getElementById('fw-rule-svc-group').value;

  if (srcGroup) source = `OG:${srcGroup}`;
  if (dstGroup) dest = `OG:${dstGroup}`;
  if (svcGroup) { proto = 'any'; port = `SVCOG:${svcGroup}`; }

  fwRules.push({ action, proto, port, source, dest, log, timeRange, rateLimit, icmpType });
  document.getElementById('fw-rule-port').value = '';
  document.getElementById('fw-rule-source').value = 'any';
  document.getElementById('fw-rule-dest').value = 'any';
  document.getElementById('fw-rule-log').checked = false;
  document.getElementById('fw-rule-timerange').value = '';
  document.getElementById('fw-rule-ratelimit').value = '';
  document.getElementById('fw-rule-src-group').value = '';
  document.getElementById('fw-rule-dst-group').value = '';
  document.getElementById('fw-rule-svc-group').value = '';
  renderFwRuleRows();
});

document.addEventListener('click', (e) => {
  if (e.target.dataset.removeFwRule !== undefined) {
    fwRules.splice(parseInt(e.target.dataset.removeFwRule, 10), 1);
    renderFwRuleRows();
  }
  if (e.target.dataset.fwMoveUp !== undefined) {
    const idx = parseInt(e.target.dataset.fwMoveUp, 10);
    if (idx > 0) {
      [fwRules[idx - 1], fwRules[idx]] = [fwRules[idx], fwRules[idx - 1]];
      renderFwRuleRows();
    }
  }
  if (e.target.dataset.fwMoveDown !== undefined) {
    const idx = parseInt(e.target.dataset.fwMoveDown, 10);
    if (idx < fwRules.length - 1) {
      [fwRules[idx + 1], fwRules[idx]] = [fwRules[idx], fwRules[idx + 1]];
      renderFwRuleRows();
    }
  }
});

// ---- Presets rapides ----
document.getElementById('fw-preset-web').addEventListener('click', () => {
  fwRules.push(
    { action: 'ACCEPT', proto: 'tcp', port: '22', source: 'any', dest: 'any', log: false },
    { action: 'ACCEPT', proto: 'tcp', port: '80,443', source: 'any', dest: 'any', log: false }
  );
  renderFwRuleRows();
});

document.getElementById('fw-preset-ssh').addEventListener('click', () => {
  const adminNet = prompt("Réseau admin autorisé en SSH (ex: 192.168.10.0/24) :", "192.168.10.0/24");
  if (!adminNet) return;
  fwRules.push(
    { action: 'ACCEPT', proto: 'tcp', port: '22', source: adminNet, dest: 'any', log: true },
    { action: 'DROP', proto: 'tcp', port: '22', source: 'any', dest: 'any', log: true }
  );
  renderFwRuleRows();
});

// ---- Génération iptables ----
function resolveNetworkGroupMembers(value) {
  if (value && value.startsWith('OG:')) {
    const group = networkGroups.find(g => g.name === value.slice(3));
    return (group && group.members.length > 0) ? group.members : ['any'];
  }
  return [value];
}

function resolveServiceGroupMembers(rule) {
  if (rule.port && rule.port.startsWith('SVCOG:')) {
    const group = serviceGroups.find(g => g.name === rule.port.slice(6));
    return (group && group.members.length > 0) ? group.members : [{ proto: 'ip', port: '' }];
  }
  return [{ proto: rule.proto, port: rule.port }];
}

// ---- Analyse des champs plage horaire / limite de débit ----
function parseTimeRange(str) {
  if (!str) return null;
  const match = str.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (!match) return null;
  return { start: match[1], end: match[2], raw: str };
}

function parseRateLimit(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)\s*\/\s*(sec|second|min|minute|hour|heure)/i);
  if (!match) return null;
  const unitMap = { sec: 'second', second: 'second', min: 'minute', minute: 'minute', hour: 'hour', heure: 'hour' };
  const unit = unitMap[match[2].toLowerCase()] || 'second';
  return { count: match[1], unit, raw: str };
}

const icmpTypeIptables = {
  'echo-request': 'echo-request',
  'echo-reply': 'echo-reply',
  'time-exceeded': 'time-exceeded',
  'unreachable': 'destination-unreachable',
  'redirect': 'redirect'
};
const icmpTypeCisco = {
  'echo-request': 'echo',
  'echo-reply': 'echo-reply',
  'time-exceeded': 'time-exceeded',
  'unreachable': 'unreachable',
  'redirect': 'redirect'
};

function generateIptablesConfig(policy, rules) {
  const validPolicies = ['ACCEPT', 'DROP', 'REJECT'];
  policy = policy.trim().toUpperCase();
  if (!validPolicies.includes(policy)) throw new Error("Politique par défaut invalide (ACCEPT, DROP ou REJECT)");
  if (rules.length === 0) throw new Error("Ajoute au moins une règle avant de générer");

  const lines = [];
  lines.push('#!/bin/sh');
  lines.push('# === Règles iptables générées par NetForge ===');
  lines.push('');
  lines.push('iptables -F');
  lines.push('');
  lines.push(`iptables -P INPUT ${policy}`);
  lines.push(`iptables -P FORWARD ${policy}`);
  lines.push(`iptables -P OUTPUT ACCEPT`);
  lines.push('');
  lines.push('# Autoriser le trafic déjà établi');
  lines.push('iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT');
  lines.push('iptables -A INPUT -i lo -j ACCEPT');
  lines.push('');

  rules.forEach((r, idx) => {
    const usesGroup = r.source.startsWith('OG:') || r.dest.startsWith('OG:') || (r.port && r.port.startsWith('SVCOG:'));
    lines.push(`# Règle ${idx + 1}${usesGroup ? ' (groupe(s) développé(s) individuellement — iptables n\'a pas d\'object-group natif)' : ''}`);

    const sources = resolveNetworkGroupMembers(r.source);
    const dests = resolveNetworkGroupMembers(r.dest);
    const svcs = resolveServiceGroupMembers(r);
    const timeRange = parseTimeRange(r.timeRange);
    const rateLimit = parseRateLimit(r.rateLimit);
    if (r.timeRange && !timeRange) lines.push(`# ⚠ Plage horaire "${r.timeRange}" non reconnue (format attendu HH:MM-HH:MM) — ignorée`);
    if (r.rateLimit && !rateLimit) lines.push(`# ⚠ Limite de débit "${r.rateLimit}" non reconnue (format attendu ex. 100/sec) — ignorée`);

    sources.forEach(source => {
      dests.forEach(dest => {
        svcs.forEach(svc => {
          let base = `-p ${svc.proto}`;
          if (svc.port) base += ` --dport ${svc.port}`;
          if (svc.proto === 'icmp' && r.icmpType && icmpTypeIptables[r.icmpType]) base += ` --icmp-type ${icmpTypeIptables[r.icmpType]}`;
          if (source && source.toLowerCase() !== 'any') base += ` -s ${source}`;
          if (dest && dest.toLowerCase() !== 'any') base += ` -d ${dest}`;
          if (timeRange) base += ` -m time --timestart ${timeRange.start}:00 --timestop ${timeRange.end}:00`;
          if (rateLimit) base += ` -m limit --limit ${rateLimit.count}/${rateLimit.unit} --limit-burst ${Math.max(5, parseInt(rateLimit.count, 10))}`;

          if (r.log) {
            lines.push(`iptables -A INPUT ${base} -j LOG --log-prefix "NETFORGE-R${idx + 1}: "`);
          }
          lines.push(`iptables -A INPUT ${base} -j ${r.action}`);
        });
      });
    });
  });

  lines.push('');
  lines.push('echo "Règles iptables appliquées."');
  return lines.join('\n');
}

// ---- Génération ACL Cisco ----
function ciscoAddrFormat(value) {
  if (!value || value.toLowerCase() === 'any') return 'any';
  if (value.startsWith('OG:')) return `object-group ${value.slice(3)}`;
  if (value.includes('/')) {
    const [ip, cidrStr] = value.split('/');
    const cidr = parseInt(cidrStr, 10);
    const maskInt = maskFromCidr(cidr);
    const wildcard = intToIp((~maskInt) >>> 0);
    const networkInt = (ipToInt(ip) & maskInt) >>> 0;
    return `${intToIp(networkInt)} ${wildcard}`;
  }
  return `host ${value}`;
}

// Les ACL IPv6 Cisco n'utilisent pas de masque générique : le préfixe s'exprime directement en "adresse/longueur".
function ciscoAddrFormatV6(value) {
  if (!value || value.toLowerCase() === 'any') return 'any';
  if (value.startsWith('OG:')) return `object-group ${value.slice(3)}`;
  if (value.includes('/')) return value; // déjà au format préfixe/longueur
  return `host ${value}`;
}

function generateCiscoAclConfig(policy, rules, reflexive, ipv6) {
  if (rules.length === 0) throw new Error("Ajoute au moins une règle avant de générer");
  const addrFormat = ipv6 ? ciscoAddrFormatV6 : ciscoAddrFormat;
  const aclKeyword = ipv6 ? 'ipv6 access-list' : 'ip access-list extended';
  const aclName = ipv6 ? 'NETFORGE_ACL6' : 'NETFORGE_ACL';
  const applyKeyword = ipv6 ? 'ipv6 traffic-filter' : 'ip access-group';

  const lines = [];
  lines.push('! === ACL Cisco générée par NetForge ===');

  if (networkGroups.length > 0 && !ipv6) {
    lines.push('! --- Object-groups réseau ---');
    networkGroups.forEach(g => {
      lines.push(`object-group network ${g.name}`);
      g.members.forEach(m => {
        if (m.includes('/')) {
          const [ip, cidrStr] = m.split('/');
          const maskInt = maskFromCidr(parseInt(cidrStr, 10));
          const networkInt = (ipToInt(ip) & maskInt) >>> 0;
          lines.push(` network-object ${intToIp(networkInt)} ${intToIp(maskInt)}`);
        } else {
          lines.push(` network-object host ${m}`);
        }
      });
    });
    lines.push('!');
  } else if (networkGroups.length > 0 && ipv6) {
    lines.push('! --- Object-groups réseau ignorés en mode IPv6 (définis en adressage IPv4, non applicables ici) ---');
  }

  if (serviceGroups.length > 0) {
    lines.push('! --- Object-groups service ---');
    serviceGroups.forEach(g => {
      lines.push(`object-group service ${g.name}`);
      g.members.forEach(m => lines.push(` ${m.proto} eq ${m.port}`));
    });
    lines.push('!');
  }

  // Génère un objet time-range par règle qui en a un ; réutilisable indépendamment de l'ACL elle-même.
  const timeRangeNames = {};
  rules.forEach((r, idx) => {
    const tr = parseTimeRange(r.timeRange);
    if (!tr) return;
    const name = `TR_RULE${idx + 1}`;
    timeRangeNames[idx] = name;
  });
  if (Object.keys(timeRangeNames).length > 0) {
    lines.push('! --- Plages horaires (time-range) ---');
    rules.forEach((r, idx) => {
      const tr = parseTimeRange(r.timeRange);
      if (!tr) return;
      lines.push(`time-range ${timeRangeNames[idx]}`);
      lines.push(` periodic weekdays ${tr.start} to ${tr.end}`);
    });
    lines.push('!');
  }

  lines.push(`${aclKeyword} ${aclName}`);

  const reflexiveEligible = reflexive
    ? rules.filter(r => r.action === 'ACCEPT' && (r.proto === 'tcp' || r.proto === 'udp') && !(r.port && r.port.startsWith('SVCOG:')))
    : [];
  if (reflexiveEligible.length > 0) {
    lines.push(' evaluate NETFORGE_REFLECT');
  }

  rules.forEach((r, idx) => {
    const action = r.action === 'ACCEPT' ? 'permit' : 'deny';
    if (ipv6 && (r.source.startsWith('OG:') || r.dest.startsWith('OG:'))) {
      lines.push(` ! ⚠ règle ${idx + 1} ignorée : utilise un object-group réseau, non disponible en mode IPv6 ici`);
      return;
    }
    const src = addrFormat(r.source);
    const dst = addrFormat(r.dest);
    const trSuffix = timeRangeNames[idx] ? ` time-range ${timeRangeNames[idx]}` : '';

    if (r.port && r.port.startsWith('SVCOG:')) {
      const svcName = r.port.slice(6);
      let line = ` ${action} object-group ${svcName} ${src} ${dst}`;
      if (r.log) line += ' log';
      line += trSuffix;
      lines.push(line);
      return;
    }

    const proto = r.proto === 'any' ? (ipv6 ? 'ipv6' : 'ip') : r.proto;
    const ports = r.port ? r.port.split(',').map(p => p.trim()) : [null];
    ports.forEach(port => {
      let line = ` ${action} ${proto} ${src} ${dst}`;
      if (port) line += ` eq ${port}`;
      if (proto === 'icmp' && r.icmpType && icmpTypeCisco[r.icmpType]) line += ` ${icmpTypeCisco[r.icmpType]}`;
      if (r.log) line += ' log';
      line += trSuffix;
      lines.push(line);
    });
  });

  const finalAction = (policy === 'ACCEPT') ? 'permit' : 'deny';
  lines.push(` ${finalAction} ${ipv6 ? 'ipv6' : 'ip'} any any`);
  lines.push('!');
  lines.push('! Exemple d\'application sur une interface :');
  lines.push('! interface GigabitEthernet0/0');
  lines.push(`!  ${applyKeyword} ${aclName} in`);

  if (reflexiveEligible.length > 0) {
    lines.push('!');
    lines.push('! --- ACL réflexive (stateful) : suivi dynamique du trafic retour ---');
    lines.push('! La liste ci-dessous s\'applique en sortie (vers l\'extérieur) et déclenche le suivi de session ;');
    lines.push(`! "evaluate NETFORGE_REFLECT" ci-dessus autorise alors automatiquement le retour dans ${aclName}.`);
    lines.push(`${aclKeyword} ${aclName}_OUT`);
    reflexiveEligible.forEach((r) => {
      if (ipv6 && (r.source.startsWith('OG:') || r.dest.startsWith('OG:'))) return;
      const src = addrFormat(r.source);
      const dst = addrFormat(r.dest);
      const ports = r.port ? r.port.split(',').map(p => p.trim()) : [null];
      ports.forEach(port => {
        let line = ` permit ${r.proto} ${src} ${dst}`;
        if (port) line += ` eq ${port}`;
        line += ' reflect NETFORGE_REFLECT';
        lines.push(line);
      });
    });
    lines.push('!');
    lines.push('! Exemple d\'application (sur l\'interface opposée, direction sortante) :');
    lines.push('! interface GigabitEthernet0/1');
    lines.push(`!  ${applyKeyword} ${aclName}_OUT out`);
  }

  // Limitation de débit (rate-limit) : nécessite du MQC (class-map/policy-map), séparé de l'ACL.
  const rateLimitedRules = rules.map((r, idx) => ({ r, idx })).filter(x => parseRateLimit(x.r.rateLimit) && !(ipv6 && (x.r.source.startsWith('OG:') || x.r.dest.startsWith('OG:'))));
  if (rateLimitedRules.length > 0) {
    lines.push('!');
    lines.push('! --- Limitation de débit (rate-limit) — nécessite le class-based policing (MQC) ---');
    rateLimitedRules.forEach(({ r, idx }) => {
      const rl = parseRateLimit(r.rateLimit);
      const className = `RL_RULE${idx + 1}`;
      const acl = `RL_ACL${idx + 1}`;
      const src = addrFormat(r.source);
      const dst = addrFormat(r.dest);
      lines.push(`${aclKeyword} ${acl}`);
      lines.push(` permit ${r.proto === 'any' ? (ipv6 ? 'ipv6' : 'ip') : r.proto} ${src} ${dst}`);
      lines.push(`class-map match-all ${className}`);
      lines.push(` match access-group name ${acl}`);
      lines.push(`policy-map NETFORGE_POLICING`);
      lines.push(` class ${className}`);
      // "police" attend un débit en bits/s ; on convertit approximativement le débit indiqué (paquets/s) en une limite indicative,
      // avec un commentaire rappelant qu'un calibrage précis dépend de la taille moyenne des paquets réels.
      lines.push(`  police ${parseInt(rl.count, 10) * 8000} conform-action transmit exceed-action drop`);
      lines.push(`  ! ↳ ${rl.raw} — valeur indicative convertie en bits/s (à ajuster selon la taille réelle des paquets)`);
    });
    lines.push('! Application typique : interface GigabitEthernet0/0 → service-policy input NETFORGE_POLICING');
  }

  return lines.join('\n');
}

// ---- Pare-feu à zones (Zone-Based Firewall / ZBF) — approche moderne remplaçant les ACL réflexives ----
function generateZoneBasedFirewallConfig(policy, rules, insideIf, outsideIf, ipv6) {
  if (rules.length === 0) throw new Error("Ajoute au moins une règle avant de générer");
  if (!insideIf || !outsideIf) throw new Error("Indique l'interface intérieure et l'interface extérieure pour le ZBF");

  const addrFormat = ipv6 ? ciscoAddrFormatV6 : ciscoAddrFormat;
  const aclKeyword = ipv6 ? 'ipv6 access-list' : 'ip access-list extended';
  const aclName = 'NETFORGE_ZBF_ACL';
  const acceptedRules = rules.filter(r => r.action === 'ACCEPT');
  if (acceptedRules.length === 0) throw new Error("Aucune règle ACCEPT à autoriser entre les zones — le ZBF bloque tout par défaut, il faut au moins une règle à inspecter");

  const lines = [];
  lines.push('! === Pare-feu à zones (ZBF/ZFW) généré par NetForge ===');
  lines.push('! Contrairement à une ACL classique, le ZBF bloque TOUT le trafic entre zones par défaut :');
  lines.push('! seul le trafic explicitement inspecté (classe ci-dessous) est autorisé, dans les deux sens.');
  lines.push('!');
  lines.push('zone security IN');
  lines.push(' description Zone interne (réseau protégé)');
  lines.push('zone security OUT');
  lines.push(' description Zone externe (Internet / non fiable)');
  lines.push('!');

  lines.push(`${aclKeyword} ${aclName}`);
  acceptedRules.forEach((r, idx) => {
    if (ipv6 && (r.source.startsWith('OG:') || r.dest.startsWith('OG:'))) {
      lines.push(` ! ⚠ règle ${idx + 1} ignorée : object-group non disponible en mode IPv6 ici`);
      return;
    }
    const src = addrFormat(r.source);
    const dst = addrFormat(r.dest);
    if (r.port && r.port.startsWith('SVCOG:')) {
      lines.push(` permit object-group ${r.port.slice(6)} ${src} ${dst}`);
      return;
    }
    const proto = r.proto === 'any' ? (ipv6 ? 'ipv6' : 'ip') : r.proto;
    const ports = r.port ? r.port.split(',').map(p => p.trim()) : [null];
    ports.forEach(port => {
      let line = ` permit ${proto} ${src} ${dst}`;
      if (port) line += ` eq ${port}`;
      if (proto === 'icmp' && r.icmpType && icmpTypeCisco[r.icmpType]) line += ` ${icmpTypeCisco[r.icmpType]}`;
      lines.push(line);
    });
  });
  lines.push('!');

  lines.push('class-map type inspect match-any NETFORGE_ZBF_CLASS');
  lines.push(` match access-group name ${aclName}`);
  lines.push('!');

  lines.push('policy-map type inspect NETFORGE_ZBF_POLICY');
  lines.push(' class type inspect NETFORGE_ZBF_CLASS');
  lines.push('  inspect');
  lines.push(' class class-default');
  lines.push(`  ${policy === 'ACCEPT' ? 'pass' : 'drop log'}`);
  lines.push('!');

  lines.push('zone-pair security NETFORGE_ZP_IN_OUT source IN destination OUT');
  lines.push(' service-policy type inspect NETFORGE_ZBF_POLICY');
  lines.push('!');
  lines.push('! Le trafic retour (OUT vers IN) est automatiquement autorisé par "inspect" — pas besoin de zone-pair symétrique.');
  lines.push('! Pour autoriser aussi des connexions initiées depuis OUT vers IN (ex: serveur publié), créer un second');
  lines.push('! zone-pair (source OUT destination IN) avec sa propre policy-map dédiée.');
  lines.push('!');

  lines.push(`interface ${insideIf}`);
  lines.push(' zone-member security IN');
  lines.push('!');
  lines.push(`interface ${outsideIf}`);
  lines.push(' zone-member security OUT');
  lines.push('!');

  return lines.join('\n');
}

const fwBtn = document.getElementById('fw-btn');
const fwError = document.getElementById('fw-error');
const fwOutputBox = document.getElementById('fw-output-box');
const fwOutput = document.getElementById('fw-output');

fwBtn.addEventListener('click', () => {
  fwError.classList.add('hidden');
  fwOutputBox.classList.add('hidden');
  try {
    const policy = document.getElementById('fw-policy').value;
    const format = document.getElementById('fw-format').value;
    const reflexive = document.getElementById('fw-reflexive').checked;
    const zbf = document.getElementById('fw-zbf').checked;
    const ipv6 = document.getElementById('fw-ipv6').checked;
    let config;
    if (format === 'cisco' && zbf) {
      const insideIf = document.getElementById('fw-zbf-inside-if').value.trim();
      const outsideIf = document.getElementById('fw-zbf-outside-if').value.trim();
      config = generateZoneBasedFirewallConfig(policy, fwRules, insideIf, outsideIf, ipv6);
    } else if (format === 'cisco') {
      config = generateCiscoAclConfig(policy, fwRules, reflexive, ipv6);
    } else {
      config = generateIptablesConfig(policy, fwRules);
    }
    fwOutput.textContent = config;
    fwOutputBox.classList.remove('hidden');
  } catch (e) {
    fwError.textContent = e.message;
    fwError.classList.remove('hidden');
  }
});

document.getElementById('fw-copy-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(fwOutput.textContent);
});

document.getElementById('fw-export-btn').addEventListener('click', () => {
  const format = document.getElementById('fw-format').value;
  const ext = format === 'cisco' ? 'txt' : 'sh';
  const blob = new Blob([fwOutput.textContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `firewall-rules.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
});

function updateFwFormatFieldsVisibility() {
  const format = document.getElementById('fw-format').value;
  document.getElementById('fw-reflexive-row').style.display = format === 'cisco' ? 'flex' : 'none';
  document.getElementById('fw-zbf-row').style.display = format === 'cisco' ? 'flex' : 'none';
  document.getElementById('fw-zbf-zones-row').style.display = (format === 'cisco' && document.getElementById('fw-zbf').checked) ? 'flex' : 'none';
  document.getElementById('fw-ipv6-row').style.display = format === 'cisco' ? 'flex' : 'none';
}
updateFwFormatFieldsVisibility();

document.getElementById('fw-policy').addEventListener('change', saveState);
document.getElementById('fw-format').addEventListener('change', () => { updateFwFormatFieldsVisibility(); saveState(); });
document.getElementById('fw-reflexive').addEventListener('change', () => {
  if (document.getElementById('fw-reflexive').checked) document.getElementById('fw-zbf').checked = false;
  updateFwFormatFieldsVisibility();
  saveState();
});
document.getElementById('fw-zbf').addEventListener('change', () => {
  if (document.getElementById('fw-zbf').checked) document.getElementById('fw-reflexive').checked = false;
  updateFwFormatFieldsVisibility();
  saveState();
});
document.getElementById('fw-zbf-inside-if').addEventListener('change', saveState);
document.getElementById('fw-zbf-outside-if').addEventListener('change', saveState);
document.getElementById('fw-ipv6').addEventListener('change', saveState);

// ---- Testeur de règles ----
function ipInCidrOrHost(testIp, ruleValue) {
  if (!ruleValue || ruleValue.toLowerCase() === 'any') return true;
  if (ruleValue.startsWith('OG:')) {
    const group = networkGroups.find(g => g.name === ruleValue.slice(3));
    if (!group) return false;
    return group.members.some(m => ipInCidrOrHost(testIp, m));
  }
  const testInt = ipToInt(testIp);
  if (testInt === null) return false;
  if (ruleValue.includes('/')) {
    const [netIp, cidrStr] = ruleValue.split('/');
    const maskInt = maskFromCidr(parseInt(cidrStr, 10));
    return (testInt & maskInt) === (ipToInt(netIp) & maskInt);
  }
  return testInt === ipToInt(ruleValue);
}

function portMatches(testProto, testPort, rule) {
  if (rule.port && rule.port.startsWith('SVCOG:')) {
    const group = serviceGroups.find(g => g.name === rule.port.slice(6));
    if (!group) return false;
    return group.members.some(m => m.proto === testProto && String(m.port) === String(testPort));
  }
  if (!rule.port) return true;
  const list = rule.port.split(',').map(p => p.trim());
  return list.includes(String(testPort));
}

document.getElementById('fw-test-btn').addEventListener('click', () => {
  const proto = document.getElementById('fw-test-proto').value;
  const port = document.getElementById('fw-test-port').value.trim();
  const source = document.getElementById('fw-test-source').value.trim();
  const dest = document.getElementById('fw-test-dest').value.trim();
  const resultBox = document.getElementById('fw-test-result');

  if (!source || !dest) {
    resultBox.textContent = 'Renseigne au moins une source et une destination.';
    resultBox.className = 'hint hint-warn';
    return;
  }

  let matchIdx = -1;
  for (let i = 0; i < fwRules.length; i++) {
    const r = fwRules[i];
    if (r.proto !== 'any' && r.proto !== proto) continue;
    if (proto !== 'icmp' && !portMatches(proto, port, r)) continue;
    if (!ipInCidrOrHost(source, r.source)) continue;
    if (!ipInCidrOrHost(dest, r.dest)) continue;
    matchIdx = i;
    break;
  }

  if (matchIdx === -1) {
    const policy = document.getElementById('fw-policy').value;
    resultBox.textContent = `Aucune règle ne matche → politique par défaut appliquée : ${policy}`;
    resultBox.className = policy === 'ACCEPT' ? 'hint hint-ok' : 'hint hint-warn';
  } else {
    const r = fwRules[matchIdx];
    resultBox.textContent = `Règle n°${matchIdx + 1} matche en premier → ${r.action} (${r.proto.toUpperCase()}${r.port ? ' port ' + r.port : ''}, ${r.source} → ${r.dest})`;
    resultBox.className = r.action === 'ACCEPT' ? 'hint hint-ok' : 'hint hint-warn';
  }
});

renderOgNetRows();
renderOgSvcRows();
renderFwRuleRows();

// ==================================================================
// Module DNS — génération de zone BIND
// ==================================================================
const dnsValueLabels = {
  A: 'Adresse IP',
  CNAME: 'Cible (nom canonique)',
  MX: 'Serveur mail',
  NS: 'Serveur de noms',
  PTR: 'Nom cible (FQDN)',
  TXT: 'Texte',
  SRV: 'Cible (hôte du service)',
  CAA: 'Autorité de certification (ex: letsencrypt.org)'
};

const dnsNameLabels = {
  SRV: 'Nom (ex: _sip._tcp)'
};

const dnsRecType = document.getElementById('dns-rec-type');
const dnsRecNameLabel = document.getElementById('dns-rec-name-label');
const dnsRecValueLabel = document.getElementById('dns-rec-value-label');
const dnsRecPriorityField = document.getElementById('dns-rec-priority-field');
const dnsRecPriorityLabel = document.getElementById('dns-rec-priority-label');
const dnsRecWeightField = document.getElementById('dns-rec-weight-field');
const dnsRecPortField = document.getElementById('dns-rec-port-field');
const dnsRecCaaTagField = document.getElementById('dns-rec-caatag-field');
const dnsRecRows = document.getElementById('dns-rec-rows');

function updateDnsFieldsVisibility() {
  const type = dnsRecType.value;
  dnsRecValueLabel.textContent = dnsValueLabels[type];
  dnsRecNameLabel.textContent = dnsNameLabels[type] || 'Nom';
  dnsRecPriorityField.style.display = (type === 'MX' || type === 'SRV' || type === 'CAA') ? 'flex' : 'none';
  dnsRecPriorityLabel.textContent = type === 'SRV' ? 'Priorité (SRV)' : type === 'CAA' ? 'Flag (CAA, 0 ou 128)' : 'Priorité (MX)';
  dnsRecWeightField.style.display = type === 'SRV' ? 'flex' : 'none';
  dnsRecPortField.style.display = type === 'SRV' ? 'flex' : 'none';
  dnsRecCaaTagField.style.display = type === 'CAA' ? 'flex' : 'none';
}
dnsRecType.addEventListener('change', updateDnsFieldsVisibility);
updateDnsFieldsVisibility();

function renderDnsRecRows() {
  if (dnsRecords.length === 0) {
    dnsRecRows.innerHTML = '<span class="empty-hint">Aucun enregistrement ajouté pour l\'instant</span>';
    saveState();
    return;
  }
  dnsRecRows.innerHTML = dnsRecords.map((r, idx) => {
    let extraPart = '';
    if (r.type === 'MX') extraPart = ` (priorité ${r.priority})`;
    if (r.type === 'SRV') extraPart = ` (priorité ${r.priority}, poids ${r.weight}, port ${r.port})`;
    if (r.type === 'CAA') extraPart = ` (flag ${r.priority}, tag ${r.caaTag})`;
    return `
      <div class="port-row">
        <span class="port-badge access">${r.type}</span>
        <span class="port-detail">${r.name} → ${r.value}${extraPart}</span>
        <button class="chip-remove" data-remove-dns-rec="${idx}" title="Retirer">&times;</button>
      </div>
    `;
  }).join('');
  saveState();
}

document.getElementById('dns-add-rec-btn').addEventListener('click', () => {
  const type = dnsRecType.value;
  const name = document.getElementById('dns-rec-name').value.trim();
  const value = document.getElementById('dns-rec-value').value.trim();
  const priority = document.getElementById('dns-rec-priority').value.trim() || (type === 'CAA' ? '0' : '10');
  const weight = document.getElementById('dns-rec-weight').value.trim() || '0';
  const port = document.getElementById('dns-rec-port').value.trim() || '0';
  const caaTag = document.getElementById('dns-rec-caatag').value;

  if (!name || !value) return;

  dnsRecords.push({
    type, name, value,
    priority: (type === 'MX' || type === 'SRV' || type === 'CAA') ? priority : null,
    weight: type === 'SRV' ? weight : null,
    port: type === 'SRV' ? port : null,
    caaTag: type === 'CAA' ? caaTag : null
  });
  document.getElementById('dns-rec-name').value = '';
  document.getElementById('dns-rec-value').value = '';
  document.getElementById('dns-rec-priority').value = '';
  document.getElementById('dns-rec-weight').value = '';
  document.getElementById('dns-rec-port').value = '';
  renderDnsRecRows();
});

document.addEventListener('click', (e) => {
  if (e.target.dataset.removeDnsRec !== undefined) {
    dnsRecords.splice(parseInt(e.target.dataset.removeDnsRec, 10), 1);
    renderDnsRecRows();
  }
});

function generateDnsZone(zoneName, primaryNs, adminEmail, records) {
  if (!zoneName) throw new Error("Indique un nom de zone (ex: sisr.local)");
  if (!primaryNs) throw new Error("Indique le serveur primaire (SOA)");
  if (!adminEmail) throw new Error("Indique l'admin de la zone (SOA)");
  if (records.length === 0) throw new Error("Ajoute au moins un enregistrement");

  const now = new Date();
  const serial = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}01`;

  const lines = [];
  lines.push(`; === Zone DNS pour ${zoneName} — générée par NetForge ===`);
  lines.push('$TTL 86400');
  lines.push(`@   IN  SOA   ${primaryNs}. ${adminEmail}. (`);
  lines.push(`        ${serial} ; serial (yyyymmddnn)`);
  lines.push('        3600       ; refresh');
  lines.push('        1800       ; retry');
  lines.push('        604800     ; expire');
  lines.push('        86400 )    ; minimum TTL');
  lines.push('');
  lines.push(`@   IN  NS    ${primaryNs}.`);
  lines.push('');

  records.forEach(r => {
    switch (r.type) {
      case 'A':
        lines.push(`${r.name}   IN  A       ${r.value}`);
        break;
      case 'CNAME':
        lines.push(`${r.name}   IN  CNAME   ${r.value}.`);
        break;
      case 'MX':
        lines.push(`${r.name}   IN  MX      ${r.priority} ${r.value}.`);
        break;
      case 'NS':
        lines.push(`${r.name}   IN  NS      ${r.value}.`);
        break;
      case 'PTR':
        lines.push(`${r.name}   IN  PTR     ${r.value}.`);
        break;
      case 'TXT':
        lines.push(`${r.name}   IN  TXT     "${r.value}"`);
        break;
      case 'SRV':
        lines.push(`${r.name}   IN  SRV     ${r.priority} ${r.weight} ${r.port} ${r.value}.`);
        break;
      case 'CAA':
        lines.push(`${r.name}   IN  CAA     ${r.priority} ${r.caaTag} "${r.value}"`);
        break;
    }
  });

  return lines.join('\n');
}

// ---- Génération automatique de la zone inverse (PTR) depuis les enregistrements A ----
function generateReverseZone(reverseNetInput, zoneName, primaryNs, adminEmail, records) {
  const match = reverseNetInput.trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
  if (!match) throw new Error("Indique un réseau valide, ex : 192.168.10.0/24");
  const cidr = parseInt(match[2], 10);
  if (cidr < 0 || cidr > 30) throw new Error("CIDR hors plage utile (0-30) pour une zone inverse");
  if (cidr % 8 !== 0) throw new Error("Pour une zone inverse simple, utilise un CIDR multiple de 8 (/8, /16, /24) — les découpages fins nécessitent la délégation classless (hors périmètre de ce générateur)");

  const netInt = ipToInt(match[1]) & maskFromCidr(cidr);
  const octets = [(netInt >>> 24) & 255, (netInt >>> 16) & 255, (netInt >>> 8) & 255, netInt & 255];
  const octetsToKeep = cidr / 8;
  const arpaOctets = octets.slice(0, octetsToKeep).reverse();
  const arpaZone = `${arpaOctets.join('.')}.in-addr.arpa`;

  const aRecords = records.filter(r => r.type === 'A');
  if (aRecords.length === 0) throw new Error("Aucun enregistrement A trouvé — ajoute-en dans la zone directe ci-dessus pour générer la zone inverse");

  const fqdnBase = zoneName ? `.${zoneName}` : '';
  const matching = aRecords.filter(r => {
    const ipInt = ipToInt(r.value.trim());
    if (ipInt === null) return false;
    return (ipInt & maskFromCidr(cidr)) === netInt;
  });
  if (matching.length === 0) throw new Error(`Aucun enregistrement A n'appartient au réseau ${reverseNetInput}`);

  const now = new Date();
  const serial = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}01`;

  const lines = [];
  lines.push(`; === Zone inverse (PTR) pour ${reverseNetInput} — générée par NetForge ===`);
  lines.push('$TTL 86400');
  lines.push(`@   IN  SOA   ${primaryNs || 'ns1.' + (zoneName || 'local')}. ${adminEmail || 'admin.' + (zoneName || 'local')}. (`);
  lines.push(`        ${serial} ; serial (yyyymmddnn)`);
  lines.push('        3600       ; refresh');
  lines.push('        1800       ; retry');
  lines.push('        604800     ; expire');
  lines.push('        86400 )    ; minimum TTL');
  lines.push('');
  lines.push(`@   IN  NS    ${primaryNs || 'ns1.' + (zoneName || 'local')}.`);
  lines.push('');

  matching.forEach(r => {
    const ipOctets = r.value.trim().split('.');
    const hostPart = ipOctets.slice(octetsToKeep).reverse().join('.');
    const fqdn = r.name === '@' ? (zoneName || r.name) : `${r.name}${fqdnBase}`;
    lines.push(`${hostPart}   IN  PTR     ${fqdn}.`);
  });

  return { zoneText: lines.join('\n'), arpaZone };
}

const dnsBtn = document.getElementById('dns-btn');
const dnsError = document.getElementById('dns-error');
const dnsOutputBox = document.getElementById('dns-output-box');
const dnsOutput = document.getElementById('dns-output');

dnsBtn.addEventListener('click', () => {
  dnsError.classList.add('hidden');
  dnsOutputBox.classList.add('hidden');
  try {
    const zoneName = document.getElementById('dns-zone-name').value.trim();
    const primaryNs = document.getElementById('dns-primary-ns').value.trim();
    const adminEmail = document.getElementById('dns-admin-email').value.trim();
    const config = generateDnsZone(zoneName, primaryNs, adminEmail, dnsRecords);
    dnsOutput.textContent = config;
    dnsOutputBox.classList.remove('hidden');
  } catch (e) {
    dnsError.textContent = e.message;
    dnsError.classList.remove('hidden');
  }
});

document.getElementById('dns-copy-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(dnsOutput.textContent);
});

document.getElementById('dns-export-btn').addEventListener('click', () => {
  const zoneName = document.getElementById('dns-zone-name').value.trim() || 'zone';
  const blob = new Blob([dnsOutput.textContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${zoneName}.zone`;
  a.click();
  URL.revokeObjectURL(url);
});

['dns-zone-name', 'dns-primary-ns', 'dns-admin-email'].forEach(id => {
  document.getElementById(id).addEventListener('change', saveState);
});

const dnsReverseBtn = document.getElementById('dns-reverse-btn');
const dnsReverseError = document.getElementById('dns-reverse-error');
const dnsReverseOutputBox = document.getElementById('dns-reverse-output-box');
const dnsReverseOutput = document.getElementById('dns-reverse-output');
let lastReverseArpaZone = 'zone-inverse';

dnsReverseBtn.addEventListener('click', () => {
  dnsReverseError.classList.add('hidden');
  dnsReverseOutputBox.classList.add('hidden');
  try {
    const reverseNet = document.getElementById('dns-reverse-net').value;
    const zoneName = document.getElementById('dns-zone-name').value.trim();
    const primaryNs = document.getElementById('dns-primary-ns').value.trim();
    const adminEmail = document.getElementById('dns-admin-email').value.trim();
    const { zoneText, arpaZone } = generateReverseZone(reverseNet, zoneName, primaryNs, adminEmail, dnsRecords);
    dnsReverseOutput.textContent = zoneText;
    lastReverseArpaZone = arpaZone;
    dnsReverseOutputBox.classList.remove('hidden');
  } catch (e) {
    dnsReverseError.textContent = e.message;
    dnsReverseError.classList.remove('hidden');
  }
});

document.getElementById('dns-reverse-copy-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(dnsReverseOutput.textContent);
});

document.getElementById('dns-reverse-export-btn').addEventListener('click', () => {
  const blob = new Blob([dnsReverseOutput.textContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${lastReverseArpaZone}.zone`;
  a.click();
  URL.revokeObjectURL(url);
});

renderDnsRecRows();

// ==================================================================
// Export / Import du projet complet (JSON)
// ==================================================================
document.getElementById('export-project-btn').addEventListener('click', () => {
  saveState();
  const active = getActiveProject();
  const raw = JSON.stringify((active && active.state) || {});
  const blob = new Blob([raw], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const slug = (active ? active.name : 'projet').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'projet';
  const a = document.createElement('a');
  a.href = url;
  a.download = `netforge-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('import-project-btn').addEventListener('click', () => {
  document.getElementById('import-project-input').click();
});

document.getElementById('import-project-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result); // valide que c'est bien du JSON avant d'écraser
      if (!confirm("Ça va remplacer toutes les données du projet actif (VLANs, équipements, règles, DNS...) par celles du fichier importé. Continuer ?")) return;
      const active = getActiveProject();
      active.state = parsed;
      active.updatedAt = Date.now();
      saveProjectsData(projectsData);
      location.reload();
    } catch (err) {
      alert("Fichier invalide : ce n'est pas un export NetForge valide.");
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ==================================================================
// Rapport imprimable (PDF via le navigateur)
// ==================================================================
function buildReportHtml() {
  const now = new Date().toLocaleString('fr-FR');

  let html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Rapport NetForge</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; max-width: 900px; margin: 40px auto; padding: 0 20px; line-height: 1.5; }
    h1 { border-bottom: 3px solid #2E9FFF; padding-bottom: 10px; }
    h2 { color: #2E9FFF; margin-top: 36px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
    h3 { margin-top: 20px; margin-bottom: 6px; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0 20px; font-size: 0.9rem; }
    th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
    th { background: #f0f4f8; }
    pre { background: #0A0D12; color: #4CF3FF; padding: 14px 16px; border-radius: 8px; overflow-x: auto; font-size: 0.82rem; }
    .meta { color: #666; font-size: 0.85rem; }
    @media print { pre { white-space: pre-wrap; } }
  </style></head><body>`;

  html += `<h1>Rapport de projet réseau — NetForge</h1>`;
  html += `<p class="meta">Généré le ${now}</p>`;

  html += `<h2>VLANs déclarés</h2>`;
  if (topoVlanState.length === 0) {
    html += `<p><em>Aucun VLAN déclaré.</em></p>`;
  } else {
    html += `<table><tr><th>ID</th><th>Nom</th><th>SVI</th></tr>`;
    topoVlanState.forEach(v => {
      html += `<tr><td>${v.id}</td><td>${v.name}</td><td>${v.svi || '—'}</td></tr>`;
    });
    html += `</table>`;
  }

  html += `<h2>Équipements (${devices.length})</h2>`;
  if (devices.length === 0) {
    html += `<p><em>Aucun équipement déclaré.</em></p>`;
  } else {
    devices.forEach(d => {
      html += `<h3>${d.name} — ${deviceTypeLabels[d.type]}</h3>`;
      try {
        const config = generateDeviceConfig(d);
        html += `<pre>${config.replace(/</g, '&lt;')}</pre>`;
      } catch (e) {
        html += `<p><em>Configuration incomplète pour cet équipement.</em></p>`;
      }
    });
  }

  html += `<h2>Liens de la topologie</h2>`;
  if (links.length === 0) {
    html += `<p><em>Aucun lien déclaré.</em></p>`;
  } else {
    html += `<table><tr><th>Équipement A</th><th>Équipement B</th><th>Label</th></tr>`;
    links.forEach(l => {
      const da = devices.find(d => d.id === l.a);
      const db = devices.find(d => d.id === l.b);
      if (!da || !db) return;
      html += `<tr><td>${da.name}</td><td>${db.name}</td><td>${l.label || '—'}</td></tr>`;
    });
    html += `</table>`;
  }

  html += `<h2>Règles Firewall (${fwRules.length})</h2>`;
  if (fwRules.length === 0) {
    html += `<p><em>Aucune règle déclarée.</em></p>`;
  } else {
    html += `<table><tr><th>#</th><th>Action</th><th>Protocole</th><th>Port</th><th>Source</th><th>Destination</th><th>Log</th><th>Plage horaire</th><th>Rate-limit</th></tr>`;
    fwRules.forEach((r, idx) => {
      html += `<tr><td>${idx + 1}</td><td>${r.action}</td><td>${r.proto.toUpperCase()}</td><td>${r.port || '—'}</td><td>${r.source}</td><td>${r.dest}</td><td>${r.log ? 'Oui' : '—'}</td><td>${r.timeRange || '—'}</td><td>${r.rateLimit || '—'}</td></tr>`;
    });
    html += `</table>`;
  }

  const zoneName = document.getElementById('dns-zone-name').value.trim();
  html += `<h2>Zone DNS</h2>`;
  if (!zoneName || dnsRecords.length === 0) {
    html += `<p><em>Aucune zone DNS configurée.</em></p>`;
  } else {
    try {
      const primaryNs = document.getElementById('dns-primary-ns').value.trim();
      const adminEmail = document.getElementById('dns-admin-email').value.trim();
      const zoneConfig = generateDnsZone(zoneName, primaryNs, adminEmail, dnsRecords);
      html += `<pre>${zoneConfig.replace(/</g, '&lt;')}</pre>`;
    } catch (e) {
      html += `<p><em>Zone DNS incomplète.</em></p>`;
    }
  }

  html += `</body></html>`;
  return html;
}

document.getElementById('generate-report-btn').addEventListener('click', () => {
  const reportHtml = buildReportHtml();
  const reportWindow = window.open('', '_blank');
  if (!reportWindow) {
    alert("Le navigateur a bloqué l'ouverture de la fenêtre. Autorise les pop-ups pour ce site puis réessaie.");
    return;
  }
  reportWindow.document.write(reportHtml);
  reportWindow.document.close();
  reportWindow.focus();
  setTimeout(() => reportWindow.print(), 400);
});

// ---- Enregistrement du service worker (PWA) ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('Service worker non enregistré :', err);
    });
  });
}
