/**
 * A-Coder-CLI Web Interface Client
 *
 * Handles SSE connection, message display, and user input.
 */

// State
let messages = [];
let isConnected = false;
let eventSource = null;
let currentStreamingMessage = null;

// DOM Elements
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const statusIndicator = document.querySelector('.status-indicator');
const statusText = document.querySelector('.status-text');
const serverUrlSpan = document.getElementById('server-url');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  serverUrlSpan.textContent = window.location.host;
  connectSSE();
  setupEventListeners();
});

/**
 * Connect to the SSE endpoint.
 */
function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  const eventsUrl = `${window.location.origin}/api/events`;
  eventSource = new EventSource(eventsUrl);

  eventSource.onopen = () => {
    isConnected = true;
    updateStatus('connected', 'Connected');
    console.log('SSE connected');
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleEvent(data);
    } catch (error) {
      console.error('Failed to parse SSE event:', error);
    }
  };

  eventSource.onerror = () => {
    isConnected = false;
    updateStatus('disconnected', 'Disconnected');
    console.error('SSE connection error');

    // Attempt to reconnect after 3 seconds
    setTimeout(() => {
      if (!isConnected) {
        connectSSE();
      }
    }, 3000);
  };
}

/**
 * Handle incoming SSE events.
 */
function handleEvent(event) {
  const { type, content, timestamp, metadata } = event;

  switch (type) {
    case 'connected':
      console.log('Server confirmed connection:', content);
      break;

    case 'history':
      // Full history sync
      try {
        const history = JSON.parse(content);
        messages = history;
        renderMessages();
      } catch (error) {
        console.error('Failed to parse history:', error);
      }
      break;

    case 'user':
      addMessage({
        type: 'user',
        text: content,
        timestamp: timestamp,
      });
      break;

    case 'gemini':
    case 'gemini_content':
      // Handle streaming content
      if (currentStreamingMessage) {
        // Append to existing streaming message
        currentStreamingMessage.text += content;
      } else {
        // Start new streaming message
        currentStreamingMessage = {
          type: 'gemini',
          text: content,
          timestamp: timestamp,
          streaming: true,
        };
        messages.push(currentStreamingMessage);
      }
      renderMessages();
      break;

    case 'info':
      addMessage({
        type: 'info',
        text: content,
        timestamp: timestamp,
      });
      break;

    case 'error':
      addMessage({
        type: 'error',
        text: content,
        timestamp: timestamp,
      });
      break;

    case 'thought':
      addMessage({
        type: 'thought',
        text: content,
        timestamp: timestamp,
      });
      break;

    case 'tool_group':
      if (metadata) {
        addMessage({
          type: 'tool',
          metadata: metadata,
          timestamp: timestamp,
        });
      }
      break;

    default:
      console.log('Unknown event type:', type, event);
  }

  // If we received a non-streaming event, finalize any streaming message
  if (type !== 'gemini' && type !== 'gemini_content' && currentStreamingMessage) {
    currentStreamingMessage.streaming = false;
    currentStreamingMessage = null;
  }
}

/**
 * Add a message to the list.
 */
function addMessage(message) {
  // Clear any streaming message first
  if (currentStreamingMessage) {
    currentStreamingMessage.streaming = false;
    currentStreamingMessage = null;
  }

  messages.push({
    ...message,
    id: message.timestamp || Date.now(),
  });
  renderMessages();
}

/**
 * Render all messages to the DOM.
 */
function renderMessages() {
  // Keep the welcome message
  const welcomeMessage = messagesContainer.querySelector('.welcome-message');

  // Clear existing messages (except welcome)
  messagesContainer.innerHTML = '';

  if (welcomeMessage && messages.length === 0) {
    messagesContainer.appendChild(welcomeMessage);
    return;
  }

  // Render each message
  messages.forEach((message) => {
    const messageEl = createMessageElement(message);
    messagesContainer.appendChild(messageEl);
  });

  // Scroll to bottom
  scrollToBottom();
}

/**
 * Create a message DOM element.
 */
function createMessageElement(message) {
  const div = document.createElement('div');
  div.className = `message message-${message.type}`;

  switch (message.type) {
    case 'user':
      div.innerHTML = formatMessageText(message.text);
      break;

    case 'gemini':
      div.innerHTML = formatMessageText(message.text);
      if (message.streaming) {
        const indicator = document.createElement('span');
        indicator.className = 'streaming-indicator';
        indicator.innerHTML = '<span></span><span></span><span></span>';
        div.appendChild(indicator);
      }
      break;

    case 'info':
      div.textContent = message.text;
      break;

    case 'error':
      div.textContent = message.text;
      break;

    case 'thought':
      div.innerHTML = `<strong>Thinking:</strong> ${formatMessageText(message.text)}`;
      break;

    case 'tool':
      const toolName = message.metadata?.name || 'unknown';
      const toolArgs = message.metadata?.args || {};
      div.innerHTML = `
        <div class="message-tool">
          <div class="message-tool-header">
            <span>🔧 ${toolName}</span>
          </div>
          <div class="message-tool-content">
            <pre>${JSON.stringify(toolArgs, null, 2)}</pre>
          </div>
        </div>
      `;
      break;

    default:
      div.textContent = message.text || JSON.stringify(message);
  }

  // Add timestamp if available
  if (message.timestamp) {
    const timeEl = document.createElement('div');
    timeEl.className = 'message-time';
    timeEl.textContent = formatTime(message.timestamp);
    div.appendChild(timeEl);
  }

  return div;
}

/**
 * Format message text with markdown-like syntax.
 */
function formatMessageText(text) {
  if (!text) return '';

  // Escape HTML
  let formatted = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks
  formatted = formatted.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang}">${code}</code></pre>`;
  });

  // Inline code
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Newlines
  formatted = formatted.replace(/\n/g, '<br>');

  return formatted;
}

/**
 * Format timestamp to readable time.
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Update connection status display.
 */
function updateStatus(status, text) {
  statusIndicator.className = `status-indicator ${status}`;
  statusText.textContent = text;

  // Update responding status
  if (status === 'connected' && currentStreamingMessage) {
    statusIndicator.className = 'status-indicator responding';
    statusText.textContent = 'Responding...';
  }
}

/**
 * Scroll messages to bottom.
 */
function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Setup event listeners.
 */
function setupEventListeners() {
  // Send button
  sendButton.addEventListener('click', sendMessage);

  // Enter key (without shift)
  messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
  });
}

/**
 * Send message to server.
 */
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !isConnected) return;

  // Clear input
  messageInput.value = '';
  messageInput.style.height = 'auto';

  // Disable button while sending
  sendButton.disabled = true;

  try {
    const response = await fetch('/api/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: text }),
    });

    const result = await response.json();

    if (result.success) {
      // Message queued - it will appear via SSE
      updateStatus('responding', 'Processing...');
    } else {
      addMessage({
        type: 'error',
        text: `Failed to send message: ${result.error || 'Unknown error'}`,
        timestamp: Date.now(),
      });
    }
  } catch (error) {
    addMessage({
      type: 'error',
      text: `Network error: ${error.message}`,
      timestamp: Date.now(),
    });
  } finally {
    sendButton.disabled = false;
    messageInput.focus();
  }
}

/**
 * Request history from server.
 */
async function requestHistory() {
  try {
    const response = await fetch('/api/history');
    const result = await response.json();

    if (result.history) {
      messages = result.history;
      renderMessages();
    }
  } catch (error) {
    console.error('Failed to fetch history:', error);
  }
}