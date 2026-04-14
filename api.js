// ============================================================
// YouTube Focus v4 — API Module (Quota-Optimized)
// ============================================================
// Key optimization: uses playlistItems.list (1 unit/call) instead
// of search.list (100 units/call) for fetching channel videos.
// Each YouTube channel has an "uploads" playlist with ID = 'UU' + channelId.substring(2)
// ============================================================

var YT_API = {
  _token: null,
  _cache: new Map(),

  setToken: function(t) { this._token = t; },

  _cacheKey: function(ep, p) { return ep + '?' + new URLSearchParams(p).toString(); },

  _getCache: function(key) {
    var e = this._cache.get(key);
    if (!e) return null;
    if (Date.now() - e.time > CONFIG.CACHE_DURATION_MINUTES * 60000) { this._cache.delete(key); return null; }
    return e.data;
  },

  _fetch: async function(endpoint, params, method, body) {
    if (!method) method = 'GET';
    if (!params) params = {};
    if (!this._token) throw new Error('Not authenticated');
    var url = new URL(CONFIG.API_BASE + '/' + endpoint);
    if (method === 'GET') {
      var keys = Object.keys(params);
      for (var i = 0; i < keys.length; i++) url.searchParams.set(keys[i], params[keys[i]]);
    }

    var opts = { method: method, headers: { 'Authorization': 'Bearer ' + this._token, 'Accept': 'application/json' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }

    if (method === 'GET') {
      var ck = this._cacheKey(endpoint, params);
      var cached = this._getCache(ck);
      if (cached) return cached;
    }

    var resp = await fetch(url.toString(), opts);
    if (!resp.ok) {
      var err = await resp.json().catch(function() { return {}; });
      throw new Error((err && err.error && err.error.message) || 'API error: ' + resp.status);
    }

    var data = method === 'DELETE' ? null : await resp.json();
    if (method === 'GET' && data) this._cache.set(this._cacheKey(endpoint, params), { data: data, time: Date.now() });
    return data;
  },

  // ── Subscriptions (cached to localStorage) ──
  // Cost: ~4 calls for 200 subs = 4 units
  getAllSubscriptions: async function() {
    // Check localStorage cache first (valid for 6 hours)
    try {
      var cached = JSON.parse(localStorage.getItem('yt_subs_cache') || 'null');
      if (cached && cached.time && Date.now() - cached.time < 6 * 3600000) {
        return cached.data;
      }
    } catch(e) {}

    var all = [], pt = null;
    do {
      var p = { part: 'snippet', mine: 'true', maxResults: '50', order: 'alphabetical' };
      if (pt) p.pageToken = pt;
      var r = await this._fetch('subscriptions', p);
      for (var i = 0; i < r.items.length; i++) {
        var item = r.items[i];
        var chId = item.snippet.resourceId.channelId;
        all.push({
          id: chId,
          name: item.snippet.title,
          thumbnail: (item.snippet.thumbnails && item.snippet.thumbnails.default && item.snippet.thumbnails.default.url) || '',
          // Uploads playlist ID = replace 'UC' prefix with 'UU'
          uploadsPlaylistId: 'UU' + chId.substring(2),
        });
      }
      pt = r.nextPageToken || null;
    } while (pt);

    // Cache to localStorage
    try {
      localStorage.setItem('yt_subs_cache', JSON.stringify({ data: all, time: Date.now() }));
    } catch(e) {}

    return all;
  },

  // ── Channel Videos via Uploads Playlist ──
  // Cost: 1 unit per call (vs 100 for search.list!)
  getChannelVideos: async function(channel, maxResults) {
    if (!maxResults) maxResults = CONFIG.VIDEOS_PER_CHANNEL;
    var playlistId = channel.uploadsPlaylistId || ('UU' + channel.id.substring(2));

    var r = await this._fetch('playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: playlistId,
      maxResults: String(maxResults + 5) // extra to filter shorts
    });

    if (!r.items || !r.items.length) return [];

    // Get video details for duration + stats (1 unit, batched)
    var videoIds = [];
    for (var i = 0; i < r.items.length; i++) {
      if (r.items[i].contentDetails && r.items[i].contentDetails.videoId) {
        videoIds.push(r.items[i].contentDetails.videoId);
      }
    }
    if (!videoIds.length) return [];

    var d = await this._fetch('videos', {
      part: 'contentDetails,statistics,snippet',
      id: videoIds.join(',')
    });

    var results = [];
    for (var j = 0; j < d.items.length; j++) {
      var v = d.items[j];
      var seconds = parseDuration(v.contentDetails.duration);
      if (seconds <= 60) continue; // Filter shorts
      if (results.length >= maxResults) break;
      results.push({
        id: v.id,
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        channelId: v.snippet.channelId,
        thumbnail: (v.snippet.thumbnails && v.snippet.thumbnails.medium && v.snippet.thumbnails.medium.url) || '',
        thumbnailHigh: (v.snippet.thumbnails && v.snippet.thumbnails.high && v.snippet.thumbnails.high.url) || '',
        publishedAt: v.snippet.publishedAt,
        duration: formatDuration(v.contentDetails.duration),
        views: (v.statistics && v.statistics.viewCount) || '0',
        likes: parseInt((v.statistics && v.statistics.likeCount) || '0', 10),
        commentCount: parseInt((v.statistics && v.statistics.commentCount) || '0', 10),
      });
    }
    return results;
  },

  // ── Browse all videos from a channel (paginated) ──
  // Cost: 2 units per page (playlistItems + videos)
  getChannelAllVideos: async function(channelId, pageToken) {
    var playlistId = 'UU' + channelId.substring(2);
    var p = { part: 'snippet,contentDetails', playlistId: playlistId, maxResults: '20' };
    if (pageToken) p.pageToken = pageToken;

    var r = await this._fetch('playlistItems', p);
    var videoIds = [];
    for (var i = 0; i < r.items.length; i++) {
      if (r.items[i].contentDetails && r.items[i].contentDetails.videoId) {
        videoIds.push(r.items[i].contentDetails.videoId);
      }
    }
    if (!videoIds.length) return { videos: [], nextPageToken: null };

    var d = await this._fetch('videos', { part: 'contentDetails,statistics,snippet', id: videoIds.join(',') });
    var videos = [];
    for (var j = 0; j < d.items.length; j++) {
      var v = d.items[j];
      if (parseDuration(v.contentDetails.duration) <= 60) continue;
      videos.push({
        id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle,
        channelId: v.snippet.channelId,
        thumbnail: (v.snippet.thumbnails && v.snippet.thumbnails.medium && v.snippet.thumbnails.medium.url) || '',
        publishedAt: v.snippet.publishedAt,
        duration: formatDuration(v.contentDetails.duration),
        views: (v.statistics && v.statistics.viewCount) || '0',
        likes: parseInt((v.statistics && v.statistics.likeCount) || '0', 10),
        commentCount: parseInt((v.statistics && v.statistics.commentCount) || '0', 10),
      });
    }
    return { videos: videos, nextPageToken: r.nextPageToken || null };
  },

  // ── Feed (only selected channels) ──
  // Cost: ~2 units per channel (playlistItems + videos batch)
  getFeed: async function(channels) {
    var all = [];
    var batchSize = 5;
    for (var i = 0; i < channels.length; i += batchSize) {
      var batch = channels.slice(i, i + batchSize);
      var results = await Promise.allSettled(
        batch.map(function(ch) { return YT_API.getChannelVideos(ch, CONFIG.VIDEOS_PER_CHANNEL); })
      );
      for (var j = 0; j < results.length; j++) {
        if (results[j].status === 'fulfilled' && results[j].value) {
          all = all.concat(results[j].value);
        }
      }
    }
    all.sort(function(a, b) { return new Date(b.publishedAt) - new Date(a.publishedAt); });
    return all;
  },

  // ── Ratings ── (1 unit each)
  rateVideo: async function(videoId, rating) {
    await this._fetch('videos/rate', { id: videoId, rating: rating }, 'POST');
  },
  getRating: async function(videoId) {
    var r = await this._fetch('videos/getRating', { id: videoId });
    return (r.items && r.items[0] && r.items[0].rating) || 'none';
  },

  // ── Comments ── (1 unit each)
  getComments: async function(videoId, pageToken) {
    var p = { part: 'snippet', videoId: videoId, maxResults: String(CONFIG.COMMENTS_PAGE_SIZE), order: 'relevance', textFormat: 'plainText' };
    if (pageToken) p.pageToken = pageToken;
    try {
      var r = await this._fetch('commentThreads', p);
      var comments = [];
      for (var i = 0; i < r.items.length; i++) {
        var s = r.items[i].snippet.topLevelComment.snippet;
        comments.push({ id: r.items[i].id, author: s.authorDisplayName, authorImage: s.authorProfileImageUrl, text: s.textDisplay, likes: s.likeCount, publishedAt: s.publishedAt, isOwn: false });
      }
      return { comments: comments, nextPageToken: r.nextPageToken || null };
    } catch (e) { return { comments: [], nextPageToken: null }; }
  },

  postComment: async function(videoId, text) {
    var r = await this._fetch('commentThreads', { part: 'snippet' }, 'POST', { snippet: { videoId: videoId, topLevelComment: { snippet: { textOriginal: text } } } });
    var s = r.snippet.topLevelComment.snippet;
    return { id: r.id, author: s.authorDisplayName, authorImage: s.authorProfileImageUrl, text: s.textDisplay, likes: 0, publishedAt: s.publishedAt, isOwn: true };
  },

  // ── Playlists ── (1 unit)
  getPlaylists: async function() {
    var r = await this._fetch('playlists', { part: 'snippet,contentDetails', mine: 'true', maxResults: '50' });
    var out = [];
    for (var i = 0; i < r.items.length; i++) {
      var p = r.items[i];
      out.push({ id: p.id, title: p.snippet.title, itemCount: p.contentDetails.itemCount, thumbnail: (p.snippet.thumbnails && p.snippet.thumbnails.medium && p.snippet.thumbnails.medium.url) || '' });
    }
    return out;
  },

  getPlaylistItems: async function(playlistId, pageToken) {
    var p = { part: 'snippet,contentDetails', playlistId: playlistId, maxResults: '50' };
    if (pageToken) p.pageToken = pageToken;
    var r = await this._fetch('playlistItems', p);
    var items = [];
    for (var i = 0; i < r.items.length; i++) {
      var it = r.items[i];
      items.push({ id: it.id, videoId: it.contentDetails.videoId, title: it.snippet.title, channel: it.snippet.videoOwnerChannelTitle || '', thumbnail: (it.snippet.thumbnails && it.snippet.thumbnails.medium && it.snippet.thumbnails.medium.url) || '', publishedAt: it.snippet.publishedAt });
    }
    return { items: items, nextPageToken: r.nextPageToken || null };
  },

  addToPlaylist: async function(playlistId, videoId) {
    return this._fetch('playlistItems', { part: 'snippet' }, 'POST', { snippet: { playlistId: playlistId, resourceId: { kind: 'youtube#video', videoId: videoId } } });
  },

  createPlaylist: async function(title) {
    var r = await this._fetch('playlists', { part: 'snippet,status' }, 'POST', { snippet: { title: title }, status: { privacyStatus: 'private' } });
    return { id: r.id, title: r.snippet.title, itemCount: 0 };
  },

  // ── Search ── (100 units for search.list + 1 unit for videos.list)
  search: async function(query, pageToken) {
    var p = { part: 'snippet', q: query, type: 'video', maxResults: '20', safeSearch: 'none' };
    if (pageToken) p.pageToken = pageToken;
    var r = await this._fetch('search', p);
    if (!r.items || !r.items.length) return { videos: [], nextPageToken: null };

    var videoIds = [];
    for (var i = 0; i < r.items.length; i++) {
      if (r.items[i].id && r.items[i].id.videoId) videoIds.push(r.items[i].id.videoId);
    }
    if (!videoIds.length) return { videos: [], nextPageToken: null };

    var d = await this._fetch('videos', { part: 'contentDetails,statistics,snippet', id: videoIds.join(',') });
    var results = [];
    for (var j = 0; j < d.items.length; j++) {
      var v = d.items[j];
      if (parseDuration(v.contentDetails.duration) <= 60) continue; // filter Shorts
      results.push({
        id: v.id,
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        channelId: v.snippet.channelId,
        thumbnail: (v.snippet.thumbnails && v.snippet.thumbnails.medium && v.snippet.thumbnails.medium.url) || '',
        thumbnailHigh: (v.snippet.thumbnails && v.snippet.thumbnails.high && v.snippet.thumbnails.high.url) || '',
        publishedAt: v.snippet.publishedAt,
        duration: formatDuration(v.contentDetails.duration),
        views: (v.statistics && v.statistics.viewCount) || '0',
        likes: parseInt((v.statistics && v.statistics.likeCount) || '0', 10),
        commentCount: parseInt((v.statistics && v.statistics.commentCount) || '0', 10),
      });
    }
    return { videos: results, nextPageToken: r.nextPageToken || null };
  },

  // ── User ── (1 unit)
  getMyChannel: async function() {
    var r = await this._fetch('channels', { part: 'snippet', mine: 'true' });
    if (!r.items || !r.items.length) return null;
    var ch = r.items[0];
    return { id: ch.id, name: ch.snippet.title, thumbnail: (ch.snippet.thumbnails && ch.snippet.thumbnails.default && ch.snippet.thumbnails.default.url) || '' };
  },

  clearCache: function() { this._cache.clear(); },

  clearSubsCache: function() {
    localStorage.removeItem('yt_subs_cache');
  }
};

function parseDuration(iso) {
  var m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1]||0)*3600)+(parseInt(m[2]||0)*60)+parseInt(m[3]||0);
}

function formatDuration(iso) {
  var t = parseDuration(iso), h = Math.floor(t/3600), m = Math.floor((t%3600)/60), s = t%60;
  return h > 0 ? h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0') : m+':'+String(s).padStart(2,'0');
}

function timeAgo(d) {
  var diff = Date.now() - new Date(d).getTime(), mins = Math.floor(diff/60000);
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins/60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs/24);
  if (days < 30) return days + 'd ago';
  var mo = Math.floor(days/30);
  return mo < 12 ? mo + 'mo ago' : Math.floor(mo/12) + 'y ago';
}

function formatViewCount(n) {
  var num = parseInt(n, 10);
  if (num >= 1e6) return (num/1e6).toFixed(1)+'M';
  if (num >= 1e3) return (num/1e3).toFixed(num >= 1e4 ? 0 : 1)+'K';
  return String(num);
}
