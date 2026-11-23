"""Rebuild the bundled 36s sample with Pillow, FFmpeg, and installed fonts."""
from pathlib import Path
import os
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1] / "public" / "sample"
SERIF = os.environ.get("SAMPLE_SERIF", "C:/Windows/Fonts/georgiai.ttf")
SANS = os.environ.get("SAMPLE_SANS", "C:/Windows/Fonts/arialbd.ttf")

def ff(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *map(str, args)], check=True)

with tempfile.TemporaryDirectory() as temp:
    work = Path(temp)
    for i, (name, title) in enumerate([
        ("ridge", "Above the clouds"), ("summit", "Into the valley"), ("lake", "Still waters")
    ]):
        image = Image.open(ROOT / f"{name}.jpg").convert("RGB")
        image = image.crop((0, 50, 1600, 850)).resize((1280, 640))
        shade = Image.new("RGBA", image.size)
        pen = ImageDraw.Draw(shade)
        for y in range(640):
            pen.line((0, y, 1280, y), fill=(8, 13, 20, int(105 * (y / 640) ** 2)))
        image = Image.alpha_composite(image.convert("RGBA"), shade).convert("RGB")
        pen = ImageDraw.Draw(image)
        pen.rectangle((57, 471, 86, 474), fill="#ffa17e")
        pen.text((57, 491), f"F I E L D   N O T E S     /     0 {i+1}", font=ImageFont.truetype(SANS, 16), fill="#fff6ed")
        pen.text((53, 510), title, font=ImageFont.truetype(SERIF, 73), fill="#fff9f2")
        still = work / f"{i}.jpg"
        image.save(still, quality=94)
        if i == 0:
            image.save(ROOT / "poster.jpg", quality=92)
        ff("-i", still, "-vf", "scale=1920:960,zoompan=z='1+on*0.00014':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=288:s=1280x640:fps=24",
           "-frames:v", "288", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", work / f"{i}.mp4")
    listing = work / "inputs.txt"
    listing.write_text("\n".join(f"file '{i}.mp4'" for i in range(3)), encoding="ascii")
    ff("-f", "concat", "-safe", "0", "-i", listing, "-f", "lavfi", "-i",
       "aevalsrc=0.045*sin(2*PI*146.83*t)*(0.6+0.4*cos(0.9*t))+0.025*sin(2*PI*220*t)*(1+sin(1.4*t))+0.02*sin(2*PI*293.66*t):d=36",
       "-af", "afade=t=in:d=2,afade=t=out:st=33:d=3", "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", ROOT / "alpine.mp4")
    ff("-i", ROOT / "alpine.mp4", "-filter_complex", "volume=4,showwavespic=s=1000x64:colors=0x94b5ba:scale=sqrt",
       "-frames:v", "1", ROOT / "wave.png")
