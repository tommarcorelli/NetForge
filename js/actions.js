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
