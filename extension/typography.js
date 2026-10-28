(() => {
  // One bundled type scale for extension pages and isolated player cards.
  // Caption fonts/sizes remain a separate user-controlled preference contract.
  const fontUrl = globalThis.chrome?.runtime?.getURL?.("fonts/OpenSans-Variable.ttf");
  const fontFace = fontUrl ? `@font-face {
      font-family: "Dub Open Sans";
      src: url(${JSON.stringify(fontUrl)}) format("truetype");
      font-style: normal; font-weight: 300 800; font-display: swap;
    }` : "";
  const css = `
    ${fontFace}
    :root, :host {
      --ui-font: "Dub Open Sans", Tahoma, Arial, system-ui, sans-serif;
      --ui-font-mono: "Cascadia Mono", Consolas, monospace;
      --ui-size-meta: 12px;
      --ui-size-body: 14px;
      --ui-size-title: 16px;
      --ui-size-section: 18px;
      --ui-size-page: 22px;
      --ui-leading-body: 1.5;
      --ui-leading-heading: 1.35;
    }
  `;
  globalThis.DubTypography = { css };
  // Register only the uniquely named face on host pages. UI tokens stay inside
  // our Shadow DOM, so the site's own typography cannot be changed by injection.
  if (fontUrl && !document.getElementById("dub-transcript-lab-typography")) {
    const style = document.createElement("style");
    style.id = "dub-transcript-lab-typography";
    style.textContent = globalThis.location?.protocol === "chrome-extension:" ? css : fontFace;
    (document.head || document.documentElement).append(style);
  }
})();
