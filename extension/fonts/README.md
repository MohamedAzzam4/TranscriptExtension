# Bundled Open Sans

Retrieved 2026-10-28 from the official Google Fonts repository:
https://github.com/google/fonts/tree/main/ofl/opensans

`OpenSans-Variable.ttf` is the unmodified `OpenSans[wdth,wght].ttf`, renamed
for a stable extension asset path. Licensed under the adjacent
`OFL-OpenSans.txt` (SIL Open Font License1.1).

SHA256:36643644f318a812aab2d2ed3bb98f8cf0872527f835fe9398d95fe6b9adb878

Only this bundled file is requested at runtime. Missing glyphs, including Arabic,
use the Tahoma/Arial/system fallback stack. Source website typography is not
changed: injected pages receive only the uniquely named font registration;
extension UI tokens are scoped to our Shadow DOM.
