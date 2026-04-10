// YouTube Focus v3 — Configuration
// Replace YOUR_CLIENT_ID_HERE with your OAuth Client ID
//
// IMPORTANT: In Google Cloud Console, set your Authorized redirect URI to:
// https://luke-tm.github.io/youtube-focus/index.html
//
// Using index.html explicitly prevents GitHub Pages from
// redirecting and stripping the OAuth token from the URL.

var CONFIG = {
  CLIENT_ID: '83656850398-etlb0jelnhmk5bok4gt7oqr6lkr38f4u.apps.googleusercontent.com',
  REDIRECT_URI: 'https://luke-tm.github.io/youtube-focus/index.html',
  API_BASE: 'https://www.googleapis.com/youtube/v3',
  SCOPES: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.force-ssl',
  SUBS_PAGE_SIZE: 50,
  VIDEOS_PER_CHANNEL: 5,
  COMMENTS_PAGE_SIZE: 20,
  CACHE_DURATION_MINUTES: 60
};
