document.addEventListener('DOMContentLoaded', loadSettings);
document.getElementById('settings-form').addEventListener('submit', saveSettings);

function loadSettings() {
  chrome.storage.sync.get(['apiKey', 'projectId', 'eventNames', 'emailProperty'], (result) => {
    if (result.apiKey) {
      document.getElementById('api-key').value = result.apiKey;
    }
    if (result.projectId) {
      document.getElementById('project-id').value = result.projectId;
    }
    if (result.eventNames) {
      document.getElementById('event-names').value = result.eventNames.join('\n');
    }
    if (result.emailProperty) {
      document.getElementById('email-property').value = result.emailProperty;
    }
  });
}

function saveSettings(e) {
  e.preventDefault();

  const apiKey = document.getElementById('api-key').value.trim();
  const projectId = document.getElementById('project-id').value.trim();
  const eventNamesText = document.getElementById('event-names').value.trim();
  const emailProperty = document.getElementById('email-property').value.trim() || 'email_id';

  const eventNames = eventNamesText
    ? eventNamesText.split('\n').map(name => name.trim()).filter(name => name)
    : [];

  chrome.storage.sync.set({
    apiKey,
    projectId,
    eventNames,
    emailProperty
  }, () => {
    showStatus('Settings saved successfully!', 'success');
  });
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status ' + type;

  setTimeout(() => {
    status.className = 'status';
  }, 3000);
}
