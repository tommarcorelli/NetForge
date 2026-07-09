// ---- Navigation entre modules ----
// ==================================================================
// Persistance locale (localStorage) — sauvegarde automatique
// ==================================================================
const STORAGE_KEY = 'netforge-state-v1';

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
      deviceNat: typeof deviceNat !== 'undefined' ? deviceNat : {},
      deviceEtherchannels: typeof deviceEtherchannels !== 'undefined' ? deviceEtherchannels : {},
      links: typeof links !== 'undefined' ? links : [],
      deviceIdSeq: typeof deviceIdSeq !== 'undefined' ? deviceIdSeq : 1,
      fwRules: typeof fwRules !== 'undefined' ? fwRules : [],
      fwPolicy: (typeof document !== 'undefined' && document.getElementById('fw-policy')) ? document.getElementById('fw-policy').value : 'DROP',
      dnsRecords: typeof dnsRecords !== 'undefined' ? dnsRecords : [],
      dnsZoneName: (typeof document !== 'undefined' && document.getElementById('dns-zone-name')) ? document.getElementById('dns-zone-name').value : '',
      dnsPrimaryNs: (typeof document !== 'undefined' && document.getElementById('dns-primary-ns')) ? document.getElementById('dns-primary-ns').value : '',
      dnsAdminEmail: (typeof document !== 'undefined' && document.getElementById('dns-admin-email')) ? document.getElementById('dns-admin-email').value : ''
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('NetForge : sauvegarde locale impossible', e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('NetForge : lecture de la sauvegarde locale impossible', e);
    return null;
  }
}

function clearSavedState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
}


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
const advancedRow = document.getElementById('advanced-row');
const advVoiceField = document.getElementById('adv-voice-field');
const advNativeField = document.getElementById('adv-native-field');
const advSecurityField = document.getElementById('adv-security-field');

document.getElementById('advanced-toggle').addEventListener('click', (e) => {
  advancedRow.classList.toggle('hidden');
  e.target.textContent = advancedRow.classList.contains('hidden')
    ? '+ Options avancées (description, VLAN voix, natif, port-security)'
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

  const ports = expandPortRange(newPortType.value + num).filter(p => !portState.some(existing => existing.port === p));

  ports.forEach(port => {
    portState.push({
      port, mode,
      vlanId: mode === 'access' ? newPortVlan.value : null,
      voiceVlanId, nativeVlanId, description, security
    });
  });

  newPortName.value = '';
  newPortDesc.value = '';
  newPortSecurity.checked = false;
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
const deviceNat = {};           // deviceId -> {patEnabled, outsideIface, staticMappings}
const deviceEtherchannels = {};  // deviceId -> [{groupId, members, mode, portMode, vlanId}]

const deviceList = document.getElementById('device-list');
const deviceConfigPanel = document.getElementById('device-config-panel');

const deviceTypeIcons = { switch: 'SW', router: 'R', pc: 'PC', server: 'SRV' };
const deviceTypeLabels = { switch: 'switch', router: 'routeur', pc: 'PC', server: 'serveur' };

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
  const colors = { switch: '#4CF3FF', router: '#C25CFF', pc: '#FFB454', server: '#5CFFA0' };

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
  deviceNat[id] = { patEnabled: false, outsideIface: '', staticMappings: [] };
  deviceEtherchannels[id] = [];

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
    delete deviceNat[id];
    delete deviceEtherchannels[id];
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
        <div class="hint" id="dev-ospf-hint"></div>

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
          <button class="btn-add" id="dev-nat-add-static-btn">+ Ajouter</button>
        </div>
        <div class="port-rows" id="dev-nat-static-rows"></div>
      </div>
    `;

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
      renderDevIfRows();
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

    const ospf = deviceOspf[selectedDeviceId] || { enabled: false, pid: '1', area: '0' };
    document.getElementById('dev-ospf-enabled').value = ospf.enabled ? 'yes' : 'no';
    document.getElementById('dev-ospf-pid').value = ospf.pid;
    document.getElementById('dev-ospf-area').value = ospf.area;
    document.getElementById('dev-ospf-hint').textContent = ospf.enabled
      ? `OSPF actif — les réseaux de toutes les interfaces IP configurées seront annoncés en zone ${ospf.area}`
      : '';

    document.getElementById('dev-ospf-save-btn').addEventListener('click', () => {
      deviceOspf[selectedDeviceId] = {
        enabled: document.getElementById('dev-ospf-enabled').value === 'yes',
        pid: document.getElementById('dev-ospf-pid').value.trim() || '1',
        area: document.getElementById('dev-ospf-area').value.trim() || '0'
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
      box.innerHTML = mappings.map((m, idx) => `
        <div class="port-row">
          <span class="port-name">${m.localIp}</span>
          <span class="port-detail">→ ${m.globalIp}</span>
          <button class="chip-remove" data-remove-nat-static="${idx}" title="Retirer">&times;</button>
        </div>
      `).join('');
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

function generateSwitchDeviceConfig(device) {
  const lines = [];
  lines.push(`! === ${device.name} (switch) — généré par NetForge ===`);
  lines.push('!');
  if (topoVlanState.length > 0) {
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
        lines.push(`ip nat inside source static ${m.localIp} ${m.globalIp}`);
      });
      lines.push('!');
    }
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
      lines.push('!');
    }
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

function generateDeviceConfig(device) {
  if (device.type === 'switch') return generateSwitchDeviceConfig(device);
  if (device.type === 'router') return generateRouterDeviceConfig(device);
  return generateHostDeviceConfig(device);
}
const topologyError = document.getElementById('topology-error');
const topologyResults = document.getElementById('topology-results');
let lastTopologyOutputs = [];

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

const savedState = loadState();
if (savedState) {
  if (savedState.vlanState) vlanState = savedState.vlanState;
  if (savedState.portState) portState = savedState.portState;
  if (savedState.topoVlanState) topoVlanState = savedState.topoVlanState;
  if (savedState.devices) devices = savedState.devices;
  if (savedState.devicePorts) Object.assign(devicePorts, savedState.devicePorts);
  if (savedState.deviceInterfaces) Object.assign(deviceInterfaces, savedState.deviceInterfaces);
  if (savedState.deviceRoutes) Object.assign(deviceRoutes, savedState.deviceRoutes);
  if (savedState.deviceOspf) Object.assign(deviceOspf, savedState.deviceOspf);
  if (savedState.deviceNat) Object.assign(deviceNat, savedState.deviceNat);
  if (savedState.deviceEtherchannels) Object.assign(deviceEtherchannels, savedState.deviceEtherchannels);
  if (savedState.links) links = savedState.links;
  if (savedState.deviceIdSeq) deviceIdSeq = savedState.deviceIdSeq;
}
if (savedState && savedState.fwRules) fwRules = savedState.fwRules;
if (savedState && savedState.fwPolicy) {
  const fwPolicySelect = document.getElementById('fw-policy');
  if (fwPolicySelect) fwPolicySelect.value = savedState.fwPolicy;
}
if (savedState && savedState.dnsRecords) dnsRecords = savedState.dnsRecords;
if (savedState) {
  const zoneEl = document.getElementById('dns-zone-name');
  const nsEl = document.getElementById('dns-primary-ns');
  const emailEl = document.getElementById('dns-admin-email');
  if (zoneEl && savedState.dnsZoneName) zoneEl.value = savedState.dnsZoneName;
  if (nsEl && savedState.dnsPrimaryNs) nsEl.value = savedState.dnsPrimaryNs;
  if (emailEl && savedState.dnsAdminEmail) emailEl.value = savedState.dnsAdminEmail;
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

function updateFwPortFieldVisibility() {
  const proto = fwRuleProto.value;
  fwRulePortField.style.display = (proto === 'icmp' || proto === 'any') ? 'none' : 'flex';
}
fwRuleProto.addEventListener('change', updateFwPortFieldVisibility);
updateFwPortFieldVisibility();

document.querySelectorAll('[data-fill-port]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('fw-rule-port').value = btn.dataset.fillPort;
  });
});

function renderFwRuleRows() {
  if (fwRules.length === 0) {
    fwRuleRows.innerHTML = '<span class="empty-hint">Aucune règle ajoutée pour l\'instant</span>';
    saveState();
    return;
  }
  fwRuleRows.innerHTML = fwRules.map((r, idx) => {
    const portPart = r.port ? ` port ${r.port}` : '';
    const logPart = r.log ? ` <span class="port-detail-extra">[log]</span>` : '';
    return `
      <div class="port-row">
        <span class="port-badge ${r.action === 'ACCEPT' ? 'access' : 'trunk'}">${r.action}</span>
        <span class="port-detail">${r.proto.toUpperCase()}${portPart} — ${r.source} → ${r.dest}${logPart}</span>
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
  const proto = fwRuleProto.value;
  const port = (proto === 'icmp' || proto === 'any') ? '' : document.getElementById('fw-rule-port').value.trim();
  const source = document.getElementById('fw-rule-source').value.trim() || 'any';
  const dest = document.getElementById('fw-rule-dest').value.trim() || 'any';
  const log = document.getElementById('fw-rule-log').checked;

  fwRules.push({ action, proto, port, source, dest, log });
  document.getElementById('fw-rule-port').value = '';
  document.getElementById('fw-rule-source').value = 'any';
  document.getElementById('fw-rule-dest').value = 'any';
  document.getElementById('fw-rule-log').checked = false;
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
    let base = `-p ${r.proto}`;
    if (r.port) base += ` --dport ${r.port}`;
    if (r.source && r.source.toLowerCase() !== 'any') base += ` -s ${r.source}`;
    if (r.dest && r.dest.toLowerCase() !== 'any') base += ` -d ${r.dest}`;

    lines.push(`# Règle ${idx + 1}`);
    if (r.log) {
      lines.push(`iptables -A INPUT ${base} -j LOG --log-prefix "NETFORGE-R${idx + 1}: "`);
    }
    lines.push(`iptables -A INPUT ${base} -j ${r.action}`);
  });

  lines.push('');
  lines.push('echo "Règles iptables appliquées."');
  return lines.join('\n');
}

// ---- Génération ACL Cisco ----
function ciscoAddrFormat(value) {
  if (!value || value.toLowerCase() === 'any') return 'any';
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

function generateCiscoAclConfig(policy, rules) {
  if (rules.length === 0) throw new Error("Ajoute au moins une règle avant de générer");

  const lines = [];
  lines.push('! === ACL Cisco générée par NetForge ===');
  lines.push('ip access-list extended NETFORGE_ACL');

  rules.forEach((r, idx) => {
    const action = r.action === 'ACCEPT' ? 'permit' : 'deny';
    const proto = r.proto === 'any' ? 'ip' : r.proto;
    const src = ciscoAddrFormat(r.source);
    const dst = ciscoAddrFormat(r.dest);
    const ports = r.port ? r.port.split(',').map(p => p.trim()) : [null];

    ports.forEach(port => {
      let line = ` ${action} ${proto} ${src} ${dst}`;
      if (port) line += ` eq ${port}`;
      if (r.log) line += ' log';
      lines.push(line);
    });
  });

  const finalAction = (policy === 'ACCEPT') ? 'permit' : 'deny';
  lines.push(` ${finalAction} ip any any`);
  lines.push('!');
  lines.push('! Exemple d\'application sur une interface :');
  lines.push('! interface GigabitEthernet0/0');
  lines.push('!  ip access-group NETFORGE_ACL in');
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
    const config = format === 'cisco'
      ? generateCiscoAclConfig(policy, fwRules)
      : generateIptablesConfig(policy, fwRules);
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

document.getElementById('fw-policy').addEventListener('change', saveState);
document.getElementById('fw-format').addEventListener('change', saveState);

// ---- Testeur de règles ----
function ipInCidrOrHost(testIp, ruleValue) {
  if (!ruleValue || ruleValue.toLowerCase() === 'any') return true;
  const testInt = ipToInt(testIp);
  if (testInt === null) return false;
  if (ruleValue.includes('/')) {
    const [netIp, cidrStr] = ruleValue.split('/');
    const maskInt = maskFromCidr(parseInt(cidrStr, 10));
    return (testInt & maskInt) === (ipToInt(netIp) & maskInt);
  }
  return testInt === ipToInt(ruleValue);
}

function portMatches(testPort, rulePort) {
  if (!rulePort) return true;
  const list = rulePort.split(',').map(p => p.trim());
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
    if (proto !== 'icmp' && !portMatches(port, r.port)) continue;
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
  TXT: 'Texte'
};

const dnsRecType = document.getElementById('dns-rec-type');
const dnsRecValueLabel = document.getElementById('dns-rec-value-label');
const dnsRecPriorityField = document.getElementById('dns-rec-priority-field');
const dnsRecRows = document.getElementById('dns-rec-rows');

function updateDnsFieldsVisibility() {
  const type = dnsRecType.value;
  dnsRecValueLabel.textContent = dnsValueLabels[type];
  dnsRecPriorityField.style.display = type === 'MX' ? 'flex' : 'none';
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
    const priorityPart = r.type === 'MX' ? ` (priorité ${r.priority})` : '';
    return `
      <div class="port-row">
        <span class="port-badge access">${r.type}</span>
        <span class="port-detail">${r.name} → ${r.value}${priorityPart}</span>
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
  const priority = document.getElementById('dns-rec-priority').value.trim() || '10';

  if (!name || !value) return;

  dnsRecords.push({ type, name, value, priority: type === 'MX' ? priority : null });
  document.getElementById('dns-rec-name').value = '';
  document.getElementById('dns-rec-value').value = '';
  document.getElementById('dns-rec-priority').value = '';
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
    }
  });

  return lines.join('\n');
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

renderDnsRecRows();

// ==================================================================
// Export / Import du projet complet (JSON)
// ==================================================================
document.getElementById('export-project-btn').addEventListener('click', () => {
  saveState();
  const raw = localStorage.getItem(STORAGE_KEY) || '{}';
  const blob = new Blob([raw], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `netforge-projet-${new Date().toISOString().slice(0, 10)}.json`;
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
      JSON.parse(reader.result); // valide que c'est bien du JSON avant d'écraser
      if (!confirm("Ça va remplacer toutes les données actuelles (VLANs, équipements, règles, DNS...) par celles du fichier importé. Continuer ?")) return;
      localStorage.setItem(STORAGE_KEY, reader.result);
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
    html += `<table><tr><th>#</th><th>Action</th><th>Protocole</th><th>Port</th><th>Source</th><th>Destination</th></tr>`;
    fwRules.forEach((r, idx) => {
      html += `<tr><td>${idx + 1}</td><td>${r.action}</td><td>${r.proto.toUpperCase()}</td><td>${r.port || '—'}</td><td>${r.source}</td><td>${r.dest}</td></tr>`;
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
