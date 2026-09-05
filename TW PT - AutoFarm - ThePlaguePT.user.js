// ==UserScript==
// @name         TW PT - AutoFarm - ThePlaguePT
// @namespace    theplaguept.tw.autofarm
// @version      1.3.37
// @description  Automação por rondas do Assistente de Saque do Tribal Wars.
// @author       ThePlaguePT
// @icon         https://i.imgur.com/JXzrSKy.jpeg
// @match        *://*/game.php*
// @include      *://*.tribalwars.*/game.php*
// @homepageURL  https://github.com/ThePlaguePT/TribalWars-Scripts
// @supportURL   https://github.com/ThePlaguePT/TribalWars-Scripts/issues
// @updateURL    https://raw.githubusercontent.com/ThePlaguePT/TribalWars-Scripts/main/TW%20PT%20-%20AutoFarm%20-%20ThePlaguePT.user.js
// @downloadURL  https://raw.githubusercontent.com/ThePlaguePT/TribalWars-Scripts/main/TW%20PT%20-%20AutoFarm%20-%20ThePlaguePT.user.js
// @grant        GM_openInTab
// @grant        unsafeWindow
// @grant        window.close
// @run-at       document-idle
// @noframes
// ==/UserScript==

((window, closeCurrentTab) => {
    'use strict';

    if (window.top !== window.self || !/\/game\.php$/i.test(window.location.pathname)) return;
    if (window.__twPtAutoFarm) return;

    const APP = Object.freeze({
        name: 'TW PT - AutoFarm - ThePlaguePT',
        shortName: 'TW PT - AutoFarm',
        version: '1.3.37',
        id: 'twPtAutoFarm',
        buttonId: 'auto-farm-a-toggle',
        toolbarId: 'tp-theplaguept-script-bar',
        toolbarStyleId: 'tp-theplaguept-script-bar-style',
        styleId: 'twPtAutoFarm-style',
        statusId: 'twPtAutoFarm-worker-status',
        settingsId: 'twPtAutoFarm-settings',
        settingsToggleId: 'twPtAutoFarm-settings-toggle',
        workerHeartbeatMs: 3000,
        workerFreshMs: 90000,
        monitorMs: 2500,
        defaultAttackMs: 650,
        minAttackMs: 223,
        idlePollMs: 2500,
        requestTimeoutMs: 25000,
        impactSafetyMs: 1000,
        activeSyncMs: 15000,
        activeSyncGraceMs: 30000,
        workerLaunchGraceMs: 120000,
        commandRateWindowMs: 1000,
        commandRateMaximum: 5,
        commandRateSafetyMs: 30,
        captchaResumeMs: 2000,
        captchaObserveDebounceMs: 80,
        spyHistoryMs: 365 * 24 * 60 * 60 * 1000,
    });
    const APP_DISPLAY_TITLE = `${APP.name} v${APP.version}`;
    const UNIT_MINUTES_PER_FIELD = Object.freeze({
        spear: 18,
        sword: 22,
        axe: 18,
        archer: 18,
        spy: 9,
        light: 10,
        marcher: 10,
        heavy: 11,
        ram: 30,
        catapult: 30,
        knight: 10,
        snob: 35,
    });

    const world = getWorld();
    const tabId = makeId();
    const keys = Object.freeze({
        enabled: `twPtAutoFarm.v1.${world}.enabled`,
        worker: `twPtAutoFarm.v1.${world}.worker`,
        workerOpening: `twPtAutoFarm.v1.${world}.workerOpening`,
        assistantStatus: `twPtAutoFarm.v1.${world}.assistantStatus`,
        settings: `twPtAutoFarm.v1.${world}.settings`,
        run: `twPtAutoFarm.v1.${world}.run`,
        spyHistory: `twPtAutoFarm.v1.${world}.spyHistory`,
        activeAttacks: `twPtAutoFarm.v1.${world}.activeAttacks`,
        activeSyncAt: `twPtAutoFarm.v1.${world}.activeSyncAt`,
        unitSpeed: `twPtAutoFarm.v1.${world}.unitSpeed`,
        captchaPause: `twPtAutoFarm.v1.${world}.captchaPause`,
    });
    const DEFAULT_SETTINGS = Object.freeze({
        schema: 11,
        general: {
            attackIntervalMs: 650,
            roundPauseSeconds: 60,
        },
        farm: {
            groupId: '0',
        },
        models: {
            a: defaultModel(true),
            b: defaultModel(true),
            c: defaultModel(false),
        },
        spy: {
            enabled: false,
            scoutsPerVillage: 1,
            radius: 50,
            maxAttacks: 25,
            intervalMs: 650,
        },
    });
    const workerWindowName = `TW_PT_AutoFarm_${world}`;
    const workerLockName = `twPtAutoFarm-worker-${world}`;
    const workerUrlParameter = 'tp_af_worker';
    const workerOpenRetryMs = APP.workerLaunchGraceMs;

    const state = {
        button: null,
        panel: null,
        settingsPanel: null,
        settings: null,
        savedTimer: 0,
        farmTimer: 0,
        farmDueAt: 0,
        farmTimerToken: 0,
        farmRunning: false,
        farmGeneration: 0,
        roundTimer: 0,
        roundDueAt: 0,
        roundTimerToken: 0,
        roundPreparing: false,
        villagePreparing: false,
        groupsLoadGeneration: 0,
        idleScans: 0,
        pageDeferredCandidates: 0,
        pageFinalCheckDone: false,
        recentCommandSends: [],
        farmSent: 0,
        pendingTargetDueAt: 0,
        settingsTimerInterval: 0,
        spyRunning: false,
        spyAbortController: null,
        unitSpeed: null,
        unitSpeedPromise: null,
        activeSyncAt: 0,
        activeSyncSourceId: '',
        activeSyncPromise: null,
        captchaPaused: sessionStorage.getItem(keys.captchaPause) === '1',
        captchaObserver: null,
        captchaCheckTimer: 0,
        captchaResumeTimer: 0,
        captchaReloadTimer: 0,
        processedRows: new WeakSet(),
        processedTargets: new Set(),
        workerWindow: null,
        managerOpenedWorker: false,
        nextWorkerOpenAttemptAt: 0,
        closingWorker: false,
        monitorTimer: 0,
        heartbeatTimer: 0,
        fallbackLeaseTimer: 0,
        backgroundClock: null,
        backgroundClockUrl: '',
        lastHeartbeatAt: 0,
        lastRecoveryAt: 0,
        releaseLock: null,
        ownsWorker: false,
        acquiringWorker: false,
        duplicateWorker: false,
        popupBlocked: false,
        destroyed: false,
    };

    window.__twPtAutoFarm = Object.freeze({
        name: APP.name,
        version: APP.version,
        world,
        enable: () => enable(false),
        disable,
        openWorker: () => openWorker(true),
        isEnabled,
        getSettings: () => clone(state.settings || loadSettings()),
        getStatus: () => ({
            enabled: isEnabled(),
            captchaPaused: state.captchaPaused,
            world,
            farmPage: isFarmPage(),
            ownsWorker: state.ownsWorker,
            worker: readWorker(),
            farmSent: state.farmSent,
            run: readRunState(),
            activeAttacks: readActiveAttacks(),
        }),
    });

    ready(init);

    function init() {
        if (isManagedWorker()) {
            try {
                window.name = workerWindowName;
            } catch (_) {
                // O parâmetro do URL continua a identificar o separador de trabalho.
            }
        }
        state.settings = loadSettings();
        injectStyles();
        createButton();
        bindEvents();

        const assistantAccess = getFarmAssistantAccessState();
        if (
            isManagedWorker() &&
            (!isFarmPage() || assistantAccess === false)
        ) {
            stopForUnavailableAssistant(
                'O Assistente de Saque não está ativo nesta conta. O AutoFarm foi desligado.'
            );
            return;
        }
        if (!isManagedWorker() && isEnabled() && assistantAccess === false) {
            stopForUnavailableAssistant(
                'O Assistente de Saque não está ativo nesta conta. O AutoFarm foi desligado.'
            );
            return;
        }

        startBackgroundClock();
        startCaptchaProtection();
        startMonitor();

        if (isFarmPage()) {
            createWorkerPanel();
            createModelsPanel();
            startSettingsTimer();
            if (!state.captchaPaused) loadWorldUnitSpeed();
            if (isEnabled() && !state.captchaPaused && isManagedWorker()) startWorker();
        }

        updateUi();
        if (isEnabled() && !state.captchaPaused && !isManagedWorker()) superviseWorker();
        console.info(`[${APP.shortName}] v${APP.version} carregado em ${world}.`);

        if (window.__autoFarmAController) {
            console.warn(
                `[${APP.shortName}] A versão antiga "Script Farm" também está ativa. ` +
                'Desativa-a no gestor de userscripts antes de testar este ficheiro novo.'
            );
        }
    }

    function bindEvents() {
        window.addEventListener('storage', event => {
            if (event.key === keys.enabled) {
                if (isEnabled() && isManagedWorker() && isFarmPage() && !state.captchaPaused) {
                    startWorker();
                }
                if (isEnabled() && !isManagedWorker() && !state.captchaPaused) superviseWorker();
                if (!isEnabled()) {
                    stopWorker();
                    closeManagedWorkerWindow(100, false);
                }
                updateUi();
            }

            if (event.key === keys.worker) {
                updateUi();
                if (!isManagedWorker()) superviseWorker();
            }
            if (event.key === keys.assistantStatus && !isManagedWorker() && event.newValue) {
                try {
                    const status = JSON.parse(event.newValue);
                    if (status?.active === false && status.reason) {
                        notify('error', String(status.reason));
                    }
                } catch (_) {
                    // Um estado inválido é simplesmente ignorado.
                }
            }
            if (event.key === keys.settings) {
                state.settings = loadSettings();
                renderSettingsUi();
                if (!state.captchaPaused) loadGroupsIntoPanel();
                if (state.ownsWorker && !state.captchaPaused) resumeRoundWorkflow();
            }
            if (event.key === keys.run) {
                renderModelCounts();
                if (state.ownsWorker && !state.captchaPaused) resumeRoundWorkflow();
                if (!isManagedWorker() && !state.captchaPaused) superviseWorker();
            }
            if (event.key === keys.activeAttacks) {
                renderModelCounts();
                if (state.ownsWorker && !state.captchaPaused) resumeRoundWorkflow();
            }
        });

        window.addEventListener('beforeunload', destroy, { once: true });
        window.addEventListener('pagehide', destroy, { once: true });
        window.addEventListener('pageshow', recoverBackgroundWork);
        window.addEventListener('focus', recoverBackgroundWork);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) recoverBackgroundWork();
        });
    }

    function startBackgroundClock() {
        if (state.backgroundClock || typeof Worker !== 'function') return;
        try {
            const source = `setInterval(function(){postMessage(Date.now())},250);`;
            const blob = new Blob([source], { type: 'text/javascript' });
            const url = URL.createObjectURL(blob);
            const clock = new Worker(url, { name: `TW-PT-AutoFarm-${world}` });
            state.backgroundClock = clock;
            state.backgroundClockUrl = url;
            clock.addEventListener('message', handleBackgroundPulse);
            clock.addEventListener('error', () => stopBackgroundClock());
        } catch (error) {
            console.warn(
                `[${APP.shortName}] Relógio de segundo plano indisponível; ` +
                'mantida a recuperação normal do browser.',
                error
            );
            stopBackgroundClock();
        }
    }

    function stopBackgroundClock() {
        if (state.backgroundClock) {
            state.backgroundClock.removeEventListener('message', handleBackgroundPulse);
            state.backgroundClock.terminate();
            state.backgroundClock = null;
        }
        if (state.backgroundClockUrl) {
            URL.revokeObjectURL(state.backgroundClockUrl);
            state.backgroundClockUrl = '';
        }
    }

    function handleBackgroundPulse() {
        if (state.destroyed) return;
        const now = Date.now();

        if (
            state.ownsWorker &&
            isEnabled() &&
            now - state.lastHeartbeatAt >= APP.workerHeartbeatMs
        ) {
            publishHeartbeat();
        }

        if (
            state.farmTimer &&
            state.farmDueAt > 0 &&
            state.farmDueAt <= now &&
            !state.farmRunning
        ) {
            clearFarmTimer();
            Promise.resolve().then(runFarmStep);
        }

        if (state.roundTimer && state.roundDueAt > 0 && state.roundDueAt <= now) {
            clearRoundTimer();
            if (automationCanRun() && state.ownsWorker) scheduleRoundWait(ensureRunState());
        }

        if (automationCanRun() && now - state.lastRecoveryAt >= APP.monitorMs) {
            state.lastRecoveryAt = now;
            if (isManagedWorker()) recoverBackgroundWork();
            else superviseWorker();
        }
    }

    function recoverBackgroundWork() {
        if (!isFarmPage() || !automationCanRun() || !state.ownsWorker) return;
        const run = ensureRunState();
        if (run.round.phase === 'farming') {
            if (!state.farmRunning && !state.farmTimer) scheduleFarmStep(50);
            return;
        }
        if (run.round.phase === 'waiting') {
            if (!state.roundTimer) scheduleRoundWait(run);
        }
    }

    function createButton() {
        document.getElementById(APP.buttonId)?.remove();

        const button = document.createElement('button');
        button.id = APP.buttonId;
        button.className = 'tp-theplaguept-script-bar-item';
        button.type = 'button';
        button.innerHTML = `
            <span class="auto-farm-a-launcher-icon">F</span>
            <span data-auto-farm-power role="switch" aria-checked="false"
                title="Ligar ou desligar o AutoFarm">&#x23FB;</span>
            <span data-auto-farm-countdown hidden></span>
        `;
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const power = event.target?.closest?.('[data-auto-farm-power]');
            if (power) {
                if (isEnabled()) disable();
                else enable(false);
                return;
            }
            openWorker(true);
        });

        ensureToolbar().appendChild(button);
        state.button = button;
    }

    function ensureToolbar() {
        let toolbar = document.getElementById(APP.toolbarId);
        if (!toolbar) {
            toolbar = document.createElement('div');
            toolbar.id = APP.toolbarId;
            toolbar.setAttribute('aria-label', 'Botões ThePlaguePT');
            document.body.appendChild(toolbar);
        }
        return toolbar;
    }

    function injectStyles() {
        if (!document.getElementById(APP.toolbarStyleId)) {
            const sharedStyle = document.createElement('style');
            sharedStyle.id = APP.toolbarStyleId;
            sharedStyle.textContent = `
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
            `;
            (document.head || document.documentElement).appendChild(sharedStyle);
        }

        if (document.getElementById(APP.styleId)) return;
        const style = document.createElement('style');
        style.id = APP.styleId;
        style.textContent = `
            #${APP.toolbarId}>#${APP.buttonId}{order:90!important;position:relative!important;width:30px!important;min-width:30px!important;max-width:30px!important;height:28px!important;min-height:28px!important;margin:0!important;padding:0!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;border:1px solid #4f120f!important;border-radius:2px!important;background:linear-gradient(to bottom,#b33a34,#8f2420 55%,#681611)!important;box-shadow:inset 0 1px 0 #ffffff59,inset 0 -1px 0 #00000059,0 2px 5px #00000073!important;color:#fff!important;font:700 10px Verdana,Arial,sans-serif!important;text-shadow:1px 1px 1px #000!important;cursor:pointer!important;overflow:visible!important}
            #${APP.toolbarId}>#${APP.buttonId}.af-ligado{background:linear-gradient(to bottom,#5f9f3d,#3f7c27 55%,#28551a)!important}
            #${APP.toolbarId}>#${APP.buttonId}.af-verificacao{background:linear-gradient(to bottom,#d99a2b,#a86412 55%,#754006)!important}
            #${APP.toolbarId}>#${APP.buttonId}:hover,#${APP.toolbarId}>#${APP.buttonId}:focus-visible{filter:brightness(1.18)!important}
            #${APP.buttonId} .auto-farm-a-launcher-icon{display:block!important;line-height:26px!important}
            #${APP.buttonId} [data-auto-farm-power]{position:absolute!important;right:-7px!important;top:-7px!important;width:15px!important;height:15px!important;display:flex!important;align-items:center!important;justify-content:center!important;border:1px solid #4f120f!important;border-radius:50%!important;background:#a92d27!important;color:#fff!important;font:bold 10px/13px Arial,sans-serif!important;text-shadow:0 1px #000!important;box-shadow:0 1px 3px #0009!important;cursor:pointer!important;pointer-events:auto!important;z-index:4!important}
            #${APP.buttonId}.af-ligado [data-auto-farm-power]{background:#3f8a29!important}
            #${APP.buttonId}.af-verificacao [data-auto-farm-power]{background:#c27b16!important}
            #${APP.buttonId} [data-auto-farm-power]:hover{filter:brightness(1.25)!important}
            #${APP.buttonId} [data-auto-farm-countdown]{position:absolute!important;display:none!important;top:31px!important;left:50%!important;transform:translateX(-50%)!important;min-width:46px!important;padding:3px 5px!important;border:1px solid #4f120f!important;border-radius:2px!important;background:linear-gradient(to bottom,#f6dfaa,#d2a05a)!important;color:#2b1509!important;font:bold 10px Verdana,Arial,sans-serif!important;line-height:13px!important;text-align:center!important;text-shadow:0 1px #fff!important;box-shadow:0 2px 5px #0008!important;white-space:nowrap!important;pointer-events:none!important;z-index:2147483647!important}
            #${APP.buttonId} [data-auto-farm-countdown][hidden]{display:none!important}
            #${APP.buttonId}:hover [data-auto-farm-countdown]:not([hidden]),#${APP.buttonId}:focus-visible [data-auto-farm-countdown]:not([hidden]){display:block!important}
            #${APP.toolbarId}>#${APP.buttonId}::after{content:attr(data-tp-title);position:absolute!important;display:none!important;top:52px!important;left:50%!important;transform:translateX(-50%)!important;min-width:max-content!important;max-width:380px!important;padding:4px 8px!important;border:1px solid #4f120f!important;border-radius:2px!important;background:linear-gradient(to bottom,#f6dfaa,#d2a05a)!important;color:#2b1509!important;font:bold 11px Verdana,Arial,sans-serif!important;text-shadow:0 1px #fff!important;box-shadow:0 2px 6px #0008!important;white-space:nowrap!important;pointer-events:none!important;z-index:2147483647!important}
            #${APP.toolbarId}>#${APP.buttonId}:hover::after,#${APP.toolbarId}>#${APP.buttonId}:focus-visible::after{display:block!important}
            @media(max-width:1919px){
                #${APP.toolbarId}>#${APP.buttonId}::after,
                #${APP.buttonId} [data-auto-farm-countdown]{
                    top:50%!important;
                    left:38px!important;
                    transform:translateY(-50%)!important;
                }
            }
            #${APP.statusId}{margin:5px 0;padding:5px 9px;border:1px solid #c1a264;background:#f4e4b8;color:#3b260f;font:11px Verdana,Arial,sans-serif;box-sizing:border-box}
            #${APP.statusId} strong{margin-right:9px;color:#5d2d12}
            #${APP.statusId} [data-role="state"]{font-weight:bold}
            #${APP.statusId}[data-state="active"] [data-role="state"]{color:#287119}
            #${APP.statusId}[data-state="duplicate"] [data-role="state"],#${APP.statusId}[data-state="waiting"] [data-role="state"]{color:#9a5b0b}
            #${APP.statusId}[data-state="captcha"] [data-role="state"]{color:#a35c00}
            #${APP.statusId}[data-state="off"] [data-role="state"]{color:#8a1c17}
            #${APP.settingsId}{margin:6px 0 9px;border:1px solid #c8a86a;background:#f6e8bd;color:#3c2a14;font:11px Verdana,Arial,sans-serif;box-sizing:border-box}
            #${APP.settingsId} *{box-sizing:border-box}
            #${APP.settingsId} .af-settings-title{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 10px;border-bottom:1px solid #d3b97d;background:linear-gradient(to bottom,#f9edca,#f0dca8);font:17px Georgia,'Times New Roman',serif;color:#3d2915}
            #${APP.settingsId} .af-settings-title small{font:10px Verdana,Arial,sans-serif;color:#80643b}
            #${APP.settingsId} .af-settings-actions{display:flex;align-items:center;gap:8px}
            #${APP.settingsId} .af-settings-timer{display:inline-flex;align-items:center;justify-content:center;min-width:112px;height:25px;padding:3px 7px;border:1px solid #c5a66a;border-radius:3px;background:#f3dfae;color:#77552a;font:bold 9px Verdana,Arial,sans-serif;white-space:nowrap}
            #${APP.settingsId} .af-settings-toggle{min-width:74px;height:27px;padding:3px 10px;border:1px solid #4f120f;border-radius:3px;background:linear-gradient(#b33a34,#8f2420 55%,#681611);box-shadow:inset 0 1px #ffffff59,0 1px 3px #0005;color:#fff;font:bold 11px Verdana,Arial,sans-serif;text-shadow:1px 1px #000;cursor:pointer}
            #${APP.settingsId} .af-settings-toggle.af-ligado{background:linear-gradient(#5f9f3d,#3f7c27 55%,#28551a)}
            #${APP.settingsId} .af-settings-toggle.af-verificacao{background:linear-gradient(#d99a2b,#a86412 55%,#754006)}
            #${APP.settingsId} .af-settings-toggle:hover,#${APP.settingsId} .af-settings-toggle:focus-visible{filter:brightness(1.15)}
            #${APP.settingsId} .af-models-wrap{padding:8px}
            #${APP.settingsId} .af-section-title{display:flex;align-items:center;gap:8px;margin:0 0 6px;color:#75501f;font-weight:bold;letter-spacing:1.2px}
            #${APP.settingsId} .af-section-title::after{content:'';height:1px;flex:1;background:#b99658}
            #${APP.settingsId} .af-model-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
            #${APP.settingsId} .af-model-card{min-width:0;border:1px solid #c4a15d;border-radius:4px;background:#faefd0;box-shadow:0 1px 2px #70502024;overflow:hidden;transition:opacity .15s ease}
            #${APP.settingsId} .af-model-card.af-model-off{opacity:.56}
            #${APP.settingsId} .af-model-head{display:flex;align-items:center;gap:7px;min-height:32px;padding:4px 8px;border-bottom:1px solid #d3b778;background:#f8e8bc}
            #${APP.settingsId} .af-model-badge{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:1px solid #594325;border-radius:4px;background:linear-gradient(#7f6846,#3f3020);box-shadow:inset 0 1px #ffffff73,0 1px 2px #0005;color:#f8e8bd;font:bold 15px Georgia,serif;text-shadow:1px 1px #000}
            #${APP.settingsId} .af-model-name{font-weight:bold;font-size:12px;flex:1}
            #${APP.settingsId} .af-model-counters{display:flex;align-items:stretch;gap:4px}
            #${APP.settingsId} .af-model-count{min-width:78px;padding:2px 5px;border:1px solid #c5a66a;border-radius:5px;background:#f3dfae;color:#77552a;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;white-space:nowrap;line-height:10px}
            #${APP.settingsId} .af-model-count-label{font:normal 7px Verdana,Arial,sans-serif;text-transform:uppercase;letter-spacing:.15px}
            #${APP.settingsId} .af-model-count-value{font:bold 9px Verdana,Arial,sans-serif}
            #${APP.settingsId} .af-switch{display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
            #${APP.settingsId} .af-switch input{position:absolute;opacity:0;pointer-events:none}
            #${APP.settingsId} .af-switch-track{position:relative;width:32px;height:18px;border:1px solid #a37b35;border-radius:10px;background:#ecd8a5;box-shadow:inset 0 1px 2px #0003}
            #${APP.settingsId} .af-switch-track::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#9a855b;box-shadow:0 1px 2px #0005;transition:left .14s ease,background .14s ease}
            #${APP.settingsId} .af-switch input:checked+.af-switch-track{background:#b48335}
            #${APP.settingsId} .af-switch input:checked+.af-switch-track::after{left:16px;background:#f5dfaa}
            #${APP.settingsId} .af-switch input:focus-visible+.af-switch-track{outline:2px solid #3777c7;outline-offset:1px}
            #${APP.settingsId} .af-model-body{padding:5px 8px 7px}
            #${APP.settingsId} .af-filter-row{display:grid;grid-template-columns:minmax(112px,1fr) 18px 52px;align-items:center;gap:5px;min-height:30px;border-bottom:1px dashed #dcc38b}
            #${APP.settingsId} .af-filter-label,#${APP.settingsId} .af-subtitle{color:#806037;font-weight:bold;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
            #${APP.settingsId} .af-filter-label{display:flex;align-items:center;gap:5px;white-space:nowrap}
            #${APP.settingsId} .af-filter-label img{width:16px;height:16px;object-fit:contain}
            #${APP.settingsId} input[type="checkbox"]{width:15px;height:15px;margin:0;accent-color:#76501c;cursor:pointer}
            #${APP.settingsId} input[type="number"]{width:100%;height:24px;padding:2px 5px;border:1px solid #d2b275;border-radius:3px;background:#fffaf0;color:#3b2814;font:11px Verdana,Arial,sans-serif}
            #${APP.settingsId} input:disabled{cursor:not-allowed;opacity:.62;background:#f0e3bf}
            #${APP.settingsId} .af-subtitle{margin:5px 0 4px}
            #${APP.settingsId} .af-loot-types{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding-bottom:5px;border-bottom:1px dashed #dcc38b}
            #${APP.settingsId} .af-check-option{display:flex;align-items:center;gap:4px;min-height:24px;padding:3px 5px;border:1px solid #d4b777;border-radius:3px;background:#fff7df;font-weight:bold;font-size:10px;text-transform:uppercase;color:#77562d;cursor:pointer}
            #${APP.settingsId} .af-reports{display:grid;grid-template-columns:1fr 1fr;gap:4px}
            #${APP.settingsId} .af-report-option{position:relative;display:flex;align-items:center;gap:5px;min-height:24px;padding:3px 6px;border:1px solid #d8c28d;border-radius:3px;background:#eadcaf;color:#7b6743;cursor:pointer;user-select:none}
            #${APP.settingsId} .af-report-option.af-selected{border-color:#9c651b;background:#fff8e5;color:#3f2d18;font-weight:bold}
            #${APP.settingsId} .af-report-option input{position:absolute;opacity:0;pointer-events:none}
            #${APP.settingsId} .af-report-option:focus-within{outline:2px solid #3777c7;outline-offset:1px}
            #${APP.settingsId} .af-report-help{display:block;margin-top:4px;color:#87683d;font-size:8px;line-height:11px}
            #${APP.settingsId} .af-report-dot{width:11px;height:11px;flex:0 0 11px;border-radius:50%;box-shadow:inset 0 1px #fff8,0 1px 2px #0004}
            #${APP.settingsId} .af-blue{background:#2387e8}#${APP.settingsId} .af-green{background:#58bf38}#${APP.settingsId} .af-yellow{background:#ffd21a}#${APP.settingsId} .af-red{background:#df3c2c}
            #${APP.settingsId} .af-red-blue{background:linear-gradient(90deg,#df3c2c 0 50%,#2387e8 50%)}
            #${APP.settingsId} .af-red-yellow{background:linear-gradient(90deg,#df3c2c 0 50%,#ffd21a 50%)}
            #${APP.settingsId} .af-model-off .af-model-body{pointer-events:none}
            #${APP.settingsId} .af-general-wrap{margin-top:8px;padding-top:7px;border-top:1px solid #c6a767}
            #${APP.settingsId} .af-general-grid{display:grid;grid-template-columns:minmax(320px,390px) minmax(240px,320px);justify-content:start;gap:6px;max-width:716px}
            #${APP.settingsId} .af-general-field{min-height:32px;padding:3px 6px;border:1px solid #d1b475;border-radius:3px;background:#fff4d6;display:grid;grid-template-columns:minmax(96px,1fr) auto;align-items:center;gap:6px;min-width:0}
            #${APP.settingsId} .af-general-field>span{color:#75532b;font-weight:bold;font-size:10px;text-transform:uppercase}
            #${APP.settingsId} .af-general-input{display:flex;align-items:center;justify-content:flex-end;gap:4px;min-width:0}
            #${APP.settingsId} .af-general-input input{width:64px;flex:0 0 64px}
            #${APP.settingsId} .af-general-input small{color:#8a6c3e;font-size:8px;white-space:nowrap}
            #${APP.settingsId} select[data-setting]{width:100%;height:25px;padding:2px 5px;border:1px solid #d2b275;border-radius:3px;background:#fffaf0;color:#3b2814;font:11px Verdana,Arial,sans-serif}
            #${APP.settingsId} .af-group-wrap{margin-top:8px;padding-top:7px;border-top:1px solid #c6a767}
            #${APP.settingsId} .af-group-grid{display:grid;grid-template-columns:minmax(300px,520px) minmax(220px,1fr);align-items:center;gap:8px}
            #${APP.settingsId} .af-group-field{grid-template-columns:135px minmax(160px,1fr)}
            #${APP.settingsId} .af-group-status{min-height:34px;padding:6px 8px;border:1px dashed #d1b475;border-radius:3px;background:#fff4d6;color:#80643b;font-size:9px;line-height:19px}
            #${APP.settingsId} .af-spy-wrap{margin-top:8px;padding-top:7px;border-top:1px solid #c6a767}
            #${APP.settingsId} .af-spy-card{border:1px solid #c4a15d;border-radius:4px;background:#faefd0;box-shadow:0 1px 2px #70502024;overflow:hidden;transition:opacity .15s ease}
            #${APP.settingsId} .af-spy-card.af-spy-off{opacity:.58}
            #${APP.settingsId} .af-spy-head{display:flex;align-items:center;gap:7px;min-height:32px;padding:4px 8px;border-bottom:1px solid #d3b778;background:#f8e8bc}
            #${APP.settingsId} .af-spy-badge{display:inline-flex;align-items:center;justify-content:center;width:24px;height:22px;border:1px solid #594325;border-radius:4px;background:linear-gradient(#55758a,#263d4b);box-shadow:inset 0 1px #ffffff73,0 1px 2px #0005;color:#fff4d2;font-size:14px}
            #${APP.settingsId} .af-spy-badge img{display:block;width:18px;height:18px;object-fit:contain}
            #${APP.settingsId} .af-spy-name{font-weight:bold;font-size:12px;flex:1}
            #${APP.settingsId} .af-spy-status{margin-right:8px;color:#80643b;font-size:9px;white-space:nowrap}
            #${APP.settingsId} .af-spy-body{padding:7px 8px}
            #${APP.settingsId} .af-spy-grid{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:6px}
            #${APP.settingsId} .af-spy-field{min-height:42px;padding:4px 6px;border:1px solid #d1b475;border-radius:3px;background:#fff4d6;display:grid;grid-template-columns:minmax(80px,1fr) 64px;align-items:center;gap:6px}
            #${APP.settingsId} .af-spy-field>span{color:#75532b;font-weight:bold;font-size:9px;text-transform:uppercase;line-height:13px}
            #${APP.settingsId} .af-spy-field input{width:64px}
            #${APP.settingsId} .af-spy-help{display:block;margin-top:6px;color:#87683d;font-size:9px;line-height:13px}
            #${APP.settingsId} .af-spy-off .af-spy-body{pointer-events:none}
            @media(max-width:1100px){#${APP.settingsId} .af-spy-grid{grid-template-columns:repeat(2,minmax(150px,1fr))}}
            @media(max-width:800px){#${APP.settingsId} .af-general-grid{grid-template-columns:minmax(0,1fr);max-width:none}}
            @media(max-width:800px){#${APP.settingsId} .af-group-grid{grid-template-columns:1fr}}
            @media(max-width:950px){#${APP.settingsId} .af-model-grid{grid-template-columns:1fr}#${APP.settingsId} .af-settings-title{font-size:17px}}
            @media(max-width:620px){#${APP.settingsId} .af-spy-grid{grid-template-columns:1fr}}
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function createWorkerPanel() {
        let panel = document.getElementById(APP.statusId);
        if (!panel) {
            panel = document.createElement('div');
            panel.id = APP.statusId;
            panel.innerHTML = `
                <strong>${escapeHtml(APP.name)} v${APP.version}</strong>
                <span data-role="state"></span>
            `;

            const anchor = document.querySelector('#am_widget_Farm, #content_value, #contentContainer');
            if (anchor?.parentNode) anchor.parentNode.insertBefore(panel, anchor);
            else document.body.prepend(panel);
        }
        state.panel = panel;
    }

    function createModelsPanel() {
        let panel = document.getElementById(APP.settingsId);
        if (!panel) {
            panel = document.createElement('section');
            panel.id = APP.settingsId;
            panel.setAttribute('aria-label', 'Definições dos modelos do AutoFarm');
            panel.innerHTML = `
                <header class="af-settings-title">
                    <span>Auto Farm — Definições <small>v${APP.version}</small></span>
                    <span class="af-settings-actions">
                        <small data-role="saved">Guardado automaticamente</small>
                        <span class="af-settings-timer" data-role="settings-timer">A iniciar…</span>
                        <button id="${APP.settingsToggleId}" class="af-settings-toggle" type="button">Ligar</button>
                    </span>
                </header>
                <div class="af-models-wrap">
                    <div class="af-section-title">MODELOS</div>
                    <div class="af-model-grid">
                        ${modelCard('a', 'A')}
                        ${modelCard('b', 'B')}
                        ${modelCard('c', 'C')}
                    </div>
                    <div class="af-general-wrap">
                        <div class="af-section-title">TEMPOS E RONDAS</div>
                        <div class="af-general-grid">
                            <label class="af-general-field">
                                <span>Entre ataques</span>
                                <span class="af-general-input">
                                    <input type="number" min="223" max="60000" step="1" data-setting="general.attackIntervalMs" aria-label="Intervalo entre ataques em milissegundos" title="Mínimo técnico: 223 ms. Recomendado: 250 ms ou mais.">
                                    <small>ms · ±10% · mín. 223 · ≤5/s</small>
                                </span>
                            </label>
                            <label class="af-general-field">
                                <span>Entre rondas</span>
                                <span class="af-general-input">
                                    <input type="number" min="1" max="86400" step="1" data-setting="general.roundPauseSeconds" aria-label="Pausa entre rondas em segundos">
                                    <small>seg. · ±10%</small>
                                </span>
                            </label>
                        </div>
                    </div>
                    <div class="af-group-wrap">
                        <div class="af-section-title">ALDEIAS DA RONDA</div>
                        <div class="af-group-grid">
                            <label class="af-general-field af-group-field">
                                <span>Grupo que farma</span>
                                <select data-setting="farm.groupId" aria-label="Grupo de aldeias que participa nas rondas">
                                    <option value="0">Todas as aldeias</option>
                                </select>
                            </label>
                            <div class="af-group-status" data-role="group-status">A carregar os grupos e aldeias do jogo…</div>
                        </div>
                    </div>
                    <div class="af-spy-wrap">
                        <div class="af-section-title">ESPIAR ALDEIAS BB</div>
                        <article class="af-spy-card">
                            <header class="af-spy-head">
                                <span class="af-spy-badge" aria-hidden="true"><img src="/graphic/unit/unit_spy.png" alt=""></span>
                                <span class="af-spy-name">Modelo Espião BB</span>
                                <span class="af-spy-status" data-role="spy-status">Inativo</span>
                                <span class="af-model-counters">
                                    <span class="af-model-count" data-spy-active-count>
                                        <span class="af-model-count-label">Ataques em Curso</span>
                                        <strong class="af-model-count-value" data-spy-active-value>0/25</strong>
                                    </span>
                                    <span class="af-model-count" data-spy-round-count>
                                        <span class="af-model-count-label">Enviados na Ronda</span>
                                        <strong class="af-model-count-value" data-spy-round-value>0/25</strong>
                                    </span>
                                </span>
                                <label class="af-switch">
                                    <input class="af-spy-enabled" type="checkbox" data-setting="spy.enabled">
                                    <span class="af-switch-track" aria-hidden="true"></span>
                                    <span>Ativo</span>
                                </label>
                            </header>
                            <div class="af-spy-body">
                                <div class="af-spy-grid">
                                    <label class="af-spy-field">
                                        <span>Batedores/alvo</span>
                                        <input type="number" min="1" max="100" step="1" data-setting="spy.scoutsPerVillage">
                                    </label>
                                    <label class="af-spy-field">
                                        <span>Raio máximo</span>
                                        <input type="number" min="1" max="200" step="1" data-setting="spy.radius">
                                    </label>
                                    <label class="af-spy-field">
                                        <span>Máx. de ataques</span>
                                        <input type="number" min="1" max="500" step="1" data-setting="spy.maxAttacks" title="Máximo de espionagens simultaneamente em curso">
                                    </label>
                                    <label class="af-spy-field">
                                        <span>Entre espionagens (ms) ±10%</span>
                                        <input type="number" min="223" max="60000" step="1" data-setting="spy.intervalMs" title="Mínimo técnico: 223 ms. Recomendado: 250 ms ou mais. Variação automática de ±10%.">
                                    </label>
                                </div>
                                <small class="af-spy-help">Usa ataques diretos com batedores. O máximo limita as espionagens simultaneamente em curso; cada vaga regressa quando o comando volta. Lê o mapa, aceita apenas aldeias com proprietário 0 (bárbaras), ordena pelas mais próximas e ignora alvos já espiados por este módulo.</small>
                            </div>
                        </article>
                    </div>
                </div>
            `;

            panel.addEventListener('change', event => {
                if (
                    !(event.target instanceof HTMLInputElement) &&
                    !(event.target instanceof HTMLSelectElement)
                ) return;
                if (!event.target.dataset.setting) return;
                saveSettingsFromPanel();
            });
            panel.querySelector(`#${APP.settingsToggleId}`)?.addEventListener('click', event => {
                event.preventDefault();
                if (isEnabled()) disable();
                else enable(false);
            });

            if (state.panel?.parentNode) {
                state.panel.insertAdjacentElement('afterend', panel);
            } else {
                const anchor = document.querySelector('#am_widget_Farm, #content_value, #contentContainer');
                if (anchor?.parentNode) anchor.parentNode.insertBefore(panel, anchor);
                else document.body.prepend(panel);
            }
        }

        state.settingsPanel = panel;
        renderSettingsUi();
        if (state.captchaPaused) {
            setSpyStatus('Verificação — em pausa');
            renderCaptchaGroupStatus();
        } else {
            loadGroupsIntoPanel();
        }
    }

    function modelCard(modelKey, letter) {
        const base = `models.${modelKey}`;
        const reportOptions = [
            ['blue', 'Azul', 'af-blue'],
            ['green', 'Verde', 'af-green'],
            ['yellow', 'Amarelo', 'af-yellow'],
            ['red', 'Vermelho', 'af-red'],
            ['redBlue', 'Verm./azul', 'af-red-blue'],
            ['redYellow', 'Verm./amar.', 'af-red-yellow'],
        ];

        return `
            <article class="af-model-card" data-model="${modelKey}">
                <header class="af-model-head">
                    <span class="af-model-badge" aria-hidden="true">${letter}</span>
                    <span class="af-model-name">Modelo ${letter}</span>
                    <span class="af-model-counters">
                        <span class="af-model-count" data-model-active-count="${modelKey}">
                            <span class="af-model-count-label">Ataques em Curso</span>
                            <strong class="af-model-count-value" data-model-active-value="${modelKey}">0/∞</strong>
                        </span>
                        <span class="af-model-count" data-model-round-count="${modelKey}">
                            <span class="af-model-count-label">Enviados na Ronda</span>
                            <strong class="af-model-count-value" data-model-round-value="${modelKey}">0/∞</strong>
                        </span>
                    </span>
                    <label class="af-switch">
                        <input class="af-model-enabled" type="checkbox" data-setting="${base}.enabled">
                        <span class="af-switch-track" aria-hidden="true"></span>
                        <span>Ativo</span>
                    </label>
                </header>
                <div class="af-model-body">
                    <div class="af-filter-row" data-filter="wall">
                        <span class="af-filter-label"><img src="/graphic/buildings/wall.png" alt="">Muralha máx.</span>
                        <input type="checkbox" data-setting="${base}.wall.enabled" aria-label="Limitar muralha do Modelo ${letter}">
                        <input type="number" min="0" max="20" step="1" data-setting="${base}.wall.max" aria-label="Nível máximo de muralha do Modelo ${letter}">
                    </div>
                    <div class="af-filter-row" data-filter="distance">
                        <span class="af-filter-label"><span aria-hidden="true">⚑</span>Distância máx.</span>
                        <input type="checkbox" data-setting="${base}.distance.enabled" aria-label="Limitar distância do Modelo ${letter}">
                        <input type="number" min="0" max="999" step="1" data-setting="${base}.distance.max" aria-label="Distância máxima do Modelo ${letter}">
                    </div>
                    <div class="af-filter-row" data-filter="maxAttacks">
                        <span class="af-filter-label" title="Limita os comandos simultaneamente em curso"><span aria-hidden="true">⚔</span>Máx. de ataques</span>
                        <input type="checkbox" data-setting="${base}.maxAttacks.enabled" aria-label="Limitar ataques simultaneamente em curso do Modelo ${letter}">
                        <input type="number" min="1" max="10000" step="1" data-setting="${base}.maxAttacks.max" aria-label="Máximo de ataques simultaneamente em curso do Modelo ${letter}">
                    </div>
                    <div class="af-filter-row" data-filter="sameVillage">
                        <span class="af-filter-label" title="Limite simultâneo; envia no máximo um novo ataque por alvo em cada ronda"><span aria-hidden="true">↻</span>Ataques/alvo</span>
                        <input type="checkbox" data-setting="${base}.sameVillage.enabled" aria-label="Permitir vários ataques do Modelo ${letter} à mesma aldeia">
                        <input type="number" min="2" max="50" step="1" data-setting="${base}.sameVillage.max" aria-label="Máximo de ataques do Modelo ${letter} simultaneamente em curso para a mesma aldeia">
                    </div>
                    <div class="af-subtitle">Tipo de saque</div>
                    <div class="af-loot-types">
                        <label class="af-check-option">
                            <input type="checkbox" data-setting="${base}.loot.full">
                            <span aria-hidden="true">💰</span>Saque total
                        </label>
                        <label class="af-check-option">
                            <input type="checkbox" data-setting="${base}.loot.partial">
                            <span aria-hidden="true">🪙</span>Saque parcial
                        </label>
                    </div>

                    <div class="af-subtitle">Relatórios</div>
                    <div class="af-reports">
                        ${reportOptions.map(([key, label, dotClass]) => `
                            <label class="af-report-option" data-report="${key}">
                                <input type="checkbox" data-setting="${base}.reports.${key}">
                                <span class="af-report-dot ${dotClass}" aria-hidden="true"></span>
                                <span>${label}</span>
                            </label>
                        `).join('')}
                    </div>
                    <small class="af-report-help">Cada cor é apenas um filtro: marcada permite o envio; desmarcada impede-o. Nenhuma cor tem prioridade.</small>
                </div>
            </article>
        `;
    }

    function saveSettingsFromPanel() {
        if (!state.settingsPanel) return;
        const spyWasEnabled = Boolean(state.settings?.spy?.enabled);
        const previousGroupId = String(state.settings?.farm?.groupId || '0');
        const next = clone(state.settings || DEFAULT_SETTINGS);

        state.settingsPanel.querySelectorAll('input[data-setting],select[data-setting]').forEach(control => {
            const value = control.type === 'checkbox'
                ? control.checked
                : control.type === 'number'
                    ? Number(control.value)
                    : String(control.value);
            setByPath(next, control.dataset.setting, value);
        });

        state.settings = normalizeSettings(next);
        try {
            localStorage.setItem(keys.settings, JSON.stringify(state.settings));
        } catch (error) {
            console.error(`[${APP.shortName}] Não foi possível guardar as definições.`, error);
            notify('error', 'Não foi possível guardar as definições do AutoFarm.');
            return;
        }

        renderSettingsUi();
        showSavedState();
        window.dispatchEvent(new CustomEvent('twPtAutoFarm:settings', {
            detail: { world, settings: clone(state.settings) },
        }));
        if (previousGroupId !== state.settings.farm.groupId) {
            state.farmGeneration += 1;
            clearFarmTimer();
            clearRoundTimer();
            state.farmRunning = false;
            resetRunState();
            loadGroupsIntoPanel();
        }
        if (state.ownsWorker && spyWasEnabled && !state.settings.spy.enabled) {
            const run = ensureRunState();
            if (run.round.phase === 'spying') {
                cancelSpyWork();
                if (run.round.farmCompleted) {
                    completeCurrentVillage(run);
                } else {
                    run.round.phase = 'farming';
                    writeRunState(run);
                    scheduleFarmStep(100);
                }
                return;
            }
        }
        if (state.ownsWorker) resumeRoundWorkflow();
    }

    function renderSettingsUi() {
        if (!state.settingsPanel || !state.settings) return;

        state.settingsPanel.querySelectorAll('input[data-setting],select[data-setting]').forEach(control => {
            const value = getByPath(state.settings, control.dataset.setting);
            if (control.type === 'checkbox') control.checked = Boolean(value);
            else control.value = String(value);
        });

        state.settingsPanel.querySelectorAll('.af-model-card').forEach(card => {
            const modelKey = card.dataset.model;
            const model = state.settings.models[modelKey];
            const active = Boolean(model.enabled);
            card.classList.toggle('af-model-off', !active);

            card.querySelectorAll('input').forEach(input => {
                input.disabled = !active && !input.classList.contains('af-model-enabled');
            });

            card.querySelectorAll('.af-filter-row').forEach(row => {
                const filter = model[row.dataset.filter];
                row.querySelectorAll('input[type="number"]').forEach(input => {
                    input.disabled = !active || !filter.enabled;
                });
            });

            card.querySelectorAll('.af-report-option').forEach(option => {
                const checkbox = option.querySelector('input[type="checkbox"]');
                option.classList.toggle('af-selected', Boolean(checkbox?.checked));
            });
        });

        const spyCard = state.settingsPanel.querySelector('.af-spy-card');
        if (spyCard) {
            const active = Boolean(state.settings.spy.enabled);
            spyCard.classList.toggle('af-spy-off', !active);
            spyCard.querySelectorAll('input').forEach(input => {
                input.disabled = !active && !input.classList.contains('af-spy-enabled');
            });
            if (!state.spyRunning) setSpyStatus(active ? 'Pronto' : 'Inativo');
        }
        renderModelCounts();
    }

    function setSpyStatus(message) {
        const label = state.settingsPanel?.querySelector('[data-role="spy-status"]');
        if (label) label.textContent = String(message || '');
    }

    async function loadGroupsIntoPanel() {
        const select = state.settingsPanel?.querySelector('select[data-setting="farm.groupId"]');
        const status = state.settingsPanel?.querySelector('[data-role="group-status"]');
        if (!select || !status) return;
        if (state.captchaPaused) {
            select.disabled = true;
            status.textContent = 'Verificação do jogo — automação totalmente em pausa.';
            return;
        }
        const generation = ++state.groupsLoadGeneration;
        const selectedId = String(state.settings?.farm?.groupId || '0');
        select.disabled = true;
        status.textContent = 'A carregar os grupos e aldeias do jogo…';

        try {
            const data = await fetchGroupData(selectedId);
            if (generation !== state.groupsLoadGeneration) return;
            select.textContent = '';
            data.groups.forEach(group => {
                const option = document.createElement('option');
                option.value = group.id;
                option.textContent = group.name;
                select.appendChild(option);
            });
            if (!data.groups.some(group => group.id === selectedId)) {
                const option = document.createElement('option');
                option.value = selectedId;
                option.textContent = `Grupo #${selectedId} (indisponível)`;
                select.appendChild(option);
            }
            select.value = selectedId;
            status.textContent = `${data.name}: ${data.villages.length} aldeia(s). ` +
                'A ronda percorre todas as páginas de cada aldeia antes de avançar.';
        } catch (error) {
            if (generation !== state.groupsLoadGeneration) return;
            if (state.captchaPaused) {
                renderCaptchaGroupStatus();
                return;
            }
            ensureSavedGroupOption(select, selectedId);
            select.value = selectedId;
            status.textContent = `Não foi possível atualizar os grupos: ${getAutomationErrorMessage(error).slice(0, 120)}`;
            console.warn(`[${APP.shortName}] Não foi possível carregar os grupos.`, error);
        } finally {
            if (generation === state.groupsLoadGeneration) select.disabled = false;
        }
    }

    function ensureSavedGroupOption(select, groupId) {
        if (!Array.from(select.options).some(option => option.value === '0')) {
            select.add(new Option('Todas as aldeias', '0'));
        }
        if (!Array.from(select.options).some(option => option.value === groupId)) {
            select.add(new Option(`Grupo guardado #${groupId}`, groupId));
        }
    }

    async function fetchGroupData(groupId) {
        const modes = ['units', 'combined'];
        const groups = [];
        const seenGroups = new Set();
        let lastError = null;
        let received = false;

        for (const mode of modes) {
            try {
                const page = await requestBackgroundPage(buildGroupOverviewUrl(groupId, mode), 30000);
                const documentValue = new DOMParser().parseFromString(page.text, 'text/html');
                if (hasCaptchaChallenge(documentValue)) {
                    throw new Error('O jogo pediu uma verificação antes de listar os grupos.');
                }
                received = true;
                extractGameGroups(documentValue).forEach(group => {
                    if (!seenGroups.has(group.id)) {
                        seenGroups.add(group.id);
                        groups.push(group);
                    }
                });
                const villages = extractGroupVillages(documentValue);
                if (villages.length) {
                    const selected = groups.find(group => group.id === String(groupId));
                    return {
                        groups: ensureAllVillagesGroup(groups),
                        villages,
                        name: selected?.name || (String(groupId) === '0' ? 'Todas as aldeias' : `Grupo #${groupId}`),
                    };
                }
            } catch (error) {
                lastError = error;
                if (/verificação/i.test(getAutomationErrorMessage(error))) throw error;
            }
        }

        if (!received && lastError) throw lastError;
        const normalizedGroups = ensureAllVillagesGroup(groups);
        const selected = normalizedGroups.find(group => group.id === String(groupId));
        if (String(groupId) !== '0' && !selected) {
            throw new Error('O grupo escolhido já não existe ou não pôde ser lido.');
        }
        return {
            groups: normalizedGroups,
            villages: [],
            name: selected?.name || 'Todas as aldeias',
        };
    }

    function buildGroupOverviewUrl(groupId, mode) {
        const url = new URL(window.location.href);
        url.searchParams.set('screen', 'overview_villages');
        url.searchParams.set('mode', mode);
        if (mode === 'units') {
            url.searchParams.set('type', 'complete');
            url.searchParams.set('units_type', 'complete');
        } else {
            url.searchParams.delete('type');
            url.searchParams.delete('units_type');
        }
        url.searchParams.set('group', String(groupId));
        url.searchParams.set('page', '-1');
        ['action', 'ajax', 'h'].forEach(key => url.searchParams.delete(key));
        url.hash = '';
        return url.href;
    }

    function extractGameGroups(documentValue) {
        const groups = [];
        const seen = new Set();
        documentValue.querySelectorAll([
            '#group_selection option',
            'select[name="group"] option',
            'select[id*="group"] option',
        ].join(',')).forEach(option => {
            const id = String(option.value || '').trim();
            if (!/^-?\d+$/.test(id) || seen.has(id)) return;
            seen.add(id);
            groups.push({ id, name: option.textContent.trim() || `Grupo #${id}` });
        });
        return ensureAllVillagesGroup(groups);
    }

    function ensureAllVillagesGroup(groupsValue) {
        const groups = Array.isArray(groupsValue) ? groupsValue.slice() : [];
        if (!groups.some(group => group.id === '0')) {
            groups.unshift({ id: '0', name: 'Todas as aldeias' });
        }
        return groups;
    }

    function extractGroupVillages(documentValue) {
        const villages = [];
        const seen = new Set();
        const rows = documentValue.querySelectorAll([
            '#units_table tr',
            '#combined_table tr',
            '#production_table tr',
            '#buildings_table tr',
            'table.overview_table tr',
            'table.vis tr',
        ].join(','));
        rows.forEach(row => {
            if (!/\d{1,3}\s*[|]\s*\d{1,3}/.test(row.textContent || '')) return;
            let id = '';
            const link = row.querySelector('a[href*="village="]');
            if (link) {
                try {
                    id = new URL(link.href, window.location.href).searchParams.get('village') || '';
                } catch (_) {
                    id = '';
                }
            }
            if (!/^\d+$/.test(id)) {
                const marked = row.matches('[data-village-id],[data-id]')
                    ? row
                    : row.querySelector('[data-village-id],[data-id]');
                id = String(marked?.getAttribute('data-village-id') || marked?.getAttribute('data-id') || '');
            }
            if (/^\d+$/.test(id) && Number(id) > 0 && !seen.has(id)) {
                seen.add(id);
                villages.push(id);
            }
        });
        return villages;
    }

    function showSavedState() {
        const label = state.settingsPanel?.querySelector('[data-role="saved"]');
        if (!label) return;
        window.clearTimeout(state.savedTimer);
        label.textContent = '✓ Guardado agora';
        state.savedTimer = window.setTimeout(() => {
            label.textContent = 'Guardado automaticamente';
        }, 1600);
    }

    function startCaptchaProtection() {
        state.captchaObserver?.disconnect();
        state.captchaObserver = new MutationObserver(() => {
            window.clearTimeout(state.captchaCheckTimer);
            state.captchaCheckTimer = window.setTimeout(() => {
                state.captchaCheckTimer = 0;
                monitorCaptchaProtection();
            }, APP.captchaObserveDebounceMs);
        });
        if (document.documentElement) {
            state.captchaObserver.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['id', 'class', 'src', 'data-sitekey', 'data-bot-protect'],
            });
        }
        monitorCaptchaProtection();
    }

    function monitorCaptchaProtection() {
        if (state.destroyed) return true;
        if (hasCaptchaChallenge(document)) {
            pauseForCaptcha('página do jogo');
            return true;
        }
        if (state.captchaPaused) {
            scheduleCaptchaResumeCheck();
            return true;
        }
        return false;
    }

    function hasCaptchaChallenge(documentValue) {
        if (!documentValue?.documentElement) return false;
        if (documentValue.body?.hasAttribute('data-bot-protect')) return true;
        if (documentValue.querySelector([
            '#bot_check',
            '#botprotection_quest',
            '#captcha',
            '#captcha_form',
            '[id^="captcha" i]',
            '[id*="recaptcha" i]',
            '[id*="hcaptcha" i]',
            '.captcha',
            '.captcha-container',
            '.g-recaptcha',
            '.h-captcha',
            '[data-sitekey]',
            '[data-hcaptcha-widget-id]',
            'iframe[src*="recaptcha" i]',
            'iframe[src*="hcaptcha" i]',
            'iframe[src*="turnstile" i]',
            'textarea[name="g-recaptcha-response"]',
            'textarea[name="h-captcha-response"]',
            'input[name*="captcha" i]',
            'form[action*="captcha" i]',
        ].join(','))) return true;

        const text = getCaptchaReadableText(documentValue);
        if (/(?:protecao contra bots|verificacao (?:da |de )?protecao (?:de |do )?bot|antes de poderes continuar a jogar|bot protection (?:check|verification)|verify (?:that )?you are human)/i.test(text)) {
            return true;
        }
        return Array.from(documentValue.querySelectorAll([
            '#error',
            '.error_box',
            '.error-message',
            '.error-msg',
            '.ui-state-error',
            '#notifications .error',
            '.notification.error',
        ].join(','))).some(element => isCaptchaMessage(element.textContent));
    }

    function getCaptchaReadableText(documentValue) {
        const body = documentValue?.body;
        if (!body) return '';
        if (documentValue === document && typeof body.innerText === 'string') {
            const copy = body.cloneNode(true);
            removeAutomationUiFromClone(copy);
            return normalizeText(copy.innerText || copy.textContent || '');
        }
        const copy = body.cloneNode(true);
        removeAutomationUiFromClone(copy);
        copy.querySelectorAll('script,style,noscript,template,svg').forEach(element => element.remove());
        return normalizeText(copy.textContent || '');
    }

    function removeAutomationUiFromClone(root) {
        if (!root?.querySelectorAll) return;

        root.querySelectorAll([
            '#tp-theplaguept-script-bar',
            '#tw-discord-alerts-ui',
            '#tw-discord-alerts-panel',
            '#popup_box_twDiscordAlertsSettings',
            '#twPtAutoFarm-worker-status',
            '#twPtAutoFarm-settings',
            '#auto-farm-a-settings',
            '#auto-farm-a-toggle',
            '[data-tw-alerts-settings]',
            '[data-tp-title]'
        ].join(',')).forEach(element => element.remove());
    }

    function responseHasCaptcha(html) {
        const source = String(html || '');
        if (!/<(?:!doctype|html|body|form|iframe|div|script)\b/i.test(source)) return false;
        const documentValue = new DOMParser().parseFromString(source, 'text/html');
        if (hasCaptchaChallenge(documentValue)) return true;
        const bodyText = getCaptchaReadableText(documentValue);
        return bodyText.length > 0 && bodyText.length <= 1500 && isCaptchaMessage(bodyText);
    }

    function pauseForCaptcha(source, revealOnPage = false) {
        const wasPaused = state.captchaPaused;
        state.captchaPaused = true;
        try {
            sessionStorage.setItem(keys.captchaPause, '1');
        } catch (_) {
            // A pausa continua válida nesta página mesmo sem armazenamento disponível.
        }
        window.clearTimeout(state.captchaResumeTimer);
        state.captchaResumeTimer = 0;
        if (wasPaused) {
            scheduleCaptchaRevealReload(revealOnPage);
            return true;
        }
        stopFarmLoop();
        setSpyStatus('Verificação — em pausa');
        renderCaptchaGroupStatus();
        updateUi();

        if (!wasPaused) {
            console.warn(`[${APP.shortName}] Automação pausada por verificação do jogo (${source}).`);
            notify('error', 'Verificação do jogo detetada. O AutoFarm foi totalmente pausado; resolve-a manualmente.');
        }

        scheduleCaptchaRevealReload(revealOnPage);
        return true;
    }

    function scheduleCaptchaRevealReload(revealOnPage) {
        if (revealOnPage && !hasCaptchaChallenge(document) && !state.captchaReloadTimer) {
            state.captchaReloadTimer = window.setTimeout(() => {
                state.captchaReloadTimer = 0;
                if (state.captchaPaused && !state.destroyed) window.location.reload();
            }, 250);
        }
    }

    function scheduleCaptchaResumeCheck() {
        if (!state.captchaPaused || state.captchaResumeTimer || state.destroyed) return;
        state.captchaResumeTimer = window.setTimeout(() => {
            state.captchaResumeTimer = 0;
            if (hasCaptchaChallenge(document)) {
                pauseForCaptcha('página do jogo');
                return;
            }

            state.captchaPaused = false;
            try {
                sessionStorage.removeItem(keys.captchaPause);
            } catch (_) {
                // O estado local já foi libertado.
            }
            updateUi();
            notify('success', 'Verificação resolvida. O AutoFarm pode continuar.');

            if (!isEnabled() || !isFarmPage() || state.destroyed) return;
            if (!document.querySelector('#am_widget_Farm')) {
                window.location.reload();
                return;
            }
            loadGroupsIntoPanel();
            loadWorldUnitSpeed();
            if (state.ownsWorker) resumeRoundWorkflow();
            else if (isManagedWorker()) startWorker();
            else superviseWorker();
        }, APP.captchaResumeMs);
    }

    function renderCaptchaGroupStatus() {
        const status = state.settingsPanel?.querySelector('[data-role="group-status"]');
        const select = state.settingsPanel?.querySelector('select[data-setting="farm.groupId"]');
        if (select) select.disabled = true;
        if (status) status.textContent = 'Verificação do jogo — automação totalmente em pausa.';
    }

    function automationCanRun() {
        return isEnabled() && !state.captchaPaused && !state.destroyed;
    }

    function enable(openTab) {
        if (getFarmAssistantAccessState() === false) {
            stopForUnavailableAssistant(
                'Não é possível ligar: o Assistente de Saque não está ativo nesta conta.'
            );
            return;
        }
        const wasEnabled = isEnabled();
        if (!wasEnabled) resetRunState();
        else ensureRunState();
        localStorage.removeItem(keys.assistantStatus);
        localStorage.setItem(keys.enabled, '1');
        state.popupBlocked = false;
        state.nextWorkerOpenAttemptAt = 0;

        if (hasCaptchaChallenge(document)) pauseForCaptcha('página do jogo');

        if (!state.captchaPaused) {
            if (isManagedWorker() && isFarmPage()) startWorker();
            else if (openTab) openWorker(true);
            else superviseWorker();
            notify('success', `${APP.shortName} ligado em ${world}.`);
        }
        updateUi();
    }

    function disable() {
        localStorage.setItem(keys.enabled, '0');
        state.popupBlocked = false;
        clearWorkerOpening(false);
        stopWorker();
        if (!isManagedWorker() && state.workerWindow && !state.workerWindow.closed) {
            try {
                state.workerWindow.close();
            } catch (_) {
                // O navegador pode já ter eliminado a referência ao separador.
            }
            state.workerWindow = null;
            state.managerOpenedWorker = false;
        }
        state.managerOpenedWorker = false;
        closeManagedWorkerWindow(100, false);
        updateUi();
        notify('success', `${APP.shortName} desligado em ${world}.`);
    }

    function stopForUnavailableAssistant(reason) {
        const message = String(reason || 'O Assistente de Saque não está disponível.');
        localStorage.setItem(keys.assistantStatus, JSON.stringify({
            active: false,
            reason: message,
            updatedAt: Date.now(),
        }));
        localStorage.setItem(keys.enabled, '0');
        localStorage.removeItem(keys.worker);
        clearWorkerOpening(false);
        state.popupBlocked = false;
        state.nextWorkerOpenAttemptAt = Number.POSITIVE_INFINITY;
        stopWorker();
        updateUi();
        notify('error', message);
        closeManagedWorkerWindow(150, false);
    }

    function openWorker(fromUserGesture) {
        if (state.captchaPaused || hasCaptchaChallenge(document)) {
            pauseForCaptcha('página do jogo');
            return null;
        }

        if (getFarmAssistantAccessState() === false) {
            stopForUnavailableAssistant(
                'Não é possível abrir: o Assistente de Saque não está ativo nesta conta.'
            );
            return null;
        }

        if (isManagedWorker() && isFarmPage()) {
            startWorker();
            updateUi();
            return window;
        }

        const opening = readWorkerOpening();
        if (isFreshWorkerOpening(opening)) {
            updateUi();
            return state.workerWindow && !state.workerWindow.closed
                ? state.workerWindow
                : null;
        }
        if (opening) clearWorkerOpening(false);

        const controllerHadFocus = typeof document.hasFocus === 'function'
            ? document.hasFocus()
            : !document.hidden;
        const existingWorker = readWorker();
        const freshExistingWorker = isFreshWorker(existingWorker);
        const liveWorkerReference = state.workerWindow && !state.workerWindow.closed;
        if (liveWorkerReference && state.managerOpenedWorker) {
            updateUi();
            return state.workerWindow;
        }
        if (
            freshExistingWorker ||
            (liveWorkerReference && Date.now() < state.nextWorkerOpenAttemptAt)
        ) {
            updateUi();
            return liveWorkerReference ? state.workerWindow : null;
        }

        const run = prepareRoundForWorkerOpen(fromUserGesture && isEnabled());
        if (run.round.phase === 'waiting' && run.round.pauseUntil > Date.now()) {
            updateUi();
            return null;
        }

        const url = new URL(buildFarmUrl());
        url.searchParams.set(workerUrlParameter, '1');
        url.hash = `${workerUrlParameter}=1`;
        if (!claimWorkerOpening(url.href)) {
            updateUi();
            return null;
        }
        let worker = null;
        let openedByManager = false;
        if (typeof GM_openInTab === 'function') {
            try {
                worker = GM_openInTab(url.href, {
                    active: false,
                    insert: true,
                    setParent: true,
                });
                openedByManager = Boolean(worker);
            } catch (error) {
                console.warn(
                    `[${APP.shortName}] A abertura em segundo plano não ficou disponível.`,
                    error
                );
            }
        }
        if (!worker) {
            try {
                worker = window.open(url.href, workerWindowName);
            } catch (error) {
                console.error(`[${APP.shortName}] Não foi possível abrir o worker.`, error);
            }
        }

        if (!worker) {
            clearWorkerOpening();
            state.popupBlocked = true;
            state.nextWorkerOpenAttemptAt = Date.now() + workerOpenRetryMs;
            updateUi();
            if (fromUserGesture) {
                notify('error', 'O browser bloqueou o separador do Assistente de Saque. Autoriza pop-ups para este mundo e clica novamente no botão F.');
            }
            return null;
        }

        state.workerWindow = worker;
        state.managerOpenedWorker = openedByManager;
        state.nextWorkerOpenAttemptAt = Date.now() + workerOpenRetryMs;
        state.popupBlocked = false;
        if (openedByManager && 'onclose' in worker) {
            worker.onclose = () => {
                if (state.workerWindow !== worker) return;
                state.workerWindow = null;
                state.managerOpenedWorker = false;
                clearWorkerOpening();
                state.nextWorkerOpenAttemptAt = Date.now() + workerOpenRetryMs;
                if (!state.destroyed) superviseWorker();
            };
        }
        if (!openedByManager) {
            try {
                worker.blur();
                if (controllerHadFocus) window.focus();
            } catch (_) {
                // Alguns browsers não permitem controlar o foco de outro separador.
            }
        }

        notify('success', 'Assistente de Saque aberto num separador próprio. A página atual não foi alterada.');
        updateUi();
        return worker;
    }

    function buildFarmUrl() {
        const url = new URL(window.location.href);
        ['mode', 'action', 'page', 'Farm_page', 'farm_page', 'ajax', 'ajaxaction', 'view'].forEach(name => {
            url.searchParams.delete(name);
        });
        url.searchParams.set('screen', 'am_farm');
        url.searchParams.set('group', String(state.settings?.farm?.groupId || '0'));

        const villageId = getVillageId();
        if (villageId) url.searchParams.set('village', villageId);
        return url.toString();
    }

    function prepareRoundForWorkerOpen(forceStart = false) {
        const run = ensureRunState();
        if (
            run.round.phase === 'waiting' &&
            (forceStart || run.round.pauseUntil <= Date.now())
        ) {
            run.round.number += 1;
            run.round.pauseUntil = 0;
            resetRoundTargetCapacity(run);
            run.round.phase = 'start_reloading';
            writeRunState(run);
        }
        return run;
    }

    function superviseWorker() {
        if (
            isManagedWorker() ||
            !isEnabled() ||
            state.captchaPaused ||
            state.destroyed
        ) return;

        if (state.workerWindow?.closed) {
            state.workerWindow = null;
            state.managerOpenedWorker = false;
        }
        const heartbeat = readWorker();
        const opening = readWorkerOpening();
        const liveWorkerReference = state.workerWindow && !state.workerWindow.closed;
        if (
            isFreshWorker(heartbeat) ||
            (liveWorkerReference && Date.now() < state.nextWorkerOpenAttemptAt)
        ) {
            updateUi();
            return;
        }
        if (heartbeat && !isFreshWorker(heartbeat)) localStorage.removeItem(keys.worker);
        if (isFreshWorkerOpening(opening)) {
            updateUi();
            return;
        }
        if (opening) clearWorkerOpening(false);

        const run = prepareRoundForWorkerOpen();
        if (run.round.phase === 'waiting' && run.round.pauseUntil > Date.now()) {
            updateUi();
            return;
        }
        if (Date.now() < state.nextWorkerOpenAttemptAt) return;
        openWorker(false);
    }

    function closeManagedWorkerWindow(delayMs, preserveCaptcha = true) {
        if (!isManagedWorker() || state.closingWorker) return;
        state.closingWorker = true;
        window.setTimeout(() => {
            if (preserveCaptcha && state.captchaPaused) {
                state.closingWorker = false;
                return;
            }
            stopWorker();
            try {
                if (typeof closeCurrentTab === 'function') closeCurrentTab();
                else window.close();
            } catch (error) {
                console.warn(`[${APP.shortName}] O navegador não permitiu fechar o separador.`, error);
            }
        }, Math.max(0, Number(delayMs) || 0));
    }

    function startWorker() {
        if (
            !isFarmPage() ||
            !isManagedWorker() ||
            !automationCanRun() ||
            state.ownsWorker ||
            state.acquiringWorker
        ) return;

        state.acquiringWorker = true;
        state.duplicateWorker = false;
        updateUi();

        if (navigator.locks?.request) {
            navigator.locks.request(workerLockName, { mode: 'exclusive', ifAvailable: true }, async lock => {
                state.acquiringWorker = false;
                if (!lock || !automationCanRun()) {
                    state.duplicateWorker = Boolean(!lock);
                    updateUi();
                    return;
                }

                claimWorker();
                await new Promise(resolve => {
                    state.releaseLock = resolve;
                });
            }).catch(error => {
                state.acquiringWorker = false;
                console.warn(`[${APP.shortName}] Web Lock indisponível; a usar controlo local.`, error);
                startFallbackLease();
            });
            return;
        }

        state.acquiringWorker = false;
        startFallbackLease();
    }

    function claimWorker() {
        if (!automationCanRun()) return;
        ensureRunState();
        state.ownsWorker = true;
        state.duplicateWorker = false;
        publishHeartbeat();
        window.clearInterval(state.heartbeatTimer);
        state.heartbeatTimer = window.setInterval(publishHeartbeat, APP.workerHeartbeatMs);
        updateUi();
        startFarmLoop();
        syncActiveAttacksWithGame(false);
    }

    function startFallbackLease() {
        const current = readWorker();
        if (isFreshWorker(current) && current.tabId !== tabId) {
            state.duplicateWorker = true;
            updateUi();
            return;
        }

        claimWorker();
        window.clearInterval(state.fallbackLeaseTimer);
        state.fallbackLeaseTimer = window.setInterval(() => {
            const worker = readWorker();
            if (isFreshWorker(worker) && worker.tabId !== tabId) {
                stopWorker(false);
                state.duplicateWorker = true;
                updateUi();
            }
        }, APP.workerHeartbeatMs + 400);
    }

    function publishHeartbeat() {
        if (!state.ownsWorker || !isEnabled()) return;
        state.lastHeartbeatAt = Date.now();
        const heartbeat = {
            tabId,
            world,
            version: APP.version,
            state: state.captchaPaused ? 'captcha' : 'ready',
            villageId: getVillageId(),
            url: window.location.href,
            updatedAt: state.lastHeartbeatAt,
        };
        localStorage.setItem(keys.worker, JSON.stringify(heartbeat));
        clearWorkerOpening(false);
        updateUi();
    }

    function stopWorker(releaseLock = true) {
        stopFarmLoop();
        window.clearInterval(state.heartbeatTimer);
        window.clearInterval(state.fallbackLeaseTimer);
        state.heartbeatTimer = 0;
        state.fallbackLeaseTimer = 0;

        const current = readWorker();
        if (current?.tabId === tabId) localStorage.removeItem(keys.worker);

        state.ownsWorker = false;
        state.acquiringWorker = false;
        if (!isEnabled()) state.duplicateWorker = false;

        if (releaseLock && state.releaseLock) {
            const release = state.releaseLock;
            state.releaseLock = null;
            release();
        }
        updateUi();
    }

    function startMonitor() {
        window.clearInterval(state.monitorTimer);
        state.monitorTimer = window.setInterval(() => {
            if (state.workerWindow?.closed) {
                state.workerWindow = null;
                state.managerOpenedWorker = false;
            }
            if (monitorCaptchaProtection()) {
                updateUi();
                return;
            }
            if (
                isManagedWorker() &&
                isFarmPage() &&
                isEnabled() &&
                !state.ownsWorker &&
                !state.acquiringWorker
            ) {
                const worker = readWorker();
                if (!isFreshWorker(worker)) startWorker();
            }
            if (isManagedWorker() && isFarmPage() && isEnabled() && state.ownsWorker) {
                syncActiveAttacksWithGame(false);
            }
            if (!isManagedWorker()) superviseWorker();
            updateUi();
        }, APP.monitorMs);
    }

    function startSettingsTimer() {
        window.clearInterval(state.settingsTimerInterval);
        state.settingsTimerInterval = window.setInterval(renderSettingsTimer, 1000);
        renderSettingsTimer();
    }

    function renderSettingsTimer() {
        const display = state.settingsPanel?.querySelector('[data-role="settings-timer"]');
        if (!display) return;

        const now = Date.now();
        const run = readRunState();
        let text = 'Em execução';
        let title = 'AutoFarm em execução';

        if (!isEnabled()) {
            text = 'Desligado';
            title = 'AutoFarm desligado';
        } else if (state.captchaPaused) {
            text = 'CAPTCHA — pausa';
            title = 'AutoFarm pausado até a verificação ser resolvida';
        } else if (run?.round?.phase === 'waiting' && run.round.pauseUntil > now) {
            const remaining = formatShortDuration(run.round.pauseUntil - now);
            text = `Nova ronda ${remaining}`;
            title = `Tempo até ao início da próxima ronda: ${remaining}`;
        } else if (!state.ownsWorker && state.acquiringWorker) {
            text = 'A iniciar…';
            title = 'A preparar o worker deste mundo';
        } else if (!state.ownsWorker) {
            text = 'A aguardar worker';
            title = 'A aguardar o worker deste mundo';
        } else if (state.farmRunning) {
            text = 'A enviar…';
            title = 'A processar o próximo envio';
        } else {
            text = 'Ronda em curso';
            title = 'A percorrer as aldeias da ronda atual';
        }

        display.textContent = text;
        display.title = title;
    }

    function formatShortDuration(milliseconds) {
        const totalSeconds = Math.max(0, Math.ceil((Number(milliseconds) || 0) / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        return hours > 0
            ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
            : `${minutes}:${seconds}`;
    }

    function updateUi() {
        const enabled = isEnabled();
        const captchaPaused = enabled && state.captchaPaused;
        const visualState = captchaPaused ? 'captcha' : (enabled ? 'on' : 'off');
        const label = captchaPaused ? 'Pausado — verificação/CAPTCHA' : (enabled ? 'Ligado' : 'Desligado');
        const panelState = captchaPaused ? 'captcha' : (enabled ? 'active' : 'off');

        if (state.button) {
            state.button.dataset.state = visualState;
            state.button.classList.toggle('af-ligado', enabled && !captchaPaused);
            state.button.classList.toggle('af-verificacao', captchaPaused);
            state.button.dataset.tpTitle = captchaPaused
                ? `${APP_DISPLAY_TITLE}: ${label}. Clique em F para abrir o separador e resolver manualmente; clique em ⏻ para desligar.`
                : `${APP_DISPLAY_TITLE}: ${label}. Clique em F para abrir ou focar; clique em ⏻ para ligar/desligar.`;
            state.button.setAttribute('aria-label', state.button.dataset.tpTitle);
            state.button.removeAttribute('aria-pressed');
            const power = state.button.querySelector('[data-auto-farm-power]');
            if (power) {
                power.setAttribute('aria-checked', enabled ? 'true' : 'false');
                power.setAttribute('title', enabled ? 'Desligar AutoFarm' : 'Ligar AutoFarm');
            }
        }

        const settingsToggle = document.getElementById(APP.settingsToggleId);
        if (settingsToggle) {
            settingsToggle.textContent = enabled ? 'Desligar' : 'Ligar';
            settingsToggle.classList.toggle('af-ligado', enabled && !captchaPaused);
            settingsToggle.classList.toggle('af-verificacao', captchaPaused);
            settingsToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
            settingsToggle.setAttribute('aria-label', enabled ? 'Desligar AutoFarm' : 'Ligar AutoFarm');
        }

        if (state.panel) {
            state.panel.dataset.state = panelState;
            const status = state.panel.querySelector('[data-role="state"]');
            if (status) status.textContent = label;
        }
        const round = readRunState()?.round;
        renderGroupRoundStatus(round);
        renderSettingsTimer();
        if (enabled && !captchaPaused && round?.phase === 'waiting' && round.pauseUntil > Date.now()) {
            showRoundCountdown(Math.ceil((round.pauseUntil - Date.now()) / 1000));
        } else if (!enabled || round?.phase !== 'waiting') {
            hideRoundCountdown();
        }
        renderModelCounts();
    }

    function renderGroupRoundStatus(round) {
        const label = state.settingsPanel?.querySelector('[data-role="group-status"]');
        if (!label || !round?.villages?.length || !round.groupName) return;
        const current = getVillageId() || round.currentVillageId;
        const index = Math.max(0, round.villages.indexOf(current));
        const page = getFarmPageDescriptor(new URL(window.location.href)).number + 1;
        label.textContent = `${round.groupName}: aldeia ${index + 1}/${round.villages.length} · ` +
            `página ${page} · concluídas ${round.completedVillages.length}/${round.villages.length}` +
            `.`;
    }

    function startFarmLoop() {
        if (!isFarmPage() || !automationCanRun() || !state.ownsWorker) return;
        resumeRoundWorkflow();
    }

    function stopFarmLoop() {
        state.farmGeneration += 1;
        state.spyAbortController?.abort();
        state.spyAbortController = null;
        clearFarmTimer();
        clearRoundTimer();
        state.farmRunning = false;
        state.spyRunning = false;
        state.roundPreparing = false;
        state.villagePreparing = false;
        state.idleScans = 0;
        state.pageDeferredCandidates = 0;
        state.pageFinalCheckDone = false;
        state.pendingTargetDueAt = 0;
        setSpyStatus(state.settings?.spy?.enabled ? 'Pronto' : 'Inativo');
        hideRoundCountdown();
    }

    function clearFarmTimer() {
        window.clearTimeout(state.farmTimer);
        state.farmTimer = 0;
        state.farmDueAt = 0;
        state.farmTimerToken += 1;
    }

    function clearRoundTimer() {
        window.clearTimeout(state.roundTimer);
        state.roundTimer = 0;
        state.roundDueAt = 0;
        state.roundTimerToken += 1;
    }

    function scheduleFarmStep(delayMs) {
        clearFarmTimer();
        if (!isFarmPage() || !automationCanRun() || !state.ownsWorker || state.farmRunning) return;
        const delay = Math.max(50, Number(delayMs) || 50);
        const token = state.farmTimerToken;
        state.farmDueAt = Date.now() + delay;
        state.farmTimer = window.setTimeout(() => {
            if (token !== state.farmTimerToken) return;
            state.farmTimer = 0;
            state.farmDueAt = 0;
            runFarmStep();
        }, delay);
    }

    async function runFarmStep() {
        state.farmTimer = 0;
        state.farmDueAt = 0;
        if (!automationCanRun() || !state.ownsWorker || state.farmRunning) return;
        if (ensureRunState().round.phase !== 'farming') {
            resumeRoundWorkflow();
            return;
        }

        const generation = state.farmGeneration;
        state.farmRunning = true;
        let task = null;
        let finishRequested = false;
        let changeVillageRequested = false;
        let pendingDelay = 0;
        let retryDelay = 0;
        try {
            task = findNextFarmTask();
            if (task) {
                state.idleScans = 0;
                const outcome = await sendFarmTask(task);
                if (!outcome?.sent) {
                    task = null;
                    if (outcome?.noTroops) {
                        if (shouldLeaveVillageAfterNoTroops(outcome.model)) {
                            changeVillageRequested = true;
                        } else {
                            retryDelay = 50;
                        }
                    } else if (outcome?.rateLimited) {
                        retryDelay = APP.commandRateWindowMs + APP.commandRateSafetyMs;
                    } else {
                        retryDelay = APP.idlePollMs;
                    }
                }
            } else if (state.pendingTargetDueAt > Date.now()) {
                state.idleScans = 0;
                pendingDelay = state.pendingTargetDueAt - Date.now();
            } else {
                state.idleScans += 1;
                finishRequested = state.idleScans >= 3;
                if (
                    finishRequested &&
                    state.pageDeferredCandidates > 0 &&
                    !state.pageFinalCheckDone
                ) {
                    state.pageFinalCheckDone = true;
                    await syncActiveAttacksWithGame(false);
                    if (generation !== state.farmGeneration) return;
                    task = findNextFarmTask();
                    if (task) {
                        finishRequested = false;
                        state.idleScans = 0;
                        const outcome = await sendFarmTask(task);
                        if (!outcome?.sent) {
                            task = null;
                            if (outcome?.noTroops) {
                                if (shouldLeaveVillageAfterNoTroops(outcome.model)) {
                                    changeVillageRequested = true;
                                } else {
                                    retryDelay = 50;
                                }
                            } else if (outcome?.rateLimited) {
                                retryDelay = APP.commandRateWindowMs + APP.commandRateSafetyMs;
                            } else {
                                retryDelay = APP.idlePollMs;
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`[${APP.shortName}] Falha ao enviar um modelo.`, error);
        } finally {
            if (generation !== state.farmGeneration) return;
            state.farmRunning = false;
            if (automationCanRun() && state.ownsWorker) {
                if (changeVillageRequested) completeCurrentVillage(ensureRunState());
                else if (finishRequested) finishRound();
                else if (task) scheduleFarmStep(randomizedAttackDelay());
                else scheduleFarmStep(
                    retryDelay ||
                    (pendingDelay > 0 ? Math.min(APP.idlePollMs, pendingDelay) : APP.idlePollMs)
                );
            }
        }
    }

    function resumeRoundWorkflow() {
        if (!isFarmPage() || !automationCanRun() || !state.ownsWorker) return;
        const run = ensureRunState();

        if (run.round.phase === 'start') {
            run.round.phase = 'start_reloading';
            writeRunState(run);
            refreshPageForRound();
            return;
        }

        if (run.round.phase === 'start_reloading') {
            beginRound(run);
            return;
        }

        const activeTraversalPhases = new Set([
            'farming',
            'spying',
            'changing_page',
            'changing_village',
        ]);
        const selectedGroupId = String(state.settings?.farm?.groupId || '0');
        if (
            activeTraversalPhases.has(run.round.phase) &&
            (
                run.round.villages.length === 0 ||
                run.round.groupId !== selectedGroupId
            )
        ) {
            run.round.phase = 'start_reloading';
            writeRunState(run);
            refreshPageForRound();
            return;
        }

        if (run.round.phase === 'changing_village') {
            beginVillageAfterNavigation(run);
            return;
        }

        if (run.round.phase === 'changing_page') {
            beginPageAfterNavigation(run);
            return;
        }

        if (run.round.phase === 'end_reloading') {
            beginRoundPause(run);
            return;
        }

        if (run.round.phase === 'spying') {
            startSpyPhase(run);
            return;
        }

        if (run.round.phase === 'waiting') {
            if (isManagedWorker()) closeManagedWorkerWindow(750);
            else scheduleRoundWait(run);
            return;
        }

        hideRoundCountdown();
        scheduleFarmStep(150);
    }

    async function beginRound(run) {
        if (state.roundPreparing) return;
        state.roundPreparing = true;
        const generation = state.farmGeneration;
        clearRoundProgress(run);
        run.round.pauseUntil = 0;
        writeRunState(run);
        try {
            const groupId = String(state.settings?.farm?.groupId || '0');
            const data = await fetchGroupData(groupId);
            if (
                generation !== state.farmGeneration ||
                !automationCanRun() ||
                !state.ownsWorker
            ) return;
            if (!data.villages.length) throw new Error('O grupo escolhido não contém aldeias.');

            const currentRun = ensureRunState();
            currentRun.round.groupId = groupId;
            currentRun.round.groupName = data.name;
            currentRun.round.villages = data.villages;
            currentRun.round.completedVillages = [];
            currentRun.round.currentVillageId = data.villages[0];
            currentRun.round.visitedPages = [];
            currentRun.round.phase = 'changing_village';
            writeRunState(currentRun);
            state.roundPreparing = false;
            navigateToFarmVillage(data.villages[0], currentRun);
        } catch (error) {
            state.roundPreparing = false;
            if (state.captchaPaused) return;
            console.error(`[${APP.shortName}] Não foi possível preparar as aldeias da ronda.`, error);
            notify('error', `Grupo não preparado: ${getAutomationErrorMessage(error).slice(0, 120)}`);
            if (automationCanRun() && state.ownsWorker) beginRoundPause(ensureRunState());
        }
    }

    function finishRound() {
        state.idleScans = 0;
        const run = ensureRunState();
        if (navigateToNextFarmPage(run)) return;
        finishCurrentVillageFarm(run);
    }

    function finishCurrentVillageFarm(runValue) {
        const run = runValue || ensureRunState();
        run.round.farmCompleted = true;
        writeRunState(run);
        if (state.settings?.spy?.enabled) startSpyPhase(run);
        else completeCurrentVillage(run);
    }

    function markFarmModelExhausted(model) {
        if (!['a', 'b', 'c'].includes(model)) return ensureRunState();
        const run = ensureRunState();
        if (!run.round.exhaustedModels.includes(model)) {
            run.round.exhaustedModels.push(model);
            writeRunState(run);
        }
        return run;
    }

    function hasUsableFarmModel(runValue) {
        const run = runValue || ensureRunState();
        const exhausted = new Set(run.round.exhaustedModels || []);
        return ['a', 'b', 'c'].some(model => (
            state.settings?.models?.[model]?.enabled && !exhausted.has(model)
        ));
    }

    function shouldLeaveVillageAfterNoTroops(model) {
        const run = markFarmModelExhausted(model);
        return !hasUsableFarmModel(run);
    }

    function startSpyPhase(runValue) {
        const run = runValue || ensureRunState();
        if (!run.round.farmCompleted) {
            cancelSpyWork();
            run.round.phase = 'farming';
            writeRunState(run);
            scheduleFarmStep(100);
            return;
        }

        const config = state.settings?.spy || loadSettings().spy;
        if (!config.enabled) {
            cancelSpyWork();
            completeCurrentVillage(run);
            return;
        }
        if (state.spyRunning || !automationCanRun() || !state.ownsWorker) return;

        run.round.phase = 'spying';
        run.round.pauseUntil = 0;
        run.round.spy = normalizeRoundSpy(run.round.spy);
        writeRunState(run);

        const generation = state.farmGeneration;
        state.spyRunning = true;
        setSpyStatus('A preparar…');

        runSpyPhase(generation).then(result => {
            if (generation !== state.farmGeneration) return;
            state.spyRunning = false;
            setSpyStatus(result?.noTroops ? 'Sem batedores' : 'Pronto');
            if (automationCanRun() && state.ownsWorker) {
                completeCurrentVillage(ensureRunState());
            }
        }).catch(error => {
            if (generation !== state.farmGeneration) return;
            state.spyRunning = false;
            const message = getAutomationErrorMessage(error);
            setSpyStatus('Ignorado nesta ronda');
            console.error(`[${APP.shortName}] A espionagem BB foi ignorada nesta ronda.`, error);
            notify('error', `Espionagem BB ignorada: ${message.slice(0, 120)}`);
            if (automationCanRun() && state.ownsWorker) {
                completeCurrentVillage(ensureRunState());
            }
        });
    }

    function cancelSpyWork() {
        if (state.spyRunning || state.spyAbortController) state.farmGeneration += 1;
        state.spyAbortController?.abort();
        state.spyAbortController = null;
        state.spyRunning = false;
        setSpyStatus(state.settings?.spy?.enabled ? 'Pronto' : 'Inativo');
    }

    async function runSpyPhase(generation) {
        const origin = getOriginCoordinates();
        const sourceId = getVillageId();
        if (!origin || !/^\d+$/.test(sourceId)) {
            throw new Error('Não foi possível identificar a aldeia de origem.');
        }

        const initialRun = ensureRunState();
        const config = state.settings.spy;
        const availableSlots = Math.max(0, config.maxAttacks - getActiveAttackCount('spy'));
        if (availableSlots === 0) {
            return { sent: initialRun.round.spy.sent, reason: 'máximo de ataques em curso atingido' };
        }
        const unitSpeed = await loadWorldUnitSpeed();

        setSpyStatus('A ler o mapa…');
        const villages = await fetchBarbarianVillages();
        if (generation !== state.farmGeneration || !automationCanRun() || !state.ownsWorker) {
            return { sent: initialRun.round.spy.sent, reason: 'interrompido' };
        }

        const history = readSpyHistory();
        const attempted = initialRun.round.spy.attempted;
        const candidates = villages.map(village => ({
            ...village,
            distance: Math.hypot(village.x - origin.x, village.y - origin.y),
        })).filter(village => (
            village.distance <= config.radius &&
            String(village.id) !== sourceId &&
            !history[String(village.id)] &&
            !attempted[String(village.id)]
        )).sort((first, second) => (
            first.distance - second.distance || first.id - second.id
        )).slice(0, availableSlots);

        if (candidates.length === 0) {
            setSpyStatus('Sem novas BB no raio');
            return { sent: initialRun.round.spy.sent, reason: 'sem candidatas' };
        }

        let sentNow = 0;
        let noTroops = false;
        for (let index = 0; index < candidates.length; index += 1) {
            const currentConfig = state.settings?.spy;
            if (
                generation !== state.farmGeneration ||
                !automationCanRun() ||
                !state.ownsWorker ||
                !currentConfig?.enabled
            ) {
                break;
            }

            const run = ensureRunState();
            if (getActiveAttackCount('spy') >= currentConfig.maxAttacks) break;
            const target = candidates[index];
            setSpyStatus(`${index + 1}/${candidates.length} · ${target.x}|${target.y}`);

            try {
                await sendDirectSpyAttack(target, currentConfig.scoutsPerVillage, sourceId);
            } catch (error) {
                const message = getAutomationErrorMessage(error);
                run.round.spy.attempted[String(target.id)] = message.slice(0, 40) || 'erro';
                writeRunState(run);
                if (errorMeansNoScouts(message)) {
                    noTroops = true;
                    setSpyStatus('Sem batedores');
                    break;
                }
                if (errorMeansPlayerVillage(message)) continue;
                throw error;
            }

            run.round.spy.sent += 1;
            run.round.spy.attempted[String(target.id)] = 'enviado';
            registerActiveAttack({
                model: 'spy',
                sourceId,
                targetKey: `village:${target.id}`,
                targetCoord: `${target.x}|${target.y}`,
                distance: target.distance,
                minutesPerField: UNIT_MINUTES_PER_FIELD.spy,
                unitSpeed,
            });
            writeRunState(run);
            history[String(target.id)] = Date.now();
            writeSpyHistory(history);
            sentNow += 1;
            console.info(
                `[${APP.shortName}] Espionagem BB enviada para ${target.x}|${target.y} ` +
                `(${target.distance.toFixed(1)} campos), com ${currentConfig.scoutsPerVillage} batedor(es).`
            );

            if (index < candidates.length - 1) {
                await delay(randomizedSpyDelay(currentConfig.intervalMs));
            }
        }

        return {
            sent: ensureRunState().round.spy.sent,
            sentNow,
            noTroops,
            reason: noTroops ? 'sem batedores' : 'concluído',
        };
    }

    async function fetchBarbarianVillages() {
        const url = new URL('/map/village.txt', window.location.origin).href;
        const response = await requestGamePage(url, { method: 'GET' }, APP.requestTimeoutMs);
        const villages = [];
        response.text.split(/\r?\n/).forEach(line => {
            const fields = line.split(',');
            if (fields.length < 5 || Number(fields[4]) !== 0) return;
            const id = Number(fields[0]);
            const x = Number(fields[2]);
            const y = Number(fields[3]);
            if (Number.isInteger(id) && id > 0 && Number.isFinite(x) && Number.isFinite(y)) {
                villages.push({ id, x, y });
            }
        });
        return villages;
    }

    async function sendDirectSpyAttack(target, scouts, sourceId) {
        const initialUrl = buildDirectAttackUrl(target.id, sourceId);
        const initialPage = await requestGamePage(initialUrl, { method: 'GET' }, APP.requestTimeoutMs);
        const initialDocument = new DOMParser().parseFromString(initialPage.text, 'text/html');
        const commandForm = initialDocument.querySelector('#command-data-form');
        if (!commandForm) {
            throw new Error(extractGamePageError(initialDocument) || 'Formulário de ataque indisponível.');
        }

        const commandData = serializeGameForm(commandForm);
        commandData.set('spy', String(scouts));
        applyDirectAttackTarget(commandForm, commandData, target);
        addGameSubmitControl(commandForm, commandData, ['attack']);
        const confirmationPage = await submitGameForm(
            commandForm,
            initialPage.url,
            commandData,
            APP.requestTimeoutMs
        );
        const confirmationDocument = new DOMParser().parseFromString(confirmationPage.text, 'text/html');
        const confirmationForm = confirmationDocument.querySelector(
            '#command-confirm-form, form[action*="action=command"]'
        );
        if (!confirmationForm) {
            throw new Error(
                extractGamePageError(confirmationDocument) ||
                'O jogo não apresentou a confirmação da espionagem.'
            );
        }

        const confirmationData = serializeGameForm(confirmationForm);
        confirmationData.set('spy', String(scouts));
        applyDirectAttackTarget(confirmationForm, confirmationData, target);
        addGameSubmitControl(confirmationForm, confirmationData, ['submit', 'send', 'attack']);
        await reserveCommandSendSlot();
        const finalPage = await submitGameForm(
            confirmationForm,
            confirmationPage.url,
            confirmationData,
            APP.requestTimeoutMs
        );
        const finalDocument = new DOMParser().parseFromString(finalPage.text, 'text/html');
        const finalError = extractGamePageError(finalDocument);
        if (finalError || finalDocument.querySelector('#command-confirm-form')) {
            throw new Error(finalError || 'A espionagem não foi confirmada pelo jogo.');
        }
    }

    function applyDirectAttackTarget(form, data, target) {
        const id = String(target.id);
        const coordinates = `${target.x}|${target.y}`;

        // O formulário do Ponto de Encontro nem sempre inclui o campo oculto
        // quando é carregado em segundo plano. O ID tem de seguir sempre no POST.
        data.set('target', id);
        if (form.querySelector('[name="target_id"]')) data.set('target_id', id);
        if (form.querySelector('[name="x"]')) data.set('x', String(target.x));
        if (form.querySelector('[name="y"]')) data.set('y', String(target.y));
        if (form.querySelector('[name="target_x"]')) data.set('target_x', String(target.x));
        if (form.querySelector('[name="target_y"]')) data.set('target_y', String(target.y));
        if (form.querySelector('[name="input"]')) data.set('input', coordinates);
    }

    function buildDirectAttackUrl(targetId, sourceId) {
        const url = window.game_data?.link_base_pure
            ? new URL(`${window.game_data.link_base_pure}place`, window.location.href)
            : new URL(window.location.href);
        url.searchParams.set('screen', 'place');
        url.searchParams.set('village', sourceId);
        url.searchParams.set('target', String(targetId));
        return url.href;
    }

    function serializeGameForm(form) {
        const data = new URLSearchParams();
        form.querySelectorAll('input,select,textarea').forEach(field => {
            if (!field.name || field.disabled) return;
            const type = String(field.type || '').toLowerCase();
            if (['submit', 'button', 'image', 'reset', 'file'].includes(type)) return;
            if ((type === 'checkbox' || type === 'radio') && !field.checked) return;
            if (field instanceof HTMLSelectElement && field.multiple) {
                Array.from(field.options).forEach(option => {
                    if (option.selected) data.append(field.name, option.value);
                });
            } else {
                data.append(field.name, field.value);
            }
        });
        return data;
    }

    function addGameSubmitControl(form, data, names) {
        for (const name of names) {
            const control = form.querySelector(`button[name="${name}"],input[name="${name}"]`);
            if (control) {
                data.set(name, control.value || '1');
                return;
            }
        }
    }

    async function submitGameForm(form, baseUrl, data, timeoutMs) {
        const url = new URL(form.getAttribute('action') || baseUrl, baseUrl);
        const method = String(form.method || 'POST').toUpperCase();
        if (method === 'GET') {
            data.forEach((value, key) => url.searchParams.append(key, value));
            return requestGamePage(url.href, { method: 'GET' }, timeoutMs);
        }
        return requestGamePage(url.href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: data.toString(),
        }, timeoutMs);
    }

    async function requestGamePage(url, options, timeoutMs) {
        if (state.captchaPaused) throw new Error('Automação pausada por verificação/CAPTCHA.');
        const controller = new AbortController();
        state.spyAbortController = controller;
        const timer = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                credentials: 'same-origin',
                redirect: 'follow',
                ...options,
                signal: controller.signal,
            });
            const text = await response.text();
            if (!response.ok) throw new Error(`Pedido recusado pelo jogo (${response.status}).`);
            if (responseHasCaptcha(text)) {
                pauseForCaptcha('resposta do jogo', true);
                throw new Error('O jogo pediu uma verificação/CAPTCHA.');
            }
            return { text, url: response.url || url };
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error('O pedido ao jogo excedeu o tempo limite.');
            throw error;
        } finally {
            window.clearTimeout(timer);
            if (state.spyAbortController === controller) state.spyAbortController = null;
        }
    }

    async function requestBackgroundPage(url, timeoutMs) {
        if (state.captchaPaused) throw new Error('Automação pausada por verificação/CAPTCHA.');
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                method: 'GET',
                credentials: 'same-origin',
                redirect: 'follow',
                cache: 'no-store',
                signal: controller.signal,
            });
            const text = await response.text();
            if (!response.ok) throw new Error(`Pedido recusado pelo jogo (${response.status}).`);
            if (responseHasCaptcha(text)) {
                pauseForCaptcha('resposta do jogo', true);
                throw new Error('O jogo pediu uma verificação/CAPTCHA.');
            }
            return { text, url: response.url || url };
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error('O pedido ao jogo excedeu o tempo limite.');
            throw error;
        } finally {
            window.clearTimeout(timer);
        }
    }

    function extractGamePageError(documentValue) {
        return String(documentValue.querySelector(
            '#error,.error_box,.error-message,.error-msg'
        )?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function readSpyHistory() {
        const now = Date.now();
        const clean = {};
        try {
            const stored = JSON.parse(localStorage.getItem(keys.spyHistory) || '{}');
            Object.entries(stored || {}).slice(0, 10000).forEach(([id, timestamp]) => {
                const moment = Number(timestamp);
                if (/^\d+$/.test(id) && moment > 0 && now - moment < APP.spyHistoryMs) {
                    clean[id] = moment;
                }
            });
        } catch (_) {
            // Um histórico inválido é simplesmente reconstruído.
        }
        writeSpyHistory(clean);
        return clean;
    }

    function writeSpyHistory(history) {
        localStorage.setItem(keys.spyHistory, JSON.stringify(history || {}));
    }

    function randomizedSpyDelay(baseMs) {
        const base = Math.max(APP.minAttackMs, Number(baseMs) || APP.defaultAttackMs);
        const variation = base * 0.10;
        return Math.round(base - variation + (Math.random() * variation * 2));
    }

    function getAutomationErrorMessage(error) {
        if (!error) return 'erro desconhecido';
        if (typeof error === 'string') return error;
        return String(error.message || error.error || error.responseText || error);
    }

    function errorMeansNoScouts(message) {
        return /(?:not enough units|insufficient troops|tropas insuficientes|unidades insuficientes|não há tropas|não existem tropas|batedores insuficientes|no hay suficientes unidades|nicht genügend einheiten|pas assez d.unités)/i.test(
            String(message || '')
        );
    }

    function errorMeansPlayerVillage(message) {
        return /(?:attack villages owned by players|atacar aldeias? (?:pertencentes a|de|que pertencem a) jogadores|atacar aldeas?.*jugadores|d.rfer.*spieler|villages?.*joueurs)/i.test(
            String(message || '')
        );
    }

    async function beginVillageAfterNavigation(runValue) {
        const run = runValue || ensureRunState();
        const expected = String(run.round.currentVillageId || '');
        const current = getVillageId();
        if (expected && current !== expected) {
            navigateToFarmVillage(expected, run);
            return;
        }
        if (!isFirstFarmPage()) {
            navigateToFarmVillage(expected || current, run);
            return;
        }
        if (state.villagePreparing) return;

        state.villagePreparing = true;
        const generation = state.farmGeneration;
        try {
            // Confirma no jogo quais os comandos que ainda estão realmente a caminho.
            // Assim, uma previsão local antiga nunca faz saltar uma aldeia numa nova ronda.
            await syncActiveAttacksWithGame(true);
            if (
                generation !== state.farmGeneration ||
                !automationCanRun() ||
                !state.ownsWorker ||
                getVillageId() !== current
            ) return;

            const currentRun = ensureRunState();
            currentRun.round.currentVillageId = current;
            currentRun.round.visitedPages = [];
            currentRun.round.exhaustedModels = [];
            resetRoundTargetCapacity(currentRun);
            startCurrentFarmPage(currentRun);
        } finally {
            state.villagePreparing = false;
        }
    }

    function beginPageAfterNavigation(runValue) {
        startCurrentFarmPage(runValue || ensureRunState());
    }

    function startCurrentFarmPage(runValue) {
        const run = runValue || ensureRunState();
        const pageKey = getCurrentFarmPageKey();
        if (!run.round.visitedPages.includes(pageKey)) run.round.visitedPages.push(pageKey);
        run.round.phase = 'farming';
        run.round.farmCompleted = false;
        run.round.pauseUntil = 0;
        writeRunState(run);
        resetPageRuntime();
        hideRoundCountdown();
        scheduleFarmStep(200);
    }

    function resetPageRuntime() {
        state.processedTargets.clear();
        state.processedRows = new WeakSet();
        state.idleScans = 0;
        state.pageDeferredCandidates = 0;
        state.pageFinalCheckDone = false;
        state.pendingTargetDueAt = 0;
        getFarmRows().forEach(row => delete row.dataset.twPtAutofarmSent);
    }

    function navigateToNextFarmPage(runValue) {
        const run = runValue || ensureRunState();
        const next = getFarmPaginationPages().find(page => (
            !run.round.visitedPages.includes(page.key)
        ));
        if (!next) return false;

        run.round.phase = 'changing_page';
        writeRunState(run);
        navigateRoundUrl(next.url);
        return true;
    }

    function getFarmPaginationPages(documentValue = document, baseUrl = window.location.href) {
        const pages = new Map();
        const currentUrl = new URL(baseUrl, window.location.href);
        const inferredParameter = inferFarmPageParameter(documentValue, currentUrl);
        const observedMaxima = new Map();
        const selectors = [
            '#plunder_list_nav a[href]',
            '#plunder_list_nav option[value]',
            '.paged-nav-item a[href]',
            '.paged-nav a[href]',
            '.paged-nav option[value]',
            '#am_widget_Farm a[href*="page"]',
            '#am_widget_Farm select[name*="page" i] option[value]',
        ];
        documentValue.querySelectorAll(selectors.join(',')).forEach(item => {
            const raw = item.getAttribute('href') || item.value;
            if (!raw) return;
            let url;
            if (/^\d+$/.test(raw) && inferredParameter) {
                url = new URL(currentUrl.href);
                url.searchParams.set(inferredParameter, raw);
            } else {
                try {
                    url = new URL(raw, currentUrl.href);
                } catch (_) {
                    return;
                }
            }
            if (url.origin !== currentUrl.origin) return;
            const screen = url.searchParams.get('screen') || currentUrl.searchParams.get('screen');
            if (screen !== 'am_farm') return;
            const descriptor = getFarmPageDescriptor(url);
            if (!descriptor) return;
            const parameter = getFarmPageParameter(url) || inferredParameter;
            if (parameter) {
                observedMaxima.set(
                    parameter,
                    Math.max(observedMaxima.get(parameter) || 0, descriptor.number)
                );
            }
            if (descriptor.key === getFarmPageDescriptor(currentUrl).key) return;
            url.hash = '';
            pages.set(descriptor.key, { ...descriptor, url: url.href });
        });

        observedMaxima.forEach((maximum, parameter) => {
            for (let number = 0; number <= Math.min(maximum, 500); number += 1) {
                const url = new URL(currentUrl.href);
                ['Farm_page', 'farm_page', 'page'].forEach(name => url.searchParams.delete(name));
                if (number > 0 || currentUrl.searchParams.has(parameter)) {
                    url.searchParams.set(parameter, String(number));
                }
                const descriptor = getFarmPageDescriptor(url);
                if (descriptor.key === getFarmPageDescriptor(currentUrl).key) continue;
                url.hash = '';
                pages.set(descriptor.key, { ...descriptor, url: url.href });
            }
        });
        return Array.from(pages.values()).sort((first, second) => first.number - second.number);
    }

    function inferFarmPageParameter(documentValue, currentUrl) {
        for (const name of ['Farm_page', 'farm_page', 'page']) {
            if (currentUrl.searchParams.has(name)) return name;
        }
        for (const link of documentValue.querySelectorAll([
            '#plunder_list_nav a[href]',
            '.paged-nav a[href]',
            '#am_widget_Farm a[href*="page"]',
        ].join(','))) {
            try {
                const url = new URL(link.href, currentUrl.href);
                for (const name of ['Farm_page', 'farm_page', 'page']) {
                    if (/^\d+$/.test(String(url.searchParams.get(name) || ''))) return name;
                }
            } catch (_) {
                // Continua a procurar outro controlo de paginação.
            }
        }
        const select = documentValue.querySelector([
            '#plunder_list_nav select[name]',
            '.paged-nav select[name]',
            '#am_widget_Farm select[name*="page" i]',
            'select[id*="page" i]',
        ].join(','));
        const name = select?.getAttribute('name') || select?.id || '';
        return /page/i.test(name) ? name : 'Farm_page';
    }

    function getFarmPageParameter(urlValue) {
        const url = urlValue instanceof URL ? urlValue : new URL(urlValue, window.location.href);
        return ['Farm_page', 'farm_page', 'page'].find(name => (
            /^\d+$/.test(String(url.searchParams.get(name) || ''))
        )) || '';
    }

    function getFarmPageDescriptor(urlValue) {
        const url = urlValue instanceof URL ? urlValue : new URL(urlValue, window.location.href);
        const parameter = getFarmPageParameter(url);
        if (parameter) {
            const number = Number(url.searchParams.get(parameter));
            return { key: `page:${number}`, number };
        }
        return { key: 'page:0', number: 0 };
    }

    function getCurrentFarmPageKey() {
        return getFarmPageDescriptor(new URL(window.location.href)).key;
    }

    function isFirstFarmPage(urlValue = window.location.href) {
        return getFarmPageDescriptor(new URL(urlValue, window.location.href)).number === 0;
    }

    function completeCurrentVillage(runValue) {
        const run = runValue || ensureRunState();
        const current = getVillageId() || run.round.currentVillageId;
        if (current && !run.round.completedVillages.includes(current)) {
            run.round.completedVillages.push(current);
        }
        const nextVillage = run.round.villages.find(id => !run.round.completedVillages.includes(id));
        if (nextVillage) {
            run.round.currentVillageId = nextVillage;
            run.round.visitedPages = [];
            resetRoundTargetCapacity(run);
            run.round.farmCompleted = false;
            run.round.phase = 'changing_village';
            writeRunState(run);
            navigateToFarmVillage(nextVillage, run);
            return;
        }
        beginRoundPause(run);
    }

    function navigateToFarmVillage(villageId, runValue) {
        const id = String(villageId || '');
        if (!/^\d+$/.test(id) || !automationCanRun() || !state.ownsWorker) return;
        const run = runValue || ensureRunState();
        run.round.currentVillageId = id;
        run.round.phase = 'changing_village';
        writeRunState(run);

        const url = buildFirstFarmPageUrl(id);
        const alreadyThere = getVillageId() === id && isFirstFarmPage();
        if (alreadyThere) {
            window.setTimeout(() => {
                if (automationCanRun() && state.ownsWorker) beginVillageAfterNavigation(ensureRunState());
            }, 50);
            return;
        }
        navigateRoundUrl(url.href);
    }

    function buildFirstFarmPageUrl(villageId = getVillageId(), baseUrl = buildFarmUrl()) {
        const url = new URL(baseUrl, window.location.href);
        ['Farm_page', 'farm_page', 'page'].forEach(name => url.searchParams.delete(name));
        url.searchParams.set('screen', 'am_farm');
        url.searchParams.set('group', String(state.settings?.farm?.groupId || '0'));
        const id = String(villageId || '');
        if (/^\d+$/.test(id)) url.searchParams.set('village', id);
        return url;
    }

    function navigateRoundUrl(url) {
        if (!automationCanRun() || !state.ownsWorker) return;
        state.farmGeneration += 1;
        clearFarmTimer();
        clearRoundTimer();
        state.farmRunning = false;
        state.spyRunning = false;
        state.roundPreparing = false;
        state.villagePreparing = false;
        window.setTimeout(() => {
            if (automationCanRun() && state.ownsWorker) window.location.assign(url);
        }, 80);
    }

    function beginRoundPause(run) {
        if (!automationCanRun() || !state.ownsWorker) return;
        const settings = state.settings || loadSettings();
        run.round.phase = 'waiting';
        run.round.pauseUntil = Date.now() + randomizedRoundPauseMs(settings.general.roundPauseSeconds);
        writeRunState(run);
        showRoundCountdown(Math.ceil((run.round.pauseUntil - Date.now()) / 1000));
        if (isManagedWorker()) {
            const status = state.panel?.querySelector('[data-role="state"]');
            if (status) status.textContent = 'Ronda concluída — a fechar separador';
            closeManagedWorkerWindow(750);
        } else {
            scheduleRoundWait(run);
        }
    }

    function scheduleRoundWait(runValue) {
        clearRoundTimer();
        if (!automationCanRun() || !state.ownsWorker) return;
        const run = runValue || ensureRunState();
        const remaining = Math.max(0, run.round.pauseUntil - Date.now());
        if (remaining <= 0) {
            startNextRound(run);
            return;
        }

        showRoundCountdown(Math.ceil(remaining / 1000));
        const tickDelay = Math.min(1000, remaining);
        const token = state.roundTimerToken;
        state.roundDueAt = Date.now() + tickDelay;
        state.roundTimer = window.setTimeout(() => {
            if (token !== state.roundTimerToken) return;
            state.roundTimer = 0;
            state.roundDueAt = 0;
            if (automationCanRun() && state.ownsWorker) {
                scheduleRoundWait(ensureRunState());
            }
        }, tickDelay);
    }

    function startNextRound(run) {
        if (!automationCanRun() || !state.ownsWorker) return;
        run.round.number += 1;
        run.round.pauseUntil = 0;
        resetRoundTargetCapacity(run);
        hideRoundCountdown();
        run.round.phase = 'start_reloading';
        writeRunState(run);
        refreshPageForRound();
    }

    function refreshPageForRound() {
        if (!automationCanRun() || !state.ownsWorker) return;
        state.farmGeneration += 1;
        clearFarmTimer();
        clearRoundTimer();
        state.farmRunning = false;
        hideRoundCountdown();
        const firstPageUrl = buildFirstFarmPageUrl();
        window.setTimeout(() => {
            if (automationCanRun() && state.ownsWorker) {
                window.location.assign(firstPageUrl.href);
            }
        }, 60);
    }

    function clearRoundProgress(runValue) {
        const run = runValue || ensureRunState();
        run.counts = { a: 0, b: 0, c: 0 };
        resetRoundTargetCapacity(run);
        run.round.farmCompleted = false;
        run.round.spy = { sent: 0, attempted: {} };
        run.round.groupId = '';
        run.round.groupName = '';
        run.round.villages = [];
        run.round.completedVillages = [];
        run.round.currentVillageId = '';
        run.round.visitedPages = [];
        run.round.exhaustedModels = [];
        setSpyStatus(state.settings?.spy?.enabled ? 'Pronto' : 'Inativo');
        resetPageRuntime();
    }

    function resetRoundTargetCapacity(runValue) {
        const run = runValue || ensureRunState();
        // Este progresso só organiza as vagas da ronda atual. Os comandos que
        // ainda estão em curso continuam no registo ativo e voltam a ser lidos
        // da própria linha do jogo na ronda seguinte.
        run.round.targets = {};
        return run;
    }

    function allActiveModelsExhausted() {
        const settings = state.settings || loadSettings();
        const active = ['a', 'b', 'c'].filter(model => settings.models[model].enabled);
        return active.length > 0 && active.every(model => {
            const limit = settings.models[model].maxAttacks;
            return limit.enabled && getActiveAttackCount(model) >= limit.max;
        });
    }

    function showRoundCountdown(totalSeconds) {
        const display = state.button?.querySelector('[data-auto-farm-countdown]');
        if (!display) return;
        const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
        const minutes = Math.floor(seconds / 60);
        const remainder = String(seconds % 60).padStart(2, '0');
        display.textContent = `${minutes}:${remainder}`;
        display.hidden = false;
    }

    function hideRoundCountdown() {
        const display = state.button?.querySelector('[data-auto-farm-countdown]');
        if (!display) return;
        display.textContent = '';
        display.hidden = true;
    }

    function deferFarmRow(dueAt) {
        state.pageDeferredCandidates += 1;
        const moment = Math.max(0, Number(dueAt) || 0);
        if (moment > Date.now()) {
            state.pendingTargetDueAt = state.pendingTargetDueAt > 0
                ? Math.min(state.pendingTargetDueAt, moment)
                : moment;
        }
    }

    function findNextFarmTask() {
        const rows = getFarmRows();
        const settings = state.settings || loadSettings();
        const run = ensureRunState();
        const exhaustedModels = new Set(run.round.exhaustedModels || []);
        const activeCounts = getActiveAttackCounts();
        state.pendingTargetDueAt = 0;
        state.pageDeferredCandidates = 0;

        for (const row of rows) {
            const targetKey = getTargetKey(row);
            const progress = targetKey ? run.round.targets[targetKey] : null;

            // Um envio bem-sucedido conclui este alvo apenas para a ronda atual.
            // Na ronda seguinte o estado é limpo, a linha é relida e pode receber
            // outro ataque se o limite simultâneo ainda tiver uma vaga.
            if (progress) continue;

            if (state.processedRows.has(row) || row.dataset.twPtAutofarmSent === '1') continue;
            const selected = selectModelForRow(
                row,
                activeCounts,
                exhaustedModels,
                targetKey
            );
            if (selected) {
                return {
                    row,
                    button: selected.button,
                    model: selected.model,
                    reportColor: selected.reportColor,
                    targetKey,
                    targetActiveCount: selected.targetActiveCount,
                };
            }
        }
        return null;
    }

    function getFarmRows() {
        const list = document.querySelector('#plunder_list') || document.querySelector('#am_widget_Farm');
        if (!list) return [];

        // A ordem da tabela do jogo é a ordem da ronda. Recolher diretamente os
        // <tr> evita que modelos, seletores ou estados locais reorganizem a fila.
        return Array.from(list.querySelectorAll('tr')).filter(row => (
            row.querySelector('a.farm_icon_a,a.farm_icon_b,a.farm_icon_c')
        ));
    }

    function selectModelForRow(
        row,
        activeCounts,
        exhaustedModelsValue,
        targetKeyValue = getTargetKey(row)
    ) {
        const settings = state.settings || loadSettings();
        const reportColor = getReportColor(row);
        const exhaustedModels = exhaustedModelsValue instanceof Set
            ? exhaustedModelsValue
            : new Set(ensureRunState().round.exhaustedModels || []);
        if (!reportColor) return null;
        for (const model of getRowModelOrder(row)) {
            if (exhaustedModels.has(model)) continue;
            const config = settings.models[model];
            const button = row.querySelector(`a.farm_icon_${model}`);
            if (
                !config.enabled ||
                !button ||
                !modelMatchesRow(row, config, reportColor)
            ) {
                continue;
            }
            if (isFarmButtonDisabled(button)) continue;
            const targetStatus = getTargetActiveLimitStatus(
                row,
                model,
                targetKeyValue,
                config
            );
            if (config.sameVillage?.enabled && targetStatus.count >= getSameVillageLimit(config)) {
                continue;
            }
            if (!modelHasCapacity(model, config, activeCounts)) {
                deferFarmRow(getNextActiveImpact(model));
                continue;
            }
            return {
                model,
                button,
                reportColor,
                targetActiveCount: targetStatus.count,
            };
        }
        return null;
    }

    function getRowModelOrder(row) {
        const models = [];
        row.querySelectorAll('a.farm_icon_a,a.farm_icon_b,a.farm_icon_c').forEach(button => {
            const match = String(button.className || '').match(/farm_icon_([abc])/);
            if (match && !models.includes(match[1])) models.push(match[1]);
        });
        return models.length ? models : ['a', 'b', 'c'];
    }

    function modelMatchesRow(row, config, detectedColor) {
        const reportColor = detectedColor || getReportColor(row);
        if (!reportColor || !config.reports[reportColor]) return false;

        if (config.wall.enabled) {
            const wallLevel = getWallLevel(row);
            if (!Number.isFinite(wallLevel) || wallLevel > config.wall.max) return false;
        }

        if (config.distance.enabled) {
            const distance = getTargetDistance(row);
            if (!Number.isFinite(distance) || distance > config.distance.max) return false;
        }

        const lootType = getLootType(row);
        if (lootType === 'full' && !config.loot.full) return false;
        if (lootType === 'partial' && !config.loot.partial) return false;
        if (!lootType) return config.loot.full || config.loot.partial;
        return config.loot.full || config.loot.partial;
    }

    function getTargetActiveLimitStatus(row, model, targetKey, config) {
        if (!config?.sameVillage?.enabled || !targetKey) {
            return { count: 0, gameCount: null, localCount: 0 };
        }
        const gameCount = getGameActiveTargetCount(row);
        const localCount = getActiveTargetStatus(model, targetKey, config).count;
        return {
            // A lista acabou de ser recarregada no início da ronda e é a fonte
            // autoritativa para o alvo. Uma previsão local antiga não pode fazer
            // saltar uma linha que o jogo já mostra sem ataques em curso.
            count: gameCount,
            gameCount,
            localCount,
        };
    }

    function getGameActiveTargetCount(row) {
        if (!row) return null;
        const descriptions = [
            row.getAttribute?.('title'),
            row.getAttribute?.('aria-label'),
            row.getAttribute?.('data-title'),
            row.getAttribute?.('data-attacks'),
            row.getAttribute?.('data-attack-count'),
        ];
        row.querySelectorAll?.([
            '[title]',
            '[aria-label]',
            '[data-title]',
            '[data-attacks]',
            '[data-attack-count]',
        ].join(','))?.forEach(element => {
            descriptions.push(
                element.getAttribute?.('title'),
                element.getAttribute?.('aria-label'),
                element.getAttribute?.('data-title'),
                element.getAttribute?.('data-attacks'),
                element.getAttribute?.('data-attack-count')
            );
        });
        descriptions.push(row.outerHTML);

        let maximum = null;
        let activeMarkerSeen = false;
        descriptions.filter(Boolean).forEach(description => {
            const text = normalizeText(description);
            if (/(?:ataques?|attacks?|angriffe?|attaques?)\s*(?:em curso|a decorrer|ativos?|active|running|in progress)/i.test(text)) {
                activeMarkerSeen = true;
            }
            const patterns = [
                /(\d+)\s*(?:ataques?|attacks?|angriffe?|attaques?)\s*(?:em curso|a decorrer|ativos?|active|running|in progress)?/i,
                /(?:ataques?|attacks?|angriffe?|attaques?)\s*(?:em curso|a decorrer|ativos?|active|running|in progress)?\s*[:=-]?\s*(\d+)/i,
            ];
            for (const pattern of patterns) {
                const match = text.match(pattern);
                if (!match) continue;
                const count = Number(match[1]);
                if (Number.isFinite(count)) maximum = Math.max(maximum ?? 0, count);
            }
        });
        // Alguns mundos apresentam apenas o ícone/descrição, sem o número.
        // Nesse caso há pelo menos um ataque; sem marcador, a linha vale zero.
        return maximum ?? (activeMarkerSeen ? 1 : 0);
    }

    function roundTargetCanSend(model, targetKey, config, row) {
        if (!targetKey) return true;
        const round = readRunState()?.round;
        const progress = round?.targets?.[targetKey];
        const activeStatus = getTargetActiveLimitStatus(row, model, targetKey, config);
        if (config?.sameVillage?.enabled && activeStatus.count >= getSameVillageLimit(config)) {
            return false;
        }
        return !progress;
    }

    async function sendFarmTask(task) {
        if (hasCaptchaChallenge(document)) pauseForCaptcha('página do jogo');
        if (!automationCanRun()) {
            return { sent: false, captcha: state.captchaPaused, cancelled: true, model: task.model };
        }
        if (!task.button?.isConnected || isFarmButtonDisabled(task.button)) {
            return { sent: false, cancelled: true, model: task.model };
        }
        let currentColor = getReportColor(task.row);
        let currentConfig = state.settings?.models?.[task.model];
        if (
            !currentColor ||
            currentColor !== task.reportColor ||
            !currentConfig?.enabled ||
            !modelMatchesRow(task.row, currentConfig, currentColor) ||
            !modelHasCapacity(task.model, currentConfig) ||
            !roundTargetCanSend(task.model, task.targetKey, currentConfig, task.row)
        ) {
            console.warn(
                `[${APP.shortName}] Envio ${task.model.toUpperCase()} cancelado: ` +
                `a cor atual (${currentColor || 'desconhecida'}) não está permitida ou o limite foi atingido.`
            );
            return { sent: false, cancelled: true, model: task.model };
        }

        const availability = getFarmTemplateAvailability(task.model);
        if (availability.known && !availability.available) {
            console.info(
                `[${APP.shortName}] Modelo ${task.model.toUpperCase()} sem unidades suficientes ` +
                `antes do envio (${availability.missing.join(', ')}).`
            );
            return { sent: false, noTroops: true, model: task.model, preflight: true };
        }

        const unitSpeed = await loadWorldUnitSpeed();
        const distance = getTargetDistance(task.row);
        const target = getCoordinates(task.row.textContent);
        const minutesPerField = getModelSlowestMinutesPerField(task.model);

        currentColor = getReportColor(task.row);
        currentConfig = state.settings?.models?.[task.model];
        if (
            !task.button?.isConnected ||
            isFarmButtonDisabled(task.button) ||
            currentColor !== task.reportColor ||
            !currentConfig?.enabled ||
            !modelMatchesRow(task.row, currentConfig, currentColor) ||
            !modelHasCapacity(task.model, currentConfig) ||
            !roundTargetCanSend(task.model, task.targetKey, currentConfig, task.row)
        ) return { sent: false, cancelled: true, model: task.model };

        await reserveCommandSendSlot();
        currentColor = getReportColor(task.row);
        currentConfig = state.settings?.models?.[task.model];
        if (
            !task.button?.isConnected ||
            isFarmButtonDisabled(task.button) ||
            currentColor !== task.reportColor ||
            !currentConfig?.enabled ||
            !modelMatchesRow(task.row, currentConfig, currentColor) ||
            !modelHasCapacity(task.model, currentConfig) ||
            !roundTargetCanSend(task.model, task.targetKey, currentConfig, task.row)
        ) return { sent: false, cancelled: true, model: task.model };

        const finalAvailability = getFarmTemplateAvailability(task.model);
        if (finalAvailability.known && !finalAvailability.available) {
            return { sent: false, noTroops: true, model: task.model, preflight: true };
        }

        const errorsBefore = captureGameErrors();
        task.button.click();
        const requestOutcome = await waitForFarmRequest(6000, errorsBefore);
        if (requestOutcome.captcha) {
            return { sent: false, captcha: true, model: task.model };
        }
        if (requestOutcome.noTroops) {
            console.info(
                `[${APP.shortName}] Modelo ${task.model.toUpperCase()} sem unidades suficientes ` +
                'nesta aldeia; o modelo fica concluído até à próxima aldeia.'
            );
            return { sent: false, noTroops: true, model: task.model };
        }
        if (requestOutcome.rateLimited) {
            console.warn(`[${APP.shortName}] O jogo aplicou o limite de comandos; envio será repetido.`);
            return { sent: false, rateLimited: true, model: task.model };
        }
        if (requestOutcome.error) {
            console.warn(
                `[${APP.shortName}] O jogo recusou o envio ${task.model.toUpperCase()}: ` +
                requestOutcome.message
            );
            return { sent: false, error: true, model: task.model };
        }

        state.farmSent += 1;
        state.pageFinalCheckDone = false;
        const progress = recordFarmSend(task.model, {
            color: currentColor,
            targetKey: task.targetKey,
            targetCoord: target ? `${target.x}|${target.y}` : '',
            distance,
            minutesPerField,
            unitSpeed,
            targetActiveCount: task.targetActiveCount,
        });
        if (!task.targetKey || progress.complete) {
            state.processedRows.add(task.row);
            task.row.dataset.twPtAutofarmSent = '1';
            if (task.targetKey) state.processedTargets.add(task.targetKey);
        }
        console.info(
            `[${APP.shortName}] Modelo ${task.model.toUpperCase()} enviado` +
            `${task.targetKey ? ` para ${task.targetKey}` : ''} — cor ${currentColor}` +
            `${progress.maximum > 1 ? `, envio ${progress.sent}/${progress.maximum}` : ''}.`
        );
        return { sent: true, model: task.model };
    }

    async function waitForFarmRequest(timeoutMs, errorsBefore) {
        const startedAt = Date.now();
        await delay(80);
        while (
            window.jQuery &&
            Number(window.jQuery.active || 0) > 0 &&
            Date.now() - startedAt < timeoutMs
        ) {
            await delay(60);
        }
        await delay(120);
        const messages = Array.from(new Set([
            ...getNewGameErrors(errorsBefore),
            ...getCurrentRelevantGameErrors(),
        ]));
        const message = messages.join(' · ');
        const pageText = normalizeGameMessage(
            document.body?.innerText || document.body?.textContent || ''
        );
        const captcha = hasCaptchaChallenge(document) ||
            messages.some(isCaptchaMessage) ||
            isCaptchaMessage(pageText);
        if (captcha) pauseForCaptcha('resposta ao envio do modelo');
        return {
            captcha,
            noTroops: messages.some(isNoTroopsMessage) || isNoTroopsMessage(pageText),
            rateLimited: messages.some(isCommandRateLimitMessage) ||
                isCommandRateLimitMessage(pageText),
            error: messages.length > 0,
            message: message || 'erro não identificado',
        };
    }

    function captureGameErrors() {
        const snapshot = new Map();
        getGameErrorElements().forEach(element => {
            snapshot.set(element, normalizeGameMessage(element.textContent));
        });
        return snapshot;
    }

    function getNewGameErrors(snapshotValue) {
        const snapshot = snapshotValue instanceof Map ? snapshotValue : new Map();
        const messages = [];
        getGameErrorElements().forEach(element => {
            const message = normalizeGameMessage(element.textContent);
            if (message && (!snapshot.has(element) || snapshot.get(element) !== message)) {
                messages.push(message);
            }
        });
        return Array.from(new Set(messages));
    }

    function getCurrentRelevantGameErrors() {
        return Array.from(new Set(
            getGameErrorElements()
                .map(element => normalizeGameMessage(element.textContent))
                .filter(message => (
                    message && (
                        isNoTroopsMessage(message) ||
                        isCommandRateLimitMessage(message) ||
                        isCaptchaMessage(message)
                    )
                ))
        ));
    }

    function getGameErrorElements() {
        return Array.from(document.querySelectorAll([
            '#error',
            '.error_box',
            '.error-message',
            '.error-msg',
            '.ui-state-error',
            '.server-error',
            '.toast-error',
            '[role="alert"]',
            '#notifications .error',
            '#notifications [class*="error"]',
            '.notification.error',
        ].join(',')));
    }

    function normalizeGameMessage(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function isNoTroopsMessage(value) {
        return /(?:nao (?:existem|ha) unidades suficientes|unidades insuficientes|tropas insuficientes|not enough units|insufficient (?:units|troops)|no hay suficientes unidades|nicht genug einheiten|pas assez d.unites)/i.test(
            normalizeText(value)
        );
    }

    function isCaptchaMessage(value) {
        return /(?:captcha|protecao contra bots|verificacao (?:da |de )?protecao (?:de |do )?bot|bot protection|verify (?:that )?you are human|nao sou (?:um )?robo|not a robot)/i.test(
            normalizeText(value)
        );
    }

    function isCommandRateLimitMessage(value) {
        const text = normalizeText(value);
        return /(?:demasiados|muitos|too many|zu viele|demasiados) (?:ataques|comandos|pedidos|requests)/.test(text) ||
            /(?:5|cinco).*(?:ataques|comandos).*(?:segundo|second)/.test(text) ||
            /(?:ataques|comandos).*(?:5|cinco).*(?:segundo|second)/.test(text);
    }

    async function reserveCommandSendSlot() {
        while (true) {
            if (hasCaptchaChallenge(document)) pauseForCaptcha('página do jogo');
            if (!automationCanRun()) {
                throw new Error(state.captchaPaused
                    ? 'Envio interrompido por verificação/CAPTCHA.'
                    : 'Envio interrompido porque o AutoFarm foi desligado.');
            }
            const now = Date.now();
            state.recentCommandSends = state.recentCommandSends.filter(timestamp => (
                now - timestamp < APP.commandRateWindowMs
            ));
            if (state.recentCommandSends.length < APP.commandRateMaximum) {
                state.recentCommandSends.push(now);
                return;
            }
            const oldest = Math.min(...state.recentCommandSends);
            await delay(Math.max(
                20,
                oldest + APP.commandRateWindowMs + APP.commandRateSafetyMs - now
            ));
        }
    }

    function randomizedAttackDelay() {
        const base = state.settings?.general?.attackIntervalMs || APP.defaultAttackMs;
        const variation = base * 0.10;
        return Math.round(base - variation + (Math.random() * variation * 2));
    }

    function randomizedRoundPauseMs(baseSeconds) {
        const base = Math.max(1, Number(baseSeconds) || DEFAULT_SETTINGS.general.roundPauseSeconds) * 1000;
        const variation = base * 0.10;
        return Math.round(base - variation + (Math.random() * variation * 2));
    }

    function getReportColor(row) {
        const directValues = [
            row.getAttribute('data-report-color'),
            row.getAttribute('data-color'),
            row.getAttribute('data-status-color'),
        ];
        for (const value of directValues) {
            const color = normalizeReportColor(value);
            if (color) return color;
        }

        const candidates = row.querySelectorAll([
            '.report_dot',
            '[class*="report_dot"]',
            '[data-report-color]',
            'img[src*="/dots/"]',
            'img[src*="dots/"]',
            'img[src*="dot_"]',
            'img[src*="dot-"]',
            '[style*="/dots/"]',
            '[style*="dot_"]',
            '[style*="dot-"]',
        ].join(','));

        for (const element of candidates) {
            const explicitValues = [
                element.getAttribute('data-report-color'),
                element.getAttribute('data-color'),
                element.getAttribute('src'),
                element.getAttribute('class'),
                element.getAttribute('title'),
                element.getAttribute('alt'),
                element.getAttribute('style'),
            ];
            for (const value of explicitValues) {
                const color = normalizeReportColor(value);
                if (color) return color;
            }
            const computed = window.getComputedStyle?.(element);
            const computedTokenColor = normalizeReportColor(computed?.backgroundImage);
            if (computedTokenColor) return computedTokenColor;
            const computedRgbColor = reportColorFromRgb(computed?.backgroundColor);
            if (computedRgbColor) return computedRgbColor;
        }
        return null;
    }

    function normalizeReportColor(value) {
        const text = normalizeText(value);
        const red = /red|vermelh/.test(text);
        const blue = /blue|azul/.test(text);
        const yellow = /yellow|amarel/.test(text);
        const green = /green|verde/.test(text);
        if (red && blue) return 'redBlue';
        if (red && yellow) return 'redYellow';
        if (blue) return 'blue';
        if (green) return 'green';
        if (yellow) return 'yellow';
        if (red) return 'red';
        return null;
    }

    function reportColorFromRgb(value) {
        const match = String(value || '').match(/rgba?[(]\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (!match) return null;
        const red = Number(match[1]);
        const green = Number(match[2]);
        const blue = Number(match[3]);
        if (green > red + 25 && green > blue + 25) return 'green';
        if (blue > red + 25 && blue > green + 15) return 'blue';
        if (red > 170 && green > 120 && blue < 120 && Math.abs(red - green) < 110) return 'yellow';
        if (red > green + 35 && red > blue + 35) return 'red';
        return null;
    }

    function getLootType(row) {
        for (const image of row.querySelectorAll('img[src*="max_loot"]')) {
            const match = String(image.getAttribute('src') || '').match(/max_loot\/(0|1)(?:\.|$)/i);
            if (match) return match[1] === '1' ? 'full' : 'partial';
        }

        const descriptions = [
            row.className,
            row.getAttribute('data-loot'),
            row.getAttribute('data-loot-type'),
            row.getAttribute('data-haul'),
        ];
        row.querySelectorAll('[title],[alt],[data-loot],[data-loot-type],[data-haul]').forEach(element => {
            descriptions.push(
                element.getAttribute('title'),
                element.getAttribute('alt'),
                element.getAttribute('data-loot'),
                element.getAttribute('data-loot-type'),
                element.getAttribute('data-haul')
            );
        });
        const text = normalizeText(descriptions.filter(Boolean).join(' '));
        if (/(saque|pilhagem) (total|complet)|full (loot|haul|plunder)|(loot|haul|plunder) (full|complete)/.test(text)) {
            return 'full';
        }
        if (/(saque|pilhagem) parcial|partial (loot|haul|plunder)|(loot|haul|plunder) partial/.test(text)) {
            return 'partial';
        }
        return null;
    }

    function getWallLevel(row) {
        const direct = row.getAttribute('data-wall-level') || row.getAttribute('data-muralha');
        if (/^\d+$/.test(String(direct || '').trim())) return Math.min(20, Number(direct));

        const marked = row.querySelector('[data-building="wall"],[data-wall-level],td.wall,td[class*="wall_level"]');
        const index = findColumnIndex(row, /wall|muralha/);
        const cell = marked || (index >= 0 ? row.cells[index] : null) || (row.cells.length > 6 ? row.cells[6] : null);
        const text = String(cell?.textContent || '').trim();
        return /^\d+$/.test(text) ? Math.min(20, Number(text)) : null;
    }

    function findColumnIndex(row, pattern) {
        const table = row.closest('table');
        if (!table) return -1;
        for (const header of table.querySelectorAll('th')) {
            const image = header.querySelector('img');
            const description = normalizeText([
                header.textContent,
                header.className,
                header.getAttribute('title'),
                image?.getAttribute('src'),
                image?.getAttribute('title'),
                image?.getAttribute('alt'),
            ].filter(Boolean).join(' '));
            if (pattern.test(description)) return header.cellIndex;
        }
        return -1;
    }

    function getTargetDistance(row) {
        const origin = getOriginCoordinates();
        const target = getCoordinates(row.textContent);
        if (origin && target) {
            return Math.hypot(target.x - origin.x, target.y - origin.y);
        }

        const marked = row.querySelector('[data-distance],td.distance,td[class*="distance"]');
        const direct = String(marked?.getAttribute('data-distance') || marked?.textContent || '')
            .trim().replace(',', '.');
        return /^\d+(?:\.\d+)?$/.test(direct) ? Number(direct) : Number.POSITIVE_INFINITY;
    }

    function getOriginCoordinates() {
        const village = window.game_data?.village;
        if (!village) return null;
        if (village.coord) return getCoordinates(village.coord);
        if (Number.isFinite(Number(village.x)) && Number.isFinite(Number(village.y))) {
            return { x: Number(village.x), y: Number(village.y) };
        }
        return null;
    }

    function getCoordinates(value) {
        const match = String(value || '').match(/(\d{1,3})\s*[|]\s*(\d{1,3})/);
        return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    }

    function getTargetKey(row) {
        const idMatch = String(row.id || '').match(/^village_(\d+)/);
        if (idMatch) return `village:${idMatch[1]}`;

        const targetLink = row.querySelector('a[href*="target="]');
        if (targetLink) {
            try {
                const target = new URL(targetLink.href, window.location.href).searchParams.get('target');
                if (/^\d+$/.test(String(target || ''))) return `village:${target}`;
            } catch (_) {
                // Usa o onclick ou as coordenadas abaixo.
            }
        }

        const farmButton = row.querySelector('a.farm_icon_a,a.farm_icon_b,a.farm_icon_c');
        const onclick = farmButton?.getAttribute('onclick') || '';
        const onclickMatch = onclick.match(/Accountmanager[.]farm[.]sendUnits\s*[(]\s*[^,]+\s*,\s*(\d+)/i);
        if (onclickMatch) return `village:${onclickMatch[1]}`;

        const coordinates = getCoordinates(row.textContent);
        return coordinates ? `coord:${coordinates.x}|${coordinates.y}` : '';
    }

    function isFarmButtonDisabled(button) {
        return !button ||
            button.classList.contains('farm_icon_disabled') ||
            button.getAttribute('aria-disabled') === 'true' ||
            button.hasAttribute('disabled') ||
            Boolean(button.closest('.farm_icon_disabled'));
    }

    function normalizeText(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function delay(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    function resetRunState() {
        const run = {
            sessionId: makeId(),
            startedAt: Date.now(),
            counts: { a: 0, b: 0, c: 0 },
            round: {
                number: 1,
                phase: 'start',
                pauseUntil: 0,
                farmCompleted: false,
                targets: {},
                spy: { sent: 0, attempted: {} },
                groupId: '',
                groupName: '',
                villages: [],
                completedVillages: [],
                currentVillageId: '',
                visitedPages: [],
                exhaustedModels: [],
            },
            lastSend: null,
        };
        localStorage.setItem(keys.run, JSON.stringify(run));
        state.farmSent = 0;
        state.processedTargets.clear();
        state.processedRows = new WeakSet();
        renderModelCounts();
        return run;
    }

    function ensureRunState() {
        return readRunState() || resetRunState();
    }

    function readRunState() {
        try {
            const run = JSON.parse(localStorage.getItem(keys.run) || 'null');
            if (!run || typeof run !== 'object' || !run.sessionId || !run.counts) return null;
            return {
                sessionId: String(run.sessionId),
                startedAt: Number(run.startedAt) || Date.now(),
                counts: {
                    a: integerValue(run.counts.a, 0, 0, 1000000),
                    b: integerValue(run.counts.b, 0, 0, 1000000),
                    c: integerValue(run.counts.c, 0, 0, 1000000),
                },
                round: normalizeRoundState(run.round),
                lastSend: normalizeLastSend(run.lastSend),
            };
        } catch (_) {
            return null;
        }
    }

    function recordFarmSend(model, details = {}) {
        const run = ensureRunState();
        const config = state.settings?.models?.[model] || loadSettings().models[model];
        const targetKey = String(details.targetKey || '');
        const maximum = getSameVillageLimit(config);
        const previousSent = targetKey && run.round.targets[targetKey]?.model === model
            ? Math.max(0, Number(run.round.targets[targetKey].sent) || 0)
            : 0;
        const previousBaseline = targetKey && run.round.targets[targetKey]?.model === model
            ? Math.max(0, Number(run.round.targets[targetKey].baselineActive) || 0)
            : Math.max(0, Number(details.targetActiveCount) || 0);
        const sent = targetKey ? previousSent + 1 : 1;
        const complete = !targetKey || previousBaseline + sent >= maximum;
        const now = Date.now();
        run.counts[model] = (run.counts[model] || 0) + 1;
        if (targetKey) {
            run.round.targets[targetKey] = {
                model,
                sent,
                lastAt: now,
                baselineActive: previousBaseline,
            };
        }
        run.lastSend = {
            model,
            color: String(details.color || ''),
            targetKey,
            at: now,
        };
        registerActiveAttack({
            model,
            sourceId: getVillageId(),
            targetKey,
            targetCoord: details.targetCoord,
            distance: details.distance,
            minutesPerField: details.minutesPerField,
            unitSpeed: details.unitSpeed,
            sentAt: now,
        });
        writeRunState(run);
        return { sent, maximum, complete: true, capacityFull: complete };
    }

    function getSameVillageLimit(config) {
        return config?.sameVillage?.enabled
            ? integerValue(config.sameVillage.max, 2, 2, 50)
            : 1;
    }

    function modelHasCapacity(model, config, activeCounts) {
        const active = activeCounts?.[model] ?? getActiveAttackCount(model);
        return !config?.maxAttacks?.enabled || active < config.maxAttacks.max;
    }

    function renderModelCounts() {
        if (!state.settingsPanel || !state.settings) return;
        const run = readRunState();
        ['a', 'b', 'c'].forEach(model => {
            const roundCount = run?.counts?.[model] || 0;
            const activeCount = getActiveAttackCount(model);
            const limit = state.settings.models[model].maxAttacks;
            const maximum = limit.enabled ? limit.max : '∞';
            const activeBadge = state.settingsPanel.querySelector(`[data-model-active-count="${model}"]`);
            const roundBadge = state.settingsPanel.querySelector(`[data-model-round-count="${model}"]`);
            const activeValue = state.settingsPanel.querySelector(`[data-model-active-value="${model}"]`);
            const roundValue = state.settingsPanel.querySelector(`[data-model-round-value="${model}"]`);
            const nextImpact = getNextActiveImpact(model);
            if (activeBadge) {
                activeBadge.title = nextImpact
                    ? `${activeCount} ataque(s) a caminho do alvo. Próximo impacto previsto: ${formatClock(nextImpact)}.`
                    : `${activeCount} ataque(s) em curso.`;
            }
            if (activeValue) activeValue.textContent = `${activeCount}/${maximum}`;
            if (roundBadge) {
                roundBadge.title = `${roundCount} ataque(s) lançados na ronda atual.`;
            }
            if (roundValue) roundValue.textContent = `${roundCount}/${maximum}`;
        });
        const spyActive = getActiveAttackCount('spy');
        const spyRound = run?.round?.spy?.sent || 0;
        const spyMaximum = state.settings.spy.maxAttacks;
        const spyActiveBadge = state.settingsPanel.querySelector('[data-spy-active-count]');
        const spyRoundBadge = state.settingsPanel.querySelector('[data-spy-round-count]');
        const spyActiveValue = state.settingsPanel.querySelector('[data-spy-active-value]');
        const spyRoundValue = state.settingsPanel.querySelector('[data-spy-round-value]');
        const spyNextImpact = getNextActiveImpact('spy');
        if (spyActiveBadge) {
            spyActiveBadge.title = spyNextImpact
                ? `${spyActive} espionagem(ns) a caminho. Próximo impacto previsto: ${formatClock(spyNextImpact)}.`
                : `${spyActive} espionagem(ns) em curso.`;
        }
        if (spyActiveValue) spyActiveValue.textContent = `${spyActive}/${spyMaximum}`;
        if (spyRoundBadge) {
            spyRoundBadge.title = `${spyRound} espionagem(ns) lançada(s) na ronda atual.`;
        }
        if (spyRoundValue) spyRoundValue.textContent = `${spyRound}/${spyMaximum}`;
        if (!state.spyRunning && state.settings.spy.enabled) setSpyStatus('Pronto');
    }

    function readActiveAttacks() {
        const now = Date.now();
        let stored = [];
        let changed = false;
        try {
            const parsed = JSON.parse(localStorage.getItem(keys.activeAttacks) || '[]');
            stored = Array.isArray(parsed) ? parsed : [];
            if (!Array.isArray(parsed)) changed = true;
        } catch (_) {
            changed = true;
        }

        const clean = [];
        stored.slice(-10000).forEach(value => {
            if (!value || typeof value !== 'object') {
                changed = true;
                return;
            }
            const model = ['a', 'b', 'c', 'spy'].includes(value.model) ? value.model : '';
            const sentAt = Math.max(0, Number(value.sentAt) || now);
            const distance = Number.isFinite(Number(value.distance))
                ? Math.max(0.01, Number(value.distance))
                : 999;
            const minutesPerField = Math.max(1, Number(value.minutesPerField) || 35);
            const unitSpeed = Math.max(0.01, Number(value.unitSpeed) || 1);
            const predictedImpactAt = sentAt + Math.ceil(
                distance * minutesPerField * 60 * 1000 * unitSpeed
            ) + APP.impactSafetyMs;
            const impactAt = Math.max(sentAt, Number(value.impactAt) || predictedImpactAt);
            if (!model || impactAt <= now) {
                changed = true;
                return;
            }
            if (!Number(value.impactAt)) changed = true;
            clean.push({
                id: String(value.id || makeId()),
                model,
                sourceId: String(value.sourceId || ''),
                targetKey: String(value.targetKey || ''),
                targetCoord: String(value.targetCoord || ''),
                sentAt,
                impactAt,
                distance,
                minutesPerField,
                unitSpeed,
            });
        });

        if (changed || clean.length !== stored.length) writeActiveAttacks(clean);
        return clean;
    }

    function writeActiveAttacks(attacks) {
        try {
            localStorage.setItem(keys.activeAttacks, JSON.stringify((attacks || []).slice(-10000)));
        } catch (error) {
            console.warn(`[${APP.shortName}] Não foi possível guardar os ataques em curso.`, error);
        }
    }

    function syncActiveAttacksWithGame(force) {
        const sourceId = getVillageId();
        if (!/^\d+$/.test(sourceId) || state.destroyed || state.captchaPaused) return Promise.resolve(false);
        if (state.activeSyncPromise) return state.activeSyncPromise;
        const syncStorageKey = `${keys.activeSyncAt}.${sourceId}`;
        const lastSyncAt = Math.max(
            state.activeSyncSourceId === sourceId ? state.activeSyncAt : 0,
            Number(sessionStorage.getItem(syncStorageKey)) || 0
        );
        if (!force && Date.now() - lastSyncAt < APP.activeSyncMs) {
            return Promise.resolve(false);
        }

        state.activeSyncAt = Date.now();
        state.activeSyncSourceId = sourceId;
        sessionStorage.setItem(syncStorageKey, String(state.activeSyncAt));
        state.activeSyncPromise = (async () => {
            let snapshot = null;
            let lastError = null;
            for (const mode of ['command', 'commands']) {
                try {
                    const page = await requestBackgroundPage(buildActiveCommandsUrl(sourceId, mode), 15000);
                    const documentValue = new DOMParser().parseFromString(page.text, 'text/html');
                    if (hasCaptchaChallenge(documentValue)) {
                        throw new Error('O jogo pediu uma verificação ao atualizar os ataques em curso.');
                    }
                    const candidate = extractTravellingCommands(documentValue);
                    if (candidate.recognized) {
                        snapshot = candidate;
                        break;
                    }
                } catch (error) {
                    lastError = error;
                }
            }

            if (!snapshot) {
                if (lastError) throw lastError;
                return false;
            }
            if (getVillageId() !== sourceId || state.destroyed) return false;

            const attacks = readActiveAttacks();
            const syncNow = Date.now();
            const activeBefore = new Set(attacks.filter(attack => (
                attack.sourceId === sourceId && attack.impactAt > syncNow
            )).map(attack => attack.id));
            const reconciled = reconcileActiveAttacks(attacks, sourceId, snapshot.commands);
            const activeAfter = new Set(reconciled.filter(attack => (
                attack.sourceId === sourceId && attack.impactAt > syncNow
            )).map(attack => attack.id));
            const released = Array.from(activeBefore).filter(id => !activeAfter.has(id)).length;
            if (reconciled.length === attacks.length && released === 0) return false;

            writeActiveAttacks(reconciled);
            state.idleScans = 0;
            renderModelCounts();
            if (
                automationCanRun() &&
                state.ownsWorker &&
                ensureRunState().round.phase === 'farming'
            ) {
                scheduleFarmStep(100);
            }
            console.info(
                `[${APP.shortName}] Ataques a caminho sincronizados com o Ponto de Encontro: ` +
                `${released} comando(s) já atingiram o alvo ` +
                'ou deixaram de estar em saída.'
            );
            return true;
        })().catch(error => {
            console.warn(
                `[${APP.shortName}] Não foi possível confirmar os ataques em curso no jogo; ` +
                'mantida a previsão local.',
                error
            );
            return false;
        }).finally(() => {
            state.activeSyncPromise = null;
        });
        return state.activeSyncPromise;
    }

    function buildActiveCommandsUrl(sourceId, mode) {
        const url = new URL(window.location.href);
        url.searchParams.set('village', String(sourceId));
        url.searchParams.set('screen', 'place');
        url.searchParams.set('mode', mode);
        ['action', 'ajax', 'ajaxaction', 'page', 'Farm_page', 'farm_page', 'group'].forEach(name => {
            url.searchParams.delete(name);
        });
        url.hash = '';
        return url.href;
    }

    function extractTravellingCommands(documentValue) {
        const roots = Array.from(documentValue.querySelectorAll([
            '#commands_outgoings',
            '[id*="commands_outgoing"]',
            '.commands_outgoings',
        ].join(',')));
        if (!roots.length) {
            const fallbackRows = Array.from(documentValue.querySelectorAll([
                '#content_value .command-row',
                '#content_value table[id*="command"] tr',
                '#content_value table[class*="command"] tr',
            ].join(','))).filter(row => (
                !row.closest('#commands_incomings,[id*="commands_incoming"]') &&
                !row.closest('#commands_returns,#commands_returning,[id*="commands_return"],.commands_returns,.commands_returning,[class*="commands_return"]') &&
                !/(?:return|returning|regresso|retorno)/i.test(`${row.id} ${row.className}`) &&
                row.querySelector('td')
            ));
            if (fallbackRows.length) roots.push(...fallbackRows);
        }
        if (!roots.length) {
            const text = normalizeText(documentValue.body?.textContent || '');
            const empty = /(?:nao (?:ha|existem) comandos|sem comandos|no commands|keine befehle|no hay comandos|aucun(?:e)? commande|nessun comando)/.test(text);
            return {
                recognized: Boolean(empty && documentValue.querySelector('#content_value,#contentContainer')),
                commands: [],
            };
        }

        const rows = new Set();
        roots.forEach(root => {
            if (root.matches('tr,.command-row')) rows.add(root);
            root.querySelectorAll('tr,.command-row').forEach(row => rows.add(row));
        });
        const commands = [];
        rows.forEach(row => {
            if (row.closest('#commands_incomings,[id*="commands_incoming"]')) return;
            if (row.closest('#commands_returns,#commands_returning,[id*="commands_return"],.commands_returns,.commands_returning,[class*="commands_return"]')) return;
            if (/(?:return|returning|regresso|retorno)/i.test(`${row.id} ${row.className}`)) return;
            if (!row.querySelector('td')) return;
            const looksLikeCommand = Boolean(row.querySelector([
                '.timer',
                '[data-endtime]',
                '.quickedit',
                'a[href*="screen=info_command"]',
                'img[src*="command/"]',
            ].join(','))) || /(?:command|attack|outgoing)/i.test(`${row.id} ${row.className}`);
            if (!looksLikeCommand) return;
            commands.push({ keys: extractTravellingCommandKeys(row) });
        });
        return { recognized: true, commands };
    }

    function extractTravellingCommandKeys(row) {
        const keys = new Set();
        const description = `${row.textContent || ''} ${row.outerHTML || ''}`;
        for (const match of description.matchAll(/(\d{1,3})\s*[|]\s*(\d{1,3})/g)) {
            keys.add(`coord:${Number(match[1])}|${Number(match[2])}`);
        }
        row.querySelectorAll('[data-target-id],[data-village-id],a[href]').forEach(element => {
            const direct = String(
                element.getAttribute('data-target-id') ||
                element.getAttribute('data-village-id') ||
                ''
            );
            if (/^\d+$/.test(direct)) keys.add(`village:${direct}`);
            const href = element.getAttribute('href');
            if (!href) return;
            try {
                const target = new URL(href, window.location.href).searchParams.get('target');
                if (/^\d+$/.test(String(target || ''))) keys.add(`village:${target}`);
            } catch (_) {
                // O texto e os atributos já fornecem a alternativa por coordenadas.
            }
        });
        return keys;
    }

    function reconcileActiveAttacks(attacksValue, sourceId, commandsValue) {
        const now = Date.now();
        const attacks = Array.isArray(attacksValue) ? attacksValue : [];
        const commands = (Array.isArray(commandsValue) ? commandsValue : []).map(command => ({
            keys: command?.keys instanceof Set ? command.keys : new Set(command?.keys || []),
            used: false,
        }));
        const current = attacks.filter(attack => attack.sourceId === sourceId)
            .sort((first, second) => second.sentAt - first.sentAt);
        const keepIds = new Set();

        current.forEach(attack => {
            if (attack.impactAt <= now) {
                keepIds.add(attack.id);
                return;
            }
            const keys = new Set([
                attack.targetKey,
                attack.targetCoord ? `coord:${attack.targetCoord}` : '',
            ].filter(Boolean));
            const matched = commands.find(command => (
                !command.used && Array.from(keys).some(key => command.keys.has(key))
            ));
            if (matched) {
                matched.used = true;
                keepIds.add(attack.id);
            }
        });

        current.forEach(attack => {
            if (keepIds.has(attack.id)) return;
            if (now - attack.sentAt <= APP.activeSyncGraceMs) {
                keepIds.add(attack.id);
                return;
            }
            const anonymous = commands.find(command => !command.used && command.keys.size === 0);
            if (anonymous) {
                anonymous.used = true;
                keepIds.add(attack.id);
                return;
            }
        });

        return attacks.filter(attack => (
            attack.sourceId !== sourceId || keepIds.has(attack.id)
        ));
    }

    function registerActiveAttack(details) {
        const sentAt = Math.max(0, Number(details.sentAt) || Date.now());
        const distance = Number.isFinite(Number(details.distance))
            ? Math.max(0.01, Number(details.distance))
            : 999;
        const minutesPerField = Math.max(1, Number(details.minutesPerField) || 35);
        const unitSpeed = Math.max(0.01, Number(details.unitSpeed) || 1);
        const travelMs = distance * minutesPerField * 60 * 1000 * unitSpeed;
        const attack = {
            id: makeId(),
            model: details.model,
            sourceId: String(details.sourceId || getVillageId() || ''),
            targetKey: String(details.targetKey || ''),
            targetCoord: String(details.targetCoord || ''),
            sentAt,
            impactAt: sentAt + Math.ceil(travelMs) + APP.impactSafetyMs,
            distance,
            minutesPerField,
            unitSpeed,
        };
        const attacks = readActiveAttacks();
        attacks.push(attack);
        writeActiveAttacks(attacks);
        return attack;
    }

    function getActiveAttackCount(model) {
        return getActiveAttackCounts()[model] || 0;
    }

    function getActiveAttacksForCurrentVillage() {
        const sourceId = getVillageId();
        return readActiveAttacks().filter(attack => !sourceId || attack.sourceId === sourceId);
    }

    function getActiveAttackCounts(attacksValue) {
        const counts = { a: 0, b: 0, c: 0, spy: 0 };
        const attacks = Array.isArray(attacksValue)
            ? attacksValue
            : getActiveAttacksForCurrentVillage();
        attacks.forEach(attack => {
            if (attack.model in counts && attack.impactAt > Date.now()) counts[attack.model] += 1;
        });
        return counts;
    }

    function getActiveTargetStatus(model, targetKey, config, attacksValue) {
        const maximum = getSameVillageLimit(config);
        if (!targetKey) return { count: 0, maximum, slotAt: 0 };
        const attacks = Array.isArray(attacksValue)
            ? attacksValue
            : getActiveAttacksForCurrentVillage();
        const matching = attacks.filter(attack => (
            attack.model === model && attack.targetKey === targetKey
        ));
        const now = Date.now();
        const activeMatching = matching.filter(attack => attack.impactAt > now);
        return {
            count: activeMatching.length,
            maximum,
            slotAt: activeMatching.length
                ? Math.min(...activeMatching.map(attack => attack.impactAt))
                : 0,
        };
    }

    function getNextActiveImpact(model) {
        const sourceId = getVillageId();
        const impactTimes = readActiveAttacks().filter(attack => (
            attack.model === model &&
            attack.impactAt > Date.now() &&
            (!sourceId || attack.sourceId === sourceId)
        )).map(attack => attack.impactAt);
        return impactTimes.length ? Math.min(...impactTimes) : 0;
    }

    function formatClock(timestamp) {
        try {
            return new Date(timestamp).toLocaleTimeString('pt-PT', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
        } catch (_) {
            return new Date(timestamp).toLocaleTimeString();
        }
    }

    async function loadWorldUnitSpeed() {
        if (state.captchaPaused) throw new Error('Automação pausada por verificação/CAPTCHA.');
        if (Number.isFinite(state.unitSpeed) && state.unitSpeed > 0) return state.unitSpeed;
        if (state.unitSpeedPromise) return state.unitSpeedPromise;

        const cached = Number(localStorage.getItem(keys.unitSpeed));
        if (Number.isFinite(cached) && cached > 0) {
            state.unitSpeed = cached;
            return cached;
        }

        state.unitSpeedPromise = (async () => {
            const controller = new AbortController();
            const timer = window.setTimeout(() => controller.abort(), 8000);
            try {
                const response = await fetch('/interface.php?func=get_config', {
                    credentials: 'same-origin',
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const responseText = await response.text();
                if (responseHasCaptcha(responseText)) {
                    pauseForCaptcha('resposta da configuração do mundo', true);
                    throw new Error('O jogo pediu uma verificação/CAPTCHA.');
                }
                const xml = new DOMParser().parseFromString(responseText, 'text/xml');
                const value = Number(xml.querySelector('unit_speed')?.textContent);
                if (!Number.isFinite(value) || value <= 0) throw new Error('unit_speed inválido');
                state.unitSpeed = value;
                localStorage.setItem(keys.unitSpeed, String(value));
                return value;
            } catch (error) {
                console.warn(`[${APP.shortName}] Velocidade das unidades indisponível; usado o valor seguro 1.`, error);
                state.unitSpeed = 1;
                return 1;
            } finally {
                window.clearTimeout(timer);
                state.unitSpeedPromise = null;
            }
        })();
        return state.unitSpeedPromise;
    }

    function getModelSlowestMinutesPerField(model) {
        const units = getFarmTemplateUnits(model);
        const speeds = Object.entries(units)
            .filter(([, amount]) => Number(amount) > 0)
            .map(([unit]) => UNIT_MINUTES_PER_FIELD[unit])
            .filter(Number.isFinite);
        if (speeds.length) return Math.max(...speeds);

        console.warn(
            `[${APP.shortName}] Não foi possível ler as unidades do Modelo ${model.toUpperCase()}; ` +
            'o impacto será calculado pela unidade mais lenta.'
        );
        return UNIT_MINUTES_PER_FIELD.snob;
    }

    function getFarmTemplateUnits(model) {
        const result = {};
        const templates = window.Accountmanager?.farm?.templates;
        const templateId = getFarmTemplateId(model);
        let template = templates?.[model] || templates?.[model.toUpperCase()] || null;
        if (!template && templates && typeof templates === 'object') {
            template = Object.values(templates).find(value => (
                value && typeof value === 'object' &&
                templateId && String(value.id || value.template_id || '') === String(templateId)
            )) || null;
        }
        collectTemplateUnits(template, result);

        if (!Object.values(result).some(value => value > 0)) {
            Object.assign(result, getFarmTemplateUnitsFromDom(model, templateId));
        }
        return result;
    }

    function getFarmTemplateAvailability(model) {
        const required = getFarmTemplateUnits(model);
        const available = getAvailableFarmUnitsFromDom();
        const requirements = Object.entries(required)
            .filter(([, amount]) => Number(amount) > 0);
        const known = requirements.length > 0 && Object.keys(available).length > 0;
        if (!known) return { known: false, available: true, missing: [] };

        const missing = requirements.filter(([unit, amount]) => (
            Number(available[unit] ?? 0) < Number(amount)
        )).map(([unit, amount]) => (
            `${unit} ${Number(available[unit] ?? 0)}/${Number(amount)}`
        ));
        return { known: true, available: missing.length === 0, missing };
    }

    function collectTemplateUnits(template, result) {
        if (!template || typeof template !== 'object') return;
        const sources = [template, template.units, template.unit_counts, template.troops]
            .filter(value => value && typeof value === 'object');
        Object.keys(UNIT_MINUTES_PER_FIELD).forEach(unit => {
            for (const source of sources) {
                const amount = Number(source[unit]);
                if (Number.isFinite(amount) && amount >= 0) {
                    result[unit] = amount;
                    break;
                }
            }
        });
    }

    function getFarmTemplateId(model) {
        const button = document.querySelector(
            `#plunder_list a.farm_icon_${model},#am_widget_Farm a.farm_icon_${model}`
        );
        if (!button) return '';
        const values = [
            button.getAttribute('data-template-id'),
            button.getAttribute('data-template'),
            button.dataset?.templateId,
            button.dataset?.template,
        ];
        for (const value of values) {
            if (/^\d+$/.test(String(value || ''))) return String(value);
        }
        const code = [
            button.getAttribute('href'),
            button.getAttribute('onclick'),
            button.outerHTML,
        ].filter(Boolean).join(' ');
        const explicit = code.match(/(?:template_id|template)[^0-9]{0,12}(\d+)/i);
        if (explicit) return explicit[1];
        const call = code.match(/Accountmanager[.]farm[.]sendUnits\s*[(]\s*[^,]+\s*,\s*\d+\s*,\s*(\d+)/i);
        return call?.[1] || '';
    }

    function getFarmTemplateUnitsFromDom(model, templateId) {
        const result = {};
        const root = document.querySelector('#am_widget_Farm');
        if (!root) return result;
        const unitInputs = Array.from(root.querySelectorAll('input')).filter(input => getInputUnitName(input));
        const inputRows = Array.from(new Set(unitInputs.map(input => input.closest('tr')).filter(Boolean)));
        const fallbackRow = inputRows[{ a: 0, b: 1, c: 2 }[model]] || null;

        unitInputs.forEach(input => {
            const row = input.closest('tr');
            const unit = getInputUnitName(input);
            if (!unit || !templateInputBelongsToModel(input, row, model, templateId, fallbackRow)) return;
            const amount = Number(input.value);
            if (Number.isFinite(amount) && amount >= 0) result[unit] = amount;
        });
        return result;
    }

    function getInputUnitName(input) {
        const cell = input.closest('td,th');
        const values = [
            input.name,
            input.id,
            input.className,
            input.getAttribute('data-unit'),
            cell?.className,
            cell?.querySelector('img')?.getAttribute('src'),
        ].filter(Boolean).join(' ').toLowerCase();
        return Object.keys(UNIT_MINUTES_PER_FIELD).find(unit => (
            new RegExp(`(?:^|[^a-z])(?:unit[_-]?)?${unit}(?:[^a-z]|$)`).test(values)
        )) || '';
    }

    function getAvailableFarmUnitsFromDom() {
        const result = {};
        const root = document.querySelector('#am_widget_Farm');
        if (!root) return result;

        Object.keys(UNIT_MINUTES_PER_FIELD).forEach(unit => {
            const candidates = [
                root.querySelector(`#${unit}`),
                root.querySelector(`[data-unit="${unit}"][data-count]`),
                root.querySelector(`[data-unit="${unit}"].unit-count`),
                root.querySelector(`.unit-item-${unit}`),
                root.querySelector(`.unit_${unit}`),
            ].filter(Boolean);
            for (const element of candidates) {
                const values = [
                    element.getAttribute?.('data-count'),
                    element.getAttribute?.('data-value'),
                    element.textContent,
                ];
                const parsed = values.map(parseFarmUnitAmount)
                    .find(Number.isFinite);
                if (Number.isFinite(parsed)) {
                    result[unit] = parsed;
                    break;
                }
            }
        });

        root.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            const unit = getInputUnitName(checkbox);
            const cell = checkbox.closest('td,th');
            const row = cell?.closest('tr');
            if (!unit || !cell || !row) return;

            let amount = null;
            let candidateRow = row.nextElementSibling;
            for (let index = 0; candidateRow && index < 3; index += 1) {
                const candidateCell = candidateRow.cells?.[cell.cellIndex];
                const parsed = parseFarmUnitAmount(candidateCell?.textContent);
                if (Number.isFinite(parsed)) {
                    amount = parsed;
                    break;
                }
                candidateRow = candidateRow.nextElementSibling;
            }
            if (Number.isFinite(amount) && amount >= 0) result[unit] = amount;
        });
        return result;
    }

    function parseFarmUnitAmount(value) {
        const text = String(value ?? '').trim().replace(/\s+/g, '');
        if (!/^\d{1,3}(?:[.]\d{3})*$/.test(text) && !/^\d+$/.test(text)) return NaN;
        return Number(text.replace(/[.]/g, ''));
    }

    function templateInputBelongsToModel(input, row, model, templateId, fallbackRow) {
        const rows = [row, row?.previousElementSibling, row?.previousElementSibling?.previousElementSibling]
            .filter(Boolean);
        const structural = [
            input.name,
            input.id,
            input.getAttribute('data-template-id'),
            ...rows.map(value => value.outerHTML),
        ].filter(Boolean).join(' ');
        if (templateId && new RegExp(`(?:^|[^0-9])${templateId}(?:[^0-9]|$)`).test(structural)) {
            return true;
        }
        if (new RegExp(`farm_icon_${model}|modelo?\\s+${model}|model\\s+${model}`, 'i').test(structural)) {
            return true;
        }
        if (rows.some(value => Array.from(value.cells || []).some(cell => (
            normalizeText(cell.textContent) === model
        )))) return true;
        return row === fallbackRow;
    }

    function normalizeRoundState(value) {
        const allowed = new Set([
            'start',
            'start_reloading',
            'changing_page',
            'changing_village',
            'farming',
            'spying',
            'end_reloading',
            'waiting',
        ]);
        const source = value && typeof value === 'object' ? value : {};
        const villages = normalizeVillageIds(source.villages);
        const completedVillages = normalizeVillageIds(source.completedVillages)
            .filter(id => villages.includes(id));
        return {
            number: integerValue(source.number, 1, 1, 1000000),
            phase: allowed.has(source.phase) ? source.phase : 'farming',
            pauseUntil: Math.max(0, Number(source.pauseUntil) || 0),
            farmCompleted: source.farmCompleted === true,
            targets: normalizeRoundTargets(source.targets),
            spy: normalizeRoundSpy(source.spy),
            groupId: /^-?\d+$/.test(String(source.groupId || '')) ? String(source.groupId) : '',
            groupName: String(source.groupName || '').slice(0, 120),
            villages,
            completedVillages,
            currentVillageId: /^\d+$/.test(String(source.currentVillageId || ''))
                ? String(source.currentVillageId)
                : '',
            visitedPages: Array.from(new Set(
                (Array.isArray(source.visitedPages) ? source.visitedPages : [])
                    .map(value => String(value || '').slice(0, 80))
                    .filter(Boolean)
            )).slice(0, 500),
            exhaustedModels: Array.from(new Set(
                (Array.isArray(source.exhaustedModels) ? source.exhaustedModels : [])
                    .filter(model => ['a', 'b', 'c'].includes(model))
            )),
        };
    }

    function normalizeVillageIds(value) {
        return Array.from(new Set(
            (Array.isArray(value) ? value : [])
                .map(id => String(id || ''))
                .filter(id => /^\d+$/.test(id) && Number(id) > 0)
        )).slice(0, 10000);
    }

    function normalizeRoundSpy(value) {
        const source = value && typeof value === 'object' ? value : {};
        const attempted = {};
        if (source.attempted && typeof source.attempted === 'object' && !Array.isArray(source.attempted)) {
            Object.entries(source.attempted).slice(0, 1000).forEach(([id, result]) => {
                if (/^\d+$/.test(id)) attempted[id] = String(result || 'tentado').slice(0, 40);
            });
        }
        return {
            sent: integerValue(source.sent, 0, 0, 500),
            attempted,
        };
    }

    function normalizeRoundTargets(value) {
        const targets = {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) return targets;

        Object.entries(value).slice(0, 3000).forEach(([targetKey, progress]) => {
            if (!/^(?:village:\d+|coord:\d{1,3}[|]\d{1,3})$/.test(targetKey)) return;
            if (!progress || typeof progress !== 'object') return;
            const model = ['a', 'b', 'c'].includes(progress.model) ? progress.model : '';
            if (!model) return;
            targets[targetKey] = {
                model,
                sent: integerValue(progress.sent, 1, 1, 50),
                lastAt: Math.max(0, Number(progress.lastAt) || 0),
                baselineActive: integerValue(progress.baselineActive, 0, 0, 50),
            };
        });
        return targets;
    }

    function normalizeLastSend(value) {
        if (!value || typeof value !== 'object') return null;
        const model = ['a', 'b', 'c'].includes(value.model) ? value.model : '';
        const color = ['blue', 'green', 'yellow', 'red', 'redBlue', 'redYellow'].includes(value.color)
            ? value.color
            : '';
        if (!model || !color) return null;
        return {
            model,
            color,
            targetKey: String(value.targetKey || ''),
            at: Number(value.at) || 0,
        };
    }

    function writeRunState(run) {
        localStorage.setItem(keys.run, JSON.stringify(run));
        renderModelCounts();
        return run;
    }

    function readWorker() {
        try {
            const value = JSON.parse(localStorage.getItem(keys.worker) || 'null');
            return value && value.world === world ? value : null;
        } catch (_) {
            return null;
        }
    }

    function readWorkerOpening() {
        try {
            const value = JSON.parse(localStorage.getItem(keys.workerOpening) || 'null');
            return value && value.world === world ? value : null;
        } catch (_) {
            return null;
        }
    }

    function isFreshWorkerOpening(opening) {
        return Boolean(
            opening &&
            opening.version === APP.version &&
            Number.isFinite(Number(opening.openedAt)) &&
            Date.now() - Number(opening.openedAt) < APP.workerLaunchGraceMs
        );
    }

    function claimWorkerOpening(url) {
        const current = readWorkerOpening();
        if (isFreshWorkerOpening(current)) return current.tabId === tabId;

        const opening = {
            tabId,
            world,
            version: APP.version,
            url: String(url || ''),
            openedAt: Date.now(),
        };
        localStorage.setItem(keys.workerOpening, JSON.stringify(opening));
        return readWorkerOpening()?.tabId === tabId;
    }

    function clearWorkerOpening(onlyOwned = true) {
        const current = readWorkerOpening();
        if (!current || !onlyOwned || current.tabId === tabId) {
            localStorage.removeItem(keys.workerOpening);
        }
    }

    function isFreshWorker(worker) {
        return Boolean(
            worker &&
            worker.version === APP.version &&
            Number.isFinite(Number(worker.updatedAt)) &&
            Date.now() - Number(worker.updatedAt) < APP.workerFreshMs
        );
    }

    function isEnabled() {
        return localStorage.getItem(keys.enabled) === '1';
    }

    function isManagedWorker() {
        try {
            const url = new URL(window.location.href);
            const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
            return window.name === workerWindowName ||
                url.searchParams.get(workerUrlParameter) === '1' ||
                hash.get(workerUrlParameter) === '1';
        } catch (_) {
            return window.name === workerWindowName;
        }
    }

    function isFarmPage() {
        const gameScreen = String(window.game_data?.screen || '').toLowerCase();
        const urlScreen = String(new URL(window.location.href).searchParams.get('screen') || '').toLowerCase();
        return gameScreen ? gameScreen === 'am_farm' : urlScreen === 'am_farm';
    }

    function getFarmAssistantAccessState() {
        if (hasFarmAssistantInterface()) return true;

        const features = window.game_data?.features;
        if (features && typeof features === 'object') {
            const entries = Object.entries(features);
            const farmState = featureStateFromEntries(entries, [
                'farmassistant',
                'farmassistent',
                'farmmanager',
            ]);
            if (farmState !== null) return farmState;

            const accountManagerState = featureStateFromEntries(entries, [
                'accountmanager',
                'accountmanagement',
            ]);
            if (accountManagerState !== null) return accountManagerState;
        }

        if (isFarmPage() && hasFarmAssistantUnavailableMessage()) return false;
        return null;
    }

    function featureStateFromEntries(entries, names) {
        let inactiveSeen = false;
        for (const [key, value] of entries) {
            const normalizedKey = String(key).toLowerCase().replace(/[^a-z]/g, '');
            if (!names.includes(normalizedKey)) continue;
            const stateValue = normalizeFeatureActiveState(value);
            if (stateValue === true) return true;
            if (stateValue === false) inactiveSeen = true;
        }
        return inactiveSeen ? false : null;
    }

    function normalizeFeatureActiveState(value) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return Number.isFinite(value) ? value > 0 : null;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (['true', 'active', 'enabled', '1'].includes(normalized)) return true;
            if (['false', 'inactive', 'disabled', '0', ''].includes(normalized)) return false;
            const numeric = Number(normalized);
            return Number.isFinite(numeric) ? numeric > 0 : null;
        }
        if (value && typeof value === 'object') {
            for (const key of ['active', 'enabled']) {
                if (!(key in value)) continue;
                const stateValue = normalizeFeatureActiveState(value[key]);
                if (stateValue !== null) return stateValue;
            }
        }
        return null;
    }

    function hasFarmAssistantInterface() {
        if (typeof window.Accountmanager?.farm?.sendUnits === 'function') return true;
        return Boolean(document.querySelector([
            '#am_widget_Farm',
            '#farm_commands',
            'a.farm_icon_a',
            'a.farm_icon_b',
            '.farm_icon_a',
            '.farm_icon_b',
        ].join(',')));
    }

    function hasFarmAssistantUnavailableMessage() {
        const text = String(document.body?.innerText || document.body?.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
        return /(?:assistente de (?:saque|farm)|farm assistant|gestor de conta|account manager).{0,140}(?:n[aã]o (?:est[aá] )?ativ|inativ|expir|necess[aá]ri|indispon[ií]vel|not active|disabled|expired|required)/i.test(text) ||
            /(?:ativar|adquirir|comprar|enable|activate).{0,100}(?:assistente de (?:saque|farm)|farm assistant|gestor de conta|account manager)/i.test(text);
    }

    function getWorld() {
        const gameWorld = String(window.game_data?.world || '').trim();
        const hostWorld = String(window.location.hostname.split('.')[0] || '').trim();
        return sanitizeKey(gameWorld || hostWorld || window.location.hostname || 'unknown-world');
    }

    function getVillageId() {
        const gameVillage = Number(window.game_data?.village?.id || 0);
        if (gameVillage > 0) return String(gameVillage);
        return new URL(window.location.href).searchParams.get('village') || '';
    }

    function sanitizeKey(value) {
        return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 80) || 'unknown-world';
    }

    function defaultModel(enabled) {
        return {
            enabled,
            wall: { enabled: false, max: 20 },
            distance: { enabled: false, max: 50 },
            maxAttacks: { enabled: false, max: 100 },
            sameVillage: { enabled: false, max: 2 },
            loot: { full: true, partial: true },
            reports: {
                blue: true,
                green: true,
                yellow: false,
                red: false,
                redBlue: false,
                redYellow: false,
            },
        };
    }

    function loadSettings() {
        try {
            return normalizeSettings(JSON.parse(localStorage.getItem(keys.settings) || 'null'));
        } catch (error) {
            console.warn(`[${APP.shortName}] Definições inválidas; foram usadas as predefinições.`, error);
            return normalizeSettings(null);
        }
    }

    function normalizeSettings(value) {
        const source = value && typeof value === 'object' ? value : {};
        const models = {};
        const generalSource = source.general || {};
        const farmSource = source.farm || {};
        const spySource = source.spy || {};

        ['a', 'b', 'c'].forEach(modelKey => {
            const fallback = DEFAULT_SETTINGS.models[modelKey];
            const model = source.models?.[modelKey] || {};
            models[modelKey] = {
                enabled: booleanValue(model.enabled, fallback.enabled),
                wall: {
                    enabled: booleanValue(model.wall?.enabled, fallback.wall.enabled),
                    max: integerValue(model.wall?.max, fallback.wall.max, 0, 20),
                },
                distance: {
                    enabled: booleanValue(model.distance?.enabled, fallback.distance.enabled),
                    max: integerValue(model.distance?.max, fallback.distance.max, 0, 999),
                },
                maxAttacks: {
                    enabled: booleanValue(model.maxAttacks?.enabled, fallback.maxAttacks.enabled),
                    max: integerValue(model.maxAttacks?.max, fallback.maxAttacks.max, 1, 10000),
                },
                sameVillage: {
                    enabled: booleanValue(model.sameVillage?.enabled, fallback.sameVillage.enabled),
                    max: integerValue(model.sameVillage?.max, fallback.sameVillage.max, 2, 50),
                },
                loot: {
                    full: booleanValue(model.loot?.full, fallback.loot.full),
                    partial: booleanValue(model.loot?.partial, fallback.loot.partial),
                },
                reports: {
                    blue: booleanValue(model.reports?.blue, fallback.reports.blue),
                    green: booleanValue(model.reports?.green, fallback.reports.green),
                    yellow: booleanValue(model.reports?.yellow, fallback.reports.yellow),
                    red: booleanValue(model.reports?.red, fallback.reports.red),
                    redBlue: booleanValue(model.reports?.redBlue, fallback.reports.redBlue),
                    redYellow: booleanValue(model.reports?.redYellow, fallback.reports.redYellow),
                },
            };
        });

        return {
            schema: 11,
            general: {
                attackIntervalMs: integerValue(
                    generalSource.attackIntervalMs,
                    DEFAULT_SETTINGS.general.attackIntervalMs,
                    APP.minAttackMs,
                    60000
                ),
                roundPauseSeconds: integerValue(
                    generalSource.roundPauseSeconds,
                    DEFAULT_SETTINGS.general.roundPauseSeconds,
                    1,
                    86400
                ),
            },
            farm: {
                groupId: /^-?\d+$/.test(String(farmSource.groupId ?? '0'))
                    ? String(farmSource.groupId ?? '0')
                    : DEFAULT_SETTINGS.farm.groupId,
            },
            models,
            spy: {
                enabled: booleanValue(spySource.enabled, DEFAULT_SETTINGS.spy.enabled),
                scoutsPerVillage: integerValue(
                    spySource.scoutsPerVillage,
                    DEFAULT_SETTINGS.spy.scoutsPerVillage,
                    1,
                    100
                ),
                radius: integerValue(spySource.radius, DEFAULT_SETTINGS.spy.radius, 1, 200),
                maxAttacks: integerValue(
                    spySource.maxAttacks ?? spySource.maxPerRound,
                    DEFAULT_SETTINGS.spy.maxAttacks,
                    1,
                    500
                ),
                intervalMs: integerValue(
                    spySource.intervalMs,
                    DEFAULT_SETTINGS.spy.intervalMs,
                    APP.minAttackMs,
                    60000
                ),
            },
        };
    }

    function booleanValue(value, fallback) {
        return typeof value === 'boolean' ? value : fallback;
    }

    function integerValue(value, fallback, min, max) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(max, Math.max(min, Math.round(number)));
    }

    function getByPath(object, path) {
        return String(path).split('.').reduce((value, key) => value?.[key], object);
    }

    function setByPath(object, path, value) {
        const parts = String(path).split('.');
        const last = parts.pop();
        const target = parts.reduce((parent, key) => {
            if (!parent[key] || typeof parent[key] !== 'object') parent[key] = {};
            return parent[key];
        }, object);
        target[last] = value;
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function makeId() {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID();
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    function notify(type, message) {
        const ui = window.UI;
        if (type === 'error' && typeof ui?.ErrorMessage === 'function') {
            ui.ErrorMessage(message, 5000);
            return;
        }
        if (type === 'success' && typeof ui?.SuccessMessage === 'function') {
            ui.SuccessMessage(message, 3500);
            return;
        }
        console[type === 'error' ? 'error' : 'info'](`[${APP.shortName}] ${message}`);
    }

    function destroy() {
        if (state.destroyed) return;
        state.destroyed = true;
        state.captchaObserver?.disconnect();
        state.captchaObserver = null;
        window.clearInterval(state.monitorTimer);
        window.clearInterval(state.settingsTimerInterval);
        window.clearTimeout(state.savedTimer);
        window.clearTimeout(state.captchaCheckTimer);
        window.clearTimeout(state.captchaResumeTimer);
        window.clearTimeout(state.captchaReloadTimer);
        stopBackgroundClock();
        stopWorker();
    }

    function ready(callback) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback, { once: true });
        } else {
            callback();
        }
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
})(
    typeof unsafeWindow !== 'undefined' ? unsafeWindow : window,
    typeof window.close === 'function' ? window.close.bind(window) : null
);
