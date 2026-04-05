/**
 * A-Coder-CLI Web Interface Client
 * 
 * Premium agency-level implementation with fluid motion choreography,
 * haptic micro-interactions, and obsessive attention to detail.
 */

// ============================================================================
// STATE MANAGEMENT
// ============================================================================
let messages = [];
let isConnected = false;
let eventSource = null;
let currentStreamingMessage = null;
let lastScrollPosition = 0;
let isUserScrolling = false;

// ============================================================================
// DOM ELEMENTS
// ============================================================================
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const statusDot = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');
const serverUrlSpan = document.getElementById('server-url');
const welcomeState = document.getElementById('welcome-state');
const chatState = document.getElementById('chat-state');
const startChatBtn = document.getElementById('start-chat-btn');

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  serverUrlSpan.textContent = window.location.host;
  setupAutoResize();
  setupEventListeners();
  connectSSE();
  
  // Focus input after short delay for better UX
  setTimeout(() => {
    if (chatState.classList.contains('hidden')) {
      startChatBtn.focus();
    } else {
      messageInput.focus();
    }
  }, 300);
});

// ============================================================================
// CONNECTION MANAGEMENT
// ============================================================================
function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  const eventsUrl = `${window.location.origin}/api/events`;
  eventSource = new EventSource(eventsUrl);

  eventSource.onopen = () => {
    isConnected = true;
    updateStatus('connected', 'Connected');
    console.log('✓ SSE connected');
    
    // Request history on successful connection
    requestHistory();
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
    console.error('✗ SSE connection error');

    // Exponential backoff reconnection
    const retryDelay = Math.min(3000 * Math.pow(2, reconnectAttempts), 30000);
    setTimeout(() => {
      if (!isConnected) {
        connectSSE();
      }
    }, retryDelay);
  };
}

let reconnectAttempts = 0;

// ============================================================================
// EVENT HANDLING
// ============================================================================
function handleEvent(event) {
  const { type, content, timestamp, metadata } = event;

  switch (type) {
    case 'connected':
      console.log('✓ Server confirmed connection');
      break;

    case 'history':
      // Full history sync with staggered animation
      try {
        const history = JSON.parse(content);
        messages = history;
        renderMessages(true);
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
      // Handle streaming content with smooth updates
      if (currentStreamingMessage) {
        currentStreamingMessage.text += content;
      } else {
        currentStreamingMessage = {
          type: 'gemini',
          text: content,
          timestamp: timestamp,
          streaming: true,
        };
        messages.push(currentStreamingMessage);
      }
      renderMessages(false, true);
      break;

    case 'thought':
      addMessage({
        type: 'thought',
        text: content,
        timestamp: timestamp,
      });
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
      // Silent fail for unknown types to avoid console spam
  }

  // Finalize streaming message
  if (type !== 'gemini' && type !== 'gemini_content' && currentStreamingMessage) {
    currentStreamingMessage.streaming = false;
    currentStreamingMessage = null;
    updateStatus('connected', 'Connected');
  }

  // Update responding status
  if (currentStreamingMessage) {
    updateStatus('responding', 'Responding...');
  }
}

// ============================================================================
// MESSAGE MANAGEMENT
// ============================================================================
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
  renderMessages(false, true);
}

function renderMessages(isHistory = false, isStreaming = false) {
  const welcomeMessage = messagesContainer.querySelector('.welcome-message');
  
  // Clear existing messages (except welcome)
  messagesContainer.innerHTML = '';

  if (welcomeMessage && messages.length === 0) {
    messagesContainer.appendChild(welcomeMessage);
    return;
  }

  // Render each message with staggered animation for history
  messages.forEach((message, index) => {
    const messageEl = createMessageElement(message);
    if (isHistory && !isStreaming) {
      messageEl.style.animationDelay = `${Math.min(index * 50, 500)}ms`;
    }
    messagesContainer.appendChild(messageEl);
  });

  // Auto-scroll to bottom only if user hasn't scrolled up
  if (!isUserScrolling || messagesContainer.scrollHeight - messagesContainer.scrollTop <= 150) {
    scrollToBottom();
  }
}

function createMessageElement(message) {
  const div = document.createElement('div');
  div.className = `message message-${message.type}`;

  switch (message.type) {
    case 'user':
      div.innerHTML = `<div class="message-content">${escapeHtml(message.text)}</div>`;
      break;

    case 'gemini':
      div.innerHTML = `
        <div class="message-content">${formatMessageText(message.text)}</div>
        ${message.streaming ? createStreamingIndicator() : ''}
      `;
      break;

    case 'info':
      div.innerHTML = `<div class="message-content">${escapeHtml(message.text)}</div>`;
      break;

    case 'error':
      div.innerHTML = `<div class="message-content">${escapeHtml(message.text)}</div>`;
      break;

    case 'thought':
      div.innerHTML = `
        <div class="message-content">
          <span style="color: var(--text-tertiary); font-style: italic;">
            ${formatMessageText(message.text)}
          </span>
        </div>
      `;
      break;

    case 'tool':
      const toolName = message.metadata?.name || 'unknown';
      const toolArgs = message.metadata?.args || {};
      div.innerHTML = `
        <div class="message-tool">
          <div class="message-tool-header">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 1a1 1 0 011 1v2a1 1 0 11-2 0V2a1 1 0 011-1zM8 11a1 1 0 100 2 1 1 0 000-2zm7-4a1 1 0 11-2 0 1 1 0 012 0zM1 8a1 1 0 102 0 1 1 0 00-2 0zm11.293-3.293a1 1 0 011.414 1.414l-.707.707a1 1 0 11-1.414-1.414l.707-.707zM3.414 12.293a1 1 0 101.414 1.414l-.707.707a1 1 0 00-1.414-1.414l.707-.707zM12.293 12.293a1 1 0 011.414 1.414l-.707.707a1 1 0 11-1.414-1.414l.707-.707zM3.414 3.414a1 1 0 101.414 1.414l-.707.707a1 1 0 00-1.414-1.414l.707-.707z" fill="currentColor"/>
            </svg>
            <span>${escapeHtml(toolName)}</span>
          </div>
          <div class="message-tool-content">
            <pre><code>${escapeHtml(JSON.stringify(toolArgs, null, 2))}</code></pre>
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

// ============================================================================
// TEXT FORMATTING
// ============================================================================
function formatMessageText(text) {
  if (!text) return '';

  // Escape HTML first
  let formatted = escapeHtml(text);

  // Code blocks (must be before inline code)
  formatted = formatted.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escapedCode = escapeHtml(code);
    return `<pre><code class="language-${escapeHtml(lang)}">${escapedCode}</code></pre>`;
  });

  // Inline code
  formatted = formatted.replace(/`([^`]+)`/g, (_, code) => {
    return `<code>${escapeHtml(code)}</code>`;
  });

  // Bold
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Newlines
  formatted = formatted.replace(/\n/g, '<br>');

  return formatted;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// UI UPDATES
// ============================================================================
function updateStatus(status, text) {
  statusDot.className = `status-dot ${status}`;
  statusLabel.textContent = text;
}

function scrollToBottom() {
  messagesContainer.scrollTo({
    top: messagesContainer.scrollHeight,
    behavior: 'smooth'
  });
}

// ============================================================================
// INPUT HANDLING
// ============================================================================
function setupAutoResize() {
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    const newHeight = Math.min(messageInput.scrollHeight, 200);
    messageInput.style.height = `${newHeight}px`;
    
    // Adjust container height based on input size
    const inputCore = document.querySelector('.input-core');
    if (inputCore) {
      inputCore.style.paddingBottom = `${Math.max(0.75, newHeight / 48 * 0.75)}rem`;
    }
  });
}

function setupEventListeners() {
  // Start chat button
  startChatBtn.addEventListener('click', () => {
    welcomeState.classList.add('hidden');
    chatState.classList.remove('hidden');
    messageInput.focus();
  });

  // Send button
  sendButton.addEventListener('click', sendMessage);

  // Enter key (without shift)
  messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  // Track user scrolling
  messagesContainer.addEventListener('scroll', () => {
    isUserScrolling = true;
    lastScrollPosition = messagesContainer.scrollTop;
    
    // Reset after user stops scrolling
    clearTimeout(window.scrollResetTimer);
    window.scrollResetTimer = setTimeout(() => {
      isUserScrolling = false;
    }, 100);
  });

  // Click outside to blur
  document.addEventListener('click', (event) => {
    if (!messageInput.contains(event.target) && !sendButton.contains(event.target)) {
      messageInput.blur();
    }
  });
}

// ============================================================================
// MESSAGING
// ============================================================================
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !isConnected) return;

  // Clear input
  messageInput.value = '';
  messageInput.style.height = 'auto';

  // Disable button while sending
  sendButton.disabled = true;
  sendButton.style.opacity = '0.7';

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
    sendButton.style.opacity = '1';
    messageInput.focus();
  }
}

// ============================================================================
// HISTORY
// ============================================================================
async function requestHistory() {
  try {
    const response = await fetch('/api/history');
    const result = await response.json();

    if (result.history) {
      messages = result.history;
      
      // Show chat state if there's history
      if (messages.length > 0) {
        welcomeState.classList.add('hidden');
        chatState.classList.remove('hidden');
      }
      
      renderMessages(true);
    }
  } catch (error) {
    console.error('Failed to fetch history:', error);
  }
}

// ============================================================================
// UTILITY: Streaming Indicator
// ============================================================================
function createStreamingIndicator() {
  const indicator = document.createElement('span');
  indicator.className = 'streaming-indicator';
  indicator.innerHTML = '<span></span><span></span><span></span>';
  return indicator;
}

// ============================================================================
// PERFORMANCE: Intersection Observer for lazy rendering
// ============================================================================
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
  );

  // Observe messages for lazy animation
  const observeMessages = () => {
    messagesContainer.querySelectorAll('.message').forEach((msg) => {
      msg.style.opacity = '0';
      msg.style.transform = 'translateY(1rem)';
      msg.style.transition = 'opacity 600ms cubic-bezier(0.16, 1, 0.3, 1), transform 600ms cubic-bezier(0.16, 1, 0.3, 1)';
      observer.observe(msg);
    });
  };

  // Re-observe after rendering
  const originalRenderMessages = renderMessages;
  renderMessages = (isHistory, isStreaming) => {
    originalRenderMessages(isHistory, isStreaming);
    if (!isStreaming) {
      setTimeout(observeMessages, 100);
    }
  };
}
