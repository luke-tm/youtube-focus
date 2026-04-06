# YouTube Focus v3 — Setup Guide

## What's New in v3
- **Fixed sign-in loop** when adding to home screen
- **Subscriptions tab** now shows compact channel row + full video feed (like official YouTube app)
- **Feed tab** lets you pick specific channels to follow
- **Channel browsing** — tap any channel to see all their videos
- **Player doesn't restart** when changing speed/captions
- **Bottom nav always sticks** to screen bottom
- **Old cache auto-cleared** on update

---

## Setup (first time only)

### 1. Google Cloud Console
1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a project → Enable **YouTube Data API v3**
3. **APIs & Services → OAuth consent screen** → External → add your email as test user
4. Add scopes: `youtube.readonly`, `youtube`, `youtube.force-ssl`

### 2. Create OAuth Credentials
1. **APIs & Services → Credentials → Create → OAuth client ID**
2. Type: **Web application**
3. **Authorized JavaScript origins**: `https://YOUR-USERNAME.github.io`
4. **Authorized redirect URIs**: `https://YOUR-USERNAME.github.io/youtube-focus/`
   - Must have trailing slash!
5. Copy the **Client ID**

### 3. Configure the App
Open `config.js` and replace `YOUR_CLIENT_ID_HERE`:
```js
CLIENT_ID: '123456789.apps.googleusercontent.com',
```
The redirect URI is auto-detected — you don't need to set it manually.

### 4. Deploy to GitHub Pages
Upload all files to a repo named `youtube-focus`, enable Pages on the `main` branch.

### 5. Add to Home Screen
Open in Safari → Share → Add to Home Screen.

---

## Troubleshooting

**Sign-in redirects but returns to sign-in page:**  
1. Open Settings tab → check the "Debug" section shows the correct redirect URI
2. That URI must be in your Google Cloud Console "Authorized redirect URIs" exactly
3. Clear Safari data for your GitHub Pages site and try again

**"Error 401: invalid_client":**  
Your Client ID is wrong. Double-check config.js matches Google Cloud Console exactly.

**First load after update shows old version:**  
The v3 service worker auto-clears old caches. Do a hard refresh (pull down in Safari) or close and reopen the app.
