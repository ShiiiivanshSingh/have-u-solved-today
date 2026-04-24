const $ = id => document.getElementById(id);

/* ── Date helpers ───────────────────────────────────────────── */
function getTodayKey() { return new Date().toLocaleDateString('en-CA'); }
function formatDateLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}
function getLast14Days() {
  const days = [], today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    days.push(d.toLocaleDateString('en-CA'));
  }
  return days;
}
function getCurrentMonthDays() {
  const t = new Date(), y = t.getFullYear(), m = t.getMonth();
  const n = new Date(y, m + 1, 0).getDate(), days = [];
  for (let i = 1; i <= n; i++) days.push(new Date(y, m, i).toLocaleDateString('en-CA'));
  return days;
}
function timestampToDateKey(ts) { return new Date(ts * 1000).toLocaleDateString('en-CA'); }
function timeAgo(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

/* ── Storage cleanup ────────────────────────────────────────── */
async function pruneOldCache() {
  const all = await chrome.storage.local.get(null);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  const co = cutoff.toLocaleDateString('en-CA');
  const stale = Object.keys(all).filter(k => k.startsWith('cache_') && k.slice(6) < co);
  if (stale.length) await chrome.storage.local.remove(stale);
}

/* ── API: LeetCode history (returns Map<dateKey, count>) ────── */
async function fetchLCSubmissionHistory(username) {
  try {
    const gql = year => ({
      query: `query userProfileCalendar($username:String!,$year:Int){matchedUser(username:$username){userCalendar(year:$year){submissionCalendar}}}`,
      variables: { username, year }
    });
    const post = async y => {
      const r = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Referer': 'https://leetcode.com' },
        body: JSON.stringify(gql(y))
      });
      return (await r.json())?.data?.matchedUser?.userCalendar?.submissionCalendar;
    };
    const yr = new Date().getFullYear();
    const [cur, prev] = await Promise.all([post(yr), post(yr - 1)]);
    const map = new Map();
    for (const s of [cur, prev]) {
      if (!s) continue;
      for (const [ts, cnt] of Object.entries(JSON.parse(s))) {
        const c = parseInt(cnt);
        if (c > 0) { const k = timestampToDateKey(parseInt(ts)); map.set(k, (map.get(k) || 0) + c); }
      }
    }
    return map;
  } catch { return new Map(); }
}

/* ── API: Codeforces history (returns Map<dateKey, count>) ───── */
async function fetchCFSubmissionHistory(handle) {
  try {
    const r = await fetch(`https://codeforces.com/api/user.status?handle=${handle}&from=1&count=10000`);
    const d = await r.json();
    if (d.status !== 'OK') return new Map();
    const map = new Map();
    for (const s of d.result) {
      if (s.verdict === 'OK') { const k = timestampToDateKey(s.creationTimeSeconds); map.set(k, (map.get(k) || 0) + 1); }
    }
    return map;
  } catch { return new Map(); }
}

/* ── Backfill ────────────────────────────────────────────────── */
async function backfillHistory(lcUsername, cfHandle, streakData) {
  let changed = false;
  const today = getTodayKey();
  const [lcMap, cfMap] = await Promise.all([
    lcUsername ? fetchLCSubmissionHistory(lcUsername) : Promise.resolve(new Map()),
    cfHandle ? fetchCFSubmissionHistory(cfHandle) : Promise.resolve(new Map())
  ]);
  for (let i = 400; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('en-CA');
    if (key === today) continue;
    const lcCount = lcMap.get(key) || 0, cfCount = cfMap.get(key) || 0;
    const existing = streakData[key];
    const hasReal = existing && (existing.lc === true || existing.cf === true);
    if (!hasReal && (lcCount > 0 || cfCount > 0)) {
      streakData[key] = { lc: lcCount > 0, cf: cfCount > 0, lcCount, cfCount, backfilled: true };
      changed = true;
    }
  }
  return changed;
}

/* ── API: Today's status ─────────────────────────────────────── */
async function fetchLeetCodeStatus(username) {
  try {
    const today = getTodayKey();
    const start = Math.floor(new Date(today + 'T00:00:00').getTime() / 1000);
    const r = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Referer': 'https://leetcode.com' },
      body: JSON.stringify({
        query: `query recentAcSubmissions($username:String!,$limit:Int!){recentAcSubmissionList(username:$username,limit:$limit){timestamp title titleSlug}}`,
        variables: { username, limit: 20 }
      })
    });
    const subs = (await r.json())?.data?.recentAcSubmissionList || [];
    const today_ = subs.filter(s => parseInt(s.timestamp) >= start);
    if (today_.length) return { solved: true, problemTitle: today_[0].title, problemSlug: today_[0].titleSlug, count: today_.length };
    return { solved: false };
  } catch { return null; }
}

async function fetchCodeforcesStatus(handle) {
  try {
    const today = getTodayKey();
    const start = Math.floor(new Date(today + 'T00:00:00').getTime() / 1000);
    const r = await fetch(`https://codeforces.com/api/user.status?handle=${handle}&from=1&count=30`);
    const d = await r.json();
    if (d.status !== 'OK') return null;
    const ts = d.result.filter(s => s.verdict === 'OK' && s.creationTimeSeconds >= start);
    if (ts.length) {
      const s = ts[0];
      return { solved: true, problemTitle: `${s.problem.contestId}${s.problem.index} - ${s.problem.name}`, contestId: s.problem.contestId, problemIndex: s.problem.index, count: ts.length };
    }
    return { solved: false };
  } catch { return null; }
}

/* ── API: Contest ratings ────────────────────────────────────── */
async function fetchLCRating(username) {
  try {
    const r = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Referer': 'https://leetcode.com' },
      body: JSON.stringify({
        query: `query userContestRanking($username:String!){userContestRanking(username:$username){rating attendedContestsCount globalRanking}}`,
        variables: { username }
      })
    });
    const rank = (await r.json())?.data?.userContestRanking;
    if (!rank?.attendedContestsCount) return null;
    return { rating: Math.round(rank.rating), attended: rank.attendedContestsCount };
  } catch { return null; }
}

async function fetchCFRating(handle) {
  try {
    const r = await fetch(`https://codeforces.com/api/user.info?handles=${handle}`);
    const d = await r.json();
    if (d.status !== 'OK') return null;
    const u = d.result[0];
    if (!u.rating) return null;
    return { rating: u.rating, maxRating: u.maxRating, rank: u.rank };
  } catch { return null; }
}

/* ── Hint fetchers ───────────────────────────────────────────── */
async function fetchLCHint(username) {
  try {
    const r = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Referer': 'https://leetcode.com' },
      body: JSON.stringify({
        query: `query getUserProfile($username:String!){matchedUser(username:$username){submitStats{acSubmissionNum{difficulty count}}profile{ranking}}}`,
        variables: { username }
      })
    });
    const stats = (await r.json())?.data?.matchedUser?.submitStats?.acSubmissionNum || [];
    const easy = stats.find(s => s.difficulty === 'Easy')?.count || 0;
    const medium = stats.find(s => s.difficulty === 'Medium')?.count || 0;
    const hard = stats.find(s => s.difficulty === 'Hard')?.count || 0;
    if (hard < 50) return `You've solved ${hard} Hard problems. Push harder today!`;
    return `${easy + medium + hard} solved (E:${easy} M:${medium} H:${hard}). Keep it up!`;
  } catch { return null; }
}

async function fetchCFHint(handle) {
  try {
    const r = await fetch(`https://codeforces.com/api/user.info?handles=${handle}`);
    const d = await r.json();
    const u = d?.result?.[0];
    if (u?.rating) return `CF rating: ${u.rating} (peak ${u.maxRating}). Stay consistent!`;
    return null;
  } catch { return null; }
}

/* ── Platform / heat helpers ─────────────────────────────────── */
function getPlatformForDay(streakData, key) {
  const d = streakData[key];
  if (!d || d === false) return null;
  if (typeof d === 'object') {
    if (d.lc && d.cf) return 'both';
    if (d.lc) return 'lc';
    if (d.cf) return 'cf';
  }
  if (d === true) return 'both';
  return null;
}

function getHeatLevel(count) {
  if (!count || count <= 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

function isSolvedDay(val) {
  if (!val) return false;
  if (val === true) return true;
  if (typeof val === 'object') return val.lc === true || val.cf === true;
  return false;
}

/* ── Card UI ─────────────────────────────────────────────────── */
function setCardState(platform, result, fromCache, fetchedAt) {
  const icon = $(platform + '-icon');
  const text = $(platform + '-text');
  const card = $(platform + '-card');
  const sub  = $(platform + '-problem');
  const retry = $(platform + '-retry');
  const lastUp = $('last-updated');

  card.classList.remove('solved', 'unsolved');
  if (retry) retry.classList.add('hidden');

  if (result === null) {
    icon.textContent = '⚠';
    text.textContent = 'Failed';
    text.className = 'status-text';
    if (retry) retry.classList.remove('hidden');
    if (sub) { sub.textContent = ''; sub.removeAttribute('href'); }
  } else if (result?.solved) {
    icon.textContent = '✅';
    text.textContent = 'Solved today';
    text.className = 'status-text solved';
    card.classList.add('solved');
    if (sub && result.problemTitle) {
      sub.textContent = result.problemTitle;
      if (platform === 'lc' && result.problemSlug) sub.href = `https://leetcode.com/problems/${result.problemSlug}/`;
      else if (platform === 'cf' && result.contestId) sub.href = `https://codeforces.com/contest/${result.contestId}/problem/${result.problemIndex}`;
    }
  } else {
    icon.textContent = '❌';
    text.textContent = 'Not solved';
    text.className = 'status-text unsolved';
    card.classList.add('unsolved');
    if (sub) { sub.textContent = ''; sub.removeAttribute('href'); }
  }

  if (fromCache && fetchedAt && lastUp) {
    lastUp.textContent = `Updated ${timeAgo(fetchedAt)}`;
  }
}

function setCardLoading(platform) {
  $(platform + '-icon').innerHTML = '<span class="loading-spin">↻</span>';
  $(platform + '-text').textContent = 'Checking…';
  $(platform + '-text').className = 'status-text';
}

function setRatingBadge(platform, data) {
  const el = $(platform + '-rating');
  if (!el) return;
  if (!data) { el.textContent = ''; el.className = 'rating-badge'; return; }
  if (platform === 'lc') {
    el.textContent = `⬡ ${data.rating}`;
    el.title = `${data.attended} contests`;
  } else {
    el.textContent = `◆ ${data.rating}`;
    el.title = `Peak: ${data.maxRating} · ${data.rank}`;
  }
  el.className = `rating-badge ${platform}`;
}

/* ── Calendar render ─────────────────────────────────────────── */
function renderCalendar(streakData) {
  const cal = $('calendar');
  cal.innerHTML = '';
  const today = getTodayKey();
  const todayDate = new Date(today + 'T12:00:00');
  const year = todayDate.getFullYear(), month = todayDate.getMonth();

  // Month label
  const lbl = document.createElement('div');
  lbl.className = 'cal-month-label';
  lbl.textContent = todayDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  cal.appendChild(lbl);

  // Weekday headers
  ['M','T','W','T','F','S','S'].forEach(d => {
    const h = document.createElement('div');
    h.className = 'cal-header'; h.textContent = d;
    cal.appendChild(h);
  });

  // Blank offset (Mon=0)
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  for (let i = 0; i < offset; i++) {
    const b = document.createElement('div');
    b.className = 'cal-day cal-blank'; cal.appendChild(b);
  }

  getCurrentMonthDays().forEach(key => {
    const isFuture = key > today;
    const div = document.createElement('div');
    div.className = 'cal-day';
    div.title = key;
    div.textContent = new Date(key + 'T12:00:00').getDate();

    if (isFuture) { div.classList.add('future'); cal.appendChild(div); return; }

    const platform = getPlatformForDay(streakData, key);
    const d = streakData[key];

    if (key === today) div.classList.add('today');

    if (platform) {
      div.classList.add('solved', `solved-${platform}`);
      // Heatmap intensity
      const count = d ? (d.lcCount || 0) + (d.cfCount || 0) : 1;
      div.classList.add(`heat-${getHeatLevel(count)}`);
      // Tooltip content
      const parts = [];
      if (d?.lc && d?.lcCount) parts.push(`LC ×${d.lcCount}`);
      else if (d?.lc) parts.push('LC');
      if (d?.cf && d?.cfCount) parts.push(`CF ×${d.cfCount}`);
      else if (d?.cf) parts.push('CF');
      if (parts.length) div.dataset.tooltip = parts.join(' + ');
    } else if (key < today && streakData[key] !== undefined) {
      const wasSolved = d && (d === true || d.lc || d.cf);
      if (!wasSolved) div.classList.add('missed');
    }

    cal.appendChild(div);
  });
}

/* ── Streak + stats computation ──────────────────────────────── */
function computeStreak(streakData) {
  const today = getTodayKey();
  let streak = 0;
  if (isSolvedDay(streakData[today])) streak++;
  let check = new Date(today + 'T12:00:00');
  check.setDate(check.getDate() - 1);
  while (true) {
    const k = check.toLocaleDateString('en-CA');
    if (!(k in streakData)) break;
    if (isSolvedDay(streakData[k])) streak++;
    else break;
    check.setDate(check.getDate() - 1);
  }

  const last14 = getLast14Days();
  let missed = 0;
  for (const d of last14.filter(d => d < today))
    if (d in streakData && !isSolvedDay(streakData[d])) missed++;

  return { streak, missed };
}

function computeMonthProgress(streakData) {
  const today = getTodayKey();
  const days = getCurrentMonthDays();
  const past = days.filter(d => d <= today);
  const solved = past.filter(d => isSolvedDay(streakData[d])).length;
  return { solved, total: past.length, daysInMonth: days.length };
}

function getStreakClass(n) {
  if (n >= 365) return 'legendary';
  if (n >= 100) return 'epic';
  if (n >= 30) return 'fire';
  if (n >= 7) return 'good';
  return '';
}
function getStreakEmoji(n) {
  if (n >= 365) return '👑';
  if (n >= 100) return '🔥';
  if (n >= 30) return '⚡';
  if (n >= 7) return '✨';
  return '';
}

/* ── Tooltip ─────────────────────────────────────────────────── */
function initTooltip() {
  const cal = $('calendar'), tip = $('cal-tooltip');
  if (!cal || !tip) return;
  cal.addEventListener('mouseover', e => {
    const cell = e.target.closest('.cal-day[data-tooltip]');
    if (!cell) { tip.style.opacity = '0'; return; }
    tip.textContent = cell.dataset.tooltip;
    tip.style.opacity = '1';
  });
  cal.addEventListener('mouseleave', () => { tip.style.opacity = '0'; });
  document.addEventListener('mousemove', e => {
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top  = (e.clientY - 32) + 'px';
    if (!e.target.closest('.cal-day[data-tooltip]')) tip.style.opacity = '0';
  });
}

/* ── Legend toggle ───────────────────────────────────────────── */
function initLegendToggle() {
  const cal = $('calendar');
  [['legend-lc','hide-lc'],['legend-cf','hide-cf'],['legend-both','hide-both']].forEach(([id, cls]) => {
    const el = $(id); if (!el) return;
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      el.classList.toggle('dimmed');
      cal.classList.toggle(cls);
    });
  });
}

/* ── Hints ───────────────────────────────────────────────────── */
async function showHints(lcUsername, cfHandle, lcResult, cfResult) {
  const el = $('hint-text'); if (!el) return;
  if (lcResult?.solved && cfResult?.solved) {
    el.textContent = '🎯 Both platforms conquered today. Legendary!'; return;
  }
  let hint = null;
  if (!lcResult?.solved && lcUsername) hint = await fetchLCHint(lcUsername);
  if (!hint && !cfResult?.solved && cfHandle) hint = await fetchCFHint(cfHandle);
  el.textContent = hint ? '💡 ' + hint : "⏰ Day's not over yet. Go solve something!";
}

/* ── Main checks ─────────────────────────────────────────────── */
async function runChecks(lcUsername, cfHandle, forceRefresh = false) {
  const today = getTodayKey();
  const cacheKey = 'cache_' + today;
  const stored = await chrome.storage.local.get([cacheKey, 'streakData', 'historyBackfilled', 'bestStreak']);
  const cache = stored[cacheKey] || {};
  let streakData = stored.streakData || {};
  let bestStreak = stored.bestStreak || 0;

  if (!stored.historyBackfilled || forceRefresh) {
    const changed = await backfillHistory(lcUsername, cfHandle, streakData);
    if (changed || !stored.historyBackfilled)
      await chrome.storage.local.set({ streakData, historyBackfilled: true });
  }

  let lcResult = null, cfResult = null;
  let lcRating = null, cfRating = null;
  const fromCache = !forceRefresh && cache.lcResult !== undefined;

  // Status
  if (!forceRefresh && cache.lcResult !== undefined) {
    lcResult = cache.lcResult; setCardState('lc', lcResult, true, cache.fetchedAt);
  } else if (lcUsername) {
    setCardLoading('lc'); lcResult = await fetchLeetCodeStatus(lcUsername); setCardState('lc', lcResult);
  } else setCardState('lc', null);

  if (!forceRefresh && cache.cfResult !== undefined) {
    cfResult = cache.cfResult; setCardState('cf', cfResult, true, cache.fetchedAt);
  } else if (cfHandle) {
    setCardLoading('cf'); cfResult = await fetchCodeforcesStatus(cfHandle); setCardState('cf', cfResult);
  } else setCardState('cf', null);

  // Ratings (cached separately in the daily cache)
  if (!forceRefresh && cache.lcRating !== undefined) {
    lcRating = cache.lcRating;
  } else if (lcUsername) {
    lcRating = await fetchLCRating(lcUsername);
  }
  if (!forceRefresh && cache.cfRating !== undefined) {
    cfRating = cache.cfRating;
  } else if (cfHandle) {
    cfRating = await fetchCFRating(cfHandle);
  }
  setRatingBadge('lc', lcRating);
  setRatingBadge('cf', cfRating);

  // Update today's streak data
  const lcSolved = lcResult?.solved === true;
  const cfSolved = cfResult?.solved === true;
  streakData[today] = {
    lc: lcSolved, cf: cfSolved,
    lcCount: lcResult?.count || (lcSolved ? 1 : 0),
    cfCount: cfResult?.count || (cfSolved ? 1 : 0),
    ...(lcResult?.problemTitle && { lcProblem: lcResult.problemTitle }),
    ...(cfResult?.problemTitle && { cfProblem: cfResult.problemTitle })
  };

  // Save cache
  const newCache = { fetchedAt: Date.now() };
  if (lcUsername) { newCache.lcResult = lcResult; newCache.lcRating = lcRating; }
  if (cfHandle)   { newCache.cfResult = cfResult; newCache.cfRating = cfRating; }
  await chrome.storage.local.set({ [cacheKey]: newCache, streakData });

  // Render calendar
  renderCalendar(streakData);

  // Streak
  const { streak, missed } = computeStreak(streakData);
  if (streak > bestStreak) { bestStreak = streak; await chrome.storage.local.set({ bestStreak }); }

  const streakEl = $('streak-count');
  streakEl.textContent = streak;
  streakEl.className = 'streak-count ' + getStreakClass(streak);
  const emojiEl = $('streak-emoji');
  if (emojiEl) emojiEl.textContent = getStreakEmoji(streak);

  $('missed-count').textContent = missed;
  $('best-streak').textContent = bestStreak;

  // Monthly progress
  const { solved: mSolved, total: mTotal, daysInMonth } = computeMonthProgress(streakData);
  $('month-solved').textContent = mSolved;
  $('progress-label').textContent = `${mSolved} / ${mTotal} days`;
  const pct = mTotal > 0 ? (mSolved / mTotal) * 100 : 0;
  $('progress-bar-fill').style.width = pct + '%';

  // Last updated (if loaded from live fetch)
  if (!fromCache) {
    const lu = $('last-updated');
    if (lu) lu.textContent = `Updated just now`;
  }

  showHints(lcUsername, cfHandle, lcResult, cfResult);
}

/* ── Show main view ─────────────────────────────────────────── */
async function showMain(lcUsername, cfHandle) {
  $('view-setup').classList.add('hidden');
  $('view-main').classList.remove('hidden');
  $('date-label').textContent = formatDateLabel();

  if (!lcUsername) $('lc-card').style.display = 'none';
  else { $('lc-card').style.display = ''; $('lc-link').href = `https://leetcode.com/u/${lcUsername}/`; }

  if (!cfHandle) $('cf-card').style.display = 'none';
  else { $('cf-card').style.display = ''; $('cf-link').href = `https://codeforces.com/profile/${cfHandle}`; }

  await runChecks(lcUsername, cfHandle);
}

/* ── Init ───────────────────────────────────────────────────── */
async function init() {
  pruneOldCache(); // fire and forget
  initTooltip();
  initLegendToggle();

  const data = await chrome.storage.local.get(['lcUsername', 'cfHandle']);
  const lc = data.lcUsername?.trim(), cf = data.cfHandle?.trim();

  if (lc || cf) {
    $('lc-input').value = lc || '';
    $('cf-input').value = cf || '';
    await showMain(lc, cf);
  } else {
    $('view-setup').classList.remove('hidden');
  }
}

/* ── Event listeners ────────────────────────────────────────── */
$('save-btn').addEventListener('click', async () => {
  const lc = $('lc-input').value.trim(), cf = $('cf-input').value.trim();
  if (!lc && !cf) return;
  await chrome.storage.local.set({ lcUsername: lc, cfHandle: cf });
  await showMain(lc, cf);
});

$('settings-btn').addEventListener('click', () => {
  $('view-main').classList.add('hidden');
  $('view-setup').classList.remove('hidden');
});

$('refresh-btn').addEventListener('click', async () => {
  const data = await chrome.storage.local.get(['lcUsername', 'cfHandle']);
  await chrome.storage.local.remove(['cache_' + getTodayKey(), 'historyBackfilled']);
  await runChecks(data.lcUsername?.trim(), data.cfHandle?.trim(), true);
});

// Retry buttons
['lc', 'cf'].forEach(p => {
  const btn = $(p + '-retry');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['lcUsername', 'cfHandle']);
    await chrome.storage.local.remove('cache_' + getTodayKey());
    await runChecks(data.lcUsername?.trim(), data.cfHandle?.trim(), true);
  });
});

init();