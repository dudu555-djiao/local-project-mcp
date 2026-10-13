#!/usr/bin/env python3
"""Deterministic code-owned L icon, matching the existing desktop identity."""
from pathlib import Path
import struct, zlib

out = Path(__file__).resolve().parents[1] / 'windows/assets'
out.mkdir(parents=True, exist_ok=True)
def png(size):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            px, py = x / size, y / size
            color = (32, 54, 44, 255)
            if .12 <= px < .88 and .12 <= py < .88:
                color = (216, 235, 183, 255)
            if (.32 <= px < .44 and .27 <= py < .73) or (.32 <= px < .69 and .61 <= py < .73):
                color = (32, 54, 44, 255)
            raw.extend(color)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(raw))) + chunk(b'IEND', b'')
image = png(256)
(out / 'icon.ico').write_bytes(struct.pack('<HHH', 0, 1, 1) + struct.pack('<BBBBHHII', 0, 0, 0, 0, 1, 32, len(image), 22) + image)
(out / 'tray.png').write_bytes(png(32))
