# YTM Offline

A lightweight, unofficial YouTube Music desktop app for Linux. Search from Home, browse your Google account's library, play music, and keep playlists available offline.

YTM Offline is not affiliated with YouTube or Google.

## Features

- Home search; Library and Downloads pages; compact mini-player.
- Google sign-in and personal playlists through the existing YouTube Music client.
- One-click playlist downloads, including Liked Songs, kept in sync at launch, on focus, and every five minutes while the app is open. The Downloads page also has **Sync now**.
- Downloads survive restarts, sleep and lost connections: they wait for the internet and pick up where they stopped.
- One copy of each downloaded track, even when several synced playlists contain it.
- Offline audio, cover artwork, and available lyrics stored under the app's data directory.
- Rust audio playback by default, with a YouTube player fallback when a stream is refused.
- Lyrics, equalizer, Discord presence, Last.fm scrobbling, podcasts, media keys, and a mini-player.
- A solid dark theme with a configurable accent colour.

## Build on Linux

Install Node.js, pnpm, Rust, Cargo, and the system libraries required by Tauri 2 and WebKitGTK. On Fedora, the build dependencies include `webkit2gtk4.1-devel`, `gtk3-devel`, `libappindicator-gtk3-devel`, `alsa-lib-devel`, `dbus-devel`, `openssl-devel`, `cmake`, and `gcc-c++`. Audio playback may also require GStreamer codec packages.

```bash
pnpm install
pnpm tauri dev
pnpm run verify
pnpm tauri build --bundles rpm,deb,appimage
```

The packages are written under `src-tauri/target/release/bundle/`.

A new package installs over the old one, so downloads, settings and the sign-in carry over. Test builds of an unreleased version get a release number below the real one, so the release still installs over them:

```bash
pnpm tauri build --bundles rpm --config '{"bundle":{"linux":{"rpm":{"release":"0.YYYYMMDDHHMM"}}}}'
```

Release AppImages are built on Ubuntu by the release workflow. To build one on Fedora, linuxdeploy's bundled `strip` and GStreamer plugin need two workarounds:

```bash
NO_STRIP=true GSTREAMER_PLUGINS_DIR=/usr/lib64/gstreamer-1.0 GSTREAMER_HELPERS_DIR=/usr/libexec/gstreamer-1.0 pnpm tauri build --bundles appimage
```

The project identifier is `io.github.doggylover314.ytmoffline`; it uses a separate data directory from the upstream app.

## How downloads are stored

Downloaded audio is app managed and retains the source format. By default it lives in the app's data directory; Settings → Downloads lets you pick another folder, and the app keeps its files in a `YTM Offline` subfolder there. When you change the folder you choose whether existing downloads are moved (the default), copied, or deleted and downloaded again. A durable manifest stores the title, artists, album, duration, source identifiers, playlist references, and any available lyrics. Cover artwork is stored beside the audio. The app keeps a track while any synced playlist or individual save references it. Audio is not encrypted; Google session credentials are kept separately in the OS credential store.

Playlist synchronization requires a network connection. When a sync fails, the previously downloaded tracks remain available. YouTube Music can change its private API, so an update may be needed if sign-in, stream resolution, or playlist fetching changes.

Discord Rich Presence needs an application ID belonging to this fork. Set `YTM_OFFLINE_DISCORD_CLIENT_ID` when building (the release workflow reads it from the repository variable of the same name) and it is compiled into the app. Setting the same variable at launch overrides the built-in ID. The upstream application's ID was removed so presence cannot display upstream branding. Last.fm remains configured in Settings.

## Credits and license

YTM Offline is based on earlier open-source work. See [NOTICE](NOTICE) for attribution. The source code remains under the [Apache License 2.0](LICENSE).
