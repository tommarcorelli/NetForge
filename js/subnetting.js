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

