# 2Poor4API

2Poor4API is a SillyTavern third-party UI extension for using a normal 1-on-1 SillyTavern chat without sending the generated prompt to an LLM API.

The extension lets SillyTavern run its normal user-message and prompt-building pipeline, captures the same plain-text raw prompt that SillyTavern's native **Prompt** button uses for a generated character reply, blocks the final generation request before it leaves the browser, and lets you paste a response from a browser-based model back into the chat as a normal `{{char}}` reply.

2Poor4API does **not** build, rewrite, simplify, or manually reconstruct prompts. It does **not** show API request bodies, chat-completion message arrays, debug payloads, provider-specific formats, or user-facing JSON previews.

## Installation

Install this folder as a SillyTavern third-party UI extension:

```text
public/scripts/extensions/third-party/2Poor4API/
```

The folder must contain these files:

- `manifest.json`
- `index.js`
- `popup.html`
- `style.css`
- `README.md`

Restart or refresh SillyTavern after installation. The extension should add one **2Poor4API** item to SillyTavern's existing **Extensions** menu.

## Usage

1. Open a normal 1-on-1 character chat in SillyTavern.
2. Type your user message in the normal SillyTavern message input box.
3. Open the SillyTavern **Extensions** menu.
4. Click **2Poor4API**.
5. Click **Prepare Prompt Without API**.
6. The user message is added to the chat normally, so prompt-modifying extensions and SillyTavern's normal prompt pipeline can run.
7. 2Poor4API blocks the final LLM generation request before it leaves the browser.
8. Copy the captured plain-text raw prompt with **Copy Prompt**.
9. Paste the prompt into ChatGPT, Gemini, Claude, or another browser-based model.
10. Copy the model's response.
11. Return to SillyTavern and paste the response into 2Poor4API.
12. Click **Insert as {{char}} Reply**.

The pasted response is inserted as a normal character reply. The user message is not added a second time.

## Prompt Privacy

2Poor4API installs a fail-closed one-shot browser `fetch` guard while prompt capture is active. The guard is designed to intercept only known SillyTavern text-generation endpoints and restore the original `window.fetch` only after the first matching generation request has been intercepted and blocked. If prompt construction takes longer than expected, 2Poor4API shows a warning and keeps the guard active rather than risking an API request leak. The **Abort Capture** button is available only during active capture; it first asks SillyTavern to stop generation and only removes the guard after stopping is confirmed.

The extension intentionally triggers SillyTavern's normal Send flow because that is what lets SillyTavern add the user message, run user-input regexes, activate World Info, apply Author's Note, run enabled prompt-modifying extensions, run Prompt Manager, and build the final native raw prompt.

## Native Prompt Compatibility

The captured prompt is intended to match SillyTavern's native **Prompt** button for the same generated character reply.

2Poor4API uses the same flattening behavior as the native prompt display:

- if `rawPrompt` is a string, it is displayed unchanged;
- if `rawPrompt` is an array, it is displayed as `rawPrompt.map(x => x.content).join("\n")`;
- the array or request structure is never shown to the user.

If exact native compatibility conflicts with making the prompt look nicer, 2Poor4API chooses native compatibility.

## Version 1 Limitations

2Poor4API v1 supports:

- normal 1-on-1 character chats;
- a normal user message followed by one character reply;
- raw prompt capture from SillyTavern's native prompt itemization data;
- blocking the final text-generation API request;
- manual response insertion;
- best-effort native **Prompt** button compatibility for the inserted reply.

2Poor4API v1 does not support:

- group chats;
- swipes or rerolls;
- continue generation;
- impersonation;
- quiet prompts;
- tool calls;
- image generation;
- audio;
- function calling;
- provider-specific formatting options;
- custom prompt rewriting;
- JSON output;
- request-body preview.

If you try to use an unsupported mode, the extension shows a clear English message such as: "Group chats are not supported in 2Poor4API v1."

## Troubleshooting

### 2Poor4API does not appear in the Extensions menu

Refresh SillyTavern after installing the extension. 2Poor4API waits for SillyTavern readiness events and then looks for `#extensionsMenu`; if the menu is created late, it retries briefly and also watches DOM mutations.

### Empty input is rejected

This is expected. Type your message in SillyTavern's normal message input box before clicking **Prepare Prompt Without API**.

### Group chats are rejected

This is expected in v1. Group generation has different control flow and prompt ownership, so 2Poor4API v1 only supports normal 1-on-1 chats.

### SillyTavern briefly shows a generation error

2Poor4API blocks the final browser `fetch` request to prevent the prompt from leaving the browser. SillyTavern may still notice that its generation request was aborted. The extension makes a best-effort cleanup by restoring send controls, stopping generation, and removing an empty reply if one was created. Fully hiding every internal generation error would require fragile patching of SillyTavern internals, so stability is preferred.

### The response cannot be inserted

2Poor4API checks that you are still in the same chat with the same character, that group state did not change, that no other message was added after the captured user message, and that the last message is still the captured user message. Return to the original unchanged chat before inserting the response.

## Manual Acceptance Tests

1. **2Poor4API** appears in the SillyTavern Extensions menu.
2. Clicking it opens the popup.
3. Empty input blocks prompt preparation with a clear message.
4. Group chat shows a clear "not supported in v1" message.
5. In a normal 1-on-1 chat, write a message and click **Prepare Prompt Without API**.
6. The user message appears in the chat.
7. The request to the LLM API does not leave the browser.
8. The popup shows a plain-text raw prompt.
9. **Copy Prompt** copies exactly the text shown in the raw prompt textarea.
10. Paste a browser model response into the response textarea.
11. Click **Insert as {{char}} Reply**.
12. The response appears as a normal character message.
13. The chat is saved.
14. The native three-dot-menu **Prompt** button works for the inserted reply if possible.
15. The raw prompt captured by 2Poor4API matches the raw prompt shown by SillyTavern's native **Prompt** button in an equivalent normal API generation.
16. Start prompt capture, close the popup immediately, and verify the later generation request is still blocked.
17. Start prompt capture with a slow or large chat and verify the guard remains active after the warning timeout.
18. Start prompt capture and click **Clear**; verify it does not reset the capture state while capture is in progress.
19. Start prompt capture and verify **Abort Capture** appears; click it and verify the guard is removed only after SillyTavern generation is stopped.
20. Simulate or observe a failed abort confirmation and verify 2Poor4API keeps the guard active and tells the user to refresh the page.

## Implementation Notes

This implementation was based on the current official SillyTavern repository and the official SillyTavern UI extension documentation.

Key findings used by the extension:

- Third-party UI extensions are loaded from `public/scripts/extensions/third-party/<extension-name>/` and are described by a `manifest.json` file with fields such as `display_name`, `js`, `css`, `author`, and `version`.
- SillyTavern exposes extension-facing helpers through `SillyTavern.getContext()` / `public/scripts/st-context.js`, including `chat`, `characterId`, `groupId`, `getCurrentChatId`, `saveReply`, `saveChat`, `stopGeneration`, `activateSendButtons`, `eventSource`, and `eventTypes`.
- SillyTavern emits app lifecycle events including `APP_INITIALIZED` and `APP_READY`, so 2Poor4API waits for those when adding its menu item.
- The native prompt itemization UI lives in `public/scripts/itemized-prompts.js`. It stores prompt records in the exported `itemizedPrompts` array and persists them with `saveItemizedPrompts(chatId)`.
- The native three-dot-menu **Prompt** button is wired through `.mes_prompt`; it finds an itemized prompt by message id and displays the selected record's `rawPrompt`.
- The native raw prompt display flattens `rawPrompt` by leaving strings unchanged or joining array item `content` values with newline characters. 2Poor4API uses that same behavior and never exposes the internal array or request data to the user.
- During normal generation, SillyTavern's prompt pipeline creates an itemized prompt record for the future character reply. 2Poor4API snapshots the expected future reply id before clicking the normal Send button, then captures the itemized prompt for that id before blocking the generation request.
- The extension intentionally does not use `generate_interceptor` as its main capture mechanism because prompt interceptors can run before the final native raw prompt is available.
- Normal response insertion uses SillyTavern's `saveReply({ type: 'normal', getMessage, ... })` helper so the message is saved, rendered, and emitted as closely as possible to a regular character reply. The captured itemized prompt is kept for the inserted reply id so the native **Prompt** button can use the same raw prompt where SillyTavern supports it.
