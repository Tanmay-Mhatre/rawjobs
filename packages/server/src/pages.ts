/**
 * The pages RawJobs shows when the dashboard can't: "There's no page at this address" (404) and
 * "RawJobs isn't running" (offline.html, kept by the browser's service worker for when the server
 * is stopped). They're plain HTML with their own styles and no app bundle, so they work when the
 * bundle is what's missing, or when nothing is serving it.
 *
 * The pictures (RawJobs asleep, the Desktop with its shortcut) and their styles are shared with the
 * dashboard's own "isn't running" window (apps/web/src/components/ServerDown.tsx), so both look the
 * same. Nothing here may import Node modules: the dashboard bundles this file.
 */

export type Platform = "win32" | "darwin" | "linux" | string;

/** Where this computer keeps apps, in its own words. */
export function appPlace(platform: Platform | null | undefined): string {
  if (platform === "win32") return "Or search for RawJobs in the Start menu.";
  if (platform === "darwin") return "Or open it from Applications.";
  return "Or open it from your app menu.";
}

/** The log a server that didn't start wrote to (`rawjobs open` starts it with --log there). */
export function logPath(platform: Platform | null | undefined): string {
  return platform === "win32" ? "%USERPROFILE%\\.rawjobs\\logs\\server.log" : "~/.rawjobs/logs/server.log";
}

/**
 * The pictures' styles. They use the dashboard's design tokens (var(--bg-raised)…); the standalone
 * pages define the few they need (PAGE_TOKENS). Motion: each step uses the motion tokens; the
 * wake-up story chains them (design/README.md, Motion: the not-running exception), plays once, and
 * shows its last frame under reduced motion. The logo's ink square is the one fixed color: it's the
 * app icon, as on the Desktop.
 */
export const SCENE_CSS = `
.rjd-hero{position:relative;height:208px;overflow:hidden;border-bottom:1px solid var(--border-subtle);background:radial-gradient(120% 90% at 50% 0%,var(--bg-raised),var(--bg-inset))}
.rjd-art{position:relative;height:100%;min-height:340px;overflow:hidden;border:1px solid var(--border-default);border-radius:var(--radius-md,4px);background:radial-gradient(120% 90% at 50% 0%,var(--bg-raised),var(--bg-inset));box-shadow:var(--shadow-l2)}
.rjd-scene{position:absolute;inset:0;display:grid;place-items:center}
.rjd-grid{position:absolute;inset:0;opacity:.5;background-image:linear-gradient(var(--border-subtle) 1px,transparent 1px),linear-gradient(90deg,var(--border-subtle) 1px,transparent 1px);background-size:28px 28px;-webkit-mask-image:radial-gradient(60% 70% at 50% 45%,#000,transparent);mask-image:radial-gradient(60% 70% at 50% 45%,#000,transparent)}
.rjd-stack{position:absolute;left:50%;top:50%;width:240px;height:124px;margin:-72px 0 0 -120px}
.rjd-card{position:absolute;inset:0;display:grid;gap:8px;align-content:start;padding:10px 12px;background:var(--bg-raised);border:1px solid var(--border-default);box-shadow:var(--shadow-l2);transition:transform var(--duration-slow,300ms) var(--ease-enter),filter var(--duration-slow,300ms) var(--ease-standard),opacity var(--duration-slow,300ms) var(--ease-standard)}
.rjd-card i{display:flex;gap:8px;align-items:center}
.rjd-card b{width:22px;height:12px;background:var(--success-solid)}
.rjd-card b.f{background:var(--warning-solid)}
.rjd-card b.w{background:var(--border-subtle)}
.rjd-card s{height:6px;flex:1;background:var(--bg-inset);text-decoration:none}
.rjd-c1{transform:translate(-76px,10px) rotate(-7deg);transition-delay:100ms!important}
.rjd-c2{transform:translate(76px,10px) rotate(6deg);transition-delay:200ms!important}
.rjd-c3{transform:translateY(-4px)}
[data-p="asleep"] .rjd-card{filter:grayscale(1);opacity:.55}
[data-p="asleep"] .rjd-c1{transform:translate(-62px,22px) rotate(-11deg)}
[data-p="asleep"] .rjd-c2{transform:translate(62px,24px) rotate(9deg)}
[data-p="asleep"] .rjd-c3{transform:translateY(16px) rotate(-1deg)}
.rjd-icon{position:relative;z-index:2;width:72px;height:72px;margin-top:-18px;overflow:hidden;border-radius:16px;border:1px solid var(--border-control);background:#151412;box-shadow:var(--shadow-l3);transition:transform var(--duration-base,200ms) var(--ease-enter)}
.rjd-icon span{position:absolute;left:33%;bottom:22%;width:30%;height:56%;background:var(--brand-signal);transform-origin:bottom;transform:scaleY(.14);opacity:.55;transition:transform 2400ms var(--ease-standard),opacity var(--duration-base,200ms)}
[data-p="waking"] .rjd-icon span,[data-p="awake"] .rjd-icon span{transform:none;opacity:1}
[data-p="waking"] .rjd-icon span{transition-duration:12s}
[data-p="awake"] .rjd-icon span{transition-duration:var(--duration-slow,300ms)}
[data-p="awake"] .rjd-icon{transform:scale(1.04)}
.rjd-zz{position:absolute;z-index:3;left:calc(50% + 32px);top:calc(50% - 74px);font:12px/1 var(--font-mono,ui-monospace,monospace);color:var(--text-secondary);transition:opacity var(--duration-quick,150ms)}
.rjd-zz span{display:inline-block;opacity:0;animation:rjd-zz var(--duration-slow,300ms) var(--ease-enter) forwards}
.rjd-zz span:nth-child(2){animation-delay:250ms;font-size:14px}
.rjd-zz span:nth-child(3){animation-delay:500ms;font-size:16px}
[data-p="waking"] .rjd-zz,[data-p="awake"] .rjd-zz{opacity:0}
.rjd-badge{position:absolute;z-index:3;left:50%;bottom:18px;transform:translateX(-50%);display:inline-flex;align-items:center;gap:7px;padding:3px 11px 3px 9px;border:1px solid var(--border-default);border-radius:999px;background:var(--bg-raised);box-shadow:var(--shadow-l2);font-size:12px;font-weight:500;color:var(--text-primary);white-space:nowrap}
.rjd-badge::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--border-control)}
.rjd-badge::after{content:"Stopped"}
[data-p="waking"] .rjd-badge::before{background:var(--warning-solid)}
[data-p="waking"] .rjd-badge::after{content:"Starting…"}
[data-p="awake"] .rjd-badge{background:var(--success-subtle);border-color:transparent;color:var(--success-text)}
[data-p="awake"] .rjd-badge::before{background:var(--success-solid)}
[data-p="awake"] .rjd-badge::after{content:"Running"}
.rjd-burst{position:absolute;z-index:1;left:50%;top:50%;width:120px;height:120px;margin:-78px 0 0 -60px;border-radius:50%;border:2px solid var(--brand-signal);opacity:0}
[data-p="awake"] .rjd-burst{animation:rjd-burst var(--duration-slow,300ms) var(--ease-enter) both}

.rjd-desk{position:absolute;inset:0;--x:194px;--y:42px}
.rjd-desk.mac{--y:56px}
.rjd-menubar{position:absolute;left:0;right:0;top:0;height:16px;display:flex;gap:10px;align-items:center;padding:0 10px;font-size:9px;color:var(--text-secondary);background:var(--bg-raised);opacity:.7}
.rjd-taskbar{position:absolute;left:0;right:0;bottom:0;height:24px;display:flex;gap:6px;align-items:center;justify-content:center;background:var(--bg-raised);opacity:.8}
.rjd-taskbar i{display:block;width:14px;height:14px;border-radius:3px;background:var(--border-default)}
.rjd-icons{position:absolute;left:22px;top:20px;display:grid;grid-auto-flow:column;gap:6px;align-items:start}
.mac .rjd-icons{top:34px}
.rjd-dic{width:64px;display:flex;flex-direction:column;align-items:center;gap:4px;padding:5px 2px;border-radius:6px;font-size:10.5px;color:var(--text-primary);text-align:center}
.rjd-dic b{position:relative;display:block;width:34px;height:34px;border-radius:6px}
.rjd-folder{background:var(--warning-solid);height:26px!important;margin-top:6px;border-radius:3px 6px 6px 6px!important}
.rjd-doc{width:28px!important;background:var(--bg-raised);border:1px solid var(--border-default);border-radius:3px!important}
.rjd-app{background:#151412;border:1px solid var(--border-control)}
.rjd-app::after{content:"";position:absolute;left:33%;top:22%;width:30%;height:56%;background:var(--brand-signal)}
.rjd-target{animation:rjd-select var(--duration-instant,100ms) var(--ease-standard) 1250ms both}
.rjd-cursor{position:absolute;left:0;top:0;z-index:3;width:18px;height:22px;transform:translate(330px,170px);animation:rjd-cursor var(--duration-story,380ms) var(--ease-enter) 550ms both}
.rjd-ring{position:absolute;z-index:2;left:var(--x);top:var(--y);width:30px;height:30px;border:2px solid var(--brand-signal);border-radius:50%;opacity:0;transform:translate(-50%,-50%) scale(.3);animation:rjd-ring var(--duration-slow,300ms) var(--ease-enter) 1000ms both}
.rjd-ring+.rjd-ring{animation-delay:1180ms}
.rjd-chip{position:absolute;left:calc(var(--x) - 14px);top:calc(var(--y) + 44px);padding:3px 8px;border-radius:999px;background:var(--text-primary);color:var(--bg-canvas);font-size:11px;white-space:nowrap;opacity:0;animation:rjd-fade var(--duration-base,200ms) var(--ease-standard) 1050ms both}
.rjd-chip::before{content:"";position:absolute;top:-4px;left:12px;border:4px solid transparent;border-top:0;border-bottom-color:var(--text-primary)}
.rjd-win{position:absolute;right:24px;top:34px;width:min(240px,46%);overflow:hidden;border:1px solid var(--border-default);border-radius:8px;background:var(--bg-raised);box-shadow:var(--shadow-l2);opacity:0;transform:scale(.85) translateY(8px);transform-origin:0 30%;animation:rjd-open var(--duration-base,200ms) var(--ease-enter) 1450ms both}
.rjd-win>u{display:block;height:14px;background:var(--bg-inset);border-bottom:1px solid var(--border-subtle)}
.rjd-win>em{display:flex;align-items:center;gap:5px;padding:6px 8px;font:9px var(--font-mono,ui-monospace,monospace);font-style:normal;color:var(--text-primary)}
.rjd-win>em::after{content:"";width:5px;height:9px;background:var(--brand-signal)}
.rjd-win>i{display:flex;gap:6px;align-items:center;padding:5px 8px;border-top:1px solid var(--border-subtle);opacity:0;animation:rjd-row var(--duration-base,200ms) var(--ease-enter) both}
.rjd-win>i:nth-of-type(1){animation-delay:1650ms}.rjd-win>i:nth-of-type(2){animation-delay:1750ms}.rjd-win>i:nth-of-type(3){animation-delay:1850ms}.rjd-win>i:nth-of-type(4){animation-delay:1950ms}
.rjd-win b{width:16px;height:10px;background:var(--success-solid)}.rjd-win b.f{background:var(--warning-solid)}.rjd-win b.w{background:var(--border-subtle)}
.rjd-win s{height:5px;flex:1;background:var(--bg-inset)}

@keyframes rjd-zz{from{opacity:0;transform:translate(-4px,6px)}to{opacity:1;transform:none}}
@keyframes rjd-burst{0%{opacity:.7;transform:scale(.5)}100%{opacity:0;transform:scale(1.5)}}
@keyframes rjd-select{to{background:var(--bg-active);outline:1px solid var(--border-control)}}
@keyframes rjd-cursor{to{transform:translate(calc(var(--x) - 2px),calc(var(--y) - 2px))}}
@keyframes rjd-ring{0%{opacity:.9;transform:translate(-50%,-50%) scale(.3)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.4)}}
@keyframes rjd-open{to{opacity:1;transform:none}}
@keyframes rjd-row{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes rjd-fade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){
  .rjd-hero *,.rjd-art *{animation-duration:1ms!important;animation-delay:0s!important;transition-duration:1ms!important;transition-delay:0s!important}
}
`;

/**
 * The dashboard's "isn't running" window: the Start button that becomes its own progress bar and
 * then "RawJobs is back" (one button, same size throughout), the steps that tick off, and the
 * Desktop shortcut offered only after the button didn't bring RawJobs back.
 */
export const WINDOW_CSS = `
.rjd-cta{position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:200px;height:42px;padding:0 18px;overflow:hidden;border:0;border-radius:var(--radius-md,4px);background:var(--button-primary-bg);color:var(--button-primary-fg);font-weight:600;white-space:nowrap;cursor:pointer;transition:background var(--duration-instant) var(--ease-standard)}
.rjd-cta:hover{background:var(--button-primary-bg-hover)}
.rjd-cta[data-p="starting"],.rjd-cta[data-p="back"]{cursor:default}
.rjd-cta>i{position:absolute;inset:0;background:color-mix(in srgb,var(--button-primary-bg) 80%,var(--text-primary));transform-origin:left;transform:scaleX(0)}
.rjd-cta[data-p="starting"]>i{transform:scaleX(.9);transition:transform 20s cubic-bezier(.1,.6,.3,1)}
.rjd-cta[data-p="back"]{background:var(--success-solid);color:var(--on-success)}
.rjd-cta[data-p="back"]>i{opacity:0}
.rjd-cta>span{position:relative;display:inline-flex;align-items:center;gap:8px;animation:rjd-label var(--duration-base) var(--ease-enter) both}
.rjd-cta svg{width:16px;height:16px;flex:none}
.rjd-steps{display:grid;gap:7px;margin:14px 0 0;padding:0;list-style:none;font-size:13px}
.rjd-steps li{display:flex;align-items:center;gap:10px;color:var(--text-secondary)}
.rjd-steps li>b{display:grid;place-items:center;flex:none;width:16px;height:16px;border:1.5px solid var(--border-control);border-radius:50%;transition:background var(--duration-instant),border-color var(--duration-instant)}
.rjd-steps li[data-s="doing"]{color:var(--text-primary)}
.rjd-steps li[data-s="doing"]>b{border-color:var(--text-primary);border-top-color:transparent;animation:rjd-spin .8s linear infinite}
.rjd-steps li[data-s="done"]{color:var(--text-primary)}
.rjd-steps li[data-s="done"]>b{background:var(--success-solid);border-color:var(--success-solid)}
.rjd-steps svg{width:10px;height:10px;fill:none;stroke:var(--on-success);stroke-width:3.2;stroke-dasharray:20;stroke-dashoffset:20}
.rjd-steps li[data-s="done"] svg{animation:rjd-draw var(--duration-base) var(--ease-enter) forwards}
.rjd-fallback{display:flex;gap:12px;align-items:center;margin-top:14px;padding:10px 12px;border:1px solid var(--border-subtle);border-radius:var(--radius-md,4px);background:var(--bg-canvas);animation:rjd-label var(--duration-base) var(--ease-enter) both}
.rjd-fallback>b{position:relative;flex:none;width:34px;height:34px;border-radius:7px;border:1px solid var(--border-control);background:#151412}
.rjd-fallback>b::after{content:"";position:absolute;left:33%;top:22%;width:30%;height:56%;background:var(--brand-signal)}
.rjd-fallback>b::before{content:"";position:absolute;inset:-6px;border:2px solid var(--brand-signal);border-radius:10px;opacity:0;animation:rjd-ring2 var(--duration-slow) var(--ease-enter) 350ms both}
@keyframes rjd-label{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes rjd-spin{to{transform:rotate(360deg)}}
@keyframes rjd-draw{to{stroke-dashoffset:0}}
@keyframes rjd-ring2{0%{opacity:.8;transform:scale(.8)}100%{opacity:0;transform:scale(1.25)}}
@media (prefers-reduced-motion:reduce){.rjd-cta *,.rjd-steps *,.rjd-fallback,.rjd-fallback *{animation-duration:1ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:1ms!important}}
`;

const rows = (r: [string, number][]) => r.map(([c, w]) => `<i><b class="${c}"></b><s style="flex:${w}"></s></i>`).join("");

/** RawJobs asleep: job cards greyed and scattered, the bar in the icon low. Set data-p on a parent to "asleep", "waking" or "awake". */
export function sleepScene(): string {
  return `<div class="rjd-scene"><div class="rjd-grid"></div>
<div class="rjd-stack"><div class="rjd-card rjd-c1">${rows([
    ["", 1],
    ["f", 0.7],
    ["w", 0.8],
  ])}</div><div class="rjd-card rjd-c2">${rows([
    ["f", 0.8],
    ["", 1],
    ["w", 0.6],
  ])}</div><div class="rjd-card rjd-c3">${rows([
    ["", 1],
    ["", 0.75],
    ["f", 0.9],
    ["w", 0.6],
  ])}</div></div>
<span class="rjd-burst"></span><div class="rjd-icon"><span></span></div><span class="rjd-zz"><span>z</span><span>z</span><span>z</span></span><span class="rjd-badge"></span></div>`;
}

const CURSOR = `<svg class="rjd-cursor" viewBox="0 0 18 22" width="18" height="22"><path d="M1 1v17l4.5-4 3 7 3-1.3-3-6.7H15z" fill="#151412" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

/** The Desktop: the cursor goes to the RawJobs icon, double-clicks it, and the dashboard opens. Plays once. */
export function desktopScene(platform: Platform | null | undefined): string {
  const mac = platform === "darwin";
  return `<div class="rjd-desk${mac ? " mac" : ""}">
${mac ? '<div class="rjd-menubar"><span>Finder</span><span>File</span><span>Edit</span></div>' : ""}
<div class="rjd-icons"><div class="rjd-dic"><b class="rjd-folder"></b>Documents</div><div class="rjd-dic"><b class="rjd-doc"></b>Resume.pdf</div><div class="rjd-dic rjd-target"><b class="rjd-app"></b>RawJobs</div></div>
<span class="rjd-ring"></span><span class="rjd-ring"></span>${CURSOR}<span class="rjd-chip">Double-click</span>
<div class="rjd-win"><u></u><em>rawjobs</em><i><b></b><s></s></i><i><b></b><s style="flex:.7"></s></i><i><b class="f"></b><s style="flex:.85"></s></i><i><b class="w"></b><s style="flex:.6"></s></i></div>
${mac ? "" : '<div class="rjd-taskbar"><i></i><i></i><i></i><i></i></div>'}</div>`;
}

/** The design tokens the standalone pages use (the dashboard's own, copied: these pages load no app CSS). */
const PAGE_TOKENS = `
:root{color-scheme:light;--bg-canvas:#f5f1e8;--bg-raised:#fffbf5;--bg-inset:#ede9e2;--bg-hover:#ede9e2;--bg-active:#e5e1db;--border-subtle:#d4d0c9;--border-default:#c4c0ba;--border-control:#888681;
--text-primary:#151412;--text-secondary:#605d59;--brand-signal:#ff5a1f;--button-primary-bg:#ff5a1f;--button-primary-bg-hover:#ff7e56;--button-primary-fg:#151412;--focus-ring:#a33100;
--success-solid:#007d3e;--success-text:#007137;--success-subtle:#d3f3da;--warning-solid:#f3aa36;--on-success:#fffbf5;--accent-subtle:#ffede7;
--shadow-l2:0 4px 12px rgba(21,20,18,.06);--shadow-l3:0 8px 24px rgba(21,20,18,.07);
--duration-instant:100ms;--duration-quick:150ms;--duration-base:200ms;--duration-slow:300ms;--duration-story:380ms;
--ease-enter:cubic-bezier(.16,1,.3,1);--ease-exit:cubic-bezier(.7,0,.84,0);--ease-standard:cubic-bezier(.2,0,0,1);
--font-sans:"Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--font-mono:"Geist Mono",ui-monospace,"Cascadia Mono",Consolas,monospace}
[data-theme^="dark"]{color-scheme:dark;--bg-canvas:#181611;--bg-raised:#120f0b;--bg-inset:#201d18;--bg-hover:#201d18;--bg-active:#27241f;--border-subtle:#37342e;--border-default:#45423c;--border-control:#6b6964;
--text-primary:#ecebe8;--text-secondary:#cac7c2;--button-primary-bg-hover:#ff7a51;--focus-ring:#ff9d7f;--success-solid:#5bcc80;--success-text:#89dea1;--success-subtle:#082412;--warning-solid:#f3aa36;--on-success:#120f0b;--accent-subtle:#260e07;
--shadow-l2:inset 0 1px 0 rgba(255,255,255,.06),0 4px 12px rgba(0,0,0,.32);--shadow-l3:inset 0 1px 0 rgba(255,255,255,.06),0 12px 32px rgba(0,0,0,.4)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--bg-canvas);color:var(--text-primary);font:14px/1.5 var(--font-sans);-webkit-font-smoothing:antialiased}
:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
main{min-height:100vh;max-width:1080px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);align-items:center;gap:40px;padding:40px 24px}
main .rjd-art{height:400px;min-height:0}
@media (max-width:760px){main{grid-template-columns:1fr;align-content:center;gap:28px}main .rjd-art{height:280px}}
.mark{display:flex;width:fit-content;align-items:center;gap:3px;margin-bottom:28px;font:500 15px var(--font-mono);letter-spacing:-.01em}
.mark::after{content:"";width:.55em;height:1.05em;background:var(--brand-signal)}
.tag{display:inline-flex;align-items:center;gap:6px;margin-bottom:14px;padding:2px 8px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-raised);font:12px var(--font-mono);color:var(--text-secondary)}
h1{margin:0 0 10px;font-size:30px;line-height:1.15;font-weight:600;letter-spacing:-.02em;text-wrap:balance}
p{margin:0}.muted{color:var(--text-secondary)}.small{font-size:13px}
code{font:12.5px var(--font-mono);overflow-wrap:anywhere}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;border:1px solid transparent;border-radius:4px;font:500 14px var(--font-sans);color:var(--text-primary);text-decoration:none;cursor:pointer;background:none;transition:background var(--duration-instant) var(--ease-standard)}
.btn svg{width:16px;height:16px;flex:none}
.primary{background:var(--button-primary-bg);color:var(--button-primary-fg)}.primary:hover{background:var(--button-primary-bg-hover)}
.secondary{background:var(--bg-raised);border-color:var(--border-control)}.secondary:hover{background:var(--bg-hover)}
.quiet{color:var(--text-secondary)}.quiet:hover{background:var(--bg-hover);color:var(--text-primary)}
.enter{animation:enter var(--duration-base) var(--ease-enter) both}.enter.d1{animation-delay:60ms}.enter.d2{animation-delay:120ms}
@keyframes enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
details{margin-top:16px;font-size:13px}summary{cursor:pointer;color:var(--text-secondary)}
details div{margin-top:8px;padding:10px 12px;border-radius:4px;background:var(--bg-inset)}
@media (prefers-reduced-motion:reduce){.enter{animation:none}}
`;

/** Before first paint: the theme you picked in Settings, else the system's (as index.html does). */
const THEME_SCRIPT = `<script>(function(){var t=null;try{t=localStorage.getItem("rawjobs.theme")}catch(e){}var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"})()</script>`;

const ICON_LINK = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%23151412'/%3E%3Crect x='22' y='15' width='20' height='34' fill='%23ff5a1f'/%3E%3C/svg%3E">`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function shell(title: string, css: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${title}</title>${ICON_LINK}${THEME_SCRIPT}<style>${PAGE_TOKENS}${SCENE_CSS}${css}</style></head><body>${body}</body></html>`;
}

const RADAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/></svg>`;

const NOT_FOUND_CSS = `
.f404{position:absolute;inset:26px 22px auto 22px}
.feed{position:relative;overflow:hidden;background:var(--bg-raised);border:1px solid var(--border-default);box-shadow:var(--shadow-l2)}
.row{position:relative;display:flex;gap:12px;align-items:center;padding:11px 12px;border-bottom:1px solid var(--border-subtle);background:var(--bg-raised);opacity:0;animation:row var(--duration-base) var(--ease-enter) both}
.row:last-child{border-bottom:0}
.row:nth-child(2){animation-delay:200ms}.row:nth-child(3){animation-delay:320ms}.row:nth-child(4){animation-delay:440ms}
.row.miss{animation-delay:1250ms;background:var(--accent-subtle)}
.row.miss::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--text-primary);transform:scaleY(0);animation:grow var(--duration-base) var(--ease-enter) 1500ms forwards}
.score{min-width:30px;height:22px;padding:0 6px;display:grid;place-items:center;font:500 11.5px var(--font-mono);background:var(--success-solid);color:var(--on-success)}
.score.f{background:var(--warning-solid);color:#151412}
.score.miss{min-width:40px;background:var(--text-primary);color:var(--bg-canvas)}
.row div{min-width:0}.row b{display:block;font-weight:500;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row span{font-size:12px;color:var(--text-secondary)}
.scan{position:absolute;z-index:2;left:0;right:0;top:0;height:44px;pointer-events:none;opacity:0;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--brand-signal) 14%,transparent) 70%,color-mix(in srgb,var(--brand-signal) 60%,transparent) 98%,transparent);animation:scan var(--duration-slow) var(--ease-standard) 650ms both}
.why{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.why span{padding:2px 8px;border:1px solid var(--border-default);border-radius:4px;background:var(--bg-raised);font-size:11.5px;color:var(--text-secondary);opacity:0;animation:enter var(--duration-base) var(--ease-enter) forwards}
.why b{font-weight:500;color:var(--text-primary)}
.why span:nth-child(1){animation-delay:1650ms}.why span:nth-child(2){animation-delay:1750ms}.why span:nth-child(3){animation-delay:1850ms}
.big{position:absolute;right:-6px;bottom:-26px;font:500 150px/1 var(--font-mono);letter-spacing:-.06em;color:transparent;-webkit-text-stroke:1.5px var(--border-default);user-select:none;opacity:0;animation:fadein var(--duration-slow) var(--ease-standard) 100ms forwards}
.big i{display:inline-block;width:.42em;height:.72em;margin-left:.04em;background:var(--brand-signal);transform-origin:bottom;transform:scaleY(0);animation:grow var(--duration-slow) var(--ease-enter) 1500ms forwards}
@keyframes row{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@keyframes grow{to{transform:none}}
@keyframes fadein{to{opacity:1}}
@keyframes scan{0%{opacity:1;transform:translateY(-44px)}90%{opacity:1}100%{opacity:0;transform:translateY(150px)}}
@media (prefers-reduced-motion:reduce){.row,.why span,.big,.big i,.row.miss::before{animation-duration:1ms;animation-delay:0s}.scan{display:none}}
`;

/** "There's no page at this address": RawJobs is running, the address is wrong. One way out: the Radar. */
export function notFoundPage(path: string): string {
  const p = esc(path.length > 80 ? `${path.slice(0, 79)}…` : path);
  const body = `<main><div>
<div class="mark" aria-label="RawJobs">rawjobs</div>
<div class="tag enter">404 · no match</div>
<h1 class="enter">No match for this address</h1>
<p class="muted enter d1">RawJobs is running, but there's no page at <code>${p}</code>. The link may be from an older version, or the address has a typo.</p>
<div class="actions enter d2"><a class="btn primary" href="/#radar">${RADAR_ICON}Open the Radar</a><a class="btn secondary" href="/#pipeline">Pipeline</a><a class="btn quiet" href="/#settings">Settings</a></div>
</div>
<div class="rjd-art" aria-hidden="true"><span class="big">4<i></i>4</span><div class="f404"><div class="feed"><span class="scan"></span>
<div class="row"><span class="score">92</span><div><b>Senior Product Designer</b><span>Figma · Remote</span></div></div>
<div class="row"><span class="score">88</span><div><b>Design Systems Lead</b><span>Linear · Remote, EU</span></div></div>
<div class="row"><span class="score f">74</span><div><b>Product Designer II</b><span>Notion · London</span></div></div>
<div class="row miss"><span class="score miss">404</span><div><b style="font:12.5px var(--font-mono)">${p}</b><span>No page here</span></div></div>
</div><div class="why"><span>Page <b>missing</b></span><span>RawJobs <b>running</b></span><span>Fix <b>Open the Radar</b></span></div></div></div>
</main>`;
  return shell("RawJobs · Page not found", NOT_FOUND_CSS, body);
}

/** The dashboard's sections, as old links and typed addresses name them (/radar → /#radar). */
export const SECTION_PATHS = ["radar", "pipeline", "companies", "settings", "setup"] as const;

/** Where a path that names a section goes instead of a 404 ("/settings/" → "/#settings"), or null. */
export function sectionRedirect(path: string): string | null {
  const m = path.match(/^\/([a-z]+)\/?$/i);
  const name = m?.[1]?.toLowerCase();
  return name && (SECTION_PATHS as readonly string[]).includes(name) ? `/#${name}` : null;
}

const OFFLINE_CSS = `
.btn.start{min-width:200px;height:42px;font-weight:600}
.hint{display:flex;gap:8px;align-items:center;margin-top:12px;font-size:13px;color:var(--text-secondary)}
.fallback{display:none;gap:12px;align-items:center;margin-top:14px;padding:10px 12px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-raised);animation:enter var(--duration-base) var(--ease-enter) both}
.fallback b.app{position:relative;flex:none;width:34px;height:34px;border-radius:7px;background:#151412;border:1px solid var(--border-control)}
.fallback b.app::after{content:"";position:absolute;left:33%;top:22%;width:30%;height:56%;background:var(--brand-signal)}
[data-state="stuck"] .fallback{display:flex}
[data-state="starting"] .start,[data-state="back"] .start{pointer-events:none;opacity:.85}
`;

/** The ports RawJobs tries, in order, when the one before is taken (serve.ts). */
export const PORTS = Array.from({ length: 10 }, (_, i) => 4317 + i);

/**
 * findElsewhere(done): RawJobs on another of its ports on this computer (it moved to the next port
 * when this one was taken). Calls done with that address ("http://127.0.0.1:4318"), or null. Plain
 * JavaScript, for the offline page; the dashboard does the same (lib/update.ts).
 */
const FIND_ELSEWHERE = `function findElsewhere(done){var ports=${JSON.stringify(PORTS)}.filter(function(p){return String(p)!==location.port}),left=ports.length,found=null;
ports.forEach(function(p){var o=location.protocol+"//"+location.hostname+":"+p,c=new AbortController();setTimeout(function(){c.abort()},1500);
fetch(o+"/api/health",{cache:"no-store",signal:c.signal}).then(function(r){return r.json()}).then(function(h){if(h&&h.ok&&!found)found=o}).catch(function(){}).then(function(){if(--left===0)done(found)})})}`;

/**
 * "RawJobs isn't running", for when you open the dashboard's address while the server is stopped.
 * The browser's service worker (SERVICE_WORKER) keeps this page and shows it instead of "This site
 * can't be reached". It checks /api/health every few seconds and opens the dashboard when RawJobs
 * answers, here or on another of its ports (then it goes there). One way back at a time: with the Start link (rawjobs://open) installed, the Start button;
 * the Desktop shortcut only when the button didn't bring it back. Without the link, the shortcut.
 */
export function offlinePage(o: { startLink: boolean; platform: Platform }): string {
  const place = esc(appPlace(o.platform));
  const how = o.startLink
    ? `<p class="muted enter d1">Your jobs, notes and settings are safe on this computer. Start RawJobs and this page opens it by itself.</p>
<div class="actions enter d2"><button class="btn primary start" id="start" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/></svg><span id="label">Start RawJobs</span></button></div>
<p class="hint" id="hint" hidden>If your browser asks, choose Open RawJobs.</p>
<div class="fallback" role="status"><b class="app"></b><p class="small"><b>Didn't open?</b> Double-click RawJobs on your Desktop instead. ${place}</p></div>`
    : `<p class="muted enter d1">Your jobs, notes and settings are safe on this computer. <b style="color:var(--text-primary)">Double-click RawJobs on your Desktop</b> to start it, and this page opens it by itself. ${place}</p>`;
  const body = `<main data-state="asleep" id="page"><div>
<div class="mark" aria-label="RawJobs">rawjobs</div>
<div class="tag">Not running</div>
<h1 class="enter">RawJobs isn't running</h1>
${how}
<details><summary>Technical details</summary><div><p>From a terminal: <code>rawjobs open</code></p><p style="margin-top:6px">If it doesn't start, its log says why: <code>${esc(logPath(o.platform))}</code></p></div></details>
</div>
<div class="rjd-art" aria-hidden="true" id="art" data-p="asleep">${o.startLink ? sleepScene() : desktopScene(o.platform)}</div>
</main>
<script>(function(){
var page=document.getElementById("page"),art=document.getElementById("art"),start=document.getElementById("start"),label=document.getElementById("label"),hint=document.getElementById("hint");
var fast=false,stuck=null;
function back(go){page.dataset.state="back";art.dataset.p="awake";if(label)label.textContent="RawJobs is back";setTimeout(go,700)}
function here(){if(location.pathname==="/offline.html")location.replace("/");else location.reload()}
function up(){fetch("/api/health",{cache:"no-store"}).then(function(r){return r.json()}).then(function(h){if(h&&h.ok)back(here);else elsewhere()}).catch(elsewhere)}
${FIND_ELSEWHERE}
function elsewhere(){findElsewhere(function(origin){if(!origin)return later();back(function(){location.replace(origin+(location.pathname==="/offline.html"?"/":location.pathname)+location.search+location.hash)})})}
function later(){setTimeout(up,fast?1000:4000)}
if(start)start.addEventListener("click",function(){
  page.dataset.state="starting";fast=true;label.textContent="Starting…";hint.hidden=false;
  if(art.querySelector(".rjd-scene"))art.dataset.p="waking";
  location.href="rawjobs://open";
  clearTimeout(stuck);stuck=setTimeout(function(){if(page.dataset.state!=="starting")return;page.dataset.state="stuck";fast=false;label.textContent="Try again";hint.hidden=true;art.dataset.p="asleep"},20000);
});
later();
})()</script>`;
  return shell("RawJobs · Not running", OFFLINE_CSS, body);
}

/**
 * The service worker (/sw.js). It keeps one page, offline.html, and shows it when opening the
 * dashboard fails because nothing answers (RawJobs is stopped). Everything else always comes from
 * the server, untouched, so updates and data are never served from a cache. offline.html is fetched
 * again on every successful visit, so it follows the Start link being installed and new versions.
 */
export const SERVICE_WORKER = `
const CACHE = "rawjobs-offline-v1";
const PAGE = "/offline.html";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.add(PAGE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(
    fetch(e.request).then(
      (res) => { e.waitUntil(caches.open(CACHE).then((c) => c.add(PAGE)).catch(() => {})); return res; },
      () => caches.match(PAGE).then((page) => page || Response.error()),
    ),
  );
});
`;
