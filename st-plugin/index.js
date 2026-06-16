/**
 * WorldBuilder Context Plugin for SillyTavern
 *
 * Intercepts chat messages, extracts character names,
 * queries the WorldBuilder graph API for 2-hop context,
 * and injects it into the system prompt.
 *
 * This is the core differentiator vs Lorebook:
 * - Graph distance-based injection (2-hop) instead of keyword matching
 * - Precise token usage, no "character bleed"
 * - Active contradiction warnings
 */

// SillyTavern extension API
let extensionSettings = {
    worldbuilder_url: 'http://localhost:8000',
    project_id: '',
    max_hop: 2,
    injection_position: 'before_char',
    enabled: true,
};

// ==========================================
// SillyTavern Extension Lifecycle
// ==========================================

// Called when the extension is loaded
jQuery(async () => {
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
                        <input id="wb_url" type="text" class="text_pole" placeholder="API URL" value="${extensionSettings.worldbuilder_url}" />
                    </div>
                    <div class="flex-container">
                        <input id="wb_project" type="text" class="text_pole" placeholder="Project ID (auto)" value="${extensionSettings.project_id}" />
                    </div>
                    <div class="flex-container">
                        <label>Hop Distance:</label>
                        <input id="wb_hop" type="number" min="1" max="5" value="${extensionSettings.max_hop}" />
                    </div>
                    <div class="flex-container">
                        <input id="wb_enabled" type="checkbox" ${extensionSettings.enabled ? 'checked' : ''} />
                        <label for="wb_enabled">Enabled</label>
                    </div>
                    <hr>
                    <div id="wb_status" style="font-size:0.8em;color:#888;"></div>
                </div>
            </div>
        </div>
    `;

    $('#extensions_settings').append(settingsHtml);

    // Bind settings
    $('#wb_url').on('input', () => { extensionSettings.worldbuilder_url = $('#wb_url').val(); saveSettings(); });
    $('#wb_project').on('input', () => { extensionSettings.project_id = $('#wb_project').val(); saveSettings(); });
    $('#wb_hop').on('input', () => { extensionSettings.max_hop = parseInt($('#wb_hop').val()) || 2; saveSettings(); });
    $('#wb_enabled').on('change', () => { extensionSettings.enabled = $('#wb_enabled').is(':checked'); saveSettings(); });

    // Register the prompt interceptor
    SillyTavern.getContext().registerEvent('chatCompletionPromptReady', 0, onPromptReady);

    console.log('WorldBuilder plugin loaded');
    $('#wb_status').text('✅ Plugin loaded');
});

// ==========================================
// Core Logic
// ==========================================

/**
 * Intercept the prompt before it's sent to the AI.
 * Extract character names from the conversation,
 * query WorldBuilder API for graph context,
 * and inject it into the system prompt.
 */
async function onPromptReady(promptData) {
    if (!extensionSettings.enabled) return;

    try {
        // 1. Extract character names from the current conversation
        const characterNames = extractCharacterNames(promptData);

        if (characterNames.length === 0) {
            console.log('WorldBuilder: No characters detected in conversation');
            return;
        }

        // 2. Auto-detect project ID if not set
        let projectId = extensionSettings.project_id;
        if (!projectId) {
            projectId = await autoDetectProject();
            if (!projectId) {
                console.log('WorldBuilder: No project found');
                return;
            }
        }

        // 3. Query WorldBuilder Context API
        const context = await fetchGraphContext(projectId, characterNames);

        if (!context || !context.system_injection) {
            console.log('WorldBuilder: No context returned');
            return;
        }

        // 4. Build injection text
        let injectionText = `\n[WorldBuilder 图谱上下文]\n${context.system_injection}\n[/WorldBuilder 图谱上下文]`;

        // Add warnings if any
        if (context.active_warnings && context.active_warnings.length > 0) {
            injectionText += '\n[⚠️ 矛盾预警]\n' + context.active_warnings.map(w => `⚠️ ${w}`).join('\n') + '\n[/⚠️ 矛盾预警]';
        }

        // 5. Inject into prompt
        injectIntoPrompt(promptData, injectionText);

        console.log(`WorldBuilder: Injected ${context.token_count} tokens of context for [${characterNames.join(', ')}]`);
        $('#wb_status').text(`✅ Injected context for: ${characterNames.join(', ')} (${context.token_count} tokens)`);

    } catch (error) {
        console.error('WorldBuilder error:', error);
        $('#wb_status').text(`❌ Error: ${error.message}`);
    }
}

/**
 * Extract character names from the conversation.
 * Strategy:
 * 1. Check the current character card name
 * 2. Check @mentions in the last few messages
 * 3. Check for character names from the chat history
 */
function extractCharacterNames(promptData) {
    const names = new Set();
    const context = SillyTavern.getContext();

    // Current character
    const charName = context.name2 || context.characterId;
    if (charName) names.add(charName);

    // Check messages for @mentions and character names
    if (promptData.messages) {
        // Take the last 5 messages for context
        const recentMessages = promptData.messages.slice(-5);
        for (const msg of recentMessages) {
            if (!msg.content) continue;

            // Look for @mentions
            const mentions = msg.content.match(/@(\S+)/g);
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
        const response = await fetch(`${extensionSettings.worldbuilder_url}/api/projects`);
        if (!response.ok) return null;
        const projects = await response.json();
        if (projects.length > 0) {
            extensionSettings.project_id = projects[0].id;
            $('#wb_project').val(projects[0].id);
            return projects[0].id;
        }
    } catch (e) {
        console.error('WorldBuilder: Failed to auto-detect project:', e);
    }
    return null;
}

/**
 * Fetch graph context from WorldBuilder API.
 * Uses the 2-hop graph distance query for precise context injection.
 */
async function fetchGraphContext(projectId, characterNames) {
    const params = new URLSearchParams({
        characters: characterNames.join(','),
    });

    const response = await fetch(
        `${extensionSettings.worldbuilder_url}/api/projects/${projectId}/entities/context?${params}`
    );

    if (!response.ok) {
        throw new Error(`Context API returned ${response.status}`);
    }

    return await response.json();
}

/**
 * Inject the context text into the prompt at the configured position.
 */
function injectIntoPrompt(promptData, injectionText) {
    const position = extensionSettings.injection_position;

    if (position === 'before_system') {
        // Add before the system prompt
        if (promptData.system) {
            promptData.system = injectionText + '\n\n' + promptData.system;
        }
    } else if (position === 'before_char') {
        // Add before the first character message
        if (promptData.messages && promptData.messages.length > 0) {
            const firstCharIdx = promptData.messages.findIndex(m => m.role === 'assistant');
            if (firstCharIdx >= 0) {
                promptData.messages.splice(firstCharIdx, 0, {
                    role: 'system',
                    content: injectionText,
                });
            }
        }
    } else {
        // after_char: Add after the last character message
        if (promptData.messages && promptData.messages.length > 0) {
            const lastCharIdx = promptData.messages.findLastIndex(m => m.role === 'assistant');
            if (lastCharIdx >= 0) {
                promptData.messages.splice(lastCharIdx + 1, 0, {
                    role: 'system',
                    content: injectionText,
                });
            }
        }
    }
}

/**
 * Save settings to SillyTavern's extension storage.
 */
function saveSettings() {
    SillyTavern.getContext().extensionSettings.worldbuilder = extensionSettings;
    saveMetadataDebounced();
}

// Load saved settings
(function loadSettings() {
    const saved = SillyTavern.getContext().extensionSettings.worldbuilder;
    if (saved) {
        Object.assign(extensionSettings, saved);
    }
})();
