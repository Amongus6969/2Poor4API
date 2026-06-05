import { getContext } from '../../../st-context.js';
// itemizedPrompts is not exposed through getContext(), so this local module import is required to match SillyTavern's native Prompt button data.
import { itemizedPrompts, saveItemizedPrompts } from '../../../itemized-prompts.js';

const EXTENSION_NAME = '2Poor4API';
const MODULE_NAME = '2poor4api';
const MENU_BUTTON_ID = 'poor4api_wand_button';
const MODAL_ID = 'poor4api_modal';
const FETCH_GUARD_TIMEOUT_MS = 20000;
const PROMPT_CAPTURE_WAIT_MS = 2500;

const state = {
    captureMode: false,
    popup: null,
    capturedPrompt: '',
    snapshot: null,
    originalFetch: null,
    fetchGuardTimeout: null,
    expectedReplyMessageId: null,
    capturedItemizedPrompt: null,
};

function context() {
    return globalThis.SillyTavern?.getContext?.() ?? getContext();
}

function notifyInfo(message) {
    if (globalThis.toastr?.info) {
        globalThis.toastr.info(message);
    } else {
        console.info(`[${EXTENSION_NAME}] ${message}`);
    }
    setStatus(message);
}

function notifyWarning(message) {
    if (globalThis.toastr?.warning) {
        globalThis.toastr.warning(message, EXTENSION_NAME);
    } else {
        console.warn(`[${EXTENSION_NAME}] ${message}`);
    }
    setStatus(message);
}

function notifyError(message) {
    if (globalThis.toastr?.error) {
        globalThis.toastr.error(message, EXTENSION_NAME);
    } else {
        console.error(`[${EXTENSION_NAME}] ${message}`);
    }
    setStatus(message);
}

function setStatus(message) {
    const status = document.getElementById('poor4api_status');
    if (status) {
        status.textContent = message || '';
    }
}

function setPromptTextarea(value) {
    const textarea = document.getElementById('poor4api_prompt');
    if (textarea) {
        textarea.value = value || '';
    }
}

function setResponseTextarea(value) {
    const textarea = document.getElementById('poor4api_response');
    if (textarea) {
        textarea.value = value || '';
    }
}

function getResponseTextareaValue() {
    return document.getElementById('poor4api_response')?.value ?? '';
}

function flattenRawPrompt(rawPrompt) {
    if (Array.isArray(rawPrompt)) {
        return rawPrompt.map(x => x?.content ?? '').join('\n');
    }
    return typeof rawPrompt === 'string' ? rawPrompt : '';
}

function findCapturedItemizedPrompt() {
    if (!Array.isArray(itemizedPrompts) || state.expectedReplyMessageId === null) {
        return null;
    }
    return itemizedPrompts.find(prompt => prompt?.mesId === state.expectedReplyMessageId && prompt.rawPrompt !== undefined) ?? null;
}

function storeCapturedUserMessageText() {
    if (!state.snapshot) {
        return;
    }

    const st = context();
    state.snapshot.capturedUserMessageText = st.chat?.[state.snapshot.expectedUserMessageId]?.mes;
}

function cloneItemizedPrompt(prompt) {
    if (!prompt) {
        return null;
    }
    return structuredCloneSafe(prompt);
}

function structuredCloneSafe(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

async function waitForCapturedPrompt() {
    const started = Date.now();
    while (Date.now() - started < PROMPT_CAPTURE_WAIT_MS) {
        const prompt = findCapturedItemizedPrompt();
        const rawText = flattenRawPrompt(prompt?.rawPrompt);
        if (rawText) {
            state.capturedItemizedPrompt = cloneItemizedPrompt(prompt);
            state.capturedPrompt = rawText;
            storeCapturedUserMessageText();
            setPromptTextarea(rawText);
            return rawText;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    return '';
}

function getFetchUrl(input) {
    if (typeof input === 'string') {
        return input;
    }
    if (input instanceof URL) {
        return input.href;
    }
    return input?.url ?? '';
}

function getFetchMethod(input, init) {
    return (init?.method || input?.method || 'GET').toUpperCase();
}

function isGenerationRequest(input, init) {
    if (!state.captureMode) {
        return false;
    }

    const method = getFetchMethod(input, init);
    if (method !== 'POST') {
        return false;
    }

    const rawUrl = getFetchUrl(input);
    let path = rawUrl;
    try {
        path = new URL(rawUrl, window.location.origin).pathname;
    } catch {
        path = rawUrl;
    }

    const generationPaths = [
        '/api/backends/chat-completions/generate',
        '/api/backends/text-completions/generate',
        '/api/openai/generate',
        '/api/kobold/generate',
        '/api/textgenerationwebui/generate',
        '/api/novelai/generate',
        '/api/horde/generate-text',
        '/api/ai21/generate',
        '/api/scale/generate',
        '/api/mancer/generate',
        '/api/v1/generate',
    ];

    return generationPaths.some(endpoint => path.endsWith(endpoint)) || /^\/api\/[^/]+\/generate(?:$|[/?#])/.test(path);
}

function installFetchGuard() {
    cleanupFetchGuard(false);
    state.originalFetch = window.fetch.bind(window);

    window.fetch = async function poor4apiFetchGuard(input, init) {
        if (!isGenerationRequest(input, init)) {
            return state.originalFetch(input, init);
        }

        const captured = await waitForCapturedPrompt();
        cleanupFetchGuard(false);
        state.captureMode = false;

        if (captured) {
            notifyInfo('Prompt captured. The API request was blocked before it left the browser.');
        } else {
            notifyError('The API request was blocked, but 2Poor4API could not find SillyTavern native raw prompt data for this reply.');
        }

        setTimeout(cleanupAfterBlockedGeneration, 0);

        const error = new DOMException(`${EXTENSION_NAME} blocked the generation request before it left the browser.`, 'AbortError');
        error.poor4apiBlocked = true;
        throw error;
    };

    state.fetchGuardTimeout = window.setTimeout(() => {
        state.fetchGuardTimeout = null;
        if (state.captureMode || state.originalFetch) {
            notifyWarning('Still waiting for SillyTavern to finish building the prompt. The API guard remains active.');
        }
    }, FETCH_GUARD_TIMEOUT_MS);

    void state.originalFetch;
}

function cleanupFetchGuard(resetCaptureMode = true) {
    if (state.fetchGuardTimeout) {
        clearTimeout(state.fetchGuardTimeout);
        state.fetchGuardTimeout = null;
    }

    if (state.originalFetch) {
        window.fetch = state.originalFetch;
        state.originalFetch = null;
    }

    if (resetCaptureMode) {
        state.captureMode = false;
    }
}

async function cleanupAfterBlockedGeneration() {
    const st = context();
    try {
        st.stopGeneration?.();
        st.activateSendButtons?.();

        const expectedLengthWithoutReply = (state.snapshot?.chatLength ?? 0) + 1;
        const lastMessage = st.chat?.[st.chat.length - 1];
        if (st.chat?.length > expectedLengthWithoutReply && lastMessage && !lastMessage.is_user && !lastMessage.mes) {
            if (typeof st.deleteLastMessage === 'function') {
                await st.deleteLastMessage();
            }
        }
    } catch (error) {
        console.warn(`[${EXTENSION_NAME}] Unable to fully clean up SillyTavern generation state after blocking the request.`, error);
    }
}

function validateCanPrepare() {
    const st = context();
    const sendTextarea = document.getElementById('send_textarea');
    const userText = sendTextarea?.value ?? '';

    if (st.groupId) {
        return 'Group chats are not supported in 2Poor4API v1.';
    }
    if (st.characterId === undefined || st.characterId === null || st.characterId === '') {
        return 'Select a character before preparing a prompt.';
    }
    if (!st.getCurrentChatId?.()) {
        return 'Open a normal character chat before preparing a prompt.';
    }
    if (!userText.trim()) {
        return 'Type a message in the normal SillyTavern input box before preparing a prompt.';
    }
    if (state.captureMode || state.originalFetch) {
        return '2Poor4API is already preparing a prompt.';
    }
    if (isGenerationInProgress()) {
        return 'SillyTavern is already generating. Wait for it to finish before preparing a prompt.';
    }
    return '';
}

function isGenerationInProgress() {
    const st = context();
    const stopButtonVisible = $('#mes_stop').is(':visible') || $('#send_but_sheld').is(':visible');
    const sendButtonDisabledForGeneration = $('#send_but').hasClass('disabled') && !document.getElementById('send_textarea')?.value?.trim();
    return Boolean(st.streamingProcessor?.isFinished === false || stopButtonVisible || sendButtonDisabledForGeneration);
}

function createSnapshot() {
    const st = context();
    const chatLength = st.chat?.length ?? 0;
    return {
        chatId: st.getCurrentChatId?.() ?? st.chatId,
        characterId: st.characterId,
        groupId: st.groupId ?? null,
        chatLength,
        sendTextareaValue: document.getElementById('send_textarea')?.value ?? '',
        expectedUserMessageId: chatLength,
        expectedReplyMessageId: chatLength + 1,
        timestamp: Date.now(),
    };
}

async function preparePromptWithoutApi() {
    const validationMessage = validateCanPrepare();
    if (validationMessage) {
        notifyWarning(validationMessage);
        return;
    }

    const sendButton = document.getElementById('send_but');
    if (!sendButton) {
        notifyError('Could not find SillyTavern\'s Send button. 2Poor4API cannot start the normal generation flow.');
        return;
    }

    state.snapshot = createSnapshot();
    state.expectedReplyMessageId = state.snapshot.expectedReplyMessageId;
    state.capturedPrompt = '';
    state.capturedItemizedPrompt = null;
    setPromptTextarea('');
    setStatus('Preparing prompt. The final API request will be blocked.');

    state.captureMode = true;
    installFetchGuard();

    try {
        sendButton.click();
    } catch (error) {
        cleanupFetchGuard(true);
        notifyError('Failed to trigger SillyTavern generation. No API request was sent by 2Poor4API.');
        console.error(`[${EXTENSION_NAME}] Failed to click the SillyTavern Send button.`, error);
    }
}

function validateCanInsert(responseText) {
    const st = context();
    const snapshot = state.snapshot;

    if (!snapshot || !state.capturedPrompt) {
        return 'Prepare and copy a prompt before inserting a response.';
    }
    if (!responseText.trim()) {
        return 'Paste a non-empty model response before inserting it.';
    }
    if ((st.getCurrentChatId?.() ?? st.chatId) !== snapshot.chatId) {
        return 'The active chat changed after the prompt was captured. Return to the original chat before inserting the response.';
    }
    if (String(st.characterId) !== String(snapshot.characterId)) {
        return 'The active character changed after the prompt was captured. Return to the original character before inserting the response.';
    }
    if ((st.groupId ?? null) !== (snapshot.groupId ?? null)) {
        return 'The group chat state changed after the prompt was captured. 2Poor4API v1 only supports the original 1-on-1 chat.';
    }
    if ((st.chat?.length ?? 0) !== snapshot.chatLength + 1) {
        return 'Another message was added after the captured user message. 2Poor4API will not insert a response into this changed chat.';
    }

    const lastMessage = st.chat?.[st.chat.length - 1];
    if (!lastMessage?.is_user) {
        return 'The last chat message is not the user message that was captured. 2Poor4API will not insert a response.';
    }
    if (lastMessage.mes !== snapshot.capturedUserMessageText) {
        return 'The captured user message was edited after the prompt was prepared. Prepare the prompt again before inserting a response.';
    }
    return '';
}

async function ensureItemizedPromptForInsertedReply() {
    if (!state.capturedItemizedPrompt || state.expectedReplyMessageId === null || !Array.isArray(itemizedPrompts)) {
        return;
    }

    const existing = itemizedPrompts.find(prompt => prompt?.mesId === state.expectedReplyMessageId);
    if (existing) {
        existing.rawPrompt = state.capturedItemizedPrompt.rawPrompt;
        return;
    }

    const prompt = cloneItemizedPrompt(state.capturedItemizedPrompt);
    prompt.mesId = state.expectedReplyMessageId;
    itemizedPrompts.push(prompt);
    itemizedPrompts.sort((a, b) => (a?.mesId ?? 0) - (b?.mesId ?? 0));
}

async function insertAsCharacterReply() {
    const responseText = getResponseTextareaValue();
    const validationMessage = validateCanInsert(responseText);
    if (validationMessage) {
        notifyWarning(validationMessage);
        return;
    }

    const st = context();
    try {
        if (typeof st.saveReply !== 'function') {
            throw new Error('SillyTavern saveReply helper is unavailable.');
        }

        await ensureItemizedPromptForInsertedReply();
        await st.saveReply({
            type: 'normal',
            getMessage: responseText,
            fromStreaming: false,
            title: '',
        });

        if (typeof st.saveChat === 'function') {
            await st.saveChat();
        }
        if (typeof saveItemizedPrompts === 'function') {
            await saveItemizedPrompts(st.getCurrentChatId?.() ?? st.chatId);
        }

        setResponseTextarea('');
        notifyInfo('Response inserted as a character reply.');
    } catch (error) {
        notifyError('Failed to insert the response into the chat.');
        console.error(`[${EXTENSION_NAME}] Failed to insert response.`, error);
    }
}

async function copyPrompt() {
    if (!state.capturedPrompt) {
        notifyWarning('No captured prompt is available to copy.');
        return;
    }

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(state.capturedPrompt);
        } else {
            fallbackCopyText(state.capturedPrompt);
        }
        notifyInfo('Prompt copied.');
    } catch (error) {
        notifyError('Could not copy the prompt to the clipboard.');
        console.error(`[${EXTENSION_NAME}] Clipboard copy failed.`, error);
    }
}

function fallbackCopyText(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) {
        throw new Error('document.execCommand("copy") returned false.');
    }
}

function clearPopupFields() {
    if (state.captureMode || state.originalFetch) {
        notifyWarning('Prompt capture is still in progress. Wait until it finishes before clearing the popup.');
        return;
    }

    state.capturedPrompt = '';
    state.capturedItemizedPrompt = null;
    state.snapshot = null;
    state.expectedReplyMessageId = null;
    setPromptTextarea('');
    setResponseTextarea('');
    setStatus('Cleared.');
}

function closePopup() {
    const modal = document.getElementById(MODAL_ID);
    modal?.remove();
    state.popup = null;
}

async function openPopup() {
    if (document.getElementById(MODAL_ID)) {
        document.getElementById(MODAL_ID).hidden = false;
        setPromptTextarea(state.capturedPrompt);
        return;
    }

    const html = await fetch(new URL('popup.html', import.meta.url)).then(response => response.text());
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `<div class="poor4api-dialog">${html}</div>`;
    document.body.appendChild(modal);
    state.popup = modal;

    modal.querySelector('#poor4api_prepare')?.addEventListener('click', preparePromptWithoutApi);
    modal.querySelector('#poor4api_copy')?.addEventListener('click', copyPrompt);
    modal.querySelector('#poor4api_insert')?.addEventListener('click', insertAsCharacterReply);
    modal.querySelector('#poor4api_clear')?.addEventListener('click', clearPopupFields);
    modal.querySelector('#poor4api_close')?.addEventListener('click', closePopup);
    modal.addEventListener('click', event => {
        if (event.target === modal) {
            closePopup();
        }
    });

    setPromptTextarea(state.capturedPrompt);
}

function addMenuItem() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) {
        return false;
    }

    if (document.getElementById(MENU_BUTTON_ID)) {
        return true;
    }

    const button = document.createElement('div');
    button.id = MENU_BUTTON_ID;
    button.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
    button.dataset.extension = MODULE_NAME;
    button.tabIndex = 0;
    button.title = 'Open 2Poor4API';
    button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><span>2Poor4API</span>';
    button.addEventListener('click', event => {
        event.preventDefault();
        void openPopup();
    });
    button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void openPopup();
        }
    });

    menu.appendChild(button);
    return true;
}

function waitForExtensionsMenu() {
    if (addMenuItem()) {
        return;
    }

    let attempts = 0;
    const interval = window.setInterval(() => {
        attempts += 1;
        if (addMenuItem() || attempts >= 40) {
            clearInterval(interval);
        }
    }, 250);

    const observer = new MutationObserver(() => {
        if (addMenuItem()) {
            observer.disconnect();
            clearInterval(interval);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

function initialize() {
    const st = context();
    const readyEvent = st.eventTypes?.APP_READY || st.event_types?.APP_READY;
    const initializedEvent = st.eventTypes?.APP_INITIALIZED || st.event_types?.APP_INITIALIZED;

    if (readyEvent && st.eventSource?.once) {
        st.eventSource.once(readyEvent, waitForExtensionsMenu);
    }
    if (initializedEvent && st.eventSource?.once) {
        st.eventSource.once(initializedEvent, waitForExtensionsMenu);
    }

    waitForExtensionsMenu();
}

initialize();
