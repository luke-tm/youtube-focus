// ============================================================
// YouTube Focus v4 -- Main Application
// ============================================================
// Key changes from v3:
// - Player controls update DOM directly (no full re-render)
// - Channel selection before video fetching (quota savings)
// - Subscriptions cached to localStorage for 6 hours
// ============================================================

var SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
var $ = function(sel) { return document.querySelector(sel); };
var esc = function(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

var state = {
  authed: false, loading: false, _loadError: null,
  tab: 'subs', accountSub: 'history',
  subscriptions: [], videos: [], feedChannelIds: [],
  player: null, speed: 1, captions: true, pip: false,
  playerRating: 'none', comments: [], commentsLoading: false, showComments: false, showSaveMenu: false,
  playlists: [], playlistItems: {}, viewingPlaylist: null,
  watchHistory: JSON.parse(localStorage.getItem('yt_focus_history') || '[]'),
  userProfile: null, search: '', toast: null,
  searchMode: false, searchResults: [], searchLoading: false, searchNextPage: null,
  showPipGuide: false,
  miniPlayer: false,
  browsingChannel: null, browsingChannelVideos: [], browsingNextPage: null, browsingLoading: false,
  showChannelPicker: false,
  _subsFeedVideos: undefined,
  _playerRendered: false, // tracks if player iframe is already in DOM
};

// Single shared iframe element — moved between full player and miniplayer without reload
var _playerIframe = null;

// -- Init --
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
  state.loading = true; state._loadError = null; render();
  try {
    var profile = await YT_API.getMyChannel();
    state.userProfile = profile;
  } catch (e) {
    state.loading = false;
    state._loadError = 'Profile load failed: ' + (e.message || String(e));
    render(); return;
  }
  try {
    var results = await Promise.all([YT_API.getAllSubscriptions(), YT_API.getPlaylists()]);
    state.subscriptions = results[0];
    state.playlists = results[1];
    // DON'T auto-load feed -- wait for user to select channels or switch to subs tab
  } catch (e) {
    state._loadError = 'Data load failed: ' + (e.message || String(e));
  }
  state.loading = false; render();
}

async function loadFeedVideos() {
  var selected = [];
  for (var i = 0; i < state.subscriptions.length; i++) {
    if (state.feedChannelIds.indexOf(state.subscriptions[i].id) >= 0) {
      selected.push(state.subscriptions[i]);
    }
  }
  if (!selected.length) { state.videos = []; return; }
  state.videos = await YT_API.getFeed(selected);
}

async function loadSubsFeed(channelIds) {
  // Load only specified channels, not all 200
  var channels = [];
  for (var i = 0; i < state.subscriptions.length; i++) {
    if (!channelIds || channelIds.indexOf(state.subscriptions[i].id) >= 0) {
      channels.push(state.subscriptions[i]);
    }
  }
  if (!channels.length) return;
  state._subsFeedVideos = await YT_API.getFeed(channels);
}

function isAuthError(e) {
  return e && e.message && (e.message.indexOf('401') >= 0 || e.message.indexOf('403') >= 0 || e.message.indexOf('Invalid Credentials') >= 0 || e.message.indexOf('Not authenticated') >= 0);
}

async function apiCall(fn) {
  try { return await fn(); }
  catch (e) { if (isAuthError(e)) { showToast('Session expired.'); setTimeout(function() { AUTH.signIn(); }, 1500); } throw e; }
}

function showToast(msg) { state.toast = msg; renderToast(); setTimeout(function() { state.toast = null; renderToast(); }, 3000); }

function renderToast() {
  var existing = $('#toast-container');
  if (existing) existing.remove();
  if (state.toast) {
    var div = document.createElement('div');
    div.id = 'toast-container';
    div.className = 'toast';
    div.textContent = state.toast;
    document.body.appendChild(div);
  }
}

function saveFeedChannels() {
  localStorage.setItem('yt_focus_feed_channels', JSON.stringify(state.feedChannelIds));
}

// -- Events --
function bindEvents() {
  document.addEventListener('click', function(e) {
    var el = e.target.closest('[data-action]'); if (!el) return;
    var a = el.dataset.action, d = el.dataset;
    switch (a) {
      case 'signin': AUTH.signIn(); break;
      case 'signout': AUTH.signOut(); state.subscriptions = []; state.videos = []; state.playlists = []; state.userProfile = null; state._subsFeedVideos = undefined; break;
      case 'set-tab':
        state.tab = d.tab; state.viewingPlaylist = null; state.browsingChannel = null; state._playerRendered = false;
        render();
        break;
      case 'set-account-sub': state.accountSub = d.sub; render(); break;
      case 'open-player': openPlayer(d.videoId); break;
      case 'close-player': closePlayer(); break;
      // Player controls -- targeted updates, no full re-render
      case 'set-speed': setSpeed(parseFloat(d.speed)); break;
      case 'toggle-captions': toggleCaptions(); break;
      case 'toggle-pip': requestPiP(); break;
      case 'like': rateVideo('like'); break;
      case 'dislike': rateVideo('dislike'); break;
      case 'toggle-comments': state.showComments = !state.showComments; state.showSaveMenu = false; if (state.showComments && !state.comments.length) loadComments(); renderPlayerControls(); break;
      case 'toggle-save-menu': state.showSaveMenu = !state.showSaveMenu; state.showComments = false; renderPlayerControls(); break;
      case 'toggle-playlist-save': togglePlaylistSave(d.playlistId); break;
      case 'post-comment': postComment(); break;
      case 'like-comment': likeComment(d.commentId); break;
      case 'view-playlist': viewPlaylist(d.playlistId); break;
      case 'back-playlist': state.viewingPlaylist = null; render(); break;
      case 'refresh-feed': refreshFeed(); break;
      case 'create-playlist-modal': var n = prompt('New playlist name:'); if (n && n.trim()) createPlaylist(n.trim()); break;
      case 'do-search': if (state.search.trim()) performSearch(state.search.trim()); break;
      case 'search-load-more': searchLoadMore(); break;
      case 'clear-search': state.search = ''; state.searchMode = false; state.searchResults = []; state.searchNextPage = null; render(); break;
      case 'open-pip-guide': state.showPipGuide = true; renderPlayerControls(); break;
      case 'close-pip-guide': state.showPipGuide = false; renderPlayerControls(); break;
      case 'minimize-player': minimizePlayer(); break;
      case 'expand-player': expandMiniPlayer(); break;
      case 'close-mini-player': closeMiniPlayer(); break;
      case 'browse-channel': browseChannel(d.channelId, d.channelName); break;
      case 'back-browse': state.browsingChannel = null; render(); break;
      case 'load-more-channel': loadMoreChannelVideos(); break;
      case 'show-channel-picker': state.showChannelPicker = !state.showChannelPicker; render(); break;
      case 'toggle-feed-channel': toggleFeedChannel(d.channelId); break;
      case 'open-channel-from-player': openChannelFromPlayer(); break;
      case 'load-subs-feed': loadSubsFeedUI(); break;
      case 'retry-load': state._loadError = null; loadInitialData(); break;
      case 'clear-subs-cache': YT_API.clearSubsCache(); showToast('Subscription cache cleared'); break;
    }
  });
  document.addEventListener('input', function(e) {
    if (e.target.id === 'searchInput') {
      state.search = e.target.value;
      // Don't call render() — that destroys the focused input and dismisses the keyboard.
      // Instead do a cheap in-place update of the video grid only.
      if (!state.searchMode) updateSearchFilter();
    }
  });
  document.addEventListener('keydown', function(e) {
    if (e.target.id === 'searchInput' && (e.key === 'Enter' || e.key === 'Go' || e.key === 'Search')) {
      e.target.blur();
      if (state.search.trim()) performSearch(state.search.trim());
    }
    if (e.target.id === 'commentInput' && e.key === 'Enter') postComment();
  });
  // Track PiP state changes driven by the YouTube player's native PiP button
  document.addEventListener('enterpictureinpicture', function() {
    state.pip = true;
    updateToggle('pipToggle', true);
  });
  document.addEventListener('leavepictureinpicture', function() {
    state.pip = false;
    updateToggle('pipToggle', false);
  });
}

// -- Player --
function openPlayer(videoId) {
  // If the same video is already minimized, just expand it
  if (state.miniPlayer && state.player && (state.player.id || state.player.videoId) === videoId) {
    expandMiniPlayer(); return;
  }
  // New video — clear old iframe so _getOrCreateIframe makes a fresh one
  _playerIframe = null;
  state.miniPlayer = false;
  var oldSlot = document.getElementById('player-embed-slot');
  if (oldSlot) oldSlot.innerHTML = '';
  var allVids = [].concat(state.videos, state._subsFeedVideos || [], state.browsingChannelVideos, state.searchResults, state.watchHistory, Object.values(state.playlistItems).reduce(function(a,b){return a.concat(b);},[]));
  var video = null;
  for (var i = 0; i < allVids.length; i++) {
    if ((allVids[i].id || allVids[i].videoId) === videoId) { video = allVids[i]; break; }
  }
  if (!video) return;
  state.player = video; state.speed = 1; state.captions = true; state.pip = false; state.showPipGuide = false;
  state.playerRating = 'none'; state.comments = []; state.showComments = false; state.showSaveMenu = false;
  state._playerRendered = false;
  var vid = video.id || video.videoId;
  var entry = Object.assign({}, video, { id: vid, watchedAt: new Date().toISOString() });
  state.watchHistory = [entry].concat(state.watchHistory.filter(function(h){return (h.id||h.videoId)!==vid;})).slice(0, 100);
  localStorage.setItem('yt_focus_history', JSON.stringify(state.watchHistory));
  YT_API.getRating(vid).then(function(r) { state.playerRating = r; updateRatingButtons(); }).catch(function(){});
  render();        // update #app with tab content behind the player
  showPlayerFull(); // show #player-container in full mode
}

function closePlayer() {
  _playerIframe = null;
  state.player = null; state.miniPlayer = false; state._playerRendered = false;
  var c = document.getElementById('player-container');
  if (c) c.className = '';
  var slot = document.getElementById('player-embed-slot');
  if (slot) slot.innerHTML = '';
  render();
}

function setSpeed(s) {
  state.speed = s;
  sendPlayerCommand('setPlaybackRate', [s]);
  updateSpeedButtons();
}

function toggleCaptions() {
  state.captions = !state.captions;
  // Toggle captions via postMessage
  if (state.captions) {
    sendPlayerCommand('loadModule', ['captions']);
    sendPlayerCommand('setOption', ['captions', 'track', {'languageCode': 'en'}]);
  } else {
    sendPlayerCommand('unloadModule', ['captions']);
  }
  updateToggle('captionsToggle', state.captions);
}

function sendPlayerCommand(func, args) {
  var iframe = _playerIframe;
  if (!iframe || !iframe.contentWindow) return;
  try {
    iframe.contentWindow.postMessage(JSON.stringify({
      event: 'command', func: func, args: args || []
    }), '*');
  } catch(e) {}
}

function requestPiP() {
  var iframe = _playerIframe;
  if (!iframe) { showToast('No video playing'); return; }

  // Exit PiP if already active
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(function() {});
    return;
  }

  // Attempt 1: Standard requestPictureInPicture on the iframe itself
  // (some browsers allow this when allow="picture-in-picture" is set)
  if (typeof iframe.requestPictureInPicture === 'function') {
    iframe.requestPictureInPicture()
      .then(function() { state.pip = true; updateToggle('pipToggle', true); })
      .catch(function() { _pipFallback(iframe); });
    return;
  }

  _pipFallback(iframe);
}

function _pipFallback(iframe) {
  // Attempt 2: Access the <video> element inside the iframe.
  // On iOS Safari the YouTube embed runs same-process, so this occasionally
  // succeeds; on most browsers CORS will block it — the catch handles that.
  try {
    var doc = iframe.contentDocument ||
              (iframe.contentWindow && iframe.contentWindow.document);
    if (doc) {
      var video = doc.querySelector('video');
      if (video) {
        // iOS 14+ webkit API
        if (video.webkitSupportsPresentationMode &&
            video.webkitSupportsPresentationMode('picture-in-picture')) {
          video.webkitSetPresentationMode('picture-in-picture');
          state.pip = true;
          updateToggle('pipToggle', true);
          return;
        }
        // Standard API on the video element
        if (typeof video.requestPictureInPicture === 'function') {
          video.requestPictureInPicture()
            .then(function() { state.pip = true; updateToggle('pipToggle', true); })
            .catch(function() { _pipGuide(); });
          return;
        }
      }
    }
  } catch(e) {}

  _pipGuide();
}

function _pipGuide() {
  // The YouTube player renders its own native PiP button (⧉) in the
  // controls bar. Direct the user there — it works on iOS 14+ Safari.
  showToast('Tap the video, then tap ⧉ in the player controls for PiP');
  // Keep the toggle in sync so it doesn't show as "on" misleadingly
  state.pip = false;
  updateToggle('pipToggle', false);
}

// -- Targeted DOM updates for player (no iframe rebuild) --
function updateSpeedButtons() {
  var btns = document.querySelectorAll('.speed-btn');
  for (var i = 0; i < btns.length; i++) {
    var s = parseFloat(btns[i].dataset.speed);
    btns[i].className = 'speed-btn' + (state.speed === s ? ' active' : '');
  }
}

function updateToggle(id, on) {
  var el = $('#' + id);
  if (el) el.className = 'toggle-track' + (on ? ' on' : '');
}

function updateRatingButtons() {
  var likeBtn = $('#likeBtn');
  var dislikeBtn = $('#dislikeBtn');
  if (likeBtn) {
    var isLiked = state.playerRating === 'like';
    likeBtn.className = 'pill' + (isLiked ? ' active' : '');
    likeBtn.innerHTML = I.tUp(isLiked) + ' ' + (state.player && state.player.likes ? formatViewCount(state.player.likes + (isLiked ? 1 : 0)) : '');
  }
  if (dislikeBtn) {
    var isDisliked = state.playerRating === 'dislike';
    dislikeBtn.className = 'pill' + (isDisliked ? ' active' : '');
    dislikeBtn.innerHTML = I.tDown(isDisliked);
  }
}

function renderPlayerControls() {
  var container = document.getElementById('player-full-controls');
  if (!container || !state.player) return;
  container.innerHTML = buildPlayerControlsHTML();
}

async function rateVideo(rating) {
  if (!state.player) return;
  var prev = state.playerRating;
  state.playerRating = (prev === rating) ? 'none' : rating;
  updateRatingButtons();
  try {
    await apiCall(function() { return YT_API.rateVideo(state.player.id || state.player.videoId, state.playerRating); });
    showToast(state.playerRating === 'none' ? 'Rating removed' : state.playerRating === 'like' ? 'Liked' : 'Disliked');
  } catch (e) { state.playerRating = prev; updateRatingButtons(); showToast('Failed to rate'); }
}

async function loadComments() {
  if (!state.player) return;
  state.commentsLoading = true; renderPlayerControls();
  try { var r = await apiCall(function() { return YT_API.getComments(state.player.id || state.player.videoId); }); state.comments = r.comments; }
  catch (e) { state.comments = []; }
  state.commentsLoading = false; renderPlayerControls();
}

async function postComment() {
  var input = $('#commentInput'); if (!input || !input.value.trim() || !state.player) return;
  var text = input.value.trim(); input.value = '';
  try { var c = await apiCall(function() { return YT_API.postComment(state.player.id || state.player.videoId, text); }); state.comments.unshift(c); showToast('Comment posted'); }
  catch (e) { showToast('Failed to post comment'); }
  renderPlayerControls();
}

function likeComment(commentId) {
  for (var i = 0; i < state.comments.length; i++) {
    if (state.comments[i].id === commentId) {
      state.comments[i]._liked = !state.comments[i]._liked;
      state.comments[i].likes += state.comments[i]._liked ? 1 : -1;
      break;
    }
  }
  renderPlayerControls();
}

async function togglePlaylistSave(plId) {
  if (!state.player) return;
  try { await apiCall(function() { return YT_API.addToPlaylist(plId, state.player.id || state.player.videoId); }); showToast('Saved'); state.playlists = await YT_API.getPlaylists(); }
  catch (e) { showToast('Failed to save'); }
  renderPlayerControls();
}

async function viewPlaylist(plId) {
  state.viewingPlaylist = plId; render();
  if (!state.playlistItems[plId]) {
    try { var r = await apiCall(function() { return YT_API.getPlaylistItems(plId); }); state.playlistItems[plId] = r.items; }
    catch (e) { state.playlistItems[plId] = []; showToast('Failed to load playlist'); }
    render();
  }
}

async function createPlaylist(name) {
  try { var pl = await apiCall(function() { return YT_API.createPlaylist(name); }); state.playlists.push(pl); showToast('Created "' + name + '"'); }
  catch (e) { showToast('Failed to create playlist'); }
  render();
}

async function refreshFeed() {
  state.loading = true; render(); YT_API.clearCache();
  try {
    if (state.tab === 'subs') { await loadSubsFeedUI(); }
    else { await loadFeedVideos(); }
  } catch (e) { if (isAuthError(e)) return; showToast('Failed to refresh'); }
  state.loading = false; render();
}

async function loadSubsFeedUI() {
  if (!state.subscriptions.length) return;
  state._subsFeedVideos = null; render(); // show loading
  try {
    // Only load feed for first 20 channels alphabetically to save quota
    var limited = state.subscriptions.slice(0, 20);
    state._subsFeedVideos = await YT_API.getFeed(limited);
  } catch (e) { state._subsFeedVideos = []; showToast('Failed to load feed'); }
  render();
}

async function browseChannel(channelId, channelName) {
  state.browsingChannel = { id: channelId, name: channelName };
  state.browsingChannelVideos = []; state.browsingNextPage = null; state.browsingLoading = true;
  render();
  try {
    var r = await apiCall(function() { return YT_API.getChannelAllVideos(channelId); });
    state.browsingChannelVideos = r.videos; state.browsingNextPage = r.nextPageToken;
  } catch (e) { showToast('Failed to load channel'); }
  state.browsingLoading = false; render();
}

async function loadMoreChannelVideos() {
  if (!state.browsingChannel || !state.browsingNextPage || state.browsingLoading) return;
  state.browsingLoading = true; render();
  try {
    var r = await apiCall(function() { return YT_API.getChannelAllVideos(state.browsingChannel.id, state.browsingNextPage); });
    state.browsingChannelVideos = state.browsingChannelVideos.concat(r.videos); state.browsingNextPage = r.nextPageToken;
  } catch (e) { showToast('Failed to load more'); }
  state.browsingLoading = false; render();
}

function openChannelFromPlayer() {
  var v = state.player;
  if (v && v.channelId) { closePlayer(); browseChannel(v.channelId, v.channel); }
  else { showToast('Channel info not available'); }
}

function toggleFeedChannel(channelId) {
  var idx = state.feedChannelIds.indexOf(channelId);
  if (idx >= 0) state.feedChannelIds.splice(idx, 1);
  else state.feedChannelIds.push(channelId);
  saveFeedChannels();
  render();
  loadFeedVideos().then(function() { render(); });
}

// -- Icons --
var I = {
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  x: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>',
  play: '<svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" opacity=".35"><polygon points="5 3 19 12 5 21"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  block: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 14.14 14.14"/></svg>',
  tUp: function(f) { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="'+(f?'currentColor':'none')+'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3m7-2V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg>'; },
  tDown: function(f) { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="'+(f?'currentColor':'none')+'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="transform:scaleY(-1)"><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3m7-2V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg>'; },
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
  miniplayer: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="13" y="13" width="8" height="6" rx="1" fill="currentColor" stroke="none"/></svg>',
  expand: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
};

var LOGO = '<svg viewBox="0 0 380 85" width="116" height="26" style="display:block"><path d="M57.307 5.706C56.586 2.86 54.372.617 51.564-.116 47.043-1.32 29-1.32 29-1.32S10.957-1.32 6.436-.116C3.628.617 1.414 2.86.693 5.706-.495 10.285-.495 19.84-.495 19.84s0 9.555 1.188 14.134c.721 2.846 2.935 5.009 5.743 5.742C10.957 40.92 29 40.92 29 40.92s18.043 0 22.564-1.204c2.808-.733 5.022-2.896 5.743-5.742C58.495 29.395 58.495 19.84 58.495 19.84s0-9.555-1.188-14.134z" fill="#FF0000" transform="translate(2,22)"/><path d="M23.205 28.52V11.16l14.963 8.68-14.963 8.68z" fill="white" transform="translate(2,22)"/><text x="72" y="58" font-family="Roboto,Arial,sans-serif" font-size="38" font-weight="700" fill="currentColor" letter-spacing="-1.2">YouTube</text></svg>';

// -- Search --
// Updates only the video grid in the current tab without touching the search input
// (prevents keyboard dismissal on iOS)
function updateSearchFilter() {
  var grid = document.getElementById('videoGrid');
  if (!grid) return;
  var q = state.search.toLowerCase();
  var vids = [];
  if (state.tab === 'feed') {
    vids = state.videos;
    if (q) vids = vids.filter(function(v) { return v.title.toLowerCase().indexOf(q) >= 0 || v.channel.toLowerCase().indexOf(q) >= 0; });
  } else if (state.tab === 'subs' && Array.isArray(state._subsFeedVideos)) {
    vids = q ? state._subsFeedVideos.filter(function(v) { return v.title.toLowerCase().indexOf(q) >= 0 || v.channel.toLowerCase().indexOf(q) >= 0; }) : state._subsFeedVideos;
  } else {
    return;
  }
  grid.innerHTML = vids.length ? vids.map(videoCard).join('') : empty(I.search, 'No results', 'Try a different search.');
}

async function performSearch(query) {
  state.searchMode = true;
  state.searchResults = [];
  state.searchLoading = true;
  state.searchNextPage = null;
  render();
  try {
    var r = await apiCall(function() { return YT_API.search(query); });
    state.searchResults = r.videos;
    state.searchNextPage = r.nextPageToken;
  } catch (e) {
    showToast('Search failed: ' + (e.message || String(e)));
  }
  state.searchLoading = false;
  render();
}

async function searchLoadMore() {
  if (!state.searchNextPage || state.searchLoading) return;
  state.searchLoading = true;
  var grid = document.getElementById('videoGrid');
  if (grid) grid.insertAdjacentHTML('beforeend', '<div class="loading" style="grid-column:1/-1"><div class="spinner"></div></div>');
  try {
    var r = await apiCall(function() { return YT_API.search(state.search, state.searchNextPage); });
    state.searchResults = state.searchResults.concat(r.videos);
    state.searchNextPage = r.nextPageToken;
  } catch (e) {
    showToast('Failed to load more');
  }
  state.searchLoading = false;
  render();
}

// -- Render (full page -- used for navigation, NOT for player control changes) --
function render() {
  var app = $('#app');
  if (!state.authed) { app.innerHTML = renderSignIn(); return; }
  if (state._loadError && !state.loading) {
    app.innerHTML = '<div style="padding:40px 20px;text-align:center;font-family:Roboto,sans-serif"><h2 style="color:var(--red);margin-bottom:12px">Error</h2><p style="color:var(--dim);font-size:14px;margin-bottom:16px;word-break:break-all">' + esc(state._loadError) + '</p><button class="btn btn-confirm" data-action="retry-load">Retry</button> <button class="btn btn-cancel" data-action="signout">Sign Out</button></div>';
    return;
  }
  if (state.viewingPlaylist) { app.innerHTML = renderPlaylistView(); return; }
  if (state.browsingChannel) { app.innerHTML = renderChannelBrowse(); return; }

  var h = renderTopBar();
  if (state.searchMode) {
    h += renderSearchResults();
    h += renderNav();
    app.innerHTML = h;
    return;
  }
  if (state.tab === 'feed') h += renderFeed();
  else if (state.tab === 'subs') h += renderSubs();
  else if (state.tab === 'account') h += renderAccount();
  else if (state.tab === 'settings') h += renderSettings();
  h += renderNav();
  app.innerHTML = h;
}

function renderSignIn() {
  var debug = window._authDebug || '';
  return '<div class="signin-screen"><div class="signin-logo">' + LOGO + '</div>' +
    '<div class="signin-title">YouTube, Focused</div>' +
    '<div class="signin-desc">No Shorts. No algorithm. No suggested videos.<br>Just your subscriptions with full playback controls.</div>' +
    '<button class="signin-btn" data-action="signin">' + I.user + ' Sign in with Google</button>' +
    '<div class="signin-features">' +
      '<div class="signin-feature">' + I.block + ' Shorts permanently blocked</div>' +
      '<div class="signin-feature">' + I.block + ' No homepage algorithm</div>' +
      '<div class="signin-feature">' + I.chk + ' Your real subscriptions feed</div>' +
      '<div class="signin-feature">' + I.chk + ' Like, comment, save to playlists</div>' +
      '<div class="signin-feature">' + I.chk + ' Adjustable speed 0.1×–5×, captions, PiP</div>' +
    '</div>' +
    (debug ? '<div style="margin-top:24px;padding:12px;background:var(--s1);border:1px solid var(--border);border-radius:8px;width:100%;max-width:340px;text-align:left"><div style="font-size:11px;font-weight:600;color:var(--dim);text-transform:uppercase;margin-bottom:6px">Auth Debug</div><pre style="font-size:10px;color:var(--faint);font-family:monospace;white-space:pre-wrap;word-break:break-all">' + esc(debug) + '</pre></div>' : '') +
    '<div style="margin-top:12px;font-size:10px;color:var(--faint);font-family:monospace">' + (window.YT_FOCUS_VERSION || 'unknown') + '</div>' +
    '</div>';
}

function renderTopBar() {
  return '<div class="top-bar"><div class="logo-wrap">' + LOGO + '</div>' +
    '<div class="search-wrap">' +
    '<button class="icon-btn small" data-action="do-search" style="flex-shrink:0;padding:4px;margin-right:2px" title="Search">' + I.search + '</button>' +
    '<input type="search" inputmode="search" enterkeyhint="search" id="searchInput" placeholder="Search YouTube..." value="' + esc(state.search) + '" autocomplete="off">' +
    (state.search ? '<button class="icon-btn small" data-action="clear-search">' + I.x + '</button>' : '') +
    '</div>' +
    (state.searchMode ? '' : '<button class="icon-btn" data-action="refresh-feed" title="Refresh">' + I.refresh + '</button>') +
    '</div>';
}

function renderSearchResults() {
  if (state.searchLoading) return '<div class="loading"><div class="spinner"></div> Searching...</div>';
  var h = '<div style="padding:10px 12px 4px;display:flex;align-items:center;gap:8px">' +
    '<div class="section-title" style="flex:1">Results for \u201c' + esc(state.search) + '\u201d</div></div>';
  h += '<div id="videoGrid" class="feed-grid">';
  if (state.searchResults.length) {
    h += state.searchResults.map(videoCard).join('');
  } else {
    h += empty(I.search, 'No results', 'Try a different search term.');
  }
  h += '</div>';
  if (state.searchNextPage && !state.searchLoading) {
    h += '<div style="padding:16px;text-align:center"><button class="btn btn-cancel" data-action="search-load-more" style="width:100%">Load more results</button></div>';
  }
  return h;
}

function renderNav() {
  var tabs = [['feed','Feed',I.home],['subs','Subscriptions',I.subs],['account','You',I.user],['settings','Settings',I.gear]];
  var h = '<div class="bottom-nav">';
  for (var i = 0; i < tabs.length; i++) {
    h += '<button class="nav-item ' + (state.tab===tabs[i][0]?'active':'') + '" data-action="set-tab" data-tab="' + tabs[i][0] + '">' + tabs[i][2] + '<span>' + tabs[i][1] + '</span></button>';
  }
  return h + '</div>';
}

function videoCard(v) {
  var vid = v.id || v.videoId, thumb = v.thumbnail || v.thumbnailHigh;
  var views = v.views ? formatViewCount(v.views) : '', age = v.publishedAt ? timeAgo(v.publishedAt) : (v.age||'');
  var durationBadge = v.membersOnly
    ? '<div class="video-duration" style="background:rgba(255,180,0,.85)">Members</div>'
    : (v.duration ? '<div class="video-duration">'+v.duration+'</div>' : '');
  return '<div class="video-card" data-action="open-player" data-video-id="' + vid + '">' +
    '<div class="video-thumb">' + (thumb ? '<img src="'+thumb+'" alt="" loading="lazy">' : '<div class="placeholder">'+I.play+'</div>') +
    durationBadge + '</div>' +
    '<div class="video-info"><div class="video-title">' + esc(v.title) + '</div>' +
    '<div class="video-meta"><span>' + esc(v.channel) + '</span>' +
    (views ? '<span class="meta-dot"></span><span>' + views + ' views</span>' : '') +
    (age ? '<span class="meta-dot"></span><span>' + age + '</span>' : '') +
    '</div></div></div>';
}

function empty(icon, title, desc) {
  return '<div class="empty-state"><div class="empty-icon">' + icon + '</div><div class="empty-title">' + title + '</div><div class="empty-desc">' + desc + '</div></div>';
}

// -- Feed --
function renderFeed() {
  if (state.loading) return '<div class="loading"><div class="spinner"></div> Loading...</div>';
  var q = state.search.toLowerCase();
  var vids = state.videos;
  if (q) vids = vids.filter(function(v) { return v.title.toLowerCase().indexOf(q) >= 0 || v.channel.toLowerCase().indexOf(q) >= 0; });

  var h = '<div style="padding:10px 12px 0;display:flex;align-items:center;justify-content:space-between">' +
    '<div class="section-title">Your Feed' + (state.feedChannelIds.length ? ' (' + state.feedChannelIds.length + ' channels)' : '') + '</div>' +
    '<button class="add-btn" data-action="show-channel-picker">' + I.filter + ' Select Channels</button></div>';

  if (state.showChannelPicker) {
    h += '<div style="padding:8px 12px;max-height:240px;overflow-y:auto;border-bottom:1px solid var(--border)">';
    for (var i = 0; i < state.subscriptions.length; i++) {
      var ch = state.subscriptions[i];
      var sel = state.feedChannelIds.indexOf(ch.id) >= 0;
      h += '<div class="save-item" data-action="toggle-feed-channel" data-channel-id="' + ch.id + '" style="padding:8px 0">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
        '<div style="width:28px;height:28px;border-radius:50%;overflow:hidden;background:var(--s2);flex-shrink:0;display:grid;place-items:center">' +
        (ch.thumbnail ? '<img src="'+ch.thumbnail+'" style="width:100%;height:100%;object-fit:cover">' : '<span style="font-size:11px;font-weight:700;color:var(--red)">' + ch.name[0] + '</span>') +
        '</div><span style="font-size:13px">' + esc(ch.name) + '</span></div>' +
        '<div class="checkbox ' + (sel?'checked':'') + '">' + (sel?I.chk:'') + '</div></div>';
    }
    h += '</div>';
  }

  h += '<div id="videoGrid" class="feed-grid">' + (vids.length ? vids.map(videoCard).join('') : empty(I.home, state.feedChannelIds.length ? 'No videos yet' : 'No channels selected', state.feedChannelIds.length ? 'Try refreshing.' : 'Tap "Select Channels" to pick channels for your feed.')) + '</div>';
  return h;
}

// -- Subscriptions --
function renderSubs() {
  if (state.loading) return '<div class="loading"><div class="spinner"></div> Loading...</div>';
  var q = state.search.toLowerCase();

  var h = '<div style="padding:10px 12px 4px"><div class="section-title">Channels (' + state.subscriptions.length + ')</div></div>';
  h += '<div style="display:flex;gap:8px;padding:4px 12px 12px;overflow-x:auto;-webkit-overflow-scrolling:touch">';
  for (var i = 0; i < state.subscriptions.length; i++) {
    var ch = state.subscriptions[i];
    h += '<div data-action="browse-channel" data-channel-id="' + ch.id + '" data-channel-name="' + esc(ch.name) + '" style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:4px;width:64px;cursor:pointer">' +
      '<div style="width:48px;height:48px;border-radius:50%;overflow:hidden;background:var(--s2);display:grid;place-items:center">' +
      (ch.thumbnail ? '<img src="'+ch.thumbnail+'" style="width:100%;height:100%;object-fit:cover">' : '<span style="font-size:15px;font-weight:700;color:var(--red)">'+ch.name[0]+'</span>') +
      '</div><span style="font-size:10px;color:var(--dim);text-align:center;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(ch.name)+'</span></div>';
  }
  h += '</div>';

  var allVids = state._subsFeedVideos;
  if (allVids === undefined || allVids === null) {
    h += '<div style="text-align:center;padding:20px"><button class="btn btn-confirm" data-action="load-subs-feed">Load Recent Videos</button><p style="font-size:11px;color:var(--faint);margin-top:8px">Loads videos from your first 20 channels (~40 API units)</p></div>';
  } else if (allVids.length === 0) {
    h += empty(I.subs, 'No videos found', 'No recent uploads from your subscriptions.');
  } else {
    var filtered = q ? allVids.filter(function(v) { return v.title.toLowerCase().indexOf(q) >= 0 || v.channel.toLowerCase().indexOf(q) >= 0; }) : allVids;
    h += '<div style="padding:0 12px 4px"><div class="section-title">Recent uploads</div></div>';
    h += '<div id="videoGrid" class="feed-grid">' + (filtered.length ? filtered.map(videoCard).join('') : empty(I.search, 'No results', 'Try a different search.')) + '</div>';
  }
  return h;
}

// -- Channel Browse --
function renderChannelBrowse() {
  var ch = state.browsingChannel;
  var h = '<div class="top-bar"><button class="icon-btn" data-action="back-browse">' + I.back + '</button><div style="flex:1;font-size:16px;font-weight:600">' + esc(ch.name) + '</div></div>';
  h += '<div style="padding:6px 12px;background:rgba(255,180,0,.06);border-bottom:1px solid rgba(255,180,0,.15)">' +
    '<p style="font-size:11px;color:rgba(210,160,60,1);line-height:1.4">Members-only videos cannot be listed via YouTube\'s public API, even for paid subscribers. Use the YouTube app to access exclusive content.</p></div>';
  h += '<div class="feed-grid">';
  if (state.browsingChannelVideos.length) h += state.browsingChannelVideos.map(videoCard).join('');
  else if (state.browsingLoading) h += '<div class="loading" style="grid-column:1/-1"><div class="spinner"></div> Loading...</div>';
  else h += empty(I.home, 'No videos', 'No long-form videos found.');
  h += '</div>';
  if (state.browsingNextPage && !state.browsingLoading) {
    h += '<div style="padding:16px;text-align:center"><button class="btn btn-cancel" data-action="load-more-channel" style="width:100%">Load more</button></div>';
  }
  if (state.browsingLoading && state.browsingChannelVideos.length) h += '<div class="loading"><div class="spinner"></div></div>';
  return h;
}

// -- Player (iframe lives permanently in #player-container; CSS class switches modes) --
// iOS Safari reloads iframes on DOM re-parent. By keeping the iframe in one fixed
// container and only toggling CSS classes, playback is never interrupted.

function showPlayerFull() {
  if (!state.player) return;
  var v = state.player, vid = v.id || v.videoId, cc = state.captions ? 1 : 0;
  var c = document.getElementById('player-container');
  var ph = document.getElementById('player-ph');
  var slot = document.getElementById('player-embed-slot');
  var fc = document.getElementById('player-full-controls');
  var mb = document.getElementById('player-mini-bar');
  if (!c || !ph || !slot || !fc || !mb) return;

  ph.innerHTML =
    '<button class="icon-btn" data-action="close-player">' + I.back + '</button>' +
    '<div style="flex:1;font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(v.channel) + '</div>' +
    '<button class="icon-btn" data-action="minimize-player" title="Miniplayer">' + I.miniplayer + '</button>';

  if (!_playerIframe) {
    var iframe = document.createElement('iframe');
    iframe.id = 'ytplayer';
    iframe.dataset.vid = vid;
    iframe.setAttribute('allow', 'autoplay; picture-in-picture; encrypted-media; fullscreen');
    iframe.setAttribute('allowfullscreen', '');
    iframe.src = 'https://www.youtube.com/embed/' + vid +
      '?rel=0&modestbranding=1&cc_load_policy=' + cc +
      '&playsinline=1&autoplay=1&enablejsapi=1&origin=' +
      encodeURIComponent(window.location.origin);
    slot.appendChild(iframe);
    _playerIframe = iframe;
  }

  fc.innerHTML = buildPlayerControlsHTML();
  ph.style.display = '';
  fc.style.display = '';
  mb.style.display = 'none';
  c.className = 'mode-full';
  state._playerRendered = true;
}

function minimizePlayer() {
  if (!state.player) return;
  state.miniPlayer = true;
  var c = document.getElementById('player-container');
  var ph = document.getElementById('player-ph');
  var fc = document.getElementById('player-full-controls');
  var mb = document.getElementById('player-mini-bar');
  if (!c) return;
  // CSS class handles hiding ph/fc and making container small — no DOM moves
  c.className = 'mode-mini';
  if (ph) ph.style.display = 'none';
  if (fc) fc.style.display = 'none';
  if (mb) {
    mb.innerHTML =
      '<span class="mini-title">' + esc(state.player.title) + '</span>' +
      '<button class="icon-btn small" data-action="expand-player" title="Expand">' + I.expand + '</button>' +
      '<button class="icon-btn small" data-action="close-mini-player" title="Close">' + I.x + '</button>';
    mb.style.display = 'flex';
  }
  render(); // update #app with tab content now visible behind the mini
}

function expandMiniPlayer() {
  if (!state.player) return;
  state.miniPlayer = false;
  showPlayerFull();
}

function closeMiniPlayer() {
  _playerIframe = null;
  state.player = null; state.miniPlayer = false;
  var c = document.getElementById('player-container');
  if (c) c.className = '';
  var slot = document.getElementById('player-embed-slot');
  if (slot) slot.innerHTML = '';
  render();
}

function buildPlayerControlsHTML() {
  var v = state.player; if (!v) return '';
  var vid = v.id || v.videoId;
  var isLiked = state.playerRating === 'like', isDisliked = state.playerRating === 'dislike';
  var likeN = v.likes ? formatViewCount(v.likes + (isLiked ? 1 : 0)) : '';

  var h = '<div class="player-info">' +
    '<div class="player-title">' + esc(v.title) + '</div>' +
    '<div class="player-meta"><span data-action="open-channel-from-player" style="cursor:pointer;text-decoration:underline;color:var(--dim)">' + esc(v.channel) + '</span> · ' +
    (v.views ? formatViewCount(v.views) + ' views' : '') + ' · ' + (v.publishedAt ? timeAgo(v.publishedAt) : (v.age||'')) + '</div>' +
    '<div class="action-bar">' +
      '<button id="likeBtn" class="pill ' + (isLiked?'active':'') + '" data-action="like">' + I.tUp(isLiked) + ' ' + likeN + '</button>' +
      '<button id="dislikeBtn" class="pill ' + (isDisliked?'active':'') + '" data-action="dislike">' + I.tDown(isDisliked) + '</button>' +
      '<button class="pill ' + (state.showSaveMenu?'active':'') + '" data-action="toggle-save-menu">' + I.save + ' Save</button>' +
      '<button class="pill ' + (state.showComments?'active':'') + '" data-action="toggle-comments">' + I.comment + ' ' + (v.commentCount||'') + '</button>' +
    '</div></div>';

  // Save panel
  if (state.showSaveMenu) {
    h += '<div class="save-panel"><div class="control-label">Save to Playlist</div>';
    for (var i = 0; i < state.playlists.length; i++) {
      var pl = state.playlists[i];
      h += '<div class="save-item" data-action="toggle-playlist-save" data-playlist-id="' + pl.id + '"><span class="name">' + esc(pl.title||pl.name) + '</span><div class="checkbox"><span style="opacity:0.5">' + I.plus + '</span></div></div>';
    }
    h += '<button class="btn btn-text" data-action="create-playlist-modal">' + I.plus + ' New playlist</button></div>';
  }

  // Comments panel
  if (state.showComments) {
    h += '<div class="comments-panel"><div class="control-label">Comments</div>' +
      '<div class="comment-input-row"><div class="comment-avatar"><span class="letter">Y</span></div>' +
      '<div style="flex:1;display:flex;gap:6px"><input class="modal-input" id="commentInput" placeholder="Add a comment..." style="margin:0;border-radius:20px;padding:8px 14px;font-size:13px;flex:1">' +
      '<button class="btn btn-confirm" style="border-radius:20px;padding:8px 14px;font-size:13px" data-action="post-comment">Post</button></div></div>';
    if (state.commentsLoading) h += '<div class="loading"><div class="spinner"></div></div>';
    for (var j = 0; j < state.comments.length; j++) {
      var cm = state.comments[j];
      h += '<div class="comment-item"><div class="avatar">' + (cm.authorImage ? '<img src="'+cm.authorImage+'">' : '<span class="letter">'+(cm.author||'U')[0]+'</span>') + '</div><div class="comment-body">' +
        '<div class="comment-author"><span class="name ' + (cm.isOwn?'own':'') + '">' + esc(cm.author) + '</span> · ' + (cm.publishedAt ? timeAgo(cm.publishedAt) : 'Just now') + '</div>' +
        '<div class="comment-text">' + esc(cm.text) + '</div>' +
        '<button class="comment-like-btn ' + (cm._liked?'liked':'') + '" data-action="like-comment" data-comment-id="' + cm.id + '">' + I.tUp(cm._liked) + ' ' + cm.likes + '</button></div></div>';
    }
    h += '</div>';
  }

  // Speed + options
  h += '<div class="player-controls"><div class="control-card"><div class="control-label">Playback Speed</div><div class="speed-row">';
  for (var k = 0; k < SPEEDS.length; k++) {
    h += '<button class="speed-btn ' + (state.speed===SPEEDS[k]?'active':'') + '" data-action="set-speed" data-speed="' + SPEEDS[k] + '">' + SPEEDS[k] + '×</button>';
  }
  h += '</div></div>';

  h += '<div class="control-card"><div class="control-label">Options</div>' +
    '<div class="toggle-row"><span class="toggle-label">Captions</span><div id="captionsToggle" class="toggle-track ' + (state.captions?'on':'') + '" data-action="toggle-captions"><div class="toggle-knob"></div></div></div>' +
    '<div class="toggle-row"><span class="toggle-label">Picture in Picture</span>' +
    '<button class="pill" data-action="open-pip-guide" style="font-size:12px">How to use PiP</button></div>' +
    '</div>';

  if (state.showPipGuide) {
    h += '<div class="pip-guide-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<strong style="font-size:14px">Picture in Picture</strong>' +
      '<button class="icon-btn small" data-action="close-pip-guide">' + I.x + '</button></div>' +
      '<p style="font-size:13px;color:var(--dim);line-height:1.6;margin-bottom:12px">YouTube\'s built-in PiP button requires a Premium subscription. Use iOS\'s native PiP instead:</p>' +
      '<div style="font-size:13px;color:var(--text);line-height:2;margin-bottom:12px">' +
      '<div style="margin-bottom:6px"><strong>1.</strong> Start playing the video</div>' +
      '<div style="margin-bottom:6px"><strong>2.</strong> Swipe up from the bottom (or press Home) to go to the Home Screen</div>' +
      '<div><strong>3.</strong> iOS will automatically float the video in a PiP window</div>' +
      '</div>' +
      '<p style="font-size:11px;color:var(--faint);line-height:1.5">Requires iOS 14+. Make sure Settings → General → Picture in Picture is enabled. Tap the PiP window to bring the app back.</p>' +
      '</div>';
  }

  h += '</div>';

  return h;
}

// -- Account --
function renderAccount() {
  var p = state.userProfile, name = p ? p.name : 'Your Account', thumb = p ? p.thumbnail : '';
  var h = '<div class="account-header"><div class="account-avatar">' + (thumb ? '<img src="'+thumb+'">' : '<span class="letter">'+name[0].toUpperCase()+'</span>') + '</div><div><div class="account-name">' + esc(name) + '</div><div class="account-stats">' + state.subscriptions.length + ' subscriptions · ' + state.playlists.length + ' playlists</div></div></div>' +
    '<div class="sub-tabs"><button class="sub-tab ' + (state.accountSub==='history'?'active':'') + '" data-action="set-account-sub" data-sub="history">' + I.hist + ' History</button>' +
    '<button class="sub-tab ' + (state.accountSub==='playlists'?'active':'') + '" data-action="set-account-sub" data-sub="playlists">' + I.list + ' Playlists</button></div>';

  if (state.accountSub === 'history') {
    h += '<div class="feed-grid">' + (state.watchHistory.length ? state.watchHistory.map(videoCard).join('') : empty(I.hist,'No watch history','Videos you watch will appear here.')) + '</div>';
  } else {
    h += '<div style="padding:12px">';
    for (var i = 0; i < state.playlists.length; i++) {
      var pl = state.playlists[i];
      h += '<div class="playlist-row" data-action="view-playlist" data-playlist-id="' + pl.id + '"><div><div class="playlist-name">' + esc(pl.title||pl.name) + '</div><div class="playlist-count">' + (pl.itemCount||0) + ' videos</div></div>' + I.chev + '</div>';
    }
    h += '<button class="btn btn-text" data-action="create-playlist-modal">' + I.plus + ' Create new playlist</button></div>';
  }
  return h;
}

function renderPlaylistView() {
  var pl = null;
  for (var i = 0; i < state.playlists.length; i++) { if (state.playlists[i].id === state.viewingPlaylist) { pl = state.playlists[i]; break; } }
  var items = state.playlistItems[state.viewingPlaylist] || [];
  var h = '<div class="top-bar"><button class="icon-btn" data-action="back-playlist">' + I.back + '</button><div style="flex:1;font-size:16px;font-weight:600">' + esc(pl ? (pl.title||pl.name) : 'Playlist') + '</div><span style="font-size:13px;color:var(--dim)">' + items.length + ' videos</span></div>';
  h += '<div class="feed-grid">';
  if (items.length) {
    for (var j = 0; j < items.length; j++) {
      h += videoCard({ id: items[j].videoId, videoId: items[j].videoId, title: items[j].title, channel: items[j].channel||'', thumbnail: items[j].thumbnail, publishedAt: items[j].publishedAt });
    }
  } else { h += empty(I.save, 'No videos yet', 'Save videos from the player.'); }
  h += '</div>';
  return h;
}

function renderSettings() {
  var blocked = ['YouTube Shorts','Suggested Videos','Homepage Algorithm','Trending','Autoplay'];
  var h = '<div class="settings-panel">';
  h += '<div class="settings-card"><h3>Blocked Content</h3><p>Permanently hidden.</p>';
  for (var i = 0; i < blocked.length; i++) h += '<span class="blocked-tag">' + I.block + ' ' + blocked[i] + '</span>';
  h += '</div>';
  h += '<div class="settings-card"><h3>Focus Stats</h3>';
  var stats = [['Shorts Blocked','∞','green'],['Algorithm Bypasses','∞','green'],['Channels',''+state.subscriptions.length,''],['Watched',''+state.watchHistory.length,''],['Playlists',''+state.playlists.length,'']];
  for (var j = 0; j < stats.length; j++) h += '<div class="stat-row"><span class="stat-label">'+stats[j][0]+'</span><span class="stat-value '+stats[j][2]+'">'+stats[j][1]+'</span></div>';
  h += '</div>';
  h += '<div class="settings-card"><h3>Account</h3><p>Signed in as <strong>' + esc(state.userProfile ? state.userProfile.name : 'loading...') + '</strong></p><button class="btn btn-cancel" data-action="signout">Sign Out</button></div>';
  h += '<div class="settings-card"><h3>Quota Optimization</h3><p style="font-size:12px;color:var(--dim);line-height:1.6">This app uses ~2 API units per channel (vs 100 in v3). With 10 selected channels, a feed load costs ~20 units. Your daily limit is 10,000 units.</p><button class="btn btn-cancel" data-action="clear-subs-cache" style="margin-top:8px">Refresh Subscription List</button></div>';
  h += '<div class="settings-card"><h3>Install as App</h3><div style="font-size:13px;color:var(--dim);line-height:1.7"><strong style="color:var(--text)">Safari:</strong> Tap Share → "Add to Home Screen"</div></div>';
  h += '<div style="text-align:center;padding:8px;font-size:10px;color:var(--faint);font-family:monospace">' + (window.YT_FOCUS_VERSION || 'unknown') + '</div>';
  h += '</div>';
  return h;
}

document.addEventListener('DOMContentLoaded', init);
