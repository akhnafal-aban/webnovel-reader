#!/usr/bin/env python3
# Generator situs membaca multi-volume (v2): baca volumes.json →
# menyalin aset gambar ke mt-reader/img/<vid>/ dan menulis data/<vid>/chapters.js + data/books.js
import re, glob, os, json, shutil

D = os.path.dirname(os.path.abspath(__file__))          # folder init skrip ini
SITE = D                                                  # mt-reader (skrip ini tinggal di dalamnya)

CFG = os.path.join(SITE, "volumes.json")
vols = json.load(open(CFG, encoding="utf-8"))["volumes"]

def figure_block(src, vid, orient="portrait"):
    bname = os.path.basename(src).replace(".jpeg", ".jpg")
    return ["fig", {"src": f"img/{vid}/full/{bname}", "thumb": f"img/{vid}/thumbs/{bname}", "orient": orient}]

def parse_blocks(path, inline):
    md = open(path, encoding="utf-8").read()
    title = re.match(r"^#\s+(.+?)\s*$", md, flags=re.M)
    title = title.group(1).strip() if title else os.path.basename(path)
    blocks = []
    paras = [p.strip() for p in re.split(r"\n\s*\n", md) if p.strip()]
    for para in paras:
        p = re.sub(r"\n", " ", para)
        m = re.fullmatch(r"\[p\.(\d+)\]", para)
        if m:
            key = m.group(1)
            if key in inline:
                blocks.append(inline[key])
            continue
        if re.fullmatch(r"^\(hal\.\s*[\d-]+\s*\|\s*hlm EN\)\s*$", p):
            continue
        if p == "***":
            blocks.append(["orn", None]); continue
        if re.fullmatch(r"\*\*(.+?)\*\*", p):
            blocks.append(["pov", re.fullmatch(r"\*\*(.+?)\*\*", p).group(1)]); continue
        if re.match(r"^#\s+", p):
            continue
        blocks.append(["p", p])
    return title, blocks

def copy_images(v):
    vid = v["vid"]
    src = v["illust_dir"]
    dst_full = os.path.join(SITE, "img", vid, "full")
    dst_th = os.path.join(SITE, "img", vid, "thumbs")
    os.makedirs(dst_full, exist_ok=True)
    os.makedirs(dst_th, exist_ok=True)
    files = sorted(glob.glob(os.path.join(src, "*.jpeg")))
    for f in files:
        base = os.path.basename(f).replace(".jpeg", ".jpg")
        shutil.copyfile(f, os.path.join(dst_full, base))
        th = os.path.join(dst_th, base)
        if not os.path.exists(th):
            os.system(f'sips -Z 420 -s format jpeg "{os.path.join(dst_full, base)}" --out "{th}" >/dev/null 2>&1')
    # sampul
    cv = None
    for cname in ("illust_p001", "cover"):
        for f in files:
            if os.path.basename(f).startswith(cname):
                cv = f
                break
        if cv: break
    cdir = os.path.join(SITE, "img", vid, "cover")
    os.makedirs(cdir, exist_ok=True)
    cover_path = os.path.join(cdir, "cover.jpg")
    if cv:
        shutil.copyfile(cv, cover_path)
    return cover_path

def main():
    books = []
    for v in vols:
        vid = v["vid"]
        cover = os.path.relpath(copy_images(v), SITE)
        imap = json.load(open(v["illust_map"], encoding="utf-8"))
        inline = {}
        for key, (src, orient) in imap.get("inline", {}).items():
            inline[key] = figure_block(src, vid, orient)
        front = [figure_block(s, vid) for s in imap.get("front", [])]
        back = [figure_block(s, vid, "land") for s in imap.get("back", {}).get("imgs", [])]
        files = sorted(glob.glob(os.path.join(v["id_dir"], "*.md")))
        chaps, data = [], []
        for f in files:
            title, blocks = parse_blocks(f, inline)
            chaps.append({"id": len(chaps), "title": title})
            data.append({"title": title, "blocks": blocks})
        books.append({
            "id": vid, "num": v["num"], "title": v["title"], "subtitle": v["subtitle"],
            "cover": "img/" + vid + "/cover/cover.jpg", "lang": v["lang"], "series": v["series"],
            "chapters": chaps, "frontGallery": front,
            "backGallery": [{"title": imap["back"]["title"], "imgs": back}] if imap.get("back") else [],
        })
        os.makedirs(os.path.join(SITE, "data", vid), exist_ok=True)
        with open(os.path.join(SITE, "data", vid, "chapters.js"), "w", encoding="utf-8") as fh:
            fh.write(f"window.__MT_{vid.upper()}__ = " + json.dumps(data, ensure_ascii=False) + ";\n")
        nfig = sum(1 for c in data for b in c["blocks"] if b[0] == "fig")
        print(f"[{vid}] bab {len(chaps)} · figur {nfig} · data/img siap")
    with open(os.path.join(SITE, "data", "books.js"), "w", encoding="utf-8") as fh:
        fh.write("window.__MT_BOOKS__ = " + json.dumps(books, ensure_ascii=False) + ";\n")

if __name__ == "__main__":
    main()