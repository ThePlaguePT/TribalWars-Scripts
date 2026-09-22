// ==UserScript==
// @name         TW PT - Resumo de Tropas - ThePlaguePT
// @namespace    https://github.com/ThePlaguePT/TribalWars-Scripts
// @version      1.8.0
// @description  Resume as tropas do grupo atual, classifica os exercitos e exporta um cartao PNG.
// @author       ThePlaguePT
// @match        https://*.tribalwars.com.pt/game.php*
// @match        https://*.tribalwars.net/game.php*
// @icon         https://www.tribalwars.com.pt/favicon.ico
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const APP = {
        id: 'twp-troop-summary',
        title: 'Resumo de Tropas',
        version: '1.8.0',
        storageKey: 'twp_troop_summary_settings_v1'
    };

    const FALLBACK_UNITS = [
        ['spear', 'Lanceiros', 1], ['sword', 'Espadachins', 1], ['axe', 'Bárbaros', 1],
        ['archer', 'Arqueiros', 1], ['spy', 'Exploradores', 2], ['light', 'Cavalaria leve', 4],
        ['marcher', 'Arqueiros a cavalo', 5], ['heavy', 'Cavalaria pesada', 6],
        ['ram', 'Aríetes', 5], ['catapult', 'Catapultas', 8], ['knight', 'Paladinos', 10],
        ['snob', 'Nobres', 100]
    ];
    const FALLBACK_MAP = Object.fromEntries(FALLBACK_UNITS.map(row => [row[0], row]));
    const WORLD_UNIT_KEYS = Array.isArray(window.game_data?.units) && window.game_data.units.length
        ? window.game_data.units.slice()
        : FALLBACK_UNITS.map(([key]) => key);
    const UNIT_KEYS = Array.from(new Set(WORLD_UNIT_KEYS));
    const DISPLAY_UNIT_KEYS = UNIT_KEYS.filter(key => key !== 'militia');
    function worldUnitLabel(key) {
        return window.unit_info?.[key]?.name || window.game_data?.units_info?.[key]?.name || window.Config?.units?.[key]?.name || FALLBACK_MAP[key]?.[1] || key;
    }
    const LABELS = Object.fromEntries(UNIT_KEYS.map(key => [key, worldUnitLabel(key)]));
    function worldUnitPopulation(key) {
        const sources = [window.unit_info, window.game_data?.units_info, window.Config?.units];
        for (const source of sources) {
            const value = source?.[key]?.pop ?? source?.[key]?.population ?? source?.[key]?.farm;
            if (Number.isFinite(Number(value))) return Number(value);
        }
        return FALLBACK_MAP[key]?.[2] ?? 1;
    }
    const POP = Object.fromEntries(UNIT_KEYS.map(key => [key, worldUnitPopulation(key)]));
    const DEFAULTS = {
        hidePlayer: false,
        defensePopulation: 20000
    };

    let state = { summary: null, loading: false, progress: '', settings: loadSettings() };

    function loadSettings() {
        try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(APP.storageKey) || '{}') }; }
        catch (_) { return { ...DEFAULTS }; }
    }

    function saveSettings() {
        localStorage.setItem(APP.storageKey, JSON.stringify(state.settings));
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
    }

    function number(value) {
        const raw = String(value ?? '').replace(/\u00a0/g, ' ').trim();
        if (!raw || /^[-—]$/.test(raw)) return 0;
        const match = raw.match(/\d[\d.\s]*/);
        return match ? Number(match[0].replace(/[.\s]/g, '')) || 0 : 0;
    }

    function troopCellNumber(cell) {
        const text = cell?.textContent || '';
        return /\b\d{1,3}\s*\|\s*\d{1,3}\b/.test(text) ? 0 : number(text);
    }

    function format(value) {
        return Math.round(Number(value) || 0).toLocaleString('pt-PT');
    }

    function emptyUnits() {
        return Object.fromEntries(UNIT_KEYS.map(key => [key, 0]));
    }

    function addUnits(target, source) {
        UNIT_KEYS.forEach(key => { target[key] += Number(source[key]) || 0; });
        return target;
    }

    function detectUnit(element) {
        const text = [element?.className, element?.innerHTML, element?.textContent,
            ...Array.from(element?.querySelectorAll?.('img') || []).flatMap(img => [img.src, img.alt, img.title, img.className])]
            .join(' ').toLowerCase();
        return UNIT_KEYS.find(key => new RegExp(`(?:unit[_-]|unit-item-)?${key}(?:\\.png|\\b|[_-])`).test(text)) || null;
    }

    function directRows(table) {
        return Array.from(table.querySelectorAll('tr')).filter(row => row.closest('table') === table);
    }

    function findTroopTable(doc) {
        const tables = Array.from(doc.querySelectorAll('#units_table, table.vis'));
        let best = null;
        for (const table of tables) {
            for (const row of directRows(table)) {
                const columns = Array.from(row.children).map((cell, index) => ({ key: detectUnit(cell), index })).filter(item => item.key);
                if (!best || columns.length > best.columns.length) best = { table, columns };
            }
        }
        return best && best.columns.length >= 4 ? best : null;
    }

    function villageId(row) {
        const rowId = String(row?.id || '').match(/\d+/)?.[0];
        if (rowId) return rowId;
        for (const link of Array.from(row?.querySelectorAll?.('a[href*="village="]') || [])) {
            try {
                const id = new URL(link.getAttribute('href'), location.origin).searchParams.get('village');
                if (id) return id;
            } catch (_) {}
        }
        return '';
    }

    function parseOverview(doc) {
        const found = findTroopTable(doc);
        if (!found) throw new Error('Não encontrei a tabela de tropas. Abre a Vista geral > Tropas e tenta novamente.');
        const villagesByCoords = new Map();
        let currentCoords = '';
        for (const row of directRows(found.table)) {
            if (row.querySelector('th')) continue;
            const text = normalizedRowText(row);
            if (!text || /\b(selecionar|seleccionar|select)\b/.test(text)) continue;
            const detectedCoords = (row.textContent || '').match(/\b\d{1,3}\s*\|\s*\d{1,3}\b/)?.[0]?.replace(/\s/g, '') || '';
            if (detectedCoords) currentCoords = detectedCoords;
            if (!currentCoords) continue;
            if (!villagesByCoords.has(currentCoords)) {
                villagesByCoords.set(currentCoords, {
                    id: villageId(row), coords: currentCoords, totals: emptyUnits(), attackUnits: emptyUnits(),
                    fallback: emptyUnits(), hasTotal: false, hasAttack: false
                });
            }
            const village = villagesByCoords.get(currentCoords);
            if (!village.id && detectedCoords) village.id = villageId(row);
            const rowUnits = parseRowFromRight(row, found.columns);
            if (!unitCount(rowUnits)) continue;
            if (isSupportRow(text) || isScavengeRow(text)) continue;
            if (isTotalRow(text)) {
                village.totals = rowUnits; village.attackUnits = rowUnits;
                village.hasTotal = true; village.hasAttack = true;
                continue;
            }
            const ownRow = /as suas proprias|suas proprias|tropas proprias|proprias|own troops|your own|own units|eigene truppen|eigene/.test(text);
            if (!village.hasAttack && (detectedCoords || ownRow)) {
                village.attackUnits = rowUnits; village.hasAttack = true;
            }
            if (!village.hasTotal) UNIT_KEYS.forEach(key => { village.fallback[key] = Math.max(village.fallback[key] || 0, rowUnits[key] || 0); });
        }
        const villages = Array.from(villagesByCoords.values()).map(village => {
            if (!village.hasTotal) village.totals = village.fallback;
            if (!village.hasAttack || !unitCount(village.attackUnits)) village.attackUnits = village.totals;
            village.units = village.totals;
            delete village.fallback; delete village.hasTotal; delete village.hasAttack;
            return village;
        }).filter(village => unitCount(village.units));
        if (!villages.length) throw new Error('A tabela foi encontrada, mas não continha aldeias com tropas.');
        return villages;
    }

    function overviewUrl(type = 'complete') {
        const url = new URL(location.href);
        url.searchParams.set('screen', 'overview_villages');
        url.searchParams.set('mode', 'units');
        url.searchParams.set('type', type);
        url.searchParams.set('units_type', type);
        url.searchParams.set('page', '-1');
        url.searchParams.delete('group');
        ['action', 'ajax', 'h'].forEach(key => url.searchParams.delete(key));
        return url;
    }

    async function fetchOverview(type) {
        const response = await fetch(overviewUrl(type), { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error(`O jogo respondeu com HTTP ${response.status}.`);
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (doc.querySelector('#bot_check, .g-recaptcha')) throw new Error('O jogo pediu verificação. Conclui-a e volta a tentar.');
        return doc;
    }

    function parseAwaySupports(doc) {
        const totals = emptyUnits();
        const found = findTroopTable(doc);
        if (!found) return totals;
        const originRows = Array.from(found.table.querySelectorAll('tr.units_away'));
        originRows.forEach(origin => {
            for (let row = origin.nextElementSibling; row && !row.classList.contains('units_away'); row = row.nextElementSibling) {
                if (!row.matches('tr.row_a, tr.row_b, tr.row_ax, tr.row_bx')) continue;
                const cells = Array.from(row.children);
                const trailing = cells.slice(-found.columns.length);
                found.columns.forEach(({ key, index }, unitIndex) => {
                    const direct = troopCellNumber(cells[index]);
                    const fromRight = troopCellNumber(trailing[unitIndex]);
                    totals[key] += Math.max(direct, fromRight);
                });
            }
        });
        return totals;
    }

    function supportOverviewUrl(baseDoc) {
        const link = Array.from(baseDoc?.querySelectorAll?.('a[href*="screen=overview_villages"][href*="mode=units"]') || [])
            .find(item => /^(apoio|apoios|suporte|support|supports)$/i.test((item.textContent || '').trim()));
        if (link) return new URL(link.getAttribute('href'), location.origin);
        return overviewUrl('support');
    }

    async function fetchSupportOverview(baseDoc) {
        const response = await fetch(supportOverviewUrl(baseDoc), { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error(`O jogo respondeu com HTTP ${response.status} na vista de apoios.`);
        return new DOMParser().parseFromString(await response.text(), 'text/html');
    }

    function parseSupportOverview(doc) {
        const totals = emptyUnits();
        const found = findTroopTable(doc);
        if (!found) return totals;
        directRows(found.table).filter(row => !row.querySelector('th')).forEach(row => {
            const text = normalizedRowText(row);
            if (!row.querySelector('input[type="checkbox"]')) return;
            if (isTotalRow(text) || isHomeRow(text) || isScavengeRow(text)) return;
            addUnits(totals, parseRowFromRight(row, found.columns));
        });
        return totals;
    }

    function placeUrl(villageId) {
        const url = new URL(location.href);
        url.searchParams.set('screen', 'place');
        url.searchParams.set('mode', 'units');
        url.searchParams.set('village', String(villageId));
        ['action', 'ajax', 'h'].forEach(key => url.searchParams.delete(key));
        return url;
    }

    function activityKind(row) {
        const text = `${row.textContent || ''} ${row.innerHTML || ''}`.toLowerCase();
        if (/scaveng|coleta|recolha|busca\s+(fraca|humilde|inteligente|extrema)|gather/.test(text)) return 'scavenge';
        if (/am_farm|farm_icon|assistente\s+de\s+farm|farm assistant|saque|pilhagem|loot/.test(text)) return 'farm';
        if (/support|apoio|refor[cç]o/.test(text)) return 'support';
        if (/\b\d{1,3}\|\d{1,3}\b|command|comando|ataque|attack|marcha|tr[aâ]nsito|a caminho/.test(text)) return 'transit';
        return '';
    }

    function normalizedRowText(row) {
        return `${row?.textContent || ''} ${row?.className || ''} ${Array.from(row?.querySelectorAll?.('img') || []).map(img => `${img.src} ${img.title} ${img.alt} ${img.className}`).join(' ')}`
            .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
    }

    function parseRowFromRight(row, columns) {
        const result = emptyUnits();
        const cells = Array.from(row?.children || []);
        const values = cells.filter(cell => {
            const text = (cell.textContent || '').replace(/\u00a0/g, ' ').trim();
            return !/\b\d{1,3}\s*\|\s*\d{1,3}\b/.test(text) && (/^[-—]$/.test(text) || /^\d[\d.\s]*$/.test(text));
        });
        const unitCells = values.length >= columns.length ? values.slice(0, columns.length) : cells.slice(-columns.length);
        columns.forEach(({ key }, index) => { result[key] = troopCellNumber(unitCells[index]); });
        return result;
    }

    function troopTableInfos(doc) {
        return Array.from(doc.querySelectorAll('table')).map(table => {
            let columns = [];
            directRows(table).forEach(row => {
                const found = Array.from(row.children).map((cell, index) => ({ key: detectUnit(cell), index })).filter(item => item.key);
                if (found.length > columns.length) columns = found;
            });
            const rows = columns.length ? directRows(table).filter(row => !row.querySelector('th')).map(row => ({
                row, text: normalizedRowText(row), units: parseRowFromRight(row, columns)
            })).filter(item => UNIT_KEYS.some(key => item.units[key] > 0)) : [];
            return { table, columns, rows };
        }).filter(info => info.columns.length && info.rows.length);
    }

    function isTotalRow(text) { return /\b(total|totais|gesamt|summe|totals|totaal|totale)\b/.test(text); }
    function isScavengeRow(text) { return /busca\s+(fraca|humilde|inteligente|extrema)|scaveng|loot|haul|gather|collect|recolha|coleta|colecta|forrage|fourrage|plunder|beute|rohstoff|ressourcen|zbiorka|zbieractwo|rabunek|sber|zber|gyujt|forras|colectare|strangere|toplama|kaynak/.test(text); }
    function isSupportRow(text) { return /\b(apoio|apoios|support|supports|reinforcement|reforco|unterstutzung)\b/.test(text); }
    function hasCoordsText(text) { return /\b\d{1,3}\s*\|\s*\d{1,3}\b/.test(text); }
    function isHomeRow(text) { return /desta aldeia|esta aldeia|tropas proprias|as suas proprias|own troops|from this village|own village|eigene truppen/.test(text); }

    function robustPlaceBreakdown(doc) {
        const out = { home: emptyUnits(), scavenge: emptyUnits(), farm: emptyUnits(), transit: emptyUnits(), support: emptyUnits() };
        const infos = troopTableInfos(doc);
        infos.forEach(info => {
            const totalScavenge = info.rows.find(item => isTotalRow(item.text)) && info.rows.some(item => isScavengeRow(item.text));
            info.rows.forEach(item => {
                if (isTotalRow(item.text)) {
                    if (totalScavenge) addUnits(out.scavenge, item.units);
                    return;
                }
                if (/am_farm|farm_icon|assistente de farm|farm assistant|saque|pilhagem/.test(item.text)) { addUnits(out.farm, item.units); return; }
                if (isScavengeRow(item.text)) {
                    if (!totalScavenge) addUnits(out.scavenge, item.units);
                    return;
                }
                if (isSupportRow(item.text)) { addUnits(out.support, item.units); return; }
                if (isHomeRow(item.text)) { addUnits(out.home, item.units); return; }
                if (hasCoordsText(item.text)) { addUnits(out.transit, item.units); }
            });
        });
        if (!unitCount(out.home)) {
            const candidate = infos.flatMap(info => info.rows).find(item => !isTotalRow(item.text) && !hasCoordsText(item.text) && !isScavengeRow(item.text) && !isSupportRow(item.text));
            if (candidate) addUnits(out.home, candidate.units);
        }
        return out;
    }

    function parseActivityDocument(doc) {
        return robustPlaceBreakdown(doc);
    }

    async function collectActivities(villages) {
        const totals = { home: emptyUnits(), scavenge: emptyUnits(), farm: emptyUnits(), transit: emptyUnits(), support: emptyUnits() };
        const valid = villages.filter(village => village.id);
        if (!valid.length) throw new Error('Não foi possível identificar os IDs das aldeias na vista de tropas.');
        if (valid.length !== villages.length) throw new Error(`Leitura incompleta: só foram identificadas ${valid.length} de ${villages.length} aldeias.`);
        const concurrency = 4;
        let cursor = 0;
        let completed = 0;
        const failures = [];
        async function worker() {
            while (cursor < valid.length) {
                const village = valid[cursor++];
                try {
                    const response = await fetch(placeUrl(village.id), { credentials: 'include', cache: 'no-store' });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const parsed = parseActivityDocument(new DOMParser().parseFromString(await response.text(), 'text/html'));
                    Object.keys(totals).forEach(kind => addUnits(totals[kind], parsed[kind]));
                } catch (error) { failures.push({ id: village.id, error }); }
                completed += 1;
                state.progress = `A analisar movimentos… ${completed}/${valid.length}`;
                render();
            }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, valid.length || 1) }, worker));
        if (failures.length) throw new Error(`Leitura incompleta: falharam ${failures.length} de ${valid.length} Praças de Reuniões.`);
        return totals;
    }

    function reconcileActivities(total, home, detected, supportDetected) {
        const result = {
            home: emptyUnits(), scavenge: emptyUnits(), farm: emptyUnits(),
            support: emptyUnits(), transit: emptyUnits()
        };
        UNIT_KEYS.forEach(key => {
            const owned = Math.max(0, Number(total[key]) || 0);
            result.home[key] = Math.min(owned, Math.max(0, Number(home[key]) || 0));
            let remaining = owned - result.home[key];
            result.support[key] = Math.min(remaining, Math.max(0, Number(supportDetected[key]) || 0));
            remaining -= result.support[key];
            result.scavenge[key] = Math.min(remaining, Math.max(0, Number(detected.scavenge[key]) || 0));
            remaining -= result.scavenge[key];
            result.farm[key] = Math.min(remaining, Math.max(0, Number(detected.farm[key]) || 0));
            remaining -= result.farm[key];
            result.transit[key] = remaining;
        });
        return result;
    }

    function population(units, keys) {
        return keys.reduce((sum, key) => sum + (units[key] || 0) * (POP[key] || 0), 0);
    }

    function tier(value, target) {
        const ratio = target > 0 ? value / target : 0;
        if (ratio >= 0.875) return 'full';
        if (ratio >= 0.625) return 'threeQuarter';
        if (ratio >= 0.375) return 'half';
        if (ratio >= 0.125) return 'quarter';
        return 'other';
    }

    function increment(target, key) { target[key] = (target[key] || 0) + 1; }

    function classify(villages) {
        const result = {
            noble: { full: 0, trains: {} },
            attack: { full: 0, half: 0, small: 0, catapult: 0 },
            defense: { full: 0, threeQuarter: 0, half: 0, quarter: 0 }
        };
        const attackKeys = ['axe', 'light', 'marcher', 'ram', 'catapult'];
        const defenseKeys = ['spear', 'sword', 'archer', 'heavy'];
        for (const village of villages) {
            const units = village.units || emptyUnits();
            const attackUnits = village.attackUnits || units;
            const attackPop = population(attackUnits, attackKeys);
            const defensePop = population(units, defenseKeys);
            if (attackUnits.snob > 0) {
                if (attackUnits.snob > 1) result.noble.trains[attackUnits.snob] = (result.noble.trains[attackUnits.snob] || 0) + 1;
                else if (attackUnits.axe >= 5000 && attackUnits.light >= 2000) result.noble.full += 1;
                continue;
            }
            if (attackUnits.axe > 0 && attackUnits.light > 0) {
                if (attackUnits.axe >= 5000 && attackUnits.light >= 2000) result.attack.full += 1;
                else if (attackUnits.axe >= 2500 && attackUnits.light >= 1000) result.attack.half += 1;
                else if (attackUnits.axe > 0 && attackUnits.light > 0) result.attack.small += 1;
                if (attackUnits.catapult * POP.catapult >= attackPop * 0.2) result.attack.catapult += 1;
            } else if (defensePop > 0) {
                increment(result.defense, tier(defensePop, state.settings.defensePopulation));
            }
        }
        return result;
    }

    async function collect() {
        if (state.loading) return;
        state.loading = true;
        state.progress = 'A carregar o resumo de tropas…';
        render();
        try {
            const completeDoc = await fetchOverview('complete');
            const supportDoc = await fetchSupportOverview(completeDoc);
            const villages = parseOverview(completeDoc);
            const totals = villages.reduce((sum, village) => addUnits(sum, village.units), emptyUnits());
            const overviewSupport = parseSupportOverview(supportDoc);
            const group = document.querySelector('#group_selection option:checked')?.textContent?.trim() || 'Todas';
            state.progress = `A analisar ${villages.length} Praças de Reuniões…`;
            render();
            const detected = await collectActivities(villages);
            UNIT_KEYS.forEach(key => {
                detected.support[key] = Number(overviewSupport[key] || 0);
            });
            const homeTotals = emptyUnits();
            UNIT_KEYS.forEach(key => {
                const away = (detected.scavenge[key] || 0) + (detected.farm[key] || 0) +
                    (detected.transit[key] || 0) + (detected.support[key] || 0);
                homeTotals[key] = Math.max(0, (totals[key] || 0) - away);
            });
            const activities = reconcileActivities(totals, homeTotals, detected, detected.support);
            state.summary = {
                villages, totals, armies: classify(villages), group, generatedAt: new Date(),
                activities,
                expectedVillageCount: Number(window.game_data?.player?.villages) || villages.length
            };
        } catch (error) {
            notify(error.message || String(error), 'error');
        } finally {
            state.loading = false;
            state.progress = '';
            render();
        }
    }

    function playerName() {
        if (state.settings.hidePlayer) return 'Oculto';
        return window.game_data?.player?.name || document.querySelector('#menu_row2 b')?.textContent?.trim() || 'Jogador';
    }

    function unitIcon(key) {
        return `<img class="${APP.id}-unitIcon" src="/graphic/unit/unit_${encodeURIComponent(key)}.png" alt="${escapeHtml(LABELS[key])}" title="${escapeHtml(LABELS[key])}">`;
    }

    function unitCount(totals) {
        return DISPLAY_UNIT_KEYS.reduce((sum, key) => sum + Number(totals?.[key] || 0), 0);
    }

    function activityHtml(activities) {
        if (!activities) return `<div class="${APP.id}-activityLoading">A analisar coleta, farm, trânsito e apoios…</div>`;
        const rows = [
            ['home', 'Prontas em casa'], ['scavenge', 'Em coleta'], ['farm', 'Assistente de Farm'],
            ['transit', 'Em trânsito'], ['support', 'Em apoios']
        ];
        const accounted = rows.reduce((sum, [key]) => sum + unitCount(activities[key]), 0);
        return rows.map(([key, label]) => {
            const totals = activities[key] || emptyUnits();
            const icons = DISPLAY_UNIT_KEYS.filter(unit => totals[unit] > 0)
                .map(unit => `<span title="${escapeHtml(LABELS[unit])}: ${format(totals[unit])}">${unitIcon(unit)}<b>${format(totals[unit])}</b></span>`).join('');
            return `<div class="${APP.id}-activity"><div><strong>${escapeHtml(label)}</strong><small>${format(unitCount(totals))} un.</small></div><div class="${APP.id}-activityUnits">${icons || '<i>0</i>'}</div></div>`;
        }).join('') + `<div class="${APP.id}-activityTotal"><b>Total reconciliado</b><span>${format(accounted)} / ${format(unitCount(state.summary?.totals))} unidades</span></div>`;
    }

    function armyRows(armies) {
        const nobleTrainRows = Object.entries(armies.noble.trains || {}).sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([nobles, count]) => ['', `${nobles} NT de nobres`, count]);
        return [
            ['Exércitos com nobre', 'Full com nobre', armies.noble.full],
            ...nobleTrainRows,
            ['Exércitos ofensivos', 'Fulls', armies.attack.full], ['', 'Meios fulls', armies.attack.half],
            ['', 'Pequenos fulls', armies.attack.small], ['', 'Fulls de catapultas', armies.attack.catapult],
            ['Exércitos defensivos', 'Defesas completas', armies.defense.full], ['', '3/4 de defesa', armies.defense.threeQuarter],
            ['', '1/2 defesa', armies.defense.half], ['', '1/4 defesa', armies.defense.quarter]
        ];
    }

    function summaryHtml() {
        const s = state.summary;
        if (!s) return `<div class="${APP.id}-empty">${state.loading ? escapeHtml(state.progress || 'A carregar…') : 'O resumo será carregado automaticamente.'}</div>`;
        const unitRows = DISPLAY_UNIT_KEYS.map(key => {
            return `<div class="${APP.id}-unit"><span>${unitIcon(key)} ${escapeHtml(LABELS[key])}</span><b>${format(s.totals[key])}</b></div>`;
        }).join('');
        const rows = armyRows(s.armies).map(([section, label, count]) => {
            return `${section ? `<div class="${APP.id}-section"><span>${escapeHtml(section)}</span></div>` : ''}<div class="${APP.id}-army"><span>» ${escapeHtml(label)}</span><b>${format(count)}</b></div>`;
        }).join('');
        return `<div class="${APP.id}-card" id="${APP.id}-card">
            <div class="${APP.id}-meta"><b>Jogador:</b> ${escapeHtml(playerName())}<br><b>Grupo:</b> ${escapeHtml(s.group)}<br><b>Aldeias:</b> ${format(s.expectedVillageCount)}${s.villages.length !== s.expectedVillageCount ? ` <span class="${APP.id}-warning">(lidas ${format(s.villages.length)})</span>` : ''}<br><b>Hora do servidor:</b> ${escapeHtml(document.querySelector('#serverTime')?.textContent || s.generatedAt.toLocaleTimeString('pt-PT'))} ${escapeHtml(document.querySelector('#serverDate')?.textContent || s.generatedAt.toLocaleDateString('pt-PT'))}</div>
            <div class="${APP.id}-columns"><div>${rows}</div><div><div class="${APP.id}-section">Unidades</div>${unitRows}<div class="${APP.id}-section">Totais</div><div class="${APP.id}-unit"><span>Unidades</span><b>${format(unitCount(s.totals))}</b></div></div></div>
            <div class="${APP.id}-section">Distribuição do total de tropas</div>${activityHtml(s.activities)}
            <small>${APP.title} v${APP.version} · ThePlaguePT</small>
        </div>`;
    }

    function render() {
        const body = document.querySelector(`#${APP.id}-body`);
        if (!body) return;
        body.innerHTML = `<div class="${APP.id}-toolbar"><button data-action="copy" class="${APP.id}-button" ${state.summary && !state.loading ? '' : 'disabled'}>Copiar imagem</button><button data-action="png" class="${APP.id}-button" ${state.summary && !state.loading ? '' : 'disabled'}>Guardar imagem</button><button data-action="collect" class="${APP.id}-button" ${state.loading ? 'disabled' : ''}>Atualizar</button>${state.progress ? `<span>${escapeHtml(state.progress)}</span>` : ''}</div>${summaryHtml()}`;
    }

    function openModal() {
        let modal = document.getElementById(APP.id);
        if (!modal) {
            const markup = `<div id="${APP.id}" class="open"><div class="${APP.id}-shell"><div class="${APP.id}-window"><button class="${APP.id}-close" title="Fechar">×</button><div class="${APP.id}-head"><strong>Resumo de Tropas - ThePlaguePT v${APP.version}</strong><span>Leitura global das unidades e do estado dos movimentos.</span></div><div id="${APP.id}-body" class="${APP.id}-body"></div></div></div></div>`;
            if (window.Dialog?.show) {
                window.Dialog.show(`${APP.id}-dialog`, markup);
                modal = document.getElementById(APP.id);
            } else {
                const holder = document.createElement('div'); holder.innerHTML = markup;
                modal = holder.firstElementChild; document.body.appendChild(modal);
            }
            modal.addEventListener('click', onClick);
        }
        modal.classList.add('open');
        render();
        if (!state.loading) collect();
    }

    function closeModal() {
        if (window.Dialog?.close && document.getElementById(`popup_box_${APP.id}-dialog`)) window.Dialog.close(`${APP.id}-dialog`);
        else document.getElementById(APP.id)?.classList.remove('open');
    }

    function showSettings() {
        state.settings.hidePlayer = confirm('Ocultar o nome do jogador nas imagens partilhadas?');
        saveSettings();
        if (state.summary) state.summary.armies = classify(state.summary.villages);
        render();
    }

    async function onClick(event) {
        if (event.target === event.currentTarget || event.target.closest(`.${APP.id}-close`)) return closeModal();
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'collect') collect();
        if (action === 'png') exportImage(false);
        if (action === 'copy') exportImage(true);
    }

    function canvasRows() {
        const s = state.summary;
        const left = armyRows(s.armies).flatMap(([section, label, value]) => section
            ? [[section, '', ''], ['', label, value]]
            : [['', label, value]]);
        const right = [['Unidades', '', ''], ...DISPLAY_UNIT_KEYS.map(key => ['', `@${key}|${LABELS[key]}`, format(s.totals[key])])];
        right.push(['Totais', '', ''], ['', 'Unidades', format(unitCount(s.totals))]);
        return { left, right };
    }

    async function loadCanvasUnitIcons() {
        const entries = await Promise.all(DISPLAY_UNIT_KEYS.map(key => new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve([key, img]); img.onerror = () => resolve([key, null]);
            img.src = `/graphic/unit/unit_${encodeURIComponent(key)}.png`;
        })));
        return Object.fromEntries(entries);
    }

    async function buildCanvas() {
        const s = state.summary;
        const unitImages = await loadCanvasUnitIcons();
        const { left, right } = canvasRows();
        const activityRows = s.activities ? [
            ['Prontas em casa', s.activities.home], ['Em coleta', s.activities.scavenge],
            ['Assistente de Farm', s.activities.farm], ['Em trânsito', s.activities.transit], ['Em apoios', s.activities.support]
        ] : [];
        const rowH = 24, headerH = 118, contentRows = Math.max(left.length, right.length), activityH = activityRows.length ? 30 + activityRows.length * rowH : 0;
        const canvas = document.createElement('canvas');
        canvas.width = 900; canvas.height = headerH + contentRows * rowH + activityH + 38;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f4e4b8'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#8d642b'; ctx.lineWidth = 5; ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
        ctx.fillStyle = '#24180b'; ctx.font = 'bold 30px Arial'; ctx.fillText('Resumo de Tropas', 28, 46);
        ctx.font = '16px Arial';
        const meta = [`Jogador: ${playerName()}`, `Grupo: ${s.group}`, `Aldeias: ${format(s.villages.length)}`, `Hora: ${document.querySelector('#serverTime')?.textContent || s.generatedAt.toLocaleTimeString('pt-PT')} ${document.querySelector('#serverDate')?.textContent || s.generatedAt.toLocaleDateString('pt-PT')}`];
        meta.forEach((line, index) => ctx.fillText(line, 29, 70 + index * 18));
        drawCanvasColumn(ctx, left, 28, headerH, 410, rowH, unitImages);
        drawCanvasColumn(ctx, right, 462, headerH, 410, rowH, unitImages);
        let y = headerH + contentRows * rowH + 5;
        if (activityRows.length) {
            ctx.fillStyle = '#d3a54e'; ctx.fillRect(28, y, 844, 25); ctx.fillStyle = '#24180b'; ctx.font = 'bold 15px Arial'; ctx.fillText('Distribuição do total de tropas', 36, y + 18); y += 28;
            activityRows.forEach(([label, units], index) => {
                ctx.fillStyle = index % 2 ? '#f9edc9' : '#efe0b4'; ctx.fillRect(28, y, 844, rowH - 1);
                ctx.fillStyle = '#24180b'; ctx.font = '14px Arial'; ctx.fillText(label, 36, y + 17);
                ctx.textAlign = 'right'; ctx.font = 'bold 14px Arial'; ctx.fillText(`${format(unitCount(units))} unidades`, 864, y + 17); ctx.textAlign = 'left'; y += rowH;
            });
        }
        ctx.font = '12px Arial'; ctx.fillStyle = '#4d3518'; ctx.fillText(`${APP.title} v${APP.version} · ThePlaguePT`, 29, canvas.height - 20);
        return canvas;
    }

    function drawCanvasColumn(ctx, rows, x, y, width, rowH, unitImages) {
        rows.forEach(([section, label, value], index) => {
            const top = y + index * rowH;
            ctx.fillStyle = section ? '#d3a54e' : index % 2 ? '#f9edc9' : '#efe0b4';
            ctx.fillRect(x, top, width, rowH - 1);
            ctx.fillStyle = '#24180b'; ctx.font = section ? 'bold 15px Arial' : '14px Arial';
            const unitMatch = !section && String(label).match(/^@([^|]+)\|(.*)$/);
            if (unitMatch) {
                const img = unitImages?.[unitMatch[1]];
                if (img) ctx.drawImage(img, x + 8, top + 3, 18, 18);
                ctx.fillText(unitMatch[2], x + 30, top + 17);
            } else ctx.fillText(section || `» ${label}`, x + 8, top + 17);
            if (!section) { ctx.font = 'bold 14px Arial'; ctx.textAlign = 'right'; ctx.fillText(String(value), x + width - 8, top + 18); ctx.textAlign = 'left'; }
        });
    }

    function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
        const words = text.split(/\s+/); let line = '', lines = 0;
        for (const word of words) {
            const test = line ? `${line} ${word}` : word;
            if (ctx.measureText(test).width > maxWidth && line) { ctx.fillText(line, x, y + lines++ * lineHeight); line = word; if (lines >= maxLines) return; }
            else line = test;
        }
        if (line && lines < maxLines) ctx.fillText(line, x, y + lines * lineHeight);
    }

    async function exportImage(copy) {
        try {
            const canvas = await buildCanvas();
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('Não foi possível criar o PNG.');
            if (copy && navigator.clipboard?.write && window.ClipboardItem) {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                notify('Imagem copiada. Já podes colá-la no Discord ou noutra conversa.');
                return;
            }
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `resumo-tropas-${new Date().toISOString().slice(0, 10)}.png`;
            link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
            if (copy) notify('O navegador não permitiu copiar; o PNG foi descarregado.');
        } catch (error) { notify(error.message || String(error), 'error'); }
    }

    function notify(message, type = 'success') {
        if (window.UI?.SuccessMessage && type === 'success') return window.UI.SuccessMessage(message, 3500);
        if (window.UI?.ErrorMessage && type === 'error') return window.UI.ErrorMessage(message, 5000);
        alert(message);
    }

    function installStyle() {
        const style = document.createElement('style');
        style.textContent = `
            #${APP.id}{display:none;position:fixed;inset:0;z-index:100050;background:#0008;align-items:center;justify-content:center;padding:12px;overflow:auto}#${APP.id}.open{display:flex}
            #popup_box_${APP.id}-dialog{width:min(820px,calc(100vw - 24px))!important;max-width:calc(100vw - 24px)!important}#popup_box_${APP.id}-dialog .popup_box_content{padding:0!important}#popup_box_${APP.id}-dialog #${APP.id}{display:block;position:static;inset:auto;background:transparent;padding:0;overflow:visible}#popup_box_${APP.id}-dialog .${APP.id}-shell{width:100%;filter:none}#popup_box_${APP.id}-dialog .${APP.id}-window{border:0;border-radius:0}#popup_box_${APP.id}-dialog .${APP.id}-close{display:none}
            .${APP.id}-shell{position:relative;width:min(790px,calc(100vw - 28px));filter:drop-shadow(0 12px 30px #0009)}
            .${APP.id}-window{position:relative;max-height:calc(100vh - 28px);overflow:hidden;background:#f4e4b8;border:2px solid #7e211c;border-radius:4px;color:#3b2508;font:11px Verdana,Arial,sans-serif}
            .${APP.id}-head{padding:8px 13px 7px;background:linear-gradient(#f7e8c1,#edd49a);border-bottom:1px solid #c98c48}. ${APP.id}-head strong{display:block;color:#8f2b25;font-size:16px;line-height:20px}. ${APP.id}-head span{display:block;margin-top:1px;color:#5e3b16;font-size:11px}
            .${APP.id}-body{max-height:calc(100vh - 92px);overflow:auto;padding:7px 12px 8px;border-left:4px solid #1f9ac5}
            .${APP.id}-close{position:absolute;right:-1px;top:-1px;z-index:3;width:22px;height:22px;padding:0;border:2px solid #4c2a12;border-radius:2px;background:#f6d28b;color:#1b0d07;font:bold 18px/16px Verdana;cursor:pointer;box-shadow:0 1px 3px #0008}. ${APP.id}-close:hover{background:#ffe0a0}
            .${APP.id}-toolbar{display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));align-items:center;gap:6px;margin-bottom:7px}. ${APP.id}-toolbar>span{grid-column:1/-1;color:#7d1713;font-weight:bold}. ${APP.id}-button{min-height:29px;border:1px solid #681511;border-radius:3px;background:linear-gradient(#b13a34,#922722 55%,#731914);color:#fff;cursor:pointer;font:bold 11px Verdana,Arial,sans-serif;padding:5px 9px;text-shadow:1px 1px 1px #000;box-shadow:inset 0 1px #ffffff40,inset 0 -1px #0000004d}. ${APP.id}-button:hover{background:linear-gradient(#c4473e,#a02c27 55%,#7e1c17)}. ${APP.id}-button:disabled{opacity:.55;cursor:wait}. ${APP.id}-card{background:#f4e4b8}
            .${APP.id}-card h2{color:#8f1713;font-size:18px;margin:2px 0 5px}. ${APP.id}-meta{line-height:1.35;border-bottom:1px solid #a87829;padding-bottom:5px;margin-bottom:5px}
            .${APP.id}-columns{display:grid;grid-template-columns:1fr 1fr;gap:7px}. ${APP.id}-section{display:flex;align-items:center;justify-content:space-between;gap:6px;background:linear-gradient(#e6c77a,#c99c48);border:1px solid #b88730;font-weight:bold;padding:3px 5px;margin-top:3px}
            .${APP.id}-army,.${APP.id}-unit{display:flex;align-items:center;justify-content:space-between;min-height:18px;padding:2px 5px}. ${APP.id}-army:nth-child(odd),.${APP.id}-unit:nth-child(odd){background:#fff7d788}. ${APP.id}-unit>span{display:flex;align-items:center;gap:3px}
            .${APP.id}-unitIcon{width:16px;height:16px;object-fit:contain;vertical-align:middle}. ${APP.id}-activityLoading{padding:8px;text-align:center;font-weight:bold}. ${APP.id}-activity{display:grid;grid-template-columns:180px 1fr;align-items:center;gap:5px;padding:3px 5px;border-bottom:1px solid #d9bc78}. ${APP.id}-activity>div:first-child{display:flex;justify-content:space-between;gap:4px}. ${APP.id}-activity small{color:#6a4a22}. ${APP.id}-activityUnits{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}. ${APP.id}-activityUnits span{display:inline-flex;align-items:center;gap:2px;white-space:nowrap}. ${APP.id}-activityTotal{display:flex;justify-content:space-between;padding:5px;background:#edd49a;border-top:1px solid #b88730}. ${APP.id}-card>small{display:block;margin-top:6px;font-weight:bold}. ${APP.id}-empty{padding:25px;text-align:center}
            #tp-theplaguept-script-bar{position:fixed !important;top:8px !important;left:414px !important;right:auto !important;bottom:auto !important;z-index:2147483647 !important;width:auto !important;min-width:0 !important;height:34px !important;display:flex !important;flex-direction:row !important;align-items:center !important;justify-content:flex-start !important;gap:5px !important;padding:0 8px !important;box-sizing:border-box !important;pointer-events:none !important;overflow:visible !important;transform:none !important;}#tp-theplaguept-script-bar>*{position:relative !important;top:auto !important;left:auto !important;right:auto !important;bottom:auto !important;transform:none !important;width:30px !important;min-width:30px !important;max-width:30px !important;height:28px !important;min-height:28px !important;margin:0 !important;flex:0 0 30px !important;pointer-events:auto !important;overflow:visible !important;}#tp-theplaguept-script-bar>button,#tp-theplaguept-script-bar>*>button{position:relative !important;top:auto !important;left:auto !important;right:auto !important;bottom:auto !important;transform:none !important;width:30px !important;min-width:30px !important;max-width:30px !important;height:28px !important;min-height:28px !important;margin:0 !important;padding:0 !important;flex:0 0 30px !important;display:inline-flex !important;align-items:center !important;justify-content:center !important;gap:0 !important;overflow:visible !important;}#tp-theplaguept-script-bar>button:hover,#tp-theplaguept-script-bar>button:focus-visible,#tp-theplaguept-script-bar>*>button:hover,#tp-theplaguept-script-bar>*>button:focus-visible,#tp-theplaguept-script-bar #tag-incomings-pt-panel:not(.ti-open) .ti-toggle:hover,#tp-theplaguept-script-bar #tag-incomings-pt-panel:not(.ti-open) .ti-toggle:focus-visible,#tp-theplaguept-script-bar>#tp-od-est-launcher:hover,#tp-theplaguept-script-bar>#tp-od-est-launcher:focus-visible{width:30px !important;min-width:30px !important;max-width:30px !important;padding:0 !important;gap:0 !important;}#tp-theplaguept-script-bar .tpdef-launcher-text,#tp-theplaguept-script-bar .tw-alerts-toggle-label,#tp-theplaguept-script-bar .ti-toggle-label,#tp-theplaguept-script-bar .ra-tp-config-button-label,#tp-theplaguept-script-bar [class$="-launcherLabel"],#tp-theplaguept-script-bar [class$="-launcher-text"]{display:none !important;max-width:0 !important;opacity:0 !important;}#tp-theplaguept-script-bar #twHubTp-launcher{order:10 !important;}#tp-theplaguept-script-bar #tw-discord-alerts-ui{order:20 !important;}#tp-theplaguept-script-bar #tpDefLauncher{order:30 !important;}#tp-theplaguept-script-bar #tag-incomings-pt-panel{order:40 !important;}#tp-theplaguept-script-bar #tpMapMarker-launcher{order:50 !important;}#tp-theplaguept-script-bar #renomear-ataques-cores-theplaguept-config-button{order:60 !important;}#tp-theplaguept-script-bar #tpResumo24h-launcher{order:70 !important;}#tp-theplaguept-script-bar #tpconq-launcher{order:80 !important;}#tp-theplaguept-script-bar #twp-troop-summary-launcher{order:85 !important;}#tp-theplaguept-script-bar #auto-farm-a-toggle{order:90 !important;}#tp-theplaguept-script-bar #tp-od-est-launcher{order:92 !important;}#tp-theplaguept-script-bar #script-coleta-toggle{order:94 !important;}#tp-theplaguept-script-bar>.tp-theplaguept-script-bar-item[data-tp-title]::after{content:attr(data-tp-title) !important;position:absolute !important;left:50% !important;top:33px !important;transform:translateX(-50%) !important;display:none !important;white-space:nowrap !important;max-width:360px !important;overflow:hidden !important;text-overflow:ellipsis !important;padding:4px 8px !important;border:1px solid #4f120f !important;border-radius:2px !important;background:linear-gradient(to bottom,#f6dfaa,#d2a05a) !important;color:#2b1509 !important;font:bold 11px Verdana,Arial,sans-serif !important;text-shadow:0 1px #fff !important;box-shadow:0 2px 6px rgba(0,0,0,.55) !important;pointer-events:none !important;z-index:2147483647 !important;}#tp-theplaguept-script-bar>.tp-theplaguept-script-bar-item[data-tp-title]:hover::after,#tp-theplaguept-script-bar>.tp-theplaguept-script-bar-item[data-tp-title]:focus-within::after{display:block !important;}@media (max-width:1919px){#tp-theplaguept-script-bar{top:50vh !important;left:max(12px,calc((100vw - 1220px) / 2 + 8px)) !important;right:auto !important;bottom:auto !important;width:34px !important;min-width:34px !important;height:auto !important;min-height:0 !important;max-height:calc(100vh - 118px) !important;flex-direction:column !important;align-items:center !important;justify-content:center !important;gap:5px !important;padding:8px 2px !important;transform:translateY(-50%) !important;}#tp-theplaguept-script-bar>#auto-farm-a-toggle::after,#tp-theplaguept-script-bar>#script-coleta-toggle::after,#tp-theplaguept-script-bar>.tp-theplaguept-script-bar-item[data-tp-title]::after{top:50% !important;left:38px !important;transform:translateY(-50%) !important;}#tp-theplaguept-script-bar [data-auto-farm-countdown],#tp-theplaguept-script-bar [data-script-coleta-countdown]{top:50% !important;left:38px !important;transform:translateY(-50%) !important;}}#tp-theplaguept-script-bar>#${APP.id}-launcher{order:85!important;position:relative!important;width:30px!important;min-width:30px!important;max-width:30px!important;height:28px!important;margin:0!important;padding:0!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;border:1px solid #4f120f!important;border-radius:2px!important;background:linear-gradient(#b33a34,#8f2420 55%,#681611)!important;box-shadow:inset 0 1px 0 #ffffff59,0 2px 5px #0007!important;cursor:pointer!important}. ${APP.id}-launcherIcon{width:18px;height:18px;background:url('/graphic/unit/unit_spear.png') center/contain no-repeat}. ${APP.id}-launcherLabel{display:none!important}
            @media(max-width:650px){.${APP.id}-columns{grid-template-columns:1fr}.${APP.id}-toolbar{grid-template-columns:1fr 1fr}.${APP.id}-activity{grid-template-columns:1fr}. ${APP.id}-activityUnits{justify-content:flex-start}}
        `.replace(/\. /g, '.');
        document.head.appendChild(style);
    }

    function init() {
        if (!window.game_data?.player) return;
        installStyle();
        const launcher = document.createElement('button');
        const launcherTitle = `${APP.title} - ThePlaguePT v${APP.version}`;
        launcher.id = `${APP.id}-launcher`; launcher.title = launcherTitle;
        launcher.setAttribute('aria-label', launcherTitle);
        launcher.setAttribute('data-tp-title', launcherTitle);
        launcher.innerHTML = `<span class="${APP.id}-launcherIcon"></span><span class="${APP.id}-launcherLabel">${launcherTitle}</span>`;
        launcher.addEventListener('click', openModal);
        let bar = document.getElementById('tp-theplaguept-script-bar');
        if (!bar) {
            bar = document.createElement('div'); bar.id = 'tp-theplaguept-script-bar';
            Object.assign(bar.style, { position: 'absolute', top: '8px', left: '414px', zIndex: '2147483647', height: '34px', display: 'flex', alignItems: 'center', gap: '5px', pointerEvents: 'none' });
            document.body.appendChild(bar);
        }
        launcher.style.pointerEvents = 'auto'; bar.appendChild(launcher);
    }

    init();
})();
