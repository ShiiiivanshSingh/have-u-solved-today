/* ── Alarm setup ─────────────────────────────────────────── */
function setupAlarms() {
  chrome.alarms.create('dailyReminder', { when: getNextReminderTime(), periodInMinutes: 1440 });
  chrome.alarms.create('autoRefresh',   { periodInMinutes: 120 });
  // Poll every 30 min: celebrate solve + nag if unsolved during 14:00–23:59
  chrome.alarms.create('solvePoller',   { periodInMinutes: 30 });
}

chrome.runtime.onInstalled.addListener(setupAlarms);
chrome.runtime.onStartup.addListener(setupAlarms);

/* ── Alarm handler ───────────────────────────────────────── */
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'autoRefresh') {
    await chrome.storage.local.remove(['cache_' + getTodayKey(), 'historyBackfilled']);
    return;
  }
  if (alarm.name === 'solvePoller') {
    await checkSolveStatus();
    return;
  }
  if (alarm.name === 'dailyReminder') {
    // Handled by solvePoller now — just reschedule
    chrome.alarms.create('dailyReminder', { when: getNextReminderTime(), periodInMinutes: 1440 });
  }
});

/* ── Core poller: solve celebration + unsolved nag ───────── */
async function checkSolveStatus() {
  const stored = await chrome.storage.local.get([
    'lcUsername', 'cfHandle',
    'lastSolveNotifyDate',  // date string: prevent duplicate "solved" notif
    'lastNagTime'           // timestamp ms: throttle nag to once per hour
  ]);
  const today   = getTodayKey();
  const now     = new Date();
  const hour    = now.getHours(); // 0-23 local time

  const lcUsername = stored.lcUsername?.trim();
  const cfHandle   = stored.cfHandle?.trim();
  if (!lcUsername && !cfHandle) return;

  const start = Math.floor(new Date(today + 'T00:00:00').getTime() / 1000);
  let lcSolved = false, cfSolved = false;
  let lcTitle  = '', cfTitle = '';

  /* ── Check LC ── */
  try {
    if (lcUsername) {
      const r = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Referer': 'https://leetcode.com' },
        body: JSON.stringify({
          query: `query recentAcSubmissions($username:String!,$limit:Int!){recentAcSubmissionList(username:$username,limit:$limit){timestamp title}}`,
          variables: { username: lcUsername, limit: 5 }
        })
      });
      const subs = (await r.json())?.data?.recentAcSubmissionList || [];
      const sub = subs.find(s => parseInt(s.timestamp) >= start);
      if (sub) { lcSolved = true; lcTitle = sub.title; }
    }
  } catch {}

  /* ── Check CF ── */
  try {
    if (cfHandle) {
      const r = await fetch(`https://codeforces.com/api/user.status?handle=${cfHandle}&from=1&count=10`);
      const d = await r.json();
      if (d.status === 'OK') {
        const s = d.result.find(s => s.verdict === 'OK' && s.creationTimeSeconds >= start);
        if (s) { cfSolved = true; cfTitle = `${s.problem.contestId}${s.problem.index} - ${s.problem.name}`; }
      }
    }
  } catch {}

  const anySolved = lcSolved || cfSolved;

  /* ── 🎉 Congrats notification (once per day on first solve) ── */
  if (anySolved && stored.lastSolveNotifyDate !== today) {
    let msg = '';
    if (lcSolved && cfSolved) msg = `LC: ${lcTitle} + CF: ${cfTitle}`;
    else if (lcSolved) msg = `✅ LC: ${lcTitle}`;
    else msg = `✅ CF: ${cfTitle}`;

    chrome.notifications.create('solve_congrats', {
      type: 'basic', iconUrl: 'icons/icon128.png',
      title: 'Problem Solved! 🎉', message: msg, priority: 2
    });
    await chrome.storage.local.set({ lastSolveNotifyDate: today });
    return; // no nag needed — they solved!
  }

  /* ── ⏰ Nag notification: only between 14:00 and 23:59 ──────
       Fires at most once per hour to avoid spam.
  ─────────────────────────────────────────────────────────── */
  if (!anySolved && hour >= 14 && hour <= 23) {
    const lastNag = stored.lastNagTime || 0;
    const msSinceLastNag = Date.now() - lastNag;
    const ONE_HOUR_MS = 60 * 60 * 1000;

    if (msSinceLastNag >= ONE_HOUR_MS) {
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const platforms = [lcUsername && 'LeetCode', cfHandle && 'Codeforces'].filter(Boolean).join(' & ');

      chrome.notifications.create('unsolved_nag', {
        type: 'basic', iconUrl: 'icons/icon128.png',
        title: `⏰ Still unsolved — it's ${timeStr}`,
        message: `You haven't solved on ${platforms} today. Your streak is at risk!`,
        priority: 1
      });
      await chrome.storage.local.set({ lastNagTime: Date.now() });
    }
  }
}

/* ── Helpers ─────────────────────────────────────────────── */
function getTodayKey() { return new Date().toLocaleDateString('en-CA'); }

function getNextReminderTime() {
  const now = new Date(), t = new Date();
  t.setHours(20, 0, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t.getTime();
}
