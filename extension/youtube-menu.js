(() => {
  // The host deliberately resets inherited page styles. The panel itself must
  // own its typography/color; :host declarations cannot override inline all.
  const css = `
    :host { color-scheme: dark; }
    *, *::before, *::after { box-sizing: border-box; }
    .trigger {
      display: grid; place-items: center; width: 48px; height: 100%; min-height: 40px;
      padding: 0; border: 0; background: transparent; color: #f5f5f0; cursor: pointer;
    }
    .trigger[aria-expanded="true"] { color: #8dc49b; }
    .trigger svg { width: 25px; height: 25px; }
    .menu {
      --menu-text: #f0f3ee; --menu-muted: #b8c4b8; --menu-accent: #8dc49b;
      --menu-surface: #101a14; --menu-control: #1a2920; --menu-border: #3e5947;
      pointer-events: auto; position: absolute;
      bottom: var(--yt-panel-bottom, 60px); right: var(--yt-panel-right, 12px);
      width: min(350px, 88vw, var(--yt-panel-width, 88vw));
      max-height: min(70vh, 580px, var(--yt-panel-height, 70vh));
      display: flex; flex-direction: column; overflow: hidden;
      padding: 0; border: 1px solid var(--menu-border); border-radius: 14px;
      background: var(--menu-surface); color: var(--menu-text); color-scheme: dark;
      font: 400 var(--ui-size-body, 14px)/1.5 var(--ui-font, "Segoe UI", Tahoma, sans-serif);
      text-align: start; text-shadow: none; letter-spacing: normal;
      box-shadow: 0 16px 48px #0009, 0 2px 8px #0006;
      -webkit-font-smoothing: antialiased;
    }
    .menu[hidden] { display: none; }
    .preparation-notice {
      position: absolute; top: 16px; left: 16px; max-width: min(360px, calc(100% - 32px));
      padding: 8px 12px; border: 1px solid #56745e; border-radius: 8px;
      background: #101a14ed; color: #f0f3ee; pointer-events: none;
      font: 400 12px/1.5 var(--ui-font, "Segoe UI", Tahoma, sans-serif);
      text-shadow: none; letter-spacing: normal; overflow-wrap: anywhere;
      opacity: 0; transition: opacity .3s;
    }
    .preparation-notice[data-visible="true"] { opacity: 1; }
    .preparation-notice[hidden] { display: none; }
    .menu-header { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 12px 12px 18px; border-bottom: 1px solid var(--menu-border); }
    .menu-eyebrow { display: block; margin-bottom: 2px; font-size: 12px; font-weight: 600; letter-spacing: .08em; color: var(--menu-accent); }
    .menu-title { margin: 0; font: 700 var(--ui-size-section, 18px)/1.35 var(--ui-font, "Segoe UI", Tahoma, sans-serif); color: var(--menu-text); }
    .menu button, .menu select, .menu input, .menu summary { font-family: inherit; }
    .menu button { cursor: pointer; color: var(--menu-text); }
    .menu-close { display: grid; place-items: center; width: 44px; min-height: 44px; padding: 10px; border: 0; border-radius: 8px; background: transparent; }
    .menu-close svg { width: 18px; height: 18px; }
    .menu-body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px 18px 10px; scrollbar-width: thin; scrollbar-color: #56745e var(--menu-surface); }
    .menu-body::-webkit-scrollbar { width: 6px; }
    .menu-body::-webkit-scrollbar-thumb { border-radius: 8px; background: #56745e; }
    .menu-body::-webkit-scrollbar-track { background: var(--menu-surface); }
    .menu-group + .menu-group { padding-top: 10px; margin-top: 8px; border-top: 1px solid var(--menu-border); }
    .group-title { margin: 10px 0 4px; font-size: 12px; font-weight: 700; color: var(--menu-muted); letter-spacing: .07em; text-transform: uppercase; }
    .menu label { margin: 0; color: var(--menu-text); font-size: 14px; font-weight: 500; }
    .toggle-row { display: flex; align-items: center; justify-content: space-between; min-height: 52px; gap: 14px; padding: 10px 0; cursor: pointer; }
    .toggle-copy { flex: 1; min-width: 0; }
    .toggle-label { display: block; line-height: 1.4; }
    .toggle-help { display: block; margin-top: 4px; font-size: 12px; font-weight: 400; line-height: 1.5; color: var(--menu-muted); }
    .toggle-control { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; position: relative; min-height: 32px; }
    .toggle-state { font-size: 12px; font-weight: 600; color: var(--menu-muted); }
    .toggle-control input { position: absolute; right: 0; z-index: 1; width: 38px; height: 32px; margin: 0; opacity: 0; cursor: pointer; }
    .switch-track { display: inline-block; width: 36px; height: 20px; padding: 2px; border: 1px solid #789180; border-radius: 20px; background: #293b30; pointer-events: none; transition: background .16s; }
    .switch-track::after { content: ''; display: block; width: 14px; height: 14px; border-radius: 50%; background: #d9e2d9; transition: transform .16s; }
    .toggle-control input:checked + .switch-track { background: #8dc49b; border-color: #8dc49b; }
    .toggle-control input:checked + .switch-track::after { transform: translateX(16px); background: #102316; }
    .toggle-control:has(input:checked) .toggle-state { color: var(--menu-accent); }
    .menu .field-row { display: block; padding: 8px 0; font-size: 12px; color: var(--menu-muted); }
    .menu select, .menu input[type="number"] { width: 100%; min-height: 44px; margin-top: 6px; padding: 8px 10px; border: 1px solid var(--menu-border); border-radius: 8px; background: var(--menu-control); color: var(--menu-text); font-size: 14px; line-height: 1.4; }
    .menu select { min-width: 0; max-width: 100%; cursor: pointer; font-size: var(--ui-size-select, 12px); font-weight: 400; letter-spacing: normal; }
    .menu option { color: #f0f3ee; background: #1a2920; font: 400 var(--ui-size-select, 12px)/1.5 var(--ui-font, "Segoe UI", Tahoma, sans-serif); letter-spacing: normal; }
    .menu input[type="color"] { display: block; width: 100%; height: 44px; padding: 4px; margin-top: 6px; border: 1px solid var(--menu-border); border-radius: 7px; background: var(--menu-control); cursor: pointer; }
    .menu details { border-top: 1px solid var(--menu-border); margin-top: 10px; }
    .menu summary { min-height: 44px; padding: 12px 0; color: var(--menu-text); font-size: 14px; font-weight: 650; cursor: pointer; }
    .menu summary::marker { color: var(--menu-accent); }
    .menu fieldset { min-width: 0; margin: 8px 0 14px; padding: 6px 12px 10px; border: 1px solid var(--menu-border); border-radius: 9px; }
    .menu legend { padding: 0 6px; color: var(--menu-accent); font-size: 12px; font-weight: 650; }
    .menu-actions { display: grid; gap: 8px; padding: 8px 0 12px; }
    .menu-action { width: 100%; min-height: 44px; padding: 8px 10px; border: 1px solid var(--menu-border); border-radius: 8px; background: var(--menu-control); font-size: 12px; font-weight: 600; text-align: start; }
    .menu-action:hover, .menu-close:hover { background: #2a4031; }
    .menu-action:active, .menu-close:active { background: #36543f; }
    .menu-footer { flex: 0 0 auto; max-height: 96px; overflow-y: auto; padding: 10px 18px; border-top: 1px solid var(--menu-border); background: #152219; overflow-wrap: anywhere; }
    .menu-status { margin: 0; color: var(--menu-muted); font-size: 12px; line-height: 1.5; }
    .menu-status[data-level="success"] { color: var(--menu-accent); }
    .menu-status[data-level="warning"] { color: #f0ce92; }
    .menu-status:focus-visible, .menu :focus-visible, .trigger:focus-visible { outline: 2px solid #8dc49b; outline-offset: 3px; }
    .toggle-control input:focus-visible { outline: none; }
    .toggle-control input:focus-visible + .switch-track { outline: 2px solid #8dc49b; outline-offset: 3px; }
    @media (prefers-reduced-motion: reduce) { *, *::after { transition: none !important; } }
  `;
  globalThis.DubYouTubeMenu = Object.freeze({ css });
})();
