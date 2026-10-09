// ComicChat PR-09: MCP Apps UI resource for ChatGPT plugin extensions.
// The component talks only to registered MCP tools; it never receives Supabase credentials.

export const COMICCHAT_APP_HTML = String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>ComicChat</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    button, textarea { font: inherit; }
    .shell { min-height: 100vh; display: grid; grid-template-columns: minmax(220px, 30%) 1fr; }
    .sidebar { border-right: 1px solid color-mix(in srgb, CanvasText 16%, transparent); padding: 16px; overflow: auto; }
    .main { min-width: 0; display: grid; grid-template-rows: auto 1fr auto; min-height: 100vh; }
    .header { padding: 14px 18px; border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent); }
    .title { margin: 0; font-size: 18px; }
    .muted { opacity: .68; font-size: 13px; }
    .conversation { width: 100%; text-align: left; border: 0; border-radius: 12px; padding: 10px; margin: 4px 0; background: transparent; color: inherit; cursor: pointer; }
    .conversation:hover, .conversation[aria-current="true"] { background: color-mix(in srgb, CanvasText 8%, transparent); }
    .conversation-name { font-weight: 650; }
    .preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 3px; }
    .messages { padding: 18px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
    .panel { max-width: min(720px, 92%); border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 18px; padding: 14px 16px; background: color-mix(in srgb, CanvasText 4%, transparent); }
    .panel.mine { align-self: end; }
    .panel.other { align-self: start; }
    .bubble { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; }
    .meta { margin-top: 8px; font-size: 12px; opacity: .62; }
    .composer { border-top: 1px solid color-mix(in srgb, CanvasText 16%, transparent); padding: 14px; display: flex; gap: 10px; align-items: end; }
    .composer textarea { flex: 1; resize: vertical; min-height: 44px; max-height: 180px; border-radius: 12px; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); padding: 10px 12px; background: Canvas; color: CanvasText; }
    .composer button { border: 0; border-radius: 12px; padding: 10px 16px; cursor: pointer; }
    .empty { margin: auto; padding: 24px; text-align: center; opacity: .72; }
    .status { min-height: 1.3em; padding: 0 18px; font-size: 12px; opacity: .7; }
    /* Code-rendered comic panels: instant, local, zero image-API spend. */
    .panel { position: relative; background: #fff7e5; color: #242022; border: 3px solid #242022; border-radius: 10px;
      padding: 10px 12px 14px; box-shadow: 5px 5px 0 #242022; width: min(660px, 92%); }
    .panel.mine { background: #ffe2ce; }
    .panel.other { background: #e4dfff; }
    .panel::before { content: ''; display: block; height: 76px; margin-bottom: 10px; border: 2px solid #242022;
      background: radial-gradient(circle at 20% 60%, #242022 0 17px, transparent 18px),
        radial-gradient(ellipse at 20% 150%, #242022 0 64px, transparent 65px),
        repeating-radial-gradient(circle at 86% 40%, #ffbd69 0 7px, #fff3c9 8px 17px); }
    .panel.other::before { background: radial-gradient(circle at 78% 60%, #242022 0 17px, transparent 18px),
        radial-gradient(ellipse at 78% 150%, #242022 0 64px, transparent 65px),
        repeating-radial-gradient(circle at 10% 40%, #bcb1ff 0 7px, #eeebff 8px 17px); }
    .bubble { border: 2px solid #242022; border-radius: 22px; padding: 10px 14px; background: white; font-weight: 650; }
    .connectorToggle { margin: 12px 0; padding: 10px; border: 2px solid currentColor; border-radius: 8px;
      background: transparent; color: inherit; width: 100%; cursor: pointer; }
    .connectorList { font-size: 12px; }
    .connector { border-top: 1px solid color-mix(in srgb, CanvasText 20%, transparent); padding: 7px 0; }
    .connector small { display: block; opacity: .68; }
    .connectorList[hidden] { display: none; }
    @media (max-width: 720px) {
      .shell { grid-template-columns: 1fr; }
      .sidebar { border-right: 0; border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent); max-height: 36vh; }
      .main { min-height: 64vh; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <h1 class="title">ComicChat</h1>
      <div id="profile" class="muted">Connecting…</div>
      <button id="aiSourcesToggle" class="connectorToggle" type="button" aria-expanded="false" aria-controls="connectorList">AI connections</button>
      <div id="connectorList" class="connectorList" hidden aria-live="polite"></div>
      <div id="conversations" aria-label="Conversations"></div>
    </aside>
    <section class="main">
      <header class="header">
        <strong id="conversationTitle">Choose a conversation</strong>
        <div id="conversationMeta" class="muted"></div>
      </header>
      <div id="messages" class="messages">
        <div class="empty">Select a private conversation to continue it here.</div>
      </div>
      <div>
        <div id="status" class="status" role="status" aria-live="polite"></div>
        <form id="composer" class="composer">
          <textarea id="messageText" maxlength="4000" placeholder="Write the exact message text…" disabled></textarea>
          <button id="sendButton" type="submit" disabled>Send</button>
        </form>
      </div>
    </section>
  </div>
  <script>
    const state = {
      profile: null,
      conversations: [],
      messages: [],
      selectedConversationId: null,
      pendingRequestId: null,
      pendingText: null,
    };

    const profileEl = document.getElementById('profile');
    const conversationsEl = document.getElementById('conversations');
    const aiSourcesToggle = document.getElementById('aiSourcesToggle');
    const connectorListEl = document.getElementById('connectorList');
    const titleEl = document.getElementById('conversationTitle');
    const metaEl = document.getElementById('conversationMeta');
    const messagesEl = document.getElementById('messages');
    const statusEl = document.getElementById('status');
    const composerEl = document.getElementById('composer');
    const messageTextEl = document.getElementById('messageText');
    const sendButtonEl = document.getElementById('sendButton');

    function selectedConversation() {
      return state.conversations.find(function (item) {
        return item.conversation_id === state.selectedConversationId;
      }) || null;
    }

    function formatTime(value) {
      if (!value) return '';
      try { return new Intl.DateTimeFormat(document.documentElement.lang || undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
      catch (_) { return String(value); }
    }

    function renderConversations() {
      conversationsEl.replaceChildren();
      if (!state.conversations.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No direct conversations yet.';
        conversationsEl.appendChild(empty);
        return;
      }
      state.conversations.forEach(function (conversation) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'conversation';
        button.dataset.conversationId = conversation.conversation_id;
        button.setAttribute('aria-current', String(conversation.conversation_id === state.selectedConversationId));

        const name = document.createElement('div');
        name.className = 'conversation-name';
        name.textContent = conversation.other_username || 'Direct conversation';

        const preview = document.createElement('div');
        preview.className = 'preview muted';
        preview.textContent = conversation.last_message_text || 'No messages yet';

        button.append(name, preview);
        conversationsEl.appendChild(button);
      });
    }

    function renderMessages() {
      messagesEl.replaceChildren();
      const conversation = selectedConversation();
      titleEl.textContent = conversation ? (conversation.other_username || 'Conversation') : 'Choose a conversation';
      metaEl.textContent = conversation && conversation.unread_count ? String(conversation.unread_count) + ' unread' : '';

      const enabled = Boolean(state.selectedConversationId);
      messageTextEl.disabled = !enabled;
      sendButtonEl.disabled = !enabled;

      if (!enabled) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Select a private conversation to continue it here.';
        messagesEl.appendChild(empty);
        return;
      }
      if (!state.messages.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No messages in this conversation yet.';
        messagesEl.appendChild(empty);
        return;
      }

      state.messages.forEach(function (message) {
        const panel = document.createElement('article');
        const mine = state.profile && message.sender_id === state.profile.id;
        panel.className = 'panel ' + (mine ? 'mine' : 'other');

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.textContent = message.original_text || '';

        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = (mine ? 'You' : 'Them') + ' · ' + (message.status || 'unknown') + (message.created_at ? ' · ' + formatTime(message.created_at) : '');

        panel.append(bubble, meta);
        messagesEl.appendChild(panel);
      });
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function render() {
      profileEl.textContent = state.profile ? (state.profile.nickname || state.profile.name || 'ComicChat account') : 'Connecting…';
      renderConversations();
      renderMessages();
    }

    function updateFromResponse(response) {
      const data = response && response.structuredContent ? response.structuredContent : {};
      if (data.profile) state.profile = data.profile;
      if (Array.isArray(data.conversations)) state.conversations = data.conversations;
      if (Object.prototype.hasOwnProperty.call(data, 'selectedConversationId')) state.selectedConversationId = data.selectedConversationId;
      if (Array.isArray(data.messages)) state.messages = data.messages;
      render();
    }

    let rpcId = 0;
    const pendingRequests = new Map();

    function rpcNotify(method, params) {
      window.parent.postMessage({ jsonrpc: '2.0', method: method, params: params }, '*');
    }

    function rpcRequest(method, params) {
      return new Promise(function (resolve, reject) {
        const id = ++rpcId;
        pendingRequests.set(id, { resolve: resolve, reject: reject });
        window.parent.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params }, '*');
      });
    }

    window.addEventListener('message', function (event) {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;

      if (typeof message.id === 'number') {
        const pending = pendingRequests.get(message.id);
        if (!pending) return;
        pendingRequests.delete(message.id);
        if (message.error) pending.reject(message.error);
        else pending.resolve(message.result);
        return;
      }

      if (message.method === 'ui/notifications/tool-result') updateFromResponse(message.params);
    }, { passive: true });

    const bridgeReady = (async function () {
      await rpcRequest('ui/initialize', {
        appInfo: { name: 'comicchat', version: '0.1.0' },
        appCapabilities: {},
        protocolVersion: '2026-01-26',
      });
      rpcNotify('ui/notifications/initialized', {});
    })();

    async function callTool(name, args) {
      await bridgeReady;
      const response = await rpcRequest('tools/call', { name: name, arguments: args || {} });
      updateFromResponse(response);
      return response;
    }


    aiSourcesToggle.addEventListener('click', async function () {
      const opened = aiSourcesToggle.getAttribute('aria-expanded') !== 'true';
      aiSourcesToggle.setAttribute('aria-expanded', String(opened));
      connectorListEl.hidden = !opened;
      if (!opened) return;
      connectorListEl.textContent = 'Loading authorized connector catalog…';
      try {
        const response = await callTool('list_ai_connectors', {});
        const items = response?.structuredContent?.connectors || [];
        connectorListEl.replaceChildren();
        if (!items.length) connectorListEl.textContent = 'No connectors reported.';
        items.forEach(function (item) {
          const entry = document.createElement('div');
          entry.className = 'connector';
          const label = document.createElement('strong');
          label.textContent = item.label || item.id;
          const status = document.createElement('small');
          status.textContent = item.implemented
            ? (item.id === 'chatgpt-app-host' ? 'Embedded ComicChat transport; no host image entitlement' :
               item.id === 'comicchat-template' ? 'Built in; no paid API' : 'Available after authorization and billing approval')
            : 'Connection adapter not yet enabled';
          entry.append(label, status);
          connectorListEl.appendChild(entry);
        });
      } catch (error) {
        connectorListEl.textContent = 'Unable to retrieve connector status.';
      }
    });

    conversationsEl.addEventListener('click', async function (event) {
      const button = event.target.closest('button[data-conversation-id]');
      if (!button) return;
      const conversationId = button.dataset.conversationId;
      state.selectedConversationId = conversationId;
      state.messages = [];
      statusEl.textContent = 'Loading conversation…';
      render();
      try {
        const response = await callTool('get_messages', { conversationId: conversationId, limit: 100 });
        if (response && response.structuredContent && Array.isArray(response.structuredContent.messages)) {
          state.messages = response.structuredContent.messages;
        }
        statusEl.textContent = '';
        render();
      } catch (error) {
        statusEl.textContent = 'Could not load the conversation.';
        console.error(error);
      }
    });

    composerEl.addEventListener('submit', async function (event) {
      event.preventDefault();
      const text = messageTextEl.value;
      if (!state.selectedConversationId || !text.trim()) return;

      const reusePending = state.pendingRequestId && state.pendingText === text;
      const requestId = reusePending ? state.pendingRequestId : crypto.randomUUID();
      state.pendingRequestId = requestId;
      state.pendingText = text;
      sendButtonEl.disabled = true;
      statusEl.textContent = 'Sending…';
      try {
        await callTool('send_message', {
          conversationId: state.selectedConversationId,
          requestId: requestId,
          text: text,
        });
        state.pendingRequestId = null;
        state.pendingText = null;
        messageTextEl.value = '';
        const response = await callTool('get_messages', {
          conversationId: state.selectedConversationId,
          limit: 100,
        });
        if (response && response.structuredContent && Array.isArray(response.structuredContent.messages)) {
          state.messages = response.structuredContent.messages;
        }
        await callTool('list_conversations', { limit: 100 });
        statusEl.textContent = '';
      } catch (error) {
        statusEl.textContent = 'Send did not complete. Retry keeps the same request ID.';
        console.error(error);
      } finally {
        sendButtonEl.disabled = !state.selectedConversationId;
        render();
      }
    });

    render();
  </script>
</body>
</html>`
