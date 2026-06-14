# IPTV Browser

A small PHP IPTV browser for Xtream Codes style servers.

## Run

```sh
php -S 127.0.0.1:8000
```

Then open:

```text
http://127.0.0.1:8000
```

## Defaults

Local defaults are read from `config.local.php`, which is intentionally ignored by git.
Use `config.example.php` as the template when setting up another machine.

## API paths

The app uses `player_api.php` for account, category, channel, movie, and series metadata.

Playback URLs are built with direct media paths:

- Live: `/live/{username}/{password}/{stream_id}.{format}`
- Movies: `/movie/{username}/{password}/{stream_id}.{extension}`
- Series: `/series/{username}/{password}/{episode_id}.{extension}`

It does not use `/get.php`.

For in-browser live playback, the app proxies HLS playlists through `index.php?hls=playlist`.
That proxy follows provider redirects, rewrites relative segment paths, and serves segments back
from the same local origin so HLS.js can play them in browsers that do not support HLS natively.
