export const STUDIO_STYLES = `
[data-studio-dock] {
  position: fixed;
  inset-block: 0;
  inset-inline-end: 0;
  width: min(360px, 100vw);
  z-index: 2147483000;
  display: flex;
  flex-direction: column;
  background: #FFFFFF;
  border-inline-start: 1px solid #E7E2DA;
  box-shadow: -18px 0 48px rgba(35,34,32,.10);
  font-family: var(--font-body, system-ui, sans-serif);
  font-size: 14px;
  color: #232220;
  --nv-accent: #8A5A3B;
}
[data-studio-dock] * { box-sizing: border-box; }

body.nv-studio-open { padding-inline-end: min(360px, 100vw); }
@media (max-width: 720px) {
  [data-studio-dock] { inset-block-start: auto; height: 74vh; width: 100vw; border-inline-start: 0; border-block-start: 1px solid #E7E2DA; }
  body.nv-studio-open { padding-inline-end: 0; padding-block-end: 74vh; }
}

.nv-dock__head { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid #E7E2DA; }
.nv-dock__title { font-weight: 600; font-size: 14px; margin: 0; flex: 1; }
.nv-dock__count { background: #F3E8DE; color: #6E4830; border-radius: 999px; padding: 2px 9px; font-size: 11.5px; font-weight: 600; }
.nv-dock__body { flex: 1; overflow-y: auto; overscroll-behavior: contain; }
.nv-dock__foot { border-top: 1px solid #E7E2DA; padding: 12px 16px; display: grid; gap: 8px; background: #FAF8F5; }

.nv-sec { border-bottom: 1px solid #E7E2DA; }
.nv-sec__btn { all: unset; display: flex; width: 100%; align-items: center; gap: 8px; padding: 13px 16px; cursor: pointer; font-weight: 550; }
.nv-sec__btn:hover { background: #FAF8F5; }
.nv-sec__btn:focus-visible { outline: 2px solid var(--nv-accent); outline-offset: -2px; }
.nv-sec__chev { margin-inline-start: auto; transition: rotate 180ms ease; color: #6B675F; font-size: 11px; }
.nv-sec[open] .nv-sec__chev { rotate: 90deg; }
.nv-sec__panel { padding: 4px 16px 18px; display: grid; gap: 12px; }
.nv-sec__note { color: #6B675F; font-size: 12.5px; line-height: 1.5; margin: 0; }

.nv-row { display: flex; align-items: center; gap: 10px; }
.nv-row label { flex: 1; font-size: 13px; }
.nv-row input[type=color] { inline-size: 34px; block-size: 28px; padding: 0; border: 1px solid #E7E2DA; border-radius: 6px; background: none; cursor: pointer; }
.nv-hex { inline-size: 86px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; text-transform: uppercase; }

.nv-input, .nv-select { width: 100%; border: 1px solid #E7E2DA; border-radius: 8px; padding: 7px 9px; font-size: 13px; background: #fff; color: inherit; }
.nv-input:focus, .nv-select:focus { outline: none; border-color: var(--nv-accent); box-shadow: 0 0 0 3px rgba(138,90,59,.14); }
.nv-label { font-size: 12px; font-weight: 600; color: #6B675F; display: block; margin-bottom: 5px; }

.nv-btn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border-radius: 8px; padding: 9px 14px; font-size: 13px; font-weight: 550; cursor: pointer; text-align: center; }
.nv-btn:focus-visible { outline: 2px solid var(--nv-accent); outline-offset: 2px; }
.nv-btn--primary { background: var(--nv-accent); color: #fff; }
.nv-btn--primary:hover { background: #6E4830; }
.nv-btn--ghost { border: 1px solid #E7E2DA; }
.nv-btn--ghost:hover { border-color: var(--nv-accent); color: var(--nv-accent); }
.nv-btn--quiet { color: #6B675F; padding-inline: 8px; }
.nv-btn--quiet:hover { color: #232220; }
.nv-btn--danger:hover { color: #A6702F; }
.nv-btn[disabled] { opacity: .45; cursor: not-allowed; }
.nv-btn--wide { width: 100%; }

.nv-toggle { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #E7E2DA; border-radius: 10px; cursor: pointer; }
.nv-toggle[data-on] { border-color: var(--nv-accent); background: #F3E8DE; }
.nv-toggle__dot { inline-size: 34px; block-size: 20px; border-radius: 999px; background: #E7E2DA; position: relative; flex: none; transition: background 180ms ease; }
.nv-toggle[data-on] .nv-toggle__dot { background: var(--nv-accent); }
.nv-toggle__dot::after { content: ''; position: absolute; inset-block-start: 2px; inset-inline-start: 2px; inline-size: 16px; block-size: 16px; border-radius: 999px; background: #fff; transition: translate 180ms ease; }
.nv-toggle[data-on] .nv-toggle__dot::after { translate: 14px 0; }
.nv-toggle__text { font-size: 13px; font-weight: 550; }

.nv-drop { border: 1.5px dashed #E7E2DA; border-radius: 12px; padding: 20px 14px; text-align: center; cursor: pointer; transition: border-color 150ms ease, background 150ms ease; }
.nv-drop:hover, .nv-drop[data-over] { border-color: var(--nv-accent); background: #F3E8DE; }
.nv-drop__title { font-weight: 600; font-size: 13px; margin: 0 0 3px; }
.nv-drop__hint { font-size: 12px; color: #6B675F; margin: 0; }
.nv-drop img { max-width: 100%; max-height: 72px; margin-inline: auto; display: block; }

.nv-changes { display: grid; gap: 6px; }
.nv-change { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; background: #FAF8F5; border-radius: 8px; padding: 7px 9px; }
.nv-change__path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #6B675F; overflow-wrap: anywhere; flex: 1; }
.nv-change__val { color: #232220; display: block; margin-top: 2px; font-family: var(--font-body, system-ui); }

.nv-status { font-size: 12px; padding: 7px 10px; border-radius: 8px; line-height: 1.45; }
.nv-status--ok { background: #EDF2EE; color: #3C5744; }
.nv-status--warn { background: #FBF1E4; color: #7A5220; }
.nv-status--info { background: #FAF8F5; color: #6B675F; }

.nv-modal { position: fixed; inset: 0; z-index: 2147483100; display: grid; place-items: center; padding: 20px; background: rgba(35,34,32,.55); }
.nv-modal__panel { background: #fff; border-radius: 14px; width: min(520px, 100%); max-height: 92vh; overflow-y: auto; padding: 20px; display: grid; gap: 14px; font-family: var(--font-body, system-ui); }
.nv-modal__title { margin: 0; font-size: 16px; font-weight: 600; }
.nv-modal__row { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.nv-modal__aspects { display: flex; gap: 6px; flex-wrap: wrap; }
.nv-chip { all: unset; box-sizing: border-box; border: 1px solid #E7E2DA; border-radius: 999px; padding: 5px 11px; font-size: 12px; cursor: pointer; }
.nv-chip[data-on] { border-color: var(--nv-accent); background: #F3E8DE; color: #6E4830; font-weight: 600; }

.nv-fab {
  position: fixed; inset-block-end: 18px; inset-inline-end: 18px; z-index: 2147482000;
  background: #232220; color: #fff; border-radius: 999px; padding: 11px 17px;
  font-family: system-ui, sans-serif; font-size: 13px; font-weight: 550; cursor: pointer;
  border: 0; box-shadow: 0 6px 22px rgba(35,34,32,.28);
}
.nv-fab:hover { background: var(--nv-accent); }
`
