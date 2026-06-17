/**
 * WorldBuilder Context Plugin for SillyTavern (UI extension)
 *
 * Intercepts the chat-completion prompt right before it is sent to the AI,
 * extracts character names from the conversation, queries the WorldBuilder
 * graph API for 2-hop context, and injects it into the prompt.
 *
 * Differentiator vs Lorebook:
 * - Graph distance-based injection (2-hop) instead of keyword matching
 * - Precise token usage, no "character bleed"
 * - Active contradiction warnings
 *
 * Compatible with SillyTavern 1.18 extension API:
 * - Loaded via manifest.json `js` entry point.
 * - Hooks the CHAT_COMPLETION_PROMPT_READY event whose payload is { chat, dryRun }.
 * - Persists settings through getContext().extensionSettings + saveSettingsDebounced().
 */

const MODULE_NAME = 'worldbuilder';

const defaultSettings = {
    worldbuilder_url: 'http://localhost:8000',
    project_id: '',
    max_hop: 2,
    injection_position: 'before_char',
    enabled: true,
};

// Resolved against the live SillyTavern context inside jQuery ready.
let settings = { ...defaultSettings };

function getSettings() {
    const context = SillyTavern.getContext();
    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = { ...defaultSettings };
    }
    // Backfill any keys added in newer versions.
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

// ==========================================
// SillyTavern Extension Lifecycle
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
                    <p>Graph-based context injection for anti-OOC writing.</p>
                    <div class="flex-container">
                        <input id="wb_url" type="text" class="text_pole" placeholder="API URL" value="${settings.worldbuilder_url}" />
                    </div>
                    <div class="flex-container">
                        <input id="wb_project" type="text" class="text_pole" placeholder="Project ID (auto)" value="${settings.project_id}" />
                    </div>
                    <div class="flex-container">
                        <label>Hop Distance:</label>
                        <input id="wb_hop" type="number" min="1" max="5" value="${settings.max_hop}" />
                    </div>
                    <div class="flex-container">
                        <label>Inject At:</label>
                        <select id="wb_position" class="text_pole">
                            <option value="before_char">Before first char message</option>
                            <option value="after_char">After last char message</option>
                            <option value="before_system">Before system prompt</option>
                        </select>
                    </div>
                    <div class="flex-container">
                        <input id="wb_enabled" type="checkbox" ${settings.enabled ? 'checked' : ''} />
                        <label for="wb_enabled">Enabled</label>
                    </div>
                    <hr>
                    <div id="wb_status" style="font-size:0.8em;color:#888;"></div>
                </div>
            </div>
        </div>
    `;

    $('#extensions_settings').append(settingsHtml);
    $('#wb_position').val(settings.injection_position);

    // Bind settings
    $('#wb_url').on('input', () => { settings.worldbuilder_url = String($('#wb_url').val()); saveSettings(); });
    $('#wb_project').on('input', () => { settings.project_id = String($('#wb_project').val()); saveSettings(); });
    $('#wb_hop').on('input', () => { settings.max_hop = parseInt(String($('#wb_hop').val())) || 2; saveSettings(); });
    $('#wb_position').on('change', () => { settings.injection_position = String($('#wb_position').val()); saveSettings(); });
    $('#wb_enabled').on('change', () => { settings.enabled = $('#wb_enabled').is(':checked'); saveSettings(); });

    // Register the prompt interceptor (correct ST event API).
    context.eventSource.on(context.eventTypes.CHAT_COMPLETION_PROMPT_READY, onPromptReady);

    console.log('[WorldBuilder] plugin loaded');
    $('#wb_status').text('✅ Plugin loaded');
});

// ==========================================
// Core Logic
// ==========================================

/**
 * Intercept the prompt before it's sent to the AI.
 * eventData = { chat: Array<{role, content}>, dryRun: boolean }
 */
async function onPromptReady(eventData) {
    if (!settings.enabled) return;
    if (eventData?.dryRun) return; // token-counting / preview pass — don't inject

    try {
        const characterNames = extractCharacterNames(eventData);

        if (characterNames.length === 0) {
            console.log('[WorldBuilder] No characters detected in conversation');
            return;
        }

        let projectId = settings.project_id;
        if (!projectId) {
            projectId = await autoDetectProject();
            if (!projectId) {
                console.log('[WorldBuilder] No project found');
                return;
            }
        }

        const context = await fetchGraphContext(projectId, characterNames);

        if (!context || !context.system_injection) {
            console.log('[WorldBuilder] No context returned');
            return;
        }

        let injectionText = `\n[WorldBuilder 图谱上下文]\n${context.system_injection}\n[/WorldBuilder 图谱上下文]`;

        if (context.active_warnings && context.active_warnings.length > 0) {
            injectionText += '\n[⚠️ 矛盾预警]\n' + context.active_warnings.map(w => `⚠️ ${w}`).join('\n') + '\n[/⚠️ 矛盾预警]';
        }

        injectIntoPrompt(eventData, injectionText);

        console.log(`[WorldBuilder] Injected ${context.token_count} tokens of context for [${characterNames.join(', ')}]`);
        $('#wb_status').text(`✅ Injected context for: ${characterNames.join(', ')} (${context.token_count} tokens)`);
    } catch (error) {
        console.error('[WorldBuilder] error:', error);
        $('#wb_status').text(`❌ Error: ${error.message}`);
    }
}

/**
 * Extract character names from the conversation.
 * 1. Current character card name (context.name2)
 * 2. @mentions in the last few messages of eventData.chat
 */
function extractCharacterNames(eventData) {
    const names = new Set();
    const context = SillyTavern.getContext();

    const charName = context.name2 || context.characterId;
    if (charName) names.add(charName);

    const chat = eventData?.chat;
    if (Array.isArray(chat)) {
        const recentMessages = chat.slice(-5);
        for (const msg of recentMessages) {
            const content = typeof msg?.content === 'string' ? msg.content : '';
            if (!content) continue;
            const mentions = content.match(/@(\S+)/g);
            if (mentions) {
                mentions.forEach(m => names.add(m.slice(1)));
            }
        }
    }

    return Array.from(names);
}

/**
 * Auto-detect project by listing available projects.
 */
async function autoDetectProject() {
    try {
        const response = await fetch(`${settings.worldbuilder_url}/api/projects`);
        if (!response.ok) return null;
        const projects = await response.json();
        if (Array.isArray(projects) && projects.length > 0) {
            settings.project_id = projects[0].id;
            $('#wb_project').val(projects[0].id);
            saveSettings();
            return projects[0].id;
        }
    } catch (e) {
        console.error('[WorldBuilder] Failed to auto-detect project:', e);
    }
    return null;
}

/**
 * Fetch graph context from WorldBuilder API (2-hop graph distance query).
 */
async function fetchGraphContext(projectId, characterNames) {
    const params = new URLSearchParams({
        characters: characterNames.join(','),
        hop: String(settings.max_hop || 2),
    });

    const response = await fetch(
        `${settings.worldbuilder_url}/api/projects/${projectId}/entities/context?${params}`,
    );

    if (!response.ok) {
        throw new Error(`Context API returned ${response.status}`);
    }

    return await response.json();
}

/**
 * Inject the context text into the chat array at the configured position.
 * eventData.chat is the chat-completion messages array of { role, content }.
 */
function injectIntoPrompt(eventData, injectionText) {
    const chat = eventData?.chat;
    if (!Array.isArray(chat)) return;

    const entry = { role: 'system', content: injectionText };
    const position = settings.injection_position;

    if (position === 'before_system') {
        chat.unshift(entry);
    } else if (position === 'after_char') {
        const lastCharIdx = chat.findLastIndex(m => m.role === 'assistant');
        if (lastCharIdx >= 0) {
            chat.splice(lastCharIdx + 1, 0, entry);
        } else {
            chat.push(entry);
        }
    } else {
        // before_char (default): before the first assistant message
        const firstCharIdx = chat.findIndex(m => m.role === 'assistant');
        if (firstCharIdx >= 0) {
            chat.splice(firstCharIdx, 0, entry);
        } else {
            chat.push(entry);
        }
    }
}
