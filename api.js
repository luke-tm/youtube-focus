// ============================================================
// YouTube Focus v3 — API Module
// ============================================================

const YT_API = {
  _token: null,
  _cache: new Map(),

  setToken(t) { this._token = t; },

  _cacheKey(ep, p) { return ep + '?' + new URLSearchParams(p).toString(); },

  _getCache(key) {
    const e = this._cache.get(key);
    if (!e) return null;
    if (Date.now() - e.time > CONFIG.CACHE_DURATION_MINUTES * 60000) { this._cache.delete(key); return null; }
    return e.data;
  },

  async _fetch(endpoint, params = {}, method = 'GET', body = null) {
    if (!this._token) throw new Error('Not authenticated');
    const url = new URL(CONFIG.API_BASE + '/' + endpoint);
    if (method === 'GET') Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const opts = { method, headers: { 'Authorization': 'Bearer ' + this._token, 'Accept': 'application/json' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }

    if (method === 'GET') {
      const ck = this._cacheKey(endpoint, params);
      const cached = this._getCache(ck);
      if (cached) return cached;
    }

    const resp = await fetch(url.toString(), opts);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'API error: ' + resp.status);
    }

    const data = method === 'DELETE' ? null : await resp.json();
    if (method === 'GET' && data) this._cache.set(this._cacheKey(endpoint, params), { data, time: Date.now() });
    return data;
  },

  // ── Subscriptions ──
  async getSubscriptions(pageToken) {
    const p = { part: 'snippet', mine: 'true', maxResults: CONFIG.SUBS_PAGE_SIZE, order: 'alphabetical' };
    if (pageToken) p.pageToken = pageToken;
    return this._fetch('subscriptions', p);
  },

  async getAllSubscriptions() {
    const all = []; let pt = null;
    do {
      const r = await this.getSubscriptions(pt);
      all.push(...r.items.map(i => ({
        id: i.snippet.resourceId.channelId,
        name: i.snippet.title,
        thumbnail: i.snippet.thumbnails?.default?.url || '',
      })));
      pt = r.nextPageToken || null;
    } while (pt);
    return all;
  },

  // ── Channel Videos ──
  async getChannelVideos(channelId, maxResults = CONFIG.VIDEOS_PER_CHANNEL) {
    const r = await this._fetch('search', {
      part: 'snippet', channelId, maxResults: String(maxResults + 10), order: 'date', type: 'video',
    });
    const ids = r.items.map(i => i.id.videoId).filter(Boolean).join(',');
    if (!ids) return [];
    const d = await this._fetch('videos', { part: 'contentDetails,statistics,snippet', id: ids });
    return d.items
      .filter(v => parseDuration(v.contentDetails.duration) > 60)
      .slice(0, maxResults)
      .map(v => ({
        id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle,
        channelId: v.snippet.channelId,
        thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || '',
        thumbnailHigh: v.snippet.thumbnails?.high?.url || '',
        publishedAt: v.snippet.publishedAt,
        duration: formatDuration(v.contentDetails.duration),
        views: v.statistics?.viewCount || '0',
        likes: parseInt(v.statistics?.likeCount || '0', 10),
        commentCount: parseInt(v.statistics?.commentCount || '0', 10),
        description: v.snippet.description,
      }));
  },

  async getChannelAllVideos(channelId, pageToken = null) {
    const p = { part: 'snippet', channelId, maxResults: '20', order: 'date', type: 'video' };
    if (pageToken) p.pageToken = pageToken;
    const r = await this._fetch('search', p);
    const ids = r.items.map(i => i.id.videoId).filter(Boolean).join(',');
    if (!ids) return { videos: [], nextPageToken: null };
    const d = await this._fetch('videos', { part: 'contentDetails,statistics,snippet', id: ids });
    return {
      videos: d.items.filter(v => parseDuration(v.contentDetails.duration) > 60).map(v => ({
        id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle,
        channelId: v.snippet.channelId,
        thumbnail: v.snippet.thumbnails?.medium?.url || '',
        publishedAt: v.snippet.publishedAt,
        duration: formatDuration(v.contentDetails.duration),
        views: v.statistics?.viewCount || '0',
        likes: parseInt(v.statistics?.likeCount || '0', 10),
        commentCount: parseInt(v.statistics?.commentCount || '0', 10),
      })),
      nextPageToken: r.nextPageToken || null,
    };
  },

  // ── Feed ──
  async getFeed(subscriptions) {
    const all = [];
    const batch = 5;
    for (let i = 0; i < subscriptions.length; i += batch) {
      const b = subscriptions.slice(i, i + batch);
      const results = await Promise.allSettled(b.map(ch => this.getChannelVideos(ch.id, CONFIG.VIDEOS_PER_CHANNEL)));
      results.forEach(r => { if (r.status === 'fulfilled') all.push(...r.value); });
    }
    all.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    return all;
  },

  // ── Ratings ──
  async rateVideo(videoId, rating) { await this._fetch('videos/rate', { id: videoId, rating }, 'POST'); },
  async getRating(videoId) { const r = await this._fetch('videos/getRating', { id: videoId }); return r.items?.[0]?.rating || 'none'; },

  // ── Comments ──
  async getComments(videoId, pageToken) {
    const p = { part: 'snippet', videoId, maxResults: String(CONFIG.COMMENTS_PAGE_SIZE), order: 'relevance', textFormat: 'plainText' };
    if (pageToken) p.pageToken = pageToken;
    try {
      const r = await this._fetch('commentThreads', p);
      return {
        comments: r.items.map(i => { const s = i.snippet.topLevelComment.snippet; return { id: i.id, author: s.authorDisplayName, authorImage: s.authorProfileImageUrl, text: s.textDisplay, likes: s.likeCount, publishedAt: s.publishedAt, isOwn: false }; }),
        nextPageToken: r.nextPageToken || null,
      };
    } catch (e) { return { comments: [], nextPageToken: null }; }
  },

  async postComment(videoId, text) {
    const r = await this._fetch('commentThreads', { part: 'snippet' }, 'POST', { snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } } });
    const s = r.snippet.topLevelComment.snippet;
    return { id: r.id, author: s.authorDisplayName, authorImage: s.authorProfileImageUrl, text: s.textDisplay, likes: 0, publishedAt: s.publishedAt, isOwn: true };
  },

  // ── Playlists ──
  async getPlaylists() {
    const r = await this._fetch('playlists', { part: 'snippet,contentDetails', mine: 'true', maxResults: '50' });
    return r.items.map(p => ({ id: p.id, title: p.snippet.title, itemCount: p.contentDetails.itemCount, thumbnail: p.snippet.thumbnails?.medium?.url || '' }));
  },

  async getPlaylistItems(playlistId, pageToken) {
    const p = { part: 'snippet,contentDetails', playlistId, maxResults: '50' };
    if (pageToken) p.pageToken = pageToken;
    const r = await this._fetch('playlistItems', p);
    return { items: r.items.map(i => ({ id: i.id, videoId: i.contentDetails.videoId, title: i.snippet.title, channel: i.snippet.videoOwnerChannelTitle, thumbnail: i.snippet.thumbnails?.medium?.url || '', publishedAt: i.snippet.publishedAt })), nextPageToken: r.nextPageToken || null };
  },

  async addToPlaylist(playlistId, videoId) {
    return this._fetch('playlistItems', { part: 'snippet' }, 'POST', { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } });
  },

  async createPlaylist(title) {
    const r = await this._fetch('playlists', { part: 'snippet,status' }, 'POST', { snippet: { title }, status: { privacyStatus: 'private' } });
    return { id: r.id, title: r.snippet.title, itemCount: 0 };
  },

  // ── User ──
  async getMyChannel() {
    const r = await this._fetch('channels', { part: 'snippet,statistics', mine: 'true' });
    if (!r.items?.length) return null;
    const ch = r.items[0];
    return { id: ch.id, name: ch.snippet.title, thumbnail: ch.snippet.thumbnails?.default?.url || '' };
  },

  clearCache() { this._cache.clear(); },
};

function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1]||0)*3600)+(parseInt(m[2]||0)*60)+parseInt(m[3]||0);
}

function formatDuration(iso) {
  const t = parseDuration(iso), h = Math.floor(t/3600), m = Math.floor((t%3600)/60), s = t%60;
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}

function timeAgo(d) {
  const diff = Date.now() - new Date(d).getTime(), mins = Math.floor(diff/60000);
  if (mins < 60) return mins + 'm ago'; const hrs = Math.floor(mins/60);
  if (hrs < 24) return hrs + 'h ago'; const days = Math.floor(hrs/24);
  if (days < 30) return days + 'd ago'; const mo = Math.floor(days/30);
  return mo < 12 ? mo + 'mo ago' : Math.floor(mo/12) + 'y ago';
}

function formatViewCount(n) {
  const num = parseInt(n, 10);
  if (num >= 1e6) return (num/1e6).toFixed(1)+'M';
  if (num >= 1e3) return (num/1e3).toFixed(num >= 1e4 ? 0 : 1)+'K';
  return String(num);
}
