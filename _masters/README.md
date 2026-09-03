# Source masters — not deployed

The original supplied artwork and audio, byte-for-byte as delivered.
Nothing in the game references these; the shipped files are the WebP and
Ogg/Opus versions in `assets/` and `sfx/`.

They are kept because they are the masters — every future re-encode
should start here, not from a lossy WebP. Three of the six images are
reproduced from these files **exactly**:

| master | shipped | relationship |
|---|---|---|
| `airplane.png` | `assets/airplane.webp` | lossless, bit-identical |
| `mountain.png` | `assets/mountain.webp` | lossless, bit-identical |
| `start button.png` | `assets/start button.webp` | lossless, bit-identical |
| `background.png` | `assets/background.webp` | lossy q82, 40.9 dB PSNR |
| `runway .png` | `assets/runway .webp` | lossy q82, 36.7 dB PSNR |
| `start screen.png` | `assets/start screen.webp` | lossy q82, 35.6 dB PSNR |
| `*.mp3` | `sfx/*.ogg` | Opus 69–93 kbps, durations identical |

## Re-encoding

    # opaque painted art
    cwebp -q 82 -m 6 -metadata none  in.png -o out.webp
    # hard-edged cutouts with alpha (bit-identical; -exact is required)
    cwebp -lossless -exact -z 9 -metadata none  in.png -o out.webp
    # audio
    afconvert -f WAVE -d LEI16 in.mp3 tmp.wav
    opusenc --cvbr --bitrate 92 --comp 10 --discard-comments tmp.wav out.ogg

Then regenerate the preloader's size table:

    python3 tools/sizes.py --write
