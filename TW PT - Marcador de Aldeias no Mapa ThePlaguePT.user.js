// ==UserScript==
// @name         TW PT - Marcador de Aldeias no Mapa ThePlaguePT
// @namespace    theplaguept.tw.map-marker
// @version      2.5.21
// @description  Marca listas de coordenadas no mapa e no minimapa do Tribal Wars.
// @author       ThePlaguePT
// @match        https://*.tribalwars.com.pt/game.php*
// @include      *://*.tribalwars.*/game.php*
// @homepageURL  https://github.com/ThePlaguePT/TribalWars-Scripts
// @supportURL   https://github.com/ThePlaguePT/TribalWars-Scripts/issues
// @grant        none
// @run-at       document-idle
// @noframes
// @icon         https://i.imgur.com/JXzrSKy.jpeg
// ==/UserScript==

(() => {
    "use strict";

    if (window.top !== window.self) return;

    const APP = {
        id: "tpMapMarker",
        title: "Marcador de Aldeias",
        version: "2.5.21",
        displayBaseTitle: "Marcador - ThePlaguePT",
        get displayTitle() {
            return `${this.displayBaseTitle} v${this.version}`;
        },
        defaultColor: "#b8322a",
        zIndex: 60030,
        launcherIcon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1a5 5 0 0 0-5 5c0 3.7 5 9 5 9s5-5.3 5-9a5 5 0 0 0-5-5z' fill='%23f6d28b' stroke='%2340140d'/%3E%3Ccircle cx='8' cy='6' r='2' fill='%23a32620'/%3E%3C/svg%3E",
    };
    const gd = window.game_data || {};
    const world = gd.world || location.hostname.split(".")[0] || "world";
    const storageKey = `${APP.id}:${world}`;
    const ZONE_SIZES = [25, 50, 100, 150, 200, 250, 300];
    const state = {
        coords: new Map(),
        secondaryCoords: new Map(),
        secondaryEnabled: false,
        tribePlayersEnabled: false,
        tribeQuery: "",
        tribeCoords: new Map(),
        tribePlayerGroups: [],
        disabledTribePlayerIds: new Set(),
        tribeDataLastUpdate: 0,
        color: APP.defaultColor,
        showLabels: true,
        coordinatesEnabled: true,
        distance: 20,
        zoneSize: 25,
        zones: [],
        zonesEnabled: false,
        ownVillages: null,
        bonusTypes: [],
        bonusEnabled: false,
        bonusVillages: null,
        bonusCoords: new Map(),
        supportEnabled: false,
        supportMode: "both",
        supportCoords: new Map(),
        supportLastUpdate: 0,
        supportTravelEnabled: false,
        supportTravelCoords: new Map(),
        supportTravelLastUpdate: 0,
        attackEnabled: false,
        attackExcludeBarbarians: false,
        attackExcludeFarm: false,
        attackCoords: new Map(),
        attackLastUpdate: 0,
        villageOwners: null,
        villageById: null,
        observer: null,
        refreshTimer: 0,
        pendingMiniRefresh: false,
        dragActive: false,
        dragFrame: 0,
        liveSyncFrame: 0,
        lastMiniSync: 0,
        resumeTimer: 0,
        resumeRunning: false,
        panel: null,
        launcher: null,
        mapToolbar: null,
        mapToggle: null,
        secondaryMapToggle: null,
        secondaryQuickBox: null,
        tribePlayersMapToggle: null,
        tribeQuickBox: null,
        tribePlayerFilter: null,
        bonusMapToggle: null,
        supportMapToggle: null,
        supportTravelMapToggle: null,
        attackMapToggle: null,
        launcherPositionFrame: 0,
    };

    load();
    injectStyles();
    createLauncher();
    registerHubShortcut();
    setupWorldTabResume();

    if (gd.screen === "map" || /[?&]screen=map(?:&|$)/.test(location.search)) {
        waitForMap();
    }

    function load() {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
            state.color = /^#[0-9a-f]{6}$/i.test(saved.color) ? saved.color : APP.defaultColor;
            state.showLabels = saved.showLabels !== false;
            state.coordinatesEnabled = saved.coordinatesEnabled !== undefined ? saved.coordinatesEnabled !== false : saved.enabled !== false;
            state.secondaryEnabled = saved.secondaryEnabled === true;
            state.tribePlayersEnabled = saved.tribePlayersEnabled === true;
            state.tribeQuery = String(saved.tribeQuery || "");
            state.disabledTribePlayerIds = new Set(Array.isArray(saved.disabledTribePlayerIds) ? saved.disabledTribePlayerIds.map(Number).filter(Number.isFinite) : []);
            state.distance = Math.max(1, Math.min(200, Number(saved.distance) || 20));
            state.zoneSize = normalizeZoneSize(saved.zoneSize);
            state.zonesEnabled = saved.zonesEnabled === true;
            state.bonusTypes = Array.isArray(saved.bonusTypes) ? saved.bonusTypes.map(String) : [];
            state.bonusEnabled = saved.bonusEnabled === true;
            state.supportEnabled = saved.supportEnabled === true;
            state.supportTravelEnabled = saved.supportTravelEnabled === true;
            state.supportMode = ["own", "others", "both"].includes(saved.supportMode) ? saved.supportMode : "both";
            state.attackEnabled = saved.attackEnabled === true;
            state.attackExcludeBarbarians = saved.attackExcludeBarbarians === true;
            state.attackExcludeFarm = saved.attackExcludeFarm === true;
            setCoordinates(Array.isArray(saved.coords) ? saved.coords.map((item) => `${item.x}|${item.y}`) : []);
            state.secondaryCoords = parseCoordinates(Array.isArray(saved.secondaryCoords) ? saved.secondaryCoords.map((item) => `${item.x}|${item.y}`) : []);
            state.zones = Array.isArray(saved.zones) ? saved.zones.map((zone) =>
                [...parseCoordinates((zone || []).map((item) => `${item.x}|${item.y}`)).values()]
            ).filter((zone) => zone.length) : [];
        } catch (_) {
            // Uma preferência inválida nunca deve impedir o carregamento do mapa.
        }
    }

    function save() {
        localStorage.setItem(storageKey, JSON.stringify({
            coords: [...state.coords.values()],
            secondaryCoords: [...state.secondaryCoords.values()],
            secondaryEnabled: state.secondaryEnabled,
            tribePlayersEnabled: state.tribePlayersEnabled,
            tribeQuery: state.tribeQuery,
            disabledTribePlayerIds: [...state.disabledTribePlayerIds],
            color: state.color,
            showLabels: state.showLabels,
            coordinatesEnabled: state.coordinatesEnabled,
            distance: state.distance,
            zoneSize: state.zoneSize,
            zones: state.zones,
            zonesEnabled: state.zonesEnabled,
            bonusTypes: state.bonusTypes,
            bonusEnabled: state.bonusEnabled,
            supportEnabled: state.supportEnabled,
            supportTravelEnabled: state.supportTravelEnabled,
            supportMode: state.supportMode,
            attackEnabled: state.attackEnabled,
            attackExcludeBarbarians: state.attackExcludeBarbarians,
            attackExcludeFarm: state.attackExcludeFarm,
        }));
    }

    function parseCoordinates(value) {
        const result = new Map();
        const text = Array.isArray(value) ? value.join("\n") : String(value || "");
        const regex = /(?:^|[^0-9])(\d{1,3})\s*(?:\||,|;|\/|\s)\s*(\d{1,3})(?![0-9])/g;
        let match;
        while ((match = regex.exec(text))) {
            const x = Number(match[1]);
            const y = Number(match[2]);
            if (x <= 999 && y <= 999) result.set(`${x}|${y}`, { x, y });
        }
        return result;
    }

    function normalizeZoneSize(value) {
        const size = Number(value);
        return ZONE_SIZES.includes(size) ? size : ZONE_SIZES[0];
    }

    function setCoordinates(value) {
        state.coords = parseCoordinates(value);
    }

    function buildZones(coordinates, maximum, ownVillages) {
        const zones = [];
        const split = (items, groupCount = Math.ceil(items.length / maximum)) => {
            if (groupCount <= 1 || items.length <= maximum) {
                zones.push(items.slice().sort((a, b) => a.y - b.y || a.x - b.x));
                return;
            }
            const xs = items.map((item) => item.x);
            const ys = items.map((item) => item.y);
            const useX = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
            const sorted = items.slice().sort((a, b) => useX ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x);
            const leftGroups = Math.ceil(groupCount / 2);
            const middle = Math.min(leftGroups * maximum, Math.round(sorted.length * leftGroups / groupCount));
            split(sorted.slice(0, middle), leftGroups);
            split(sorted.slice(middle), groupCount - leftGroups);
        };
        split(coordinates);
        return zones.sort((a, b) =>
            distanceToOwn(a, ownVillages) - distanceToOwn(b, ownVillages) ||
            zoneCenter(a).y - zoneCenter(b).y || zoneCenter(a).x - zoneCenter(b).x
        );
    }

    function distanceToOwn(zone, ownVillages) {
        let minimum = Infinity;
        for (const target of zone) {
            for (const own of ownVillages || []) {
                minimum = Math.min(minimum, Math.hypot(target.x - own.x, target.y - own.y));
            }
        }
        return minimum;
    }

    function zoneCenter(zone) {
        return {
            x: zone.reduce((sum, item) => sum + item.x, 0) / zone.length,
            y: zone.reduce((sum, item) => sum + item.y, 0) / zone.length,
        };
    }

    function formatZones(zones) {
        return zones.map((zone, index) =>
            `ZONA ${index + 1} (${zone.length})\n${zone.map(({ x, y }) => `${x}|${y}`).join(" ")}`
        ).join("\n\n");
    }

    function zonesCardsHtml(zones) {
        return zones.map((zone, index) => `
            <section class="${APP.id}-zoneCard" style="--tp-zone-color:${zoneColor(index)}">
                <div class="${APP.id}-zoneHead"><strong>Zona ${index + 1}</strong><span>${zone.length} aldeia(s)</span></div>
                <textarea readonly spellcheck="false">${escapeHtml(zone.map(({ x, y }) => `${x}|${y}`).join(" "))}</textarea>
            </section>`).join("");
    }

    function updateZonesOutput(panel) {
        const output = panel.querySelector(`.${APP.id}-zonesOutput`);
        if (!output) return;
        output.innerHTML = zonesCardsHtml(state.zones);
        panel.querySelector(`.${APP.id}-zonesSection`)?.classList.toggle("tp-visible", Boolean(state.zones.length));
    }

    async function loadOwnVillages() {
        if (state.ownVillages?.length) return state.ownVillages;
        const playerId = Number(gd.player?.id);
        if (!playerId) throw new Error("jogador não identificado");
        const cacheKey = `${APP.id}:own:${world}:${playerId}`;
        try {
            const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
            if (cached?.time > Date.now() - 6 * 60 * 60 * 1000 && Array.isArray(cached.villages)) {
                state.ownVillages = cached.villages;
                return state.ownVillages;
            }
        } catch (_) { /* cache inválida */ }
        const response = await fetch(`${location.origin}/map/village.txt`, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`erro HTTP ${response.status}`);
        const text = await response.text();
        state.ownVillages = text.split("\n").reduce((villages, line) => {
            const fields = line.trim().split(",");
            if (Number(fields[4]) === playerId) villages.push({ x: Number(fields[2]), y: Number(fields[3]) });
            return villages;
        }, []);
        if (!state.ownVillages.length) throw new Error("nenhuma aldeia própria encontrada");
        try { localStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), villages: state.ownVillages })); } catch (_) { /* cache cheia */ }
        return state.ownVillages;
    }

    function zoneForCoordinate(x, y) {
        if (!state.zonesEnabled) return -1;
        return state.zones.findIndex((zone) => zone.some((item) => item.x === x && item.y === y));
    }

    function zoneColor(index) {
        const colors = ["#e31b23", "#1261d8", "#f08a00", "#7b2fc6", "#009b4d", "#e00087", "#009fbd", "#c9a900", "#4b45d6", "#ed4b16", "#00a878", "#a914d4"];
        return index >= 0 ? colors[index % colors.length] : state.color;
    }

    function bonusData() {
        return window.TWMap?.bonus_data || {};
    }

    function bonusIconUrl(bonusId) {
        const info = bonusData()?.[bonusId] || {};
        let source = String(info.icon || info.image || info.img || "").trim();
        const cssUrl = source.match(/^url\(["']?(.*?)["']?\)$/i);
        if (cssUrl) source = cssUrl[1];
        if (!source) return "";
        if (/^(?:https?:|data:|blob:)/i.test(source)) return source;
        if (!source.includes("/")) source = `graphic/bonus/${source}`;
        try { return new URL(source, `${location.origin}/`).href; } catch (_) { return source; }
    }

    function bonusOptionsHtml() {
        const data = bonusData();
        const entries = Object.entries(data).filter(([id]) => Number(id) > 0);
        if (!entries.length) return `<span class="${APP.id}-bonusEmpty">Os tipos ficam disponíveis na página do mapa.</span>`;
        return entries.map(([id, info]) => `
            <label class="${APP.id}-bonusOption"><input type="checkbox" value="${escapeHtml(id)}" ${state.bonusTypes.includes(String(id)) ? "checked" : ""}><span>${escapeHtml(info?.text || `Bónus ${id}`)}</span></label>
        `).join("");
    }

    function activeCoordinates() {
        const merged = state.coordinatesEnabled ? new Map(state.coords) : new Map();
        if (state.secondaryEnabled) for (const [key, item] of state.secondaryCoords) merged.set(key, { ...item, secondary: true });
        if (state.tribePlayersEnabled) for (const [key, item] of state.tribeCoords) {
            if (!state.disabledTribePlayerIds.has(Number(item.playerId))) merged.set(key, item);
        }
        if (state.bonusEnabled) for (const [key, item] of state.bonusCoords) merged.set(key, item);
        if (state.supportEnabled) for (const [key, item] of state.supportCoords) merged.set(key, item);
        if (state.supportTravelEnabled) for (const [key, item] of state.supportTravelCoords) merged.set(key, item);
        if (state.attackEnabled) for (const [key, item] of state.attackCoords) merged.set(key, item);
        return merged;
    }

    function markerColorFor(x, y) {
        const attack = state.attackEnabled ? state.attackCoords.get(`${x}|${y}`) : null;
        if (attack?.outgoingCount && attack?.returningCount) return "linear-gradient(90deg,#d71920 0 50%,#f59e0b 50% 100%)";
        if (attack?.returningCount) return "#f59e0b";
        if (attack) return "#d71920";
        if (state.secondaryEnabled && state.secondaryCoords.has(`${x}|${y}`)) return "#f4b400";
        const tribeVillage = state.tribePlayersEnabled ? state.tribeCoords.get(`${x}|${y}`) : null;
        if (tribeVillage) return tribeVillage.playerColor;
        if (state.supportTravelEnabled && state.supportTravelCoords.has(`${x}|${y}`)) return "#f08a00";
        if (state.supportEnabled && state.supportCoords.has(`${x}|${y}`)) return "#00a9d6";
        const bonus = state.bonusCoords.get(`${x}|${y}`);
        if (state.bonusEnabled && bonus) {
            const palette = ["#ffb000", "#00a950", "#1473e6", "#e53935", "#8e35d1", "#00a6b8", "#f05a16", "#d4148e"];
            return palette[Math.max(0, Number(bonus.bonus) - 1) % palette.length];
        }
        return zoneColor(zoneForCoordinate(x, y));
    }

    function decodeMapField(value) {
        try { return decodeURIComponent(String(value || "").replace(/\+/g, "%20")); }
        catch (_) { return String(value || "").replace(/\+/g, " "); }
    }

    function playerMarkerColor(index) {
        const colors = [
            "#e60026", "#0066ff", "#00a83b", "#ff7900", "#7a20d9", "#00a9a5",
            "#d900a6", "#8f4e00", "#e04700", "#0057b8", "#138f00", "#bd00ff",
            "#d62728", "#0088cc", "#63a800", "#ff3d7f", "#5b3fd1", "#00966d"
        ];
        return colors[Math.abs(Number(index) || 0) % colors.length];
    }

    function isTribePlayerVisible(player) {
        return !state.disabledTribePlayerIds.has(Number(player?.id));
    }

    async function loadTribePlayerVillages(force = false) {
        if (!state.tribePlayersEnabled) {
            state.tribeCoords.clear();
            state.tribePlayerGroups = [];
            return;
        }
        const requested = state.tribeQuery.split(/[\n,;]+/).map((value) => value.trim().toLocaleLowerCase()).filter(Boolean);
        if (!requested.length) throw new Error("indica pelo menos um jogador ou uma tribo");
        if (!force && state.tribeCoords.size && Date.now() - state.tribeDataLastUpdate < 5 * 60 * 1000) return;

        const fetchMapFile = async (name) => {
            const response = await fetch(`${location.origin}/map/${name}.txt`, { credentials: "same-origin" });
            if (!response.ok) throw new Error(`${name}.txt: HTTP ${response.status}`);
            return response.text();
        };
        const [alliesText, playersText, villagesText] = await Promise.all([
            fetchMapFile("ally"), fetchMapFile("player"), fetchMapFile("village")
        ]);
        const allyIds = new Set();
        alliesText.split("\n").forEach((line) => {
            const fields = line.trim().split(",");
            if (fields.length < 3) return;
            const name = decodeMapField(fields[1]).toLocaleLowerCase();
            const tag = decodeMapField(fields[2]).toLocaleLowerCase();
            if (requested.includes(name) || requested.includes(tag)) allyIds.add(Number(fields[0]));
        });
        const players = new Map();
        playersText.split("\n").forEach((line) => {
            const fields = line.trim().split(",");
            if (fields.length < 3) return;
            const id = Number(fields[0]);
            const name = decodeMapField(fields[1]);
            const selectedByPlayer = requested.includes(name.toLocaleLowerCase());
            const selectedByTribe = allyIds.has(Number(fields[2]));
            if (selectedByPlayer || selectedByTribe) players.set(id, { id, name, villages: [] });
        });
        if (!players.size) throw new Error("nenhum jogador, nome de tribo ou tag encontrado");
        villagesText.split("\n").forEach((line) => {
            const fields = line.trim().split(",");
            if (fields.length < 5) return;
            const player = players.get(Number(fields[4]));
            if (!player) return;
            const village = { id: Number(fields[0]), x: Number(fields[2]), y: Number(fields[3]) };
            if (Number.isFinite(village.x) && Number.isFinite(village.y)) player.villages.push(village);
        });

        const groups = [...players.values()].filter((player) => player.villages.length)
            .sort((a, b) => a.name.localeCompare(b.name, "pt"));
        const coords = new Map();
        groups.forEach((player, index) => {
            player.color = playerMarkerColor(index);
            player.center = zoneCenter(player.villages);
            player.villages.forEach(({ id, x, y }) => coords.set(`${x}|${y}`, {
                id, x, y, tribePlayer: true, playerId: player.id, playerName: player.name, playerColor: player.color
            }));
        });
        state.tribeCoords = coords;
        state.tribePlayerGroups = groups;
        state.tribeDataLastUpdate = Date.now();
        renderTribePlayerFilter();
    }

    async function loadSupportedVillages(force = false) {
        if (!state.supportEnabled) {
            state.supportCoords.clear();
            return;
        }
        if (!force && state.supportCoords.size && Date.now() - state.supportLastUpdate < 2 * 60 * 1000) return;
        const url = `${gd.link_base_pure || `${location.origin}/game.php?village=${gd.village?.id}&screen=`}overview_villages&mode=units&type=away_detail&units_type=away_detail&group=0&page=-1`;
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`erro HTTP ${response.status}`);
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const own = await loadOwnVillages();
        const ownKeys = new Set(own.map(({ x, y }) => `${x}|${y}`));
        const found = new Map();
        const originRows = [...doc.querySelectorAll("#units_table tr.units_away")];
        for (const originRow of originRows) {
            // A linha units_away identifica a aldeia de partida. Os destinos onde
            // os apoios estão estacionados surgem nas linhas row_a/row_b seguintes.
            for (let row = originRow.nextElementSibling; row && !row.classList.contains("units_away"); row = row.nextElementSibling) {
                if (!row.matches("tr.row_a, tr.row_b")) continue;
                const targetCell = row.cells?.[0];
                if (!targetCell) continue;
                const targetLink = targetCell.querySelector('a[href*="screen=info_village"],a[href*="info_village"]');
                const match = targetCell.textContent.match(/(\d{1,3})\s*\|\s*(\d{1,3})/);
                if (!match) continue;
                const x = Number(match[1]);
                const y = Number(match[2]);
                const key = `${x}|${y}`;
                const isOwn = ownKeys.has(key);
                if (state.supportMode === "own" && !isOwn) continue;
                if (state.supportMode === "others" && isOwn) continue;
                const idMatch = String(targetLink?.href || "").match(/[?&]id=(\d+)/);
                found.set(key, { x, y, id: idMatch ? Number(idMatch[1]) : null, support: true, isOwn });
            }
        }
        state.supportCoords = found;
        state.supportLastUpdate = Date.now();
    }

    async function loadTravelingSupportVillages(force = false) {
        if (!state.supportTravelEnabled) {
            state.supportTravelCoords.clear();
            return;
        }
        if (!force && state.supportTravelCoords.size && Date.now() - state.supportTravelLastUpdate < 60 * 1000) return;
        const url = `${gd.link_base_pure || `${location.origin}/game.php?village=${gd.village?.id}&screen=`}overview_villages&mode=commands&type=support&group=0&page=-1`;
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`erro HTTP ${response.status}`);
        const doc = new DOMParser().parseFromString(await response.text(), "text/html");
        const own = await loadOwnVillages();
        const ownKeys = new Set(own.map(({ x, y }) => `${x}|${y}`));
        const rows = [...doc.querySelectorAll("#commands_table tr.row_a, #commands_table tr.row_ax, #commands_table tr.row_b, #commands_table tr.row_bx")];
        const found = new Map();

        for (const row of rows) {
            const signature = `${row.className || ""} ${row.innerHTML || ""}`.toLowerCase();
            if (/return_|return\.png|back\.png|command[_-]?return/.test(signature)) continue;
            const targetLabel = row.querySelector(".quickedit-label");
            const targetLink = targetLabel?.closest("a") || targetLabel?.querySelector('a[href*="info_village"]') || null;
            const match = (targetLabel?.textContent || "").match(/(\d{1,3})\s*\|\s*(\d{1,3})/);
            if (!match) continue;
            const x = Number(match[1]);
            const y = Number(match[2]);
            const key = `${x}|${y}`;
            const isOwn = ownKeys.has(key);
            if (state.supportMode === "own" && !isOwn) continue;
            if (state.supportMode === "others" && isOwn) continue;
            const idMatch = String(targetLink?.href || "").match(/[?&]id=(\d+)/);
            const previous = found.get(key);
            found.set(key, { x, y, id: idMatch ? Number(idMatch[1]) : null, supportTravel: true, isOwn, count: (previous?.count || 0) + 1 });
        }
        state.supportTravelCoords = found;
        state.supportTravelLastUpdate = Date.now();
    }

    async function loadVillageOwners() {
        if (state.villageOwners) return state.villageOwners;
        const response = await fetch(`${location.origin}/map/village.txt`, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`erro HTTP ${response.status}`);
        const owners = new Map();
        const villagesById = new Map();
        (await response.text()).split("\n").forEach((line) => {
            const fields = line.trim().split(",");
            if (fields.length < 5) return;
            const village = { id: Number(fields[0]), x: Number(fields[2]), y: Number(fields[3]), owner: Number(fields[4]) };
            owners.set(`${village.x}|${village.y}`, village.owner);
            villagesById.set(village.id, village);
        });
        state.villageOwners = owners;
        state.villageById = villagesById;
        return owners;
    }

    function extractAttackTarget(row, ownKeys) {
        const candidates = new Map();
        const addCoordinates = (value) => {
            for (const match of String(value || "").matchAll(/(\d{1,3})\s*\|\s*(\d{1,3})/g)) {
                const x = Number(match[1]);
                const y = Number(match[2]);
                if (x <= 999 && y <= 999) candidates.set(`${x}|${y}`, { x, y });
            }
        };
        const targetLabel = row.querySelector(".quickedit-label,[data-role='target'],[data-command-target],.command-target,.target");
        if (targetLabel) {
            addCoordinates(targetLabel.textContent);
            addCoordinates(targetLabel.getAttribute("data-text"));
            addCoordinates(targetLabel.getAttribute("data-coord"));
            addCoordinates(targetLabel.getAttribute("title"));
            addCoordinates(targetLabel.closest("td")?.textContent);
        }
        row.querySelectorAll("[data-coord],[data-coordinates],[data-text],[title],a[href*='info_village']").forEach((element) => {
            addCoordinates(element.getAttribute("data-coord"));
            addCoordinates(element.getAttribute("data-coordinates"));
            addCoordinates(element.getAttribute("data-text"));
            addCoordinates(element.getAttribute("title"));
            addCoordinates(element.textContent);
        });
        addCoordinates(row.textContent);

        const direct = [...candidates.values()].find(({ x, y }) => !ownKeys.has(`${x}|${y}`));
        if (direct) return direct;

        const ids = new Set();
        row.querySelectorAll("[data-id],[data-village-id],[data-target-id],a[href*='info_village']").forEach((element) => {
            [element.getAttribute("data-target-id"), element.getAttribute("data-village-id"), element.getAttribute("data-id")].forEach((value) => {
                if (/^\d+$/.test(String(value || ""))) ids.add(Number(value));
            });
            const idMatch = String(element.getAttribute("href") || "").match(/[?&]id=(\d+)/);
            if (idMatch) ids.add(Number(idMatch[1]));
        });
        for (const id of ids) {
            const village = state.villageById?.get(id);
            if (village && !ownKeys.has(`${village.x}|${village.y}`)) return { x: village.x, y: village.y, id };
        }
        return null;
    }

    function isFarmAssistantAttackRow(row) {
        const signature = `${row.textContent || ""} ${row.innerHTML || ""}`.toLowerCase();
        return /am_farm|farm_icon|\/farm\.png|command[_-]?farm|farm assistant|assistente de farm|assistente de saque|farmar/.test(signature);
    }

    function isReturningCommandRow(row) {
        const signature = `${row.className || ""} ${row.textContent || ""} ${row.innerHTML || ""}`.toLowerCase();
        return /return_|return\.png|back\.png|command[_-]?return|regress|retorn/.test(signature);
    }

    function isSupportCommandRow(row) {
        const signature = `${row.className || ""} ${row.textContent || ""} ${row.innerHTML || ""}`.toLowerCase();
        return /command[_-]?support|support\.png|apoio|apoiar/.test(signature);
    }

    async function loadAttackedVillages(force = false) {
        if (!state.attackEnabled) {
            state.attackCoords.clear();
            return;
        }
        if (!force && state.attackCoords.size && Date.now() - state.attackLastUpdate < 60 * 1000) return;
        const base = gd.link_base_pure || `${location.origin}/game.php?village=${gd.village?.id}&screen=`;
        const sources = await Promise.all(["attack", "return"].map(async (type) => {
            const response = await fetch(`${base}overview_villages&mode=commands&type=${type}&group=0&page=-1`, { credentials: "same-origin" });
            if (!response.ok) throw new Error(`erro HTTP ${response.status}`);
            return { type, doc: new DOMParser().parseFromString(await response.text(), "text/html") };
        }));
        const owners = await loadVillageOwners();
        const own = await loadOwnVillages();
        const ownKeys = new Set(own.map(({ x, y }) => `${x}|${y}`));
        const found = new Map();

        for (const { type, doc } of sources) for (const row of doc.querySelectorAll("#commands_table tbody tr, #commands_table tr.command-row, #commands_table tr.row_a, #commands_table tr.row_ax, #commands_table tr.row_b, #commands_table tr.row_bx")) {
            const returning = type === "return" || isReturningCommandRow(row);
            if (returning && isSupportCommandRow(row)) continue;
            const target = extractAttackTarget(row, ownKeys);
            if (!target) continue;
            const { x, y } = target;
            const key = `${x}|${y}`;
            const isBarbarian = owners.get(key) === 0;
            const isFarm = isFarmAssistantAttackRow(row);
            if (state.attackExcludeBarbarians && isBarbarian) continue;
            if (state.attackExcludeFarm && isFarm) continue;
            const previous = found.get(key);
            const outgoingCount = (previous?.outgoingCount || 0) + (returning ? 0 : 1);
            const returningCount = (previous?.returningCount || 0) + (returning ? 1 : 0);
            found.set(key, {
                x, y, id: target.id || previous?.id || null, attack: true, isBarbarian,
                isFarm: Boolean(previous?.isFarm || isFarm), outgoingCount, returningCount,
                count: outgoingCount + returningCount
            });
        }
        state.attackCoords = found;
        state.attackLastUpdate = Date.now();
    }

    async function loadBonusBarbarians() {
        const selected = new Set(state.bonusTypes.map(String));
        state.bonusCoords.clear();
        if (!state.bonusEnabled || !selected.size) return;
        if (!state.bonusVillages) {
            const cacheKey = `${APP.id}:bonus:${world}`;
            try {
                const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
                if (cached?.time > Date.now() - 6 * 60 * 60 * 1000 && Array.isArray(cached.villages)) state.bonusVillages = cached.villages;
            } catch (_) { /* cache inválida */ }
            if (!state.bonusVillages) {
                const response = await fetch(`${location.origin}/map/village.txt`, { credentials: "same-origin" });
                if (!response.ok) throw new Error(`erro HTTP ${response.status}`);
                const text = await response.text();
                state.bonusVillages = text.split("\n").reduce((items, line) => {
                    const fields = line.trim().split(",");
                    const bonus = Number(fields[6]);
                    if (Number(fields[4]) === 0 && bonus > 0) items.push({ id: Number(fields[0]), x: Number(fields[2]), y: Number(fields[3]), bonus });
                    return items;
                }, []);
                try { localStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), villages: state.bonusVillages })); } catch (_) { /* cache cheia */ }
            }
        }
        for (const village of state.bonusVillages) {
            if (selected.has(String(village.bonus))) state.bonusCoords.set(`${village.x}|${village.y}`, village);
        }
        scanVisibleBonusBarbarians();
    }

    function scanVisibleBonusBarbarians() {
        if (!state.bonusEnabled || !state.bonusTypes.length || !window.TWMap?.villages) return;
        const selected = new Set(state.bonusTypes.map(String));
        for (const [key, village] of Object.entries(window.TWMap.villages)) {
            const owner = Number(village?.owner ?? village?.player_id ?? village?.player ?? 0);
            if (owner !== 0) continue;
            let bonus = village?.bonus ?? village?.bonus_id ?? village?.bonusId;
            const id = village?.id ?? village?.[0];
            const image = id != null ? document.getElementById(`map_village_${id}`) : null;
            if (bonus == null && image) {
                const source = image.currentSrc || image.src || "";
                for (const [bonusId, info] of Object.entries(bonusData())) {
                    const token = String(info?.image || info?.img || info?.icon || "").split("/").pop();
                    if (token && source.includes(token)) { bonus = bonusId; break; }
                }
            }
            if (!selected.has(String(bonus))) continue;
            let x = Number(village?.x);
            let y = Number(village?.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                const match = String(key).match(/^(\d{3})(\d{3})$/);
                if (match) { x = Number(match[1]); y = Number(match[2]); }
            }
            if (Number.isFinite(x) && Number.isFinite(y)) state.bonusCoords.set(`${x}|${y}`, { id, x, y, bonus: Number(bonus) });
        }
    }

    function injectStyles() {
        const existing = document.getElementById(`${APP.id}-styles`);
        if (existing) {
            applyPanelStylesheet(existing.textContent);
            return;
        }

        const style = document.createElement("style");
        style.id = `${APP.id}-styles`;
        const nonceSource = document.querySelector("style[nonce],script[nonce]");
        if (nonceSource?.nonce) style.nonce = nonceSource.nonce;
        style.textContent = `
#tp-theplaguept-script-bar {
    position: fixed !important;
    top: 8px !important;
    left: 414px !important;
    right: auto !important;
    bottom: auto !important;
    z-index: 2147483647 !important;
    width: auto !important;
    min-width: 0 !important;
    height: 34px !important;
    display: flex !important;
    flex-direction: row !important;
    align-items: center !important;
    justify-content: flex-start !important;
    gap: 5px !important;
    padding: 0 8px !important;
    box-sizing: border-box !important;
    pointer-events: none !important;
    overflow: visible !important;
    transform: none !important;
}

#tp-theplaguept-script-bar > * {
    position: relative !important;
    top: auto !important;
    left: auto !important;
    right: auto !important;
    bottom: auto !important;
    transform: none !important;
    width: 30px !important;
    min-width: 30px !important;
    max-width: 30px !important;
    height: 28px !important;
    min-height: 28px !important;
    margin: 0 !important;
    flex: 0 0 30px !important;
    pointer-events: auto !important;
    overflow: visible !important;
}

#tp-theplaguept-script-bar > button,
#tp-theplaguept-script-bar > * > button {
    position: relative !important;
    top: auto !important;
    left: auto !important;
    right: auto !important;
    bottom: auto !important;
    transform: none !important;
    width: 30px !important;
    min-width: 30px !important;
    max-width: 30px !important;
    height: 28px !important;
    min-height: 28px !important;
    margin: 0 !important;
    padding: 0 !important;
    flex: 0 0 30px !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 0 !important;
    overflow: visible !important;
}

#tp-theplaguept-script-bar > button:hover,
#tp-theplaguept-script-bar > button:focus-visible,
#tp-theplaguept-script-bar > * > button:hover,
#tp-theplaguept-script-bar > * > button:focus-visible,
#tp-theplaguept-script-bar #tag-incomings-pt-panel:not(.ti-open) .ti-toggle:hover,
#tp-theplaguept-script-bar #tag-incomings-pt-panel:not(.ti-open) .ti-toggle:focus-visible,
#tp-theplaguept-script-bar > #tp-od-est-launcher:hover,
#tp-theplaguept-script-bar > #tp-od-est-launcher:focus-visible {
    width: 30px !important;
    min-width: 30px !important;
    max-width: 30px !important;
    padding: 0 !important;
    gap: 0 !important;
}

#tp-theplaguept-script-bar .tpdef-launcher-text,
#tp-theplaguept-script-bar .tw-alerts-toggle-label,
#tp-theplaguept-script-bar .ti-toggle-label,
#tp-theplaguept-script-bar .ra-tp-config-button-label,
#tp-theplaguept-script-bar [class$="-launcherLabel"],
#tp-theplaguept-script-bar [class$="-launcher-text"] {
    display: none !important;
    max-width: 0 !important;
    opacity: 0 !important;
}

#tp-theplaguept-script-bar #twHubTp-launcher { order: 10 !important; }
#tp-theplaguept-script-bar #tw-discord-alerts-ui { order: 20 !important; }
#tp-theplaguept-script-bar #tpDefLauncher { order: 30 !important; }
#tp-theplaguept-script-bar #tag-incomings-pt-panel { order: 40 !important; }
#tp-theplaguept-script-bar #tpMapMarker-launcher { order: 50 !important; }
#tp-theplaguept-script-bar #renomear-ataques-cores-theplaguept-config-button { order: 60 !important; }
#tp-theplaguept-script-bar #tpResumo24h-launcher { order: 70 !important; }
#tp-theplaguept-script-bar #tpconq-launcher { order: 80 !important; }
#tp-theplaguept-script-bar #twp-troop-summary-launcher { order: 85 !important; }
#tp-theplaguept-script-bar #auto-farm-a-toggle { order: 90 !important; }
#tp-theplaguept-script-bar #tp-od-est-launcher { order: 92 !important; }
#tp-theplaguept-script-bar #script-coleta-toggle { order: 94 !important; }

#tp-theplaguept-script-bar > .tp-theplaguept-script-bar-item[data-tp-title]::after {
    content: attr(data-tp-title) !important;
    position: absolute !important;
    left: 50% !important;
    top: 33px !important;
    transform: translateX(-50%) !important;
    display: none !important;
    white-space: nowrap !important;
    max-width: 360px !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    padding: 4px 8px !important;
    border: 1px solid #4f120f !important;
    border-radius: 2px !important;
    background: linear-gradient(to bottom, #f6dfaa, #d2a05a) !important;
    color: #2b1509 !important;
    font: bold 11px Verdana, Arial, sans-serif !important;
    text-shadow: 0 1px #fff !important;
    box-shadow: 0 2px 6px rgba(0,0,0,.55) !important;
    pointer-events: none !important;
    z-index: 2147483647 !important;
}

#tp-theplaguept-script-bar > .tp-theplaguept-script-bar-item[data-tp-title]:hover::after,
#tp-theplaguept-script-bar > .tp-theplaguept-script-bar-item[data-tp-title]:focus-within::after {
    display: block !important;
}

@media (max-width: 1919px) {
    #tp-theplaguept-script-bar {
        top: 50vh !important;
        left: max(12px, calc((100vw - 1220px) / 2 + 8px)) !important;
        right: auto !important;
        bottom: auto !important;
        width: 34px !important;
        min-width: 34px !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: calc(100vh - 118px) !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 5px !important;
        padding: 8px 2px !important;
        transform: translateY(-50%) !important;
    }

    #tp-theplaguept-script-bar > #auto-farm-a-toggle::after,
    #tp-theplaguept-script-bar > #script-coleta-toggle::after,
    #tp-theplaguept-script-bar > .tp-theplaguept-script-bar-item[data-tp-title]::after {
        top: 50% !important;
        left: 38px !important;
        transform: translateY(-50%) !important;
    }

    #tp-theplaguept-script-bar [data-auto-farm-countdown],
    #tp-theplaguept-script-bar [data-script-coleta-countdown] {
        top: 50% !important;
        left: 38px !important;
        transform: translateY(-50%) !important;
    }
}

#${APP.id}-launcher {
    position: fixed !important;
    top: 250px !important;
    left: 12px !important;
    z-index: ${APP.zIndex} !important;
    width: 30px !important;
    min-width: 30px !important;
    height: 28px !important;
    min-height: 28px !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 0 !important;
    border: 1px solid #4f120f !important;
    border-radius: 3px !important;
    background: linear-gradient(to bottom, #b03a31, #7b201b) !important;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.22), 0 1px 3px rgba(0,0,0,.55) !important;
    color: #fff !important;
    cursor: pointer !important;
    overflow: visible !important;
}

#${APP.id}-launcher:hover,
#${APP.id}-launcher:focus-visible {
    background: linear-gradient(to bottom, #c4473b, #8a2720) !important;
}

.${APP.id}-launcherIcon {
    width: 17px !important;
    height: 17px !important;
    display: block !important;
    background: url("${APP.launcherIcon}") center / contain no-repeat !important;
}

.${APP.id}-launcherLabel {
    display: none !important;
}

#${APP.id}-mapToolbar {
    position: absolute !important;
    top: 10px !important;
    right: 10px !important;
    z-index: ${APP.zIndex + 2} !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 4px !important;
    padding: 4px !important;
    border: 1px solid rgba(30, 22, 16, .85) !important;
    border-radius: 3px !important;
    background: rgba(46, 42, 38, .72) !important;
    box-shadow: 0 2px 6px rgba(0,0,0,.45) !important;
    pointer-events: auto !important;
}

#${APP.id}-mapToolbar button {
    width: 28px !important;
    height: 28px !important;
    min-width: 28px !important;
    min-height: 28px !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 0 !important;
    border: 1px solid #2f241a !important;
    border-radius: 2px !important;
    background: linear-gradient(to bottom, #737373, #3f3f3f) !important;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.22), 0 1px 2px rgba(0,0,0,.55) !important;
    color: #fff !important;
    font: bold 15px Arial, sans-serif !important;
    line-height: 1 !important;
    cursor: pointer !important;
}

#${APP.id}-mapToolbar button:hover {
    filter: brightness(1.12) !important;
}

#${APP.id}-mapToolbar button.tp-off {
    opacity: .48 !important;
    filter: grayscale(.45) !important;
}

#${APP.id}-mapToolbar .tp-togglePin {
    width: 15px !important;
    height: 15px !important;
    display: block !important;
    border-radius: 50% 50% 50% 0 !important;
    background: #e9d26d !important;
    border: 2px solid #3b160f !important;
    transform: rotate(-45deg) !important;
    box-sizing: border-box !important;
}

#${APP.id}-mapToolbar .tp-togglePin::after {
    content: "" !important;
    width: 5px !important;
    height: 5px !important;
    position: absolute !important;
    left: 3px !important;
    top: 3px !important;
    border-radius: 50% !important;
    background: #a32620 !important;
}

#${APP.id}-secondaryQuickBox {
    position: absolute !important;
    top: 50px !important;
    right: 10px !important;
    z-index: 27 !important;
    width: 218px !important;
    max-width: calc(100% - 20px) !important;
    padding: 5px !important;
    border: 2px solid #5b3214 !important;
    border-radius: 3px !important;
    background: #f4e4b8 !important;
    box-shadow: 0 2px 7px rgba(0,0,0,.65) !important;
    color: #351b09 !important;
    font: 11px Verdana, Arial, sans-serif !important;
    pointer-events: auto !important;
    box-sizing: border-box !important;
}

.${APP.id}-secondaryQuickHead {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 5px !important;
    margin-bottom: 4px !important;
    color: #8b211b !important;
    font-weight: bold !important;
}

.${APP.id}-secondaryQuickInput {
    display: block !important;
    width: 100% !important;
    height: 44px !important;
    margin: 0 0 4px !important;
    padding: 3px 5px !important;
    resize: vertical !important;
    border: 1px solid #86521e !important;
    background: #fff9df !important;
    color: #1e1007 !important;
    font: 11px Consolas, monospace !important;
    box-sizing: border-box !important;
}

.${APP.id}-secondaryQuickFoot { display: flex !important; align-items: center !important; justify-content: space-between !important; gap: 5px !important; }
.${APP.id}-secondaryQuickFoot button {
    min-height: 24px !important;
    padding: 2px 9px !important;
    border: 1px solid #56230f !important;
    border-radius: 2px !important;
    background: linear-gradient(to bottom, #9e5932, #6e2d19) !important;
    color: #fff !important;
    font-weight: bold !important;
    cursor: pointer !important;
}

#${APP.id}-tribeQuickBox {
    position: absolute !important;
    top: 50px !important;
    right: 10px !important;
    z-index: 27 !important;
    width: 250px !important;
    max-width: calc(100% - 20px) !important;
    padding: 5px !important;
    border: 2px solid #274d91 !important;
    border-radius: 3px !important;
    background: #e8e2c5 !important;
    box-shadow: 0 2px 7px rgba(0,0,0,.65) !important;
    color: #241609 !important;
    font: 11px Verdana, Arial, sans-serif !important;
    pointer-events: auto !important;
    box-sizing: border-box !important;
}

.${APP.id}-tribeQuickHead { margin-bottom: 4px !important; color: #244f9b !important; font-weight: bold !important; }
.${APP.id}-tribeQuickLine { display: flex !important; gap: 4px !important; }
.${APP.id}-tribeQuickInput {
    min-width: 0 !important;
    flex: 1 1 auto !important;
    height: 27px !important;
    padding: 3px 5px !important;
    border: 1px solid #526c99 !important;
    background: #fffdf0 !important;
    font: 11px Verdana, Arial, sans-serif !important;
    box-sizing: border-box !important;
}
.${APP.id}-tribeQuickLine button {
    min-height: 27px !important;
    padding: 2px 8px !important;
    border: 1px solid #1e3f78 !important;
    border-radius: 2px !important;
    background: linear-gradient(to bottom, #4777c7, #28539a) !important;
    color: #fff !important;
    font-weight: bold !important;
    cursor: pointer !important;
}

#${APP.id}-tribePlayerFilter {
    position: absolute !important;
    top: 154px !important;
    right: 10px !important;
    z-index: 26 !important;
    width: 218px !important;
    max-width: calc(100% - 20px) !important;
    border: 2px solid #5b3214 !important;
    border-radius: 3px !important;
    background: #f4e4b8 !important;
    box-shadow: 0 2px 7px rgba(0,0,0,.65) !important;
    color: #351b09 !important;
    font: 11px Verdana, Arial, sans-serif !important;
    pointer-events: auto !important;
    overflow: hidden !important;
}

.${APP.id}-playerFilterHead {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 5px !important;
    padding: 5px 6px !important;
    border-bottom: 1px solid #9b6a32 !important;
    background: linear-gradient(to bottom, #e7c77f, #c99b50) !important;
    font-weight: bold !important;
}

.${APP.id}-playerFilterActions { display: inline-flex !important; gap: 3px !important; }
.${APP.id}-playerFilterActions button {
    min-width: 25px !important;
    height: 21px !important;
    padding: 0 4px !important;
    border: 1px solid #5a2a12 !important;
    border-radius: 2px !important;
    background: linear-gradient(to bottom, #9e5932, #6e2d19) !important;
    color: #fff !important;
    font: bold 10px Arial, sans-serif !important;
    cursor: pointer !important;
}

.${APP.id}-playerFilterList {
    max-height: 270px !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    padding: 3px !important;
    scrollbar-color: #986a38 #ead5a3 !important;
}

.${APP.id}-playerFilterItem {
    display: grid !important;
    grid-template-columns: 17px 13px minmax(0, 1fr) auto !important;
    align-items: center !important;
    gap: 4px !important;
    min-height: 23px !important;
    padding: 2px 3px !important;
    border-bottom: 1px solid rgba(117,76,32,.25) !important;
    cursor: pointer !important;
}

.${APP.id}-playerFilterItem:hover { background: rgba(255,255,255,.42) !important; }
.${APP.id}-playerFilterItem input { margin: 0 !important; }
.${APP.id}-playerFilterColor {
    width: 11px !important;
    height: 11px !important;
    border: 1px solid #fff !important;
    border-radius: 50% !important;
    background: var(--tp-player-color) !important;
    box-shadow: 0 0 0 1px #281508 !important;
}
.${APP.id}-playerFilterName { overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; font-weight: bold !important; }
.${APP.id}-playerFilterCount { color: #714215 !important; font-size: 10px !important; }

#${APP.id}-mapToolbar .tp-toggleBonus,
#${APP.id}-mapToolbar .tp-toggleSecondary,
#${APP.id}-mapToolbar .tp-toggleTribePlayers,
#${APP.id}-mapToolbar .tp-toggleSupport,
#${APP.id}-mapToolbar .tp-toggleSupportTravel,
#${APP.id}-mapToolbar .tp-toggleAttack {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 100% !important;
    height: 100% !important;
}

.${APP.id}-mapPin {
    position: absolute !important;
    z-index: 24 !important;
    transform: translate(-50%, -100%) translateY(-3px) !important;
    pointer-events: none !important;
    display: inline-flex !important;
    flex-direction: column-reverse !important;
    align-items: center !important;
    justify-content: flex-start !important;
    gap: 1px !important;
}

.${APP.id}-pinIcon,
.${APP.id}-badge,
.${APP.id}-miniDot {
    background: var(--tp-marker-color, ${APP.defaultColor}) !important;
}

.${APP.id}-pinIcon {
    position: relative !important;
    width: 17px !important;
    height: 17px !important;
    display: inline-block !important;
    flex: 0 0 17px !important;
    border: 2px solid #fff !important;
    border-radius: 50% 50% 50% 0 !important;
    box-shadow: 0 0 0 1px #2b120b, 0 2px 4px rgba(0,0,0,.72) !important;
    transform: rotate(-45deg) !important;
    transform-origin: 50% 50% !important;
    box-sizing: border-box !important;
}

.${APP.id}-pinIcon::after {
    content: "" !important;
    position: absolute !important;
    left: 4px !important;
    top: 4px !important;
    width: 5px !important;
    height: 5px !important;
    border-radius: 50% !important;
    background: #fff !important;
    box-shadow: 0 0 0 1px rgba(38,17,8,.7) !important;
}

.${APP.id}-pinLabel {
    display: inline-flex !important;
    align-items: center !important;
    gap: 3px !important;
    padding: 2px 4px !important;
    border: 1px solid #b77718 !important;
    border-radius: 2px !important;
    background: #fff1bd !important;
    color: #321b08 !important;
    font: bold 12px Arial, sans-serif !important;
    line-height: 13px !important;
    text-shadow: 0 1px rgba(255,255,255,.8) !important;
    box-shadow: 0 1px 2px rgba(0,0,0,.45) !important;
    white-space: nowrap !important;
}

.${APP.id}-pinBonusIcon {
    width: 14px !important;
    height: 14px !important;
}

.${APP.id}-badge,
.${APP.id}-zoneBadge {
    position: absolute !important;
    z-index: 24 !important;
    transform: translate(-50%, -100%) !important;
    padding: 1px 4px !important;
    border-radius: 3px !important;
    color: #fff !important;
    font: bold 11px Arial, sans-serif !important;
    text-shadow: 0 1px #000 !important;
    pointer-events: none !important;
    box-shadow: 0 1px 4px rgba(0,0,0,.55) !important;
}

.${APP.id}-zoneBadge {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 20px !important;
    height: 20px !important;
    padding: 0 !important;
    border: 2px solid #fff !important;
    border-radius: 50% !important;
    background: var(--tp-zone-color, ${APP.defaultColor}) !important;
    color: #fff !important;
    font: bold 14px/20px Arial, sans-serif !important;
    -webkit-text-stroke: 1px #000 !important;
    paint-order: stroke fill !important;
    text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000 !important;
    box-shadow: 0 0 0 1px #111, 0 2px 4px rgba(0,0,0,.65) !important;
    box-sizing: border-box !important;
}

.${APP.id}-playerBadge {
    position: absolute !important;
    z-index: 25 !important;
    transform: translate(-50%, -50%) !important;
    max-width: 150px !important;
    padding: 2px 5px !important;
    border: 2px solid #fff !important;
    border-radius: 4px !important;
    background: var(--tp-player-color, #315fbd) !important;
    color: #fff !important;
    font: bold 12px/14px Arial, sans-serif !important;
    text-align: center !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000 !important;
    box-shadow: 0 0 0 1px #111, 0 2px 5px rgba(0,0,0,.7) !important;
    pointer-events: none !important;
}

.${APP.id}-minimapOverlay,
.${APP.id}-mainOverlay {
    position: absolute !important;
    inset: 0 !important;
    z-index: 20 !important;
    pointer-events: none !important;
}

.${APP.id}-miniDot {
    position: absolute !important;
    width: 10px !important;
    height: 10px !important;
    border: 1px solid #fff !important;
    border-radius: 50% 50% 50% 0 !important;
    transform: translate(-50%, -121%) rotate(-45deg) !important;
    transform-origin: 50% 50% !important;
    box-shadow: 0 0 0 1px #211, 0 1px 3px rgba(0,0,0,.6) !important;
    box-sizing: border-box !important;
}

/* Painel clássico do Marcador — independente da barra de atalhos. */
.${APP.id}-native {
    width: 100% !important;
    height: 86vh !important;
    max-height: 86vh !important;
    max-width: none !important;
    color: #5b270b !important;
    font: 12px Verdana, Arial, sans-serif !important;
}

.${APP.id}-frame {
    display: flex !important;
    flex-direction: column !important;
    width: 100% !important;
    height: 100% !important;
    max-height: 100% !important;
    border: 2px solid #8f1c16 !important;
    border-radius: 3px !important;
    background: #f6e6b9 !important;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.55) !important;
    overflow: hidden !important;
}

.${APP.id}-head {
    flex: 0 0 auto !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 2px !important;
    padding: 10px 14px 9px !important;
    border-bottom: 1px solid #d4a052 !important;
    background: linear-gradient(to bottom, #faedc5, #efd49a) !important;
}

.${APP.id}-head strong {
    color: #a5231c !important;
    font-size: 17px !important;
}

.${APP.id}-head span { color: #6c330f !important; }

.${APP.id}-content {
    flex: 1 1 auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    padding: 6px 12px 12px !important;
    scrollbar-color: #9a784a #f5e7bd !important;
}

.${APP.id}-section {
    display: grid !important;
    grid-template-columns: 285px minmax(0, 1fr) !important;
    gap: 12px !important;
    padding: 9px 10px !important;
    border-bottom: 1px solid #dfbd79 !important;
    border-left: 4px solid #be3028 !important;
    background: rgba(255,247,216,.18) !important;
    box-sizing: border-box !important;
    min-width: 0 !important;
}

.${APP.id}-section > * { min-width: 0 !important; }

.${APP.id}-toolsSection { border-left-color: #9135d2 !important; }
.${APP.id}-secondarySection { border-left-color: #f4b400 !important; }
.${APP.id}-tribePlayersSection { border-left-color: #315fbd !important; }
.${APP.id}-zonesSection { border-left-color: #00a78e !important; }
.${APP.id}-supportSection { border-left-color: #00a9d6 !important; }
.${APP.id}-attackSection { border-left-color: #ed251d !important; }
.${APP.id}-bonusSection { border-left-color: #18a33a !important; }
.${APP.id}-actionsSection { border-left-color: #8a5a16 !important; border-bottom: 0 !important; }

.${APP.id}-section h3 {
    margin: 0 0 4px !important;
    color: #a5231c !important;
    font: bold 14px Georgia, "Times New Roman", serif !important;
    text-transform: uppercase !important;
}

.${APP.id}-section p { margin: 0 !important; line-height: 1.25 !important; }

.${APP.id}-coordsInput {
    width: 100% !important;
    min-height: 190px !important;
    resize: vertical !important;
    padding: 6px 8px !important;
    border: 1px solid #7d5a2b !important;
    border-radius: 2px !important;
    background: #fffdf3 !important;
    color: #111 !important;
    font: 13px Consolas, "Courier New", monospace !important;
    box-sizing: border-box !important;
}

.${APP.id}-secondaryInput {
    width: 100% !important;
    min-height: 95px !important;
    resize: vertical !important;
    padding: 6px 8px !important;
    border: 1px solid #b07b13 !important;
    border-radius: 2px !important;
    background: #fff9dc !important;
    color: #111 !important;
    font: 13px Consolas, "Courier New", monospace !important;
    box-sizing: border-box !important;
}

.${APP.id}-tribeQuery {
    width: min(520px, 100%) !important;
    min-height: 29px !important;
    padding: 4px 7px !important;
    border: 1px solid #86612d !important;
    background: #fff9df !important;
    box-sizing: border-box !important;
}

.${APP.id}-secondaryStar {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 20px !important;
    height: 20px !important;
    flex: 0 0 20px !important;
    color: var(--tp-marker-color, #f4b400) !important;
    font: bold 22px/20px Arial, sans-serif !important;
    text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff, 0 2px 3px #231305 !important;
}

.${APP.id}-miniDot.tp-secondary {
    width: 13px !important;
    height: 13px !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    color: #f4b400 !important;
    font: bold 14px/13px Arial, sans-serif !important;
    text-align: center !important;
    text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff, 0 1px 2px #000 !important;
    box-shadow: none !important;
    transform: translate(-50%, -50%) !important;
}

.${APP.id}-tools {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 8px !important;
}

.${APP.id}-tool {
    padding: 7px !important;
    border: 1px solid #b68c51 !important;
    background: rgba(232,210,162,.52) !important;
    box-sizing: border-box !important;
}

.${APP.id}-toolTitle {
    display: block !important;
    margin-bottom: 5px !important;
    color: #5d260b !important;
    font-weight: bold !important;
}

.${APP.id}-toolLine,
.${APP.id}-optionsRow,
.${APP.id}-enableRow {
    display: flex !important;
    align-items: center !important;
    flex-wrap: wrap !important;
    gap: 7px !important;
}

.${APP.id}-enableRow {
    margin: -7px -7px 7px !important;
    padding: 6px 8px !important;
    border-bottom: 1px solid #b68c51 !important;
    background: #dec58d !important;
}

.${APP.id}-enableLabel { color: #8e211a !important; font-weight: bold !important; }

.${APP.id}-tool input[type="number"] { width: 64px !important; }
.${APP.id}-tool input[type="color"] { width: 48px !important; height: 27px !important; padding: 2px !important; }

.${APP.id}-tool input[type="number"],
.${APP.id}-tool select,
.${APP.id}-toolLine select {
    min-height: 27px !important;
    border: 1px solid #b1783f !important;
    background: #fff8df !important;
    color: #321708 !important;
}

.${APP.id}-content button {
    min-height: 28px !important;
    padding: 3px 10px !important;
    border: 1px solid #54200f !important;
    border-radius: 2px !important;
    background: linear-gradient(to bottom, #9d5631, #6e2e18) !important;
    box-shadow: inset 0 1px rgba(255,255,255,.22) !important;
    color: #fff !important;
    font-weight: bold !important;
    cursor: pointer !important;
}

.${APP.id}-content button:hover { filter: brightness(1.12) !important; }
.${APP.id}-content button:disabled { opacity: .55 !important; cursor: wait !important; }

.${APP.id}-zonesSection:not(.tp-visible) { display: none !important; }
.${APP.id}-zonesOutput {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 7px !important;
}

.${APP.id}-zoneCard { border: 2px solid var(--tp-zone-color, #b8322a) !important; background: #fff4cf !important; }
.${APP.id}-zoneHead {
    display: flex !important;
    justify-content: space-between !important;
    gap: 8px !important;
    padding: 4px 7px !important;
    background: var(--tp-zone-color, #b8322a) !important;
    color: #fff !important;
    font-weight: bold !important;
}
.${APP.id}-zoneCard textarea {
    width: 100% !important;
    min-height: 58px !important;
    padding: 5px !important;
    border: 0 !important;
    background: #fff7dc !important;
    color: #251308 !important;
    font: 12px Consolas, monospace !important;
    box-sizing: border-box !important;
}

.${APP.id}-bonusOptions {
    display: grid !important;
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
    gap: 6px 14px !important;
    margin-bottom: 7px !important;
}

.${APP.id}-actionsSection { align-items: center !important; }
.tp-actions { display: flex !important; justify-content: flex-end !important; gap: 9px !important; }
.${APP.id}-content .tp-secondary { background: linear-gradient(to bottom, #fff5d8, #e8cea0) !important; color: #4b210d !important; }
.${APP.id}-content .tp-save { min-width: 145px !important; }
.${APP.id}-attackLegend { display: flex !important; flex-wrap: wrap !important; gap: 9px !important; margin: 6px 0 !important; }
.${APP.id}-attackLegend span { display: inline-flex !important; align-items: center !important; gap: 4px !important; }
.${APP.id}-attackLegend i { width: 10px !important; height: 10px !important; border: 1px solid #fff !important; border-radius: 50% !important; box-shadow: 0 0 0 1px #4b260d !important; }
.${APP.id}-attackLegend .tp-going { background: #d71920 !important; }
.${APP.id}-attackLegend .tp-returning { background: #f59e0b !important; }
.${APP.id}-attackLegend .tp-both { background: linear-gradient(90deg,#d71920 0 50%,#f59e0b 50% 100%) !important; }

#${APP.id}-panel {
    position: fixed !important;
    inset: 0 !important;
    z-index: ${APP.zIndex + 20} !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 18px !important;
    background: rgba(0,0,0,.48) !important;
}
#${APP.id}-panel .tp-card { width: min(1280px, calc(100vw - 42px)) !important; }
#${APP.id}-panel .tp-head { display: flex !important; justify-content: space-between !important; padding: 6px 9px !important; background: #7d351d !important; color: #fff !important; font-weight: bold !important; }
#${APP.id}-panel .tp-close { min-width: 27px !important; padding: 0 !important; }

#popup_box_${APP.id}Dialog,
#popup_box_${APP.id}Dialog .popup_box_container,
#popup_box_${APP.id}Dialog .popup_box_content {
    width: min(1320px, calc(100vw - 34px)) !important;
    max-width: min(1320px, calc(100vw - 34px)) !important;
    box-sizing: border-box !important;
}

#popup_box_${APP.id}Dialog .popup_box_container,
#popup_box_${APP.id}Dialog .popup_box_content {
    height: 88vh !important;
    max-height: 88vh !important;
}

#popup_box_${APP.id}Dialog,
#popup_box_${APP.id}Dialog .popup_box_container,
#popup_box_${APP.id}Dialog .popup_box_content {
    overflow: hidden !important;
}
#popup_box_${APP.id}Dialog { z-index: ${APP.zIndex + 100} !important; }

@media (max-width: 900px) {
    .${APP.id}-section { grid-template-columns: 1fr !important; }
    .${APP.id}-tools, .${APP.id}-zonesOutput { grid-template-columns: 1fr !important; }
    .${APP.id}-bonusOptions { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
}
`;
        (document.head || document.documentElement).appendChild(style);
        applyPanelStylesheet(style.textContent);
    }

    function applyPanelStylesheet(cssText) {
        if (!("adoptedStyleSheets" in document) || typeof CSSStyleSheet !== "function") return;
        if (document.adoptedStyleSheets.some((sheet) => sheet.__tpMapMarkerStyles)) return;
        try {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(String(cssText || ""));
            Object.defineProperty(sheet, "__tpMapMarkerStyles", { value: true });
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        } catch (_) {
            // O elemento style com nonce fica como alternativa em browsers antigos.
        }
    }

    function ensureTpScriptBar(doc = document) {
        if (!doc || !doc.body) return null;

        let bar = doc.getElementById("tp-theplaguept-script-bar");

        if (!bar) {
            bar = doc.createElement("div");
            bar.id = "tp-theplaguept-script-bar";
            bar.setAttribute("aria-label", "Botoes ThePlaguePT");
            (doc.body || doc.documentElement).appendChild(bar);
        }

        return bar;
    }

    function attachToTpScriptBar(element, doc = document) {
        const bar = ensureTpScriptBar(doc);
        if (!bar || !element) return;

        element.classList.add("tp-theplaguept-script-bar-item");
        element.setAttribute("data-tp-title", element.getAttribute("data-tp-title") || element.getAttribute("aria-label") || APP.displayTitle);
        bar.appendChild(element);
    }

    function createLauncher() {
        document.getElementById(`${APP.id}-launcher`)?.remove();

        const button = document.createElement("button");
        button.id = `${APP.id}-launcher`;
        button.type = "button";
        button.title = APP.displayTitle;
        button.setAttribute("aria-label", APP.displayTitle);
        button.setAttribute("data-tp-title", APP.displayTitle);
        button.innerHTML = `<span class="${APP.id}-launcherIcon" aria-hidden="true"></span><span class="${APP.id}-launcherLabel">${escapeHtml(APP.displayTitle)}</span>`;
        button.addEventListener("click", openPanel);
        document.body.appendChild(button);
        attachToTpScriptBar(button);
        state.launcher = button;
        setupLauncherPosition();
    }

    function getMapToggleHost() {
        const candidates = [
            document.querySelector("#map_wrap"),
            document.querySelector("#map_container"),
            document.querySelector("#map")?.parentElement,
            document.querySelector("#map"),
            document.querySelector("#content_value")
        ].filter(Boolean);

        const host = candidates.find((element) =>
            element.id === "map_wrap" ||
            element.id === "map_container" ||
            element.id === "map" ||
            element.querySelector?.("#map,[id^='map_village_'],img[id*='village']")
        ) || null;

        if (host && getComputedStyle(host).position === "static") host.style.position = "relative";
        return host;
    }

    function getMapToolbar() {
        const host = getMapToggleHost();
        if (!host) return null;

        let toolbar = document.getElementById(`${APP.id}-mapToolbar`);

        if (!toolbar || toolbar.parentElement !== host) {
            toolbar?.remove();
            toolbar = document.createElement("div");
            toolbar.id = `${APP.id}-mapToolbar`;
            toolbar.setAttribute("aria-label", "Ferramentas do marcador no mapa");
            host.appendChild(toolbar);
        }

        toolbar.style.setProperty("display", "flex", "important");
        toolbar.style.setProperty("visibility", "visible", "important");
        toolbar.style.setProperty("opacity", "1", "important");
        toolbar.style.setProperty("z-index", String(APP.zIndex + 2), "important");
        state.mapToolbar = toolbar;
        return toolbar;
    }

    function createMapToolbarButtons() {
        if (!getMapToolbar()) return false;

        createMapToggle();
        createSecondaryMapToggle();
        createTribePlayersMapToggle();
        createBonusMapToggle();
        createSupportMapToggle();
        createSupportTravelMapToggle();
        createAttackMapToggle();

        return true;
    }

    function createMapToggle() {
        document.getElementById(`${APP.id}-mapToggle`)?.remove();
        const toolbar = getMapToolbar();
        if (!toolbar) return;
        const button = document.createElement("button");
        button.id = `${APP.id}-mapToggle`;
        button.type = "button";
        button.innerHTML = `<span class="tp-togglePin" aria-hidden="true"></span>`;
        button.addEventListener("click", () => {
            state.coordinatesEnabled = !state.coordinatesEnabled;
            save();
            updateMapToggle();
            const checkbox = state.panel?.querySelector(".tp-enabled");
            if (checkbox) checkbox.checked = state.coordinatesEnabled;
            refreshMarkers(true);
            notify(state.coordinatesEnabled ? "Marcações por coordenadas ativadas." : "Marcações por coordenadas desativadas.");
        });
        toolbar.appendChild(button);
        state.mapToggle = button;
        updateMapToggle();
    }

    function updateMapToggle() {
        const button = state.mapToggle || document.getElementById(`${APP.id}-mapToggle`);
        if (!button) return;
        button.classList.toggle("tp-off", !state.coordinatesEnabled);
        button.title = state.coordinatesEnabled ? "Desligar marcações por coordenadas" : "Ligar marcações por coordenadas";
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-pressed", String(state.coordinatesEnabled));
    }

    function createSecondaryMapToggle() {
        document.getElementById(`${APP.id}-secondaryMapToggle`)?.remove();
        const toolbar = getMapToolbar();
        if (!toolbar) return;
        const button = document.createElement("button");
        button.id = `${APP.id}-secondaryMapToggle`;
        button.type = "button";
        button.innerHTML = `<span class="tp-toggleSecondary" aria-hidden="true">★</span>`;
        button.addEventListener("click", () => {
            state.secondaryEnabled = !state.secondaryEnabled;
            const checkbox = state.panel?.querySelector(".tp-secondary-enabled");
            if (checkbox) checkbox.checked = state.secondaryEnabled;
            save();
            updateSecondaryMapToggle();
            refreshMarkers(true);
            notify(state.secondaryEnabled ? "Marcador secundário ativado." : "Marcador secundário desativado.");
        });
        toolbar.appendChild(button);
        state.secondaryMapToggle = button;
        updateSecondaryMapToggle();
    }

    function updateSecondaryMapToggle() {
        const button = state.secondaryMapToggle || document.getElementById(`${APP.id}-secondaryMapToggle`);
        if (!button) return;
        button.classList.toggle("tp-off", !state.secondaryEnabled);
        button.title = state.secondaryEnabled ? "Desligar marcador secundário" : "Ligar marcador secundário";
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-pressed", String(state.secondaryEnabled));
        const quickCount = document.querySelector(`#${APP.id}-secondaryQuickBox .tp-secondary-quick-count`);
        if (quickCount) quickCount.textContent = String(state.secondaryCoords.size);
        createSecondaryQuickBox();
        layoutMapSidePanels();
    }

    function createSecondaryQuickBox() {
        document.getElementById(`${APP.id}-secondaryQuickBox`)?.remove();
        state.secondaryQuickBox = null;
        if (!state.secondaryEnabled) return;
        const host = getMapToggleHost();
        if (!host) return;
        const box = document.createElement("div");
        box.id = `${APP.id}-secondaryQuickBox`;
        box.innerHTML = `
            <div class="${APP.id}-secondaryQuickHead"><span>★ Marcador secundário</span><small class="tp-secondary-quick-count">${state.secondaryCoords.size}</small></div>
            <textarea class="${APP.id}-secondaryQuickInput" spellcheck="false" placeholder="500|500  501|502"></textarea>
            <div class="${APP.id}-secondaryQuickFoot"><span>Acrescentar coordenadas</span><button type="button">Adicionar</button></div>`;
        const input = box.querySelector(`.${APP.id}-secondaryQuickInput`);
        box.querySelector("button").addEventListener("click", () => {
            const additions = parseCoordinates(input.value);
            if (!additions.size) return notify("Não foram encontradas coordenadas válidas.");
            additions.forEach((item, key) => state.secondaryCoords.set(key, item));
            state.secondaryEnabled = true;
            input.value = "";
            box.querySelector(".tp-secondary-quick-count").textContent = String(state.secondaryCoords.size);
            const panelInput = state.panel?.querySelector(`.${APP.id}-secondaryInput`);
            if (panelInput) panelInput.value = [...state.secondaryCoords.values()].map(({ x, y }) => `${x}|${y}`).join("\n");
            const panelCheckbox = state.panel?.querySelector(".tp-secondary-enabled");
            if (panelCheckbox) panelCheckbox.checked = true;
            const panelCount = state.panel?.querySelector(".tp-secondary-count");
            if (panelCount) panelCount.textContent = `${state.secondaryCoords.size} aldeia(s)`;
            save();
            updateSecondaryMapToggle();
            refreshMarkers(true);
            notify(`${additions.size} coordenada(s) adicionada(s) ao marcador secundário.`);
        });
        input.addEventListener("keydown", (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") box.querySelector("button").click();
        });
        host.appendChild(box);
        state.secondaryQuickBox = box;
    }

    function createTribePlayersMapToggle() {
        document.getElementById(`${APP.id}-tribePlayersMapToggle`)?.remove();
        const toolbar = getMapToolbar();
        if (!toolbar) return;
        const button = document.createElement("button");
        button.id = `${APP.id}-tribePlayersMapToggle`;
        button.type = "button";
        button.innerHTML = `<span class="tp-toggleTribePlayers" aria-hidden="true">♟</span>`;
        button.addEventListener("click", async () => {
            state.tribePlayersEnabled = !state.tribePlayersEnabled;
            const checkbox = state.panel?.querySelector(".tp-tribe-enabled");
            if (checkbox) checkbox.checked = state.tribePlayersEnabled;
            if (state.tribePlayersEnabled && state.tribeQuery.trim()) {
                try { await loadTribePlayerVillages(); }
                catch (error) {
                    notify(`Não foi possível carregar jogadores/tribos: ${error.message}`);
                }
            }
            save();
            updateTribePlayersMapToggle();
            refreshMarkers(true);
        });
        toolbar.appendChild(button);
        state.tribePlayersMapToggle = button;
        updateTribePlayersMapToggle();
    }

    function updateTribePlayersMapToggle() {
        const button = state.tribePlayersMapToggle || document.getElementById(`${APP.id}-tribePlayersMapToggle`);
        if (!button) return;
        button.classList.toggle("tp-off", !state.tribePlayersEnabled);
        button.title = state.tribePlayersEnabled ? "Desligar marcador de jogador/tribo" : "Ligar marcador de jogador/tribo";
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-pressed", String(state.tribePlayersEnabled));
        createTribeQuickBox();
        renderTribePlayerFilter();
        layoutMapSidePanels();
    }

    function createTribeQuickBox() {
        document.getElementById(`${APP.id}-tribeQuickBox`)?.remove();
        state.tribeQuickBox = null;
        if (!state.tribePlayersEnabled) return;
        const host = getMapToggleHost();
        if (!host) return;
        const box = document.createElement("div");
        box.id = `${APP.id}-tribeQuickBox`;
        box.innerHTML = `
            <div class="${APP.id}-tribeQuickHead">♟ Marcador de Jogador/Tribo</div>
            <div class="${APP.id}-tribeQuickLine"><input class="${APP.id}-tribeQuickInput" type="text" value="${escapeHtml(state.tribeQuery)}" placeholder="Jogador, tag ou tribo"><button type="button">Marcar</button></div>`;
        const input = box.querySelector(`.${APP.id}-tribeQuickInput`);
        const apply = async () => {
            const query = input.value.trim();
            if (!query) return notify("Indica um nome de jogador, tag ou nome de tribo.");
            const button = box.querySelector("button");
            button.disabled = true;
            button.textContent = "…";
            state.tribeQuery = query;
            state.tribePlayersEnabled = true;
            try {
                await loadTribePlayerVillages(true);
                save();
                const panelInput = state.panel?.querySelector(`.${APP.id}-tribeQuery`);
                if (panelInput) panelInput.value = query;
                const panelCheckbox = state.panel?.querySelector(".tp-tribe-enabled");
                if (panelCheckbox) panelCheckbox.checked = true;
                const panelCount = state.panel?.querySelector(".tp-tribe-count");
                if (panelCount) panelCount.textContent = `${state.tribePlayerGroups.length} jogador(es), ${state.tribeCoords.size} aldeia(s)`;
                updateTribePlayersMapToggle();
                refreshMarkers(true);
                notify(`${state.tribePlayerGroups.length} jogador(es) marcados.`);
            } catch (error) {
                notify(`Não foi possível carregar jogadores/tribos: ${error.message}`);
            } finally {
                button.disabled = false;
                button.textContent = "Marcar";
            }
        };
        box.querySelector("button").addEventListener("click", apply);
        input.addEventListener("keydown", (event) => { if (event.key === "Enter") apply(); });
        host.appendChild(box);
        state.tribeQuickBox = box;
    }

    function layoutMapSidePanels() {
        let top = 50;
        const secondary = document.getElementById(`${APP.id}-secondaryQuickBox`);
        const tribeQuick = document.getElementById(`${APP.id}-tribeQuickBox`);
        const playerFilter = document.getElementById(`${APP.id}-tribePlayerFilter`);
        for (const element of [secondary, tribeQuick, playerFilter]) {
            if (!element) continue;
            element.style.setProperty("top", `${top}px`, "important");
            top += element.offsetHeight + 6;
        }
    }

    function renderTribePlayerFilter() {
        document.getElementById(`${APP.id}-tribePlayerFilter`)?.remove();
        state.tribePlayerFilter = null;
        if (!state.tribePlayersEnabled || !state.tribePlayerGroups.length) return;
        const host = getMapToggleHost();
        if (!host) return;
        const panel = document.createElement("div");
        panel.id = `${APP.id}-tribePlayerFilter`;
        panel.innerHTML = `
            <div class="${APP.id}-playerFilterHead">
                <span>Jogadores (${state.tribePlayerGroups.length})</span>
                <span class="${APP.id}-playerFilterActions"><button type="button" data-action="all" title="Ligar todos">Todos</button><button type="button" data-action="none" title="Desligar todos">Nenhum</button></span>
            </div>
            <div class="${APP.id}-playerFilterList">${state.tribePlayerGroups.map((player) => `
                <label class="${APP.id}-playerFilterItem" title="${escapeHtml(player.name)} — ${player.villages.length} aldeia(s)">
                    <input type="checkbox" data-player-id="${player.id}" ${isTribePlayerVisible(player) ? "checked" : ""}>
                    <i class="${APP.id}-playerFilterColor" style="--tp-player-color:${player.color}"></i>
                    <span class="${APP.id}-playerFilterName">${escapeHtml(player.name)}</span>
                    <small class="${APP.id}-playerFilterCount">${player.villages.length}</small>
                </label>`).join("")}</div>`;
        panel.addEventListener("change", (event) => {
            const checkbox = event.target.closest("input[data-player-id]");
            if (!checkbox) return;
            const id = Number(checkbox.dataset.playerId);
            if (checkbox.checked) state.disabledTribePlayerIds.delete(id);
            else state.disabledTribePlayerIds.add(id);
            save();
            refreshMarkers(true);
        });
        panel.addEventListener("click", (event) => {
            const action = event.target.closest("button[data-action]")?.dataset.action;
            if (!action) return;
            if (action === "all") state.disabledTribePlayerIds.clear();
            else state.tribePlayerGroups.forEach((player) => state.disabledTribePlayerIds.add(Number(player.id)));
            panel.querySelectorAll("input[data-player-id]").forEach((checkbox) => { checkbox.checked = action === "all"; });
            save();
            refreshMarkers(true);
        });
        host.appendChild(panel);
        state.tribePlayerFilter = panel;
        layoutMapSidePanels();
    }

    function createBonusMapToggle() {
        document.getElementById(`${APP.id}-bonusMapToggle`)?.remove();
        const toolbar = getMapToolbar();
        if (!toolbar) return;
        const button = document.createElement("button");
        button.id = `${APP.id}-bonusMapToggle`;
        button.type = "button";
        button.innerHTML = `<span class="tp-toggleBonus" aria-hidden="true">★</span>`;
        button.addEventListener("click", async () => {
            state.bonusEnabled = !state.bonusEnabled;
            if (state.bonusEnabled && !state.bonusTypes.length) {
                state.bonusEnabled = false;
                updateBonusMapToggle();
                notify("Seleciona primeiro os tipos de aldeias bónus no painel.");
                return;
            }
            const checkbox = state.panel?.querySelector(".tp-bonus-enabled");
            if (checkbox) checkbox.checked = state.bonusEnabled;
            if (state.bonusEnabled && state.bonusTypes.length) {
                try { await loadBonusBarbarians(); } catch (error) { notify(`Não foi possível analisar os bónus: ${error.message}`); }
            }
            save();
            updateBonusMapToggle();
            refreshMarkers(true);
            notify(state.bonusEnabled ? "Marcações de bárbaras bónus ativadas." : "Marcações de bárbaras bónus desativadas.");
        });
        toolbar.appendChild(button);
        state.bonusMapToggle = button;
        updateBonusMapToggle();
    }

    function updateBonusMapToggle() {
        const button = state.bonusMapToggle || document.getElementById(`${APP.id}-bonusMapToggle`);
        if (!button) return;
        button.classList.toggle("tp-off", !state.bonusEnabled);
        button.title = state.bonusEnabled ? "Desligar marcações de bárbaras bónus" : "Ligar marcações de bárbaras bónus";
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-pressed", String(state.bonusEnabled));
    }

    function createSupportMapToggle() {
        document.getElementById(`${APP.id}-supportMapToggle`)?.remove();
        const toolbar = getMapToolbar();
        if (!toolbar) return;
        const button = document.createElement("button");
        button.id = `${APP.id}-supportMapToggle`;
        button.type = "button";
        button.innerHTML = `<span class="tp-toggleSupport" aria-hidden="true">◆</span>`;
        button.addEventListener("click", async () => {
            state.supportEnabled = !state.supportEnabled;
            const checkbox = state.panel?.querySelector(".tp-support-enabled");
            if (checkbox) checkbox.checked = state.supportEnabled;
            if (state.supportEnabled) {
                try { await loadSupportedVillages(true); } catch (error) { notify(`Não foi possível carregar os apoios: ${error.message}`); }
            }
            save();
            updateSupportMapToggle();
            refreshMarkers(true);
            notify(state.supportEnabled ? "Marcações de tropas em apoio ativadas." : "Marcações de tropas em apoio desativadas.");
        });
        toolbar.appendChild(button);
        state.supportMapToggle = button;
        updateSupportMapToggle();
    }

    function updateSupportMapToggle() {
        const button = state.supportMapToggle || document.getElementById(`${APP.id}-supportMapToggle`);
        if (!button) return;
        button.classList.toggle("tp-off", !state.supportEnabled);
        button.title = state.supportEnabled ? "Desligar marcações de tropas em apoio" : "Ligar marcações de tropas em apoio";
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-pressed", String(state.supportEnabled));
    }

    function createSupportTravelMapToggle() {
        document.getElementById(`${APP.id}-supportTravelMapToggle`)?.remove();
        const toolbar = getMapToolbar();
        if (!toolbar) return;
        const button = document.createElement("button");
        button.id = `${APP.id}-supportTravelMapToggle`;
        button.type = "button";
        button.innerHTML = `<span class="tp-toggleSupportTravel" aria-hidden="true">➜</span>`;
        button.addEventListener("click", async () => {
            state.supportTravelEnabled = !state.supportTravelEnabled;
            const checkbox = state.panel?.querySelector(".tp-support-travel-enabled");
            if (checkbox) checkbox.checked = state.supportTravelEnabled;
            if (state.supportTravelEnabled) {
                try { await loadTravelingSupportVillages(true); } catch (error) { notify(`Não foi possível carregar os apoios a caminho: ${error.message}`); }
            }
            save();
            updateSupportTravelMapToggle();
            refreshMarkers(true);
            notify(state.supportTravelEnabled ? "Marcações de apoios a caminho ativadas." : "Marcações de apoios a caminho desativadas.");
        });
        toolbar.appendChild(button);
        state.supportTravelMapToggle = button;
        updateSupportTravelMapToggle();
    }

    function updateSupportTravelMapToggle() {
        const button = state.supportTravelMapToggle || document.getElementById(`${APP.id}-supportTravelMapToggle`);
        if (!button) return;
        button.classList.toggle("tp-off", !state.supportTravelEnabled);
        button.title = state.supportTravelEnabled ? "Desligar marcações de apoios a caminho" : "Ligar marcações de apoios a caminho";
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-pressed", String(state.supportTravelEnabled));
    }

    function createAttackMapToggle() {
        document.getElementById(`${APP.id}-attackMapToggle`)?.remove();
        const toolbar = getMapToolbar();
        if (!toolbar) return;
        const button = document.createElement("button");
        button.id = `${APP.id}-attackMapToggle`;
        button.type = "button";
        button.innerHTML = `<span class="tp-toggleAttack" aria-hidden="true">⚔</span>`;
        button.addEventListener("click", async () => {
            state.attackEnabled = !state.attackEnabled;
            const checkbox = state.panel?.querySelector(".tp-attack-enabled");
            if (checkbox) checkbox.checked = state.attackEnabled;
            if (state.attackEnabled) {
                try { await loadAttackedVillages(true); } catch (error) { notify(`Não foi possível carregar os ataques: ${error.message}`); }
            }
            save();
            updateAttackMapToggle();
            refreshMarkers(true);
            notify(state.attackEnabled ? "Marcações de aldeias atacadas ativadas." : "Marcações de aldeias atacadas desativadas.");
        });
        toolbar.appendChild(button);
        state.attackMapToggle = button;
        updateAttackMapToggle();
    }

    function updateAttackMapToggle() {
        const button = state.attackMapToggle || document.getElementById(`${APP.id}-attackMapToggle`);
        if (!button) return;
        button.classList.toggle("tp-off", !state.attackEnabled);
        button.title = state.attackEnabled ? "Desligar marcações de aldeias atacadas" : "Ligar marcações de aldeias atacadas";
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-pressed", String(state.attackEnabled));
    }

    function setupLauncherPosition() {
        const schedule = () => {
            cancelAnimationFrame(state.launcherPositionFrame);
            state.launcherPositionFrame = requestAnimationFrame(positionLauncher);
        };
        schedule();
        addEventListener("resize", schedule, { passive: true });
        setTimeout(positionLauncher, 250);
        setTimeout(positionLauncher, 1000);
    }

    function positionLauncher() {
        if (!state.launcher) return;
        if (state.launcher.closest("#tp-theplaguept-script-bar")) return;
        const layout = document.querySelector("#main_layout td.maincell,td.maincell,#contentContainer,#content_value");
        if (!layout) return;
        const rect = layout.getBoundingClientRect();
        if (rect.width > 0) state.launcher.style.setProperty("left", `${Math.max(4, Math.round(rect.left - 55))}px`, "important");
    }

    function openPanel() {
        injectStyles();
        if (state.panel) closePanel();
        const coordinates = [...state.coords.values()].map(({ x, y }) => `${x}|${y}`).join("\n");
        const secondaryCoordinates = [...state.secondaryCoords.values()].map(({ x, y }) => `${x}|${y}`).join("\n");
        const body = `
            <div class="${APP.id}-frame">
                <header class="${APP.id}-head"><strong>TW PT - Marcador de Aldeias ThePlaguePT v${APP.version}</strong><span>Marca, filtra e organiza coordenadas do mundo ${escapeHtml(world)} por proximidade e zonas.</span></header>
                <div class="${APP.id}-content">
                    <section class="${APP.id}-section ${APP.id}-coordsSection">
                        <div><h3>Coordenadas</h3><p>Cola coordenadas em qualquer texto. Repetidas são removidas automaticamente.</p></div>
                        <div><div class="${APP.id}-tool"><div class="${APP.id}-enableRow"><label class="${APP.id}-enableLabel"><input class="tp-enabled" type="checkbox" ${state.coordinatesEnabled ? "checked" : ""}> Ativar marcação da lista de coordenadas</label></div><div class="${APP.id}-optionsRow"><label>Cor base <input class="tp-color" type="color" value="${state.color}"></label><label><input class="tp-labels" type="checkbox" ${state.showLabels ? "checked" : ""}> Mostrar coordenada no mapa</label><strong class="tp-count">${state.coords.size} aldeia(s)</strong></div></div><textarea class="${APP.id}-coordsInput" spellcheck="false" placeholder="500|500\n501|502\n498|507">${escapeHtml(coordinates)}</textarea></div>
                    </section>
                    <section class="${APP.id}-section ${APP.id}-toolsSection">
                        <div><h3>Filtros e zonas</h3><p>Reduz a lista por distância e cria grupos geográficos limitados.</p></div>
                        <div class="${APP.id}-tools">
                            <div class="${APP.id}-tool"><span class="${APP.id}-toolTitle">Distância às minhas aldeias</span><div class="${APP.id}-toolLine"><span>Máximo</span><input class="tp-distance" type="number" min="1" max="200" step="1" value="${state.distance}"><span>campos</span><button class="tp-filter" type="button">Filtrar lista</button></div></div>
                            <div class="${APP.id}-tool"><span class="${APP.id}-toolTitle">Zonas geográficas</span><div class="${APP.id}-toolLine"><span>Máximo</span><select class="tp-zone-size">${ZONE_SIZES.map((size) => `<option value="${size}" ${state.zoneSize === size ? "selected" : ""}>${size} aldeias</option>`).join("")}</select><button class="tp-zones" type="button">Criar zonas</button><label><input class="tp-zones-enabled" type="checkbox" ${state.zonesEnabled ? "checked" : ""}> Mostrar zonas no mapa</label></div></div>
                        </div>
                    </section>
                    <section class="${APP.id}-section ${APP.id}-zonesSection ${state.zones.length ? "tp-visible" : ""}">
                        <div><h3>Zonas</h3><p>Uma caixa independente por zona, ordenada da mais próxima para a mais distante.</p></div>
                        <div class="${APP.id}-zonesOutput">${zonesCardsHtml(state.zones)}</div>
                    </section>
                    <section class="${APP.id}-section ${APP.id}-secondarySection">
                        <div><h3>Marcador Secundário</h3><p>Lista independente, sem filtros nem zonas. Usa uma estrela para distinguir estas aldeias.</p></div>
                        <div><div class="${APP.id}-tool"><div class="${APP.id}-enableRow"><label class="${APP.id}-enableLabel"><input class="tp-secondary-enabled" type="checkbox" ${state.secondaryEnabled ? "checked" : ""}> Ativar marcador secundário</label></div><div class="${APP.id}-optionsRow"><strong class="tp-secondary-count">${state.secondaryCoords.size} aldeia(s)</strong><button class="tp-secondary-clear" type="button">Limpar secundário</button></div></div><textarea class="${APP.id}-secondaryInput" spellcheck="false" placeholder="500|500\n501|502">${escapeHtml(secondaryCoordinates)}</textarea></div>
                    </section>
                    <section class="${APP.id}-section ${APP.id}-tribePlayersSection">
                        <div><h3>Marcador de Jogador/Tribo</h3><p>Marca pelo nome do jogador ou pela tag/nome da tribo. Cada jogador recebe uma cor e o seu nome no minimapa.</p></div>
                        <div class="${APP.id}-tool"><div class="${APP.id}-enableRow"><label class="${APP.id}-enableLabel"><input class="tp-tribe-enabled" type="checkbox" ${state.tribePlayersEnabled ? "checked" : ""}> Ativar marcador de jogador/tribo</label></div><span class="${APP.id}-toolTitle">Jogadores, tags ou nomes de tribos</span><div class="${APP.id}-toolLine"><input class="${APP.id}-tribeQuery" type="text" value="${escapeHtml(state.tribeQuery)}" placeholder="Jogador; STN; Nome da tribo"><button class="tp-tribe-apply" type="button">Carregar e marcar</button><strong class="tp-tribe-count">${state.tribePlayerGroups.length ? `${state.tribePlayerGroups.length} jogador(es), ${state.tribeCoords.size} aldeia(s)` : ""}</strong></div></div>
                    </section>
                    <section class="${APP.id}-section ${APP.id}-supportSection">
                        <div><h3>Tropas em apoio</h3><p>Marca separadamente os apoios estacionados e os que ainda estão a caminho.</p></div>
                        <div class="${APP.id}-tool"><div class="${APP.id}-enableRow"><label class="${APP.id}-enableLabel"><input class="tp-support-enabled" type="checkbox" ${state.supportEnabled ? "checked" : ""}> Estacionados</label><label class="${APP.id}-enableLabel"><input class="tp-support-travel-enabled" type="checkbox" ${state.supportTravelEnabled ? "checked" : ""}> A caminho</label></div><span class="${APP.id}-toolTitle">Destinos a apresentar</span><div class="${APP.id}-optionsRow"><select class="tp-support-mode"><option value="own" ${state.supportMode === "own" ? "selected" : ""}>Apenas minhas aldeias</option><option value="others" ${state.supportMode === "others" ? "selected" : ""}>Apenas aldeias de outros jogadores</option><option value="both" ${state.supportMode === "both" ? "selected" : ""}>Minhas e de outros jogadores</option></select></div><div class="${APP.id}-toolLine"><button class="tp-support-apply" type="button">Carregar apoios e marcar</button><strong class="tp-support-count">${state.supportCoords.size} estacionado(s)</strong><strong class="tp-support-travel-count">${state.supportTravelCoords.size} a caminho</strong></div></div>
                    </section>
                    <section class="${APP.id}-section ${APP.id}-attackSection">
                        <div><h3>Aldeias atacadas</h3><p>Marca os destinos dos teus ataques em curso e apresenta as coordenadas no mapa.</p></div>
                        <div class="${APP.id}-tool"><div class="${APP.id}-enableRow"><label class="${APP.id}-enableLabel"><input class="tp-attack-enabled" type="checkbox" ${state.attackEnabled ? "checked" : ""}> Ativar marcação de aldeias atacadas</label></div><span class="${APP.id}-toolTitle">Filtros dos ataques</span><div class="${APP.id}-optionsRow"><label><input class="tp-attack-exclude-barb" type="checkbox" ${state.attackExcludeBarbarians ? "checked" : ""}> Excluir aldeias bárbaras</label><label><input class="tp-attack-exclude-farm" type="checkbox" ${state.attackExcludeFarm ? "checked" : ""}> Excluir Assistente de Farm</label></div><div class="${APP.id}-attackLegend"><span><i class="tp-going"></i>A caminho</span><span><i class="tp-returning"></i>A retornar</span><span><i class="tp-both"></i>Ambos</span></div><div class="${APP.id}-toolLine"><button class="tp-attack-apply" type="button">Carregar ataques e marcar</button><strong class="tp-attack-count">${state.attackCoords.size ? `${state.attackCoords.size} encontrada(s)` : ""}</strong></div></div>
                    </section>
                    <section class="${APP.id}-section ${APP.id}-bonusSection">
                        <div><h3>Bárbaras bónus</h3><p>Analisa automaticamente as aldeias bárbaras e marca apenas os tipos de bónus selecionados.</p></div>
                        <div class="${APP.id}-tool ${APP.id}-bonusTool"><div class="${APP.id}-enableRow"><label class="${APP.id}-enableLabel"><input class="tp-bonus-enabled" type="checkbox" ${state.bonusEnabled ? "checked" : ""}> Ativar marcação de bárbaras bónus</label></div><span class="${APP.id}-toolTitle">Tipos de aldeia bónus</span><div class="${APP.id}-bonusOptions">${bonusOptionsHtml()}</div><div class="${APP.id}-toolLine"><button class="tp-bonus-apply" type="button">Analisar mapa e marcar</button><strong class="tp-bonus-count">${state.bonusCoords.size ? `${state.bonusCoords.size} encontrada(s)` : ""}</strong></div></div>
                    </section>
                    <section class="${APP.id}-section ${APP.id}-actionsSection">
                        <div><h3>Ações</h3><p>Guarda as opções e atualiza as marcações.</p></div>
                        <div class="tp-actions"><button class="tp-action tp-secondary tp-clear">Limpar</button><button class="tp-action tp-save">Guardar e marcar</button></div>
                    </section>
                </div>
            </div>`;
        const dialog = window.Dialog;
        let panel;
        if (dialog && typeof dialog.show === "function") {
            dialog.show(`${APP.id}Dialog`, `<div id="${APP.id}-native" class="${APP.id}-native">${body}</div>`);
            panel = document.getElementById(`${APP.id}-native`);
        } else {
            panel = document.createElement("div");
            panel.id = `${APP.id}-panel`;
            panel.innerHTML = `<div class="tp-card" role="dialog" aria-modal="true"><div class="tp-head"><span>📍 ${APP.title}</span><button class="tp-close" title="Fechar">×</button></div>${body}</div>`;
            document.body.appendChild(panel);
            panel.querySelector(".tp-close").addEventListener("click", closePanel);
            panel.addEventListener("click", (event) => { if (event.target === panel) closePanel(); });
        }
        if (!panel) return;
        state.panel = panel;
        sizeNativeDialog(panel);
        const textarea = panel.querySelector("textarea");
        const secondaryTextarea = panel.querySelector(`.${APP.id}-secondaryInput`);
        const updateCount = () => panel.querySelector(".tp-count").textContent = `${parseCoordinates(textarea.value).size} aldeia(s)`;
        const updateSecondaryCount = () => panel.querySelector(".tp-secondary-count").textContent = `${parseCoordinates(secondaryTextarea.value).size} aldeia(s)`;
        textarea.addEventListener("input", () => {
            state.zones = [];
            state.zonesEnabled = false;
            updateZonesOutput(panel);
            updateCount();
        });
        panel.querySelector(".tp-clear").addEventListener("click", () => { textarea.value = ""; updateCount(); });
        secondaryTextarea.addEventListener("input", updateSecondaryCount);
        panel.querySelector(".tp-secondary-clear").addEventListener("click", () => { secondaryTextarea.value = ""; updateSecondaryCount(); });
        panel.querySelector(".tp-tribe-apply")?.addEventListener("click", async (event) => {
            const button = event.currentTarget;
            state.tribeQuery = panel.querySelector(`.${APP.id}-tribeQuery`).value.trim();
            state.tribePlayersEnabled = panel.querySelector(".tp-tribe-enabled").checked;
            if (!state.tribeQuery) return notify("Indica pelo menos um jogador, tag ou nome de tribo.");
            button.disabled = true;
            button.textContent = "A carregar…";
            try {
                await loadTribePlayerVillages(true);
                save();
                updateTribePlayersMapToggle();
                refreshMarkers(true);
                panel.querySelector(".tp-tribe-count").textContent = `${state.tribePlayerGroups.length} jogador(es), ${state.tribeCoords.size} aldeia(s)`;
                notify(`${state.tribePlayerGroups.length} jogador(es) e ${state.tribeCoords.size} aldeia(s) carregados.`);
            } catch (error) {
                notify(`Não foi possível carregar jogadores/tribos: ${error.message}`);
            } finally {
                button.disabled = false;
                button.textContent = "Carregar e marcar";
            }
        });
        panel.querySelector(".tp-filter").addEventListener("click", async (event) => {
            const button = event.currentTarget;
            const distance = Math.max(1, Math.min(200, Number(panel.querySelector(".tp-distance").value) || 20));
            const candidates = [...parseCoordinates(textarea.value).values()];
            if (!candidates.length) return notify("Não existem coordenadas para filtrar.");
            button.disabled = true;
            button.textContent = "A carregar…";
            try {
                const own = await loadOwnVillages();
                const maxSquared = distance * distance;
                const filtered = candidates.filter((target) => own.some((village) => {
                    const dx = target.x - village.x;
                    const dy = target.y - village.y;
                    return dx * dx + dy * dy <= maxSquared;
                }));
                textarea.value = filtered.map(({ x, y }) => `${x}|${y}`).join("\n");
                state.distance = distance;
                state.zones = [];
                state.zonesEnabled = false;
                updateZonesOutput(panel);
                updateCount();
                notify(`${filtered.length} de ${candidates.length} aldeias estão a até ${distance} campos.`);
            } catch (error) {
                notify(`Não foi possível carregar as tuas aldeias: ${error.message}`);
            } finally {
                button.disabled = false;
                button.textContent = "Filtrar lista";
            }
        });
        panel.querySelector(".tp-zones").addEventListener("click", async (event) => {
            const coordinatesToGroup = [...parseCoordinates(textarea.value).values()];
            if (!coordinatesToGroup.length) return notify("Não existem coordenadas para agrupar.");
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = "A ordenar…";
            state.zoneSize = normalizeZoneSize(panel.querySelector(".tp-zone-size").value);
            try {
                const own = await loadOwnVillages();
                state.zones = buildZones(coordinatesToGroup, state.zoneSize, own);
                state.zonesEnabled = true;
                const zonesEnabled = panel.querySelector(".tp-zones-enabled");
                if (zonesEnabled) zonesEnabled.checked = true;
                updateZonesOutput(panel);
                notify(`${state.zones.length} zona(s) criada(s), da mais próxima para a mais distante.`);
            } catch (error) {
                notify(`Não foi possível ordenar as zonas: ${error.message}`);
            } finally {
                button.disabled = false;
                button.textContent = "Criar zonas";
            }
        });
        panel.querySelector(".tp-bonus-apply")?.addEventListener("click", async (event) => {
            const button = event.currentTarget;
            state.bonusTypes = [...panel.querySelectorAll(`.${APP.id}-bonusOptions input:checked`)].map((input) => String(input.value));
            state.bonusEnabled = panel.querySelector(".tp-bonus-enabled").checked;
            if (state.bonusEnabled && !state.bonusTypes.length) return notify("Seleciona pelo menos um tipo de aldeia bónus.");
            button.disabled = true;
            button.textContent = "A analisar…";
            try {
                await loadBonusBarbarians();
                save();
                refreshMarkers(true);
                const count = panel.querySelector(".tp-bonus-count");
                if (count) count.textContent = `${state.bonusCoords.size} encontrada(s)`;
                notify(`${state.bonusCoords.size} aldeia(s) bárbara(s) bónus marcada(s).`);
            } catch (error) {
                notify(`Não foi possível analisar os bónus: ${error.message}`);
            } finally {
                button.disabled = false;
                button.textContent = "Analisar mapa e marcar";
            }
        });
        panel.querySelector(".tp-support-apply")?.addEventListener("click", async (event) => {
            const button = event.currentTarget;
            state.supportMode = panel.querySelector(".tp-support-mode").value;
            state.supportEnabled = panel.querySelector(".tp-support-enabled").checked;
            state.supportTravelEnabled = panel.querySelector(".tp-support-travel-enabled").checked;
            button.disabled = true;
            button.textContent = "A carregar…";
            try {
                await Promise.all([loadSupportedVillages(true), loadTravelingSupportVillages(true)]);
                save();
                updateSupportMapToggle();
                updateSupportTravelMapToggle();
                refreshMarkers(true);
                const count = panel.querySelector(".tp-support-count");
                if (count) count.textContent = `${state.supportCoords.size} estacionado(s)`;
                const travelCount = panel.querySelector(".tp-support-travel-count");
                if (travelCount) travelCount.textContent = `${state.supportTravelCoords.size} a caminho`;
                notify(`${state.supportCoords.size} apoio(s) estacionado(s) e ${state.supportTravelCoords.size} a caminho marcado(s).`);
            } catch (error) {
                notify(`Não foi possível carregar os apoios: ${error.message}`);
            } finally {
                button.disabled = false;
                button.textContent = "Carregar apoios e marcar";
            }
        });
        panel.querySelector(".tp-attack-apply")?.addEventListener("click", async (event) => {
            const button = event.currentTarget;
            state.attackExcludeBarbarians = panel.querySelector(".tp-attack-exclude-barb").checked;
            state.attackExcludeFarm = panel.querySelector(".tp-attack-exclude-farm").checked;
            state.attackEnabled = panel.querySelector(".tp-attack-enabled").checked;
            button.disabled = true;
            button.textContent = "A carregar…";
            try {
                await loadAttackedVillages(true);
                save();
                updateAttackMapToggle();
                refreshMarkers(true);
                const count = panel.querySelector(".tp-attack-count");
                if (count) count.textContent = `${state.attackCoords.size} encontrada(s)`;
                notify(`${state.attackCoords.size} aldeia(s) atacada(s) marcada(s).`);
            } catch (error) {
                notify(`Não foi possível carregar os ataques: ${error.message}`);
            } finally {
                button.disabled = false;
                button.textContent = "Carregar ataques e marcar";
            }
        });
        panel.querySelector(".tp-save").addEventListener("click", async () => {
            setCoordinates(textarea.value);
            state.secondaryCoords = parseCoordinates(secondaryTextarea.value);
            state.secondaryEnabled = panel.querySelector(".tp-secondary-enabled")?.checked === true;
            state.tribeQuery = panel.querySelector(`.${APP.id}-tribeQuery`)?.value.trim() || "";
            state.tribePlayersEnabled = panel.querySelector(".tp-tribe-enabled")?.checked === true;
            state.color = panel.querySelector(".tp-color").value;
            state.showLabels = panel.querySelector(".tp-labels").checked;
            state.coordinatesEnabled = panel.querySelector(".tp-enabled").checked;
            state.distance = Math.max(1, Math.min(200, Number(panel.querySelector(".tp-distance").value) || 20));
            state.zoneSize = normalizeZoneSize(panel.querySelector(".tp-zone-size").value);
            state.zonesEnabled = panel.querySelector(".tp-zones-enabled")?.checked === true && state.zones.length > 0;
            state.bonusTypes = [...panel.querySelectorAll(`.${APP.id}-bonusOptions input:checked`)].map((input) => String(input.value));
            state.bonusEnabled = panel.querySelector(".tp-bonus-enabled")?.checked === true;
            state.supportMode = panel.querySelector(".tp-support-mode")?.value || "both";
            state.supportEnabled = panel.querySelector(".tp-support-enabled")?.checked === true;
            state.supportTravelEnabled = panel.querySelector(".tp-support-travel-enabled")?.checked === true;
            state.attackExcludeBarbarians = panel.querySelector(".tp-attack-exclude-barb")?.checked === true;
            state.attackExcludeFarm = panel.querySelector(".tp-attack-exclude-farm")?.checked === true;
            state.attackEnabled = panel.querySelector(".tp-attack-enabled")?.checked === true;
            try { await loadBonusBarbarians(); } catch (error) { notify(`Não foi possível analisar os bónus: ${error.message}`); }
            try { await loadSupportedVillages(true); } catch (error) { notify(`Não foi possível carregar os apoios: ${error.message}`); }
            try { await loadTravelingSupportVillages(true); } catch (error) { notify(`Não foi possível carregar os apoios a caminho: ${error.message}`); }
            try { await loadAttackedVillages(true); } catch (error) { notify(`Não foi possível carregar os ataques: ${error.message}`); }
            try { await loadTribePlayerVillages(true); } catch (error) { notify(`Não foi possível carregar jogadores/tribos: ${error.message}`); }
            save();
            updateMapToggle();
            updateSecondaryMapToggle();
            updateTribePlayersMapToggle();
            updateBonusMapToggle();
            updateSupportMapToggle();
            updateSupportTravelMapToggle();
            updateAttackMapToggle();
            refreshMarkers();
            closePanel();
            notify(`${state.coords.size} aldeia(s) guardada(s).`);
        });
        textarea.focus();
    }

    function sizeNativeDialog(panel) {
        const width = `${Math.min(1320, Math.max(760, window.innerWidth - 34))}px`;
        const dialogBox = document.getElementById(`popup_box_${APP.id}Dialog`) || panel.closest(".popup_box");
        if (!dialogBox) return;
        dialogBox.style.setProperty("width", width, "important");
        dialogBox.style.setProperty("max-width", width, "important");
        dialogBox.style.setProperty("overflow", "hidden", "important");
        dialogBox.querySelectorAll(".popup_box_container,.popup_box_content").forEach((element) => {
            element.style.setProperty("width", "100%", "important");
            element.style.setProperty("max-width", "100%", "important");
            element.style.setProperty("box-sizing", "border-box", "important");
            element.style.setProperty("overflow", "hidden", "important");
        });
    }

    function closePanel() {
        if (window.Dialog && typeof window.Dialog.close === "function" && document.getElementById(`${APP.id}-native`)) {
            window.Dialog.close(`${APP.id}Dialog`);
        } else {
            state.panel?.remove();
        }
        state.panel = null;
    }

    function waitForMap(attempt = 0) {
        if (!getMapToggleHost()) {
            setTimeout(() => waitForMap(attempt + 1), attempt < 120 ? 250 : 1000);
            return;
        }

        if (createMapToolbarButtons()) {
            observeMap();
            const loaders = [];
            if (state.bonusEnabled && state.bonusTypes.length) loaders.push(loadBonusBarbarians());
            if (state.supportEnabled) loaders.push(loadSupportedVillages());
            if (state.supportTravelEnabled) loaders.push(loadTravelingSupportVillages());
            if (state.attackEnabled) loaders.push(loadAttackedVillages());
            if (state.tribePlayersEnabled) loaders.push(loadTribePlayerVillages());
            Promise.allSettled(loaders).then(() => refreshMarkers(true));
        }
    }

    function setupWorldTabResume() {
        const queue = () => {
            if (document.hidden) return;
            clearTimeout(state.resumeTimer);
            state.resumeTimer = setTimeout(resumeWorldTab, 120);
        };
        window.addEventListener("focus", queue, { passive: true });
        window.addEventListener("pageshow", queue, { passive: true });
        document.addEventListener("visibilitychange", queue, { passive: true });
    }

    async function resumeWorldTab() {
        if (state.resumeRunning || document.hidden) return;
        if (!(gd.screen === "map" || /[?&]screen=map(?:&|$)/.test(location.search))) return;
        if (!getMapToggleHost()) {
            waitForMap();
            return;
        }
        state.resumeRunning = true;
        try {
            if (!document.getElementById(`${APP.id}-launcher`)) createLauncher();
            createMapToolbarButtons();
            if (!state.observer) observeMap();

            const loaders = [];
            if (state.bonusEnabled && state.bonusTypes.length) loaders.push(loadBonusBarbarians());
            if (state.supportEnabled) loaders.push(loadSupportedVillages(true));
            if (state.supportTravelEnabled) loaders.push(loadTravelingSupportVillages(true));
            if (state.attackEnabled) loaders.push(loadAttackedVillages(true));
            if (state.tribePlayersEnabled) loaders.push(loadTribePlayerVillages(true));
            await Promise.allSettled(loaders);
            refreshMarkers(true);
        } finally {
            state.resumeRunning = false;
        }
    }

    function observeMap() {
        state.observer?.disconnect();
        state.observer = new MutationObserver((mutations) => {
            const minimap = findPoliticalMap();
            const hasGameChange = mutations.some((mutation) => {
                if (mutation.type === "attributes") {
                    return !mutation.target.classList?.contains(`${APP.id}-marked`) &&
                        !mutation.target.classList?.contains(`${APP.id}-minimapOverlay`);
                }
                const changed = [...mutation.addedNodes, ...mutation.removedNodes];
                return changed.some((node) => node.nodeType !== 1 || !isOwnMarker(node));
            });
            const minimapChanged = minimap && mutations.some((mutation) =>
                minimap.contains(mutation.target) &&
                !mutation.target.classList?.contains(`${APP.id}-minimapOverlay`)
            );
            if (hasGameChange) {
                scheduleLiveMarkerSync(Boolean(minimapChanged));
                if (state.dragActive) state.pendingMiniRefresh ||= Boolean(minimapChanged);
                else scheduleRefresh(Boolean(minimapChanged));
            }
        });
        state.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "style"] });
        window.addEventListener("resize", () => scheduleRefresh(true), { passive: true });
        document.addEventListener("pointerdown", startMarkerDrag, { passive: true, capture: true });
        document.addEventListener("mousedown", startMarkerDrag, { passive: true, capture: true });
        document.addEventListener("touchstart", startMarkerDrag, { passive: true, capture: true });
        document.addEventListener("pointerup", finishMarkerDrag, { passive: true, capture: true });
        document.addEventListener("pointercancel", finishMarkerDrag, { passive: true, capture: true });
        document.addEventListener("mouseup", finishMarkerDrag, { passive: true, capture: true });
        document.addEventListener("touchend", finishMarkerDrag, { passive: true, capture: true });
        document.addEventListener("touchcancel", finishMarkerDrag, { passive: true, capture: true });
        document.addEventListener("keyup", (event) => {
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) scheduleRefresh(true);
        });
    }

    function scheduleLiveMarkerSync(includeMiniMap = true) {
        if (state.liveSyncFrame) return;
        state.liveSyncFrame = requestAnimationFrame(() => {
            state.liveSyncFrame = 0;
            syncMainMarkerPositions();
            if (includeMiniMap) syncMiniMapMarkerPositions();
        });
    }

    function startMarkerDrag(event) {
        const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
        if (!target) return;
        const mainMap = target.closest("#map,#map_wrap,#map_container");
        const miniMap = target.closest("#minimap,#politicalmap,#pmap,#minimap_container,.minimap");
        if (!mainMap && !miniMap) return;
        if (target.closest(`#${APP.id}-mapToolbar`)) return;
        state.dragActive = true;
        cancelAnimationFrame(state.dragFrame);
        const sync = (timestamp) => {
            if (!state.dragActive) return;
            syncMainMarkerPositions();
            if (timestamp - state.lastMiniSync >= 16) {
                state.lastMiniSync = timestamp;
                syncMiniMapMarkerPositions();
            }
            state.dragFrame = requestAnimationFrame(sync);
        };
        state.dragFrame = requestAnimationFrame(sync);
    }

    function finishMarkerDrag() {
        if (!state.dragActive) return;
        state.dragActive = false;
        cancelAnimationFrame(state.dragFrame);
        state.dragFrame = 0;
        state.pendingMiniRefresh = false;
        requestAnimationFrame(() => refreshMarkers(true));
    }

    function syncMainMarkerPositions() {
        document.querySelectorAll(`.${APP.id}-mapPin[data-village-id]`).forEach((marker) => {
            const image = document.getElementById(`map_village_${marker.dataset.villageId}`);
            const parent = marker.parentElement;
            if (!image || !parent || !image.isConnected) return;
            const imageRect = image.getBoundingClientRect();
            const parentRect = parent.getBoundingClientRect();
            if (!imageRect.width || !imageRect.height) return;
            marker.style.left = `${imageRect.left - parentRect.left + imageRect.width / 2}px`;
            marker.style.top = `${imageRect.top - parentRect.top + imageRect.height / 2}px`;
        });
    }

    function scheduleRefresh(refreshMiniMap = false) {
        state.pendingMiniRefresh ||= refreshMiniMap;
        clearTimeout(state.refreshTimer);
        state.refreshTimer = setTimeout(() => {
            const includeMiniMap = state.pendingMiniRefresh;
            state.pendingMiniRefresh = false;
            refreshMarkers(includeMiniMap);
        }, state.pendingMiniRefresh ? 70 : 16);
    }

    function isOwnMarker(node) {
        return node.classList?.contains(`${APP.id}-badge`) ||
            node.classList?.contains(`${APP.id}-minimapOverlay`) ||
            node.classList?.contains(`${APP.id}-miniDot`) ||
            node.classList?.contains(`${APP.id}-playerBadge`) ||
            node.id === `${APP.id}-tribePlayerFilter` ||
            Boolean(node.closest?.(`#${APP.id}-tribePlayerFilter`)) ||
            node.id === `${APP.id}-secondaryQuickBox` ||
            Boolean(node.closest?.(`#${APP.id}-secondaryQuickBox`)) ||
            node.id === `${APP.id}-tribeQuickBox` ||
            Boolean(node.closest?.(`#${APP.id}-tribeQuickBox`)) ||
            node.classList?.contains(`${APP.id}-mapPin`);
    }

    function refreshMarkers(refreshMiniMap = true) {
        removeMarkers(refreshMiniMap);
        scanVisibleBonusBarbarians();
        if (!activeCoordinates().size) return;
        markMainMapAnchored();
        if (refreshMiniMap) markPoliticalMap();
    }

    function markMainMapAnchored() {
        const twMap = window.TWMap;
        if (!twMap?.villages) return;
        for (const { x, y } of activeCoordinates().values()) {
            const village = twMap.villages[`${x}${y}`];
            const villageId = village?.id ?? village?.[0];
            if (villageId == null) continue;
            const image = document.getElementById(`map_village_${villageId}`);
            if (!image?.parentElement) continue;
            const imageRect = image.getBoundingClientRect();
            const parentRect = image.parentElement.getBoundingClientRect();
            if (!imageRect.width || !imageRect.height) continue;
            const left = imageRect.left - parentRect.left + imageRect.width / 2;
            const top = imageRect.top - parentRect.top + imageRect.height / 2;
            const marker = document.createElement("span");
            marker.className = `${APP.id}-mapPin`;
            marker.dataset.villageId = String(villageId);
            const bonus = state.bonusCoords.get(`${x}|${y}`);
            const support = state.supportCoords.get(`${x}|${y}`);
            const supportTravel = state.supportTravelCoords.get(`${x}|${y}`);
            const attack = state.attackCoords.get(`${x}|${y}`);
            const secondary = state.secondaryEnabled && state.secondaryCoords.has(`${x}|${y}`);
            const tribeVillage = state.tribePlayersEnabled ? state.tribeCoords.get(`${x}|${y}`) : null;
            const details = [];
            if (attack) details.push(`${attack.outgoingCount || 0} ataque(s) a caminho; ${attack.returningCount || 0} a retornar${attack.isBarbarian ? " — aldeia bárbara" : ""}${attack.isFarm ? " — Assistente de Farm" : ""}`);
            if (secondary) details.push("marcador secundário");
            if (tribeVillage) details.push(`jogador ${tribeVillage.playerName}`);
            if (supportTravel) details.push(`${supportTravel.count} apoio(s) a caminho (${supportTravel.isOwn ? "aldeia própria" : "outro jogador"})`);
            if (support) details.push(`tropas estacionadas em apoio (${support.isOwn ? "aldeia própria" : "outro jogador"})`);
            if (bonus) details.push(bonusData()?.[bonus.bonus]?.text || `Bónus ${bonus.bonus}`);
            marker.title = details.length ? `${x}|${y} — ${details.join("; ")}` : `${x}|${y}`;
            marker.style.setProperty("--tp-marker-color", markerColorFor(x, y));
            marker.style.left = `${left}px`;
            marker.style.top = `${top}px`;
            const bonusIcon = bonus ? bonusIconUrl(bonus.bonus) : "";
            const labelIcon = bonusIcon ? `<img class="${APP.id}-pinBonusIcon" src="${escapeHtml(bonusIcon)}" alt="" title="${escapeHtml(bonusData()?.[bonus.bonus]?.text || `Bónus ${bonus.bonus}`)}">` : "";
            const markerIcon = secondary ? `<i class="${APP.id}-secondaryStar">★</i>` : `<i class="${APP.id}-pinIcon"></i>`;
            marker.innerHTML = `${markerIcon}${state.showLabels || attack || supportTravel || secondary ? `<b class="${APP.id}-pinLabel ${bonusIcon ? `${APP.id}-pinLabelBonus` : ""}">${labelIcon}<span>${x}|${y}</span></b>` : ""}`;
            image.parentElement.appendChild(marker);
        }
    }

    function markMainMapByGrid() {
        const twMap = window.TWMap;
        const map = twMap?.map;
        const container = document.querySelector("#map");
        if (!map || !container || !Array.isArray(map.pos) || typeof map.coordByPixel !== "function") return;
        const tileX = Number(twMap.tileSize?.[0]) || 53;
        const tileY = Number(twMap.tileSize?.[1]) || 38;
        const columns = Number(twMap.size?.[0]) || Math.ceil(container.clientWidth / tileX) + 2;
        const rows = Number(twMap.size?.[1]) || Math.ceil(container.clientHeight / tileY) + 2;
        if (getComputedStyle(container).position === "static") container.style.position = "relative";
        const overlay = document.createElement("div");
        overlay.className = `${APP.id}-minimapOverlay ${APP.id}-mainOverlay`;
        overlay.style.setProperty("--tp-marker-color", state.color);
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < columns; col++) {
                const coord = map.coordByPixel(map.pos[0] + tileX * col, map.pos[1] + tileY * row);
                if (!coord || !activeCoordinates().has(`${coord[0]}|${coord[1]}`)) continue;
                const village = twMap.villages?.[`${coord[0]}${coord[1]}`];
                if (!village) continue;
                const marker = document.createElement("span");
                marker.className = `${APP.id}-mapPin`;
                marker.style.left = `${col * tileX + tileX / 2}px`;
                marker.style.top = `${row * tileY + tileY / 2}px`;
                marker.title = `${coord[0]}|${coord[1]}`;
                if (state.showLabels) marker.dataset.label = `${coord[0]}|${coord[1]}`;
                overlay.appendChild(marker);
            }
        }
        if (overlay.childElementCount) container.appendChild(overlay);
    }

    function removeMarkers(includeMiniMap = true) {
        document.querySelectorAll(`.${APP.id}-marked`).forEach((el) => el.classList.remove(`${APP.id}-marked`));
        document.querySelectorAll(`.${APP.id}-badge,.${APP.id}-mapPin`).forEach((el) => el.remove());
        if (includeMiniMap) document.querySelectorAll(`.${APP.id}-minimapOverlay`).forEach((el) => el.remove());
    }

    function markVillageElements() {
        const twMap = window.TWMap;
        const villages = twMap?.villages || {};
        const elements = document.querySelectorAll("#map img[id*='village'],#map_wrap img[id*='village'],#map_container img[id*='village'],[data-village-id]");
        elements.forEach((element) => {
            const idMatch = String(element.dataset.villageId || element.id || "").match(/(?:village[_-]?)(\d+)/i);
            const village = idMatch ? villages[idMatch[1]] : null;
            let x = Number(village?.x ?? village?.[2]);
            let y = Number(village?.y ?? village?.[3]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                const coordMatch = `${element.id} ${element.title} ${element.alt}`.match(/(\d{1,3})\s*\|\s*(\d{1,3})/);
                if (!coordMatch) return;
                x = Number(coordMatch[1]); y = Number(coordMatch[2]);
            }
            if (!activeCoordinates().has(`${x}|${y}`)) return;
            element.classList.add(`${APP.id}-marked`);
            element.style.setProperty("--tp-marker-color", state.color);
            if (state.showLabels && element.parentElement) {
                const badge = document.createElement("span");
                badge.className = `${APP.id}-badge`;
                badge.textContent = `${x}|${y}`;
                badge.style.setProperty("--tp-marker-color", state.color);
                badge.style.left = `${element.offsetLeft + element.offsetWidth / 2}px`;
                badge.style.top = `${element.offsetTop}px`;
                element.parentElement.appendChild(badge);
            }
        });
    }

    function markPoliticalMap() {
        const container = findPoliticalMap();
        if (!container) return;
        if (markPoliticalMapByGrid(container)) return;
        const bounds = politicalMapBounds(container);
        if (!bounds || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) return;
        if (getComputedStyle(container).position === "static") container.style.position = "relative";
        const overlay = document.createElement("div");
        overlay.className = `${APP.id}-minimapOverlay`;
        overlay.style.setProperty("--tp-marker-color", state.color);
        for (const { x, y } of activeCoordinates().values()) {
            if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
            const dot = document.createElement("span");
            const secondary = state.secondaryEnabled && state.secondaryCoords.has(`${x}|${y}`);
            dot.className = `${APP.id}-miniDot${secondary ? " tp-secondary" : ""}`;
            if (secondary) dot.textContent = "★";
            dot.title = `${x}|${y}`;
            dot.dataset.x = String(x);
            dot.dataset.y = String(y);
            dot.style.setProperty("--tp-marker-color", markerColorFor(x, y));
            dot.style.left = `${((x - bounds.minX) / (bounds.maxX - bounds.minX)) * 100}%`;
            dot.style.top = `${((y - bounds.minY) / (bounds.maxY - bounds.minY)) * 100}%`;
            overlay.appendChild(dot);
        }
        (state.coordinatesEnabled && state.zonesEnabled ? state.zones : []).forEach((zone, index) => {
            const center = zoneCenter(zone);
            if (center.x < bounds.minX || center.x > bounds.maxX || center.y < bounds.minY || center.y > bounds.maxY) return;
            const badge = document.createElement("span");
            badge.className = `${APP.id}-zoneBadge`;
            badge.dataset.centerX = String(center.x);
            badge.dataset.centerY = String(center.y);
            badge.textContent = String(index + 1);
            badge.title = `Zona ${index + 1} (${zone.length} aldeias)`;
            badge.style.setProperty("--tp-zone-color", zoneColor(index));
            badge.style.left = `${((center.x - bounds.minX) / (bounds.maxX - bounds.minX)) * 100}%`;
            badge.style.top = `${((center.y - bounds.minY) / (bounds.maxY - bounds.minY)) * 100}%`;
            overlay.appendChild(badge);
        });
        if (state.tribePlayersEnabled) state.tribePlayerGroups.filter(isTribePlayerVisible).forEach((player) => {
            const center = player.center;
            if (!center || center.x < bounds.minX || center.x > bounds.maxX || center.y < bounds.minY || center.y > bounds.maxY) return;
            const badge = document.createElement("span");
            badge.className = `${APP.id}-playerBadge`;
            badge.dataset.centerX = String(center.x);
            badge.dataset.centerY = String(center.y);
            badge.textContent = player.name;
            badge.title = `${player.name} (${player.villages.length} aldeias)`;
            badge.style.setProperty("--tp-player-color", player.color);
            badge.style.left = `${((center.x - bounds.minX) / (bounds.maxX - bounds.minX)) * 100}%`;
            badge.style.top = `${((center.y - bounds.minY) / (bounds.maxY - bounds.minY)) * 100}%`;
            overlay.appendChild(badge);
        });
        if (overlay.childElementCount) container.appendChild(overlay);
    }

    function markPoliticalMapByGrid(container) {
        const targets = activeCoordinates();
        const mapping = miniMapAxisMapping(container);
        if (!mapping) return false;
        if (getComputedStyle(container).position === "static") container.style.position = "relative";
        const overlay = document.createElement("div");
        overlay.className = `${APP.id}-minimapOverlay`;
        overlay.style.setProperty("--tp-marker-color", state.color);
        for (const { x, y } of targets.values()) {
            const dot = document.createElement("span");
            const secondary = state.secondaryEnabled && state.secondaryCoords.has(`${x}|${y}`);
            dot.className = `${APP.id}-miniDot${secondary ? " tp-secondary" : ""}`;
            if (secondary) dot.textContent = "★";
            dot.title = `${x}|${y}`;
            dot.dataset.x = String(x);
            dot.dataset.y = String(y);
            dot.style.setProperty("--tp-marker-color", markerColorFor(x, y));
            positionMiniElement(dot, x, y, mapping);
            overlay.appendChild(dot);
        }
        (state.coordinatesEnabled && state.zonesEnabled ? state.zones : []).forEach((zone, index) => {
            const center = zoneCenter(zone);
            const badge = document.createElement("span");
            badge.className = `${APP.id}-zoneBadge`;
            badge.dataset.centerX = String(center.x);
            badge.dataset.centerY = String(center.y);
            badge.textContent = String(index + 1);
            badge.title = `Zona ${index + 1} (${zone.length} aldeias)`;
            badge.style.setProperty("--tp-zone-color", zoneColor(index));
            positionMiniElement(badge, center.x, center.y, mapping);
            overlay.appendChild(badge);
        });
        if (state.tribePlayersEnabled) state.tribePlayerGroups.filter(isTribePlayerVisible).forEach((player) => {
            if (!player.center) return;
            const badge = document.createElement("span");
            badge.className = `${APP.id}-playerBadge`;
            badge.dataset.centerX = String(player.center.x);
            badge.dataset.centerY = String(player.center.y);
            badge.textContent = player.name;
            badge.title = `${player.name} (${player.villages.length} aldeias)`;
            badge.style.setProperty("--tp-player-color", player.color);
            positionMiniElement(badge, player.center.x, player.center.y, mapping);
            overlay.appendChild(badge);
        });
        container.appendChild(overlay);
        return true;
    }

    function miniMapAxisMapping(container) {
        const twMap = window.TWMap || {};
        const candidates = [twMap.minimap, twMap.pmap, twMap.politicalMap, twMap.pmapHandler?.map].filter(Boolean);
        for (const map of candidates) {
            if (!Array.isArray(map.pos) || typeof map.coordByPixel !== "function") continue;
            const width = container.clientWidth;
            const height = container.clientHeight;
            if (!width || !height) continue;
            const xAreas = new Map();
            const yAreas = new Map();
            const sampleY = map.pos[1] + Math.floor(height / 2);
            const sampleX = map.pos[0] + Math.floor(width / 2);
            for (let px = 0; px <= width; px += 1) {
                const coord = map.coordByPixel(map.pos[0] + px, sampleY);
                const value = Number(coord?.[0]);
                if (!Number.isFinite(value)) continue;
                const area = xAreas.get(value);
                if (area) area.max = px;
                else xAreas.set(value, { min: px, max: px });
            }
            for (let py = 0; py <= height; py += 1) {
                const coord = map.coordByPixel(sampleX, map.pos[1] + py);
                const value = Number(coord?.[1]);
                if (!Number.isFinite(value)) continue;
                const area = yAreas.get(value);
                if (area) area.max = py;
                else yAreas.set(value, { min: py, max: py });
            }
            if (xAreas.size && yAreas.size) return { xAreas, yAreas };
        }
        return null;
    }

    function positionMiniElement(element, x, y, mapping) {
        const xArea = mapping.xAreas.get(Math.round(x));
        const yArea = mapping.yAreas.get(Math.round(y));
        if (!xArea || !yArea) {
            element.hidden = true;
            return false;
        }
        element.hidden = false;
        element.style.left = `${(xArea.min + xArea.max) / 2}px`;
        element.style.top = `${(yArea.min + yArea.max) / 2}px`;
        return true;
    }

    function syncMiniMapMarkerPositions() {
        const container = findPoliticalMap();
        if (!container) return;
        let overlay = container.querySelector(`.${APP.id}-minimapOverlay`);
        if (!overlay) {
            markPoliticalMap();
            return;
        }
        const mapping = miniMapAxisMapping(container);
        if (!mapping) return;
        overlay.querySelectorAll(`.${APP.id}-miniDot[data-x][data-y]`).forEach((dot) => {
            positionMiniElement(dot, Number(dot.dataset.x), Number(dot.dataset.y), mapping);
        });
        overlay.querySelectorAll(`.${APP.id}-zoneBadge[data-center-x][data-center-y]`).forEach((badge) => {
            positionMiniElement(badge, Number(badge.dataset.centerX), Number(badge.dataset.centerY), mapping);
        });
        overlay.querySelectorAll(`.${APP.id}-playerBadge[data-center-x][data-center-y]`).forEach((badge) => {
            positionMiniElement(badge, Number(badge.dataset.centerX), Number(badge.dataset.centerY), mapping);
        });
    }

    function findPoliticalMap() {
        const selectors = ["#minimap", "#politicalmap", "#pmap", "#minimap_container", ".minimap"];
        return selectors.map((selector) => document.querySelector(selector)).find((el) => el && el.offsetWidth > 30 && el.offsetHeight > 30) || null;
    }

    function politicalMapBounds(container) {
        const twMap = window.TWMap || {};
        const objects = [twMap.minimap, twMap.pmap, twMap.politicalMap, twMap.pmapHandler].filter(Boolean);
        for (const obj of objects) {
            const pos = obj.pos || obj.position || obj._pos;
            const size = obj.size || obj.mapSize || obj._size;
            if (Array.isArray(pos) && Array.isArray(size) && size[0] > 0 && size[1] > 0) {
                return { minX: +pos[0], minY: +pos[1], maxX: +pos[0] + +size[0], maxY: +pos[1] + +size[1] };
            }
            const minX = numberFrom(obj, ["minX", "x", "startX"]);
            const minY = numberFrom(obj, ["minY", "y", "startY"]);
            const maxX = numberFrom(obj, ["maxX", "endX"]);
            const maxY = numberFrom(obj, ["maxY", "endY"]);
            if ([minX, minY, maxX, maxY].every(Number.isFinite)) return { minX, minY, maxX, maxY };
        }
        const source = [...container.querySelectorAll("img")].map((img) => img.currentSrc || img.src).find(Boolean) || getComputedStyle(container).backgroundImage;
        const params = parseMapUrl(source);
        if (params) return params;
        const map = twMap.map;
        const pos = map?.pos;
        const tileSize = Number(twMap.tileSize || map?.tileSize || 53);
        if (Array.isArray(pos) && tileSize > 0) {
            const visibleX = Math.max(1, document.querySelector("#map")?.clientWidth / tileSize || 15);
            const visibleY = Math.max(1, document.querySelector("#map")?.clientHeight / tileSize || 10);
            const scale = 4;
            return { minX: pos[0] - visibleX * 1.5, minY: pos[1] - visibleY * 1.5, maxX: pos[0] + visibleX * 2.5, maxY: pos[1] + visibleY * 2.5 };
        }
        return null;
    }

    function parseMapUrl(source) {
        const clean = String(source || "").replace(/^url\(["']?|["']?\)$/g, "");
        try {
            const url = new URL(clean, location.href);
            const x = Number(url.searchParams.get("x"));
            const y = Number(url.searchParams.get("y"));
            const w = Number(url.searchParams.get("w") || url.searchParams.get("width"));
            const h = Number(url.searchParams.get("h") || url.searchParams.get("height"));
            if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) return { minX: x, minY: y, maxX: x + w, maxY: y + h };
        } catch (_) { /* URL não analisável */ }
        return null;
    }

    function numberFrom(object, keys) {
        for (const key of keys) if (Number.isFinite(Number(object?.[key]))) return Number(object[key]);
        return NaN;
    }

    function notify(message) {
        if (window.UI?.SuccessMessage) window.UI.SuccessMessage(message, 2200);
        else console.info(`[${APP.title}] ${message}`);
    }

    function registerHubShortcut() {
        window.TPMapMarker = { open: openPanel, refresh: refreshMarkers, version: APP.version };
        window.dispatchEvent(new CustomEvent("TPHub:Register", { detail: { id: APP.id, title: APP.title, open: openPanel } }));
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }
})();
