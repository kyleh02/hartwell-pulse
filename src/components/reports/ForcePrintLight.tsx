/**
 * The light palette, forced, on any page whose job is to become a PDF.
 *
 * The portal is dark by default and the report document is light, so anything
 * printed from a dark page comes out as a light document floating on a black
 * sheet. globals.css already has an `@media print` block that flips the tokens
 * and whitens html and body, and by the compiled CSS it is correct. It has not
 * been enough in practice, and rather than keep guessing at why, the two pages
 * that exist to be printed now state the palette themselves.
 *
 * No media query and no layer, so there is no cascade to lose and no
 * dependence on the renderer emulating print. Rendered on both the admin
 * preview and the renderer's own print route, because Kyle prints one by hand
 * and Chromium photographs the other, and a fix on one of them is a fix for
 * half the problem.
 *
 * Same values as the print block, deliberately. If those ever change, these
 * change with them, and a mismatch would mean a hand-printed PDF and a
 * generated one no longer look the same.
 */
export function ForcePrintLight() {
  return (
    <style>{`
      :root, :root[data-theme="dark"], :root[data-theme="light"] {
        --pulse-bg: #ffffff;
        --pulse-surface: #ffffff;
        --pulse-surface-2: #f6f5f1;
        --pulse-border: rgba(0, 0, 0, 0.12);
        --pulse-border-strong: rgba(0, 0, 0, 0.2);
        --pulse-gold: #8a7645;
        --pulse-text: #1a1714;
        --pulse-text-dim: rgba(26, 23, 20, 0.72);
        --pulse-text-mute: rgba(26, 23, 20, 0.5);
      }
      html, body {
        background: #ffffff !important;
        color: #1a1714 !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      /* The shell paints its own full-height background behind the document.
         Token-driven, so the rule above should already have whitened it, and
         saying so explicitly costs nothing and removes one more thing that has
         to be true. */
      body > *, body > * > * {
        background-color: transparent;
      }
    `}</style>
  );
}
