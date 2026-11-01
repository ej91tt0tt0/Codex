"""Build secret-free Windows bundles from an explicit file allowlist."""
from pathlib import Path
import zipfile
import hashlib
import shutil

ROOT = Path(__file__).parent
FILES = ['server.py', 'mobile_access.py', 'live_archive.py', 'companion.py', 'autonomy.py', 'public_sources.py', 'research.py', 'preferences.py', 'integrations.py', 'launch.py', 'start_windows.bat', 'start_mac.command', 'PC_START.txt', 'README.md', 'MOBILE_BROWSER.md', 'VALIDATION.md',
         'static/index.html', 'static/icon.svg', 'static/companion.js', 'static/handsfree.js', 'static/app.js', 'static/voice.js', 'static/audio.js', 'static/input.js', 'static/mic-worklet.js', 'static/scope.js', 'static/style.css', 'static/aster-theme.css', 'static/live-theme.css', 'static/home-live.css', 'static/cinematic.css', 'static/cinematic.js', 'static/cosmos.css', 'static/astral.css', 'static/astral.js', 'static/mobile.css', 'static/mobile.js', 'static/manifest.webmanifest', 'static/service-worker.js', 'static/archive.html', 'static/archive.js', 'static/archive.css', 'static/live.html', 'static/live.js', 'static/live.css', 'static/realtime.html', 'static/realtime.js', 'realtime_proxy.py', 'live_proxy.py', 'LIVE_PREVIEW.md', 'REALTIME_PREVIEW.md']


def build():
    dest = ROOT / 'downloads'
    dest.mkdir(exist_ok=True)
    target = dest / 'aster-windows.zip'
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for name in FILES:
            z.write(ROOT / name, 'yorisoi/' + name)
    with zipfile.ZipFile(target) as z:
        assert z.testzip() is None
        assert set(z.namelist()) == {'yorisoi/' + name for name in FILES}
    aliases = ['yorisoi-windows-flow.zip', 'yorisoi-windows-handsfree.zip', 'yorisoi-windows-research.zip', 'yorisoi-windows-maps.zip', 'yorisoi-windows.zip', 'yorisoi-windows-voice.zip', 'yorisoi-windows-companion.zip', 'yorisoi-windows-simple.zip', 'yorisoi-windows-cyber.zip', 'yorisoi-windows-adaptive.zip']
    for name in aliases:
        shutil.copyfile(target, dest / name)
    names = [target.name] + aliases
    lines = [hashlib.sha256((dest / name).read_bytes()).hexdigest() + '  ' + name for name in names]
    for video in sorted(list(dest.glob('*.mp4')) + list(dest.glob('*.mp3'))):
        lines.append(hashlib.sha256(video.read_bytes()).hexdigest() + '  ' + video.name)
    (dest / 'SHA256SUMS').write_text('\n'.join(lines) + '\n')
    print('Verified bundle:', target.name, target.stat().st_size, 'bytes')


if __name__ == '__main__':
    build()
