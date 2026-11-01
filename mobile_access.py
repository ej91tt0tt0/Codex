"""Private mobile browser access: localhost + explicitly enabled Tailscale Serve.

The backend is bound to loopback only. No generic LAN or public hosts are allowed.
"""
import ipaddress
import os
import re
import urllib.parse


def mobile_origin():
    raw = os.environ.get('ASTER_MOBILE_ORIGIN', '').strip()
    if not raw:
        return None
    try:
        parsed = urllib.parse.urlsplit(raw)
        host = parsed.hostname
        if (
            parsed.scheme != 'https'
            or not host or not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.ts\.net', host)
            or parsed.username or parsed.password
            or parsed.port not in (None, 443)
            or parsed.path not in ('', '/')
            or parsed.query or parsed.fragment
            or parsed.netloc != host
        ):
            return None
        return 'https://' + host
    except (ValueError, TypeError):
        return None


def local_request(headers, port):
    try:
        parsed = urllib.parse.urlsplit('http://' + headers.get('Host', ''))
        return (
            parsed.hostname in ('127.0.0.1', 'localhost', '::1')
            and parsed.port == port
            and not parsed.username and not parsed.password
            and not parsed.path and not parsed.query and not parsed.fragment
        )
    except (ValueError, TypeError):
        return False


def _loopback(peer):
    try:
        return ipaddress.ip_address(peer).is_loopback
    except ValueError:
        return False


def mobile_request(headers, port, peer):
    """Accept only Tailscale Serve identity-verified HTTPS proxy traffic on loopback.

    Tailscale Serve strips user-supplied identity headers and adds its own.
    Funnel does not add identity headers; tagged devices do not qualify here.
    """
    origin = mobile_origin()
    if not origin or not _loopback(peer):
        return False
    hostname = urllib.parse.urlsplit(origin).hostname
    forwarded_host = headers.get('X-Forwarded-Host', '').lower()
    forwarded_proto = headers.get('X-Forwarded-Proto', '')
    identity = headers.get('Tailscale-User-Login', '')
    if forwarded_host != hostname or forwarded_proto != 'https':
        return False
    if not identity or len(identity) > 256 or '\r' in identity or '\n' in identity:
        return False
    try:
        request_host = urllib.parse.urlsplit('https://' + headers.get('Host', ''))
        valid_public_host = (
            request_host.hostname == hostname
            and request_host.port in (None, 443)
            and not request_host.username and not request_host.password
            and not request_host.path and not request_host.query
        )
    except (ValueError, TypeError):
        valid_public_host = False
    return valid_public_host or local_request(headers, port)


def request_mode(headers, port, peer):
    # Forwarded requests never get the local bypass.
    forwarded = any(headers.get(key) for key in (
        'X-Forwarded-Host', 'X-Forwarded-Proto', 'Tailscale-User-Login',
    ))
    if forwarded:
        return 'mobile' if mobile_request(headers, port, peer) else None
    return 'local' if local_request(headers, port) else None


def valid_post_origin(headers, mode):
    origin = headers.get('Origin')
    if mode == 'mobile':
        # Mobile WebRTC / archive writes must be made by the configured HTTPS site.
        return origin == mobile_origin()
    if mode == 'local':
        return not origin or (
            origin in ('http://' + headers.get('Host', ''),
                       'https://' + headers.get('Host', ''))
        )
    return False
