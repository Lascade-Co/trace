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

  // Hide the separate events timeline section
  const eventsSection = document.querySelector('.events-section');
  if (eventsSection) {
    eventsSection.classList.add('hidden');
  }

  // Render recordings with their events
  renderRecordings(data.recordings || [], data.events || []);
}

function renderRecordings(recordings, events) {
  const section = document.getElementById('recordings-section');
  const container = document.getElementById('recordings-list');
  container.innerHTML = '';

  if (!recordings || recordings.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  // Group events by session ID
  const eventsBySession = {};
  events.forEach(event => {
    const sessionId = event.sessionId;
    if (sessionId) {
      if (!eventsBySession[sessionId]) {
        eventsBySession[sessionId] = [];
      }
      eventsBySession[sessionId].push(event);
    }
  });

  console.log('[Trace] Events by session:', eventsBySession);
  console.log('[Trace] Recordings:', recordings);
  console.log('[Trace] Total events with sessionId:', events.filter(e => e.sessionId).length);

  recordings.forEach((recording, index) => {
    const sessionEvents = eventsBySession[recording.sessionId] || [];

    // Sort events by timestamp (oldest first)
    sessionEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Calculate session duration from events
    const sessionDuration = calculateSessionDuration(sessionEvents);

    const wrapper = document.createElement('div');
    wrapper.className = 'recording-wrapper';

    // Recording header (clickable row)
    const item = document.createElement('div');
    item.className = 'recording-item';

    const timeInfo = formatRecordingTimeDetailed(recording.startTime);

    item.innerHTML = `
      <div class="recording-expand-icon ${sessionEvents.length === 0 ? 'no-events' : ''}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="recording-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </div>
      <div class="recording-info">
        <div class="recording-label">Session ${index + 1}${sessionDuration ? ` · ${sessionDuration}` : ''}</div>
        <div class="recording-time">${timeInfo.dateTime}</div>
        <div class="recording-meta">
          <span class="recording-relative">${timeInfo.relative}</span>
          ${sessionEvents.length > 0 ? `<span class="recording-events-count">${sessionEvents.length} event${sessionEvents.length !== 1 ? 's' : ''}</span>` : ''}
        </div>
      </div>
      <div class="recording-arrow" title="Open in PostHog">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </div>
    `;

    // Events list (collapsed by default)
    const eventsList = document.createElement('div');
    eventsList.className = 'session-events-list collapsed';

    if (sessionEvents.length > 0) {
      sessionEvents.forEach((event, eventIndex) => {
        const isLast = eventIndex === sessionEvents.length - 1;
        const eventEl = createSessionEventItem(event, isLast);
        eventsList.appendChild(eventEl);
      });
    }

    // Click handler for expand/collapse
    item.addEventListener('click', (e) => {
      // If clicking the external link icon, open PostHog
      if (e.target.closest('.recording-arrow')) {
        window.open(recording.url, '_blank');
        return;
      }

      console.log('[Trace] Session clicked:', recording.sessionId);
      console.log('[Trace] Session events:', sessionEvents.length);

      // Toggle events list
      if (sessionEvents.length > 0) {
        eventsList.classList.toggle('collapsed');
        item.classList.toggle('expanded');
        console.log('[Trace] Toggled collapsed state');
      }
    });

    wrapper.appendChild(item);
    wrapper.appendChild(eventsList);
    container.appendChild(wrapper);
  });
}

function createSessionEventItem(event, isLast) {
  const item = document.createElement('div');
  item.className = 'session-event-item' + (isLast ? ' last' : '');

  item.innerHTML = `
    <div class="session-event-dot"></div>
    <div class="session-event-content">
      <div class="session-event-name">${formatEventName(event.event || 'Unknown Event')}</div>
      <div class="session-event-time">${formatTimestamp(event.timestamp)}</div>
    </div>
  `;

  return item;
}

function calculateSessionDuration(events) {
  if (!events || events.length < 2) return null;

  const timestamps = events.map(e => new Date(e.timestamp).getTime());
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const durationMs = maxTime - minTime;

  if (durationMs < 1000) return null;

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMins = minutes % 60;
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
  } else if (minutes > 0) {
    const remainingSecs = seconds % 60;
    return remainingSecs > 0 ? `${minutes}m ${remainingSecs}s` : `${minutes}m`;
  } else {
    return `${seconds}s`;
  }
}

function formatRecordingTimeDetailed(timestamp) {
  if (!timestamp) return { dateTime: '', relative: '' };

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
    relative = `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    relative = `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffDays === 1) {
    relative = 'Yesterday';
  } else {
    relative = `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  }

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

  return {
    dateTime: `${dateStr} at ${timeStr}`,
    relative: relative
  };
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
