<?php
declare(strict_types=1);

$localConfig = loadLocalConfig(__DIR__ . '/config.local.php');

define('DEFAULT_SERVER', (string)($localConfig['server'] ?? 'http://example.com'));
define('DEFAULT_USERNAME', (string)($localConfig['username'] ?? ''));
define('DEFAULT_PASSWORD', (string)($localConfig['password'] ?? ''));

function loadLocalConfig(string $path): array
{
    if (!is_file($path)) {
        return [];
    }

    $config = require $path;
    return is_array($config) ? $config : [];
}

if (isset($_GET['hls'])) {
    try {
        $server = normalizeServer((string)($_GET['server'] ?? DEFAULT_SERVER));
        $username = trim((string)($_GET['username'] ?? DEFAULT_USERNAME));
        $password = trim((string)($_GET['password'] ?? DEFAULT_PASSWORD));
        $mode = (string)$_GET['hls'];

        if ($username === '' || $password === '') {
            throw new RuntimeException('Username and password are required.');
        }

        if ($mode === 'playlist') {
            outputHlsPlaylist($server, $username, $password, $_GET);
            exit;
        }

        if ($mode === 'segment') {
            outputHlsSegment((string)($_GET['url'] ?? ''));
            exit;
        }

        throw new RuntimeException('Unknown HLS request.');
    } catch (Throwable $error) {
        http_response_code(400);
        header('Content-Type: text/plain; charset=utf-8');
        echo $error->getMessage();
    }

    exit;
}

if (isset($_GET['ajax'])) {
    header('Content-Type: application/json; charset=utf-8');

    try {
        $payload = readJsonPayload();
        $server = normalizeServer((string)($payload['server'] ?? DEFAULT_SERVER));
        $username = trim((string)($payload['username'] ?? DEFAULT_USERNAME));
        $password = trim((string)($payload['password'] ?? DEFAULT_PASSWORD));
        $request = (string)($_GET['ajax'] ?? '');

        if ($username === '' || $password === '') {
            throw new RuntimeException('Username and password are required.');
        }

        if ($request === 'stream-url') {
            echo json_encode([
                'ok' => true,
                'url' => buildStreamUrl($server, $username, $password, $payload),
            ], JSON_THROW_ON_ERROR);
            exit;
        }

        $params = [];
        if ($request !== 'account') {
            $params['action'] = mapRequestToXtreamAction($request);
        }

        foreach (['category_id', 'stream_id', 'vod_id', 'series_id'] as $key) {
            if (isset($payload[$key]) && $payload[$key] !== '') {
                $params[$key] = (string)$payload[$key];
            }
        }

        echo json_encode([
            'ok' => true,
            'data' => xtreamApiRequest($server, $username, $password, $params),
        ], JSON_THROW_ON_ERROR);
    } catch (Throwable $error) {
        http_response_code(400);
        echo json_encode([
            'ok' => false,
            'error' => $error->getMessage(),
        ]);
    }

    exit;
}

function readJsonPayload(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('Invalid JSON request body.');
    }

    return $decoded;
}

function normalizeServer(string $server): string
{
    $server = trim($server);
    if ($server === '') {
        throw new RuntimeException('Server URL is required.');
    }

    if (!preg_match('#^https?://#i', $server)) {
        $server = 'http://' . $server;
    }

    $parts = parse_url($server);
    if (!is_array($parts) || empty($parts['host']) || empty($parts['scheme'])) {
        throw new RuntimeException('Server URL is not valid.');
    }

    if (!in_array(strtolower((string)$parts['scheme']), ['http', 'https'], true)) {
        throw new RuntimeException('Only HTTP and HTTPS servers are supported.');
    }

    return rtrim($server, '/');
}

function mapRequestToXtreamAction(string $request): string
{
    $actions = [
        'live-categories' => 'get_live_categories',
        'vod-categories' => 'get_vod_categories',
        'series-categories' => 'get_series_categories',
        'live-streams' => 'get_live_streams',
        'vod-streams' => 'get_vod_streams',
        'series-list' => 'get_series',
        'series-info' => 'get_series_info',
        'vod-info' => 'get_vod_info',
    ];

    if (!isset($actions[$request])) {
        throw new RuntimeException('Unknown API request.');
    }

    return $actions[$request];
}

function xtreamApiRequest(string $server, string $username, string $password, array $params = [])
{
    $query = array_merge([
        'username' => $username,
        'password' => $password,
    ], $params);

    $url = $server . '/player_api.php?' . http_build_query($query);
    $body = httpGet($url);
    $decoded = json_decode($body, true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        throw new RuntimeException('The server did not return valid JSON.');
    }

    return $decoded;
}

function httpGet(string $url): string
{
    return httpGetWithInfo($url)['body'];
}

function httpGetWithInfo(string $url): array
{
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 18,
            CURLOPT_USERAGENT => 'IPTVBrowser/1.0',
            CURLOPT_HTTPHEADER => ['Accept: application/json,text/plain,*/*'],
        ]);

        $response = curl_exec($curl);
        $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $effectiveUrl = (string)curl_getinfo($curl, CURLINFO_EFFECTIVE_URL);
        $contentType = (string)curl_getinfo($curl, CURLINFO_CONTENT_TYPE);
        $error = curl_error($curl);

        if ($response === false || $status >= 400) {
            throw new RuntimeException($error !== '' ? $error : 'The IPTV server request failed.');
        }

        return [
            'body' => (string)$response,
            'effective_url' => $effectiveUrl !== '' ? $effectiveUrl : $url,
            'content_type' => $contentType,
            'status' => $status,
        ];
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 18,
            'header' => "Accept: application/json,text/plain,*/*\r\nUser-Agent: IPTVBrowser/1.0\r\n",
        ],
    ]);

    $response = @file_get_contents($url, false, $context);
    if ($response === false) {
        throw new RuntimeException('The IPTV server request failed.');
    }

    return [
        'body' => $response,
        'effective_url' => $url,
        'content_type' => '',
        'status' => 200,
    ];
}

function buildStreamUrl(string $server, string $username, string $password, array $payload): string
{
    $type = (string)($payload['type'] ?? '');
    $id = preg_replace('/[^0-9]/', '', (string)($payload['id'] ?? ''));
    $extension = preg_replace('/[^a-zA-Z0-9]/', '', (string)($payload['extension'] ?? ''));

    if ($id === '') {
        throw new RuntimeException('Stream ID is required.');
    }

    if ($type === 'live') {
        return $server . '/live/' . rawurlencode($username) . '/' . rawurlencode($password) . '/' . $id . '.' . ($extension ?: 'm3u8');
    }

    if ($type === 'vod') {
        return $server . '/movie/' . rawurlencode($username) . '/' . rawurlencode($password) . '/' . $id . '.' . ($extension ?: 'mp4');
    }

    if ($type === 'series') {
        return $server . '/series/' . rawurlencode($username) . '/' . rawurlencode($password) . '/' . $id . '.' . ($extension ?: 'mp4');
    }

    throw new RuntimeException('Unknown stream type.');
}

function outputHlsPlaylist(string $server, string $username, string $password, array $query): void
{
    $id = preg_replace('/[^0-9]/', '', (string)($query['id'] ?? ''));
    if ($id === '') {
        throw new RuntimeException('Stream ID is required.');
    }

    $playlistUrl = buildStreamUrl($server, $username, $password, [
        'type' => 'live',
        'id' => $id,
        'extension' => 'm3u8',
    ]);
    $response = httpGetWithInfo($playlistUrl);
    $playlist = trim((string)$response['body']);

    if ($playlist === '') {
        throw new RuntimeException('The live playlist is empty.');
    }

    header('Content-Type: application/vnd.apple.mpegurl; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate');
    echo rewriteHlsPlaylist($playlist, $response['effective_url']);
}

function outputHlsSegment(string $url): void
{
    $url = trim($url);
    $parts = parse_url($url);
    if (!is_array($parts) || empty($parts['host']) || empty($parts['scheme'])) {
        throw new RuntimeException('Segment URL is not valid.');
    }

    if (!in_array(strtolower((string)$parts['scheme']), ['http', 'https'], true)) {
        throw new RuntimeException('Only HTTP and HTTPS segment URLs are supported.');
    }

    $response = httpGetWithInfo($url);
    header('Content-Type: ' . ($response['content_type'] ?: 'video/mp2t'));
    header('Cache-Control: no-store, no-cache, must-revalidate');
    echo $response['body'];
}

function rewriteHlsPlaylist(string $playlist, string $baseUrl): string
{
    $lines = preg_split('/\R/', $playlist) ?: [];
    $rewritten = [];

    foreach ($lines as $line) {
        $trimmed = trim($line);
        if ($trimmed === '' || startsWith($trimmed, '#')) {
            $rewritten[] = $line;
            continue;
        }

        $absolute = resolveUrl($baseUrl, $trimmed);
        $rewritten[] = 'index.php?hls=segment&url=' . rawurlencode($absolute);
    }

    return implode("\n", $rewritten) . "\n";
}

function resolveUrl(string $baseUrl, string $path): string
{
    if (preg_match('#^https?://#i', $path)) {
        return $path;
    }

    $base = parse_url($baseUrl);
    if (!is_array($base) || empty($base['scheme']) || empty($base['host'])) {
        throw new RuntimeException('Playlist URL is not valid.');
    }

    $origin = $base['scheme'] . '://' . $base['host'] . (isset($base['port']) ? ':' . $base['port'] : '');
    if (startsWith($path, '/')) {
        return $origin . $path;
    }

    $directory = isset($base['path']) ? preg_replace('#/[^/]*$#', '/', $base['path']) : '/';
    return $origin . $directory . $path;
}

function startsWith(string $value, string $prefix): bool
{
    return substr($value, 0, strlen($prefix)) === $prefix;
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>IPTV Browser</title>
    <link rel="stylesheet" href="assets/app.css">
</head>
<body>
    <main class="shell">
        <aside class="sidebar">
            <section class="brand">
                <h1>IPTV Browser</h1>
                <span id="connectionBadge" class="badge">Offline</span>
            </section>

            <form id="connectionForm" class="connection-form">
                <label>
                    <span>Server</span>
                    <input id="serverInput" name="server" type="url" autocomplete="url" value="<?= htmlspecialchars(DEFAULT_SERVER, ENT_QUOTES) ?>" required>
                </label>
                <label>
                    <span>Username</span>
                    <input id="usernameInput" name="username" autocomplete="username" value="<?= htmlspecialchars(DEFAULT_USERNAME, ENT_QUOTES) ?>" required>
                </label>
                <label>
                    <span>Password</span>
                    <input id="passwordInput" name="password" type="password" autocomplete="current-password" value="<?= htmlspecialchars(DEFAULT_PASSWORD, ENT_QUOTES) ?>" required>
                </label>
                <button class="primary-button" type="submit">Connect</button>
            </form>

            <dl id="accountPanel" class="account-panel" hidden></dl>

            <nav class="media-tabs" aria-label="Media type">
                <button type="button" class="active" data-section="live">Live</button>
                <button type="button" data-section="vod">Movies</button>
                <button type="button" data-section="series">Series</button>
            </nav>

            <div class="category-wrap">
                <div class="panel-title">Categories</div>
                <label class="category-filter">
                    <span>Filter</span>
                    <input id="categoryFilterInput" type="search" autocomplete="off" placeholder="Filter categories">
                </label>
                <div id="categoryList" class="category-list"></div>
            </div>
        </aside>

        <section class="content">
            <header class="toolbar">
                <div>
                    <h2 id="sectionTitle">Live</h2>
                    <p id="resultCount">No results</p>
                </div>
                <div class="toolbar-actions">
                    <label class="format-select">
                        <span>Live format</span>
                        <select id="liveFormat">
                            <option value="m3u8">m3u8</option>
                            <option value="ts">ts</option>
                        </select>
                    </label>
                    <label class="search-box">
                        <span>Search</span>
                        <input id="searchInput" type="search" autocomplete="off" placeholder="Title or channel">
                    </label>
                </div>
            </header>

            <section class="viewer">
                <div class="player-panel">
                    <video id="videoPlayer" controls playsinline></video>
                    <div class="player-meta">
                        <div>
                            <h3 id="nowPlaying">Nothing selected</h3>
                            <p id="nowPlayingMeta">Connect to load channels.</p>
                        </div>
                        <a id="externalLink" class="secondary-button disabled" href="#" target="_blank" rel="noreferrer">Open Stream</a>
                    </div>
                </div>

                <div id="seriesPanel" class="series-panel" hidden></div>
            </section>

            <section id="itemsGrid" class="items-grid" aria-live="polite"></section>
        </section>
    </main>

    <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>

    <script>
        window.IPTV_DEFAULTS = {
            server: <?= json_encode(DEFAULT_SERVER, JSON_THROW_ON_ERROR) ?>,
            username: <?= json_encode(DEFAULT_USERNAME, JSON_THROW_ON_ERROR) ?>,
            password: <?= json_encode(DEFAULT_PASSWORD, JSON_THROW_ON_ERROR) ?>
        };
    </script>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js"></script>
    <script src="assets/app.js" defer></script>
</body>
</html>
