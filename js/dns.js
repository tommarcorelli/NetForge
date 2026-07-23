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

