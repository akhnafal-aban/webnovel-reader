# Skill: Anime.js v4 (dari aura.build, oleh BowTiedSwan)

JavaScript-based animation: CSS props, SVG, atribut DOM, JavaScript Objects. Tag: animation, motion, scroll-effects, javascript, performance.

## Instalasi
- NPM: `npm install animejs`
- ESM: `import { animate } from 'animejs'` (modular & tree-shakeable; standalone: `animejs/animation`, `animejs/timeline`, `animejs/timer`)
- CDN ESM: `import { animate } from 'https://esm.sh/animejs'`
- CDN UMD: `<script src="https://cdn.jsdelivr.net/npm/animejs/dist/bundles/anime.umd.min.js"></script>` → `const { animate } = anime;`

CATATAN UNTUK PROYEK OFFLINE: gunakan versi NPM/lokal (vendored) — jangan bergantung CDN.

## Modul lengkap v4
Timer (createTimer) · Animation (animate) · Timeline (createTimeline) · Animatable (createAnimatable) · Draggable (createDraggable) · Layout (createLayout, NEW) · Scope (createScope) · Events/Scroll (onScroll) · SVG utilities (morphTo, createDrawable, createMotionPath) · Text utilities (splitText) · Utilities (stagger, $, get/set, random, snap, mapRange, lerp, damp, dll) · Easings (built-in Quad..Bounce, cubic bezier kustom, spring via createSpring) · WAAPI (konversi ease, sync WAAPI).

## Quick reference
Basic:
```js
import { animate } from 'animejs';
animate('.element', { translateX: 250, rotate: '1turn', duration: 800, ease: 'outExpo' });
```
Timeline:
```js
import { createTimeline } from 'animejs';
const tl = createTimeline({ defaults: { duration: 500 } });
tl.add('.box1', { x: 100 })
  .add('.box2', { x: 100 }, '<')      // mulai bersama animasi sebelumnya
  .add('.box3', { x: 100 }, '-=200');  // 200ms sebelum selesai
```
Stagger:
```js
import { animate, stagger } from 'animejs';
animate('.item', { translateY: [-20, 0], opacity: [0, 1], delay: stagger(100, { from: 'center' }), duration: 600 });
```
Scroll:
```js
import { animate, onScroll } from 'animejs';
animate('.element', { translateX: [0, 500], autoplay: onScroll({ target: '.element', sync: true }) });
```
SVG line drawing: `animate(createDrawable('path'), { draw: ['0 0', '0 1'], duration: 2000, ease: 'inOutQuad' });`
Draggable + spring:
```js
import { createDraggable, createSpring } from 'animejs';
createDraggable('.draggable', { container: '.container', releaseEase: createSpring({ stiffness: 200, damping: 20 }) });
```
Function-based: `translateX: (el, i) => i * 50` · Keyframes: `translateX: [{to:100, duration:500},{to:0, duration:500}]`.

## Bundle (min+gzip)
Full ~24.5 KB · Timer 5.6 · Animation +5.2 · Timeline +0.55 · Draggable +6.4 · Scroll +4.3 · WAAPI ~3.5 — modul terpisah demi bundle kecil.

## Referensi
Docs: https://animejs.com/documentation · Easing editor: https://animejs.com/easing-editor · GitHub: https://github.com/juliangarnier/anime

## Cocok dipakai di webnovel reader untuk
- Sequence masuk bab (stagger judul→isi→nav) · page-turn hint di mode paged · lightbox zoom/pan halus + spring release · swipe ilustrasi (Draggable dgn releaseSpring) · scroll-driven reveal galeri · micro-feedback tombol (scale/press). Ingat prefers-reduced-motion & animasi transform/opacity saja.