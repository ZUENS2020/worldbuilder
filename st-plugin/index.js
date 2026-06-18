/**
 * WorldBuilder Context Plugin for SillyTavern (UI extension) v0.6.0
 *
 * - Graph / visibility / belief context injection (N-hop)
 * - Optional simulation memory block
 * - ST chat writeback queue (review in WorldBuilder frontend)
 */

const MODULE_NAME = 'worldbuilder';
const PLUGIN_VERSION = '0.6.0';

const defaultSettings = {
    worldbuilder_url: 'http://localhost:8000',
    project_id: '',
    max_hop: 2,
    context_mode: 'visibility',       // truth | visibility | belief
    auto_seed_beliefs: true,
    injection_position: 'before_char', // before_char | after_char | before_system | before_scenario | macro_only
    enabled: true,
    simulation_id: '',
    inject_memory: false,
    writeback_enabled: false,
};

let settings = { ...defaultSettings };
let lastInjectionText = '';
let projectsCache = [];
let simsCache = [];

function apiBase() {
    const url = (settings.worldbuilder_url || '').replace(/\/$/, '');
    return url.endsWith('/api') ? url : `${url}/api`;
}

function getSettings() {
    const context = SillyTavern.getContext();
    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = { ...defaultSettings };
    }
    for (const key of Object.keys(defaultSettings)) {
        if (context.extensionSettings[MODULE_NAME][key] === undefined) {
            context.extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }
    settings = context.extensionSettings[MODULE_NAME];
    return settings;
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

function charName() {
    const ctx = SillyTavern.getContext();
    return ctx.name2 || '';
}

// ==========================================
// Lifecycle
// ==========================================

jQuery(async () => {
    const context = SillyTavern.getContext();
    getSettings();

    const settingsHtml = `
        <div id="worldbuilder-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>🌐 WorldBuilder</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <p>Graph-based context injection · visibility · belief · ST writeback queue.</p>
                    <div class="flex-container">
                        <label>API URL</label>
                        <input id="wb_url" type="text" class="text_pole" value="${settings.worldbuilder_url}" />
                    </div>
                    <div class="flex-container">
                        <label>Project</label>
                        <select id="wb_project_select" class="text_pole"><option value="">— loading —</option></select>
                    </div>
                    <div class="flex-container">
                        <label>Context mode</label>
                        <select id="wb_context_mode" class="text_pole">
                            <option value="truth">truth（全知）</option>
                            <option value="visibility">visibility（观察者迷雾）</option>
                            <option value="belief">belief（信念副本）</option>
                        </select>
                    </div>
                    <div class="flex-container">
                        <label>Hop</label>
                        <input id="wb_hop" type="number" min="1" max="5" value="${settings.max_hop}" />
                    </div>
                    <div class="flex-container">
                        <label>Simulation</label>
                        <select id="wb_sim_select" class="text_pole"><option value="">— none —</option></select>
                    </div>
                    <div class="flex-container">
                        <input id="wb_inject_memory" type="checkbox" ${settings.inject_memory ? 'checked' : ''} />
                        <label for="wb_inject_memory">Inject simulation memory</label>
                    </div>
                    <div class="flex-container">
                        <input id="wb_writeback" type="checkbox" ${settings.writeback_enabled ? 'checked' : ''} />
                        <label for="wb_writeback">Queue ST exchanges for writeback</label>
                    </div>
                    <div class="flex-container">
                        <label>Inject at</label>
                        <select id="wb_position" class="text_pole">
                            <option value="before_char">Before first char message</option>
                            <option value="after_char">After last char message</option>
                            <option value="before_system">Before system prompt</option>
                            <option value="before_scenario">Before scenario (macro)</option>
                            <option value="macro_only">macro_only — use {{worldbuilder_context}}</option>
                        </select>
                    </div>
                    <div class="flex-container">
                        <input id="wb_enabled" type="checkbox" ${settings.enabled ? 'checked' : ''} />
                        <label for="wb_enabled">Enabled</label>
                    </div>
                    <details id="wb_last_injection" style="margin-top:6px;font-size:0.75em;">
                        <summary>Last injection preview</summary>
                        <pre id="wb_injection_preview" style="white-space:pre-wrap;max-height:120px;overflow:auto;"></pre>
                    </details>
                    <hr>
                    <div id="wb_status" style="font-size:0.8em;color:#888;"></div>
                </div>
            </div>
        </div>
    `;

    $('#extensions_settings').append(settingsHtml);
    $('#wb_context_mode').val(settings.context_mode);
    $('#wb_position').val(settings.injection_position);

    $('#wb_url').on('change', async () => {
        settings.worldbuilder_url = String($('#wb_url').val());
        saveSettings();
        await refreshProjects();
    });
    $('#wb_project_select').on('change', async () => {
        settings.project_id = String($('#wb_project_select').val());
        saveSettings();
        await refreshSims();
        await runHealthCheck();
    });
    $('#wb_sim_select').on('change', () => {
        settings.simulation_id = String($('#wb_sim_select').val());
        saveSettings();
        refreshPendingCount();
    });
    $('#wb_context_mode').on('change', () => { settings.context_mode = String($('#wb_context_mode').val()); saveSettings(); });
    $('#wb_hop').on('input', () => { settings.max_hop = parseInt(String($('#wb_hop').val())) || 2; saveSettings(); });
    $('#wb_position').on('change', () => { settings.injection_position = String($('#wb_position').val()); saveSettings(); });
    $('#wb_enabled').on('change', () => { settings.enabled = $('#wb_enabled').is(':checked'); saveSettings(); });
    $('#wb_inject_memory').on('change', () => { settings.inject_memory = $('#wb_inject_memory').is(':checked'); saveSettings(); });
    $('#wb_writeback').on('change', () => { settings.writeback_enabled = $('#wb_writeback').is(':checked'); saveSettings(); });

    context.eventSource.on(context.eventTypes.CHAT_COMPLETION_PROMPT_READY, onPromptReady);

    const genEnd = context.eventTypes.GENERATION_END
        || context.eventTypes.GENERATION_AFTER
        || context.eventTypes.MESSAGE_RECEIVED;
    if (genEnd) {
        context.eventSource.on(genEnd, onGenerationEnd);
    }

    // Expose macro for manual placement
    if (typeof window !== 'undefined') {
        window.worldbuilder_get_context = buildInjectionText;
    }

    await refreshProjects();
    await runHealthCheck();
    console.log('[WorldBuilder] plugin loaded v' + PLUGIN_VERSION);
});

// ==========================================
// Prompt injection
// ==========================================

async function onPromptReady(eventData) {
    if (!settings.enabled) return;
    if (eventData?.dryRun) return;
    if (settings.injection_position === 'macro_only') return;

    try {
        const injectionText = await buildInjectionText(eventData);
        if (!injectionText) return;

        injectIntoPrompt(eventData, injectionText);
        lastInjectionText = injectionText;
        $('#wb_injection_preview').text(injectionText.slice(0, 4000));
    } catch (error) {
        console.error('[WorldBuilder] error:', error);
        $('#wb_status').text(`❌ ${error.message}`);
    }
}

async function buildInjectionText(eventData) {
    const characterNames = extractCharacterNames(eventData);
    if (characterNames.length === 0) return '';

    const projectId = await resolveProjectId();
    if (!projectId) return '';

    await checkEntityMapping(projectId, charName());

    const parts = [];

    if (settings.inject_memory && settings.simulation_id && charName()) {
        const mem = await fetchMemoryBlock(projectId, settings.simulation_id, charName());
        if (mem?.block) {
            parts.push(`[WorldBuilder 记忆]\n${mem.block}\n[/WorldBuilder 记忆]`);
        }
    }

    const ctx = await fetchContext(projectId, characterNames);
    if (ctx?.system_injection) {
        const label = settings.context_mode === 'belief'
            ? 'WorldBuilder 信念上下文'
            : 'WorldBuilder 图谱上下文';
        parts.push(`[${label}]\n${ctx.system_injection}\n[/${label}]`);
    }

    if (ctx?.active_warnings?.length) {
        parts.push('[⚠️ 矛盾预警]\n' + ctx.active_warnings.map(w => `⚠️ ${w}`).join('\n') + '\n[/⚠️ 矛盾预警]');
    }

    const injectionText = parts.join('\n\n');
    if (injectionText) {
        const tokens = (ctx?.token_count || 0) + (parts[0]?.includes('记忆') ? 50 : 0);
        $('#wb_status').text(`✅ Injected for [${characterNames.join(', ')}] (~${tokens} tokens)`);
    }
    return injectionText;
}

function extractCharacterNames(eventData) {
    const names = new Set();
    const cn = charName();
    if (cn) names.add(cn);

    const chat = eventData?.chat;
    if (Array.isArray(chat)) {
        for (const msg of chat.slice(-5)) {
            const content = typeof msg?.content === 'string' ? msg.content : '';
            const mentions = content.match(/@(\S+)/g);
            if (mentions) mentions.forEach(m => names.add(m.slice(1)));
        }
    }
    return Array.from(names);
}

async function resolveProjectId() {
    if (settings.project_id) return settings.project_id;
    await refreshProjects();
    return settings.project_id || null;
}

async function fetchContext(projectId, characterNames) {
    const mode = settings.context_mode || 'visibility';
    const params = new URLSearchParams({
        characters: characterNames.join(','),
        hop: String(settings.max_hop || 2),
    });

    const observer = charName();
    let path;
    if (mode === 'belief') {
        if (!observer) throw new Error('belief mode requires a character card (observer)');
        if (settings.auto_seed_beliefs) {
            await fetch(`${apiBase()}/projects/${projectId}/beliefs/seed`, { method: 'POST' }).catch(() => {});
        }
        params.set('observer', observer);
        path = `${apiBase()}/projects/${projectId}/beliefs/context?${params}`;
    } else {
        if (mode === 'visibility' && observer) {
            params.set('observer', observer);
        }
        path = `${apiBase()}/projects/${projectId}/entities/context?${params}`;
    }

    const response = await fetch(path);
    if (!response.ok) throw new Error(`Context API ${response.status}`);
    return response.json();
}

async function fetchMemoryBlock(projectId, simId, entityName) {
    const params = new URLSearchParams({ entity: entityName, recent_k: '8' });
    const response = await fetch(
        `${apiBase()}/projects/${projectId}/simulations/${simId}/memory-block?${params}`,
    );
    if (!response.ok) return null;
    return response.json();
}

function injectIntoPrompt(eventData, injectionText) {
    const chat = eventData?.chat;
    if (!Array.isArray(chat)) return;

    const entry = { role: 'system', content: injectionText };
    const position = settings.injection_position;

    if (position === 'before_system') {
        chat.unshift(entry);
    } else if (position === 'after_char') {
        const lastCharIdx = chat.findLastIndex(m => m.role === 'assistant');
        chat.splice(lastCharIdx >= 0 ? lastCharIdx + 1 : chat.length, 0, entry);
    } else if (position === 'before_scenario') {
        const sysIdx = chat.findIndex(m => m.role === 'system');
        chat.splice(sysIdx >= 0 ? sysIdx : 0, 0, entry);
    } else {
        const firstCharIdx = chat.findIndex(m => m.role === 'assistant');
        chat.splice(firstCharIdx >= 0 ? firstCharIdx : chat.length, 0, entry);
    }
}

// ==========================================
// Writeback queue
// ==========================================

async function onGenerationEnd() {
    if (!settings.writeback_enabled || !settings.simulation_id) return;

    const projectId = await resolveProjectId();
    if (!projectId) return;

    const stCtx = SillyTavern.getContext();
    const chat = stCtx.chat;
    if (!Array.isArray(chat) || chat.length < 2) return;

    let userMessage = '';
    let assistantMessage = '';
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (!assistantMessage && m.is_user === false) {
            assistantMessage = String(m.mes || m.content || '');
        } else if (!userMessage && m.is_user === true) {
            userMessage = String(m.mes || m.content || '');
            break;
        }
    }
    if (!assistantMessage) return;

    const mentions = (userMessage.match(/@(\S+)/g) || []).map(m => m.slice(1));
    const partner = mentions[0] || null;

    try {
        const response = await fetch(
            `${apiBase()}/projects/${projectId}/simulations/${settings.simulation_id}/st-writeback/queue`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    observer: charName(),
                    partner,
                    user_message: userMessage,
                    assistant_message: assistantMessage,
                    source_meta: {
                        st_char_name: charName(),
                        mentions,
                        plugin_version: PLUGIN_VERSION,
                    },
                }),
            },
        );
        if (response.ok) {
            const data = await response.json();
            $('#wb_status').text(`📥 Queued writeback r${data.round_index} · pending ${data.pending_count} (review in WB)`);
        }
    } catch (e) {
        console.error('[WorldBuilder] writeback queue failed', e);
    }
}

// ==========================================
// Settings helpers
// ==========================================

async function refreshProjects() {
    try {
        const response = await fetch(`${apiBase()}/projects`);
        if (!response.ok) return;
        projectsCache = await response.json();
        const sel = $('#wb_project_select');
        sel.empty();
        sel.append('<option value="">— auto —</option>');
        for (const p of projectsCache) {
            sel.append(`<option value="${p.id}">${p.name}</option>`);
        }
        if (settings.project_id) sel.val(settings.project_id);
        else if (projectsCache.length) {
            settings.project_id = projectsCache[0].id;
            sel.val(settings.project_id);
            saveSettings();
        }
        await refreshSims();
    } catch (e) {
        console.error('[WorldBuilder] projects', e);
    }
}

async function refreshSims() {
    const pid = settings.project_id;
    const sel = $('#wb_sim_select');
    sel.empty().append('<option value="">— none —</option>');
    if (!pid) return;
    try {
        const response = await fetch(`${apiBase()}/projects/${pid}/simulations`);
        if (!response.ok) return;
        simsCache = await response.json();
        for (const s of simsCache) {
            sel.append(`<option value="${s.id}">${s.name} (t${s.current_tick})</option>`);
        }
        if (settings.simulation_id) sel.val(settings.simulation_id);
    } catch (e) {
        console.error('[WorldBuilder] sims', e);
    }
}

async function refreshPendingCount() {
    const pid = settings.project_id;
    const sid = settings.simulation_id;
    if (!pid || !sid) return;
    try {
        const response = await fetch(
            `${apiBase()}/projects/${pid}/simulations/${sid}/st-writeback?status=pending&limit=1`,
        );
        if (response.ok) {
            const data = await response.json();
            if (data.pending_count > 0) {
                $('#wb_status').append(` · 📥 ${data.pending_count} pending writeback`);
            }
        }
    } catch (_) { /* ignore */ }
}

async function runHealthCheck() {
    try {
        const h = await fetch(`${apiBase()}/health`);
        if (!h.ok) throw new Error('health failed');
        const data = await h.json();
        const proj = projectsCache.find(p => p.id === settings.project_id);
        $('#wb_status').text(
            `✅ ${proj?.name || 'connected'} · ${data.entities} entities · v${PLUGIN_VERSION}`,
        );
        await refreshPendingCount();
    } catch (e) {
        $('#wb_status').text(`❌ Cannot reach WorldBuilder API`);
    }
}

async function checkEntityMapping(projectId, name) {
    if (!name || !projectId) return;
    try {
        const response = await fetch(`${apiBase()}/projects/${projectId}/entities`);
        if (!response.ok) return;
        const entities = await response.json();
        const found = entities.some(e => e.name === name);
        if (!found) {
            $('#wb_status').text(`⚠️ 角色卡「${name}」未绑定图谱实体`);
        }
    } catch (_) { /* ignore */ }
}
