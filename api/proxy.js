// This is a Vercel Serverless Function.
// It will be accessible at the /api/proxy endpoint.

const M3U_URL = 'https://raw.githubusercontent.com/siam3310/cdn-tv/refs/heads/main/siamcdnplaylist.m3u';

module.exports = async (req, res) => {
    // Get query parameters from the request URL.
    const { channel, url, referer, m3u } = req.query;

    try {
        // --- NEW FEATURE: M3U Playlist Generation ---
        // If the ?m3u=true parameter is present, generate a proxied playlist.
        if (m3u) {
            const m3uResponse = await fetch(M3U_URL);
            if (!m3uResponse.ok) {
                return res.status(502).send('Error: Could not fetch the main playlist from GitHub.');
            }
            const m3uText = await m3uResponse.text();
            const lines = m3uText.split(/\r\n|\n|\r/);

            let newPlaylist = '';
            
            // Preserve the original header (including x-tvg-url)
            if (lines.length > 0 && lines[0].startsWith('#EXTM3U')) {
                 newPlaylist += lines[0] + '\n';
            } else {
                 newPlaylist += '#EXTM3U\n'; // Fallback header
            }

            let currentExtInf = null;
            for (const line of lines) {
                if (line.startsWith('#EXTINF:')) {
                    currentExtInf = line; // Store the channel metadata line
                } else if (currentExtInf && line.startsWith('http')) {
                    // This is a stream URL that follows an #EXTINF line.
                    const channelName = currentExtInf.split(',').pop().trim();
                    if (channelName) {
                        // Construct the new URL pointing back to our proxy
                        const proxyStreamUrl = `https://${req.headers.host}/api/proxy?channel=${encodeURIComponent(channelName)}`;
                        
                        newPlaylist += currentExtInf + '\n';
                        newPlaylist += proxyStreamUrl + '\n';
                    }
                    currentExtInf = null; // Reset for the next channel
                }
            }
            
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Content-Disposition', 'attachment; filename="siam_proxy_playlist.m3u"');
            return res.status(200).send(newPlaylist);
        }


        // --- 1. Channel Request: Find the stream and redirect to the proxy ---
        if (channel) {
            const m3uResponse = await fetch(M3U_URL);
            if (!m3uResponse.ok) {
                return res.status(502).send('Error: Could not fetch the main playlist from GitHub.');
            }
            const m3uText = await m3uResponse.text();

            const lines = m3uText.split(/\r\n|\n|\r/);
            let streamUrl = '';
            let streamReferer = '';

            // Find the channel info in the playlist.
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith('#EXTINF:')) {
                    const parts = line.split(',');
                    const namePart = parts[parts.length - 1].trim();

                    if (namePart.toLowerCase() === channel.toLowerCase()) {
                        for (let j = i + 1; j < i + 3; j++) {
                            if (!lines[j]) continue;
                            const nextLine = lines[j].trim();
                            if (nextLine.startsWith('#EXTVLCOPT:http-referrer=')) {
                                streamReferer = nextLine.replace('#EXTVLCOPT:http-referrer=', '');
                            } else if (nextLine.startsWith('http')) {
                                streamUrl = nextLine;
                            }
                        }
                        break; // Found the channel, no need to loop further.
                    }
                }
            }

            if (streamUrl) {
                // Construct the full URL to the proxy's stream handler (?url=...&referer=...)
                const proxyUrl = new URL(req.url, `https://${req.headers.host}`);
                proxyUrl.search = ''; // Clear existing query params
                proxyUrl.searchParams.set('url', streamUrl);
                if (streamReferer) {
                    proxyUrl.searchParams.set('referer', streamReferer);
                }
                // Redirect the client to the new proxy URL.
                return res.redirect(302, proxyUrl.href);
            } else {
                return res.status(404).send('Error: Channel not found in the playlist.');
            }
        }

        // --- 2. URL/Segment Proxy: Fetch the actual video chunk ---
        if (url) {
            const targetUrl = url;
            const headers = {
                'User-Agent': req.headers['user-agent'] || 'VLC/3.0.0',
            };
            if (referer) {
                headers['Referer'] = referer;
            }

            const response = await fetch(targetUrl, { headers });
            
            if (!response.ok) {
                return res.status(response.status).send(`Error fetching stream: ${response.statusText}`);
            }

            // Get the full request URL to use as a base for rewriting segment URLs.
            const requestUrl = new URL(req.url, `https://${req.headers.host}`).toString();
            
            // Check if the content is a playlist that needs rewriting.
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('mpegurl') || contentType.includes('x-mpegurl')) {
                const body = await response.text();
                const rewrittenBody = rewritePlaylist(body, targetUrl, referer, requestUrl);
                res.setHeader('Content-Type', contentType);
                return res.status(200).send(rewrittenBody);
            } else {
                 // For non-playlist content (like .ts segments), stream it directly.
                res.setHeader('Content-Type', contentType);
                res.setHeader('Content-Length', response.headers.get('content-length'));
                return response.body.pipe(res);
            }
        }

        // --- 3. Welcome Message ---
        res.setHeader('Content-Type', 'text/plain');
        res.status(200).send('Vercel M3U Proxy is active!\n\nUse /api/proxy?channel=CHANNEL_NAME to start a stream.\nUse /api/proxy?m3u=true to download the proxied playlist.');

    } catch (error) {
        console.error('Serverless Function Error:', error);
        res.status(500).send('An internal server error occurred.');
    }
};

// This helper function rewrites segment URLs within a playlist to point back to our proxy.
function rewritePlaylist(body, playlistUrl, referer, requestUrl) {
    const playlistBaseUrl = new URL(playlistUrl);
    // Use the request URL to build the base for our proxy.
    const proxyBaseUrl = new URL(requestUrl);
    proxyBaseUrl.search = ''; // Start with a clean URL

    return body.trim().split(/\r\n|\n|\r/).map(line => {
        line = line.trim();
        if (!line) return '';
        
        // If the line is a URL (either a sub-playlist or a .ts segment)
        if (line.startsWith('http') || !line.startsWith('#')) {
            const absoluteUrl = new URL(line, playlistBaseUrl);
            const newProxyUrl = new URL(proxyBaseUrl);
            newProxyUrl.searchParams.set('url', absoluteUrl.href);
            if (referer) {
                newProxyUrl.searchParams.set('referer', referer);
            }
            return newProxyUrl.href;
        }
        return line;
    }).join('\n');
}
