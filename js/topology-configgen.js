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
  const rawSaved = (typeof __nfInitialSavedState !== 'undefined') ? __nfInitialSavedState : loadState();
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

