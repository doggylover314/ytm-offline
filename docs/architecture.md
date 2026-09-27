# Architecture

YTM Offline uses Tauri 2, a Rust backend, and a React/TypeScript frontend. `src/datasource/youtube/` provides Google sign-in, search, library data, playlist pages, lyrics, and signed stream URLs. `src/player/` manages playback, queues, downloads, and playlist sync. `src-tauri/src/` owns the audio engine, downloads, local file storage, media controls, and the HTTP proxy.

The Rust audio engine is the default for low memory use. Playback can fall back to a hidden YouTube player for a track whose direct stream is refused. The mini-player is a separate on-demand window.

`playlistSync.ts` requests fresh playlist pages, detects repeated cursors, and updates the set of tracks for each subscribed playlist. `offlineStore.ts` stores audio once per track ID and tracks individual and playlist references. Failed syncs retain the prior snapshot. The audio store lives in the app data directory; the manifest and settings have durable copies outside webview storage. Cover files live beside audio, and available lyrics are stored in the manifest.

The main interface exposes Home, Library, Downloads, and Settings. Search opens from Home. The current frontend still uses some inherited navigation and UI modules internally; simplifying those further should preserve the data source and audio contracts above.
