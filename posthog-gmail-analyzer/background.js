// Trace - Background Service Worker

console.log('[Trace] Service worker loaded');

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[Trace] Extension icon clicked');
  console.log('[Trace] Current tab:', tab.url);

  // Check if we're on Gmail
  if (!tab.url || !tab.url.includes('mail.google.com')) {
    console.log('[Trace] Not on Gmail, showing error');
    await chrome.storage.local.set({
      analysisResult: {
        error: true,
        message: 'Please open Gmail to trace a user.',
        notGmail: true
      }
    });
    await chrome.sidePanel.open({ tabId: tab.id });
    return;
  }

  // Set loading state
  console.log('[Trace] Setting loading state');
  await chrome.storage.local.set({
    analysisResult: {
      loading: true,
      message: 'Extracting email...'
    }
  });

  // Open side panel
  try {
    console.log('[Trace] Opening side panel');
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (err) {
    console.error('[Trace] Failed to open side panel:', err);
  }

  // Extract email from Gmail page
  try {
    console.log('[Trace] Executing script to extract email');

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractEmailFromGmail
    });

    console.log('[Trace] Script execution results:', results);

    const email = results[0]?.result;
    console.log('[Trace] Extracted email:', email);

    if (!email) {
      console.log('[Trace] No email found');
      await chrome.storage.local.set({
        analysisResult: {
          error: true,
          message: 'Could not find an email address. Make sure you have an email open in Gmail (click on an email to view it).'
        }
      });
      return;
    }

    // Fetch PostHog data
    console.log('[Trace] Starting analysis for:', email);
    await analyzeUser(email);

  } catch (error) {
    console.error('[Trace] Error during extraction:', error);
    await chrome.storage.local.set({
      analysisResult: {
        error: true,
        message: 'Failed to extract email: ' + error.message
      }
    });
  }
});

// Function injected into Gmail page to extract email
function extractEmailFromGmail() {
  console.log('[Trace] Running email extraction in Gmail page');
  console.log('[Trace] Current URL:', window.location.href);

  const emailSelectors = [
    'span[email]',
    '[data-hovercard-id]',
    '.gD[email]',
    '.go[email]',
    'h3.iw span[email]',
    '[data-email]'
  ];

  for (const selector of emailSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      const email = element.getAttribute('email') ||
                    element.getAttribute('data-hovercard-id') ||
                    element.getAttribute('data-email');
      if (email && email.includes('@')) {
        return email;
      }
    }
  }

  const headerSelectors = ['.aju', '.adn', '.ha', '.hP', '.gE', '.gs'];
  for (const selector of headerSelectors) {
    const areas = document.querySelectorAll(selector);
    for (const area of areas) {
      const text = area.textContent;
      const emailMatch = text.match(/[\w.+-]+@[\w.-]+\.\w+/);
      if (emailMatch) {
        return emailMatch[0];
      }
    }
  }

  const emailContainer = document.querySelector('.adn.ads');
  if (emailContainer) {
    const text = emailContainer.textContent;
    const emails = text.match(/[\w.+-]+@[\w.-]+\.\w+/g);
    if (emails && emails.length > 0) {
      for (const email of emails) {
        if (!email.includes('gmail.com') || emails.length === 1) {
          return email;
        }
      }
      return emails[0];
    }
  }

  const threadContainer = document.querySelector('.AO, .nH.bkK');
  if (threadContainer) {
    const allText = threadContainer.textContent;
    const allEmails = allText.match(/[\w.+-]+@[\w.-]+\.\w+/g);
    if (allEmails && allEmails.length > 0) {
      const uniqueEmails = [...new Set(allEmails)];
      return uniqueEmails[0];
    }
  }

  const bodyText = document.body.textContent;
  const bodyEmails = bodyText.match(/[\w.+-]+@[\w.-]+\.\w+/g);
  if (bodyEmails) {
    const unique = [...new Set(bodyEmails)].slice(0, 5);
    if (unique.length > 0) {
      return unique[0];
    }
  }

  return null;
}

// Analyze user with PostHog
async function analyzeUser(email) {
  console.log('[Trace] analyzeUser called for:', email);

  try {
    const settings = await chrome.storage.sync.get(['apiKey', 'projectId', 'eventNames', 'emailProperty']);
    console.log('[Trace] Settings loaded:', {
      hasApiKey: !!settings.apiKey,
      projectId: settings.projectId
    });

    if (!settings.apiKey || !settings.projectId) {
      console.log('[Trace] Missing API key or Project ID');
      await chrome.storage.local.set({
        analysisResult: {
          error: true,
          message: 'Please configure your PostHog API key and Project ID in settings.',
          needsSetup: true,
          email: email
        }
      });
      return;
    }

    // Update loading state
    await chrome.storage.local.set({
      analysisResult: {
        loading: true,
        email: email,
        message: 'Fetching data from PostHog...'
      }
    });

    // Fetch events and session recordings in parallel
    const [events, recordings] = await Promise.all([
      fetchPostHogEvents(email, settings),
      fetchSessionRecordings(email, settings)
    ]);

    console.log('[Trace] Events fetched:', events.length);
    console.log('[Trace] Recordings fetched:', recordings.length);

    // Store results
    await chrome.storage.local.set({
      analysisResult: {
        success: true,
        email: email,
        events: events,
        recordings: recordings,
        timestamp: Date.now()
      }
    });
    console.log('[Trace] Results stored successfully');

  } catch (error) {
    console.error('[Trace] Error in analyzeUser:', error);
    await chrome.storage.local.set({
      analysisResult: {
        error: true,
        message: error.message || 'Failed to fetch data from PostHog',
        email: email
      }
    });
  }
}

// Fetch events from PostHog API using HogQL query
async function fetchPostHogEvents(email, settings) {
  const { apiKey, projectId, eventNames, emailProperty } = settings;
  const property = emailProperty || 'email_id';

  console.log('[Trace] fetchPostHogEvents called');

  try {
    const queryUrl = `https://app.posthog.com/api/projects/${projectId}/query/`;

    let hogqlQuery = `SELECT event, timestamp, properties FROM events WHERE properties.${property} = '${email}' AND timestamp > now() - INTERVAL 2 DAY ORDER BY timestamp DESC LIMIT 200`;

    if (eventNames && eventNames.length > 0) {
      const eventFilter = eventNames.map(e => `'${e}'`).join(', ');
      hogqlQuery = `SELECT event, timestamp, properties FROM events WHERE properties.${property} = '${email}' AND timestamp > now() - INTERVAL 2 DAY AND event IN (${eventFilter}) ORDER BY timestamp DESC LIMIT 200`;
    }

    console.log('[Trace] HogQL Query:', hogqlQuery);

    const response = await fetch(queryUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: {
          kind: 'HogQLQuery',
          query: hogqlQuery
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Trace] Query API error:', response.status, errorText);
      throw new Error(`PostHog API error: ${response.status}`);
    }

    const data = await response.json();
    const columns = data.columns || [];
    const results = data.results || [];

    const events = results.map(row => {
      const eventIdx = columns.indexOf('event');
      const timestampIdx = columns.indexOf('timestamp');
      const propertiesIdx = columns.indexOf('properties');

      return {
        event: eventIdx >= 0 ? row[eventIdx] : row[0],
        timestamp: timestampIdx >= 0 ? row[timestampIdx] : row[1],
        properties: propertiesIdx >= 0 ? row[propertiesIdx] : row[2]
      };
    });

    return events;

  } catch (error) {
    console.error('[Trace] Events API error:', error);
    throw error;
  }
}

// Fetch session recordings for the user
async function fetchSessionRecordings(email, settings) {
  const { apiKey, projectId, emailProperty } = settings;
  const property = emailProperty || 'email_id';

  console.log('[Trace] fetchSessionRecordings called');

  try {
    // First, get session IDs from events with $session_id
    const queryUrl = `https://app.posthog.com/api/projects/${projectId}/query/`;

    const hogqlQuery = `SELECT DISTINCT properties.$session_id as session_id, min(timestamp) as start_time
      FROM events
      WHERE properties.${property} = '${email}'
        AND timestamp > now() - INTERVAL 2 DAY
        AND properties.$session_id IS NOT NULL
      GROUP BY properties.$session_id
      ORDER BY start_time DESC
      LIMIT 10`;

    console.log('[Trace] Session HogQL Query:', hogqlQuery);

    const response = await fetch(queryUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: {
          kind: 'HogQLQuery',
          query: hogqlQuery
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Trace] Session query error:', response.status, errorText);
      return [];
    }

    const data = await response.json();
    const columns = data.columns || [];
    const results = data.results || [];

    console.log('[Trace] Session results:', results);

    const sessionIdIdx = columns.indexOf('session_id');
    const startTimeIdx = columns.indexOf('start_time');

    const recordings = results
      .filter(row => row[sessionIdIdx])
      .map(row => {
        const sessionId = row[sessionIdIdx];
        const startTime = row[startTimeIdx];
        return {
          sessionId: sessionId,
          startTime: startTime,
          url: `https://app.posthog.com/project/${projectId}/replay/${sessionId}`
        };
      });

    console.log('[Trace] Recordings:', recordings);
    return recordings;

  } catch (error) {
    console.error('[Trace] Recordings API error:', error);
    return [];
  }
}

// Listen for messages from side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Trace] Message received:', message);

  if (message.action === 'refresh') {
    (async () => {
      try {
        // Get the active Gmail tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];

        if (!tab || !tab.url || !tab.url.includes('mail.google.com')) {
          await chrome.storage.local.set({
            analysisResult: {
              error: true,
              message: 'Please open Gmail to trace a user.',
              notGmail: true
            }
          });
          sendResponse({ success: false });
          return;
        }

        // Clear previous results and show loading
        await chrome.storage.local.set({
          analysisResult: {
            loading: true,
            message: 'Extracting email...',
            email: null,
            events: null,
            recordings: null
          }
        });

        console.log('[Trace] Refresh: Extracting email from tab', tab.id);

        // Force re-injection of script to get fresh email
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractEmailFromGmail,
          world: 'MAIN' // Execute in main world to ensure fresh DOM access
        });

        const email = results[0]?.result;
        console.log('[Trace] Refresh: Extracted email:', email);

        if (email) {
          // Update loading state with new email
          await chrome.storage.local.set({
            analysisResult: {
              loading: true,
              message: 'Fetching data from PostHog...',
              email: email
            }
          });

          await analyzeUser(email);
          sendResponse({ success: true, email: email });
        } else {
          await chrome.storage.local.set({
            analysisResult: {
              error: true,
              message: 'Could not find an email address. Make sure you have an email open.'
            }
          });
          sendResponse({ success: false });
        }
      } catch (error) {
        console.error('[Trace] Refresh error:', error);
        await chrome.storage.local.set({
          analysisResult: {
            error: true,
            message: 'Error: ' + error.message
          }
        });
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  if (message.action === 'openSettings') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
  }

  return true;
});

console.log('[Trace] Service worker setup complete');
