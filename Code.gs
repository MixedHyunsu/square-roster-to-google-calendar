/**
 * Square Shifts -> Google Calendar
 *
 * Copies YOUR published Square scheduled shifts into a Google Calendar.
 * Runs entirely inside Google Apps Script. No server needed.
 *
 * Setup: see README.md. All secrets live in Script Properties, never in this file.
 *
 * Not affiliated with or endorsed by Square / Block, Inc.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SQUARE_API_VERSION = '2025-05-21'; // scheduled shifts need >= 2025-05-21
const OAUTH_SCOPES = ['TIMECARDS_READ', 'EMPLOYEES_READ', 'MERCHANT_PROFILE_READ']; // read-only
const EVENT_TAG = 'squareShiftId';
const TOKEN_REFRESH_AFTER_MS = 7 * 24 * 3600 * 1000; // Square recommends refreshing every <= 7 days
const OAUTH_STATE_TTL_MS = 24 * 3600 * 1000;
const LOOKBACK_MS = 12 * 3600 * 1000; // catch shifts that are already in progress
const SYNC_FOOTER = 'Synced from Square Shifts. Edits made here will be overwritten.';

// ---------------------------------------------------------------------------
// Public functions (run these from the Apps Script editor)
// ---------------------------------------------------------------------------

/**
 * Main job. Called by the time-based triggers, or run it manually any time.
 */
function syncRoster() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    console.log('Another sync is already running. Skipping.');
    return;
  }
  try {
    const cfg = getConfig_();
    const calendar = getCalendar_(cfg);
    const now = new Date();
    const from = new Date(now.getTime() - LOOKBACK_MS);
    const to = new Date(now.getTime() + cfg.daysAhead * 24 * 3600 * 1000);

    const memberId = getMyTeamMemberId_(cfg);
    const shifts = fetchMyShifts_(memberId, from, to);

    // Index existing synced events. Search a bit wider than the window so
    // shifts that end after `to` are still found.
    const existing = {};
    calendar
      .getEvents(from, new Date(to.getTime() + 2 * 24 * 3600 * 1000))
      .forEach(function (ev) {
        const id = ev.getTag(EVENT_TAG);
        if (!id) return;
        if (existing[id]) {
          ev.deleteEvent(); // duplicate, keep one
        } else {
          existing[id] = ev;
        }
      });

    let created = 0;
    let updated = 0;
    let deleted = 0;
    const seen = {};

    shifts.forEach(function (shift) {
      seen[shift.id] = true;
      const spec = buildEventSpec_(shift, cfg);
      const ev = existing[shift.id];
      if (!ev) {
        const newEv = calendar.createEvent(spec.title, spec.start, spec.end, {
          description: spec.description,
          location: spec.location,
        });
        newEv.setTag(EVENT_TAG, shift.id);
        created++;
        return;
      }
      if (eventDiffers_(ev, spec)) {
        ev.setTime(spec.start, spec.end);
        ev.setTitle(spec.title);
        ev.setDescription(spec.description);
        ev.setLocation(spec.location);
        updated++;
      }
    });

    // Remove events for shifts that disappeared from Square (deleted or
    // reassigned). Only inside the sync window, so past events stay as history.
    Object.keys(existing).forEach(function (id) {
      if (seen[id]) return;
      const ev = existing[id];
      const start = ev.getStartTime();
      if (start >= from && start <= to) {
        ev.deleteEvent();
        deleted++;
      }
    });

    console.log(
      'Sync done. shifts=%s created=%s updated=%s deleted=%s',
      shifts.length, created, updated, deleted
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * Prints the private link you send to the business owner so they can
 * approve read-only access. Run once after filling in Script Properties.
 */
function printSetupLink() {
  const cfg = getConfig_({ requireConnection: false });
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('SETUP_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('SETUP_KEY', key);
  }
  const link = cfg.redirectUrl + '?setup=' + key;
  console.log('Send this link to the Square account owner:\n' + link);
  console.log('Keep it private. Anyone with it could replace the connected account.');
  return link;
}

/**
 * Checks that everything is wired up and prints what it finds.
 */
function checkConnection() {
  const cfg = getConfig_();
  const memberId = getMyTeamMemberId_(cfg, true);
  const now = new Date();
  const to = new Date(now.getTime() + cfg.daysAhead * 24 * 3600 * 1000);
  const shifts = fetchMyShifts_(memberId, new Date(now.getTime() - LOOKBACK_MS), to);
  console.log('Square connected. Team member ID: %s', memberId);
  console.log('Calendar: %s', getCalendar_(cfg).getName());
  console.log('Published shifts in the next %s days: %s', cfg.daysAhead, shifts.length);
  shifts.slice(0, 10).forEach(function (s) {
    const d = s.published_shift_details;
    console.log('  %s -> %s', d.start_at, d.end_at);
  });
}

/**
 * Creates the daily triggers (default 00:00 and 12:00 in the script time zone).
 * Apps Script fires each one at some point within that hour.
 */
function installTriggers() {
  uninstallTriggers();
  const hours = getConfig_({ requireConnection: false }).syncHours;
  hours.forEach(function (h) {
    ScriptApp.newTrigger('syncRoster').timeBased().everyDays(1).atHour(h).create();
  });
  console.log('Installed daily triggers at hours: %s (%s)', hours.join(', '), Session.getScriptTimeZone());
}

/** Removes the sync triggers. */
function uninstallTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncRoster') ScriptApp.deleteTrigger(t);
  });
}

/**
 * Revokes the Square connection and forgets the tokens.
 * Synced calendar events are kept; run removeSyncedEvents() to delete them.
 */
function disconnectSquare() {
  const cfg = getConfig_({ requireConnection: false });
  const props = PropertiesService.getScriptProperties();
  const access = props.getProperty('SQUARE_ACCESS_TOKEN');
  if (access) {
    try {
      UrlFetchApp.fetch(cfg.baseUrl + '/oauth2/revoke', {
        method: 'post',
        contentType: 'application/json',
        headers: {
          Authorization: 'Client ' + cfg.appSecret,
          'Square-Version': SQUARE_API_VERSION,
        },
        payload: JSON.stringify({ client_id: cfg.appId, access_token: access }),
        muteHttpExceptions: true,
      });
    } catch (err) {
      console.warn('Revoke call failed (tokens are still forgotten locally): ' + err);
    }
  }
  [
    'SQUARE_ACCESS_TOKEN', 'SQUARE_REFRESH_TOKEN', 'SQUARE_TOKEN_EXPIRES_AT',
    'SQUARE_TOKEN_OBTAINED_AT', 'SQUARE_MERCHANT_ID', 'MY_TEAM_MEMBER_ID',
    'MY_TEAM_MEMBER_EMAIL', 'SETUP_KEY', 'OAUTH_STATE', 'OAUTH_STATE_CREATED',
  ].forEach(function (k) { props.deleteProperty(k); });
  uninstallTriggers();
  console.log('Disconnected from Square and removed triggers.');
}

/** Deletes every synced shift event from now until one year ahead. */
function removeSyncedEvents() {
  const cfg = getConfig_({ requireConnection: false });
  const cal = getCalendar_(cfg);
  const now = new Date();
  const end = new Date(now.getTime() + 366 * 24 * 3600 * 1000);
  let n = 0;
  cal.getEvents(now, end).forEach(function (ev) {
    if (ev.getTag(EVENT_TAG)) { ev.deleteEvent(); n++; }
  });
  console.log('Removed %s synced events.', n);
}

// ---------------------------------------------------------------------------
// Web app: OAuth consent page + callback
// ---------------------------------------------------------------------------

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.code || params.error) return handleOAuthCallback_(params);

  const props = PropertiesService.getScriptProperties();
  const setupKey = props.getProperty('SETUP_KEY');
  if (!setupKey || params.setup !== setupKey) {
    return page_('Not found', '<p>Nothing to see here.</p>');
  }

  const cfg = getConfig_({ requireConnection: false });
  const state = makeState_(setupKey);
  console.log('Approval page opened.');

  const authUrl = cfg.baseUrl + '/oauth2/authorize?' + toQuery_({
    client_id: cfg.appId,
    scope: OAUTH_SCOPES.join(' '),
    session: 'false',
    state: state,
    redirect_uri: cfg.redirectUrl,
  });

  const body =
    '<p>A team member wants to copy <b>their own</b> scheduled shifts from Square into their personal calendar.</p>' +
    '<p>This asks for <b>read-only</b> access to:</p>' +
    '<ul><li>Scheduled shifts</li><li>Team member names, emails and job titles (to find the right person)</li>' +
    '<li>Location name and address (shown on the calendar event)</li></ul>' +
    '<p>It cannot change schedules, see payments or touch anything else. ' +
    'You can disconnect it any time from the connected apps section of your Square account.</p>' +
    '<p><a class="btn" href="' + escapeHtml_(authUrl) + '" target="_top">Continue to Square</a></p>';
  return page_('Connect Square shifts', body);
}

function handleOAuthCallback_(params) {
  if (params.error) {
    console.warn('OAuth callback: Square returned error: %s %s', params.error, params.error_description || '');
    return page_('Not connected',
      '<p>Square returned: ' + escapeHtml_(params.error_description || params.error) + '</p>');
  }
  const props = PropertiesService.getScriptProperties();
  const stateCheck = verifyState_(params.state, props.getProperty('SETUP_KEY'));
  if (stateCheck !== 'ok') {
    console.warn('OAuth callback rejected: state %s', stateCheck);
    return page_('Link expired',
      '<p>This approval link is invalid or expired. Please reopen the link you were sent and try again.</p>');
  }

  const cfg = getConfig_({ requireConnection: false });
  try {
    const token = requestToken_(cfg, {
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: cfg.redirectUrl,
    });
    saveToken_(token);
    props.deleteProperty('MY_TEAM_MEMBER_ID'); // re-resolve against the new account
  } catch (err) {
    console.error('OAuth callback: token exchange failed: ' + (err.message || err));
    return page_('Something went wrong', '<p>' + escapeHtml_(String(err.message || err)) + '</p>');
  }
  console.log('OAuth callback: Square connected and tokens saved.');
  return page_('Connected', '<p>Done. Square is connected. You can close this page.</p>');
}

/**
 * Stateless OAuth state: "<timestamp>.<HMAC(timestamp, SETUP_KEY)>".
 * Nothing is stored, so reopening the approval page never invalidates an
 * earlier one, and retries after a Square error still work.
 */
function makeState_(setupKey) {
  const ts = String(Date.now());
  return ts + '.' + signState_(ts, setupKey);
}

function verifyState_(state, setupKey) {
  if (!setupKey) return 'no-setup-key';
  const parts = String(state || '').split('.');
  if (parts.length !== 2) return 'malformed';
  if (signState_(parts[0], setupKey) !== parts[1]) return 'bad-signature';
  const age = Date.now() - Number(parts[0]);
  if (!(age >= 0 && age <= OAUTH_STATE_TTL_MS)) return 'expired';
  return 'ok';
}

function signState_(value, key) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(value, key)).replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Square API
// ---------------------------------------------------------------------------

function requestToken_(cfg, body) {
  const payload = Object.assign({ client_id: cfg.appId, client_secret: cfg.appSecret }, body);
  const res = UrlFetchApp.fetch(cfg.baseUrl + '/oauth2/token', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Square-Version': SQUARE_API_VERSION },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const data = parseJson_(res.getContentText());
  if (res.getResponseCode() !== 200 || !data.access_token) {
    throw new Error('Square token request failed (' + res.getResponseCode() + '): ' + describeErrors_(data));
  }
  return data;
}

function saveToken_(token) {
  const props = PropertiesService.getScriptProperties();
  const values = {
    SQUARE_ACCESS_TOKEN: token.access_token,
    SQUARE_TOKEN_EXPIRES_AT: token.expires_at || '',
    SQUARE_TOKEN_OBTAINED_AT: String(Date.now()),
    SQUARE_MERCHANT_ID: token.merchant_id || '',
  };
  if (token.refresh_token) values.SQUARE_REFRESH_TOKEN = token.refresh_token;
  props.setProperties(values);
}

function getAccessToken_(cfg) {
  const props = PropertiesService.getScriptProperties();
  const access = props.getProperty('SQUARE_ACCESS_TOKEN');
  if (!access) {
    throw new Error('Square is not connected yet. Run printSetupLink() and have the owner approve access.');
  }
  const obtainedAt = Number(props.getProperty('SQUARE_TOKEN_OBTAINED_AT') || 0);
  if (Date.now() - obtainedAt < TOKEN_REFRESH_AFTER_MS) return access;

  const refresh = props.getProperty('SQUARE_REFRESH_TOKEN');
  if (!refresh) throw new Error('No refresh token stored. Reconnect Square with printSetupLink().');
  const token = requestToken_(cfg, { grant_type: 'refresh_token', refresh_token: refresh });
  saveToken_(token);
  console.log('Refreshed Square access token.');
  return token.access_token;
}

function squareRequest_(cfg, method, path, body) {
  const options = {
    method: method,
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + getAccessToken_(cfg),
      'Square-Version': SQUARE_API_VERSION,
    },
    muteHttpExceptions: true,
  };
  if (body) options.payload = JSON.stringify(body);

  const res = UrlFetchApp.fetch(cfg.baseUrl + path, options);
  const code = res.getResponseCode();
  const data = parseJson_(res.getContentText());
  if (code === 401) {
    throw new Error('Square rejected the token (401). The owner may have disconnected the app. ' +
      'Run printSetupLink() to reconnect. ' + describeErrors_(data));
  }
  if (code < 200 || code >= 300) {
    throw new Error('Square ' + method.toUpperCase() + ' ' + path + ' failed (' + code + '): ' + describeErrors_(data));
  }
  return data;
}

/** Finds your team member ID by email and caches it. */
function getMyTeamMemberId_(cfg, forceRefresh) {
  const props = PropertiesService.getScriptProperties();
  const cachedId = props.getProperty('MY_TEAM_MEMBER_ID');
  const cachedEmail = props.getProperty('MY_TEAM_MEMBER_EMAIL');
  if (!forceRefresh && cachedId && cachedEmail === cfg.myEmail) return cachedId;

  let cursor = null;
  do {
    const body = { query: { filter: { status: 'ACTIVE' } }, limit: 200 };
    if (cursor) body.cursor = cursor;
    const data = squareRequest_(cfg, 'post', '/v2/team-members/search', body);
    const members = data.team_members || [];
    for (let i = 0; i < members.length; i++) {
      if ((members[i].email_address || '').trim().toLowerCase() === cfg.myEmail) {
        props.setProperties({ MY_TEAM_MEMBER_ID: members[i].id, MY_TEAM_MEMBER_EMAIL: cfg.myEmail });
        return members[i].id;
      }
    }
    cursor = data.cursor;
  } while (cursor);

  throw new Error('No active team member with email "' + cfg.myEmail + '". ' +
    'Set MY_SQUARE_EMAIL to the email your employer has on file for you in Square.');
}

/** Returns your published, non-deleted shifts that start inside [from, to]. */
function fetchMyShifts_(memberId, from, to) {
  const cfg = getConfig_();
  const shifts = [];
  let cursor = null;
  do {
    const body = {
      query: {
        filter: {
          team_member_ids: [memberId],
          assignment_status: 'ASSIGNED',
          scheduled_shift_statuses: ['PUBLISHED'],
          start: { start_at: from.toISOString(), end_at: to.toISOString() },
        },
        sort: { field: 'START_AT', order: 'ASC' },
      },
      limit: 50,
    };
    if (cursor) body.cursor = cursor;
    const data = squareRequest_(cfg, 'post', '/v2/labor/scheduled-shifts/search', body);
    Array.prototype.push.apply(shifts, data.scheduled_shifts || []);
    cursor = data.cursor;
  } while (cursor);

  return shifts.filter(function (s) {
    const d = s.published_shift_details;
    return d && !d.is_deleted && d.team_member_id === memberId && d.start_at && d.end_at;
  });
}

function getJobTitle_(cfg, jobId) {
  return cached_('job:' + jobId, function () {
    try {
      const data = squareRequest_(cfg, 'get', '/v2/team-members/jobs/' + encodeURIComponent(jobId));
      return (data.job && data.job.title) || '';
    } catch (err) {
      console.warn('Could not load job title: ' + err);
      return '';
    }
  });
}

function getLocation_(cfg, locationId) {
  const raw = cached_('loc:' + locationId, function () {
    try {
      const data = squareRequest_(cfg, 'get', '/v2/locations/' + encodeURIComponent(locationId));
      const loc = data.location || {};
      const a = loc.address || {};
      const address = [a.address_line_1, a.address_line_2, a.locality, a.administrative_district_level_1, a.postal_code]
        .filter(Boolean).join(', ');
      return JSON.stringify({ name: loc.name || '', address: address });
    } catch (err) {
      console.warn('Could not load location: ' + err);
      return JSON.stringify({ name: '', address: '' });
    }
  });
  return parseJson_(raw);
}

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

function buildEventSpec_(shift, cfg) {
  const d = shift.published_shift_details;
  const job = d.job_id ? getJobTitle_(cfg, d.job_id) : '';
  const loc = d.location_id ? getLocation_(cfg, d.location_id) : { name: '', address: '' };

  let title = cfg.eventTitle || loc.name || 'Work';
  if (job) title += ' (' + job + ')';

  const notes = (d.notes || '').trim();
  return {
    title: title,
    start: new Date(d.start_at),
    end: new Date(d.end_at),
    description: (notes ? notes + '\n\n' : '') + SYNC_FOOTER,
    location: loc.address || loc.name || '',
  };
}

function eventDiffers_(ev, spec) {
  return ev.getStartTime().getTime() !== spec.start.getTime() ||
    ev.getEndTime().getTime() !== spec.end.getTime() ||
    ev.getTitle() !== spec.title ||
    ev.getDescription() !== spec.description ||
    ev.getLocation() !== spec.location;
}

function getCalendar_(cfg) {
  if (cfg.calendarId === 'primary') return CalendarApp.getDefaultCalendar();
  const cal = CalendarApp.getCalendarById(cfg.calendarId);
  if (!cal) throw new Error('Calendar not found: ' + cfg.calendarId + '. Check CALENDAR_ID.');
  return cal;
}

// ---------------------------------------------------------------------------
// Config & utilities
// ---------------------------------------------------------------------------

function getConfig_(opts) {
  const p = PropertiesService.getScriptProperties();
  const env = (p.getProperty('SQUARE_ENVIRONMENT') || 'production').trim().toLowerCase();
  const cfg = {
    appId: (p.getProperty('SQUARE_APPLICATION_ID') || '').trim(),
    appSecret: (p.getProperty('SQUARE_APPLICATION_SECRET') || '').trim(),
    redirectUrl: (p.getProperty('REDIRECT_URL') || '').trim(),
    myEmail: (p.getProperty('MY_SQUARE_EMAIL') || '').trim().toLowerCase(),
    calendarId: (p.getProperty('CALENDAR_ID') || 'primary').trim(),
    daysAhead: parseInt(p.getProperty('SYNC_DAYS_AHEAD') || '28', 10),
    syncHours: (p.getProperty('SYNC_HOURS') || '0,12').split(',')
      .map(function (h) { return parseInt(h.trim(), 10); })
      .filter(function (h) { return h >= 0 && h <= 23; }),
    eventTitle: (p.getProperty('EVENT_TITLE') || '').trim(),
    baseUrl: env === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com',
  };

  const missing = [];
  if (!cfg.appId) missing.push('SQUARE_APPLICATION_ID');
  if (!cfg.appSecret) missing.push('SQUARE_APPLICATION_SECRET');
  if (!cfg.redirectUrl) missing.push('REDIRECT_URL');
  if (!cfg.myEmail) missing.push('MY_SQUARE_EMAIL');
  if (missing.length) {
    throw new Error('Missing Script Properties: ' + missing.join(', ') + '. See README.md.');
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(cfg.redirectUrl)) {
    throw new Error('REDIRECT_URL should be your web app URL ending in /exec.');
  }
  if (!(cfg.daysAhead > 0 && cfg.daysAhead <= 180)) cfg.daysAhead = 28;
  if (!cfg.syncHours.length) cfg.syncHours = [0, 12];
  return cfg;
}

function cached_(key, loader) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit !== null) return hit;
  const value = loader();
  cache.put(key, value, 6 * 3600); // 6 hours
  return value;
}

function parseJson_(text) {
  try { return JSON.parse(text || '{}'); } catch (err) { return {}; }
}

function describeErrors_(data) {
  if (data && data.errors && data.errors.length) {
    return data.errors.map(function (e) { return e.code + ': ' + (e.detail || ''); }).join('; ');
  }
  if (data && (data.message || data.type)) return (data.type || '') + ' ' + (data.message || '');
  return 'no error details';
}

function toQuery_(obj) {
  return Object.keys(obj).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]);
  }).join('&');
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function page_(title, bodyHtml) {
  const html =
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font:16px/1.5 system-ui,-apple-system,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#1f2328}' +
    'h1{font-size:22px}.btn{display:inline-block;background:#1a73e8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none}</style>' +
    '</head><body><h1>' + escapeHtml_(title) + '</h1>' + bodyHtml + '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(title);
}
