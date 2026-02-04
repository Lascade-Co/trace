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

    const result = results[0]?.result;
    console.log('[Trace] Extraction result:', result);

    // Check if email was skipped due to not being target email
    if (result?.skipReason === 'not_target_email') {
      console.log('[Trace] Email not sent to target address');
      await chrome.storage.local.set({
        analysisResult: {
          error: true,
          message: 'This email is not sent to connect@travelanimator.com'
        }
      });
      return;
    }

    const email = result?.email || result;
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

// Target email - only analyze emails sent to this address
const TARGET_TO_EMAIL = 'connect@travelanimator.com';

// Function injected into Gmail page to extract email and check "to" address
function extractEmailFromGmail() {
  console.log('[Trace] Running email extraction in Gmail page');
  console.log('[Trace] Current URL:', window.location.href);

  // First, check if this email is sent TO connect@travelanimator.com
  const toAddresses = getToAddressesFromPage();
  console.log('[Trace] To addresses found:', toAddresses);

  const isTargetEmail = toAddresses.some(addr =>
    addr.toLowerCase().includes('travelanimator') ||
    addr.toLowerCase() === 'connect@travelanimator.com'
  );

  if (!isTargetEmail) {
    console.log('[Trace] Email not sent to target address, skipping');
    return { email: null, skipReason: 'not_target_email' };
  }

  // Now extract sender email
  let senderEmail = null;

  // Priority 1: Look for the sender email in the currently open email's header
  const senderElement = document.querySelector('.gD[email]');
  if (senderElement) {
    const email = senderElement.getAttribute('email');
    if (email && email.includes('@')) {
      console.log('[Trace] Found sender email from .gD:', email);
      senderEmail = email;
    }
  }

  // Priority 2: Look in the expanded email header area
  if (!senderEmail) {
    const expandedHeader = document.querySelector('h3.iw span[email]');
    if (expandedHeader) {
      const email = expandedHeader.getAttribute('email');
      if (email && email.includes('@')) {
        console.log('[Trace] Found email from expanded header:', email);
        senderEmail = email;
      }
    }
  }

  // Priority 3: Check all email attributes in main content
  if (!senderEmail) {
    const mainContent = document.querySelector('.AO, .nH.bkK, [role="main"]');
    if (mainContent) {
      const emailElements = mainContent.querySelectorAll('[email]');
      for (const element of emailElements) {
        const email = element.getAttribute('email');
        if (email && email.includes('@')) {
          console.log('[Trace] Found email from main content:', email);
          senderEmail = email;
          break;
        }
      }
    }
  }

  // Priority 4: Fallback selectors
  if (!senderEmail) {
    const emailSelectors = ['span[email]', '[data-hovercard-id]', '.go[email]'];
    for (const selector of emailSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const email = element.getAttribute('email') || element.getAttribute('data-hovercard-id');
        if (email && email.includes('@')) {
          console.log('[Trace] Found email from fallback selector:', email);
          senderEmail = email;
          break;
        }
      }
      if (senderEmail) break;
    }
  }

  console.log('[Trace] Final sender email:', senderEmail);
  return { email: senderEmail, skipReason: null };

  // Helper function to get "to" addresses
  function getToAddressesFromPage() {
    const toAddresses = [];

    // Check if page contains target email anywhere
    if (document.body.innerHTML.toLowerCase().includes('connect@travelanimator.com')) {
      toAddresses.push('connect@travelanimator.com');
    }

    // Look for To: patterns in page text
    const pageText = document.body.innerText;
    const toMatches = pageText.match(/To:[\s\S]*?([\w.+-]+@[\w.-]+\.\w+)/gi);
    if (toMatches) {
      toMatches.forEach(match => {
        const emailMatch = match.match(/[\w.+-]+@[\w.-]+\.\w+/i);
        if (emailMatch) {
          toAddresses.push(emailMatch[0].toLowerCase());
        }
      });
    }

    return [...new Set(toAddresses)];
  }
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

    let hogqlQuery = `SELECT event, timestamp, properties, properties.$session_id as session_id FROM events WHERE properties.${property} = '${email}' AND timestamp > now() - INTERVAL 2 DAY ORDER BY timestamp DESC LIMIT 200`;

    if (eventNames && eventNames.length > 0) {
      const eventFilter = eventNames.map(e => `'${e}'`).join(', ');
      hogqlQuery = `SELECT event, timestamp, properties, properties.$session_id as session_id FROM events WHERE properties.${property} = '${email}' AND timestamp > now() - INTERVAL 2 DAY AND event IN (${eventFilter}) ORDER BY timestamp DESC LIMIT 200`;
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
    }

    const data = await response.json();
    const columns = data.columns || [];
    const results = data.results || [];

    const events = results.map(row => {
      const eventIdx = columns.indexOf('event');
      const timestampIdx = columns.indexOf('timestamp');
      const propertiesIdx = columns.indexOf('properties');
      const sessionIdIdx = columns.indexOf('session_id');

      return {
        event: eventIdx >= 0 ? row[eventIdx] : row[0],
        timestamp: timestampIdx >= 0 ? row[timestampIdx] : row[1],
        properties: propertiesIdx >= 0 ? row[propertiesIdx] : row[2],
        sessionId: sessionIdIdx >= 0 ? row[sessionIdIdx] : null
      };
    });

    console.log('[Trace] Events with session IDs:', events.filter(e => e.sessionId).length);

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

        const result = results[0]?.result;
        console.log('[Trace] Refresh: Extraction result:', result);

        // Check if email was skipped due to not being target email
        if (result?.skipReason === 'not_target_email') {
          await chrome.storage.local.set({
            analysisResult: {
              error: true,
              message: 'This email is not sent to connect@travelanimator.com'
            }
          });
          sendResponse({ success: false });
          return;
        }

        const email = result?.email || result;
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

  if (message.action === 'autoAnalyze') {
    (async () => {
      try {
        const email = message.email;
        console.log('[Trace] Auto-analyze triggered for:', email);

        if (!email) {
          sendResponse({ success: false, error: 'No email provided' });
          return;
        }

        // Set loading state
        await chrome.storage.local.set({
          analysisResult: {
            loading: true,
            email: email,
            message: 'Fetching data from PostHog...'
          }
        });

        // Trigger analysis
        await analyzeUser(email);
        sendResponse({ success: true, email: email });

      } catch (error) {
        console.error('[Trace] Auto-analyze error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  return true;
});

console.log('[Trace] Service worker setup complete');
