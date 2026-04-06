// ============================================================
// YouTube Focus v3 — Main Application
// ============================================================

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const $ = sel => document.querySelector(sel);
const esc = s => { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

const state = {
  authed: false, loading: false, tab: 'subs', accountSub: 'history',
  subscriptions: [], videos: [], feedChannelIds: [],
  player: null, speed: 1, customSpeed: '1', captions: true, pip: false,
  playerRating: 'none', comments: [], commentsLoading: false, showComments: false, showSaveMenu: false,
  playlists: [], playlistItems: {}, viewingPlaylist: null,
  watchHistory: JSON.parse(localStorage.getItem('yt_focus_history') || '[]'),
  userProfile: null, search: '', toast: null,
  browsingChannel: null, browsingChannelVideos: [], browsingNextPage: null, browsingLoading: false,
  showChannelPicker: false,
};

// ── Init ──
function init() {
  state.feedChannelIds = JSON.parse(localStorage.getItem('yt_focus_feed_channels') || '[]');
  AUTH.init(onAuthChange);
  bindEvents();
  render();
}

function onAuthChange(authed) {
  state.authed = authed;
  if (authed) loadInitialData(); else render();
}

async function loadInitialData() {
  state.loading = true; render();
  try {
    const profile = await YT_API.getMyChannel();
    state.userProfile = profile;
  } catch (e) {
    console.error('[APP] Token invalid:', e);
    state.loading = false; AUTH.signOut(); return;
  }
  try {
    const [subs, pls] = await Promise.all([YT_API.getAllSubscriptions(), YT_API.getPlaylists()]);
    state.subscriptions = subs;
    state.playlists = pls;
    // Load feed for selected channels (or all if none selected)
    await loadFeedVideos();
  } catch (e) {
    console.error('[APP] Data load error:', e);
    if (isAuthError(e)) { state.loading = false; AUTH.signOut(); return; }
    showToast('Some data failed to load.');
  }
  state.loading = false; render();
}

async function loadFeedVideos() {
  const ids = state.feedChannelIds.length > 0
    ? state.subscriptions.filter(s => state.feedChannelIds.includes(s.id))
    : []; // empty feed until channels are selected
  if (!ids.length) { state.videos = []; return; }
  state.videos = await YT_API.getFeed(ids);
}

async function loadSubsFeed() {
  // Full subscription feed: all channels, sorted by date
  if (!state.subscriptions.length) return;
  state.videos = await YT_API.getFeed(state.subscriptions);
}

function isAuthError(e) {
  return e?.message && (e.message.includes('401') || e.message.includes('403') || e.message.includes('Invalid Credentials') || e.message.includes('Not authenticated'));
}

async function apiCall(fn) {
  try { return await fn(); }
  catch (e) { if (isAuthError(e)) { showToast('Session expired.'); setTimeout(() => AUTH.signIn(), 1500); } throw e; }
}

function showToast(msg) { state.toast = msg; render(); setTimeout(() => { state.toast = null; render(); }, 3000); }

function saveFeedChannels() {
  localStorage.setItem('yt_focus_feed_channels', JSON.stringify(state.feedChannelIds));
}

// ── Events ──
function bindEvents() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]'); if (!el) return;
    const a = el.dataset.action, d = el.dataset;
    switch (a) {
      case 'signin': AUTH.signIn(); break;
      case 'signout': AUTH.signOut(); break;
      case 'set-tab': {
        const prev = state.tab; state.tab = d.tab; state.viewingPlaylist = null; state.browsingChannel = null;
        // When switching to subs tab, load all-subs feed if not already loaded
        if (d.tab === 'subs' && state.subscriptions.length && state._subsFeedVideos === undefined) {
          loadAllSubsFeed();
        }
        render(); break;
      }
      case 'set-account-sub': state.accountSub = d.sub; render(); break;
      case 'open-player': openPlayer(d.videoId); break;
      case 'close-player': closePlayer(); break;
      case 'set-speed': setSpeed(parseFloat(d.speed)); break;
      case 'toggle-captions': state.captions = !state.captions; postToPlayer('captions'); render(); break;
      case 'toggle-pip': requestPiP(); break;
      case 'like': rateVideo('like'); break;
      case 'dislike': rateVideo('dislike'); break;
      case 'toggle-comments': state.showComments = !state.showComments; state.showSaveMenu = false; if (state.showComments && !state.comments.length) loadComments(); render(); break;
      case 'toggle-save-menu': state.showSaveMenu = !state.showSaveMenu; state.showComments = false; render(); break;
      case 'toggle-playlist-save': togglePlaylistSave(d.playlistId); break;
      case 'post-comment': postComment(); break;
      case 'like-comment': { const cm = state.comments.find(c => c.id === d.commentId); if (cm) { cm._liked = !cm._liked; cm.likes += cm._liked ? 1 : -1; } render(); break; }
      case 'view-playlist': viewPlaylist(d.playlistId); break;
      case 'back-playlist': state.viewingPlaylist = null; render(); break;
      case 'refresh-feed': refreshFeed(); break;
      case 'create-playlist-modal': { const n = prompt('New playlist name:'); if (n?.trim()) createPlaylist(n.trim()); break; }
      case 'clear-search': state.search = ''; render(); break;
      case 'browse-channel': browseChannel(d.channelId, d.channelName); break;
      case 'back-browse': state.browsingChannel = null; render(); break;
      case 'load-more-channel': loadMoreChannelVideos(); break;
      case 'show-channel-picker': state.showChannelPicker = !state.showChannelPicker; render(); break;
      case 'toggle-feed-channel': toggleFeedChannel(d.channelId); break;
      case 'open-channel-from-player': {
        const v = state.player; if (v) { closePlayer(); browseChannel(v.channelId, v.channel); } break;
      }
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'searchInput') { state.search = e.target.value; render(); }
    if (e.target.id === 'customSpeedInput') state.customSpeed = e.target.value;
  });
  document.addEventListener('change', e => { if (e.target.id === 'customSpeedInput') applyCustomSpeed(); });
  document.addEventListener('keydown', e => {
    if (e.target.id === 'customSpeedInput' && e.key === 'Enter') { e.target.blur(); applyCustomSpeed(); }
    if (e.target.id === 'commentInput' && e.key === 'Enter') postComment();
  });
}

// ── Player (no-restart approach) ──
function openPlayer(videoId) {
  const allVids = [...state.videos, ...(state._subsFeedVideos || []), ...state.browsingChannelVideos, ...state.watchHistory, ...Object.values(state.playlistItems).flat()];
  const video = allVids.find(v => (v.id || v.videoId) === videoId);
  if (!video) return;
  state.player = video; state.speed = 1; state.customSpeed = '1'; state.captions = true; state.pip = false;
  state.playerRating = 'none'; state.comments = []; state.showComments = false; state.showSaveMenu = false;
  const vid = video.id || video.videoId;
  const entry = { ...video, id: vid, watchedAt: new Date().toISOString() };
  state.watchHistory = [entry, ...state.watchHistory.filter(h => (h.id || h.videoId) !== vid)].slice(0, 100);
  localStorage.setItem('yt_focus_history', JSON.stringify(state.watchHistory));
  YT_API.getRating(vid).then(r => { state.playerRating = r; render(); }).catch(() => {});
  render();
}

function closePlayer() { state.player = null; state.showComments = false; state.showSaveMenu = false; render(); }

function setSpeed(s) { state.speed = s; state.customSpeed = String(s); postToPlayer('speed'); render(); }

function applyCustomSpeed() {
  const v = parseFloat(state.customSpeed);
  if (!isNaN(v)) { const c = Math.min(5, Math.max(0.1, Math.round(v*100)/100)); state.speed = c; state.customSpeed = String(c); postToPlayer('speed'); }
  else state.customSpeed = String(state.speed);
  render();
}

// Use YouTube IFrame API postMessage to change speed/captions WITHOUT reloading
function postToPlayer(what) {
  const iframe = document.querySelector('.player-embed iframe');
  if (!iframe || !iframe.contentWindow) return;
  try {
    if (what === 'speed') {
      iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [state.speed] }), '*');
    }
    // Captions: cc_load_policy is set at embed time; toggling mid-stream requires the JS API
    // We'll handle this via the enablejsapi parameter
  } catch (e) {}
}

function requestPiP() {
  const iframe = document.querySelector('.player-embed iframe');
  if (!iframe) return;
  // Try to get the video element inside the iframe (same-origin restriction makes this hard)
  // Instead, use the experimental requestPictureInPicture on the iframe's document
  // For cross-origin YouTube embeds, we use the PiP API on the iframe itself (Safari supports this)
  try {
    if (document.pictureInPictureEnabled || document.webkitPictureInPictureEnabled) {
      // Safari supports PiP on video elements. We need to access the video inside the iframe.
      // Since YouTube is cross-origin, we can't directly access it.
      // Workaround: use the Safari-specific presentationMode on the iframe
      const video = iframe; // On Safari, you can try requestPictureInPicture on HTMLVideoElement
      // Actually for Safari PWA, the best approach is to use the allow="picture-in-picture" attribute
      // and let the user use the native PiP button in the YouTube player controls
      showToast('Use the PiP button in the video player controls');
    }
  } catch (e) {
    showToast('PiP: Use the player\'s built-in PiP button');
  }
  state.pip = !state.pip;
  render();
}

async function rateVideo(rating) {
  if (!state.player) return;
  const prev = state.playerRating;
  const next = prev === rating ? 'none' : rating;
  state.playerRating = next; render();
  try { await apiCall(() => YT_API.rateVideo(state.player.id || state.player.videoId, next)); showToast(next === 'none' ? 'Rating removed' : next === 'like' ? 'Liked' : 'Disliked'); }
  catch (e) { state.playerRating = prev; render(); }
}

async function loadComments() {
  if (!state.player) return;
  state.commentsLoading = true; render();
  try { const r = await apiCall(() => YT_API.getComments(state.player.id || state.player.videoId)); state.comments = r.comments; }
  catch (e) { state.comments = []; }
  state.commentsLoading = false; render();
}

async function postComment() {
  const input = $('#commentInput'); if (!input || !input.value.trim() || !state.player) return;
  const text = input.value.trim(); input.value = '';
  try { const c = await apiCall(() => YT_API.postComment(state.player.id || state.player.videoId, text)); state.comments.unshift(c); showToast('Comment posted'); }
  catch (e) { showToast('Failed to post comment'); }
  render();
}

async function togglePlaylistSave(plId) {
  if (!state.player) return;
  try { await apiCall(() => YT_API.addToPlaylist(plId, state.player.id || state.player.videoId)); showToast('Saved'); state.playlists = await YT_API.getPlaylists(); }
  catch (e) { showToast('Failed to save'); }
  render();
}

async function viewPlaylist(plId) {
  state.viewingPlaylist = plId; render();
  if (!state.playlistItems[plId]) {
    try { const r = await apiCall(() => YT_API.getPlaylistItems(plId)); state.playlistItems[plId] = r.items; }
    catch (e) { state.playlistItems[plId] = []; showToast('Failed to load playlist'); }
    render();
  }
}

async function createPlaylist(name) {
  try { const pl = await apiCall(() => YT_API.createPlaylist(name)); state.playlists.push(pl); showToast('Created "' + name + '"'); }
  catch (e) { showToast('Failed to create playlist'); }
  render();
}

async function refreshFeed() {
  state.loading = true; render(); YT_API.clearCache();
  try {
    if (state.tab === 'subs') { await loadAllSubsFeed(); }
    else { await loadFeedVideos(); }
  } catch (e) { if (isAuthError(e)) return; showToast('Failed to refresh'); }
  state.loading = false; render();
}

async function loadAllSubsFeed() {
  try { state._subsFeedVideos = await YT_API.getFeed(state.subscriptions); }
  catch (e) { state._subsFeedVideos = []; }
  render();
}

// ── Channel browsing ──
async function browseChannel(channelId, channelName) {
  state.browsingChannel = { id: channelId, name: channelName };
  state.browsingChannelVideos = []; state.browsingNextPage = null; state.browsingLoading = true;
  render();
  try {
    const r = await apiCall(() => YT_API.getChannelAllVideos(channelId));
    state.browsingChannelVideos = r.videos; state.browsingNextPage = r.nextPageToken;
  } catch (e) { showToast('Failed to load channel'); }
  state.browsingLoading = false; render();
}

async function loadMoreChannelVideos() {
  if (!state.browsingChannel || !state.browsingNextPage || state.browsingLoading) return;
  state.browsingLoading = true; render();
  try {
    const r = await apiCall(() => YT_API.getChannelAllVideos(state.browsingChannel.id, state.browsingNextPage));
    state.browsingChannelVideos.push(...r.videos); state.browsingNextPage = r.nextPageToken;
  } catch (e) { showToast('Failed to load more'); }
  state.browsingLoading = false; render();
}

// ── Feed channel selection ──
function toggleFeedChannel(channelId) {
  const idx = state.feedChannelIds.indexOf(channelId);
  if (idx >= 0) state.feedChannelIds.splice(idx, 1);
  else state.feedChannelIds.push(channelId);
  saveFeedChannels();
  render();
  // Reload feed in background
  loadFeedVideos().then(() => render());
}

// ── Icons ──
const I = {
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  x: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>',
  play: '<svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" opacity=".35"><polygon points="5 3 19 12 5 21"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  block: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 14.14 14.14"/></svg>',
  tUp: f => `<svg width="20" height="20" viewBox="0 0 24 24" fill="${f?'currentColor':'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3m7-2V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg>`,
  tDown: f => `<svg width="20" height="20" viewBox="0 0 24 24" fill="${f?'currentColor':'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="transform:scaleY(-1)"><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3m7-2V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg>`,
  save: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  comment: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  home: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>',
  subs: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="m17 2-5 5-5-5"/></svg>',
  user: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  hist: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  list: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  chk: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
  chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>',
  refresh: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  filter: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
};

const LOGO = `<svg viewBox="0 0 380 85" width="116" height="26" style="display:block"><path d="M57.307 5.706C56.586 2.86 54.372.617 51.564-.116 47.043-1.32 29-1.32 29-1.32S10.957-1.32 6.436-.116C3.628.617 1.414 2.86.693 5.706-.495 10.285-.495 19.84-.495 19.84s0 9.555 1.188 14.134c.721 2.846 2.935 5.009 5.743 5.742C10.957 40.92 29 40.92 29 40.92s18.043 0 22.564-1.204c2.808-.733 5.022-2.896 5.743-5.742C58.495 29.395 58.495 19.84 58.495 19.84s0-9.555-1.188-14.134z" fill="#FF0000" transform="translate(2,22)"/><path d="M23.205 28.52V11.16l14.963 8.68-14.963 8.68z" fill="white" transform="translate(2,22)"/><text x="72" y="58" font-family="Roboto,Arial,sans-serif" font-size="38" font-weight="700" fill="currentColor" letter-spacing="-1.2">YouTube</text></svg>`;

// ── Render ──
function render() {
  const app = $('#app');
  if (!state.authed) { app.innerHTML = renderSignIn(); return; }
  if (state.player) { app.innerHTML = renderPlayer(); return; }
  if (state.viewingPlaylist) { app.innerHTML = renderPlaylistView(); return; }
  if (state.browsingChannel) { app.innerHTML = renderChannelBrowse(); return; }

  let h = renderTopBar();
  if (state.tab === 'feed') h += renderFeed();
  else if (state.tab === 'subs') h += renderSubs();
  else if (state.tab === 'account') h += renderAccount();
  else if (state.tab === 'settings') h += renderSettings();
  h += renderNav();
  if (state.toast) h += `<div class="toast">${esc(state.toast)}</div>`;
  app.innerHTML = h;
}

function renderSignIn() {
  var debug = window._authDebug || '';
  return `<div class="signin-screen"><div class="signin-logo">${LOGO}</div>
    <div class="signin-title">YouTube, Focused</div>
    <div class="signin-desc">No Shorts. No algorithm. No suggested videos.<br>Just your subscriptions with full playback controls.</div>
    <button class="signin-btn" data-action="signin">${I.user} Sign in with Google</button>
    <div class="signin-features">
      <div class="signin-feature">${I.block} Shorts permanently blocked</div>
      <div class="signin-feature">${I.block} No homepage algorithm</div>
      <div class="signin-feature">${I.chk} Your real subscriptions feed</div>
      <div class="signin-feature">${I.chk} Like, comment, save to playlists</div>
      <div class="signin-feature">${I.chk} Adjustable speed 0.1×–5×, captions, PiP</div>
    </div>
    ${debug ? `<div style="margin-top:24px;padding:12px;background:var(--s1);border:1px solid var(--border);border-radius:8px;width:100%;max-width:340px;text-align:left"><div style="font-size:11px;font-weight:600;color:var(--dim);text-transform:uppercase;margin-bottom:6px">Auth Debug</div><pre style="font-size:10px;color:var(--faint);font-family:monospace;white-space:pre-wrap;word-break:break-all">${esc(debug)}</pre></div>` : ''}
    <div style="margin-top:12px;font-size:10px;color:var(--faint);font-family:monospace">Redirect URI: ${esc(CONFIG.REDIRECT_URI)}</div>
    </div>`;
}

function renderTopBar() {
  return `<div class="top-bar"><div class="logo-wrap">${LOGO}</div>
    <div class="search-wrap">${I.search}<input type="text" id="searchInput" placeholder="Search..." value="${esc(state.search)}">
    ${state.search ? `<button class="icon-btn small" data-action="clear-search">${I.x}</button>` : ''}</div>
    <button class="icon-btn" data-action="refresh-feed" title="Refresh">${I.refresh}</button></div>`;
}

function renderNav() {
  const tabs = [['feed','Feed',I.home],['subs','Subscriptions',I.subs],['account','You',I.user],['settings','Settings',I.gear]];
  return `<div class="bottom-nav">${tabs.map(([k,l,i]) => `<button class="nav-item ${state.tab===k?'active':''}" data-action="set-tab" data-tab="${k}">${i}<span>${l}</span></button>`).join('')}</div>`;
}

function videoCard(v) {
  const vid = v.id || v.videoId, thumb = v.thumbnail || v.thumbnailHigh;
  const views = v.views ? formatViewCount(v.views) : '', age = v.publishedAt ? timeAgo(v.publishedAt) : (v.age||'');
  return `<div class="video-card" data-action="open-player" data-video-id="${vid}">
    <div class="video-thumb">${thumb ? `<img src="${thumb}" alt="" loading="lazy">` : `<div class="placeholder">${I.play}</div>`}
    ${v.duration ? `<div class="video-duration">${v.duration}</div>` : ''}</div>
    <div class="video-info"><div class="video-title">${esc(v.title)}</div>
    <div class="video-meta"><span>${esc(v.channel)}</span>${views?`<span class="meta-dot"></span><span>${views} views</span>`:''}${age?`<span class="meta-dot"></span><span>${age}</span>`:''}</div></div></div>`;
}

function empty(icon, title, desc) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><div class="empty-title">${title}</div><div class="empty-desc">${desc}</div></div>`;
}

// ── Feed (selected channels only) ──
function renderFeed() {
  if (state.loading) return '<div class="loading"><div class="spinner"></div> Loading...</div>';
  const q = state.search.toLowerCase();
  let vids = state.videos;
  if (q) vids = vids.filter(v => v.title.toLowerCase().includes(q) || v.channel.toLowerCase().includes(q));

  let h = `<div style="padding:10px 12px 0;display:flex;align-items:center;justify-content:space-between">
    <div class="section-title">Your Feed${state.feedChannelIds.length ? ' ('+state.feedChannelIds.length+' channels)' : ''}</div>
    <button class="add-btn" data-action="show-channel-picker">${I.filter} Select Channels</button></div>`;

  // Channel picker dropdown
  if (state.showChannelPicker) {
    h += `<div style="padding:8px 12px;max-height:240px;overflow-y:auto;border-bottom:1px solid var(--border)">`;
    h += state.subscriptions.map(ch => {
      const sel = state.feedChannelIds.includes(ch.id);
      return `<div class="save-item" data-action="toggle-feed-channel" data-channel-id="${ch.id}" style="padding:8px 0">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:28px;height:28px;border-radius:50%;overflow:hidden;background:var(--s2);flex-shrink:0;display:grid;place-items:center">${ch.thumbnail ? `<img src="${ch.thumbnail}" style="width:100%;height:100%;object-fit:cover">` : `<span style="font-size:11px;font-weight:700;color:var(--red)">${ch.name[0]}</span>`}</div>
          <span style="font-size:13px">${esc(ch.name)}</span>
        </div>
        <div class="checkbox ${sel?'checked':''}">${sel?I.chk:''}</div></div>`;
    }).join('');
    h += `</div>`;
  }

  h += `<div class="feed-grid">${vids.length ? vids.map(videoCard).join('') : empty(I.home, state.feedChannelIds.length ? 'No videos yet' : 'No channels selected', state.feedChannelIds.length ? 'Try refreshing or selecting more channels.' : 'Tap "Select Channels" above to pick which channels appear in your feed.')}</div>`;
  return h;
}

// ── Subscriptions (compact list + full video feed) ──
function renderSubs() {
  if (state.loading) return '<div class="loading"><div class="spinner"></div> Loading...</div>';
  const q = state.search.toLowerCase();

  // Compact channel list (horizontal scroll)
  let h = `<div style="padding:10px 12px 4px"><div class="section-title">Channels (${state.subscriptions.length})</div></div>`;
  h += `<div style="display:flex;gap:8px;padding:4px 12px 12px;overflow-x:auto;-webkit-overflow-scrolling:touch">`;
  h += state.subscriptions.map(ch => `
    <div data-action="browse-channel" data-channel-id="${ch.id}" data-channel-name="${esc(ch.name)}"
      style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:4px;width:64px;cursor:pointer">
      <div style="width:48px;height:48px;border-radius:50%;overflow:hidden;background:var(--s2);display:grid;place-items:center">
        ${ch.thumbnail ? `<img src="${ch.thumbnail}" style="width:100%;height:100%;object-fit:cover">` : `<span style="font-size:15px;font-weight:700;color:var(--red)">${ch.name[0]}</span>`}
      </div>
      <span style="font-size:10px;color:var(--dim);text-align:center;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ch.name)}</span>
    </div>`).join('');
  h += `</div>`;

  // Video feed from all subscriptions
  const allVids = state._subsFeedVideos || [];
  let filtered = q ? allVids.filter(v => v.title.toLowerCase().includes(q) || v.channel.toLowerCase().includes(q)) : allVids;

  if (!allVids.length && state.subscriptions.length) {
    h += '<div class="loading"><div class="spinner"></div> Loading videos...</div>';
    if (state._subsFeedVideos === undefined) loadAllSubsFeed();
  } else {
    h += `<div style="padding:0 12px 4px"><div class="section-title">Recent uploads</div></div>`;
    h += `<div class="feed-grid">${filtered.length ? filtered.map(videoCard).join('') : empty(I.subs, 'No videos found', q ? 'Try a different search.' : 'No recent uploads from your subscriptions.')}</div>`;
  }
  return h;
}

// ── Channel browse ──
function renderChannelBrowse() {
  const ch = state.browsingChannel;
  let h = `<div class="top-bar">
    <button class="icon-btn" data-action="back-browse">${I.back}</button>
    <div style="flex:1;font-size:16px;font-weight:600">${esc(ch.name)}</div></div>`;
  h += `<div class="feed-grid">`;
  if (state.browsingChannelVideos.length) h += state.browsingChannelVideos.map(videoCard).join('');
  else if (state.browsingLoading) h += '<div class="loading" style="grid-column:1/-1"><div class="spinner"></div> Loading...</div>';
  else h += empty(I.home, 'No videos', 'This channel has no long-form videos.');
  h += `</div>`;
  if (state.browsingNextPage && !state.browsingLoading) {
    h += `<div style="padding:16px;text-align:center"><button class="btn btn-cancel" data-action="load-more-channel" style="width:100%">Load more</button></div>`;
  }
  if (state.browsingLoading && state.browsingChannelVideos.length) {
    h += '<div class="loading"><div class="spinner"></div></div>';
  }
  return h;
}

// ── Player ──
function renderPlayer() {
  const v = state.player, vid = v.id || v.videoId;
  const isLiked = state.playerRating === 'like', isDisliked = state.playerRating === 'dislike';
  const likeN = v.likes ? formatViewCount(v.likes + (isLiked?1:0)) : '';
  const cc = state.captions ? 1 : 0;
  const pill = (active, act, icon, label) => `<button class="pill ${active?'active':''}" data-action="${act}">${icon} ${label||''}</button>`;

  let h = `<div class="player-view">
    <div class="player-header"><button class="icon-btn" data-action="close-player">${I.back}</button>
    <div style="flex:1;font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v.channel)}</div></div>
    <div class="player-embed">
      <iframe id="ytplayer" src="https://www.youtube.com/embed/${vid}?rel=0&modestbranding=1&cc_load_policy=${cc}&playsinline=1&autoplay=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}"
        allow="autoplay; picture-in-picture; encrypted-media; fullscreen" allowfullscreen></iframe>
    </div>
    <div class="player-info">
      <div class="player-title">${esc(v.title)}</div>
      <div class="player-meta">
        <span data-action="open-channel-from-player" style="cursor:pointer;text-decoration:underline;color:var(--dim)">${esc(v.channel)}</span> · ${v.views ? formatViewCount(v.views)+' views' : ''} · ${v.publishedAt ? timeAgo(v.publishedAt) : (v.age||'')}
      </div>
      <div class="action-bar">
        ${pill(isLiked,'like',I.tUp(isLiked),likeN)}
        ${pill(isDisliked,'dislike',I.tDown(isDisliked),'')}
        ${pill(state.showSaveMenu,'toggle-save-menu',I.save,'Save')}
        ${pill(state.showComments,'toggle-comments',I.comment,v.commentCount||'')}
      </div>
    </div>`;

  if (state.showSaveMenu) {
    h += `<div class="save-panel"><div class="control-label">Save to Playlist</div>`;
    h += state.playlists.map(pl => `<div class="save-item" data-action="toggle-playlist-save" data-playlist-id="${pl.id}"><span class="name">${esc(pl.title||pl.name)}</span><div class="checkbox"><span style="opacity:0.5">${I.plus}</span></div></div>`).join('');
    h += `<button class="btn btn-text" data-action="create-playlist-modal">${I.plus} New playlist</button></div>`;
  }

  if (state.showComments) {
    h += `<div class="comments-panel"><div class="control-label">Comments</div>
      <div class="comment-input-row"><div class="comment-avatar"><span class="letter">Y</span></div>
      <div style="flex:1;display:flex;gap:6px"><input class="modal-input" id="commentInput" placeholder="Add a comment..." style="margin:0;border-radius:20px;padding:8px 14px;font-size:13px;flex:1">
      <button class="btn btn-confirm" style="border-radius:20px;padding:8px 14px;font-size:13px" data-action="post-comment">Post</button></div></div>
      ${state.commentsLoading ? '<div class="loading"><div class="spinner"></div></div>' : ''}
      ${state.comments.map(cm => `<div class="comment-item"><div class="avatar">${cm.authorImage?`<img src="${cm.authorImage}">`:
        `<span class="letter">${(cm.author||'U')[0]}</span>`}</div><div class="comment-body">
        <div class="comment-author"><span class="name ${cm.isOwn?'own':''}">${esc(cm.author)}</span> · ${cm.publishedAt?timeAgo(cm.publishedAt):'Just now'}</div>
        <div class="comment-text">${esc(cm.text)}</div>
        <button class="comment-like-btn ${cm._liked?'liked':''}" data-action="like-comment" data-comment-id="${cm.id}">${I.tUp(cm._liked)} ${cm.likes}</button></div></div>`).join('')}
    </div>`;
  }

  // Controls — these use postMessage, NOT iframe reload
  h += `<div class="player-controls"><div class="control-card"><div class="control-label">Playback Speed</div>
    <div class="speed-row">${SPEEDS.map(s => `<button class="speed-btn ${state.speed===s?'active':''}" data-action="set-speed" data-speed="${s}">${s}×</button>`).join('')}</div>
    <div class="custom-speed-row"><span style="font-size:12px;color:var(--dim);flex-shrink:0">Custom:</span>
    <input type="number" inputmode="decimal" min="0.1" max="5" step="0.05" id="customSpeedInput" value="${state.customSpeed}" class="custom-speed-input ${!SPEEDS.includes(state.speed)?'custom-active':''}">
    <span style="font-size:14px;font-weight:600;font-family:monospace;color:var(--dim)">×</span>
    <span style="font-size:11px;color:var(--faint);margin-left:4px">0.1–5</span></div>
    ${!SPEEDS.includes(state.speed)?`<div style="margin-top:8px;font-size:12px;color:var(--red);font-family:monospace;font-weight:600">Current: ${state.speed}×</div>`:''}</div>
    <div class="control-card"><div class="control-label">Options</div>
      <div class="toggle-row"><span class="toggle-label">Captions</span><div class="toggle-track ${state.captions?'on':''}" data-action="toggle-captions"><div class="toggle-knob"></div></div></div>
      <div class="toggle-row"><span class="toggle-label">Picture in Picture</span><div class="toggle-track ${state.pip?'on':''}" data-action="toggle-pip"><div class="toggle-knob"></div></div></div>
      <div style="margin-top:8px;font-size:11px;color:var(--faint)">Tip: Use the PiP button in the YouTube player controls for best results.</div>
    </div></div></div>`;

  if (state.toast) h += `<div class="toast">${esc(state.toast)}</div>`;
  return h;
}

// ── Account ──
function renderAccount() {
  const p = state.userProfile, name = p?.name || 'Your Account', thumb = p?.thumbnail;
  let h = `<div class="account-header"><div class="account-avatar">${thumb?`<img src="${thumb}">`:
    `<span class="letter">${name[0].toUpperCase()}</span>`}</div><div><div class="account-name">${esc(name)}</div>
    <div class="account-stats">${state.subscriptions.length} subscriptions · ${state.playlists.length} playlists</div></div></div>
    <div class="sub-tabs"><button class="sub-tab ${state.accountSub==='history'?'active':''}" data-action="set-account-sub" data-sub="history">${I.hist} History</button>
    <button class="sub-tab ${state.accountSub==='playlists'?'active':''}" data-action="set-account-sub" data-sub="playlists">${I.list} Playlists</button></div>`;
  if (state.accountSub === 'history') {
    h += `<div class="feed-grid">${state.watchHistory.length ? state.watchHistory.map(videoCard).join('') : empty(I.hist,'No watch history','Videos you watch will appear here.')}</div>`;
  } else {
    h += '<div style="padding:12px">';
    h += state.playlists.map(pl => `<div class="playlist-row" data-action="view-playlist" data-playlist-id="${pl.id}"><div><div class="playlist-name">${esc(pl.title||pl.name)}</div><div class="playlist-count">${pl.itemCount||0} videos</div></div>${I.chev}</div>`).join('');
    h += `<button class="btn btn-text" data-action="create-playlist-modal">${I.plus} Create new playlist</button></div>`;
  }
  return h;
}

function renderPlaylistView() {
  const pl = state.playlists.find(p => p.id === state.viewingPlaylist), items = state.playlistItems[state.viewingPlaylist] || [];
  return `<div class="top-bar"><button class="icon-btn" data-action="back-playlist">${I.back}</button>
    <div style="flex:1;font-size:16px;font-weight:600">${esc(pl?.title||'Playlist')}</div>
    <span style="font-size:13px;color:var(--dim)">${items.length} videos</span></div>
    <div class="feed-grid">${items.length ? items.map(i => videoCard({id:i.videoId,videoId:i.videoId,title:i.title,channel:i.channel||'',thumbnail:i.thumbnail,publishedAt:i.publishedAt})).join('') : empty(I.save,'No videos yet','Save videos from the player.')}</div>`;
}

function renderSettings() {
  const blocked = ['YouTube Shorts','Suggested Videos','Homepage Algorithm','Trending','Autoplay'];
  return `<div class="settings-panel">
    <div class="settings-card"><h3>Blocked Content</h3><p>Permanently hidden.</p>${blocked.map(b=>`<span class="blocked-tag">${I.block} ${b}</span>`).join('')}</div>
    <div class="settings-card"><h3>Focus Stats</h3>
      ${[['Shorts Blocked','∞','green'],['Algorithm Bypasses','∞','green'],['Channels',state.subscriptions.length,''],['Watched',state.watchHistory.length,''],['Playlists',state.playlists.length,'']].map(([l,v,c])=>`<div class="stat-row"><span class="stat-label">${l}</span><span class="stat-value ${c}">${v}</span></div>`).join('')}</div>
    <div class="settings-card"><h3>Account</h3><p>Signed in as <strong>${esc(state.userProfile?.name||'loading...')}</strong></p>
      <button class="btn btn-cancel" data-action="signout">Sign Out</button></div>
    <div class="settings-card"><h3>Install as App</h3><div style="font-size:13px;color:var(--dim);line-height:1.7"><strong style="color:var(--text)">Safari:</strong> Tap Share → "Add to Home Screen"</div></div>
    <div class="settings-card"><h3>Debug</h3><p style="font-size:11px;color:var(--faint);font-family:monospace;word-break:break-all">Redirect URI: ${esc(CONFIG.REDIRECT_URI)}</p></div>
  </div>`;
}

document.addEventListener('DOMContentLoaded', init);
