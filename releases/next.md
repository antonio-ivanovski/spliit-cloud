Welcome to `vNEXT`! This patch fixes offline launches and homepage refreshes in the installed app.

## What's Changed

### 🐛 Bug fixes

- Fixed offline homepage refreshes and app restarts in the installed app, which could show a browser connection error even when groups were available offline. (`TBD` by @antonio-ivanovski)
- Fixed persistent storage never being granted: the request lost its browser binding and failed silently with no retry. It now requests correctly and retries once after installation, when the browser is most likely to keep offline data on the device. (`TBD` by @antonio-ivanovski)

### ✨ Improvements

- Offline download problems now surface as a one-time toast with a retry action (full storage, failed downloads, unavailable storage) instead of a persistent homepage banner. (`TBD` by @antonio-ivanovski)
- Switched an offline language you haven't used before now falls back to English instead of failing, and unused language bundles no longer slow down installation (app download on install down from ~14 MB to ~6 MB). (`TBD` by @antonio-ivanovski)

**Full Changelog**: TBD
