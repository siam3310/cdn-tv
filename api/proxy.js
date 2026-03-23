// The URL of your raw M3U playlist on GitHub.
const M3U_URL = 'https://raw.githubusercontent.com/siam3310/cdn-tv/refs/heads/main/siamcdnplaylist.m3u';

// --- 🔥 Generate Full Proxied Playlist ---
async function generateProxyPlaylist(host) {
    const response = await fetch(M3U_URL);
    if (!response.ok) {
        throw new Error('Failed to fetch source M3U');
    }

    const text = await response.text();
    const lines = text.split(/\r\n|\n|\r/);

    let output = ['#EXTM3U'];
    let currentExtinf = '';
    let currentReferer = '';

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.startsWith('#EXTINF:')) {
            currentExtinf = line;
            currentReferer = '';
        } 
        else if (line.startsWith('#EXTVLCOPT:http-referrer=')) {
            currentReferer = line.replace('#EXTVLCOPT:http-referrer=', '');
        } 
        else if (line.startsWith('http')) {
            const proxyUrl = new URL(`https://${host}/api/proxy`);
            proxyUrl.searchParams.set('url', line);

            if (currentReferer) {
                proxyUrl.searchParams.set('referer', currentReferer);
            }

            if (currentExtinf) {
                output.push(currentExtinf);
            }

            output.push(proxyUrl.toString());

            currentExtinf = '';
            currentReferer = '';
        }
    }

    return output.join('\n');
}

// --- 🔁 Rewrite Playlist URLs ---
function rewritePlaylist(body, playlistUrl, referer, requestUrl) {
    const playlistBaseUrl = new URL(playlistUrl);
    const proxyBaseUrl = new URL(requestUrl);
    proxyBaseUrl.search = '';

    return body.trim().split(/\r\n|\n|\r/).map(line => {
        line = line.trim();
        if (!line) return '';

        if (!line.startsWith('#')) {
            const absoluteUrl = new URL(line, playlistBaseUrl).href;
            const proxyUrl = new URL(proxyBaseUrl.toString());
            proxyUrl.searchParams.set('url', absoluteUrl);

            if (referer) {
                proxyUrl.searchParams.set('referer', referer);
            }

            return proxyUrl.toString();
        }

        const uriMatch = line.match(/URI="([^"]+)"/);
        if (uriMatch && uriMatch[1]) {
            const absoluteUri = new URL(uriMatch[1], playlistBaseUrl).href;
            const proxyUrl = new URL(proxyBaseUrl.toString());
            proxyUrl.searchParams.set('url', absoluteUri);

            if (referer) {
                proxyUrl.searchParams.set('referer', referer);
            }

            return line.replace(uriMatch[1], proxyUrl.toString());
        }

        return line;
    }).join('\n');
}

// --- 🚀 Main Handler ---
module.exports = async (req, res) => {
    const { channel, url, referer, playlist } = req.query;

    try {
        // --- 0. 🔥 Playlist Generator ---
        if (playlist) {
            const host = req.headers.host;
            const playlistData = await generateProxyPlaylist(host);

            res.setHeader('Content-Type', 'application/x-mpegURL');
            return res.status(200).send(playlistData);
        }

        // --- 1. Channel Request ---
        if (channel) {
            const m3uResponse = await fetch(M3U_URL);
            if (!m3uResponse.ok) {
                return res.status(502).send('Error: Could not fetch the main playlist.');
            }

            const m3uText = await m3uResponse.text();
            const lines = m3uText.split(/\r\n|\n|\r/);

            let streamUrl = '';
            let streamReferer = '';

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();

                if (line.startsWith('#EXTINF:')) {
                    const name = line.split(',').pop().trim();

                    if (name.toLowerCase() === channel.toLowerCase()) {
                        for (let j = i + 1; j < i + 3; j++) {
                            if (!lines[j]) continue;

                            const nextLine = lines[j].trim();

                            if (nextLine.startsWith('#EXTVLCOPT:http-referrer=')) {
                                streamReferer = nextLine.replace('#EXTVLCOPT:http-referrer=', '');
                            } else if (nextLine.startsWith('http')) {
                                streamUrl = nextLine;
                            }
                        }
                        if (streamUrl) break;
                    }
                }
            }

            if (!streamUrl) {
                return res.status(404).send(`Channel "${channel}" not found.`);
            }

            const redirectUrl = new URL(req.url, `https://${req.headers.host}`);
            redirectUrl.search = '';
            redirectUrl.searchParams.set('url', streamUrl);

            if (streamReferer) {
                redirectUrl.searchParams.set('referer', streamReferer);
            }

            return res.redirect(302, redirectUrl.toString());
        }

        // --- 2. Proxy Stream ---
        if (url) {
            const headers = {
                'User-Agent': 'Mozilla/5.0',
            };

            if (referer) {
                headers['Referer'] = referer;
            }

            const targetResponse = await fetch(url, { headers });

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', '*');

            targetResponse.headers.forEach((value, name) => {
                if (!['content-encoding', 'transfer-encoding'].includes(name.toLowerCase())) {
                    res.setHeader(name, value);
                }
            });

            const contentType = targetResponse.headers.get('content-type') || '';

            // Rewrite m3u8 playlists
            if (contentType.includes('mpegurl')) {
                const body = await targetResponse.text();
                const requestUrl = new URL(req.url, `https://${req.headers.host}`).toString();
                const rewritten = rewritePlaylist(body, url, referer, requestUrl);
                return res.status(targetResponse.status).send(rewritten);
            }

            // Stream binary (.ts, etc.)
            res.writeHead(targetResponse.status);
            const reader = targetResponse.body.getReader();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
            }

            res.end();
            return;
        }

        // --- 3. Default ---
        res.status(200).send(
            'M3U Proxy is running!\n\n' +
            'Use:\n' +
            '/api/proxy?playlist=1 → Full Playlist\n' +
            '/api/proxy?channel=Channel Name → Play Channel\n'
        );

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};
