# Skill: Interaction Design (dari aura.build, oleh wshobson)

Design and implement purposeful UI motion, microinteractions, and feedback patterns to enhance usability and user delight.

Tags: ux-design, ui-design, animation, micro-interactions, transitions, best-practices, javascript, css

## Kapan dipakai
- Menambah microinteraction untuk feedback pengguna
- Transisi halaman & komponen yang mulus
- Merancang loading state & skeleton screen
- Interaksi berbasis gesture
- Sistem notifikasi/toast
- Drag-and-drop
- Animasi yang dipicu scroll
- State hover & fokus

## Prinsip inti
1. **Purposeful Motion** — Gerak harus berkomunikasi, bukan dekorasi: feedback (konfirmasi aksi), orientasi (dari-mana-ke-mana), fokus (arahkan perhatian), kontinuitas (jaga konteks saat transisi).
2. **Timing**: 100–150ms micro-feedback (hover/klik) · 200–300ms transisi kecil (toggle, dropdown) · 300–500ms transisi sedang (modal, ganti halaman) · 500ms+ koreografi kompleks.
3. **Easing**:
   - `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` (masuk)
   - `--ease-in: cubic-bezier(0.55, 0, 1, 0.45)` (keluar)
   - `--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)` (berpindah)
   - `--spring: cubic-bezier(0.34, 1.56, 0.64, 1)` (overshoot playful)

## Pola interaksi
1. **Loading**: skeleton yang mempertahankan bentuk layout final; progress determinate saat bisa diukur.
2. **State transition**: toggle/switch dengan spring lembut; role="switch" + aria-checked.
3. **Page transition**: AnimatePresence mode="wait", y 20→0 masuk, 0→-20 keluar (durar 0.3).
4. **Feedback**: ripple dari titik klik (koordinat relatif, bersihkan 600ms).
5. **Gesture**: swipe-to-dismiss dengan ambang (mis. offset.x > 100).

## CSS animation patterns
Keyframes dasar: fadeIn (opacity+translateY 10px), pulse (opacity .5), spin (rotate 360deg).
Kartu: transition transform/box-shadow 0.2s; hover translateY(-4px) + shadow lembut.

## A11y
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```
Deteksi JS: `window.matchMedia("(prefers-reduced-motion: reduce)").matches` → durasi 0.

## Praktik terbaik & gotcha
- Transform & opacity only (60fps). Jangan animasi width/height/top/left.
- Over-animation = fatik; jangan blokir interaksi selama animasi; bersihkan listener (memory leak).
- `will-change` hemat. Hormati prefers-reduced-motion selalu.
- Skala timing konsisten antar komponen; spring > linear.
- Tes di perangkat nyata (performa beda jauh).