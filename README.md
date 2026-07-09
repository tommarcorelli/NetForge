# NetForge

Générateur de configurations réseau/infra pour SISR — 100% vanilla HTML/CSS/JS, installable en PWA, usage local avant push GitHub.

## Objectif

Fournir en un seul outil plusieurs générateurs de fichiers de config réseau, chacun prêt à l'emploi sans retouche manuelle après génération.

## Modules

| Module | Statut | Description |
|---|---|---|
| Subnetting / VLSM | ✅ V1 disponible | Calcul de plan d'adressage + découpage VLSM multi-sous-réseaux + binaire + type d'adresse + référence CIDR |
| VLAN | ✅ V1 disponible | Génération de config switch Cisco IOS (VLANs, ports accès, ports trunk, SVI, voice VLAN, port-security) |
| Firewall / ACL | ✅ V1 disponible | Génération iptables ou ACL Cisco, réorganisation, presets, testeur de règles |
| **Topologie** | ✅ V1 disponible | Multi-équipements (switchs + routeurs + PC/serveurs), router-on-a-stick, DHCP, OSPF, sauvegarde auto, export ZIP |
| **DNS** | ✅ V1 disponible | Génération de zone BIND (A, CNAME, MX, NS, PTR, TXT) |

## Structure du projet

```
netforge/
├── index.html          # Shell principal + navigation entre modules
├── manifest.json        # Manifest PWA
├── sw.js                 # Service worker (mode hors-ligne)
├── css/
│   └── style.css         # Design system (couleurs, typo, composants)
├── js/
│   └── app.js             # Navigation + logique du module Subnetting
├── assets/
│   └── logo.svg            # Logo néon (glyphe hexagonal réseau + étincelle)
└── README.md
```

## Design

- Fond sombre (#0A0D12), accents néon cyan (#4CF3FF) et magenta (#C25CFF)
- Typographies : Space Grotesk (titres) / JetBrains Mono (data, labels) / Inter (corps de texte)
- Logo : glyphe hexagonal représentant une topologie réseau, avec une étincelle centrale (clin d'œil au nom "Forge"), effet de glow SVG, pas de bordure carrée

## Utilisation en local

Ouvrir `index.html` dans un navigateur. Pour activer pleinement le mode PWA (service worker), servir le dossier via un serveur local plutôt qu'en `file://` :

```
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.

## Historique des livraisons

### 2026-07-06 — Guide intégré + préparation GitHub
- **Nouvel onglet "Guide"** dans l'app : explique ce que fait chaque module et son lien avec le programme BTS SISR — utile en révision ou pour présenter le projet en jury
- **Dépôt Git initialisé en local** (branche `main`, premier commit fait) avec `.gitignore` (fichiers système/éditeurs) et `LICENSE` (MIT)
- Pour pousser sur GitHub : créer un dépôt vide sur github.com, puis `git remote add origin <url>` et `git push -u origin main`

### 2026-07-06 — QA complète sur tous les modules
- **Bug corrigé** : validation d'IP par `if (!ipToInt(x))` dans les routes statiques et le NAT statique rejetait à tort l'adresse `0.0.0.0` (piège JS classique : `0` est falsy) — remplacé par une comparaison explicite à `null`
- Vérification systématique : syntaxe JS et balises HTML équilibrées, aucun ID dupliqué ni référence DOM cassée, cas limites VLSM (1 hôte, 0 hôte, texte invalide, base trop petite), générateurs de config robustes sur équipement vide, aucune contamination entre les VLANs des modules VLAN et Topologie, cohérence du service worker avec les fichiers réels
- Aucun autre bug fonctionnel détecté à ce stade

### 2026-07-06 — Export/Import du projet + Rapport imprimable
- **Export (.json)** en bas de la sidebar : télécharge l'intégralité de l'état (VLANs, équipements, règles firewall, DNS) — permet de sauvegarder ailleurs ou transférer sur un autre PC, en complément de la sauvegarde automatique locale
- **Import** : recharge un export précédent (avec confirmation avant d'écraser les données actuelles)
- **Rapport imprimable** : ouvre un document propre (VLANs, config de chaque équipement, liens, règles firewall, zone DNS) et lance directement l'impression du navigateur — "Enregistrer en PDF" dans la boîte de dialogue d'impression donne un PDF prêt pour un rendu de TP

### 2026-07-06 — EtherChannel + HSRP/VRRP
- **EtherChannel** sur les switchs : groupe de ports membres agrégés (LACP actif/passif, PAgP desirable/auto, ou statique "on"), génère `channel-group` sur chaque port + l'interface `Port-channel` en trunk ou accès
- **HSRP/VRRP** sur les interfaces routeur (physiques ou sous-interfaces) : IP virtuelle, groupe, priorité, preempt — accessible dans les options avancées d'ajout d'interface

### 2026-07-06 — NAT/PAT sur les routeurs de Topologie
- **PAT (surcharge dynamique)** : choix de l'interface WAN, toutes les autres interfaces IP configurées du routeur deviennent automatiquement "inside" — génère l'ACL des réseaux internes, la commande `ip nat inside source list ... overload`, et le marquage `ip nat inside`/`ip nat outside` sur chaque interface concernée
- **NAT statique** : mappings IP locale ↔ IP publique ajoutables un par un, retirables individuellement
- Persistant comme le reste de la Topologie (sauvegarde automatique)

### 2026-07-06 — Nouveau module DNS (zone BIND)
- **Génération de fichier de zone BIND** complet : SOA (numéro de série auto-généré à la date du jour, refresh/retry/expire/minimum), NS
- **6 types d'enregistrements** : A, CNAME, MX (avec priorité), NS, PTR, TXT — via constructeur visuel (pas de syntaxe à taper)
- Libellé du champ "valeur" adapté dynamiquement selon le type choisi
- Export en fichier `.zone` prêt à l'emploi, copie en un clic
- Champs de zone (nom, serveur primaire, admin) et enregistrements sauvegardés automatiquement
- Bug corrigé au passage : une `</div>` surnuméraire traînait dans le module Firewall depuis une édition précédente, cassant potentiellement la mise en page

### 2026-07-06 — Firewall poussé à fond : ACL Cisco, réorganisation, presets, testeur
- **Export ACL Cisco** en plus d'iptables (menu déroulant "Format de sortie") : `permit`/`deny`, conversion CIDR → wildcard mask automatique, `host X` pour une IP unique, commentaire d'exemple d'application sur une interface
- **Réorganisation des règles** : boutons monter/descendre sur chaque règle (l'ordre change le comportement, aussi bien en iptables qu'en ACL Cisco)
- **Option Log** par règle : génère une ligne `LOG` avant l'action en iptables, ou le mot-clé `log` en ACL Cisco
- **Presets rapides** : "Serveur Web" (22/80/443) et "Admin SSH uniquement" (demande le réseau admin, bloque le reste en SSH)
- **Testeur de règles** : simule un paquet (protocole/port/source/destination) et indique quelle règle matcherait en premier dans l'ordre de la liste, ou la politique par défaut si aucune ne matche — pratique pour réviser la logique des ACL

### 2026-07-06 — Constructeur visuel pour le Firewall
- Remplacement du textarea à syntaxe manuelle par un **vrai constructeur de règles** : action, protocole, port, source, destination via champs dédiés (plus de risque d'erreur de format)
- **Raccourcis de ports courants** en un clic : SSH (22), HTTP/S (80,443), DNS (53), RDP (3389), MySQL (3306)
- Le champ port se masque automatiquement pour ICMP et "Tous les protocoles" (non pertinent)
- Liste de règles ajoutées affichée et modifiable (retrait individuel), comme dans VLAN/Topologie
- Politique par défaut passée en menu déroulant plutôt qu'en texte libre
- Règles et politique **sauvegardées automatiquement** (même mécanisme de persistance que Topologie)

### 2026-07-06 — Power up : sauvegarde automatique, scénario en un clic, stats
- **Sauvegarde automatique locale** (localStorage) : tout le travail de l'onglet Topologie (VLANs, équipements, ports, interfaces, routes, OSPF, liens) est sauvegardé en direct et restauré automatiquement à la réouverture de la page — plus aucune perte de travail au rechargement
- **"⚡ Charger un exemple"** : un scénario complet pré-rempli en un clic (1 routeur router-on-a-stick, 1 switch avec ports accès/trunk, 2 PC, 3 VLANs, DHCP, liens) — base de départ à ajuster plutôt que tout taper à la main
- **"↺ Réinitialiser"** : efface proprement toute la topologie (avec confirmation)
- **Barre de stats en direct** en haut de Topologie (nb VLANs, switchs, routeurs, postes/serveurs, liens)

### 2026-07-06 — Découplage complet VLAN ↔ Topologie
- L'onglet **VLAN** est remis dans la navigation, tel qu'il était avant (aucune régression)
- Les deux onglets ont maintenant chacun **leur propre liste de VLANs, totalement indépendante** : ajouter/retirer un VLAN dans l'un n'affecte plus jamais l'autre
- Fini le partage d'état qui créait de la confusion — chaque onglet fonctionne isolément, comme deux outils distincts
- Cache du service worker mis à jour (v5) pour que les changements soient bien pris en compte au rechargement

### 2026-07-06 — Suppression de l'onglet VLAN séparé
- L'onglet "VLAN" indépendant est retiré de la navigation : **Topologie est maintenant l'unique endroit** pour déclarer les VLANs et configurer les équipements (switchs, routeurs, PC, serveurs)
- Élimine la confusion entre deux workflows qui faisaient à peu près la même chose à deux endroits différents
- Le code du module VLAN reste présent en arrière-plan (juste inaccessible depuis la navigation) pour ne rien casser côté fonctionnement interne

### 2026-07-06 — VLANs directement dans Topologie + DHCP + OSPF
- **Fini l'aller-retour entre onglets** : les VLANs peuvent maintenant être déclarés directement dans l'onglet Topologie (section "0. VLANs"), synchronisé en temps réel avec l'onglet VLAN — même base partagée, ajout/suppression reflétés des deux côtés instantanément
- **DHCP** : case à cocher par interface routeur (LAN) pour générer un pool DHCP complet (exclusion de la passerelle, network, default-router, dns-server)
- **OSPF zone unique** : activable par routeur (process ID + zone), génère automatiquement les instructions `network` avec wildcard mask pour toutes les interfaces IP configurées
- Suppression d'un VLAN désormais nettoyée partout à la fois : ports de switch (VLAN + Topologie), sous-interfaces routeur concernées, quel que soit l'endroit où la suppression est faite
- Label de lien enrichi pour suggérer d'y préciser les ports (ex: "Gi0/1 ↔ Fa0/1")

### 2026-07-06 — Types d'interface réalistes (Fa/Gi/Te/Serial/Loopback)
- Remplacement des champs de port/interface en texte libre par un vrai **sélecteur de type** : FastEthernet, GigabitEthernet, TenGigabitEthernet (switchs et routeurs), + Serial et Loopback (routeurs)
- **Interfaces Serial** (liaisons WAN point-à-point) : champs dédiés encapsulation (HDLC/PPP/Frame-Relay), clock rate (si l'interface est côté DCE) et bande passante — reflétés dans la config générée
- **Loopback** : IP simple sans masque de sous-réseau spécifique, utile pour les router-id OSPF/BGP en TP
- Le nom complet de l'interface (ex: `Se0/0/0`, `Gi0/0.10`) est maintenant composé automatiquement à partir du type + numéro, sur les 3 formulaires concernés (VLAN, Topologie switch, Topologie routeur)

### 2026-07-06 — Réalisme de la topologie : PC, serveurs, liens, schéma visuel
- **Nouveaux types d'équipements** : PC/Poste et Serveur, en plus de Switch et Routeur
- **Config PC/Serveur** générée au format `/etc/network/interfaces` (Debian/Ubuntu) : statique (IP, masque, passerelle, DNS) ou DHCP, avec rattachement informatif à un VLAN
- **Liens entre équipements** : relie deux équipements avec un label optionnel (ex: "trunk", "câble droit") pour matérialiser le câblage
- **Schéma de topologie généré automatiquement** (SVG) : les équipements sont disposés en cercle, les liens tracés entre eux, icônes et couleurs différenciées par type — mis à jour en temps réel à chaque ajout/suppression
- Nettoyage automatique des liens quand un équipement lié est supprimé
- Bug corrigé pendant le développement : une ligne d'initialisation du listener "+ Ajouter" avait été effacée par erreur lors d'une édition, cassant la syntaxe du fichier — repérée et corrigée avant livraison

### 2026-07-06 — Module Topologie multi-équipements (nouveauté majeure)
- **Nouveau module "Topologie"** : déclare plusieurs équipements (switchs et routeurs), les configure individuellement, génère la config complète de chacun en une fois
- **Switchs** : réutilisent directement les VLANs déclarés dans l'onglet VLAN (base VLAN partagée entre équipements, comme une base VTP) — assignation de ports par équipement
- **Routeurs** : interfaces physiques ou sous-interfaces 802.1Q (router-on-a-stick, avec `encapsulation dot1Q`), routes statiques (y compris route par défaut `0.0.0.0/0`), `ip routing` activé automatiquement
- **Génération groupée** : un bloc de config par équipement, copiable et exportable individuellement
- **Export ZIP complet** de toute la topologie en un clic (une config par équipement), via JSZip chargé en CDN — fallback propre si hors-ligne
- Bug corrigé en cours de route : les listeners de suppression de lignes (ports/interfaces/routes) s'accumulaient à chaque changement d'équipement sélectionné, remplacés par un seul listener délégué au niveau document

### 2026-07-06 — Formulaire VLAN labellisé + suggestion d'ID
- Placeholders tronqués corrigés : chaque champ a maintenant un vrai label court au-dessus au lieu d'un texte d'exemple trop long dans le champ
- **Suggestion automatique du prochain ID VLAN disponible** (multiples de 10) au clic dans le champ ID

### 2026-07-06 — Correctif : panneau "Options avancées" visible par erreur
- Bug corrigé : le panneau d'options avancées des ports s'affichait par défaut au lieu de rester replié, à cause d'un conflit de priorité CSS entre `.hidden` et le style du panneau (`.advanced-row` déclaré plus loin dans la feuille de style l'emportait)
- `.hidden` est maintenant toujours prioritaire (`!important`), pour éviter ce type de conflit à l'avenir

### 2026-07-06 — Module VLAN complet (options avancées)
- **IP SVI optionnelle** par VLAN → génère `interface vlan X` + `ip address` (routage inter-VLAN sur switch L3)
- **Options avancées des ports** (repliables) : description, VLAN voix (téléphonie IP), VLAN natif du trunk, port-security (1 MAC + violation restrict + sticky)
- Ajout systématique de `switchport trunk encapsulation dot1q` sur les ports trunk

### 2026-07-06 — Amélioration saisie des ports VLAN
- Champ port élargi (le placeholder était tronqué)
- **Saisie par plage** : `fa0/1-4` ajoute d'un coup fa0/1, fa0/2, fa0/3 et fa0/4 (jusqu'à 48 ports)
- Anti-doublon automatique lors de l'ajout

### 2026-07-06 — Constructeur visuel pour le module VLAN
- Remplacement des 3 champs texte à syntaxe manuelle (`id:nom`, `port:vlan_id`...) par un **constructeur visuel** : ajout des VLANs un par un (chips retirables), puis ajout des ports avec un menu déroulant qui ne propose que les VLANs déjà déclarés
- Suppression du risque d'erreur de syntaxe/format — impossible de référencer un VLAN inexistant
- Suppression automatique des ports liés à un VLAN retiré

### 2026-07-06 — Modules VLAN et Firewall + correctif affichage
- **Correctif** : tableau de référence CIDR qui débordait du panneau (colonnes recalculées, en-têtes raccourcis, largeurs fixes)
- **Module VLAN** fonctionnel : génère une config switch Cisco IOS complète (déclaration VLANs, ports en accès, ports en trunk avec `allowed vlan`) à partir de champs simples, avec copie et export `.txt`
- **Module Firewall/ACL** fonctionnel : génère un script iptables complet (politique par défaut, règles ESTABLISHED/RELATED, une règle par ligne au format `ACTION protocole [port] source→destination`, port optionnel pour ICMP) avec copie et export `.sh`
- Bug corrigé : le format de règle imposait un port obligatoire même pour ICMP, alors que l'exemple fourni lui-même n'en avait pas — port maintenant optionnel

### 2026-07-06 — Panneau de référence CIDR (drawer)
- Remplacement du lien discret "aide-mémoire" par un **bouton "Référence CIDR"** bien visible dans l'en-tête du module
- L'aide-mémoire s'ouvre maintenant dans un **panneau latéral (drawer)** avec overlay, fermeture au clic extérieur ou touche `Échap`
- La ligne du **dernier CIDR utilisé** est automatiquement surlignée et centrée à l'ouverture

### 2026-07-06 — Guide de capacité + aide-mémoire CIDR
- Indicateur de **capacité en direct** sous le champ réseau de base VLSM (nb d'adresses/hôtes disponibles pendant la saisie, avant même de cliquer sur "Découper")
- Détection et affichage si l'IP saisie n'est pas alignée sur la frontière du CIDR (ex: `192.168.10.240/26` → aligné réellement sur `192.168.10.192/26`)
- Aide-mémoire CIDR complète, de /1 à /32

### 2026-07-06 — Découpage VLSM + enrichissements
- **Découpage VLSM** : à partir d'un réseau de base et d'une liste de besoins en hôtes (ex: `100,50,20,10`), calcule automatiquement l'allocation optimale de sous-réseaux (algorithme glouton, blocs alignés, non chevauchants)
- **Visualisation graphique** de l'espace d'adressage découpé (barre proportionnelle, segments colorés, espace libre visible)
- **Export du plan d'adressage** en fichier `.txt` prêt à l'emploi
- **Représentation binaire** de l'adresse réseau et du masque, avec surlignage bits réseau (cyan) / bits hôte (gris)
- **Détection du type d'adresse** (privée classe A/B/C, publique, loopback, APIPA)
- **Masque wildcard** affiché (utile pour les ACL Cisco)
- **Copie en un clic** sur chaque résultat du calculateur simple

### 2026-07-06 — Initialisation du projet
- Mise en place de la structure du projet et du design system (palette néon, typographies)
- Création du logo SVG (glow, sans bordure)
- Shell principal avec sidebar de navigation entre modules
- Module **Subnetting/VLSM** fonctionnel : calcul réseau, masque, broadcast, plage d'hôtes utilisables
- Modules VLAN et Firewall en placeholder
- Configuration PWA (manifest.json + service worker pour le hors-ligne)

---
*Ce README est mis à jour à chaque fichier livré ou modifié.*
