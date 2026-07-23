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

