
import json
import re
import requests
import base64
from urllib.parse import unquote

def _0xe35c(d, e, f):
    g = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/"
    h_chars = g[:e]
    i_chars = g[:f]
    
    j = 0
    d_reversed = d[::-1]
    for c_idx, c_val in enumerate(d_reversed):
        if c_val in h_chars:
            j += h_chars.index(c_val) * (e**c_idx)

    if j == 0:
        return '0'
        
    k = ''
    while j > 0:
        k = i_chars[j % f] + k
        j = (j - (j % f)) // f
        
    return k if k else '0'

def deobfuscate(h, n, t, e):
    r = ""
    i = 0
    len_h = len(h)
    
    delimiter = n[e]
    n_map = {char: str(idx) for idx, char in enumerate(n)}

    while i < len_h:
        s = ""
        while i < len_h and h[i] != delimiter:
            s += h[i]
            i += 1
        
        i += 1 # Skip the delimiter
        
        if s:
            s_digits = "".join([n_map.get(c, c) for c in s])
            char_code = int(_0xe35c(s_digits, e, 10)) - t
            r += chr(char_code)
            
    return r

def LEUlrDBkdbMl(s):
    s = s.replace('-', '+').replace('_', '/')
    while len(s) % 4:
        s += '='
    return base64.b64decode(s).decode('utf-8')

def get_m3u8_url(channel_url, referer):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36",
        "Referer": referer
    }
    
    try:
        response = requests.get(channel_url, headers=headers)
        response.raise_for_status()
        html_content = response.text

        match = re.search(r'eval\(function\(h,u,n,t,e,r\)\{.*?\}\((.*?)\)\)', html_content, re.DOTALL)
        if not match:
            print(f"Could not find the obfuscated script pattern for {channel_url}")
            return None

        params_str = match.group(1).strip()
        
        try:
            params_match = re.search(r'([\'"])((?:(?!\1).)*)\1,\s*\d+,\s*([\'"])((?:(?!\3).)*)\3,\s*(\d+),\s*(\d+),.*\s*(\d+)', params_str, re.DOTALL)
            if not params_match:
                 print(f"Could not parse parameters from: {params_str}")
                 return None

            h = params_match.group(2)
            n = params_match.group(4)
            t = int(params_match.group(5))
            e = int(params_match.group(6))
            
        except Exception as e:
            print(f"Error parsing parameters for {channel_url}: {e}")
            return None

        deobfuscated_code = deobfuscate(h, n, t, e)
        
        src_match = re.search(r"src:\s*([\w\d]+)", deobfuscated_code)
        if not src_match:
            print(f"Could not find player source variable in {channel_url}")
            return None
        src_variable_name = src_match.group(1)

        assignment_regex = r"const\s+" + re.escape(src_variable_name) + r"\s*=\s*(.*?);"
        assignment_match = re.search(assignment_regex, deobfuscated_code)
        if not assignment_match:
            print(f"Could not find assignment for source variable '{src_variable_name}' in {channel_url}")
            return None
        assignment_line = assignment_match.group(1)

        decoder_func_match = re.search(r"function\s+([a-zA-Z0-9_]+)\(str\)", deobfuscated_code)
        if not decoder_func_match:
            print(f"Could not find decoder function in {channel_url}")
            return None
        decoder_func_name = decoder_func_match.group(1)

        parts_vars_regex = re.escape(decoder_func_name) + r"\((\w+)\)"
        parts_vars = re.findall(parts_vars_regex, assignment_line)

        const_declarations = re.findall(r"const\s+(\w+)\s+=\s+'([^']+)';", deobfuscated_code)
        parts_dict = {match[0]: match[1] for match in const_declarations}

        if not parts_vars:
             print(f"Could not extract parts variables from assignment line in {channel_url}")
             return None

        try:
            url_parts_b64 = [parts_dict[var_name] for var_name in parts_vars]
        except KeyError as e:
            print(f"Could not find const value for variable {e} in {channel_url}")
            return None

        decoded_parts = [LEUlrDBkdbMl(part) for part in url_parts_b64]
        final_url = "".join(decoded_parts)
        return final_url

    except requests.exceptions.RequestException as req_err:
        print(f"Error fetching URL {channel_url}: {req_err}")
        return None
    except Exception as ex:
        print(f"An error occurred while processing {channel_url}: {ex}")
        return None

def get_online_channels(referer):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36",
        "Referer": referer
    }
    try:
        response = requests.get("https://api.cdn-live.tv/api/v1/channels/?user=cdnlivetv&plan=free", headers=headers)
        response.raise_for_status()
        all_channels = response.json().get('channels', [])
        online_channels = [ch for ch in all_channels if ch.get('status') == 'online']
        
        sports_keywords = [
            'sport', 'sports', 'football', 'cricket', 'espn','wwe','premier league', 'liga',
            'dazn', 'tnt sports', 'sky sports', 'bein sports', 'fox sports',
            'supersport', 'arena', 'match','sportv', 'premier', 'tyc sports', 'eleven sports', 'polsat sport','ssc', 'sony ten'
        ]

        sports_channels = []
        for channel in online_channels:
            channel_name = channel.get('name', '').lower()
            for keyword in sports_keywords:
                if keyword in channel_name:
                    sports_channels.append(channel)
                    break
        return sports_channels
    except requests.exceptions.RequestException as req_err:
        print(f"Error fetching channel list: {req_err}")
        return []
    except json.JSONDecodeError as json_err:
        print(f"Error decoding channel list JSON: {json_err}")
        return []

referer_url = "https://edge.cdn-live.ru/"
channels_data = get_online_channels(referer_url)

if channels_data:
    with open("siamcdnplaylist.m3u", "w", encoding='utf-8') as f:
        f.write('#EXTM3U x-tvg-url="https://github.com/epgshare01/share/raw/master/epg_ripper_ALL_SOURCES1.xml.gz"\n')
        for channel in channels_data:
            print(f"Processing {channel.get('name')}...")
            player_page_url = channel.get('url')
            if not player_page_url:
                print(f"Skipping {channel.get('name')} due to missing URL.")
                continue
                
            m3u8_url = get_m3u8_url(player_page_url, referer_url)
            
            if m3u8_url:
                name = channel.get('name')
                code = channel.get('code')
                logo = channel.get('image')
                f.write(f'#EXTINF:-1 tvg-id="{code}" tvg-name="{name}" tvg-logo="{logo}",{name}\n')
                f.write(f'#EXTVLCOPT:http-referrer={referer_url}\n')
                f.write(f"{m3u8_url}\n")

    print("Playlist created successfully.")
else:
    print("No online sports channels found or an error occurred. Playlist not updated.")
