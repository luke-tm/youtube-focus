// YouTube Focus v3 — Auth Module (Redirect Flow)

var AUTH = {
  _accessToken: null,
  _expiresAt: 0,
  _onAuthChange: null,

  init: function(onAuthChange) {
    this._onAuthChange = onAuthChange;
    var self = this;

    // Debug: log what we see on page load
    var debugInfo = 'URL: ' + window.location.href + '\nHash: ' + (window.location.hash || '(empty)');

    // Step 1: Check URL hash for token (returning from Google OAuth)
    var hash = window.location.hash || '';
    if (hash.length > 1 && hash.indexOf('access_token') !== -1) {
      var token = self._parseHash(hash);
      debugInfo += '\nParsed token: ' + (token ? 'YES' : 'NO');
      if (token) {
        self._save(token.access_token, token.expires_in);
        // Clean hash
        try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch(e) {}
        self._debug(debugInfo + '\nStatus: Token saved from redirect');
        if (self._onAuthChange) self._onAuthChange(true);
        return;
      }
    }

    // Check for error in hash
    if (hash.indexOf('error') !== -1) {
      self._debug(debugInfo + '\nStatus: OAuth error in hash');
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch(e) {}
    }

    // Step 2: Check localStorage for saved token
    try {
      var raw = localStorage.getItem('yt_focus_auth');
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && saved.token && saved.expiresAt > Date.now() + 30000) {
          self._accessToken = saved.token;
          self._expiresAt = saved.expiresAt;
          YT_API.setToken(self._accessToken);
          if (self._onAuthChange) self._onAuthChange(true);
          return;
        }
        localStorage.removeItem('yt_focus_auth');
      }
    } catch (e) {
      localStorage.removeItem('yt_focus_auth');
    }

    // Step 3: Silent re-auth — if the user has previously signed in and Google
    // still has an active session, redirect with prompt=none to get a fresh
    // token without showing any UI. Only attempted once per page-load cycle
    // (sessionStorage flag) to prevent infinite redirect loops.
    try {
      if (localStorage.getItem('yt_focus_has_authed') === '1' &&
          !sessionStorage.getItem('yt_silent_tried')) {
        sessionStorage.setItem('yt_silent_tried', '1');
        var silentParams = new URLSearchParams({
          client_id: CONFIG.CLIENT_ID,
          redirect_uri: CONFIG.REDIRECT_URI,
          response_type: 'token',
          scope: CONFIG.SCOPES,
          include_granted_scopes: 'true',
          prompt: 'none'
        });
        window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + silentParams.toString();
        return;
      }
    } catch (e) {}

    // Step 4: Not authenticated
    self._debug(debugInfo + '\nStatus: No valid token');
    if (self._onAuthChange) self._onAuthChange(false);
  },

  _parseHash: function(hash) {
    try {
      var str = hash.substring(1); // remove #
      var params = new URLSearchParams(str);
      var token = params.get('access_token');
      var expiresIn = params.get('expires_in');
      if (!token) return null;
      return { access_token: token, expires_in: parseInt(expiresIn || '3600', 10) };
    } catch (e) {
      return null;
    }
  },

  _save: function(token, expiresInSec) {
    this._accessToken = token;
    this._expiresAt = Date.now() + (expiresInSec * 1000);
    YT_API.setToken(token);
    try {
      localStorage.setItem('yt_focus_auth', JSON.stringify({
        token: this._accessToken,
        expiresAt: this._expiresAt
      }));
      localStorage.setItem('yt_focus_has_authed', '1');
    } catch (e) {}
  },

  _debug: function(msg) {
    // Store debug info so the app can display it
    window._authDebug = msg;
  },

  signIn: function() {
    var lastAttempt = parseInt(sessionStorage.getItem('yt_auth_attempt') || '0', 10);
    if (Date.now() - lastAttempt < 5000) {
      return;
    }
    sessionStorage.setItem('yt_auth_attempt', String(Date.now()));

    var params = new URLSearchParams({
      client_id: CONFIG.CLIENT_ID,
      redirect_uri: CONFIG.REDIRECT_URI,
      response_type: 'token',
      scope: CONFIG.SCOPES,
      include_granted_scopes: 'true'
    });
    window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
  },

  signOut: function() {
    if (this._accessToken) {
      fetch('https://oauth2.googleapis.com/revoke?token=' + this._accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }).catch(function() {});
    }
    this._accessToken = null;
    this._expiresAt = 0;
    YT_API.setToken(null);
    YT_API.clearCache();
    localStorage.removeItem('yt_focus_auth');
    localStorage.removeItem('yt_focus_has_authed');
    try { sessionStorage.removeItem('yt_silent_tried'); } catch(e) {}
    if (this._onAuthChange) this._onAuthChange(false);
  },

  isSignedIn: function() {
    return !!this._accessToken && this._expiresAt > Date.now();
  }
};
