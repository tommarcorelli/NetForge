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

