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

