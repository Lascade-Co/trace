// Trace - Side Panel Script

// Session threshold - events more than 30 minutes apart are different sessions
const SESSION_GAP_MS = 30 * 60 * 1000;

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init() {
  document.getElementById('refresh-btn').addEventListener('click', handleRefresh);
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('setup-btn')?.addEventListener('click', openSettings);

  loadState();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.analysisResult) {
      updateUI(changes.analysisResult.newValue);
    }
  });
}

function loadState() {
  chrome.storage.local.get(['analysisResult'], (result) => {
    if (result.analysisResult) {
      updateUI(result.analysisResult);
    } else {
      showState('initial');
    }
  });
}

function handleRefresh() {
  const btn = document.getElementById('refresh-btn');
  btn.style.animation = 'spin 1s linear infinite';

  chrome.runtime.sendMessage({ action: 'refresh' }, (response) => {
    setTimeout(() => {
      btn.style.animation = '';
    }, 1000);
  });
}

function openSettings() {
  chrome.runtime.sendMessage({ action: 'openSettings' });
}

function updateUI(data) {
  hideAllStates();

  if (data.loading) {
    showState('loading');
    document.getElementById('loading-message').textContent = data.message || 'Loading...';
    document.getElementById('loading-email').textContent = data.email || '';
    return;
  }

  if (data.error) {
    showState('error');
    document.getElementById('error-message').textContent = data.message;
    document.getElementById('error-email').textContent = data.email || '';

    const setupBtn = document.getElementById('setup-btn');
    if (data.needsSetup) {
      setupBtn.classList.remove('hidden');
    } else {
      setupBtn.classList.add('hidden');
    }

    if (data.notGmail) {
      showState('initial');
    }
    return;
  }

  if (data.success) {
    const hasEvents = data.events && data.events.length > 0;
    const hasRecordings = data.recordings && data.recordings.length > 0;

    if (!hasEvents && !hasRecordings) {
      showState('empty');
      document.getElementById('empty-email').textContent = data.email || '';
      return;
    }

    showState('results');
    renderResults(data);
  }
}

function hideAllStates() {
  ['loading', 'error', 'results', 'empty', 'initial'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
}

function showState(state) {
  document.getElementById(state).classList.remove('hidden');
}

function renderResults(data) {
  // User info
  const email = data.email;
  document.getElementById('user-email').textContent = email;
  document.getElementById('user-avatar').textContent = email.charAt(0).toUpperCase();
  document.getElementById('events-count').textContent = data.events?.length || 0;

  // Render recordings
  renderRecordings(data.recordings || []);

  // Render events
  if (data.events && data.events.length > 0) {
    const sessions = groupEventsBySessions(data.events);
    renderEvents(sessions);
  }
}

function renderRecordings(recordings) {
  const section = document.getElementById('recordings-section');
  const container = document.getElementById('recordings-list');
  container.innerHTML = '';

  if (!recordings || recordings.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  recordings.forEach((recording, index) => {
    const item = document.createElement('a');
    item.className = 'recording-item';
    item.href = recording.url;
    item.target = '_blank';
    item.rel = 'noopener noreferrer';

    item.innerHTML = `
      <div class="recording-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </div>
      <div class="recording-info">
        <div class="recording-label">Session ${index + 1}</div>
        <div class="recording-time">${formatRecordingTime(recording.startTime)}</div>
      </div>
      <div class="recording-arrow">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    `;

    container.appendChild(item);
  });
}

function formatRecordingTime(timestamp) {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let relative;
  if (diffHours < 1) {
    const diffMins = Math.floor(diffMs / (1000 * 60));
    relative = `${diffMins}m ago`;
  } else if (diffHours < 24) {
    relative = `${diffHours}h ago`;
  } else {
    relative = `${diffDays}d ago`;
  }

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

  return `${dateStr} at ${timeStr} · ${relative}`;
}

function renderEvents(sessions) {
  const container = document.getElementById('events-list');
  container.innerHTML = '';

  sessions.forEach((session, sessionIndex) => {
    if (sessionIndex > 0) {
      const breakEl = document.createElement('div');
      breakEl.className = 'session-break';
      breakEl.textContent = formatSessionGap(sessions[sessionIndex - 1], session);
      container.appendChild(breakEl);
    }

    const flowEl = document.createElement('div');
    flowEl.className = 'events-flow';

    session.forEach((event, eventIndex) => {
      const isLast = eventIndex === session.length - 1;
      const eventEl = createEventItem(event, isLast);
      flowEl.appendChild(eventEl);
    });

    container.appendChild(flowEl);
  });
}

function groupEventsBySessions(events) {
  if (!events || events.length === 0) return [];

  const sorted = [...events].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return timeB - timeA;
  });

  const sessions = [];
  let currentSession = [];

  sorted.forEach((event, index) => {
    if (index === 0) {
      currentSession.push(event);
      return;
    }

    const currentTime = new Date(event.timestamp).getTime();
    const prevTime = new Date(sorted[index - 1].timestamp).getTime();
    const gap = prevTime - currentTime;

    if (gap > SESSION_GAP_MS) {
      sessions.push(currentSession);
      currentSession = [event];
    } else {
      currentSession.push(event);
    }
  });

  if (currentSession.length > 0) {
    sessions.push(currentSession);
  }

  return sessions;
}

function createEventItem(event, isLastInSession) {
  const item = document.createElement('div');
  item.className = 'event-item' + (isLastInSession ? ' last-in-session' : '');

  const connector = document.createElement('div');
  connector.className = 'event-connector';

  const dot = document.createElement('div');
  dot.className = 'event-dot';
  connector.appendChild(dot);

  if (!isLastInSession) {
    const line = document.createElement('div');
    line.className = 'event-line';
    connector.appendChild(line);
  }

  item.appendChild(connector);

  const content = document.createElement('div');
  content.className = 'event-content';

  const name = document.createElement('div');
  name.className = 'event-name';
  name.textContent = formatEventName(event.event || 'Unknown Event');
  content.appendChild(name);

  const time = document.createElement('div');
  time.className = 'event-time';
  time.textContent = formatTimestamp(event.timestamp);
  content.appendChild(time);

  item.appendChild(content);

  return item;
}

function formatSessionGap(prevSession, currentSession) {
  if (!prevSession || !currentSession || prevSession.length === 0 || currentSession.length === 0) {
    return 'Earlier session';
  }

  const prevTime = new Date(prevSession[prevSession.length - 1].timestamp).getTime();
  const currentTime = new Date(currentSession[0].timestamp).getTime();
  const gap = prevTime - currentTime;

  const hours = Math.floor(gap / (1000 * 60 * 60));
  const minutes = Math.floor((gap % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} earlier`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m earlier`;
  } else {
    return `${minutes}m earlier`;
  }
}

function formatEventName(name) {
  if (!name) return 'Unknown Event';

  if (name.startsWith('$')) {
    name = name.substring(1);
  }

  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let relative;
  if (diffMins < 1) {
    relative = 'Just now';
  } else if (diffMins < 60) {
    relative = `${diffMins}m ago`;
  } else if (diffHours < 24) {
    relative = `${diffHours}h ago`;
  } else {
    relative = `${diffDays}d ago`;
  }

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  return `${relative} · ${timeStr}`;
}
