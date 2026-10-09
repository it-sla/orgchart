import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { imgUrl } from "./api";
import { Avatar } from "./OrgChart";

const STAGE = 240, OUT = 512, MAX_ZOOM = 4;

export function chooseImage(file: File | undefined) {
  if (!file) return null;
  if (file.size > 5_000_000) throw new Error("Choose an image smaller than 5 MB.");
  if (!/\.(png|jpe?g|gif|webp)$/i.test(file.name) && !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error("Choose a PNG, JPG, GIF, or WebP image.");
  return file;
}

type Props = {
  label: string;
  name: string;
  current: string | null;
  /** true: drag/zoom the photo inside a circle and upload the framed square. false: upload the file untouched (logos). */
  crop: boolean;
  /** Set to a function that produces the file to upload while a new or adjusted image is pending. */
  getRef: MutableRefObject<(() => Promise<File>) | null>;
  onDirty: (pending: boolean) => void;
  onRemove: () => void;
};

/** Drop / click / paste an image, then (for photos) drag and zoom it to line the face up inside the circle. */
export default function PhotoEditor({ label, name, current, crop, getRef, onDirty, onRemove }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const img = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const objectUrl = useRef<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  const base = size.w ? STAGE / Math.min(size.w, size.h) : 1;
  const scale = base * zoom;
  // Zooming out to the whole photo is allowed, so a tall photo can also be slid left/right (and a wide one up/down).
  const minZoom = size.w ? Math.min(1, Math.min(size.w, size.h) / Math.max(size.w, size.h)) : 1;
  const axis = (v: number, dim: number) => { const lo = Math.min(0, STAGE - dim), hi = Math.max(0, STAGE - dim); return Math.min(hi, Math.max(lo, v)); };
  const clamp = (p: { x: number; y: number }, s = scale) => ({ x: axis(p.x, size.w * s), y: axis(p.y, size.h * s) });
  const shown = clamp(pos);

  const release = () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; };
  useEffect(() => release, []);

  // The framing is read at save time through this ref, so dragging never re-renders the whole form.
  const framing = useRef({ shown, scale });
  framing.current = { shown, scale };

  const reset = (n = size) => { setZoom(1); const s = STAGE / Math.min(n.w, n.h); setPos({ x: (STAGE - n.w * s) / 2, y: (STAGE - n.h * s) / 2 }); };

  const open = (url: string, owned: boolean, original?: File) => {
    release();
    if (owned) objectUrl.current = url;
    setErr(""); setSrc(url); setSize({ w: 0, h: 0 });
    getRef.current = original && !crop ? async () => original : null;
    onDirty(Boolean(original) && !crop);
  };
  const take = (file: File | undefined) => {
    try {
      const picked = chooseImage(file);
      if (picked) open(URL.createObjectURL(picked), true, picked);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not use that image."); }
  };
  const loaded = () => {
    const el = img.current!;
    const n = { w: el.naturalWidth, h: el.naturalHeight };
    setSize(n);
    reset(n);
    if (crop) { getRef.current = render; onDirty(true); }
  };

  const render = async () => {
    const el = img.current;
    if (!el) throw new Error("No image to save.");
    const { shown: p, scale: s } = framing.current;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = OUT;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, OUT, OUT); // visible only if the photo is zoomed out smaller than the circle
    g.drawImage(el, -p.x / s, -p.y / s, STAGE / s, STAGE / s, 0, 0, OUT, OUT);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    if (!blob) throw new Error("Could not prepare the photo. Try a different image.");
    return new File([blob], "photo.png", { type: "image/png" });
  };

  const setZoomKeepingCentre = (next: number) => {
    const z = Math.min(MAX_ZOOM, Math.max(minZoom, next));
    const s = base * z;
    const cx = (STAGE / 2 - shown.x) / scale, cy = (STAGE / 2 - shown.y) / scale;
    setZoom(z);
    setPos(clamp({ x: STAGE / 2 - cx * s, y: STAGE / 2 - cy * s }, s));
  };
  const wheelZoom = useRef(setZoomKeepingCentre);
  wheelZoom.current = setZoomKeepingCentre;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (ev: WheelEvent) => { ev.preventDefault(); wheelZoom.current(zoomRef.current * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [src, crop]);

  // Paste an image from the clipboard anywhere in the dialog.
  const take_ = useRef(take);
  take_.current = take;
  useEffect(() => {
    const paste = (ev: ClipboardEvent) => {
      const file = Array.from(ev.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (file) { ev.preventDefault(); take_.current(file); }
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, []);

  const clear = () => {
    release(); setSrc(null); setSize({ w: 0, h: 0 }); setErr("");
    getRef.current = null; onDirty(false);
  };

  const key = (ev: React.KeyboardEvent) => {
    const step = ev.shiftKey ? 30 : 10;
    const move: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (move[ev.key]) { ev.preventDefault(); setPos(clamp({ x: shown.x + move[ev.key][0], y: shown.y + move[ev.key][1] })); }
    else if (ev.key === "+" || ev.key === "=") { ev.preventDefault(); setZoomKeepingCentre(zoom * 1.1); }
    else if (ev.key === "-") { ev.preventDefault(); setZoomKeepingCentre(zoom / 1.1); }
  };

  const picker = <input className="dropzone-input" type="file" accept=".png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp" aria-label={`${label}: choose an image file`} onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />;

  return <div className="photo-editor" role="group" aria-label={label}>
    <span className="photo-editor-label">{label}</span>
    {src && crop ? <>
      <div ref={stage} className="crop-stage" tabIndex={0} role="group" aria-label="Photo framing. Drag, or use the arrow keys to move and plus and minus to zoom."
        style={{ width: STAGE, height: STAGE }} onKeyDown={key}
        onPointerDown={(ev) => { ev.currentTarget.setPointerCapture(ev.pointerId); drag.current = { x: ev.clientX, y: ev.clientY, ox: shown.x, oy: shown.y }; }}
        onPointerMove={(ev) => { const d = drag.current; if (d) setPos(clamp({ x: d.ox + ev.clientX - d.x, y: d.oy + ev.clientY - d.y })); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <img ref={img} src={src} alt="" draggable={false} onLoad={loaded} onError={() => { setErr("That file could not be read as an image."); clear(); }}
          style={{ left: shown.x, top: shown.y, width: size.w * scale, height: size.h * scale, visibility: size.w ? "visible" : "hidden" }} />
      </div>
      <label className="crop-zoom">Zoom<input type="range" min={minZoom} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => setZoomKeepingCentre(Number(e.target.value))} /></label>
      <p className="muted">Drag the photo in any direction to line up the face; zoom out to move it further. This circle is how it appears on the chart.</p>
      <div className="row">
        <button type="button" className="btn" onClick={() => reset()}>Reset</button>
        <button type="button" className="btn" onClick={clear}>Cancel changes</button>
      </div>
    </> : <>
      {src && !crop && <img className="logo-preview" src={src} alt={`${label} preview`} onError={() => { setErr("That file could not be read as an image."); clear(); }} />}
      {!src && current && (crop ? <Avatar e={{ name, photo_path: current }} size={64} /> : <img className="logo-preview" src={imgUrl(current)} alt={`Current ${label.toLowerCase()}`} />)}
      <label className={"dropzone" + (over ? " over" : "")}
        onDragOver={(ev) => { ev.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(ev) => { ev.preventDefault(); setOver(false); take(ev.dataTransfer.files[0]); }}>
        {picker}
        <b>Drop {crop ? "a photo" : "an image"} here</b>
        <span>or click to browse, or paste. PNG, JPG, GIF or WebP, up to 5 MB.</span>
      </label>
      <div className="row">
        {crop && current && !src && <button type="button" className="btn" onClick={() => open(imgUrl(current)!, false)}>Adjust photo</button>}
        {(src || current) && <button type="button" className="btn" onClick={() => { clear(); if (current) onRemove(); }}>Remove {label.toLowerCase()}</button>}
      </div>
    </>}
    {err && <p className="err" role="alert">{err}</p>}
  </div>;
}
