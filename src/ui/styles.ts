/** All rules are scoped. No page-wide zoom, selection, scrolling or accessibility suppression. */
export const interfaceStyles = `
.nt-interface{position:absolute;inset:0;isolation:isolate;pointer-events:none;color:#f3f6fc;font:16px/1.4 system-ui,sans-serif;overflow:hidden}
.nt-interface [hidden]{display:none!important}
.nt-interface button,.nt-interface input{font:inherit}
.nt-interface button{min-width:44px;min-height:44px;border:1px solid #b3c4e8;border-radius:12px;background:#14223e;color:#fff;padding:8px 14px;cursor:pointer}
.nt-interface button:focus-visible,.nt-interface input:focus-visible{outline:3px solid #ffdd6a;outline-offset:3px}
.nt-interface button[aria-disabled=true]{border-style:dashed;color:#cbd1dd}
.nt-chrome{position:absolute;inset:0;display:grid;place-items:center}
.nt-panel{pointer-events:auto;background:#101a30f2;border:1px solid #4c6088;border-radius:20px;padding:20px;width:min(90%,480px);max-height:85%;overflow:auto;box-sizing:border-box;overscroll-behavior:contain}
.nt-panel h1{font-size:1.7rem;margin:0 0 12px}.nt-panel h2{font-size:1.2rem}.nt-panel button{margin:4px}
.nt-panel dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}.nt-panel dd{margin:0;text-align:right;overflow-wrap:anywhere}
.nt-preview{position:relative;width:min(100%,240px);max-height:240px;background:#233452;border:1px solid #8292ad;margin:auto;overflow:hidden}.nt-preview span{position:absolute;display:grid;place-items:center;border:1px solid #dae6ff;border-radius:50%;font-size:8px;box-sizing:border-box}
.nt-panel label{display:grid;grid-template-columns:1fr minmax(100px,2fr);gap:10px;margin:12px 0}.nt-panel fieldset{border:1px solid #657595;border-radius:8px;margin:12px 0}.nt-panel input{min-height:44px;width:100%}
.nt-battle-header{position:absolute;top:8px;left:12px;right:12px;display:grid;gap:8px;pointer-events:none}
.nt-tools{grid-row:2;justify-self:center;pointer-events:auto;display:flex;gap:8px;align-self:start}
.nt-tools button{position:relative;width:44px;min-width:44px;min-height:44px;padding:4px;font-size:12px;line-height:1.3}
.nt-battle-header[data-layout=wide] .nt-hud,.nt-battle-header[data-layout=wide] .nt-tools{grid-area:1/1}
.nt-battle-header[data-layout=wide] .nt-hud{column-gap:112px}
.nt-button-label{display:block;width:100%;height:auto;white-space:normal;word-break:break-all;overflow-wrap:anywhere;line-break:anywhere;font:inherit;letter-spacing:inherit}
.nt-button-glyphs{position:absolute;left:0;top:0;display:grid;grid-template-columns:max-content;width:max-content;height:max-content;visibility:hidden;pointer-events:none;font:inherit;letter-spacing:inherit;white-space:pre}
.nt-button-glyphs>span::before{content:attr(data-glyph)}
.nt-controls{position:absolute;inset:0}.nt-control,.nt-swipe{position:absolute;pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.nt-control{padding:4px!important;border-radius:50%!important;font-size:14px!important;overflow-wrap:anywhere}
.nt-swipe{left:0;bottom:0;width:40%;height:60%;border-radius:28px;background:linear-gradient(0deg,#182e4944,transparent);display:flex;align-items:end;justify-content:center;padding-bottom:20px;box-sizing:border-box;color:#e5eefc}
.nt-hud{grid-row:1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;pointer-events:none}.nt-actor{min-width:0}.nt-actor-content{min-width:0;display:grid;background:#10192bcc;border-radius:6px;padding:4px 6px;box-sizing:border-box}
.nt-actor-content .nt-number,.nt-number-sizing{font-size:14px;grid-area:1/1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);font-family:monospace;font-variant-numeric:tabular-nums;word-break:break-all;white-space:break-spaces}
.nt-actor-content .nt-hp{grid-area:2/1}.nt-actor-content .nt-heat{grid-area:3/1}
.nt-actor-content .nt-heat-label,.nt-heat-sizing{font-size:12px;grid-area:4/1;display:grid;font-family:monospace;font-variant-numeric:tabular-nums;word-break:break-all;white-space:break-spaces}
[data-presentation-sizing]{visibility:hidden;pointer-events:none}.nt-sizing-variants{display:grid}.nt-sizing-variants>span{grid-area:1/1}
.nt-actor[data-hud-side=enemy]{text-align:right}.nt-actor[data-hud-side=enemy] .nt-hp{transform:scaleX(-1)}.nt-actor[data-hud-side=enemy] .nt-heat{margin-left:auto}
.nt-hp{position:relative;height:15px;background:#303746;border-radius:4px;overflow:hidden}.nt-hp-green{position:absolute;inset:0 auto 0 0;background:#42d77c}.nt-hp-red{position:absolute;top:0;bottom:0;background:#ff535c}
.nt-heat{height:5px;background:#ffbc48;margin-top:5px;max-width:100%}.nt-number{font-variant-numeric:tabular-nums;font-size:14px}.nt-heat-label{font-size:12px;overflow-wrap:anywhere}.nt-effects{position:absolute;inset:0;pointer-events:none;overflow:hidden}.nt-particle{position:absolute;width:7px;height:7px;border-radius:50%;background:#ffe7a6;box-shadow:0 0 8px #ffab45;will-change:transform}
.nt-fade{position:absolute;inset:0;background:#000;pointer-events:none}.nt-notice{position:absolute;bottom:10px;left:10px;right:10px;background:#152239e8;padding:8px;text-align:center}
@media(prefers-reduced-motion:reduce){.nt-particle{box-shadow:none}.nt-actor-content{transform:none!important}}
`;
