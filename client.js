// dsh-noname-kit 浏览器半:顶部「无名杀工坊」页签 + 表单 + 历史面板 + 工具结果卡片。
// 形态参照 dsh-skin:纯 JS + React.createElement,零构建。
// 页签注册的是 conversation.view 列表槽(与官方"轨迹"页签同一插槽,order 排在它后面)。
window.__ModuleLoader__.load({
  id: 'dsh-noname-kit',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');

    // ── 样式(令牌取自 DSH 界面变量,自动适配亮/暗;间距/圆角/过渡走 --nnk-* 设计令牌) ──
    var CSS = [
      '.nnk-wrap{--nnk-gap:12px;--nnk-r:12px;--nnk-rs:8px;--nnk-t:.15s ease;padding:12px;max-width:860px;margin:0 auto;overflow:auto;height:100%}',
      '.nnk-tabs{display:flex;flex-wrap:wrap;gap:2px;margin-bottom:14px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:1px}',
      '.nnk-tab{border:0;white-space:nowrap;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit;font-size:13px;transition:color var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease-in-out),background var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease-in-out)}',
      '.nnk-tab:hover{color:var(--dsw-alias-label-primary)}',
      '.nnk-tab.nnk-active{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-layer-1));font-weight:600}',
      '.nnk-card{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--nnk-r);padding:14px 16px;background:var(--dsw-alias-bg-layer-1);margin-bottom:var(--nnk-gap)}',
      '.nnk-group{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--nnk-r);padding:12px 14px;margin-bottom:var(--nnk-gap);background:var(--dsw-alias-bg-layer-1)}',
      '.nnk-group-title{font-size:12px;font-weight:600;color:var(--dsw-alias-brand-primary);letter-spacing:.06em;margin-bottom:8px}',
      '.nnk-label{display:block;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary);margin:10px 0 4px}',
      '.nnk-input,.nnk-textarea{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:var(--nnk-rs);padding:8px 10px;font:inherit;font-size:13px;transition:border-color var(--nnk-t),box-shadow var(--nnk-t)}',
      '.nnk-input:focus,.nnk-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px rgba(0,0,0,.06)}',
      '.nnk-textarea{min-height:88px;resize:vertical;font-family:inherit}',
      '.nnk-code{font-family:Consolas,monospace;font-size:12px;min-height:140px;white-space:pre;overflow:auto}',
      '.nnk-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px}',
      '.nnk-modal{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--nnk-r);box-shadow:0 12px 48px rgba(0,0,0,.35);width:580px;max-width:100%;max-height:88vh;overflow:auto;padding:18px 20px}',
      '.nnk-modal-title{font-size:16px;font-weight:700;margin-bottom:4px}',
      '.nnk-modal-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}',
      '.nnk-dash{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px;align-items:start}',
      '.nnk-dash .nnk-card{margin-bottom:0}',
      '.nnk-col{display:flex;flex-direction:column;gap:12px;min-width:0}',
      '.nnk-dash .nnk-log{max-height:280px}',
      '.nnk-dash-full{grid-column:1/-1}',
      '.nnk-fold-head{cursor:pointer;user-select:none;font-size:14px}',
      '.nnk-radio{display:inline-flex;align-items:center;gap:6px;margin:0;padding:6px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer;transition:border-color var(--nnk-t),color var(--nnk-t),background var(--nnk-t);user-select:none}',
      '.nnk-radio:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}',
      '.nnk-radio.nnk-radio-on{border-color:transparent;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-layer-1))}',
      
      '.nnk-radios{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.nnk-radio input[type=radio]{accent-color:var(--dsw-alias-brand-primary);margin:0}',
      '.nnk-submit{border:none;border-radius:var(--nnk-rs);padding:10px 26px;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-layer-1));cursor:pointer;font:inherit;font-size:14px;font-weight:600;margin-top:14px;transition:filter var(--nnk-t),opacity var(--nnk-t)}',
      '.nnk-submit:hover:not(:disabled){filter:brightness(1.12)}',
      '.nnk-submit:disabled{opacity:.5;cursor:default}',
      '.nnk-hint{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:10px;line-height:1.6;overflow-wrap:anywhere}',
      '.nnk-err{color:var(--dsw-alias-state-error-primary);font-size:13px;margin-top:8px;overflow-wrap:anywhere}',
      '.nnk-ok{color:var(--dsw-alias-state-success-primary);font-size:13px;margin-top:8px;overflow-wrap:anywhere}',
      '.nnk-taskrow{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--nnk-rs);padding:10px 12px;margin-bottom:8px;font-size:13px;transition:border-color var(--nnk-t)}',
      '.nnk-taskrow:hover{border-color:var(--dsw-alias-border-l1)}',
      '.nnk-taskmeta{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:4px}',
      '.nnk-note{background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:6px 10px;font-size:12px;margin:4px 0;color:var(--dsw-alias-label-primary)}',
      '.nnk-copy{border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:4px 12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;margin-top:8px;transition:border-color var(--nnk-t)}',
      '.nnk-copy:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}',
      '.nnk-copy:disabled{opacity:.45;cursor:default}',
      '.nnk-copy.nnk-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.nnk-copy.nnk-danger:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary);filter:brightness(1.15)}',
      '.nnk-badge{display:inline-block;border-radius:6px;padding:1px 8px;font-size:11px;margin-right:8px;border:1px solid var(--dsw-alias-border-l2)}',
      '.nnk-panel{position:fixed;width:380px;max-height:560px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.25);z-index:60}',
      '.nnk-panel-head{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);cursor:move;user-select:none}',
      '.nnk-panel-title{font-weight:600;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.nnk-panel-close{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:16px;line-height:1;padding:2px 6px}',
      '.nnk-panel-close:hover{color:var(--dsw-alias-state-error-primary)}',
      '.nnk-panel-body{padding:10px 12px;overflow-y:auto;flex:1}',
      '.nnk-status-open{color:var(--dsw-alias-state-warn-primary)}',
      '.nnk-status-written{color:var(--dsw-alias-state-warn-primary)}',
      '.nnk-status-done{color:var(--dsw-alias-state-success-primary)}',
      '.nnk-mini{width:100%;box-sizing:border-box;min-height:56px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:6px 8px;resize:vertical;margin-top:6px}',
      '.nnk-smallbtn{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:11px;margin:4px 6px 0 0;transition:border-color var(--nnk-t),color var(--nnk-t)}',
      '.nnk-smallbtn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.nnk-fbrow{border-left:3px solid var(--dsw-alias-border-l2);padding:2px 8px;margin:4px 0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.nnk-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);margin-left:5px;vertical-align:middle}',
      '.nnk-cmd{font-family:Consolas,monospace;font-size:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;margin-top:6px;display:inline-block;user-select:all}',
      '.nnk-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}',
      '.nnk-log{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);padding:6px 10px;font-size:12px;max-height:130px;overflow:auto;color:var(--dsw-alias-label-secondary);line-height:1.6}',
      '.nnk-phaseline{font-size:13px;margin-top:8px}',
      '.nnk-break{overflow-wrap:anywhere;word-break:break-all}',
      /* 房间大厅弹窗:房号牌 + 座位网格 */
      '.nnk-rm-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
      '.nnk-rm-head .nnk-badge{margin-right:0}',
      '.nnk-rm-code{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--nnk-rs);background:var(--dsw-alias-bg-layer-2)}',
      '.nnk-rm-code .nnk-rm-codelabel{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.nnk-rm-code .nnk-rm-codeval{font-family:Consolas,monospace;font-size:22px;font-weight:700;letter-spacing:3px;color:var(--dsw-alias-label-primary);user-select:all}',
      '.nnk-rm-code .nnk-copy{margin-top:0}',
      '.nnk-rm-seats,.nnk-rm-queue{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin-top:8px}',
      '.nnk-seat{display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--nnk-rs);background:var(--dsw-alias-bg-layer-2);min-width:0;text-align:center}',
      '.nnk-seat-avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;color:#fff;flex:none}',
      '.nnk-seat-name{font-size:12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}',
      '.nnk-seat-state{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.nnk-seat-host .nnk-seat-avatar{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary)}',
      '.nnk-seat-empty{border-style:dashed;background:transparent;opacity:.65}',
      '.nnk-seat-empty .nnk-seat-avatar{background:transparent!important;font-size:20px}',
      '.nnk-seat-queued{border-style:dashed}',
      '.nnk-rm-ops{margin-top:12px;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.nnk-rm-ops .nnk-submit{width:100%;margin-top:10px}',
      /* 邀请码列表(一客一张):每行自带状态与操作,回执码入口常驻 */
      '.nnk-inv-box{margin-top:10px}',
      '.nnk-inv-row{margin-top:6px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--nnk-rs);background:var(--dsw-alias-bg-layer-2)}',
      '.nnk-inv-head{display:flex;align-items:center;gap:4px;flex-wrap:wrap}',
      '.nnk-inv-head .nnk-smallbtn{margin:0 0 0 4px}',
      '.nnk-inv-id{font-family:Consolas,monospace;font-size:12px;font-weight:700;color:var(--dsw-alias-brand-primary);flex:none}',
      '.nnk-inv-state{font-size:12px;color:var(--dsw-alias-label-secondary);margin-right:auto;min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.nnk-inv-ans{margin-top:6px}',
      '.nnk-inv-ans .nnk-label{margin-top:4px}'
    ].join('\n');
    CSS += '\n' + ".nnk-scope{display:contents}\n.nnk-glyph-modern,.nnk-modern-only,.nnk-tab-pill,.nnk-skill-toggle{display:none}\n.nnk-glyph{display:inline}\n.nnk-modern .nnk-glyph-classic{display:none}\n.nnk-modern .nnk-glyph-modern{display:inline-block;width:16px;height:16px;vertical-align:-3px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}\n.nnk-scope button:focus-visible,.nnk-scope input:focus-visible,.nnk-scope textarea:focus-visible,.nnk-scope select:focus-visible,.nnk-scope [tabindex]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}\n.nnk-appearancebar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;min-height:30px}\n.nnk-identity{font-size:12px;font-weight:650;letter-spacing:1.3px;color:var(--dsw-alias-label-secondary)}\n.nnk-appearance-switch{display:inline-flex;gap:2px;margin-left:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:2px;background:var(--dsw-alias-bg-layer-1);flex:none}\n.nnk-appearance-switch button{border:0;border-radius:5px;padding:4px 10px;font:inherit;font-size:11px;line-height:1.5;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .18s,color .18s}\n.nnk-appearance-switch button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}\n.nnk-scope .nnk-wrap{box-sizing:border-box;overflow-anchor:none;transition:none}\n.nnk-scope .nnk-panel{max-width:calc(100vw - 24px)}\n.nnk-modern .nnk-modern-only{display:block}\n.nnk-modern .nnk-wrap{--nnk-r:14px;--nnk-rs:9px;--nnk-gap:16px;--nnk-t:.18s ease;max-width:940px;padding:20px 24px 28px;color:var(--dsw-alias-label-primary);line-height:1.65}\n.nnk-modern .nnk-appearancebar{margin-bottom:18px}\n.nnk-modern .nnk-tabs{position:relative;isolation:isolate;display:flex;flex-wrap:nowrap;gap:4px;overflow-x:auto;scrollbar-width:thin;margin-bottom:20px;padding:6px;border-radius:12px;background:var(--dsw-alias-bg-layer-1)}\n.nnk-modern .nnk-tab{position:relative;z-index:1;flex:none;display:inline-flex;align-items:center;gap:7px;padding:8px 13px;border-radius:9px;font-size:12px}\n.nnk-modern .nnk-tab.nnk-active{background:transparent;color:var(--dsw-alias-label-primary);font-weight:600}\n.nnk-modern .nnk-tab-pill{display:block;position:absolute;top:6px;left:0;height:calc(100% - 12px);border:1px solid var(--dsw-alias-border-l2);box-sizing:border-box;border-radius:9px;background:var(--dsw-alias-bg-layer-2);opacity:0;pointer-events:none;transition:transform .28s cubic-bezier(.22,1,.36,1),width .28s cubic-bezier(.22,1,.36,1)}\n.nnk-modern .nnk-card,.nnk-modern .nnk-group{padding:22px 24px;border-color:var(--dsw-alias-border-l2);box-shadow:none}\n.nnk-modern .nnk-label{font-size:12px;line-height:1.65;font-weight:550;color:var(--dsw-alias-label-primary);margin:20px 0 8px;overflow-wrap:anywhere}\n.nnk-modern .nnk-input,.nnk-modern .nnk-textarea{padding:10px 12px;font-size:12px;line-height:1.8;background:var(--dsw-alias-bg-layer-2);border-radius:8px}\n.nnk-modern .nnk-textarea{min-height:48px}\n.nnk-modern .nnk-code{min-height:140px}\n.nnk-modern .nnk-input:focus,.nnk-modern .nnk-textarea:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:none}\n.nnk-modern .nnk-input::placeholder,.nnk-modern .nnk-textarea::placeholder{color:var(--dsw-alias-label-secondary);opacity:.8}\n.nnk-modern .nnk-radios{gap:7px}\n.nnk-modern .nnk-radio{border-radius:8px;padding:8px 12px;font-size:12px;line-height:1.6;background:var(--dsw-alias-bg-layer-1)}\n.nnk-modern .nnk-radio.nnk-radio-on{color:var(--dsw-alias-brand-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,var(--dsw-alias-border-l2));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-layer-1))}\n.nnk-modern .nnk-hint{font-size:11px;line-height:1.8}\n.nnk-modern .nnk-submit{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:11px 20px;font-size:12px;border-radius:9px;margin-top:22px;transition:filter .18s,opacity .18s,transform .18s}\n.nnk-modern .nnk-smallbtn,.nnk-modern .nnk-copy{padding:6px 10px;font-size:11px;line-height:1.6;border-radius:7px;transition:background .18s,border-color .18s,color .18s}\n.nnk-modern .nnk-smallbtn:hover:not(:disabled),.nnk-modern .nnk-copy:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}\n.nnk-modern button:active:not(:disabled){transform:scale(.98)}\n.nnk-modern .nnk-taskrow{padding:16px;border-radius:11px}\n.nnk-modern .nnk-taskmeta{line-height:1.8}\n.nnk-modern .nnk-dash{grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:16px}\n.nnk-modern .nnk-dash .nnk-card{padding:18px}\n.nnk-modern .nnk-modal{padding:22px 24px;border-radius:16px}\n.nnk-modern .nnk-modal-mask{padding:12px}\n.nnk-modern .nnk-panel-head{padding:10px 12px}\n.nnk-modern .nnk-panel-body{overflow-anchor:none}\n.nnk-modern .nnk-page{animation:none}\n.nnk-skill-head{display:flex;gap:6px;align-items:center;margin-bottom:4px}\n.nnk-skill-fields{min-width:0}\n.nnk-modern .nnk-skill{padding:0!important;margin:12px 0!important;overflow:hidden;border-radius:11px;box-shadow:none}\n.nnk-modern .nnk-skill-head{padding:10px 12px;margin-bottom:0;gap:5px}\n.nnk-modern .nnk-skill-head>b{display:none}\n.nnk-modern .nnk-skill-head .nnk-smallbtn{display:inline-flex;align-items:center;justify-content:center;min-width:28px;padding:4px 6px;margin:0}\n.nnk-modern .nnk-skill-toggle{display:flex;align-items:center;gap:9px;flex:1;min-width:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);padding:4px 2px;font:inherit;font-size:12px;text-align:left;cursor:pointer}\n.nnk-skill-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.nnk-skill-number{font-size:10px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);flex:none}\n.nnk-skill-chevron{display:block;width:6px;height:6px;border-right:1.65px solid currentColor;border-top:1.65px solid currentColor;transform:rotate(45deg);margin:0 4px;transition:transform .3s cubic-bezier(.22,1,.36,1);flex:none}\n.nnk-skill-toggle[aria-expanded=true] .nnk-skill-chevron{transform:rotate(135deg)}\n.nnk-modern .nnk-skill-body{display:block;height:auto;overflow:hidden;opacity:1;transition:none}\n.nnk-modern .nnk-skill-body.nnk-skill-closed{height:0;opacity:0;visibility:hidden;transition:none}\n.nnk-modern .nnk-skill-inner{overflow:hidden;min-height:0}\n.nnk-modern .nnk-skill-fields{padding:4px 14px 14px}\n.nnk-modern .nnk-skill-fields .nnk-textarea{background:var(--dsw-alias-bg-layer-1)}\n.nnk-modern .nnk-skill-fields .nnk-input{background:var(--dsw-alias-bg-layer-1)}\n.nnk-modern .nnk-skill-fields .nnk-input:last-child{background:var(--dsw-alias-bg-layer-2);font-size:11px}\n@media(max-width:650px){.nnk-modern .nnk-wrap{padding:12px 10px 20px}.nnk-modern .nnk-host-frame{padding-left:12px!important}.nnk-modern .nnk-tabs{padding:5px;gap:2px}.nnk-modern .nnk-tab{padding:7px 9px;font-size:11px}.nnk-modern .nnk-tab-pill{top:5px;height:calc(100% - 10px)}.nnk-modern .nnk-card,.nnk-modern .nnk-group{padding:18px 14px}.nnk-modern .nnk-modal{padding:18px 14px}.nnk-modern .nnk-modal-mask{padding:10px}.nnk-modern .nnk-identity{font-size:11px;letter-spacing:1px}.nnk-modern .nnk-appearancebar{gap:8px;margin-bottom:12px}.nnk-modern .nnk-skill-head{padding:8px}.nnk-modern .nnk-skill-toggle{gap:5px}}\n@media(prefers-reduced-motion:reduce){.nnk-scope *,.nnk-scope *::before,.nnk-scope *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\n@media(max-width:650px){.nnk-classic .nnk-dash{grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))}}\n\n.nnk-motion-snapshot,.nnk-motion-snapshot *{pointer-events:none!important;animation:none!important;transition:none!important}\n";
    CSS += '\n' + ".nnk-form-fields,.nnk-submit-area,.nnk-description-head,.nnk-description-body,.nnk-description-editor{display:contents}\n.nnk-description-toggle,.nnk-description-summary,.nnk-skill-excerpt{display:none}\n.nnk-modern .nnk-wrap{max-width:960px;padding:24px 24px 36px;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif;font-size:13px;line-height:1.65}\n.nnk-modern .nnk-appearancebar{margin-bottom:20px;min-height:34px}\n.nnk-modern .nnk-identity{font-size:14px;font-weight:650;letter-spacing:1.4px;color:var(--dsw-alias-label-primary)}\n.nnk-modern .nnk-tabs{padding:10px 14px;margin-bottom:0;border-radius:16px 16px 0 0;gap:4px}\n.nnk-modern .nnk-tab{padding:8px 14px;font-size:13px}\n.nnk-modern .nnk-tab-pill{top:10px;height:calc(100% - 20px)}\n.nnk-modern .nnk-page{border:1px solid var(--dsw-alias-border-l2);border-top:0;border-radius:0 0 16px 16px;background:var(--dsw-alias-bg-layer-1);padding:28px 30px 30px;min-width:0}\n.nnk-modern .nnk-task-form{padding:0;border:0;box-shadow:none;margin:0;border-radius:0;background:transparent}\n.nnk-modern .nnk-task-heading{margin-bottom:26px}\n.nnk-modern .nnk-task-heading>b{display:block;font-size:22px;line-height:1.4;font-weight:600;letter-spacing:-.3px}\n.nnk-modern .nnk-task-heading>.nnk-hint{display:block;font-size:12px;line-height:1.8;margin-top:8px}\n.nnk-modern .nnk-form-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:22px 20px;align-items:start}\n.nnk-modern .nnk-form-fields>*{grid-column:1/-1;min-width:0}\n.nnk-modern .nnk-form-fields>.nnk-field-compact{grid-column:auto;display:flex;flex-direction:column;align-self:stretch}\n.nnk-modern .nnk-task-form .nnk-label{font-size:13px;line-height:1.65;font-weight:550;margin:0 0 8px;color:var(--dsw-alias-label-primary)}\n.nnk-modern .nnk-label-detail{font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary);margin-left:6px;letter-spacing:0}\n.nnk-modern .nnk-field-compact .nnk-label-detail{display:block;margin-left:0;font-size:11px;line-height:1.65}\n.nnk-modern .nnk-field-compact>.nnk-label{margin-bottom:8px}\n.nnk-modern .nnk-textarea,.nnk-modern .nnk-input{font-size:13px;line-height:1.75;padding:10px 12px;border-radius:8px}\n.nnk-modern .nnk-field-compact>.nnk-textarea{display:block;height:46px;min-height:46px;resize:vertical;margin-top:auto}\n.nnk-modern .nnk-description-editor>.nnk-textarea{display:block;min-height:108px}\n.nnk-modern .nnk-description-editor>.nnk-code{min-height:150px}\n.nnk-modern .nnk-radio{position:relative;font-size:12px;padding:8px 12px}\n.nnk-modern .nnk-radio-input{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:1px;height:1px;opacity:0;clip-path:inset(50%)}\n.nnk-modern .nnk-radio:has(.nnk-radio-input:focus-visible){outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}\n.nnk-modern .nnk-choices[data-nnk-choice=\"类型\"],.nnk-modern .nnk-choices[data-nnk-choice=\"写法版本\"],.nnk-modern .nnk-choices[data-nnk-choice=\"写入方式\"]{padding-top:23px;border-top:1px solid var(--dsw-alias-border-l2);margin-top:2px}\n.nnk-modern .nnk-form-fields>.nnk-label{margin-bottom:-14px}\n.nnk-modern .nnk-form-fields>.nnk-hint{margin-top:-10px;font-size:12px}\n.nnk-modern .nnk-description-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:8px}\n.nnk-modern .nnk-description-head>.nnk-label{margin:0;flex:1;min-width:0;cursor:pointer}\n.nnk-modern .nnk-description-toggle{display:flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);padding:0;cursor:pointer}\n.nnk-modern .nnk-description-toggle:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}\n.nnk-description-toggle[aria-expanded=true] .nnk-skill-chevron{transform:rotate(135deg)}\n.nnk-modern .nnk-description-body{position:relative;display:block;height:auto;overflow:hidden;opacity:1;visibility:visible}\n.nnk-modern .nnk-description-editor{display:block;opacity:1;transition:opacity .16s ease}\n.nnk-modern .nnk-description-summary{display:flex;align-items:center;position:absolute;inset:0 0 auto;height:60px;box-sizing:border-box;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .16s ease;overflow:hidden}\n.nnk-modern .nnk-description-excerpt{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}\n.nnk-modern .nnk-description-body.nnk-skill-closed{height:60px;opacity:1;visibility:visible}\n.nnk-modern .nnk-description-body.nnk-skill-closed>.nnk-description-editor{opacity:0;pointer-events:none}\n.nnk-modern .nnk-description-body.nnk-skill-closed>.nnk-description-summary{opacity:1;visibility:visible}\n.nnk-modern .nnk-skill{margin:0!important;border-radius:11px}\n.nnk-modern .nnk-skill-head{padding:12px 14px;gap:7px}\n.nnk-modern .nnk-skill-toggle{font-size:13px;align-items:center;gap:10px}\n.nnk-modern .nnk-skill-caption{display:block;min-width:0;flex:1}\n.nnk-modern .nnk-skill-title{display:block;font-weight:550}\n.nnk-modern .nnk-skill-excerpt{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;line-height:1.7;font-weight:400;color:var(--dsw-alias-label-secondary);margin-top:3px}\n.nnk-modern .nnk-skill-fields{padding:4px 16px 16px}\n.nnk-modern .nnk-skill-fields>.nnk-input:first-child{margin-bottom:10px!important}\n.nnk-modern .nnk-skill-fields>.nnk-textarea{min-height:112px!important}\n.nnk-modern .nnk-skill-fields>.nnk-input:last-child{margin-top:10px!important;font-size:12px}\n.nnk-modern .nnk-form-fields>.nnk-smallbtn{justify-self:start;margin:0}\n.nnk-modern .nnk-submit-area{display:flex;flex-wrap:wrap;align-items:center;gap:16px 24px;margin-top:28px;padding-top:22px;border-top:1px solid var(--dsw-alias-border-l2)}\n.nnk-modern .nnk-submit-area>.nnk-submit{margin:0;padding:12px 22px;font-size:13px;order:2;margin-left:auto}\n.nnk-modern .nnk-submit-area>.nnk-hint{flex:1 1 290px;margin:0;font-size:11px;line-height:1.8;order:1}\n.nnk-modern .nnk-submit-area>.nnk-err{flex-basis:100%;margin:0;order:0}\n.nnk-modern .nnk-taskrow{font-size:13px}\n.nnk-modern .nnk-page>.nnk-card:not(.nnk-task-form){box-shadow:none}\n@media(max-width:650px){.nnk-modern .nnk-wrap{padding:14px 10px 24px}.nnk-modern .nnk-appearancebar{padding:0 6px;margin-bottom:14px}.nnk-modern .nnk-tabs{padding:8px 7px;border-radius:13px 13px 0 0}.nnk-modern .nnk-tab{font-size:12px;padding:8px 10px;gap:5px}.nnk-modern .nnk-tab-pill{top:8px;height:calc(100% - 16px)}.nnk-modern .nnk-page{padding:22px 18px 24px;border-radius:0 0 13px 13px}.nnk-modern .nnk-task-heading>b{font-size:20px}.nnk-modern .nnk-form-fields{gap:20px 16px}.nnk-modern .nnk-field-compact>.nnk-label{min-height:0}.nnk-modern .nnk-label-detail{font-size:11px}.nnk-modern .nnk-submit-area>.nnk-submit{flex:1 1 100%;width:100%}.nnk-modern .nnk-skill-head{padding:10px;gap:3px}}\n@media(prefers-reduced-motion:reduce){.nnk-description-editor,.nnk-description-summary{transition:none!important}}\n";
    CSS += '\n' + "/* Shared presentation styles; classic wrappers do not alter layout. */\n.nnk-settings-section,.nnk-task-skills{display:contents}\n.nnk-modal:focus{outline:none}\n.nnk-scope .nnk-panel{max-height:min(var(--nnk-panel-limit,560px),calc(100vh - var(--nnk-panel-y,8px) - 12px))!important}\n.nnk-scope .nnk-panel-body{box-sizing:border-box;min-height:0}\n.nnk-modern .nnk-card,.nnk-modern .nnk-group{box-shadow:none}\n.nnk-modern .nnk-hint{font-size:12px;line-height:1.75}\n.nnk-modern .nnk-smallbtn,.nnk-modern .nnk-copy{font-size:12px;line-height:1.55}\n.nnk-modern .nnk-smallbtn:disabled{opacity:.45;cursor:default}\n.nnk-modern .nnk-badge{font-size:11px;line-height:1.6;padding:3px 8px;border-radius:6px;white-space:normal}\n.nnk-modern .nnk-mini{min-height:100px;font-size:13px;line-height:1.75;padding:12px;border-radius:8px}\n.nnk-modern .nnk-mini:focus{border-color:var(--dsw-alias-brand-primary)}\n.nnk-modern .nnk-note{padding:10px 12px;line-height:1.75;overflow-wrap:anywhere}\n.nnk-modern .nnk-cmd{max-width:100%;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;padding:12px}\n.nnk-modern .nnk-online-dashboard{display:flex;flex-direction:column;align-items:stretch;gap:18px;min-width:0}\n.nnk-modern .nnk-online-dashboard>.nnk-card{margin:0}\n.nnk-modern .nnk-online-notice{padding:14px 18px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:1.7}\n.nnk-modern .nnk-online-notice .nnk-hint{margin-top:5px}\n.nnk-modern .nnk-online-status{padding:18px 20px}\n.nnk-modern .nnk-online-title{font-size:14px;font-weight:600;margin-bottom:10px}\n.nnk-modern .nnk-online-runtime{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;align-items:center}\n.nnk-modern .nnk-online-runtime>*{grid-column:1/-1;margin-top:0}\n.nnk-modern .nnk-online-runtime>:first-child{grid-column:1;grid-row:1}\n.nnk-modern .nnk-online-runtime>.nnk-row{grid-column:2;grid-row:1;margin:0}\n.nnk-modern .nnk-online-runtime>.nnk-row button{margin:0}\n.nnk-modern .nnk-online-runtime>.nnk-phaseline{font-size:12px}\n.nnk-modern .nnk-online-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:16px}\n.nnk-modern .nnk-online-actions>.nnk-card{margin:0;padding:20px;min-width:0}\n.nnk-modern .nnk-online-primary>.nnk-hint{margin:10px 0 14px}\n.nnk-modern .nnk-online-primary>.nnk-row{gap:8px;margin-top:14px}\n.nnk-modern .nnk-online-primary .nnk-submit{font-size:12px;padding:10px 16px}\n.nnk-modern .nnk-online-primary>.nnk-input{font-variant-numeric:tabular-nums}\n.nnk-modern .nnk-online-primary>.nnk-copy{margin-right:6px}\n.nnk-modern .nnk-online-primary .nnk-danger{margin-left:auto}\n.nnk-modern .nnk-online-diagnostics{gap:16px}\n.nnk-modern .nnk-online-diagnostics>.nnk-card{margin:0;padding:20px;min-width:0}\n.nnk-modern .nnk-online-events .nnk-log{margin-top:12px;max-height:200px;padding:10px 12px;font-size:12px;line-height:1.9}\n.nnk-modern .nnk-online-events .nnk-log>.nnk-hint{margin:0}\n.nnk-modern .nnk-fold-head{display:flex;align-items:center;min-height:24px;font-size:13px;line-height:1.7;border-radius:4px}\n.nnk-modern .nnk-fold-head>b{display:flex;align-items:center;gap:5px}\n.nnk-modern .nnk-settings{padding:0;border:0;background:transparent}\n.nnk-modern .nnk-settings-section{display:block;padding:22px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;margin:0 0 16px;background:var(--dsw-alias-bg-layer-1);min-width:0}\n.nnk-modern .nnk-settings-section:last-child{margin-bottom:0}\n.nnk-modern .nnk-settings-heading{margin-top:0!important;line-height:1.7}\n.nnk-modern .nnk-settings-heading>b{display:block;font-size:15px;font-weight:600}\n.nnk-modern .nnk-settings-heading>.nnk-hint{display:block;margin:6px 0 14px}\n.nnk-modern .nnk-settings-section>.nnk-input{margin-top:12px}\n.nnk-modern .nnk-settings-section>.nnk-hint{margin-top:10px}\n.nnk-modern .nnk-settings-section>.nnk-radio{margin-top:8px!important;padding:12px}\n.nnk-modern .nnk-settings-section>.nnk-radio input{margin-right:6px;vertical-align:middle}\n.nnk-modern .nnk-settings-section>.nnk-radio .nnk-break{overflow-wrap:anywhere;word-break:normal}\n.nnk-modern .nnk-maintenance-row{padding-top:16px;margin-top:14px;border-top:1px solid var(--dsw-alias-border-l2)}\n.nnk-modern .nnk-settings-section>.nnk-maintenance-row:first-of-type{margin-top:0}\n.nnk-modern .nnk-maintenance-row>div:first-child{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}\n.nnk-modern .nnk-maintenance-row>div:first-child>.nnk-hint{margin:0}\n.nnk-modern .nnk-settings-about{padding:4px 0 0;border:0;background:transparent}\n.nnk-modern .nnk-settings>.nnk-err,.nnk-modern .nnk-settings>.nnk-ok{margin:0 0 16px}\n.nnk-modern .nnk-task-list{min-width:0}\n.nnk-modern .nnk-task-list>.nnk-hint:first-child{margin:0 0 18px}\n.nnk-modern .nnk-task-list>.nnk-label{margin:24px 0 12px}\n.nnk-modern .nnk-task-list .nnk-taskrow{padding:20px;border-radius:12px;margin-bottom:16px;overflow-wrap:anywhere}\n.nnk-modern .nnk-task-title{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}\n.nnk-modern .nnk-task-title>.nnk-badge{margin:0}\n.nnk-modern .nnk-task-title>b{font-size:15px;overflow-wrap:anywhere}\n.nnk-modern .nnk-task-actions{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-top:14px}\n.nnk-modern .nnk-task-actions>.nnk-smallbtn{margin:0}\n.nnk-modern .nnk-task-actions>.nnk-danger{margin-left:auto}\n.nnk-modern .nnk-smallbtn.nnk-danger{color:var(--dsw-alias-state-error-primary)}\n.nnk-modern .nnk-task-skills{display:block;margin:20px 0 0 7px;padding-left:19px;border-left:1px solid var(--dsw-alias-border-l2)}\n.nnk-modern .nnk-task-skill{position:relative;padding:14px!important;margin:0 0 10px!important;border-radius:9px;background:var(--dsw-alias-bg-layer-2)}\n.nnk-modern .nnk-task-skill:before{content:\"\";position:absolute;left:-20px;top:27px;width:19px;height:1px;background:var(--dsw-alias-border-l2);pointer-events:none}\n.nnk-modern .nnk-task-skill-head{flex-wrap:wrap;row-gap:8px!important}\n.nnk-modern .nnk-task-skill-head>b{font-size:13px!important;overflow-wrap:anywhere}\n.nnk-modern .nnk-task-skill-head>.nnk-badge{margin-right:2px}\n.nnk-modern .nnk-task-skill-head>.nnk-smallbtn{margin:0}\n.nnk-modern .nnk-task-skill>.nnk-hint{margin-top:10px}\n.nnk-modern .nnk-task-skill .nnk-fbrow{padding:6px 10px;margin-top:8px;line-height:1.7;border-left-width:2px}\n.nnk-modern .nnk-task-feedback{margin-top:16px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l2)}\n.nnk-modern .nnk-task-feedback>.nnk-hint{margin-top:0}\n.nnk-modern .nnk-task-feedback>.nnk-smallbtn{margin-top:10px}\n.nnk-modern .nnk-history-overview{padding:0;border:0;background:transparent}\n.nnk-modern .nnk-history-overview>b{display:block;font-size:17px;margin-bottom:16px}\n.nnk-modern .nnk-history-overview .nnk-taskrow{margin:0 0 14px;padding:18px 20px}\n.nnk-modern .nnk-history-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap}\n.nnk-modern .nnk-history-heading>b{font-size:14px;overflow-wrap:anywhere}\n.nnk-modern .nnk-history-heading>.nnk-badge{margin:0!important}\n.nnk-modern .nnk-history-detail{padding:20px;background:var(--dsw-alias-bg-layer-2)}\n.nnk-modern .nnk-history-detail>b{display:block;font-size:15px;overflow-wrap:anywhere}\n.nnk-modern .nnk-history-note{align-items:center!important}\n.nnk-modern .nnk-history-note>.nnk-note{flex:1;min-width:0}\n.nnk-modern .nnk-tool-result{padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;line-height:1.75;min-width:0}\n.nnk-modern .nnk-tool-result>.nnk-note{margin-top:12px;font-size:12px}\n.nnk-modern .nnk-modal-mask{box-sizing:border-box;padding:24px;overscroll-behavior:contain}\n.nnk-modern .nnk-modal{position:relative;box-sizing:border-box;width:680px;max-width:100%;max-height:calc(100dvh - 48px);padding:26px 28px;border-radius:16px;box-shadow:none;overscroll-behavior:contain;scrollbar-gutter:stable}\n.nnk-modern .nnk-modal-close{display:flex;align-items:center;justify-content:center;position:absolute;right:20px;top:20px;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit}\n.nnk-modern .nnk-modal-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}\n.nnk-modern .nnk-modal>.nnk-modal-title,.nnk-modern .nnk-modal>.nnk-rm-head{padding-right:34px}\n.nnk-modern .nnk-modal-title{font-size:18px;font-weight:600;line-height:1.5;overflow-wrap:anywhere}\n.nnk-modern .nnk-modal>.nnk-modal-title{padding-bottom:18px;margin-bottom:0;border-bottom:1px solid var(--dsw-alias-border-l2)}\n.nnk-modern .nnk-modal-body{padding-top:8px}\n.nnk-modern .nnk-modal .nnk-label{margin:18px 0 8px}\n.nnk-modern .nnk-modal .nnk-code{white-space:pre-wrap;overflow-wrap:anywhere;min-height:110px;font-size:12px}\n.nnk-modern .nnk-modal-actions{gap:10px;margin-top:22px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l2)}\n.nnk-modern .nnk-modal-actions>.nnk-copy{margin-top:0}\n.nnk-modern .nnk-modal-actions>.nnk-copy:last-child{margin-left:auto}\n.nnk-modern .nnk-rm-head{gap:12px;align-items:flex-start}\n.nnk-modern .nnk-rm-head>.nnk-modal-title{margin:0}\n.nnk-modern .nnk-rm-code{margin-top:20px;padding:15px 16px;border-radius:10px;gap:12px}\n.nnk-modern .nnk-rm-codeval{font-size:26px;letter-spacing:4px}\n.nnk-modern .nnk-rm-code>.nnk-copy{margin-left:auto}\n.nnk-modern .nnk-rm-seats,.nnk-modern .nnk-rm-queue{grid-template-columns:repeat(auto-fit,minmax(min(100%,128px),1fr));gap:10px;margin-top:16px}\n.nnk-modern .nnk-rm-queue{grid-template-columns:repeat(auto-fill,minmax(min(100%,128px),1fr))}\n.nnk-modern .nnk-seat{padding:14px 8px;gap:8px;border-radius:10px}\n.nnk-modern .nnk-seat-avatar{width:38px;height:38px;font-size:15px}\n.nnk-modern .nnk-seat-name{font-size:12px;font-weight:550}\n.nnk-modern .nnk-rm-ops{margin-top:22px;padding-top:4px}\n.nnk-modern .nnk-rm-ops>.nnk-hint{padding:12px 0}\n.nnk-modern .nnk-rm-ops .nnk-radios{gap:8px}\n.nnk-modern .nnk-rm-ops .nnk-radio{font-size:12px}\n.nnk-modern .nnk-inv-box{margin-top:20px}\n.nnk-modern .nnk-inv-row{padding:14px;margin-top:10px;border-radius:10px}\n.nnk-modern .nnk-inv-head{gap:8px}\n.nnk-modern .nnk-inv-head .nnk-smallbtn{margin:0}\n.nnk-modern .nnk-inv-state{white-space:normal;overflow-wrap:anywhere}\n.nnk-modern .nnk-panel{box-sizing:border-box;border-radius:14px;box-shadow:none}\n.nnk-modern .nnk-panel-head{padding:12px 14px;gap:12px;flex-shrink:0}\n.nnk-modern .nnk-panel-title{font-size:13px;line-height:1.6}\n.nnk-modern .nnk-panel-close{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;flex-shrink:0}\n.nnk-modern .nnk-panel-close:hover{background:var(--dsw-alias-bg-layer-2)}\n.nnk-modern .nnk-panel-body{padding:16px;min-height:0;overscroll-behavior:contain}\n.nnk-modern .nnk-panel .nnk-wrap{padding:0!important;height:auto}\n.nnk-modern .nnk-panel .nnk-page{padding:18px 14px}\n.nnk-modern .nnk-panel .nnk-tabs{padding:10px 6px}\n.nnk-modern .nnk-panel .nnk-tab{padding:7px 9px;font-size:12px}\n.nnk-modern .nnk-panel .nnk-appearancebar{margin-bottom:14px}\n.nnk-modern .nnk-panel .nnk-online-actions{grid-template-columns:minmax(0,1fr)}\n.nnk-modern .nnk-panel .nnk-settings-section,.nnk-modern .nnk-panel .nnk-online-actions>.nnk-card,.nnk-modern .nnk-panel .nnk-online-diagnostics>.nnk-card{padding:16px}\n.nnk-modern .nnk-panel .nnk-task-list .nnk-taskrow{padding:14px}\n.nnk-modern .nnk-panel .nnk-task-skills{padding-left:12px;margin-left:3px}\n.nnk-modern .nnk-panel .nnk-task-skill:before{left:-13px;width:12px}\n@media(max-width:650px){\n.nnk-modern .nnk-settings-section{padding:18px 16px}\n.nnk-modern .nnk-online-notice{padding:12px 14px}\n.nnk-modern .nnk-online-status,.nnk-modern .nnk-online-actions>.nnk-card,.nnk-modern .nnk-online-diagnostics>.nnk-card{padding:16px}\n.nnk-modern .nnk-online-runtime{column-gap:8px}\n.nnk-modern .nnk-task-list .nnk-taskrow{padding:16px}\n.nnk-modern .nnk-task-skills{padding-left:12px;margin-left:3px}\n.nnk-modern .nnk-task-skill{padding:12px!important}\n.nnk-modern .nnk-task-skill:before{left:-13px;width:12px}\n.nnk-modern .nnk-modal-mask{padding:12px}\n.nnk-modern .nnk-modal{padding:20px 16px;max-height:calc(100dvh - 24px);border-radius:12px}\n.nnk-modern .nnk-modal-title{font-size:16px}\n.nnk-modern .nnk-modal-actions>.nnk-copy{max-width:100%;text-align:left}\n.nnk-modern .nnk-rm-codeval{font-size:22px}\n.nnk-modern .nnk-rm-seats,.nnk-modern .nnk-rm-queue{grid-template-columns:repeat(auto-fit,minmax(min(100%,116px),1fr))}\n.nnk-modern .nnk-rm-queue{grid-template-columns:repeat(auto-fill,minmax(min(100%,116px),1fr))}\n.nnk-modern .nnk-modal-close{top:16px;right:12px}\n.nnk-modern .nnk-seat{padding:12px 6px}\n.nnk-modern .nnk-inv-row{padding:12px}\n}\n\n";
    CSS += '\n.nnk-scope .nnk-online-runtime>.nnk-row{flex-wrap:wrap}\n@media(max-width:650px){.nnk-modern .nnk-online-runtime{grid-template-columns:minmax(0,1fr)}.nnk-modern .nnk-online-runtime>.nnk-row{grid-column:1;grid-row:auto}}\n';
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-noname-kit/ui"]') === null) {
      var tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-noname-kit';
      tag.dataset.pluginCss = 'dsh-noname-kit/ui';
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    // 动效只作用于现有展示节点；没有第二套 React/表单/联机实例。
    var motionEase = 'cubic-bezier(.22,1,.36,1)';
    var motionPreference = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    var appearanceMotion = [];
    var skillMotion = new Map();
    var motionInteractionBound = false;

    function endMotionForInteraction(ev) {
      if (ev.type === 'pointermove' && !ev.buttons) return;
      if (ev.target && ev.target.closest && ev.target.closest('.nnk-appearance-switch')) return;
      appearanceMotion.slice().forEach(finishAppearanceMotion);
    }

    function bindMotionInteraction() {
      if (motionInteractionBound) return;
      motionInteractionBound = true;
      ['pointerdown','pointermove','wheel','keydown','beforeinput'].forEach(function (name) { document.addEventListener(name, endMotionForInteraction, { capture: true, passive: true }) });
    }

    function motionAllowed() {
      return typeof document !== 'undefined' && typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function' && !(motionPreference && motionPreference.matches);
    }

    function finishAppearanceMotion(entry) {
      if (entry.observer) entry.observer.disconnect();
      if (entry.fade) entry.fade.cancel();
      if (entry.live) entry.live.cancel();
      entry.layer.remove();
      appearanceMotion = appearanceMotion.filter(function (item) { return item !== entry });
      if (!appearanceMotion.length && motionInteractionBound) {
        ['pointerdown','pointermove','wheel','keydown','beforeinput'].forEach(function (name) { document.removeEventListener(name, endMotionForInteraction, true) });
        motionInteractionBound = false;
      }
    }

    function prepareAppearanceMotion(target) {
      if (!motionAllowed()) return;
      var returned = [];
      appearanceMotion.slice().forEach(function (entry) {
        if (!entry.root.isConnected || entry.look === target) { returned.push(entry.root); finishAppearanceMotion(entry) }
      });
      Array.prototype.forEach.call(document.querySelectorAll('.nnk-scope .nnk-wrap'), function (root) {
        if (root.closest('.nnk-motion-snapshot') || returned.indexOf(root) >= 0 || root.querySelector('.nnk-modal-mask')) return;
        var rect = root.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight) return;
        var covered = Array.prototype.some.call(document.querySelectorAll('.nnk-panel,.nnk-modal-mask,[role="dialog"],[role="menu"],[role="tooltip"]'), function (overlay) {
          if (overlay.contains(root) || overlay.closest('.nnk-motion-snapshot')) return false;
          var bounds = overlay.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0 && bounds.left < rect.right && bounds.right > rect.left && bounds.top < rect.bottom && bounds.bottom > rect.top;
        });
        // 独立浮窗/宿主菜单优先；不以旧画面盖住仍可操作的上层控件。
        if (covered) return;
        // 连续反向共用当前快照，不堆叠动画或反复复制 DOM。
        if (appearanceMotion.some(function (entry) { return entry.root === root })) return;
        var scope = root.closest('.nnk-scope'), style = getComputedStyle(root);
        var clip = { left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) };
        for (var ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
          var bounds = ancestor.getBoundingClientRect(), overflow = getComputedStyle(ancestor);
          if (/(auto|scroll|hidden|clip)/.test(overflow.overflowX)) { clip.left = Math.max(clip.left, bounds.left + ancestor.clientLeft); clip.right = Math.min(clip.right, bounds.left + ancestor.clientLeft + ancestor.clientWidth) }
          if (/(auto|scroll|hidden|clip)/.test(overflow.overflowY)) { clip.top = Math.max(clip.top, bounds.top + ancestor.clientTop); clip.bottom = Math.min(clip.bottom, bounds.top + ancestor.clientTop + ancestor.clientHeight) }
        }
        if (clip.right <= clip.left || clip.bottom <= clip.top) return;
        var layer = document.createElement('div');
        layer.className = 'nnk-scope nnk-motion-snapshot ' + (scope.classList.contains('nnk-classic') ? 'nnk-classic' : 'nnk-modern');
        layer.setAttribute('aria-hidden', 'true'); layer.setAttribute('inert', '');
        Object.assign(layer.style, { display: 'block', position: 'fixed', left: clip.left + 'px', top: clip.top + 'px', width: (clip.right - clip.left) + 'px', height: (clip.bottom - clip.top) + 'px', overflow: 'hidden', pointerEvents: 'none', zIndex: '99999', margin: '0' });
        ['fontFamily','fontSize','fontWeight','lineHeight','color'].forEach(function (name) { layer.style[name] = style[name] });
        for (var i = 0; i < style.length; i++) { var variable = style[i]; if (variable.indexOf('--ds') === 0 || variable.indexOf('--nnk-') === 0) layer.style.setProperty(variable, style.getPropertyValue(variable)); }
        var clone = root.cloneNode(true);
        var originals = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
        var copies = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
        copies.forEach(function (node, index) {
          // 特别移除 name：惯性或 disabled 不能隔离原生 radio 的同名分组。
          ['id','name','form','autofocus','tabindex','contenteditable','for','aria-controls','aria-labelledby','aria-describedby'].forEach(function (name) { node.removeAttribute(name) });
          Array.prototype.slice.call(node.attributes).forEach(function (attr) { if (/^on/i.test(attr.name)) node.removeAttribute(attr.name) });
          if (node.tagName === 'BUTTON') node.type = 'button';
          if ('value' in node) node.value = originals[index].value;
          if ('checked' in node) node.checked = originals[index].checked;
          if ('selected' in node) node.selected = originals[index].selected;
          node.style.animation = 'none'; node.style.transition = 'none';
          if (originals[index].matches('.nnk-tab-pill,.nnk-skill-body,.nnk-skill-chevron')) {
            var visible = getComputedStyle(originals[index]);
            ['height','opacity','visibility','transform'].forEach(function (name) { node.style[name] = visible[name] });
          }
        });
        Object.assign(clone.style, { position: 'absolute', left: (rect.left - clip.left) + 'px', top: (rect.top - clip.top) + 'px', width: rect.width + 'px', maxWidth: 'none', height: rect.height + 'px', margin: '0', opacity: '1' });
        layer.appendChild(clone); document.body.appendChild(layer);
        copies.forEach(function (node, index) { node.scrollTop = originals[index].scrollTop; node.scrollLeft = originals[index].scrollLeft });
        var entry = { root: root, layer: layer, live: null, fade: null, look: scope.classList.contains('nnk-classic') ? 'classic' : 'modern' };
        appearanceMotion.push(entry);
        // 真实异步弹窗在过渡中的任意一帧到达，都立即优先展示原控件。
        if (typeof MutationObserver !== 'undefined') {
          entry.observer = new MutationObserver(function () { if (root.querySelector('.nnk-modal-mask')) finishAppearanceMotion(entry) });
          entry.observer.observe(root, { childList: true, subtree: true });
        }
        bindMotionInteraction();
        entry.fade = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: motionEase, fill: 'forwards' });
        entry.fade.finished.then(function () { finishAppearanceMotion(entry) }, function () {});
      });
    }

    function playAppearanceMotion() {
      if (!motionAllowed()) { appearanceMotion.slice().forEach(finishAppearanceMotion); return }
      appearanceMotion.forEach(function (entry) {
        if (!entry.root.isConnected || entry.root.querySelector('.nnk-modal-mask')) { finishAppearanceMotion(entry); return }
        var opacity = entry.live ? getComputedStyle(entry.root).opacity : .65;
        if (entry.live) entry.live.cancel();
        entry.live = entry.root.animate([{ opacity: opacity }, { opacity: 1 }], { duration: 180, easing: motionEase });
      });
    }

    function finishSkillMotion(body, entry) {
      if (skillMotion.get(body) !== entry) return;
      if (entry.frame !== null) cancelAnimationFrame(entry.frame);
      if (entry.animation) entry.animation.cancel();
      ['height','opacity','visibility','overflow'].forEach(function (name) { body.style[name] = '' });
      if (skillMotion.get(body) === entry) skillMotion.delete(body);
    }

    function prepareSkillMotion(id) {
      if (!motionAllowed()) return;
      var body = document.getElementById(id);
      if (!body || !body.closest('.nnk-modern')) return;
      var from = body.getBoundingClientRect().height, opacity = getComputedStyle(body).opacity;
      var previous = skillMotion.get(body);
      if (previous) finishSkillMotion(body, previous);
      Object.assign(body.style, { height: from + 'px', opacity: opacity, visibility: 'visible', overflow: 'hidden' });
      var entry = { frame: null, animation: null };
      skillMotion.set(body, entry);
      entry.frame = requestAnimationFrame(function () {
        entry.frame = null;
        if (!body.isConnected || !body.closest('.nnk-modern') || !motionAllowed()) { finishSkillMotion(body, entry); return }
        var open = !body.classList.contains('nnk-skill-closed');
        var description = body.hasAttribute('data-nnk-description');
        var to = open ? body.firstElementChild.scrollHeight : (description ? 60 : 0);
        entry.animation = body.animate([{ height: from + 'px', opacity: opacity }, { height: to + 'px', opacity: open || description ? 1 : 0 }], { duration: 300, easing: motionEase, fill: 'forwards' });
        entry.animation.finished.then(function () { finishSkillMotion(body, entry) }, function () {});
      });
    }

    // 入场动效仅跟随栏目操作，切换外观时保持页面内容连续显示。
    function WorkshopPage(props) {
      var root = React.useRef(null), previous = React.useRef(props.active);
      React.useLayoutEffect(function () {
        if (previous.current === props.active) return;
        previous.current = props.active;
        var node = root.current;
        if (!node || !node.closest('.nnk-modern') || !motionAllowed()) return;
        node.getAnimations().forEach(function (animation) { animation.cancel() });
        node.animate([{ opacity: .92 }, { opacity: 1 }], { duration: 160, easing: motionEase });
      }, [props.active]);
      return h('div', { ref: root, className: 'nnk-page', id: props.id + '-page-' + props.active, role: 'tabpanel', 'aria-labelledby': props.id + '-tab-' + props.active }, props.children);
    }

    function mountMotionLifecycle() {
      var onPreferenceChange = function (ev) {
        if (!ev.matches) return;
        appearanceMotion.slice().forEach(finishAppearanceMotion);
        skillMotion.forEach(function (entry, body) { finishSkillMotion(body, entry) });
      };
      if (motionPreference && motionPreference.addEventListener) motionPreference.addEventListener('change', onPreferenceChange);
      return function () {
        if (motionPreference && motionPreference.removeEventListener) motionPreference.removeEventListener('change', onPreferenceChange);
        appearanceMotion.slice().forEach(finishAppearanceMotion);
        skillMotion.forEach(function (entry, body) { finishSkillMotion(body, entry) });
        if (appearanceBus.frame !== null) cancelAnimationFrame(appearanceBus.frame);
        appearanceBus.frame = null;
        appearanceBus.revision++;
      };
    }


    // 外观层独立于业务；只更新作用域 class，不重建表单或联机组件。
    var appearanceBus = {
      value: (function () { try { return localStorage.getItem('dsh-noname-kit.appearance') === 'classic' ? 'classic' : 'modern' } catch (err) { return 'modern' } })(),
      subs: [], revision: 0, frame: null, positions: {},
      sub: function (fn) { this.subs.push(fn); var self = this; return function () { self.subs = self.subs.filter(function (item) { return item !== fn }) } },
      capture: function () {
        if (typeof document === 'undefined') return null;
        var active = document.activeElement;
        var scroll = Array.prototype.slice.call(document.querySelectorAll('.nnk-scope .nnk-wrap,.nnk-scope .nnk-panel-body,.nnk-scope .nnk-modal,.nnk-scope textarea,.nnk-scope .nnk-log'));
        scroll = scroll.filter(function (node) { return !node.closest('.nnk-motion-snapshot') });
        for (var parent = active; parent; parent = parent.parentElement) if (scroll.indexOf(parent) < 0) scroll.push(parent);
        var snapshot = { active: active, scroll: scroll.map(function (node) {
          var panel = node.closest('[role="tabpanel"]') || node.querySelector('[role="tabpanel"]');
          return { node: node, context: panel && panel.id || '', top: node.scrollTop, left: node.scrollLeft };
        }) };
        try { snapshot.start = active.selectionStart; snapshot.end = active.selectionEnd; snapshot.direction = active.selectionDirection } catch (err) {}
        return snapshot;
      },
      set: function (value, snapshot) {
        if (value === this.value) return;
        var self = this, revision = ++this.revision;
        this.positions[this.value] = snapshot && snapshot.scroll;
        var previous = this.positions[value] || [];
        var positions = (snapshot && snapshot.scroll || []).map(function (item) {
          // 同一滚动节点可能承载不同栏目，缓存只在同一栏目里恢复。
          return previous.filter(function (saved) { return saved.node === item.node && saved.context === item.context })[0] || item;
        });
        prepareAppearanceMotion(value);
        skillMotion.forEach(function (entry, body) { finishSkillMotion(body, entry) });
        this.value = value;
        this.focusTarget = snapshot && snapshot.active;
        try { localStorage.setItem('dsh-noname-kit.appearance', value) } catch (err) {}
        this.subs.slice().forEach(function (fn) { fn(value) });
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(function () {
          if (self.revision !== revision) return;
          self.frame = null;
          if (snapshot && snapshot.active && snapshot.active.isConnected) {
            snapshot.active.focus({ preventScroll: true });
            try { if (typeof snapshot.start === 'number') snapshot.active.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction) } catch (err) {}
          }
          positions.forEach(function (item) { if (item.node.isConnected) { item.node.scrollTop = item.top; item.node.scrollLeft = item.left } });
          playAppearanceMotion();
        });
      }
    };

    function useAppearance() {
      var state = React.useState(appearanceBus.value);
      React.useEffect(function () { return appearanceBus.sub(state[1]) }, []);
      return state[0];
    }

    var skillScopeSerial = 0;

    function AppearanceScope(props) {
      var appearance = useAppearance();
      return h('div', { className: 'nnk-scope nnk-' + appearance, 'data-nnk-appearance': appearance }, props.children);
    }

    function AppearanceSwitch() {
      var appearance = useAppearance();
      return h('div', { className: 'nnk-appearance-switch', role: 'group', 'aria-label': '工坊外观' },
        ['modern', 'classic'].map(function (value) {
          return h('button', {
            key: value, type: 'button', 'aria-pressed': appearance === value,
            onPointerDown: function (ev) {
              var active = document.activeElement;
              if (ev.button === 0 && active && (active.matches('input,textarea,select') || active.isContentEditable)) ev.preventDefault();
            },
            onClick: function () {
              appearanceBus.set(value, appearanceBus.capture());
            }
          }, value === 'modern' ? '新版' : '经典');
        })
      );
    }

    // 图标仅改变显示节点；原始文案、输入值、占位提示、业务消息均原样保留。
    function visualIcons(child) {
      if (Array.isArray(child)) return child.map(visualIcons);
      if (typeof child !== 'string') return child;
      if (!/[\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF\u21A9\u21BA\u21BB\u2191\u2193\u23E9-\u23F3]/u.test(child)) return child;
      var cache = visualIcons.cache || (visualIcons.cache = new Map());
      if (cache.has(child)) return cache.get(child);
      var paths = {
        tools: 'M14 6a4 4 0 0 0-5 5L3 17l4 4 6-6a4 4 0 0 0 5-5l-3 3-4-4 3-3M15 3l6 6M18 6l-3 3',
        list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
        history: 'M3 10a9 9 0 1 1 0 5M3 4v6h6M12 7v5l3 2',
        globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18',
        settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
        plus: 'M12 5v14M5 12h14',
        folder: 'M3 7V4h7l2 3h9v13H3V7',
        sword: 'M5 20 19 6l1-3-3 1L3 18M4 14l6 6M3 21l2-2',
        card: 'M4 3h16v18H4V3M12 7l4 5-4 5-4-5 4-5',
        dice: 'M4 4h16v16H4V4M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01',
        edit: 'M4 20l4-1L20 7l-3-3L5 16l-1 4M14 7l3 3',
        check: 'M5 12l4 4L19 6',
        close: 'M6 6l12 12M6 18 18 6',
        warning: 'M12 3 2 21h20L12 3M12 9v5M12 17h.01',
        refresh: 'M20 8a8 8 0 0 0-14-2L3 9M3 3v6h6M4 16a8 8 0 0 0 14 2l3-3M21 21v-6h-6',
        image: 'M3 3h18v18H3V3M3 17l6-6 4 4 3-3 5 5M9 7h.01',
        audio: 'M3 9h4l5-5v16l-5-5H3V9M16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14',
        trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
        user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',
        signal: 'M4 9a12 12 0 0 1 16 0M7 12a8 8 0 0 1 10 0M10 15a3 3 0 0 1 4 0M12 19h.01',
        book: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1v15',
        file: 'M5 3h9l5 5v13H5V3M14 3v6h5M8 13h8M8 17h6',
        link: 'M10 13l4-4M8 15l-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0M16 9l2-2a3 3 0 0 1 4 4l-5 5a3 3 0 0 1-4 0',
        lock: 'M5 10h14v11H5V10M8 10V7a4 4 0 0 1 8 0v3',
        play: 'M7 3v18l14-9L7 3',
        search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0M15 15l6 6',
        clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2',
        up: 'M12 20V4M5 11l7-7 7 7',
        down: 'M12 4v16M5 13l7 7 7-7',
        send: 'M3 3l18 9-18 9 4-9-4-9M7 12h14',
        bolt: 'M13 2 4 14h7l-1 8 10-13h-7V2',
        dot: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0'
      };
      var glyphs = { '🛠':'tools','📋':'list','📜':'history','🌐':'globe','⚙':'settings','🆕':'plus','📂':'folder','⚔':'sword','🃏':'card','🎲':'dice','✨':'plus','✏':'edit','✅':'check','❌':'close','⚠':'warning','🔨':'tools','➕':'plus','♻':'refresh','🔁':'refresh','📷':'image','🔊':'audio','🗑':'trash','👤':'user','📡':'signal','📖':'book','📦':'folder','🔗':'link','🔒':'lock','🔓':'lock','▶':'play','🚀':'send','🔍':'search','🔎':'search','⏳':'clock','💡':'bolt','🟡':'dot','🟠':'dot','🟢':'dot','🔴':'dot','✕':'close','↑':'up','↓':'down','💾':'file','📄':'file','📁':'folder','🧩':'card','🎯':'check','🧪':'dice','🔧':'tools','📝':'edit','📥':'down','📤':'up','⏸':'clock','⏹':'close','🔄':'refresh','🕒':'clock','💬':'file','🎮':'dice','🏠':'folder','🚪':'folder','🧹':'trash','🔑':'lock','📌':'link','💻':'card','🌟':'plus','☑':'check','⛔':'close','🛑':'close','📚':'book','🧑':'user','🎵':'audio','🖼':'image','🪑':'user','🏁':'check','🎉':'check','🏛':'folder','👑':'user','📨':'send','🔌':'link','🔵':'dot','🤝':'link','🚏':'clock','🚫':'close','🛡':'lock','🛰':'signal','⚪':'dot','☐':'card','✖':'close','⏪':'history','⬆':'up','↩':'refresh','↺':'refresh','✓':'check' };
      var expression = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF\u21A9\u21BA\u21BB\u2191\u2193\u23E9-\u23F3]\uFE0F?/gu;
      var pieces = [], index = 0, match;
      while ((match = expression.exec(child))) {
        var glyph = match[0], name = glyphs[glyph.replace(/\uFE0F/g, '')];
        if (!name) continue;
        if (match.index > index) pieces.push(child.slice(index, match.index));
        pieces.push(React.createElement('span', { key: 'icon-' + match.index, className: 'nnk-glyph', 'aria-hidden': true },
          React.createElement('span', { className: 'nnk-glyph-classic' }, glyph),
          React.createElement('svg', { className: 'nnk-glyph-modern', viewBox: '0 0 24 24', focusable: 'false' }, React.createElement('path', { d: paths[name] }))));
        index = match.index + glyph.length;
      }
      if (!pieces.length) return child;
      if (index < child.length) pieces.push(child.slice(index));
      if (cache.size >= 256) cache.clear();
      cache.set(child, pieces);
      return pieces;
    }

    function WorkshopTabs(props) {
      var nav = React.useRef(null), pill = React.useRef(null), measureRef = React.useRef(null);
      var appearance = useAppearance();
      var tabs = [['new','🛠 任务'],['tasklist','📋 任务列表'],['history','📜 历史'],['online','🌐 联机'],['settings','⚙ 设置']];
      React.useLayoutEffect(function () {
        var node = nav.current;
        function measure() {
          var selected = node && node.querySelector('[aria-selected="true"]');
          if (!selected || !pill.current) return;
          pill.current.style.width = selected.offsetWidth + 'px';
          pill.current.style.transform = 'translateX(' + selected.offsetLeft + 'px)';
          pill.current.style.opacity = '1';
        }
        measureRef.current = measure;
        measure();
        var observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        if (observer && node) { observer.observe(node); Array.prototype.forEach.call(node.querySelectorAll('button'), function (button) { observer.observe(button) }) }
        return function () { if (observer) observer.disconnect() };
      }, []);
      React.useLayoutEffect(function () { if (measureRef.current) measureRef.current() }, [props.active, appearance]);
      return h('div', { className: 'nnk-tabs', ref: nav, role: 'tablist', 'aria-label': '无名杀工坊栏目' },
        h('span', { className: 'nnk-tab-pill', ref: pill, 'aria-hidden': true }),
        tabs.map(function (tab, index) {
          return h('button', {
            key: tab[0], type: 'button', role: 'tab', id: props.id + '-tab-' + tab[0],
            'aria-selected': props.active === tab[0], 'aria-controls': props.id + '-page-' + tab[0],
            tabIndex: props.active === tab[0] ? 0 : -1,
            className: 'nnk-tab' + (props.active === tab[0] ? ' nnk-active' : ''),
            onClick: function () { props.setActive(tab[0]) },
            onKeyDown: function (ev) {
              var next = ev.key === 'ArrowRight' ? (index + 1) % tabs.length : ev.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : -1;
              if (next < 0) return;
              ev.preventDefault(); props.setActive(tabs[next][0]);
              nav.current.querySelectorAll('button')[next].focus();
            }
          }, tab[1]);
        })
      );
    }


    function h(type, props) {
      var children = Array.prototype.slice.call(arguments, 2);
      var className = props && props.className || '';
      if (typeof className !== 'string') className = '';
      var iconLabel = children.length === 1 && typeof children[0] === 'string' ? children[0] : '';
      if (type === 'button' && /^(?:↑|↓|✕|📋|🗑)$/u.test(iconLabel) && !(props && props['aria-label'])) {
        props = Object.assign({}, props, { 'aria-label': props && props.title || ({ '↑': '上移技能', '↓': '下移技能', '✕': '关闭', '📋': '任务列表', '🗑': '删除注意点' })[iconLabel] });
      }
      // 仅装饰 UI 文字；代码、日志、用户正文及所有控件属性均原样传递。
      var decorate = type === 'button' || type === 'label' || /(?:^| )nnk-(?:tab|label|hint|err|ok|panel-title|group-title|modal-title|badge|seat-state|ui-text)(?: |$)/.test(className);
      if (decorate && !(props && props['data-nnk-literal']) && typeof visualIcons === 'function') children = children.map(visualIcons);
      return React.createElement.apply(React, [type, props].concat(children));
    }
    // e(tag, className, ...children):className 为字符串(可为空串);子元素数量不限。
    function e(tag, className) {
      /* e 仅接受 tag、className 和子节点；检测误传的 props 对象并提示改用 h，避免把样式对象作为 React 子节点。 */
      var kids = Array.prototype.slice.call(arguments, 2);
      if (kids.length && kids[0] && typeof kids[0] === 'object' && !Array.isArray(kids[0]) && !kids[0].$$typeof) {
        console.error('[联机助手] e() 手滑:第 3 个参数是对象,已按 props 处理(该用 h)——', tag, className, Object.keys(kids[0]), new Error('e').stack);
        var shifted = Object.assign({ className: className }, kids[0]);
        return h.apply(null, [tag, shifted].concat(kids.slice(1)));
      }
      var props = className ? { className: className } : {};
      return h.apply(null, [tag, props].concat(kids));
    }

    // 仅展示层：输入节点常驻，折叠状态不进入表单数据或提交文本。
    function fieldLabelParts(label) {
      if (typeof label !== 'string') return label;
      var at = label.search(/[（(]/);
      if (at < 0) return label;
      return [label.slice(0, at), h('span', { key: 'detail', className: 'nnk-label-detail' }, label.slice(at))];
    }

    function FormField(props) {
      var appearance = useAppearance();
      var foldedState = React.useState(false), folded = foldedState[0], setFolded = foldedState[1];
      var root = React.useRef(null), control = React.useRef(null);
      var id = 'nnk-field-' + React.useId(), bodyId = id + '-body';
      var hidden = props.foldable && folded && appearance === 'modern';
      React.useEffect(function () {
        return appearanceBus.sub(function (value) {
          var active = appearanceBus.focusTarget;
          if (value === 'modern' && active && root.current && root.current.contains(active) && active.matches('input,textarea,select')) setFolded(false);
        });
      }, []);
      React.useEffect(function () {
        var body = document.getElementById(bodyId);
        return function () {
          var entry = body && skillMotion.get(body);
          if (entry) finishSkillMotion(body, entry);
        };
      }, [bodyId]);
      var toggle = function () {
        control.current.focus({ preventScroll: true });
        prepareSkillMotion(bodyId);
        setFolded(function (previous) { return !previous });
      };
      var input = React.cloneElement(props.children, { id: id, 'aria-label': props.label });
      var label = h('label', { className: 'nnk-label', htmlFor: id, onClick: function (ev) {
        if (props.foldable && appearance === 'modern') { ev.preventDefault(); toggle() }
      } }, fieldLabelParts(props.label));
      if (!props.foldable) return h('div', { ref: root, className: 'nnk-field' + (props.compact ? ' nnk-field-compact' : ''), 'data-nnk-field': props.fieldKey }, label, input);
      var value = String(props.value || '');
      return h('div', { ref: root, className: 'nnk-field nnk-description', 'data-nnk-field': props.fieldKey },
        h('div', { className: 'nnk-description-head' }, label,
          h('button', {
            ref: control, type: 'button', className: 'nnk-description-toggle',
            'aria-label': (folded ? '展开' : '收起') + props.label, 'aria-expanded': !folded, 'aria-controls': bodyId,
            onClick: toggle
          }, h('span', { className: 'nnk-skill-chevron', 'aria-hidden': true }))
        ),
        h('div', { id: bodyId, className: 'nnk-skill-body nnk-description-body' + (folded ? ' nnk-skill-closed' : ''), 'data-nnk-description': true },
          h('div', { className: 'nnk-description-editor', inert: hidden ? '' : undefined, 'aria-hidden': hidden || undefined }, input),
          h('div', { className: 'nnk-description-summary', 'aria-hidden': !hidden || undefined, 'data-nnk-literal': true },
            h('span', { className: 'nnk-description-excerpt' }, value || props.children.props.placeholder || ''))
        )
      );
    }

    function textField(label, value, onChange, opts) {
      opts = opts || {};
      var key = /任务ID/.test(label) ? 'taskId' : /扩展包名称/.test(label) ? 'folder' : /^(武将|卡牌|模式)名称/.test(label) ? 'title' : /^ID 前缀/.test(label) ? 'idPrefix' : /基本信息/.test(label) ? 'charInfo' : /核心玩法/.test(label) ? 'brief' : /胜利条件/.test(label) ? 'winConfig' : 'reference';
      var compact = /^(taskId|folder|title|idPrefix)$/.test(key);
      return h(FormField, { key: key, fieldKey: key, label: label, value: value, compact: compact, foldable: !compact },
        h('textarea', {
          className: 'nnk-textarea' + (opts.code ? ' nnk-code' : ''),
          value: value,
          placeholder: opts.placeholder || '',
          onChange: function (ev) { onChange(ev.target.value) },
        })
      );
    }


    // Shared presentation shell: closing a dialog only calls its existing UI close action.
    function ModalFrame(props) {
      var maskRef = React.useRef(null);
      var dialogRef = React.useRef(null);
      var closeRef = React.useRef(props.onClose);
      closeRef.current = props.onClose;
      function isTop() {
        var masks = document.querySelectorAll('.nnk-modal-mask');
        return masks.length && masks[masks.length - 1] === maskRef.current;
      }
      React.useEffect(function () {
        var before = document.activeElement, dialog = dialogRef.current;
        function keepFocus(ev) { if (dialog && isTop() && !dialog.contains(ev.target)) dialog.focus({ preventScroll: true }) }
        function keepKeys(ev) { if (dialog && !dialog.contains(ev.target)) onKeyDown(ev) }
        document.addEventListener('focusin', keepFocus);
        document.addEventListener('keydown', keepKeys);
        if (dialog && isTop()) dialog.focus({ preventScroll: true });
        return function () {
          document.removeEventListener('focusin', keepFocus);
          document.removeEventListener('keydown', keepKeys);
          var active = document.activeElement;
          if (active && active !== document.body && active.isConnected && !(dialog && dialog.contains(active))) return;
          var masks = document.querySelectorAll('.nnk-modal-mask');
          var top = masks.length ? masks[masks.length - 1] : null;
          var restore = before && before !== document.body && before.isConnected && !before.disabled && before.getClientRects().length ? before : props.returnFocusRef && props.returnFocusRef.current;
          if (restore && restore.isConnected && !restore.disabled && typeof restore.focus === 'function' && (!top || top.contains(restore))) restore.focus({ preventScroll: true });
          else if (top) { var target = top.querySelector('.nnk-modal'); if (target) target.focus({ preventScroll: true }) }
        };
      }, []);
      function onKeyDown(ev) {
        if (!isTop() || ev.isComposing || ev.nativeEvent && ev.nativeEvent.isComposing || ev.keyCode === 229) return;
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeRef.current(); return }
        if (ev.key !== 'Tab') return;
        var dialog = dialogRef.current;
        var items = Array.prototype.filter.call(dialog.querySelectorAll('button,input,textarea,select,a[href],[tabindex]'), function (el) {
          return !el.disabled && el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
        });
        var first = items[0], last = items[items.length - 1], active = document.activeElement, outside = !dialog.contains(active);
        if (!first) { ev.preventDefault(); dialog.focus({ preventScroll: true }); return }
        if (ev.shiftKey && (outside || active === first || active === dialog)) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && (outside || active === last || active === dialog)) { ev.preventDefault(); first.focus(); }
      }
      return h('div', { className: 'nnk-modal-mask', ref: maskRef, onKeyDown: onKeyDown, onClick: function (ev) { if (ev.target === ev.currentTarget && isTop()) closeRef.current() } },
        h('div', { className: 'nnk-modal', ref: dialogRef, role: 'dialog', 'aria-modal': true, 'aria-label': props.title, tabIndex: -1 },
          h('button', { type: 'button', className: 'nnk-modal-close nnk-modern-only', 'aria-label': '收起', title: '收起', onClick: function () { if (isTop()) closeRef.current() } }, '✕'),
          props.children));
    }


    function renderRadioGroup(scope, label, value, options, onChange) {
      return h('div', { className: 'nnk-choices', 'data-nnk-choice': label },
        e('label', 'nnk-label', fieldLabelParts(label)),
        h('div', { className: 'nnk-radios', role: 'radiogroup', 'aria-label': label,
          onKeyDown: function (ev) {
            if (!ev.target || ev.target.type !== 'radio') return;
            var radios = Array.prototype.slice.call(ev.currentTarget.querySelectorAll('input[type=radio]'));
            var index = radios.indexOf(ev.target), next = -1;
            if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = (index + 1) % options.length;
            if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = (index + options.length - 1) % options.length;
            if (ev.key === 'Home') next = 0;
            if (ev.key === 'End') next = options.length - 1;
            if (next < 0) return;
            ev.preventDefault(); onChange(options[next].value); radios[next].focus();
          }
        }, options.map(function (opt) {
          var on = value === opt.value;
          return h('label', { key: opt.value, className: 'nnk-radio' + (on ? ' nnk-radio-on' : '') },
            h('input', { type: 'radio', name: scope + ':' + label, className: 'nnk-radio-input', checked: on, onChange: function () { onChange(opt.value) } }),
            opt.text
          );
        }))
      );
    }

    // 表单分组卡片:标题 + 内容容器(纯视觉,不裹数据)
    function formGroup(title, kids) {
      return h('div', { className: 'nnk-group' },
        e('div', 'nnk-group-title', title),
        h('div', null, kids)
      );
    }

    // ── 任务表单:武将区 / 卡牌区 ──────────────────────────────────
    function NewTaskForm(props) {
      var send = props.send;
      var state = React.useState({
        mode: 'new', type: 'character', folder: '我的扩展', taskId: '', title: '', idPrefix: '',
        charInfo: '', skills: [{ name: '', desc: '', audios: '' }], image: '', dieAudios: '', usedIds: [], notes: [],
        pileJoin: false, pileRows: [{ suit: 'spade', point: '' }],
        style: 'classic', writeMode: 'auto',
        reference: '', busy: false, err: '',
        extList: [], extLoading: false, currentInfo: '',
        goal: 'create', entryId: '', entryList: [], entryLoading: false, editNotes: '', addSkills: false,
        entrySkills: [], entrySkillsLoading: false, pickedSkills: [],
        // 🎲 新玩法(自定义模式)专属字段
        brief: '', numConfig: '5', numCustom: '', winConfig: '', rules: ''
      });
      // pickedSkills = [{ id, name, note }]:勾选的技能 + 用户当场写的修改内容
      var form = state[0], setForm = state[1];
      var skillViewState = React.useState({ ids: [1], serial: 1, folded: {} });
      var skillView = skillViewState[0], setSkillView = skillViewState[1];
      var appearanceState = React.useState(function () { return typeof appearanceBus === 'undefined' ? 'classic' : appearanceBus.value });
      var appearance = appearanceState[0];
      React.useEffect(function () {
        if (typeof appearanceBus === 'undefined') return;
        return appearanceBus.sub(function (value) {
          appearanceState[1](value);
          // 经典里正在编辑的技能切回新版时保持可见，避免把焦点控件设为 inert。
          var active = appearanceBus.focusTarget;
          var body = active && active.closest && active.closest('.nnk-skill-body');
          if (value === 'modern' && body && body.id.indexOf(skillScope + '-') === 0) {
            var id = body.id.slice((skillScope + '-').length);
            setSkillView(function (prev) { if (!prev.folded[id]) return prev; var folded = Object.assign({}, prev.folded); folded[id] = false; return Object.assign({}, prev, { folded: folded }) });
          }
        });
      }, []);
      var skillScopeState = React.useState(function () { return typeof document === 'undefined' ? 'fixture' : 'skills-' + (++skillScopeSerial) });
      var skillScope = skillScopeState[0];
      // Each mounted form owns its native radio groups; choices within one group share a name.
      function radioGroup(label, value, options, onChange) {
        return renderRadioGroup(skillScope, label, value, options, onChange);
      }
      var set = function (key) { return function (v) { setForm(function (prev) { var next = {}; next[key] = v; return Object.assign({}, prev, next) }) } };
      var patch = function (p) { setForm(function (prev) { return Object.assign({}, prev, p) }) };

      var genTaskId = function (folder, avoid) {
        avoid = avoid || [];
        return fetch('/noname-kit-api/tasks').then(function (r) { return r.json() }).then(function (body) {
          var n = (body.tasks || []).filter(function (t) { return t.folder === folder }).length + 1;
          var used = {};
          avoid.forEach(function (id) { used[id] = true });
          var cand = folder + '-' + String(n).padStart(2, '0');
          while (used[cand]) { n += 1; cand = folder + '-' + String(n).padStart(2, '0') }
          return cand;
        }, function () { return folder + '-' + Date.now().toString().slice(-4) });
      };

      var switchMode = function (mode) {
        // 🎲 mode 类型两种目标都支持:新建 = 从零生成模式;编辑 = 修改已生成的模式包
        var goal = (form.type === 'mode' && mode === 'edit') ? 'edit' : 'create';
        patch({ mode: mode, goal: goal, err: '', currentInfo: '', usedIds: [], notes: [],
          entryId: '', entryList: [], entrySkills: [], pickedSkills: [], editNotes: '', addSkills: false });
        if (mode === 'edit' && form.extList.length === 0 && !form.extLoading) {
          patch({ extLoading: true });
          fetch('/noname-kit-api/history').then(function (r) { return r.json() }).then(function (body) {
            setForm(function (prev) { return Object.assign({}, prev, { extLoading: false, extList: (body.extensions || []).map(function (x) { return x.folder }) }) });
          }, function () { setForm(function (prev) { return Object.assign({}, prev, { extLoading: false, err: '扩展包列表获取失败' }) }) });
        }
      };

      // 「编辑已有武将/卡牌」:列出目标包内条目(锚点/无锚老包通吃)。
      // 竞态守卫:快速连切(包/类型/条目)时,先发后至的旧响应必须丢弃。
      // 判定写在函数式更新里比对「当前状态 vs 请求参数」——组件体重渲染会重建
      // 局部变量,靠 ++seq 计数守不住(例如:切包 A→B 后 A 的迟到响应
      // 把条目列表整个换成 A 的);比对状态天然跨渲染有效。
      var loadEntries = function (folder, kind) {
        // mode 类型没有条目下拉(服务端 /entries 只认 character/card),不发必败请求、不清包信息提示
        if (!folder || (kind !== 'character' && kind !== 'card')) { patch({ entryList: [], entryId: '', entryLoading: false, entrySkills: [], pickedSkills: [] }); return }
        patch({ entryLoading: true });
        fetch('/noname-kit-api/entries?folder=' + encodeURIComponent(folder) + '&kind=' + kind).then(function (r) { return r.json() }).then(function (b) {
          setForm(function (prev) {
            if (prev.folder !== folder || prev.type !== kind || prev.goal !== 'edit') return prev; // 该响应已过期
            return Object.assign({}, prev, {
              entryLoading: false,
              entryList: b.ok ? (b.entries || []) : [],
              entryId: '',
              entrySkills: [], pickedSkills: [],
              currentInfo: b.ok ? '' : '❌ ' + (b.error || '条目列表加载失败')
            });
          });
        }, function () {
          setForm(function (prev) {
            if (prev.folder !== folder || prev.type !== kind || prev.goal !== 'edit') return prev;
            return Object.assign({}, prev, { entryLoading: false, entryList: [], entryId: '', entrySkills: [], pickedSkills: [], currentInfo: '❌ 条目列表加载失败' });
          });
        });
      };

      // 选中条目后:拉取该武将/卡牌 skills 数组里的技能(勾选候选)
      // 守卫同 loadEntries:响应回来时条目已不是它,就整条丢弃
      var loadEntrySkills = function (folder, entryId) {
        patch({ entrySkillsLoading: true });
        fetch('/noname-kit-api/entry-skills?folder=' + encodeURIComponent(folder) + '&id=' + encodeURIComponent(entryId)).then(function (r) { return r.json() }).then(function (b) {
          setForm(function (prev) {
            if (prev.entryId !== entryId) return prev; // 该响应已过期
            return Object.assign({}, prev, { entrySkillsLoading: false, entrySkills: b.ok ? (b.skills || []) : [], pickedSkills: [] });
          });
        }, function () {
          setForm(function (prev) {
            if (prev.entryId !== entryId) return prev;
            return Object.assign({}, prev, { entrySkillsLoading: false, entrySkills: [], pickedSkills: [] });
          });
        });
      };

      var pickEntry = function (id) {
        // entrySkillsLoading 一并归零:选了「— 选择条目 —」(空)时不会有新请求来收尾,
        // 上一次的加载态会永远挂着(守卫丢弃旧响应后没人再清它)
        setForm(function (prev) { return Object.assign({}, prev, { entryId: id, pickedSkills: [], entrySkills: [], editNotes: '', entrySkillsLoading: false }) });
        if (id) loadEntrySkills(form.folder, id);
      };

      var togglePicked = function (id, name) {
        var has = form.pickedSkills.some(function (p) { return p.id === id });
        patch({ pickedSkills: has ? form.pickedSkills.filter(function (p) { return p.id !== id }) : form.pickedSkills.concat([{ id: id, name: name, note: '' }]) });
      };

      var setPickedNote = function (id, note) {
        patch({ pickedSkills: form.pickedSkills.map(function (p) { return p.id === id ? Object.assign({}, p, { note: note }) : p }) });
      };

      var switchGoal = function (goal) {
        patch({ goal: goal, entryId: '', err: '', currentInfo: '', entrySkills: [], pickedSkills: [], editNotes: '' });
        if (goal === 'edit') loadEntries(form.folder, form.type);
      };

      var switchType = function (t) {
        // 🎲 mode 在编辑模式下目标恒为「编辑已有」(修改已生成的模式包)
        var patchBody = { type: t, entryId: '', entrySkills: [], pickedSkills: [], editNotes: '', addSkills: false };
        if (t === 'mode' && form.mode === 'edit' && form.goal !== 'edit') patchBody.goal = 'edit';
        setForm(function (prev) { return Object.assign({}, prev, patchBody) });
        if (form.mode === 'edit' && form.goal === 'edit') loadEntries(form.folder, t);
      };

      var pickExisting = function (folder) {
        patch({ folder: folder, currentInfo: '', usedIds: [], entryId: '', entryList: [], entrySkills: [], pickedSkills: [], editNotes: '', addSkills: false });
        if (!folder) return;
        if (form.goal === 'edit') loadEntries(folder, form.type);
        // 仅在响应所属扩展仍被选中时更新信息、风格、已用 ID 和注意点，防止切包后的迟到响应覆盖当前表单。
        fetch('/noname-kit-api/extension?folder=' + encodeURIComponent(folder)).then(function (r) { return r.json() }).then(function (body) {
          setForm(function (prev) {
            if (prev.folder !== folder) return prev;
            if (body.error) return Object.assign({}, prev, { currentInfo: '读取失败: ' + body.error });
            var lines = body.code ? body.code.split('\n').length : 0;
            var style = body.code && body.code.indexOf('game.import(') >= 0 ? 'classic' : 'module';
            return Object.assign({}, prev, {
              currentInfo: '✅ ' + folder + ':约 ' + lines + ' 行,' + style + '写法',
              style: style,
            });
          });
        }, function () {
          setForm(function (prev) { return prev.folder !== folder ? prev : Object.assign({}, prev, { currentInfo: '读取失败' }) });
        });
        // 已用任务ID + 历史注意点:登记处(进行中/已完成)+ 该包归档历史,合并去重
        fetch('/noname-kit-api/tasks').then(function (r) { return r.json() }).then(function (reg) {
          var used = (reg.tasks || []).filter(function (t) { return t.folder === folder })
            .map(function (t) { return { id: t.id, state: t.status === 'done' ? '已完成' : '进行中' } });
          return fetch('/noname-kit-api/history?folder=' + encodeURIComponent(folder)).then(function (r) { return r.json() }).then(function (hb) {
            ((hb.history && hb.history.tasks) || []).forEach(function (t) {
              if (t.taskId && !used.some(function (u) { return u.id === t.taskId })) used.push({ id: t.taskId, state: '已归档' });
            });
            return { used: used, notes: (hb.history && hb.history.notes) || [] };
          });
        }).then(function (r2) {
          setForm(function (prev) { return prev.folder !== folder ? prev : Object.assign({}, prev, { usedIds: r2.used, notes: r2.notes }) });
        }, function () { /* 拉不到就不显示,不挡流程 */ });
      };

      // 锚点化迁移:只由用户手动触发,给无锚老文件建立区块索引(只加注释行,不改代码)
      var migrateFolder = function () {
        if (!form.folder || !form.currentInfo || form.currentInfo.indexOf('读取失败') >= 0) { patch({ err: '请先选择扩展包并确认可读取' }); return }
        patch({ busy: true, currentInfo: '正在建立区块索引…' });
        fetch('/noname-kit-api/blocks/migrate', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ folder: form.folder }),
        }).then(function (r) { return r.json() }).then(function (b) {
          patch({ busy: false, currentInfo: b.ok
            ? '✅ 区块索引已建立:' + b.totalFiles + ' 个文件 / ' + b.totalBlocks + ' 个区块,插入 ' + b.totalInserted + ' 行锚点注释' + (b.totalCommas ? '(另补 ' + b.totalCommas + ' 个收尾逗号)' : '') + ';各文件原版已备份到同目录 backup/' + (b.filesSkipped ? '(跳过 ' + b.filesSkipped + ' 个无条目文件)' : '')
            : '❌ ' + (b.error || '建立失败') });
        }, function (e) { patch({ busy: false, currentInfo: '❌ 建立失败: ' + (e && e.message || e) }) });
      };

      // 技能列表行:{ name, desc, audios }(audios = 配音源路径,逗号分隔的原始输入)
      var addSkill = function () {
        setSkillView(function (prev) { return { ids: prev.ids.concat([prev.serial + 1]), serial: prev.serial + 1, folded: prev.folded } });
        patch({ skills: form.skills.concat([{ name: '', desc: '' }]) });
      };
      var removeSkill = function (idx) {
        var skills = form.skills.filter(function (row, i) { return i !== idx });
        setSkillView(function (prev) {
          var folded = Object.assign({}, prev.folded); delete folded[prev.ids[idx]];
          return { ids: prev.ids.filter(function (id, i) { return i !== idx }), serial: prev.serial, folded: folded };
        });
        patch({ skills: skills });
      };
      var moveSkill = function (idx, dir) {
        var skills = form.skills.slice();
        var j = idx + dir;
        if (j < 0 || j >= skills.length) return;
        var tmp = skills[idx]; skills[idx] = skills[j]; skills[j] = tmp;
        setSkillView(function (prev) { var ids = prev.ids.slice(), id = ids[idx]; ids[idx] = ids[j]; ids[j] = id; return Object.assign({}, prev, { ids: ids }) });
        patch({ skills: skills });
      };
      var setSkill = function (idx, key) { return function (v) {
        var skills = form.skills.slice();
        skills[idx] = Object.assign({}, skills[idx]); skills[idx][key] = v;
        patch({ skills: skills });
      }; };

      var submit = function () {
        var isEdit = form.mode === 'edit';
        var editingExisting = isEdit && form.goal === 'edit';
        var isMode = form.type === 'mode';
        var isModeCreate = isMode && !editingExisting;
        var filledSkills = form.skills.filter(function (s) { return s.name.trim() || s.desc.trim() });
        var errSet = function (msg) { setForm(function (prev) { return Object.assign({}, prev, { err: msg }) }) };
        if (isModeCreate) {
          if (!form.folder.trim()) { errSet('目标扩展文件夹不能为空'); return }
          if (!form.brief.trim()) { errSet('请填写一句话核心玩法'); return }
          if (!form.rules.trim()) { errSet('请填写玩法细节描述(至少一条规则)'); return }
        } else if (editingExisting) {
          if (!form.folder.trim()) { errSet('目标扩展文件夹不能为空'); return }
          var entryLabel = form.type === 'mode' ? '规则/条目' : (form.type === 'card' ? '卡牌' : '武将');
          if (form.type !== 'mode' && !form.entryId) { errSet('请先选择要修改的' + entryLabel); return }
          var emptyNote = form.pickedSkills.filter(function (p) { return !p.note.trim() }).map(function (p) { return p.name || p.id });
          if (emptyNote.length) { errSet('勾选的技能要填写修改内容: ' + emptyNote.join('、')); return }
          var addSkillFilled = form.addSkills && form.type === 'character' && form.skills.some(function (s) { return s.name.trim() || s.desc.trim() });
          var modeRulesFilled = isMode && form.rules.trim();
          if (!form.editNotes.trim() && !form.pickedSkills.length && !addSkillFilled && !modeRulesFilled) { errSet('请勾选要修改的技能、填写改动描述,或选「新增技能」——至少填一项'); return }
        } else {
          if (!filledSkills.length) { errSet('请至少填写一个技能(技能名和效果至少填一处)'); return }
          if (!form.folder.trim()) { errSet('目标扩展文件夹不能为空'); return }
          /* 按当前 form.type 校验卡牌牌堆条目，避免读取尚未赋值的局部 type。 */
          if (form.type === 'card' && form.pileJoin && !form.pileRows.some(function (r) { return r.point !== '' })) { errSet('选了「加入牌堆」但没填任何牌的花色点数——至少填一行,或改选「不加入牌堆」'); return }
        }
        var dupUsed = isEdit && form.taskId.trim() && (form.usedIds || []).some(function (u) { return u.id === form.taskId.trim() });
        if (dupUsed) { errSet('任务ID「' + form.taskId.trim() + '」此包已用过,请换一个'); return }
        setForm(function (prev) { return Object.assign({}, prev, { busy: true, err: '' }) });

        var type = form.type;
        // 配音源路径:逗号/分号/换行分隔,一条到多条随意(服务端截到 10 条)
        var splitAudioPaths = function (v) {
          return String(v || '').split(/[,，;；\n]/).map(function (t) { return t.trim() }).filter(Boolean).slice(0, 10);
        };
        var skills = isMode && !editingExisting
          ? []
          : editingExisting
          ? [].concat(
              form.editNotes.trim() ? [{ name: form.type === 'mode' ? '模式包调整' : '修改 ' + form.entryId, desc: form.editNotes.trim() }] : [],
              form.pickedSkills.map(function (p) { return { name: p.name || p.id, desc: p.note.trim() } }),
              form.addSkills && type === 'character'
                ? form.skills.filter(function (s) { return s.name.trim() || s.desc.trim() }).map(function (s) { return { name: s.name.trim(), desc: s.desc.trim(), audios: splitAudioPaths(s.audios) } })
                : [],
              isMode && form.rules.trim() ? [{ name: '模式规则调整', desc: form.rules.trim() }] : []
            )
          : (type === 'character'
          ? form.skills.filter(function (s) { return s.name.trim() || s.desc.trim() }).map(function (s) { return { name: s.name.trim(), desc: s.desc.trim(), audios: splitAudioPaths(s.audios) } })
          : [{ name: form.title.trim() || '新卡牌', desc: (form.skills[0] && form.skills[0].desc ? form.skills[0].desc.trim() : '') }]);
        var dieAudioList = (type === 'character' && !editingExisting) ? splitAudioPaths(form.dieAudios) : [];

        // 游戏目录随任务消息下发给 AI(persona complete:true 会压掉插件 systemPrompt,
        // systemPrompt 里的环境小节到不了模型——任务消息是唯一保证可见的通道)
        var settingsP = fetch('/noname-kit-api/settings').then(function (r) { return r.json() }, function () { return {} });
        var ensureId = form.taskId.trim()
          ? Promise.resolve(form.taskId.trim())
          : genTaskId(form.folder.trim(), (form.usedIds || []).map(function (u) { return u.id }));
        Promise.all([ensureId, settingsP]).then(function (arr) {
          var taskId = arr[0];
          var settings = arr[1] || {};
          var gameDir = settings.nonameDir || '';
          var gameDirPosix = gameDir.replace(/^([A-Za-z]):[\\/]/, function (m, d) { return '/' + d.toLowerCase() + '/' }).replace(/\\/g, '/');
          var pile = type === 'card' && form.pileJoin
            ? { join: true, entries: form.pileRows.filter(function (r) { return r.point !== '' }).map(function (r) { return r.suit + ' ' + r.point }).join('\n') }
            : { join: false, entries: '' };
          return fetch('/noname-kit-api/tasks', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: taskId, folder: form.folder.trim(), type: type, title: form.title.trim(), charInfo: form.charInfo.trim(), pile: pile, skills: skills, image: form.image.trim(), dieAudios: dieAudioList, target: editingExisting ? { kind: type, id: form.entryId } : null, writeMode: form.writeMode, modeBrief: isMode ? form.brief.trim() : '', modeNum: isMode ? (form.numConfig === 'custom' ? (form.numCustom || 'custom') : form.numConfig) : '', modeWin: isMode ? form.winConfig.trim() : '', modeRules: isMode ? form.rules.trim() : '' }),
          }).then(function (r) { return r.json() }).then(function (reg) {
            if (!reg.ok) throw new Error(reg.error || '任务注册失败');
            // gameDir/gameDirPosix 必须随 ctx 传给下一个 then(各自独立作用域,
            // 跨回调直接引用会 ReferenceError: gameDir is not defined)
            return { taskId: taskId, pile: pile, gameDir: gameDir, gameDirPosix: gameDirPosix };
          });
        }).then(function (ctx2) {
          var taskId = ctx2.taskId;
          var pile = ctx2.pile;
          var gameDir = ctx2.gameDir || '';
          var gameDirPosix = ctx2.gameDirPosix || '';
          var skillLines = skills.map(function (s, i) { return (i + 1) + '. ' + s.name + (s.desc ? ':' + s.desc : '') }).join('\n');
          // 配音区块:只列登记了配音的技能;目标文件名由 AI 按内部 ID 命名(此处不知道 ID)
          var audioLines = skills.filter(function (s) { return s.audios && s.audios.length })
            .map(function (s) { return '- ' + s.name + '(' + s.audios.length + ' 句): ' + s.audios.join('、') }).join('\n');
          var audioBlock = audioLines
            ? '── 配音(技能发动语音,只放扩展包内 audio/,禁止动本体目录) ──\n' + audioLines +
              '\n技能代码必须写 audio: "ext:' + form.folder.trim() + '/audio/skill:<句数>"(如两句就是 :2;禁止写不带 ext: 的 audio,那会去游戏本体目录找文件)。' +
              '实现完成后用 noname_copy_audio 把每句复制为 audio/skill/<技能内部ID><序号>.mp3(序号从 1 连号,句数与 audio 字段一致),调用时带上任务ID与归属技能名(任务里的技能显示名)。'
            : '';
          var dieAudioBlock = dieAudioList.length
            ? '── 阵亡语音(零代码,引擎自动播放) ──\n文件: ' + dieAudioList.join('、') +
              '\n实现完成后用 noname_copy_audio 复制为 audio/die/<武将内部ID>.mp3(多句:<ID>1.mp3、<ID>2.mp3…)。' +
              '扩展武将的阵亡语音由引擎默认自动查找,武将代码无需写任何字段;调用时带任务ID,target 以 die/ 开头。'
            : '';
          var pileText;
          if (type === 'card' && pile.join && pile.entries) pileText = '加入牌堆,条目(每行「花色 点数」;花色只允许 spade/heart/club/diamond/none,none=无花色):\n' + pile.entries;
          else if (type === 'card') pileText = '不加入牌堆(仅作技能素材牌)';
          else pileText = '(武将无牌堆)';
          var text;
          if (isMode && !editingExisting) {
            text = [
              '【无名杀工坊·新任务】',
              '任务ID: ' + taskId,
              '任务性质: 创建全新扩展包(含一个自定义游戏模式;目标文件夹当前不存在,需要从零创建 extension.js 与 info.json)',
              '类型: 🎲 新玩法(自定义游戏模式,用 game.addMode 注册为独立模式)',
              (form.title.trim() ? '模式名称(显示名,注册为模式翻译): ' + form.title.trim() : ''),
              '写入方式: ' + (form.writeMode === 'manual' ? '手动复制(只生成代码,不要写文件)' : '自动写入'),
              '目标扩展文件夹: ' + form.folder.trim(),
              (gameDir ? '游戏目录(所有读写的根;bash 里写作 ' + gameDirPosix + '): ' + gameDir : ''),
              '一句话核心玩法: ' + form.brief.trim(),
              '游戏人数: ' + (form.numConfig === 'custom' ? (form.numCustom || '?') + ' 人(用户自定义)' : form.numConfig + ' 人(玩家 1 名,其余 AI 补位)'),
              '胜利条件: ' + (form.winConfig.trim() || '用户未单独填写,以玩法细节描述为准,有歧义先问'),
              '── 玩法细节(用户原话,逐条理解,不得增删主规则) ──',
              form.rules.trim(),
              form.reference.trim() ? '── 用户提供的参考代码 ──\n' + form.reference.trim() : '',
              '── 执行要求(确认协议,逐步执行)──',
              '第 0 步【引擎版本探测 + 需求理解确认·硬门禁】:先探测用户游戏引擎版本(读游戏目录 version 文件或 noname 源码特征)并报告给用户;版本相关的 API 写法(模式注册/选将原语/距离与摸牌修正/技能显示过滤等)必须先查「版本差异对照表」或读引擎源码核实,禁止凭记忆或固定版本经验猜测。然后把玩法细节逐条拆成规则模块,输出【需求理解确认】(每条规则:触发时机/数值/边界;另含:玩法一句话复述/人数与先手规则/胜利条件/明确不做什么/实现骨架自查——模式注册时机/选将方式/技能挂载方式/距离与摸牌修正写法均按对照表选定)。输出后停下等待用户明确回复确认。',
              '有任何歧义必须先用 ask_user_question 提问;禁止猜测。ask_user_question 的回答只消除歧义、不算确认——澄清后把最终确认单呈现给用户,仍须等待用户明确回复「确认」后才能动笔。',
              '未获用户确认前,禁止生成代码、禁止调用 noname_write_extension。',
              '用户确认后按骨架清单实现(规范见 knowledge 的「自定义模式生成规范」与版本对照表;内部规则技不留 translate 名——十周年UI 的竖排会显示有翻译名的技能),校验通过后一次写入,调用 noname_skills_written 原样带回任务ID ' + taskId + ' 与规则节点名(每个规则模块一个节点名,用户逐条确认后自动收口)。',
              form.idPrefix.trim() ? '内部 ID 命名规则:模式名/新增技能的内部 ID 必须 = 「' + form.idPrefix.trim() + '」前缀 + 拼音或英文,中文显示名写入 translate(内部规则技除外——不留 translate 名)。' : '',
            ].filter(Boolean).join('\n');
          } else if (editingExisting) {
            var newSkillRows = form.addSkills && type === 'character'
              ? form.skills.filter(function (s) { return s.name.trim() || s.desc.trim() }).map(function (s) { return { name: s.name.trim(), desc: s.desc.trim() } })
              : [];
            var pickedSkillRows = form.pickedSkills;
            var entryFile = (form.entryList.filter(function (en) { return en.id === form.entryId })[0] || {}).file || 'extension.js';
            text = [
              '【无名杀工坊·编辑任务】',
              '任务ID: ' + taskId,
              '任务性质: 编辑已有扩展包(已存在)',
              (type === 'mode' ? '包性质: 这是一个自定义模式扩展包(game.addMode 注册)。版本相关写法先查「1.9.0 实测对照表」或读引擎源码核实;新增或调整的内部规则技不留 translate 名(十周年UI 竖排会显示有翻译名的技能);新增内部 ID 沿用该包现有的前缀惯例(读现有代码时留意)。' : ''),
              '类型: ' + (type === 'mode' ? '🎲 新玩法(自定义游戏模式)' : type === 'card' ? '卡牌' : '武将'),
              (type === 'mode' ? '编辑目标: 整个模式扩展包(骨架与规则技,按需求描述与版本对照表改动,其他任务无关的包不动)' : '编辑目标条目: ' + type + ':' + form.entryId + '(所在文件 ' + entryFile + (entryFile !== 'extension.js' ? ',read/write 都要传 file 参数' : '') + ';只改这个条目' + (pickedSkillRows.length ? '及其勾选技能' : '') + (newSkillRows.length ? ';新增技能作为新区块加到该条目上' : '') + ',其他武将/卡牌/技能/翻译一律不动)'),
              (form.title.trim() ? '新名称(显示名,写入 translate;留空即不改名): ' + form.title.trim() : ''),
              '写入方式: ' + (form.writeMode === 'manual' ? '手动复制(只生成代码,不要写文件)' : '自动写入'),
              '目标扩展文件夹: ' + form.folder.trim() + '(已有扩展,老式/新式写法跟随现有代码)',
              (gameDir ? '游戏目录(所有读写的根;bash 里写作 ' + gameDirPosix + '): ' + gameDir : ''),
              (form.notes && form.notes.length ? '该包有历史注意点 ' + form.notes.length + ' 条(过往任务实测结论):与本任务相关时才用 noname_read_extension 传 notes:true 拉取,无关条目忽略,与需求冲突时以需求为准。' : ''),
              (form.editNotes.trim() ? '── ' + (type === 'mode' ? '模式骨架与规则改动' : (type === 'card' ? '卡牌' : '武将') + '改动(条目本身:体力/护甲/名称等)') + ' ──\n' + form.editNotes.trim() : ''),
              (type === 'mode' && form.rules.trim() ? '── 新增或调整的规则(用户逐条写的改动要求,确认单按改动前后逐项列) ──\n' + form.rules.trim() : ''),
              (pickedSkillRows.length ? '── 修改技能(用户逐技能写明的改动要求) ──\n' + pickedSkillRows.map(function (p, i) { return (i + 1) + '. ' + p.name + '(内部ID ' + p.id + '):' + p.note.trim() }).join('\n') : ''),
              (newSkillRows.length ? '── 新增技能(加到目标' + (type === 'card' ? '卡牌' : '武将') + '上,按顺序实现) ──\n' + newSkillRows.map(function (s, i) { return (i + 1) + '. ' + s.name + (s.desc ? ':' + s.desc : '') }).join('\n') : ''),
              '── 任务技能节点(收口时 noname_skills_written 的 skills 参数必须逐字使用这些名称) ──\n' + skills.map(function (s) { return '- ' + s.name }).join('\n'),
              form.reference.trim() ? '── 用户提供的参考代码 ──\n' + form.reference.trim() : '',
              form.image.trim() ? '── 图片 ──\n用户已提供图片路径: ' + form.image.trim() + '\n实现完成后用 noname_copy_images 复制进扩展包 image/ 目录,按目标条目ID(' + form.entryId + ')命名文件,调用时带上任务ID。' : '',
              (audioBlock || ''),
              '── 执行要求(确认协议,逐步执行)──',
              type === 'mode' ? '第 0 步【需求理解确认·硬门禁】:先探测引擎版本并报告;noname_read_extension 读整个扩展包现状(必要时 listBlocks 看区块目录),把现状与用户需求逐条对照,输出【需求理解确认】(逐条规则:改动前→改动后/触发时机/数值/边界/影响面;另含:明确不做什么)。输出后停下等待用户明确回复确认。' : '第 0 步【需求理解确认·硬门禁】:先 noname_read_extension 按块只读目标条目原文(' + (entryFile !== 'extension.js' ? 'file:\'' + entryFile + '\', ' : '') + 'block:\'' + type + ':' + form.entryId + '\')' + (pickedSkillRows.length ? '与各勾选技能原文(block:\'skill:<技能ID>\'' + (entryFile !== 'extension.js' ? ';技能可能在其他文件,用 listBlocks 定位后带对应 file' : '') + ')' : '') + '(定位不准时先传 listBlocks 看区块目录,多文件包的目录每项带 file 归属),把原文与需求对照,逐项输出【需求理解确认】(' + (form.editNotes.trim() ? '条目项:改什么 / 改动前→改动后 / 影响面' : '') + (form.editNotes.trim() && pickedSkillRows.length ? ';' : '') + (pickedSkillRows.length ? '修改技能项:改动前→改动后' : '') + ((pickedSkillRows.length || form.editNotes.trim()) && newSkillRows.length ? ';' : '') + (newSkillRows.length ? '新增技能按新技能模板逐条:触发/频率/目标/数值/边界' : '') + ')。输出后停下等待用户明确回复确认。',
              '有任何歧义必须先用 ask_user_question 提问;禁止猜测。ask_user_question 的回答只消除歧义、不算确认——澄清后把最终确认单呈现给用户,仍须等待用户明确回复「确认」后才能动笔。',
              '未获用户确认前,禁止生成代码、禁止调用 noname_write_extension。',
              (type === 'mode' ? '用户确认后动手:已有内容的改动只落在与本次需求相关的模式骨架/规则技区块' : '用户确认后动手:已有内容的改动只落在目标条目' + (pickedSkillRows.length ? '与其勾选技能' : '') + '对应区块') + '(noname_write_extension' + (entryFile !== 'extension.js' ? ' 带 file:\'' + entryFile + '\'' : '') + ',用 blocks 组装或 edits 精确补丁,严禁全文重写)' + (newSkillRows.length ? ';新增技能作为新区块插入(锚点包裹,内部 ID 用下方前缀规则)' : '') + ',除上述区块与新增区块外严禁改动任何其他区块。noname_validate 通过后一次写入,调用 noname_skills_written 原样带回任务ID ' + taskId + '。',
              (newSkillRows.length && form.idPrefix.trim() ? '内部 ID 命名规则:新增技能的内部 ID 必须 = 「' + form.idPrefix.trim() + '」前缀 + 拼音或英文,中文显示名写入 translate。' : ''),
            ].filter(Boolean).join('\n');
          } else if (isEdit) {
            text = [
              '【无名杀工坊·编辑任务】',
              '任务ID: ' + taskId,
              '任务性质: 编辑已有扩展包(已存在)',
              '类型: ' + (type === 'mode' ? '🎲 新玩法(自定义游戏模式)' : type === 'card' ? '卡牌' : '武将(含 ' + skills.length + ' 个技能)'),
              (form.title.trim() ? '名称(显示名,写入 translate): ' + form.title.trim() : ''),
              '写入方式: ' + (form.writeMode === 'manual' ? '手动复制(只生成代码,不要写文件)' : '自动写入'),
              '目标扩展文件夹: ' + form.folder.trim() + '(已有扩展,老式/新式写法跟随现有代码)',
              (gameDir ? '游戏目录(所有读写的根;bash 里写作 ' + gameDirPosix + '): ' + gameDir : ''),
              (form.charInfo.trim() ? '── 武将/卡牌基本信息(势力/体力/性别等)──\n' + form.charInfo.trim() : ''),
              (form.notes && form.notes.length ? '该包有历史注意点 ' + form.notes.length + ' 条(过往任务实测结论):与本任务相关时才用 noname_read_extension 传 notes:true 拉取,无关条目忽略,与需求冲突时以需求为准。' : ''),
              '── 技能/卡牌清单(按顺序实现) ──',
              skillLines,
              '── 牌堆 ──',
              pileText,
              form.reference.trim() ? '── 用户提供的参考代码 ──\n' + form.reference.trim() : '',
              form.image.trim() ? '── 图片 ──\n用户已提供图片路径: ' + form.image.trim() + '\n实现完成后用 noname_copy_images 复制进扩展包 image/ 目录,按 武将ID/卡牌ID 命名文件,调用时带上任务ID。' : '',
              (audioBlock || ''),
              (dieAudioBlock || ''),
              '── 执行要求(确认协议,逐步执行)──',
              '第 0 步【需求理解确认·硬门禁】:先 noname_read_extension 读取当前代码(大文件先传 listBlocks 看区块目录,再按 block:\'skill:ID\' 只读涉及的块),然后逐技能输出【需求理解确认】(每个技能一条:触发/频率/目标/数值/边界)。输出后停下等待用户明确回复确认。',
              '有任何歧义必须先用 ask_user_question 提问;禁止猜测。ask_user_question 的回答只消除歧义、不算确认——澄清后把最终确认单呈现给用户,仍须等待用户明确回复「确认」后才能动笔。',
              '未获用户确认前,禁止生成代码、禁止调用 noname_write_extension。',
              '用户确认后按顺序逐技能实现(每技能:noname_search_reference 搜参考→写→noname_validate),校验通过后一次写入,调用 noname_skills_written 原样带回任务ID ' + taskId + '。',
              form.idPrefix.trim() ? '内部 ID 命名规则:新增技能/武将/卡牌的内部 ID 必须 = 「' + form.idPrefix.trim() + '」前缀 + 拼音或英文,中文显示名写入 translate。' : '',
            ].filter(Boolean).join('\n');
          } else {
            text = [
              '【无名杀工坊·新任务】',
              '任务ID: ' + taskId,
              '任务性质: 创建全新扩展包(目标文件夹当前不存在,需要从零创建 extension.js 与 info.json)',
              '类型: ' + (type === 'card' ? '卡牌' : '武将(含 ' + skills.length + ' 个技能)'),
              (form.title.trim() ? '名称(显示名,写入 translate): ' + form.title.trim() : ''),
              '写法: ' + (form.style === 'module' ? '新版 ES Module' : '老版 game.import'),
              '写入方式: ' + (form.writeMode === 'manual' ? '手动复制(只生成代码,不要写文件)' : '自动写入'),
              '目标扩展文件夹: ' + form.folder.trim(),
              (gameDir ? '游戏目录(所有读写的根;bash 里写作 ' + gameDirPosix + '): ' + gameDir : ''),
              form.charInfo.trim() ? '── 基本信息 ──\n' + form.charInfo.trim() : '',
              '── 技能/卡牌清单(按顺序实现) ──',
              skillLines,
              '── 牌堆 ──',
              pileText,
              form.reference.trim() ? '── 用户提供的参考代码 ──\n' + form.reference.trim() : '',
              form.image.trim() ? '── 图片 ──\n用户已提供图片路径: ' + form.image.trim() + '\n实现完成后用 noname_copy_images 复制进扩展包 image/ 目录,按 武将ID/卡牌ID 命名文件,调用时带上任务ID。' : '',
              (audioBlock || ''),
              (dieAudioBlock || ''),
              '── 执行要求(确认协议,逐步执行)──',
              '第 0 步【需求理解确认·硬门禁】:逐技能输出【需求理解确认】(每个技能一条:触发/频率/目标/数值/边界)。输出后停下等待用户明确回复确认。',
              '有任何歧义必须先用 ask_user_question 提问;禁止猜测。ask_user_question 的回答只消除歧义、不算确认——澄清后把最终确认单呈现给用户,仍须等待用户明确回复「确认」后才能动笔。',
              '未获用户确认前,禁止生成代码、禁止调用 noname_write_extension。',
              '用户确认后按顺序逐技能实现(每技能:noname_search_reference 搜参考→写→noname_validate),校验通过后一次写入,调用 noname_skills_written 原样带回任务ID ' + taskId + '。',
              form.idPrefix.trim() ? '内部 ID 命名规则:所有新增技能/武将/卡牌的内部 ID 必须 = 「' + form.idPrefix.trim() + '」前缀 + 拼音或英文(如 ' + form.idPrefix.trim() + 'tianfa),中文显示名写入 translate——防止跨扩展包命名冲突。' : '',
            ].filter(Boolean).join('\n');
          }
          return Promise.resolve(send(text)).then(function () {
            setForm(function (prev) { return Object.assign({}, prev, { busy: false, reference: '', taskId: '' }) });
          });
        }).catch(function (error) {
          setForm(function (prev) { return Object.assign({}, prev, { busy: false, err: error && error.message || String(error) }) });
        });
      };

      var isEdit = form.mode === 'edit';
      var editingExisting = isEdit && form.goal === 'edit';
      var isModeCreate = form.type === 'mode' && !editingExisting;
      // 技能列表编辑器(创建新武将 / 编辑已有+新增技能 共用)
      var skillRows = function () {
        return [
          e('label', 'nnk-label', fieldLabelParts('技能列表(按此顺序逐个实现;可增删、排序)')),
          form.skills.map(function (s, idx) {
            var id = skillView.ids[idx], folded = !!skillView.folded[id];
            var hidden = appearance === 'modern' && folded, bodyId = skillScope + '-' + id;
            return h('div', { key: id, className: 'nnk-card nnk-skill', style: { padding: '8px', marginBottom: '6px' } },
              h('div', { className: 'nnk-skill-head' },
                h('b', { style: { fontSize: '12px' } }, '技能 ' + (idx + 1)),
                h('button', {
                  type: 'button', className: 'nnk-skill-toggle', 'aria-expanded': !folded, 'aria-controls': bodyId,
                  'aria-label': (folded ? '展开' : '收起') + '技能 ' + (idx + 1),
                  onClick: function () { if (typeof prepareSkillMotion === 'function') prepareSkillMotion(bodyId); setSkillView(function (prev) { var next = Object.assign({}, prev.folded); next[id] = !next[id]; return Object.assign({}, prev, { folded: next }) }) }
                }, h('span', { className: 'nnk-skill-chevron', 'aria-hidden': true }),
                  e('span', 'nnk-skill-number', String(idx + 1).padStart(2, '0')),
                  h('span', { className: 'nnk-skill-title', 'data-nnk-literal': true }, s.name || ('技能 ' + (idx + 1)))),
                h('button', { className: 'nnk-smallbtn', onClick: function () { moveSkill(idx, -1) }, disabled: idx === 0 }, '↑'),
                h('button', { className: 'nnk-smallbtn', onClick: function () { moveSkill(idx, 1) }, disabled: idx === form.skills.length - 1 }, '↓'),
                h('button', { className: 'nnk-smallbtn', onClick: function () { removeSkill(idx) }, disabled: form.skills.length <= 1, 'aria-label': '删除技能 ' + (idx + 1) }, '✕')
              ),
              h('div', { id: bodyId, className: 'nnk-skill-body' + (s.desc ? ' nnk-description-body' : '') + (folded ? ' nnk-skill-closed' : ''), 'data-nnk-description': s.desc ? true : undefined },
                h('div', { className: 'nnk-skill-inner nnk-description-editor', inert: hidden ? '' : undefined, 'aria-hidden': hidden || undefined }, h('div', { className: 'nnk-skill-fields' },
              h('input', { className: 'nnk-input', value: s.name, placeholder: '技能名(显示名,例: 挥砍)', style: { marginBottom: '4px' }, onChange: function (ev) { setSkill(idx, 'name')(ev.target.value) } }),
              h('textarea', { className: 'nnk-textarea', style: { minHeight: '60px' }, value: s.desc, placeholder: '效果:触发/频率/目标/数值/边界', onChange: function (ev) { setSkill(idx, 'desc')(ev.target.value) } }),
              h('input', { className: 'nnk-input', value: s.audios || '', placeholder: '配音文件(可选;本地 mp3 路径,多句用逗号分隔)——复制进包内 audio/skill/ 后按 内部ID1.mp3、内部ID2.mp3 编号', style: { marginTop: '4px' }, onChange: function (ev) { setSkill(idx, 'audios')(ev.target.value) } })
                )),
                s.desc ? h('div', { className: 'nnk-description-summary', 'aria-hidden': !hidden || undefined, 'data-nnk-literal': true }, h('span', { className: 'nnk-description-excerpt' }, s.desc)) : null
              )
            );
          }),
          h('button', { className: 'nnk-smallbtn', onClick: addSkill }, '➕ 添加技能')
        ];
      };
      try {
      return h('div', { className: 'nnk-card nnk-task-form' },
        e('div', 'nnk-task-heading', h('b', null, isEdit ? '编辑已有扩展包' : '创建新扩展包'), h('span', { className: 'nnk-hint' }, '　任务粒度:' + (form.type === 'mode' ? '一个完整的自定义游戏模式' : '一个完整武将(含全部技能)或一张卡牌'))),
        h('div', { className: 'nnk-form-fields' },
        radioGroup('模式', form.mode, [{ value: 'new', text: '🆕 创建新扩展包' }, { value: 'edit', text: '📂 编辑已有扩展包' }], switchMode),
        textField('任务ID(留空自动按「文件夹名-序号」生成;反馈时用它精准定位)', form.taskId, set('taskId'), { placeholder: '例: my-pack-01' }),
        isEdit && form.taskId.trim() && (form.usedIds || []).some(function (u) { return u.id === form.taskId.trim() })
          ? e('div', 'nnk-err', '⚠️ 任务ID「' + form.taskId.trim() + '」此包已用过,请换一个')
          : null,
        isEdit
          ? [e('label', 'nnk-label', '选择已有扩展包' + (form.extLoading ? '(加载中…)' : '')),
             form.extList.length === 0 && !form.extLoading ? e('div', 'nnk-hint', '没有可选的扩展包(游戏 extension 目录为空或未配置游戏路径)') : null,
             h('select', { className: 'nnk-input', value: form.folder, onChange: function (ev) { pickExisting(ev.target.value) } },
               [h('option', { key: '', value: '' }, '— 选择扩展包 —')].concat(form.extList.map(function (f) {
                 return h('option', { key: f, value: f }, f)
               }))),
             form.folder ? h('button', { className: 'nnk-smallbtn', disabled: form.busy, onClick: migrateFolder, title: '给条目所在的 .js 文件插入锚点注释行,启用区块化读写(防抄错+省 token);一个代码字符都不会改,且会先自动备份。多文件包(条目在子目录模块)会对每个含条目的文件逐一处理' }, '🔨 建立区块索引') : null,
             form.currentInfo ? e('div', 'nnk-hint', form.currentInfo) : null,
             form.folder && form.usedIds && form.usedIds.length
               ? e('div', 'nnk-hint', '已用任务ID: ' + form.usedIds.map(function (u) { return u.id + '(' + u.state + ')' }).join('、') + ' —— 新任务请避开这些')
               : (form.folder ? e('div', 'nnk-hint', '此包暂无任务记录') : null)]
          : [textField('新扩展包名称(游戏 extension/ 下的文件夹名)', form.folder, set('folder'))],
        radioGroup('类型', form.type, [{ value: 'character', text: '⚔️ 武将' }, { value: 'card', text: '🃏 卡牌' }, { value: 'mode', text: '🎲 新玩法(自定义模式)' }], switchType),
        // 模式任务固定编辑选中的现有扩展包，目标选择由 switchMode 与 switchType 统一设置。
        isEdit && form.type !== 'mode' ? radioGroup('目标', form.goal, [{ value: 'create', text: '✨ 创建新' }, { value: 'edit', text: '✏️ 编辑已有' }], switchGoal) : null,
        isModeCreate ? [
          e('div', 'nnk-hint', '🎲 以全新扩展包交付,生成后可随时在「📂 编辑已有扩展包」里继续调整。'),
          textField('一句话核心玩法(这是什么玩法?)', form.brief, set('brief'), { placeholder: '例: 无身份混战大逃杀,每个玩家独立求生' }),
          radioGroup('游戏人数', form.numConfig, [{ value: '2', text: '2 人' }, { value: '3', text: '3 人' }, { value: '4', text: '4 人' }, { value: '5', text: '5 人' }, { value: '6', text: '6 人' }, { value: '7', text: '7 人' }, { value: '8', text: '8 人' }, { value: 'custom', text: '自定义' }], set('numConfig')),
          form.numConfig === 'custom' ? h('div', { style: { marginBottom: '8px' } },
            e('label', 'nnk-label', '自定义人数(2~20;多于 8 人时 UI 座位排布以游戏引擎实际表现为准)'),
            h('input', { className: 'nnk-input', type: 'number', min: 2, max: 20, value: (form.numCustom === '' || form.numCustom === undefined) ? '' : form.numCustom, placeholder: '例: 12', onChange: function (ev) { set('numCustom')(ev.target.value) } })
          ) : null,
                    textField('胜利条件(可选;不填则以玩法细节为准)', form.winConfig, set('winConfig'), { placeholder: '例: 场上只剩 1 人时结算,幸存者获胜' }),
          h(FormField, { fieldKey: 'rules-create', label: '玩法细节描述(自由描述所有规则:特殊机制/阶段效果/阵营/限制…越具体,AI 的确认单越准)', value: form.rules, foldable: true },
          h('textarea', { className: 'nnk-textarea', style: { minHeight: '120px' }, value: form.rules, placeholder: '例: 全场按 冬→春→夏→秋 每 3 轮轮换季节;准备阶段强制执行当季效果——冬:少摸一张牌或流失1点体力;春:多摸一张牌或回复1点体力…', onChange: function (ev) { set('rules')(ev.target.value) } })),
          e('div', 'nnk-hint', '提交后 AI 会先探测你的游戏引擎版本、把描述逐条拆成规则并给出【需求理解确认】;回复「确认」后生成完整模式。生成后进游戏实测,逐条规则点「确认无误」自动收口。')
        ] : null,
        editingExisting ? [
          form.type !== 'mode' ? e('label', 'nnk-label', '编辑目标(选择要修改的' + (form.type === 'card' ? '卡牌' : '武将') + ')' + (form.entryLoading ? '(加载中…)' : '')) : null,
          form.type !== 'mode' ? h('select', { className: 'nnk-input', value: form.entryId, onChange: function (ev) { pickEntry(ev.target.value) } },
            [h('option', { key: '', value: '' }, '— 选择要修改的' + (form.type === 'card' ? '卡牌' : '武将') + ' —')].concat(form.entryList.map(function (en) {
              var tag = en.file && en.file !== 'extension.js' ? ' · ' + en.file.replace(/\.js$/, '') : '';
              return h('option', { key: en.id, value: en.id }, en.id + (en.name ? '(' + en.name + ')' : '') + tag)
            }))) : null,
          !form.entryLoading && form.entryList.length === 0 && form.type !== 'mode'
            ? e('div', 'nnk-hint', '此包没有检测到可编辑的' + (form.type === 'card' ? '卡牌' : '武将') + '(若确实有,先点「🔨 建立区块索引」或确认该包有 extension.js)')
            : null,
          form.entryId && form.entrySkills.length ? [
            e('label', 'nnk-label', '该' + (form.type === 'card' ? '卡牌' : '武将') + '的技能(勾选要修改的并在框里写清改成什么;不勾 = 不改技能)' + (form.entrySkillsLoading ? '(加载中…)' : '')),
            h('div', {}, form.entrySkills.map(function (en) {
              var picked = form.pickedSkills.filter(function (p) { return p.id === en.id })[0];
              return h('div', { key: en.id, style: { marginBottom: '6px' } },
                h('label', { className: 'nnk-radio' },
                  h('input', { type: 'checkbox', checked: !!picked, onChange: function () { togglePicked(en.id, en.name) } }),
                  en.id + (en.name ? '(' + en.name + ')' : '')
                ),
                picked ? h('input', { className: 'nnk-input', style: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: '4px' }, value: picked.note, placeholder: '要改成什么(必填),例: 伤害 1 改为 2,每回合限一次', onChange: function (ev) { setPickedNote(en.id, ev.target.value) } }) : null
              );
            }))
          ] : null,
          form.entryId && !form.entrySkillsLoading && !form.entrySkills.length
            ? e('div', 'nnk-hint', '未从该条目解析出技能清单(技能改动可直接写进下面的改动描述,由 AI 在确认阶段澄清)')
            : null,
          h(FormField, { fieldKey: 'editNotes', label: form.type === 'mode'
            ? '模式骨架改动(要改什么:开局流程/人数/胜利条件/规则增删等;可选)'
            : form.type === 'card'
              ? '卡牌改动描述(条目本身的变化:类别/花色点数/名称等;可选)'
              : '武将改动描述(条目本身的变化:体力/护甲/名称等;可选)', value: form.editNotes, foldable: true },
          h('textarea', { className: 'nnk-textarea', style: { minHeight: '80px' }, value: form.editNotes, placeholder: form.type === 'mode' ? '例: 人数上限改成 12;胜利条件改为计分制,先到 100 分获胜' : form.type === 'card' ? '例: 类别改为锦囊牌,花色点数改为黑桃 5;卡面描述同步修改' : '例: 初始体力信息改为 3/4/1(3 点体力、4 点上限、1 点护甲);显示名保持不变', onChange: function (ev) { set('editNotes')(ev.target.value) } })),
          form.type === 'mode' ? [h(FormField, { fieldKey: 'rules-edit', label: '新增或调整的规则(可选;AI 会先读现有代码,确认单按改动前后逐项列)', value: form.rules, foldable: true }, h('textarea', { className: 'nnk-textarea', style: { minHeight: '80px' }, value: form.rules, placeholder: '例: 新增一条规则——雪天全场武力-1;秋季距离修正改为无视坐骑只对玩家生效', onChange: function (ev) { set('rules')(ev.target.value) } }))] : null,
                    form.type === 'character' ? radioGroup('是否新增技能', form.addSkills ? 'yes' : 'no', [{ value: 'no', text: '不新增' }, { value: 'yes', text: '新增技能(填下面的技能列表)' }], function (v) { patch({ addSkills: v === 'yes' }) }) : null,
          form.addSkills && form.type === 'character' ? skillRows() : null
        ] : null,
        textField(form.type === 'mode' ? '模式名称(显示名,注册为模式翻译)' : (form.type === 'card' ? '卡牌名称' : '武将名称') + (editingExisting ? '(新显示名,可选;留空 = 不改名)' : '(显示名,会写入 translate)'), form.title, set('title'), { placeholder: form.type === 'mode' ? '例: 季节乱斗' : (form.type === 'card' ? '例: 疾风符' : '例: 凌霜') }),
        (editingExisting && !(form.addSkills && form.type === 'character')) ? null : textField('ID 前缀(防止与其他扩展包的技能/武将/卡牌重名;可选但强烈建议)', form.idPrefix, set('idPrefix'), { placeholder: '例: cs_ (则内部 ID 形如 cs_tianfa)' }),
        !editingExisting && form.type === 'character' ? textField('武将基本信息(势力、体力、性别…;可选)', form.charInfo, set('charInfo'), { placeholder: '例:群势力,3 体力,男性,风格偏辅助' }) : null,
        form.type === 'mode' ? null : h('div', { key: 'img', className: 'nnk-field' },
          e('label', 'nnk-label', fieldLabelParts('图片路径(武将立绘/卡牌图;可选)')),
          h('input', { className: 'nnk-input', value: form.image, placeholder: '例: D:\\pic\\hero.png —— AI 复制进扩展包 image/ 后按 ID 命名', onChange: function (ev) { set('image')(ev.target.value) } })
        ),
        !editingExisting && form.type === 'character' ? h('div', { key: 'dieaudio', className: 'nnk-field' },
          e('label', 'nnk-label', fieldLabelParts('阵亡语音文件(可选;本地 mp3,多句逗号分隔)')),
          h('input', { className: 'nnk-input', value: form.dieAudios, placeholder: '例: D:\\audio\\die1.mp3 —— 复制进扩展包 audio/die/ 后按武将ID命名,引擎自动播放', onChange: function (ev) { set('dieAudios')(ev.target.value) } })
        ) : null,
        (editingExisting || form.type === 'mode') ? null : (form.type === 'character' ? skillRows() : [
          h(FormField, { fieldKey: 'card-effect', label: '卡牌效果', value: form.skills[0].desc, foldable: true },
          h('textarea', { className: 'nnk-textarea', value: form.skills[0].desc, placeholder: '效果:类型/花色点数需求/效果/边界', onChange: (function () {
            return function (ev) {
              var skills = form.skills.slice();
              if (!skills[0]) skills[0] = { name: '', desc: '' };
              skills[0] = Object.assign({}, skills[0]); skills[0].desc = ev.target.value;
              patch({ skills: skills });
            };
          })() }))
        ]),
        isEdit ? e('div', 'nnk-hint', '写法将自动跟随现有代码(选中扩展包后会显示检测结果)。') : (form.type === 'mode' ? e('div', 'nnk-hint', '🎲 新玩法使用新版 ES Module 写法(模式注册依赖新版引擎机制)。') : radioGroup('写法版本', form.style, [{ value: 'classic', text: '老版 game.import' }, { value: 'module', text: '新版 ES Module' }], set('style'))),
        !editingExisting && form.type === 'card' ? [
          e('label', 'nnk-label', '是否加入牌堆'),
          radioGroup('加入牌堆', form.pileJoin ? 'yes' : 'no', [{ value: 'no', text: '不加入牌堆' }, { value: 'yes', text: '加入牌堆(选择花色点数)' }], function (v) { patch({ pileJoin: v === 'yes' }) }),
          form.pileJoin ? h('div', {},
            form.pileRows.map(function (row, idx) {
              return h('div', { key: idx, style: { display: 'flex', gap: '6px', marginBottom: '4px' } },
                h('select', { className: 'nnk-input', style: { width: '110px' }, value: row.suit, onChange: (function (idx2) { return function (ev) {
                  var rows = form.pileRows.slice(); rows[idx2] = Object.assign({}, rows[idx2]); rows[idx2].suit = ev.target.value;
                  patch({ pileRows: rows });
                } })(idx) },
                  h('option', { value: 'spade' }, '黑桃 ♠'),
                  h('option', { value: 'heart' }, '红桃 ♥'),
                  h('option', { value: 'club' }, '梅花 ♣'),
                  h('option', { value: 'diamond' }, '方块 ♦'),
                  h('option', { value: 'none' }, '无花色')
                ),
                h('input', { className: 'nnk-input', style: { width: '60px' }, type: 'number', min: 1, max: 13, value: row.point, placeholder: '点数', onChange: (function (idx2) { return function (ev) {
                  var rows = form.pileRows.slice(); rows[idx2] = Object.assign({}, rows[idx2]); rows[idx2].point = ev.target.value;
                  patch({ pileRows: rows });
                } })(idx) }),
                h('button', { className: 'nnk-smallbtn', disabled: form.pileRows.length <= 1, 'aria-label': '删除牌堆行 ' + (idx + 1), onClick: function () { patch({ pileRows: form.pileRows.filter(function (r, i2) { return i2 !== idx }) }) } }, '✕')
              );
            }),
            h('button', { className: 'nnk-smallbtn', onClick: function () { patch({ pileRows: form.pileRows.concat([{ suit: 'spade', point: '' }]) }) } }, '➕ 加一张')
          ) : null
        ] : null,
        radioGroup('写入方式', form.writeMode, [{ value: 'auto', text: '自动写入(校验通过后直接落盘)' }, { value: 'manual', text: '手动复制(只生成代码)' }], set('writeMode')),
        textField('示例参考代码(你找到的想模仿的官方实现;可选)', form.reference, set('reference'), { code: true, placeholder: '粘贴官方技能代码,AI 会优先参考它的写法' }),
        ),
        h('div', { className: 'nnk-submit-area' },
        form.err ? e('div', 'nnk-err', form.err) : null,
        h('button', { className: 'nnk-submit', disabled: form.busy, onClick: submit }, form.busy ? '已发送…' : (isEdit ? '发给 AI 修改' : '发给 AI 开工')),
        e('div', 'nnk-hint', '提交后 AI 会逐技能给出【需求理解确认】并停下等待——回复「确认」后才会动笔写代码;有歧义它会先问你。')
        )
      );
      } catch (renderError) {
        return e('div', 'nnk-err', '表单渲染错误: ' + (renderError && renderError.message || renderError));
      }
    }


    // ── 历史面板 ────────────────────────────────────────────────
    function HistoryPanel() {
      var state = React.useState({ loading: true, extensions: [], detail: null, msg: '' });
      var data = state[0], setData = state[1];
      var load = function () {
        fetch('/noname-kit-api/history').then(function (r) { return r.json() }).then(function (body) {
          setData({ loading: false, extensions: body.extensions || [], detail: null, msg: body.error || '' })
        }, function () { setData({ loading: false, extensions: [], detail: null, msg: '历史服务不可用(需配置 nonameDir 并重启)' }) });
      };
      React.useEffect(function () { load() }, []);
      var openDetail = function (folder) {
        fetch('/noname-kit-api/history?folder=' + encodeURIComponent(folder)).then(function (r) { return r.json() }).then(function (body) {
          setData(function (prev) { return Object.assign({}, prev, { detail: body }) })
        }, function () {
          setData(function (prev) { return Object.assign({}, prev, { msg: '读取备份详情失败(历史服务不可用)' }) });
        });
      };
      var rollback = function (folder, backup) {
        if (!window.confirm('把 ' + backup + ' 回滚为当前版本?当前版本会先自动备份。')) return;
        fetch('/noname-kit-api/rollback', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ folder: folder, backup: backup }),
        }).then(function (r) { return r.json() }).then(function (body) {
          setData(function (prev) { return Object.assign({}, prev, { msg: body.ok ? '已回滚 ' + backup : ('回滚失败: ' + body.error) }) });
          openDetail(folder);
        }, function () {
          setData(function (prev) { return Object.assign({}, prev, { msg: '回滚请求失败(历史服务不可用),未执行回滚' }) });
        });
      };
      var pruneBackupsNow = function (folder) {
        setData(function (prev) { return Object.assign({}, prev, { pruning: true, msg: '' }) });
        fetch('/noname-kit-api/backups/prune', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ folder: folder }),
        }).then(function (r) { return r.json() }).then(function (b) {
          setData(function (prev) { return Object.assign({}, prev, { pruning: false, msg: b.ok ? '已清理 ' + b.removedCount + ' 个旧备份(每个 backup/ 保留最新 3 个)' : ('清理失败: ' + b.error) }) });
          openDetail(folder);
        }, function () {
          setData(function (prev) { return Object.assign({}, prev, { pruning: false, msg: '清理请求失败' }) });
        });
      };
      var deleteNote = function (folder, index) {
        fetch('/noname-kit-api/history/note-delete', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ folder: folder, index: index }),
        }).then(function (r) { return r.json() }).then(function (body) {
          setData(function (prev) { return Object.assign({}, prev, { msg: body.ok ? '已删除注意点' : ('删除失败: ' + body.error) }) });
          openDetail(folder);
        }, function (error) { setData(function (prev) { return Object.assign({}, prev, { msg: '删除失败: ' + (error && error.message || error) }) }) });
      };

      if (data.loading) return e('div', 'nnk-hint', '加载中…');
      if (data.msg && data.extensions.length === 0) return e('div', 'nnk-err', data.msg);
      var fmt = function (ts) { return new Date(ts).toLocaleString() };

      return h('div', { className: 'nnk-history' },
        data.msg ? e('div', 'nnk-ok', data.msg) : null,
        // 详情卡片放列表上方:点「备份/注意点」后立即可见(列表很长时沉底等于没反应)
        data.detail ? (function () {
          var detail = data.detail, backups = detail.backups || [];
          return h('div', { className: 'nnk-card nnk-history-detail', ref: function (el) {
            if (el && !el.__nnkScrolled) { el.__nnkScrolled = true; el.scrollIntoView({ behavior: motionPreference && motionPreference.matches ? 'instant' : 'smooth', block: 'nearest' }) }
          } },
            h('b', null, '备份与注意点: ' + detail.folder),
            backups.length ? [
              e('div', 'nnk-hint', '点击备份名把 extension.js 回滚到该时点(回滚前当前版会先自动备份):'),
              h('div', {}, backups.map(function (b) {
                return h('button', { key: b, className: 'nnk-copy', style: { marginRight: '8px', marginBottom: '4px' }, onClick: function () { rollback(detail.folder, b) } }, '⏪ ' + b)
              }))
            ] : e('div', 'nnk-hint', '该包还没有备份——每次覆盖写入前都会自动生成一份。'),
            h('div', { style: { marginTop: '8px' } },
              h('button', { className: 'nnk-smallbtn', disabled: !!data.pruning, onClick: function () { pruneBackupsNow(detail.folder) } },
                data.pruning ? '清理中…' : '🧹 清理旧备份(每个 backup/ 保留最新 3 个)')),
            (detail.history && detail.history.notes && detail.history.notes.length) ? [
              e('div', 'nnk-label', '注意点清单(无关/过时的单条删除,AI 仅按需拉取)'),
              detail.history.notes.map(function (n, i) {
                return h('div', { key: i, className: 'nnk-history-note', style: { display: 'flex', gap: '6px', alignItems: 'flex-start', marginBottom: '4px' } },
                  e('div', 'nnk-note', n),
                  h('button', { className: 'nnk-smallbtn', onClick: function () { deleteNote(detail.folder, i) } }, '🗑')
                )
              })
            ] : null
          );
        })() : null,
        h('div', { className: 'nnk-card nnk-history-overview' },
          e('b', null, '扩展总览'),
          data.extensions.length === 0 ? e('div', 'nnk-hint', '还没有记录:完成第一个任务后这里会出现历史。') : null,
          data.extensions.map(function (ext) {
            return h('div', { key: ext.folder, className: 'nnk-taskrow' },
              h('div', { className: 'nnk-history-heading' },
                h('b', null, ext.folder),
                h('span', { className: 'nnk-badge', style: { marginLeft: '8px' } }, ext.taskCount + ' 个任务'),
                h('span', { className: 'nnk-badge' }, '累计 ' + ext.totalRounds + ' 轮'),
                ext.backupCount ? h('span', { className: 'nnk-badge' }, ext.backupCount + ' 备份') : null
              ),
              ext.lastTask ? e('div', 'nnk-taskmeta', '最近: [' + (ext.lastTask.kind === 'card' ? '卡牌' : ext.lastTask.kind === 'mode' ? '模式' : '武将') + '] ' + ext.lastTask.summary + ' · ' + fmt(ext.lastTask.at)) : null,
              h('button', { className: 'nnk-copy', onClick: function () { openDetail(ext.folder) } }, '📦 备份/注意点')
            );
          })
        )
      );
    }

    // ── 设置面板(⚙ 子页):游戏目录 / AI 输出阀门 / 关于 ─────────
    function SettingsPanel() {
      var settingsScope = React.useId();
      var state = React.useState({ loading: true, version: '', nonameDir: '', source: 'none', bashMax: 64000, bashMaxK: '64', updateCheck: true, manual: '', scanning: false, scanned: false, candidates: [], extensions: [], busy: false, healthBusy: false, msg: '', err: '', healthMsg: '', healthErr: '' });
      var form = state[0], setForm = state[1];
      var set = function (patch) { setForm(function (prev) { return Object.assign({}, prev, patch) }) };
      var load = function () {
        fetch('/noname-kit-api/settings').then(function (r) { return r.json() }).then(function (s) {
          var bytes = s.bashMaxOutputBytes || 64000;
          set({ loading: false, version: s.version || '', nonameDir: s.nonameDir || '', source: s.source || 'none', extensions: s.extensions || [], bashMax: bytes, bashMaxK: String(Math.round(bytes / 1000)), updateCheck: s.updateCheck !== false });
        }, function () { set({ loading: false, err: '设置服务不可用(插件更新后需重启 DSH)' }) });
      };
      React.useEffect(function () { load() }, []);
      // 版本/一致性状态来自共享的 healthBus(🛠 按钮那份),挂载时刷一次
      var healthState = React.useState(healthBus.state);
      var health = healthState[0], setHealth = healthState[1];
      React.useEffect(function () {
        var off = healthBus.sub(setHealth);
        healthBus.refresh();
        return off;
      }, []);

      var scan = function () {
        set({ scanning: true, err: '' });
        fetch('/noname-kit-api/detect').then(function (r) { return r.json() }).then(function (body) {
          set({ scanning: false, scanned: true, candidates: body.candidates || [] });
        }, function () { set({ scanning: false, err: '扫描失败' }) });
      };
      var saveDir = function (dir) {
        if (!dir || !dir.trim()) { set({ err: '请先填写或选择游戏本体目录' }); return }
        set({ busy: true, err: '', msg: '' });
        fetch('/noname-kit-api/init', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nonameDir: dir.trim() }),
        }).then(function (r) { return r.json() }).then(function (body) {
          if (!body.ok) throw new Error(body.error || '保存失败');
          set({ busy: false, msg: body.adjustedFrom
            ? '✅ 已自动修正:你填的路径结尾多了一层 \\extension,游戏目录已设为上一层 ' + body.nonameDir
            : '✅ 游戏目录已更新: ' + body.nonameDir });
          load();
        }).catch(function (error) { set({ busy: false, err: '保存失败: ' + (error && error.message || error) }) });
      };
      var saveBashMax = function (v) {
        var n = parseInt(v, 10);
        if (!isFinite(n) || n < 64000 || n > 256000) { set({ err: '输出上限需在 64 ~ 256 K 之间' }); return }
        set({ busy: true, err: '', msg: '' });
        fetch('/noname-kit-api/settings', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ bashMaxOutputBytes: n }),
        }).then(function (r) { return r.json() }).then(function (body) {
          if (!body.ok) throw new Error(body.error || '保存失败');
          set({ busy: false, bashMax: body.bashMaxOutputBytes, bashMaxK: String(Math.round(body.bashMaxOutputBytes / 1000)), msg: '✅ 输出上限已保存为 ' + Math.round(body.bashMaxOutputBytes / 1000) + 'K——对新开的会话生效(已开的会话保持不变)' });
        }).catch(function (error) { set({ busy: false, err: '保存失败: ' + (error && error.message || error) }) });
      };
      var checkNow = function () {
        set({ healthBusy: true, healthErr: '', healthMsg: '' });
        fetch('/noname-kit-api/update/check', { method: 'POST' }).then(function (r) { return r.json() }).then(function (body) {
          healthBus.adopt(body);
          var check = body.check || {};
          // link 方式不参与检测,直说,别绕
          set({ healthBusy: false, healthMsg: check.skipped === 'link' ? 'link 方式不参与版本检测' : (check.error ? '' : '✅ 已检查') });
        }, function (error) { set({ healthBusy: false, healthErr: '检查失败: ' + (error && error.message || error) }) });
      };
      var reinstallPreset = function () {
        set({ healthBusy: true, healthErr: '', healthMsg: '' });
        fetch('/noname-kit-api/preset/install', { method: 'POST' }).then(function (r) { return r.json() }).then(function (body) {
          if (!body.ok) throw new Error(body.error || '安装失败');
          healthBus.set({ preset: body.preset || null });
          set({ healthBusy: false, healthMsg: '✅ preset 已重装' + (body.backup ? '(旧版已备份)' : '') + '——对新建会话生效,已开的会话不变' });
        }).catch(function (error) { set({ healthBusy: false, healthErr: '重装失败: ' + (error && error.message || error) }) });
      };
      var toggleUpdateCheck = function () {
        var next = !form.updateCheck;
        set({ busy: true, err: '', msg: '' });
        fetch('/noname-kit-api/settings', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ updateCheck: next }),
        }).then(function (r) { return r.json() }).then(function (body) {
          if (!body.ok) throw new Error(body.error || '保存失败');
          set({ busy: false, updateCheck: body.updateCheck });
          healthBus.set({ updateCheck: body.updateCheck });
        }).catch(function (error) { set({ busy: false, err: '保存失败: ' + (error && error.message || error) }) });
      };

      // 版本与一致性两行:插件本体(能查新版就告知,不自动更新)+ preset 一致性
      var renderUpdateRow = function () {
        var check = health.update;
        var installForm = health.installForm || 'unknown';
        var line;
        if (installForm === 'link') {
          line = e('div', 'nnk-hint', 'link 方式加载的插件不参与版本检测');
        } else if (check && check.error) {
          line = e('div', 'nnk-hint', '检查失败:' + check.error + '(不影响使用,可稍后重试)');
        } else if (check && check.hasUpdate) {
          line = e('div', 'nnk-err', '⬆ 有新版本 v' + check.latest + '(当前 v' + (check.current || form.version) + ',来源 ' + check.source + ')');
        } else if (check) {
          line = e('div', 'nnk-hint', '✅ 已是最新(v' + (check.current || form.version) + ',来源 ' + check.source + ')');
        } else if (!form.updateCheck) {
          line = e('div', 'nnk-hint', '启动时自动检查已关闭,尚未检查过。');
        } else {
          line = e('div', 'nnk-hint', '尚未检查(点右侧「检查更新」)。');
        }
        var cmd = check && check.hasUpdate ? (health.installHint || check.installHint) : null;
        return e('div', 'nnk-maintenance-row',
          h('div', {},
            h('b', null, '插件'),
            h('span', { className: 'nnk-hint' }, '　当前 v' + (form.version || '?') + (installForm === 'link' ? ' · link 方式加载' : ''))
          ),
          h('div', {},
            h('button', { className: 'nnk-smallbtn', disabled: form.healthBusy, onClick: checkNow }, form.healthBusy ? '检查中…' : '🔄 检查更新'),
            h('button', { className: 'nnk-smallbtn', disabled: form.busy, onClick: toggleUpdateCheck }, (form.updateCheck ? '☑' : '☐') + ' 启动时自动检查')
          ),
          line,
          cmd ? e('div', 'nnk-hint', '在终端执行(完成后重启 DSH):') : null,
          cmd ? h('div', {}, h('code', { className: 'nnk-cmd' }, cmd)) : null
        );
      };
      var renderPresetRow = function () {
        var preset = health.preset;
        var line;
        if (!health.loaded) line = e('div', 'nnk-hint', '读取中…');
        else if (!preset) line = e('div', 'nnk-hint', '状态不可用(服务端未响应)');
        else if (preset.state === 'declarative') {
          // DSH 0.1.7+:preset 声明在插件 bundle patch 里,随插件加载自动就位、随插件更新
          line = e('div', 'nnk-hint', '✅ 声明式 preset,随插件自动就位——无需安装/重装,改动随插件更新在重启后生效。');
        }
        else if (preset.state === 'ok') line = e('div', 'nnk-hint', '✅ 与插件自带的一致');
        else if (preset.state === 'missing') line = e('div', 'nnk-hint', '⚠️ 未安装——新建会话里选不到「无名杀开发模式」,点右侧重装。');
        else if (preset.state === 'stale') {
          // 只陈述事实(哈希不同)+ 后果(重装会覆盖本地这份),不替用户猜原因 ——
          // "本地被改过"或"插件更新了"都只是可能,猜错反而误导
          var mine = String(preset.installedHash || '').slice(0, 8);
          var theirs = String(preset.bundledHash || '').slice(0, 8);
          line = e('div', 'nnk-hint', '⚠️ 与插件自带的不一致(已装 ' + mine + ' ≠ 插件 ' + theirs + ')。点重装会用插件自带那份覆盖本地这份(先备份)。');
        }
        else line = e('div', 'nnk-hint', '⚠️ ' + (preset.error || '状态未知'));
        var declarative = preset && preset.state === 'declarative';
        return e('div', 'nnk-maintenance-row',
          h('div', {},
            h('b', null, '开发模式 preset'),
            h('span', { className: 'nnk-hint' }, '　AI 的人格、常驻工具名单与技能文档')
          ),
          declarative ? null : h('div', {}, h('button', { className: 'nnk-smallbtn', disabled: form.healthBusy, onClick: reinstallPreset }, '♻️ 重装 preset')),
          line,
          declarative
            ? e('div', 'nnk-hint', '当前 DSH 版本(0.1.7+)的 preset 随插件分发:插件更新即 preset 更新,重启 dsh 生效,不存在漂移。')
            : e('div', 'nnk-hint', 'preset 是插件行为的第二份副本,代码更新后不重装会拿到自相矛盾的指令且不报错,所以单列一行。覆盖前会先备份成 noname-dev.bak-<时间戳>。')
        );
      };

      if (form.loading) return e('div', 'nnk-hint', '加载中…');
      var PRESETS = [['64K', 64000], ['128K', 128000], ['256K', 256000]];
      return h('div', { className: 'nnk-card nnk-settings' },
        form.msg ? e('div', 'nnk-ok', form.msg) : null,
        form.err ? e('div', 'nnk-err', form.err) : null,

        h('section', { className: 'nnk-settings-section' },
        e('div', 'nnk-settings-heading', h('b', null, '游戏目录'), h('span', { className: 'nnk-hint' }, '　AI 自动写入扩展的游戏本体位置——填到能看见 extension 文件夹的那一层(新版结构如 resources/app/src),别把 extension 本身填进路径')),
        e('div', 'nnk-hint', form.nonameDir
          ? '当前: ' + form.nonameDir + '(' + (form.source === 'cordis.yml' ? '由配置文件指定' : '工坊设置') + ')'
          : '⚠️ 未配置——AI 无法自动写入,只能用「手动复制」模式'),
        h('input', { className: 'nnk-input', value: form.manual, placeholder: '填游戏根目录(那一层里能看到 extension 文件夹)', onChange: function (ev) { set({ manual: ev.target.value }) } }),
        h('div', { style: { marginTop: '6px' } },
          h('button', { className: 'nnk-smallbtn', disabled: form.scanning || form.busy, onClick: scan }, form.scanning ? '扫描中…' : (form.scanned ? '🔍 重新扫描本机' : '🔍 自动扫描本机')),
          form.manual.trim() ? h('button', { className: 'nnk-smallbtn', disabled: form.busy, onClick: function () { saveDir(form.manual) } }, '💾 保存所填目录') : null
        ),
        form.scanned && form.candidates.length === 0 ? e('div', 'nnk-hint', '没扫到——游戏在非常规位置就用上面手动填写。') : null,
        form.nonameDir ? e('div', 'nnk-hint', form.extensions.length
          ? '✅ 已连接游戏目录,检测到 ' + form.extensions.length + ' 个扩展包: ' + form.extensions.slice(0, 20).join('、') + (form.extensions.length > 20 ? ' 等' : '')
          : '目录已连接,但 extension/ 下还没有扩展包') : null,
        form.candidates.map(function (dir) {
          return h('label', { key: dir, className: 'nnk-radio', style: { display: 'block', margin: '4px 0', whiteSpace: 'normal' } },
            h('input', { type: 'radio', name: settingsScope + '-candidate', checked: form.manual === dir, onChange: function () { set({ manual: dir }) } }),
            h('span', { className: 'nnk-break' }, dir)
          );
        }),

        ),
        h('section', { className: 'nnk-settings-section' },
        h('div', { className: 'nnk-settings-heading', style: { marginTop: '14px' } }, h('b', null, 'AI 单次命令输出上限'), h('span', { className: 'nnk-hint' }, '　直接影响 token 消耗(新会话生效)')),
        e('div', 'nnk-hint', '控制 AI 每次执行命令/查资料最多往对话里灌多少内容。'),
        h('div', {}, PRESETS.map(function (p) {
          var active = Number(form.bashMax) === p[1];
          return h('button', { key: p[1], className: 'nnk-smallbtn', style: active ? { borderColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)' } : {}, disabled: form.busy, onClick: function () { saveBashMax(p[1]) } }, p[0] + (active ? ' ✓' : ''));
        })),
        h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' } },
          h('input', { className: 'nnk-input', style: { width: '120px' }, type: 'number', min: 64, max: 256, value: form.bashMaxK, onChange: function (ev) { set({ bashMaxK: ev.target.value }) } }),
          e('span', 'nnk-hint', 'K(64 ~ 256)'),
          h('button', { className: 'nnk-smallbtn', disabled: form.busy, onClick: function () { saveBashMax((parseInt(form.bashMaxK, 10) || 0) * 1000) } }, '💾 保存上限')
        ),

        ),
        h('section', { className: 'nnk-settings-section' },
        h('div', { className: 'nnk-settings-heading', style: { marginTop: '14px' } }, h('b', null, '版本与一致性'), h('span', { className: 'nnk-hint' }, '　插件本体与开发模式 preset')),
        form.healthMsg ? e('div', 'nnk-ok', form.healthMsg) : null,
        form.healthErr ? e('div', 'nnk-err', form.healthErr) : null,
        renderUpdateRow(),
        h('div', { style: { marginTop: '12px' } }, renderPresetRow()),

        ),
        h('section', { className: 'nnk-settings-section nnk-settings-about' },
        h('div', { className: 'nnk-settings-heading', style: { marginTop: '14px' } }, h('b', null, '关于')),
        e('div', 'nnk-hint', '无名杀工坊(noname-kit)v' + (form.version || '?') + ' · 「无名杀开发模式」与工坊同属一套,本页设置保存在 ~/.dsh/noname-kit.json')
        )
      );
    }

    // ── 🌐 联机页签:内核状态 + 建房/加入(命令经心跳桥下发游戏内核) ──
    var ONLINE_MODES = [
      { id: 'identity', name: '身份' },
      { id: 'guozhan', name: '国战' },
      { id: 'versus', name: '对决' },
      { id: 'doudizhu', name: '斗地主' },
      { id: 'single', name: '单挑' }
    ];
    /* 模式人数上限的模块级后备值：身份、国战、对决为 8，斗地主为 3，单挑为 2；优先采用内核 room_members.caps。 */
    var MODE_MAX = { identity: 8, guozhan: 8, versus: 8, doudizhu: 3, single: 2 };
    /* 座位头像色板(名字首字色块):中饱和色,明暗主题下都清楚 */
    var SEAT_COLORS = ['#5b8def', '#e2725b', '#67a37c', '#c9a227', '#9b6bd3', '#4aa3a3', '#d2659b', '#7a8b99'];
    /* 流程互斥:同一游戏实例要么在主机流程要么在客人流程,进行中时另一侧禁用。
     * mqtt_waiting=大厅里等朋友加入(主机侧,创建/加入按钮都要锁住,别让房主
     * 又去点「加入房间」把自己的房号当别人的房进) */
    var HOST_PHASES = ['host_booting', 'hosting', 'mqtt_waiting', 'invite_ready', 'connecting', 'room_open'];
    /* waiting_host 等待房主应答期间保持会话占用，禁用会重置在途连接的创建、加入和回执操作。 */
    var GUEST_PHASES = ['guest_booting', 'joining', 'waiting_host', 'answer_ready', 'entering', 'connected', 'queued', 'lobby_waiting'];
    var ONLINE_PHASE_TEXT = {
      idle: '待机',
      host_booting: '正在进入建房流程(游戏将自动重载,约几秒)…',
      guest_booting: '正在重载进联机模式(约几秒),落地后自动继续加入…',
      hosting: '游戏房间已建好,等待客人加入…',
      mqtt_waiting: '房号就绪!把 6 位房号发给朋友,等朋友加入…',
      invite_ready: '邀请码已生成,等待客人回执码…',
      connecting: '正在建立点对点直连…(最长约 20 秒,打不通会自动换新码)',
      room_open: '插件房间已建立，可在房间里体检并载入游戏',
      joining: '正在连接信令服务器并发出加入请求…',
      waiting_host: '加入请求已发出,等待房主应答…(最长约 30 秒)',
      answer_ready: '回执码已生成,发给房主等他粘贴…',
      entering: '直连已建立,正在进入房间…',
      connected: '✅ 已进入房间!',
      queued: '⏳ 已连接，等待加入本次入座名单',
      lobby_waiting: '✅ 已进入房间大厅,等待房主点「载入到游戏」…'
    };
    function onlinePickEvent(evs, type) {
      if (!Array.isArray(evs)) return null;
      for (var i = evs.length - 1; i >= 0; i--) {
        /* 忽略事件窗口中的空项，再按 type 匹配事件，防止异常事件中断渲染。 */
        if (evs[i] && evs[i].type === type) return evs[i];
      }
      return null;
    }
    function onlineManifestCheck(evs, currentScope) {
      var start = -1, check = null, diff = null, reference = onlinePickEvent(evs, 'manifest_diff');
      function scoped(data) { return !currentScope || data && data.scope && ['sessionId','roundId','documentGeneration','bindingId','bindingNonce','carrierSessionId','partyEpoch'].every(function(key) { return currentScope[key] === undefined || data.scope[key] === currentScope[key]; }); }
      if (!Array.isArray(evs)) return { check: null, diff: null, reference: null, verified: false };
      for (var i = evs.length - 1; i >= 0; i--) {
        var d = evs[i] && evs[i].data;
        if (evs[i] && evs[i].type === 'manifest_check' && d && scoped(d) && d.status === 'pending'
          && typeof d.peerId === 'string' && d.peerId && Number.isSafeInteger(d.request) && d.request > 0) {
          start = i; check = d; break;
        }
      }
      /* 单卡跟随最近发起的检查;另一对端的迟到完成不能替换它。 */
      for (var j = start + 1; start >= 0 && j < evs.length; j++) {
        var ev = evs[j], data = ev && ev.data;
        if (!data || !scoped(data) || data.peerId !== check.peerId || data.request !== check.request || data.role !== check.role) continue;
        if (ev.type === 'manifest_check' && check.status !== 'closed') check = data;
        if (ev.type === 'manifest_diff' && data.verification === 'verified') diff = ev;
      }
      return { check: check, diff: diff, reference: reference, verified: !!(check && check.status === 'verified' && diff) };
    }
    function onlineEventText(ev, evs) {
      /* 空项防护:动态流是 events.map(onlineEventText),任何一环混进 null/非对象,
       * 这里读 .type 就炸整页(与 onlinePickEvent 同款防线) */
      if (!ev || typeof ev !== 'object') return String(ev || '(空事件)');
      switch (ev.type) {
        case 'invite_ready': return '📨 邀请码已生成';
        case 'answer_ready': return '📨 回执码已生成';
        case 'guest_connected': return '🤝 客人已连接';
        case 'session_established': return '✅ 已进入房间';
        case 'entering_room': return '🚪 正在进入房间';
        case 'room_closed': return '🔌 连接断开';
        case 'cancelled': return '🚫 已取消';
        case 'error': return '❌ ' + ((ev.data && ev.data.message) || '出错');
        case 'identity_applied': return '✅ 人物标识已生效:名字「' + ((ev.data && ev.data.name) || '') + '」/ 头像「' + ((ev.data && ev.data.avatar) || '不设置') + '」';
        case 'manifest_diff': {
          var d = ev.data || {};
          var current = onlineManifestCheck(evs);
          if (!current.verified || current.diff !== ev) return '📦 包体检历史或参考记录（不代表本次检查）';
          var exts = d.exts || {}, count = function (v) { return Array.isArray(v) ? v.length : 0 };
          var miss = count(exts.missing), missPack = count(d.packs && d.packs.missing), missCard = count(d.cards && d.cards.missing);
          if (d.inventoryVerified === false && !count(exts.unverified)) return '📦 包体检：本次尚未核验，文件摘要采集未完成';
          if (count(exts.unverified)) return '📦 包体检：本次尚未核验，' + count(exts.unverified) + ' 个扩展内容未核验';
          if (count(exts.changed)) return '📦 包体检：' + count(exts.changed) + ' 个同名扩展内容不同';
          if (count(exts.disabled)) return '📦 包体检：' + count(exts.disabled) + ' 个扩展尚未启用';
          if (miss || missPack || missCard) return '📦 包体检：缺 ' + miss + ' 个扩展、' + missPack + ' 个武将包、' + missCard + ' 个卡牌包';
          return Array.isArray(exts.matching) ? '📦 包体检：本次已核验的启用扩展内容一致' : '📦 包体检：本次尚未核验';
        }
        case 'manifest_check': {
          var active = onlineManifestCheck(evs), state = ev.data || {};
          if (active.check !== state) return '📦 包体检历史状态（不代表本次结果）';
          return active.verified ? '📦 当前体检结果已返回' : '📦 包体检：' + (state.reason && state.reason.indexOf('本次尚未核验') >= 0 ? state.reason : '本次尚未核验' + (state.reason ? '（' + state.reason + '）' : ''));
        }
        case 'ext_error': return '🧩 扩展报错(已拦截' + ((ev.data && ev.data.ext) ? ':' + ev.data.ext : '') + ')';
        case 'ext_quarantined': return '🚫 扩展「' + ((ev.data && ev.data.ext) || '?') + '」联机下爆栈,已自动隔离';
        case 'ext_dump': {
          /* 将内核上报的包池字段归一为数组，保证 join 与 length 操作可用。 */
          var dd = ev.data || {};
          var asArr = function (v) { return Array.isArray(v) ? v : [] };
          var loaded = asArr(dd.loaded);
          var skipped = asArr(dd.skipped);
          var configured = asArr(dd.configured);
          var pk = dd.packs || {};
          var pkConnect = asArr(pk.connect);
          var pkAll = asArr(pk.all);
          var pkExcluded = asArr(pk.excluded);
          var pkCardsConnect = asArr(pk.cardsConnect);
          var line = '🧩 联机加载扩展(' + loaded.length + '):' + (loaded.join('、') || '无') + (skipped.length ? ' | 跳过:' + skipped.join('、') : '') + (configured.length ? ' | 游戏登记:' + configured.join('、') : '');
          if (pkConnect.length) {
            line += ' || 连接武将包池(' + pkConnect.length + '):' + (pkConnect.join('、') || '空');
          }
          if (pkExcluded.length) {
            line += ' | ⚠️ 被排除的武将包:' + pkExcluded.join('、');
          }
          if (pkCardsConnect.length) {
            line += ' || 连接卡牌包池(' + pkCardsConnect.length + '):' + (pkCardsConnect.join('、') || '空');
          }
          if (pkAll.length && pkAll.length !== pkConnect.length) {
            line += ' | 全部包(' + pkAll.length + '):' + pkAll.join('、');
          }
          return line;
        }
        case 'info': return 'ℹ️ ' + ((ev.data && ev.data.message) || '');
        case 'transfer_begin': return '📦 开始补传「' + ((ev.data && ev.data.name) || '') + '」';
        case 'transfer_progress': return '⏳ 补传中「' + ((ev.data && ev.data.name) || '') + '」' + ((ev.data && ev.data.pct) || 0) + '%';
        case 'transfer_done':
          return (ev.data && ev.data.side === 'guest')
            ? '📦 补传完成「' + ((ev.data && ev.data.name) || '') + '」——请重启游戏,重启后重新输房号加入'
            : '📦 补传完成「' + ((ev.data && ev.data.name) || '') + '」';
        case 'transfer_failed': return '❌ 补传失败「' + ((ev.data && ev.data.name) || '') + '」:' + ((ev.data && ev.data.message) || '');
        default: return ev.type;
      }
    }
    function onlineKernelOfflineHint(kernel, pageLocation) {
      if (!kernel || kernel.state === 'missing') return '内核尚未安装。先点「安装内核」，再到无名杀中启用「联机助手」。';
      var port = String(pageLocation.port || (pageLocation.protocol === 'https:' ? '443' : '80'));
      var boundPort = null;
      try {
        var bound = new URL(kernel && kernel.boundApi);
        boundPort = bound.port || (bound.protocol === 'https:' ? '443' : '80');
      } catch (_) {}
      if (boundPort && boundPort !== port) {
        return '内核离线：当前绑定到另一个 DSH（端口 ' + boundPort + '），本页端口为 ' + port + '。点「绑定到此 DSH」切回本页。';
      }
      if (kernel && kernel.tokenMatches === false) {
        return '内核离线：连接凭据与当前 DSH 不一致。点「绑定到此 DSH」更新本机绑定。';
      }
      if (kernel && (kernel.bridgeConfig === 'missing' || kernel.bridgeConfig === 'invalid' || !boundPort)) {
        return '内核离线：桥配置缺失或无法读取。点「绑定到此 DSH」重新保存本机绑定。';
      }
      return '内核离线。若无名杀已打开，请确认「扩展」菜单中的「联机助手」已启用；列表中没有它时，开启「设置→通用→自动导入扩展」并完全重启无名杀。';
    }
    function OnlinePanel() {
      var onlineScope = React.useId();
      var roomOpenerRef = React.useRef(null);
      var statusState = React.useState(null);
      var status = statusState[0], setStatus = statusState[1];
      var modeState = React.useState('identity');
      var roomMode = modeState[0], setRoomMode = modeState[1];
      var roomPopState = React.useState(false);
      var roomPopupOpen = roomPopState[0], setRoomPopupOpen = roomPopState[1];
      var offerIn = React.useState('');
      var offerText = offerIn[0], setOfferText = offerIn[1];
      var roomIn = React.useState('');
      var roomText = roomIn[0], setRoomText = roomIn[1];
      var invFb = React.useState(false);
      var showInviteFallback = invFb[0], setShowInviteFallback = invFb[1];
      var noteState = React.useState('');
      var note = noteState[0], setNote = noteState[1];
      /* 人物标识:本地编辑值。回填只在内核 cfg 变化时做一次(idCfgKey 指纹),
       * 免得每 1.5s 的状态轮询把正在输入的字覆盖掉 */
      var idNameState = React.useState('');
      var idName = idNameState[0], setIdName = idNameState[1];
      var idAvatarState = React.useState('');
      var idAvatar = idAvatarState[0], setIdAvatar = idAvatarState[1];
      var avFilterState = React.useState('');
      var avFilter = avFilterState[0], setAvFilter = avFilterState[1];
      var idCfgKeyState = React.useState(null);
      var idCfgKey = idCfgKeyState[0], setIdCfgKey = idCfgKeyState[1];
      /* 房间模式单选与内核的回同步指纹(同上:变化才同步,防轮询覆盖手点) */
      var rmSyncState = React.useState(null);
      var rmSyncKey = rmSyncState[0], setRmSyncKey = rmSyncState[1];
      var sigUrlState = React.useState('');
      var sigUrl = sigUrlState[0], setSigUrl = sigUrlState[1];
      var transferLimitState = React.useState(null);
      var transferLimitDraft = transferLimitState[0], setTransferLimitDraft = transferLimitState[1];
      var transferLimitCfgState = React.useState(null);
      var transferLimitCfg = transferLimitCfgState[0], setTransferLimitCfg = transferLimitCfgState[1];
      /* 保留本次会话最近的房号，补足未携带房号的状态快照；大厅关闭或会话回到 idle 时清除。 */
      var lastCodeState = React.useState(null);
      var lastRoomCode = lastCodeState[0], setLastRoomCode = lastCodeState[1];
      /* 按邀请码行记录弹出与关闭状态：同一张码关闭后不再自动弹出，新码可重新提示。 */
      var invPopState = React.useState({ popped: null, dismissed: null });
      var invPop = invPopState[0], setInvPop = invPopState[1];
      /* 每行的「回执码」输入:各记各的,粘错不会串行;openAns=展开了粘贴框的那行 */
      var ansTextsState = React.useState({});
      var ansTexts = ansTextsState[0], setAnsTexts = ansTextsState[1];
      var openAnsState = React.useState(null);
      var openAns = openAnsState[0], setOpenAns = openAnsState[1];
      var ansPopState = React.useState('');
      var answerPopupDismissed = ansPopState[0], setAnswerPopupDismissed = ansPopState[1];
      /* 仪表盘折叠块:配置/帮助类默认收起,点标题展开 */
      var foldsState = React.useState({ identity: false, signaling: false, help: false });
      var batchUiState = React.useState({});
      var batchUi = batchUiState[0], setBatchUi = batchUiState[1];
      var folds = foldsState[0], setFolds = foldsState[1];
      /* 头像列表:插件直接扫游戏目录(自带包+扩展包),开不开游戏都有;
       * null=加载中,字符串=失败原因 */
      var avListState = React.useState(null);
      var avatarList = avListState[0], setAvatarList = avListState[1];
      React.useEffect(function () {
        var alive = true;
        fetch('/noname-kit-api/online/avatars').then(function (r) {
          return r.json().then(function (d) { return { code: r.status, d: d } });
        }).then(function (res) {
          if (!alive) return;
          if (res.d && res.d.ok) setAvatarList(res.d.avatars || []);
          else if (res.code === 404) setAvatarList('这个 dsh 实例还在跑旧版代码(没有本接口)——重启 dsh 后刷新本页即可');
          else setAvatarList((res.d && res.d.error) || '扫描失败');
        }, function () { if (alive) setAvatarList('插件服务不可达'); });
        return function () { alive = false; };
      }, []);
      React.useEffect(function () {
        var alive = true;
        var tick = function () {
          fetch('/noname-kit-api/online/status').then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          }).then(function (d) {
            if (alive) setStatus(d);
          }, function () { if (alive) setStatus({ fetchFailed: true }) });
        };
        tick();
        var timer = setInterval(tick, 1500);
        return function () { alive = false; clearInterval(timer); };
      }, []);
      React.useEffect(function () {
        var cfg = status && status.bridge && status.bridge.cfg;
        if (!cfg) return;
        var key = (cfg.onlineName || '') + '|' + (cfg.onlineAvatar || '') + '|' + (cfg.mqttUrl || '');
        if (key !== idCfgKey) {
          setIdCfgKey(key);
          setIdName(cfg.onlineName || '');
          setIdAvatar(cfg.onlineAvatar || '');
          setSigUrl(cfg.mqttUrl || '');
        }
      });
      React.useEffect(function () {
        var cfg = status && status.bridge && status.bridge.cfg;
        if (!cfg || !Number.isSafeInteger(cfg.transferLimitMB)) return;
        var value = String(cfg.transferLimitMB);
        if (value !== transferLimitCfg) {
          setTransferLimitCfg(value);
          if (transferLimitDraft === null || transferLimitDraft === transferLimitCfg) setTransferLimitDraft(value);
        }
      });
      /* 主机模式单选跟随内核(刷新页面后本机状态重置为「身份」,若不回同步,
       * F5 一次就会把房间模式看错、点载入还会把模式切回去)。按「变化才同步」
       * 键控:刚点的选项在命令回显前不会被旧事件弹回 */
      React.useEffect(function () {
        var ev0 = onlinePickEvent((status && status.bridge && status.bridge.events) || [], 'room_members');
        var m = ev0 && ev0.data && (ev0.data.nextMode || ev0.data.mode);
        if (!m || m === rmSyncKey) return;
        /* 白名单兜底:旧内核可能送来被联机单挑局污染的模式(引擎会把它原生
         * 改写成 "normal",创建房间恒被拒)——不认识的模式一律不灌进单选框 */
        if (!ONLINE_MODES.some(function (x) { return x.id === m; })) return;
        setRmSyncKey(m);
        setRoomMode(m);
      });
      /* 码正文只走事件流(不给 0.7 秒一轮的心跳塞 SDP):事件窗口只有几十条,
       * 忙碌的房间会把较早的 invite_ready 挤出去——用一份按行号的缓存留住
       * 见过的码;顺带发现新码就自动弹一次码窗口(每个行号只弹一次) */
      var codeCacheState = React.useState({});
      var codeCache = codeCacheState[0], setCodeCache = codeCacheState[1];
      var autoPopState = React.useState(null);
      var autoPopped = autoPopState[0], setAutoPopped = autoPopState[1];
      React.useEffect(function () {
        var evs0 = (status && status.bridge && status.bridge.events) || [];
        if (!Array.isArray(evs0)) return;   /* 形状防守:非数组直接跳过,不让 effect 抛错 */
        var add = null;
        var newest = null;
        for (var i = 0; i < evs0.length; i++) {
          var ev = evs0[i];
          if (!ev || ev.type !== 'invite_ready' || !ev.data || !ev.data.id) continue;
          if (ev.data.code && !codeCache[ev.data.id]) {
            add = add || {};
            add[ev.data.id] = ev.data.code;
          }
          newest = ev.data.id;
        }
        if (add) setCodeCache(Object.assign({}, codeCache, add));
        /* 只在"出现更新的行号"时自动弹窗。不能用 invPop.popped !== newest 做
         * 条件——那样每一轮心跳轮询都会把用户手动「🔎 再看」的旧行拉回最新行
         * (可能导致:弹出来的是别的行的码,或整行点了没反应) */
        if (typeof newest === 'number' && (autoPopped === null || newest > autoPopped)) {
          setAutoPopped(newest);
          setInvPop({ popped: newest, dismissed: null });
        }
      });
      var sendCmd = function (action, args) {
        return fetch('/noname-kit-api/online/command', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: action, args: args || {} })
        }).then(function (r) { return r.json() }).then(function (d) {
          if (!d.ok) setNote('❌ ' + (d.error || '命令发送失败'));
        }, function () { setNote('❌ 插件服务不可达'); });
      };
      var returnedRoomState = React.useState(null);
      var returnedRoomSeen = returnedRoomState[0], setReturnedRoomSeen = returnedRoomState[1];
      React.useEffect(function () {
        var state = status && status.bridge && status.bridge.state;
        if (state && state.phase === 'idle' && !status.bridge.role) {
          setRoomPopupOpen(false);
          if (note.indexOf('正在退出') === 0) setNote('当前联机会话已结束，可重新选择主客身份。');
          return;
        }
        var room = state && state.continuation && state.continuation.room;
        if (room && room.complete && room.returnId && room.returnId !== returnedRoomSeen) {
          setReturnedRoomSeen(room.returnId);
          setRoomPopupOpen(true);
        }
      });
      var bindBusyRef = React.useRef(false);
      var installBusyState = React.useState(false);
      var installBusy = installBusyState[0], setInstallBusy = installBusyState[1];
      var installKernel = function () {
        if (installBusy || bindBusyRef.current) return;   /* 安装与绑定操作互斥，避免重复写入。 */
        setInstallBusy(true);
        setNote('正在安装内核…');
        fetch('/noname-kit-api/online/kernel/install', { method: 'POST' })
          .then(function (r) { return r.json() })
          .then(function (d) {
            if (d.ok) setNote('✅ 已安装:重启游戏 → 扩展菜单给「联机助手」点「启」→ 重载。列表里没有它?先开 设置→通用→自动导入扩展 再重启。');
            else setNote('❌ 安装失败: ' + (d.error || '未知错误') + (d.backup ? '(旧内核已备份在 ' + d.backup + ')' : ''));
          }, function () { setNote('❌ 插件服务不可达'); })
          .then(function () { setInstallBusy(false); });
      };
      function bindKernelBridge() {
        if (installBusy || bindBusyRef.current || !status || !status.active || !status.kernel || ['missing', 'unknown'].indexOf(status.kernel.state) >= 0 || status.batchRecovery && status.batchRecovery.status !== 'none') return;
        bindBusyRef.current = true;
        setInstallBusy(true);
        setNote('正在绑定到此 DSH…');
        var savedNote = '绑定已保存，等待内核重新连接；已运行的旧内核需完全退出并重启无名杀。';
        return fetch('/noname-kit-api/online/bridge/bind', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then(function (r) {
            return r.json().then(function (d) {
              if (!r.ok || !d || d.ok !== true) throw new Error(d && d.error || 'HTTP ' + r.status);
              return d;
            });
          })
          .then(function () {
            setNote(savedNote);
            return fetch('/noname-kit-api/online/status').then(function (r) {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.json();
            }).then(function (d) { setStatus(d); }, function () { setNote(savedNote + ' 当前状态刷新失败，稍后会自动重试。'); });
          }, function (err) { setNote('❌ 绑定失败：' + (err && err.message || '插件服务不可达')); })
          .then(function () { bindBusyRef.current = false; setInstallBusy(false); });
      }
      var recoverBatch = function () {
        if (installBusy || bindBusyRef.current) return;
        setInstallBusy(true);setNote('正在恢复完整补传批次…');
        fetch('/noname-kit-api/online/batch/recover', {method:'POST'})
          .then(function(r) {return r.json()})
          .then(function(d) {
            setNote(d.status==='committed' ? '完整新版文件已恢复；启用状态需检查。请核对本批全部扩展并启用，在没有进行中对局时重启游戏：'+((d.batch && d.batch.extensions)||[]).map(function(e){return e.name}).join('、') : d.status==='rolled_back' ? '✅ 已恢复整批旧文件。' : d.status==='none' ? '当前没有待恢复批次。' : '❌ 恢复尚未完成：'+(d.error || '批次仍在使用中，请等待或完全退出原游戏进程后重试。'));
          }, function() {setNote('❌ 插件服务不可达');})
          .then(function() {setInstallBusy(false);});
      };
      var copyText = function (text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { setNote('✅ 已复制,去粘贴发送吧'); }, function () { setNote('❌ 复制失败,请手动全选复制'); });
        } else {
          setNote('❌ 浏览器不支持自动复制,请手动全选复制');
        }
      };
      if (!status) return e('div', 'nnk-hint', '正在获取联机状态…');
      if (status.fetchFailed) return e('div', 'nnk-err', '❌ 联机状态获取失败(插件服务不可达)——确认 dsh 正在运行,恢复后本页几秒内自动重试。');
      /* 同时保护派生数据计算与页面渲染，将异常交给可见错误提示；try 内的 var 保持组件作用域可见。 */
      try {
      var kernel = status.kernel;
      var bridge = status.bridge || {};
      var evs = Array.isArray(bridge.events) ? bridge.events : [];
      var phase = (bridge.state && bridge.state.phase) || 'idle';
      var onlineRound = bridge.state && bridge.state.round;
      var onlineNext = bridge.state && bridge.state.continuation && bridge.state.continuation.next;
      var onlineRoom = bridge.state && bridge.state.continuation && bridge.state.continuation.room;
      var phaseText = ONLINE_PHASE_TEXT[phase] || phase;
      var bridgeOnline = Boolean(bridge.online);
      var hostFlow = bridge.role !== 'guest' && HOST_PHASES.indexOf(phase) >= 0;
      var guestFlow = bridge.role !== 'host' && (GUEST_PHASES.indexOf(phase) >= 0 || bridge.role === 'guest' && HOST_PHASES.indexOf(phase) >= 0);
      /* 优先使用内核上报的房间角色；缺少 role 时根据已计算的 hostFlow 与 guestFlow 推断。 */
      var isRoomHost = bridge.role === 'host' || !bridge.role && hostFlow;
      var kernelBad = !kernel || kernel.state === 'unknown';
      /* 回执码仅在客人侧的有效连接状态展示，防止继续使用已失效的事件内容。 */
      var answerEv = (phase === 'joining' || phase === 'answer_ready' || phase === 'entering') ? onlinePickEvent(evs, 'answer_ready') : null;
      /* 安全读取可能为空的 bridge.state；快照缺少房号时采用本次会话缓存，大厅关闭或 idle 时清除。 */
      var roomClosed = Boolean(bridge.state && (bridge.state.lobbyOpen === false || Object.prototype.hasOwnProperty.call(bridge.state, 'roomCode') && bridge.state.roomCode === null));
      var roomCode = phase === 'idle' || roomClosed ? null : (bridge.state && (bridge.state.roomCode || bridge.state.code)) || null;
      if (phase === 'idle' || roomClosed) {
        if (lastRoomCode) setLastRoomCode(null);   /* 显式关闭同时作废本拍与缓存房号 */
      } else if (roomCode) {
        if (lastRoomCode !== roomCode) setLastRoomCode(roomCode);
      } else if (lastRoomCode) {
        roomCode = lastRoomCode;                 /* 进行中的会话短暂没报房号 */
      }
      return renderOnlinePanel();
      } catch (renderErr) {
        /* 将渲染异常显示在页面中，并将堆栈写入控制台，便于定位问题。 */
        console.error('[联机助手] 联机页渲染出错:', renderErr);
        return e('div', 'nnk-err', '❌ 联机页渲染出错: ' + ((renderErr && renderErr.message) || renderErr) + ' —— 请截图本行文字与当时的操作发给开发者');
      }

      /* 新邀请码或回执码生成时自动弹窗；关闭后不重复提示，进入连接状态后自动收起，卡片操作继续可用。 */
      /* ICE 候选受 NAT 映射时限影响；码龄超过 3 分钟时提醒客人请房主重新生成邀请码。 */
      function codeAgeText(ts) {
        if (!ts) return '';
        var sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
        if (sec < 60) return '刚生成,趁热用';
        var min = Math.floor(sec / 60);
        var text = '此码已生成 ' + min + ' 分钟';
        return sec >= 180
          ? '⚠️ ' + text + '——候选地址多半过期了,直连大概率失败!请房主作废这张、重新生成一张,新码马上发马上用'
          : text + '——放太久会失效,建议 3 分钟内用完';
      }
      function renderCodeModal(opts) {
        return h(ModalFrame, { title: opts.title, onClose: opts.onClose },
          e('div', 'nnk-modal-title', opts.title),
          h('div', { className: 'nnk-modal-body' }, opts.body),
          h('div', { className: 'nnk-modal-actions' },
            h('button', { className: 'nnk-copy', onClick: opts.onClose }, '收起(下方卡片里仍可操作)')));
      }
      /* 按行展示邀请码弹窗，生成时自动弹出一次，也可从对应行重新打开；回执码归属当前行。 */
      function renderInviteModal(row) {
        return renderCodeModal({
          title: '📨 邀请码 #' + row.id + ' 已生成——发给朋友',
          onClose: function () { setInvPop({ popped: row.id, dismissed: row.id }) },
          body: h('div', {},
            e('div', 'nnk-hint', '1. 点「复制」把整段邀请码发给朋友;2. 朋友在「我要加入 → 📨 收到邀请码?从这里加入」粘贴,把生成的「回执码」发回给你;3. 回执码贴到下面(或列表里第 #' + row.id + ' 行),点「连接」。他进的是同一个房间,一样在大厅等载入。'),
            row.status === 'pending' && Date.now() - (row.at || 0) >= 180000
              /* 需要内联样式时使用 h(tag, props, children)；e 的参数为 tag、className 与子节点。 */
              ? h('div', { className: 'nnk-hint', style: { color: 'var(--dsw-alias-state-warning-primary, #b8860b)' } }, '⚠️ 这张码已生成 ' + Math.floor((Date.now() - row.at) / 60000) + ' 分钟——里面的候选地址基本过期了,直连大概率失败;作废它再生成一张新码,新码马上发马上用')
              : null,
            e('div', 'nnk-label', '邀请码(整段复制)'),
            h('textarea', { className: 'nnk-textarea nnk-code', readOnly: true, value: row.code }),
            h('button', { className: 'nnk-copy', onClick: function () { copyText(row.code) } }, '📋 复制邀请码'),
            e('div', 'nnk-label', '朋友回发的「回执码」粘贴到这里(第 #' + row.id + ' 张码)'),
            h('textarea', { className: 'nnk-textarea nnk-code', value: ansTexts[row.id] || '', onChange: function (ev2) { setAnsText(row.id, ev2.target.value) }, placeholder: '粘贴这位朋友的回执码…' }),
            h('button', { className: 'nnk-copy', onClick: function () { sendCmd('accept_answer', { id: row.id, code: ansTexts[row.id] || '' }) } }, '🔗 连接'))
        });
      }
      function renderAnswerModal(ev) {
        var code = (ev.data && ev.data.code) || '';
        return renderCodeModal({
          title: '📨 回执码已生成——发回给房主',
          onClose: function () { setAnswerPopupDismissed(code) },
          body: h('div', {},
            e('div', 'nnk-hint', '把回执码整段发给房主,房主粘贴后点「连接」,直连打通后自动进房。房主没回音时在工坊动态看进度。'),
            codeAgeText(ev.ts) ? h('div', { className: 'nnk-hint', style: { color: 'var(--dsw-alias-state-warning-primary, #b8860b)' } }, codeAgeText(ev.ts)) : null,
            e('div', 'nnk-label', '回执码(整段复制)'),
            h('textarea', { className: 'nnk-textarea nnk-code', readOnly: true, value: code }),
            h('button', { className: 'nnk-copy', onClick: function () { copyText(code) } }, '📋 复制回执码'))
        });
      }

      /* 折叠卡:content 传函数(懒渲染)——折叠状态下不构建内部虚拟节点,
       * 人物标识卡两千个下拉项不能每 1.5 秒白建一遍 */
      function renderFoldCard(key, title, contentFn, full) {
        var next = Object.assign({}, folds);
        next[key] = !folds[key];
        return h('div', { className: 'nnk-card' + (full ? ' nnk-dash-full' : '') },
          h('div', { className: 'nnk-fold-head', role: 'button', tabIndex: 0, 'aria-expanded': !!folds[key], onKeyDown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.currentTarget.click() } }, onClick: function () { setFolds(next) } },
            h('b', { className: 'nnk-ui-text' }, (folds[key] ? '▾ ' : '▸ ') + title)),
          folds[key] ? contentFn() : null);
      }

      function renderSignalingCard() {
        var effective = (bridge.cfg && bridge.cfg.mqttUrl) || '';
        return h('div', {},
          e('div', 'nnk-hint', '双方要用同一个信令服务器(都不填=用默认)。默认连不上才需要改;填 ws:// 或 wss:// 地址,下次建房生效。'),
          h('div', { style: { marginTop: '8px' } },
            e('div', 'nnk-label', '信令地址(留空用默认)'),
            h('input', { className: 'nnk-input', value: sigUrl, placeholder: '默认 wss://broker.emqx.io:8084/mqtt', onChange: function (ev) { setSigUrl(ev.target.value) } })),
          effective ? e('div', 'nnk-hint', '当前生效:' + effective) : null,
          h('div', { className: 'nnk-row', style: { marginTop: '8px' } },
            h('button', { className: 'nnk-copy', onClick: function () {
              var v = sigUrl.trim();
              if (v && !/^wss?:\/\//i.test(v)) { setNote('❌ 地址必须以 ws:// 或 wss:// 开头'); return; }
              setNote(v ? '已发送,下次建房生效' : '已发送恢复默认,下次建房生效');
              sendCmd('set_config', { key: 'mqttUrl', value: v });
            } }, '💾 保存信令地址'),
            (sigUrl.trim() || effective) ? h('button', { className: 'nnk-copy', onClick: function () { setSigUrl(''); sendCmd('set_config', { key: 'mqttUrl', value: '' }) } }, '↩️ 恢复默认') : null));
      }

      function renderIdentityCard() {
        var avatars = Array.isArray(avatarList) ? avatarList : [];
        var kw = avFilter.trim().toLowerCase();
        var filtered = kw ? avatars.filter(function (a) {
          return a.name.toLowerCase().indexOf(kw) >= 0 || a.id.toLowerCase().indexOf(kw) >= 0;
        }) : avatars;
        var known = avatars.some(function (a) { return a.id === idAvatar; });
        return h('div', {},
          e('div', 'nnk-hint', '用户名和头像就是朋友看到的样子。保存后自己立即生效,对方下一局生效。'),
          h('div', { style: { marginTop: '8px' } },
            e('div', 'nnk-label', '用户名(留空用游戏内设置)'),
            h('input', { className: 'nnk-input', value: idName, maxLength: 12, placeholder: '例: 大将军', onChange: function (ev) { setIdName(ev.target.value) } })),
          h('div', { style: { marginTop: '8px' } },
            e('div', 'nnk-label', '头像(留「不设置」用游戏内默认)'),
            avatarList === null
              ? e('div', 'nnk-hint', '正在扫描游戏目录里的武将…(首次约一两秒)')              : !Array.isArray(avatarList)
                ? e('div', 'nnk-err', '❌ 头像列表加载失败: ' + avatarList)
                : avatars.length === 0
                  ? e('div', 'nnk-hint', '没扫到武将——检查「⚙ 设置」里的游戏目录是否指向游戏本体。')
                  : h('div', {},
                    h('input', { className: 'nnk-input', value: avFilter, placeholder: '打字过滤,如: 曹 / 吕 / sp', onChange: function (ev) { setAvFilter(ev.target.value) } }),
                    h('select', {
                      className: 'nnk-input', style: { marginTop: '4px' },
                      value: known || !idAvatar ? idAvatar : '__nnk_keep',
                      onChange: function (ev) { if (ev.target.value !== '__nnk_keep') setIdAvatar(ev.target.value) }
                    },
                      h('option', { key: '', value: '' }, '不设置(用游戏内默认)'),
                      !known && idAvatar ? h('option', { key: '__nnk_keep', value: '__nnk_keep' }, idAvatar + '(当前,列表里没有)') : null,
                      filtered.map(function (a) { return h('option', { key: a.id, value: a.id }, a.name || a.id); }))),
            !known && idAvatar && avatarList !== null && Array.isArray(avatarList) && avatars.length ? e('div', 'nnk-hint', '保存的头像「' + idAvatar + '」不在列表里(扩展可能删了),选别的会覆盖它。') : null),
          h('div', { className: 'nnk-row', style: { marginTop: '8px' } },
            h('button', { className: 'nnk-submit', style: { marginTop: '0' }, onClick: function () {
              setNote(bridgeOnline ? '已发送,游戏内即时生效' : '已保存到本机,内核上线后自动补发');
              sendCmd('set_identity', { name: idName.trim(), avatar: idAvatar });
            } }, '💾 保存人物标识')));
      }

      function renderTransferLimit() {
        var state = bridge.state || {};
        var configured = bridge.cfg && bridge.cfg.transferLimitMB;
        var known = Number.isSafeInteger(configured) && configured >= 1 && configured <= 1024;
        var draft = transferLimitDraft === null ? '' : transferLimitDraft;
        var value = /^\d+$/.test(draft) ? Number(draft) : NaN;
        var valid = Number.isSafeInteger(value) && value >= 1 && value <= 1024;
        var pending = Array.isArray(state.batchProposals) && state.batchProposals.some(function (q) { return q && ['preparing', 'pending', 'accepting', 'rejecting', 'authorized_paused'].indexOf(q.status) >= 0; });
        var busy = state.transferBusy || state.transferRequestPending || state.transferRequestBusy || state.transferLimitSaving || pending;
        var recovery = status.batchRecovery && status.batchRecovery.status !== 'none';
        var reason = !bridgeOnline ? '内核上线后可保存。' : !known ? '请升级本机内核并重启无名杀后设置。' : recovery ? '请先恢复完整补传批次。' : busy ? '请先完成或终止当前补传请求。' : '';
        var disabled = !!reason || !valid || value === configured;
        return h('div', { 'data-nnk-transfer-limit': true, style: { marginTop: '12px' } },
          h('label', { className: 'nnk-label', htmlFor: onlineScope + '-transfer-limit' }, '本机单批补传上限（MiB）'),
          h('div', { className: 'nnk-row', style: { flexWrap: 'wrap' } },
            h('input', { id: onlineScope + '-transfer-limit', className: 'nnk-input', type: 'number', min: 1, max: 1024, step: 1, value: draft, style: { width: '140px', maxWidth: '100%' }, onChange: function (ev) { setTransferLimitDraft(ev.target.value); } }),
            h('button', { className: 'nnk-copy', disabled: disabled, onClick: function () {
              if (disabled) return;
              setNote('已发送补传上限，等待内核保存确认。');
              sendCmd('set_config', { key: 'transferLimitMB', value: value });
            } }, '保存补传上限')),
          e('div', 'nnk-hint', '1024 MiB = 1 GiB；修改仅用于新提议，不延长当前授权。'),
          known ? e('div', 'nnk-hint', '当前已保存：' + configured + ' MiB。') : null,
          reason ? e('div', 'nnk-hint', reason) : draft && !valid ? e('div', 'nnk-hint', '请输入 1–1024 的整数（MiB）。') : null);
      }

      function renderBatchProposals() {
        var state = bridge.state || {};
        var scope = state.transferScope || state.manifestScope;
        var available = state.transferAvailable === true;
        var proposals = Array.isArray(state.batchProposals) ? state.batchProposals.filter(Boolean).slice(-64) : [];
        var fileBatches = Array.isArray(state.fileBatches) ? state.fileBatches.filter(Boolean).slice(-64) : [];
        var labels = { preparing: '正在核验本批文件', pending: '等待客机确认本批', accepting: '已发送同意，等待房主确认', rejecting: '已发送拒绝，等待房主确认', authorized_paused: available ? '本批已授权，准备自动传输' : '本批已授权，等待传输条件就绪', declined: '客机已拒绝本批', cancelled: '本批已取消', expired: '本批已超时，授权失效', disconnected: '连接结束，授权失效', failed: '本批提议失败' };
        var fileLabels = { starting: '准备接收本批文件', waiting_receiver: '等待客机准备接收', receiving: '接收至独立暂存区', sending: '发送已授权文件', committing: '整批校验并提交', activation_pending: '文件已提交，正在保存启用设置', committed: '本批扩展已自动启用，重启后生效', committed_activation_required: '文件已提交，自动启用未能确认', unknown: '最终回执未收到，提交结果待确认', recovery_required: '必须先完成离线恢复', failed: '文件事务失败', cancelled: '文件事务已取消', expired: '文件授权已超时', disconnected: '文件连接已断开' };
        function sameScope(a, b) { return !!a && !!b && typeof a.carrierSessionId === 'string' && Number.isSafeInteger(a.partyEpoch) && a.carrierSessionId === b.carrierSessionId && a.partyEpoch === b.partyEpoch; }
        function sameBatch(a, b) { return ['session', 'peerSession', 'proposal', 'digest'].every(function (k) { return a[k] === b[k]; }) && a.peerId === b.peerId && ((!a.scope && !b.scope) || sameScope(a.scope, b.scope)); }
        var rows = proposals.slice();
        fileBatches.forEach(function (f) { if (!rows.some(function (q) { return sameBatch(q, f); })) rows.push(f); });
        return rows.map(function (q) {
          var current = ['session', 'peerSession', 'proposal', 'digest'].every(function (key) { return typeof q[key] === 'string' && q[key].length > 0 && q[key].length <= 160; }) && /^[a-f0-9]{64}$/.test(q.digest) && typeof q.peerId === 'string' && !!q.peerId && sameScope(q.scope, scope);
          var binding = { session: q.session, peerSession: q.peerSession, proposal: q.proposal, digest: q.digest, peerId: q.peerId, scope: q.scope };
          var batch = q.batch || {};
          var extensions = Array.isArray(batch.extensions) ? batch.extensions.filter(function (ext) { return ext && typeof ext.name === 'string'; }) : [];
          var file = fileBatches.find(function (f) { return sameBatch(q, f); });
          var key = JSON.stringify([q.session, q.peerSession, q.proposal, q.digest, q.peerId, q.scope]);
          var collapsed = typeof batchUi !== 'undefined' && batchUi[key];
          var finalFile = file && (file.fileCommitted || ['activation_pending', 'committed', 'committed_activation_required', 'unknown', 'recovery_required'].indexOf(file.status) >= 0);
          var choice = bridgeOnline && current && !file && q.role === 'guest' && q.status === 'pending' && (!Number.isFinite(q.expires) || Date.now() < q.expires);
          var cancellable = bridgeOnline && current && !finalFile && (['preparing', 'pending', 'accepting', 'rejecting', 'authorized_paused'].indexOf(q.status) >= 0 || file && ['starting', 'waiting_receiver', 'sending', 'receiving', 'committing'].indexOf(file.status) >= 0);
          var retryable = bridgeOnline && available && !state.transferBusy && !state.transferRequestPending && current && !finalFile && q.role === 'host' && (['cancelled', 'expired', 'failed'].indexOf(q.status) >= 0 || file && ['failed', 'cancelled', 'expired'].indexOf(file.status) >= 0);
          var count = Number.isSafeInteger(batch.count) && batch.count >= 0 ? batch.count : 0;
          var total = Number.isSafeInteger(file && file.total) && file.total >= 0 ? file.total : Number.isSafeInteger(batch.total) && batch.total >= 0 ? batch.total : 0;
          var received = file && (file.role === 'host' ? file.acknowledged : file.received);
          var progress = Number.isSafeInteger(received) && received >= 0 ? Math.min(received, total) : null;
          var peerName = q.peerIdentity && q.peerIdentity.name || '';
          var ttlSeconds = Number.isSafeInteger(q.ttlMs) && q.ttlMs > 0 && q.ttlMs <= 900000 ? Math.ceil(q.ttlMs / 1000) : null;
          var duration = ttlSeconds === null ? '' : (Math.floor(ttlSeconds / 60) ? Math.floor(ttlSeconds / 60) + ' 分钟' : '') + (ttlSeconds % 60 ? (ttlSeconds >= 60 ? ' ' : '') + ttlSeconds % 60 + ' 秒' : '');
          var deadline = Number.isSafeInteger(q.expires) && q.expires > 0 && q.expires <= 8640000000000000 ? new Date(q.expires).toLocaleTimeString() : '';
          if (collapsed) return h('div', { className: 'nnk-card', key: key }, e('div', 'nnk-hint', '补传提示已收起，本批处理状态保持。'), h('button', { className: 'nnk-copy', onClick: function () { setBatchUi(Object.assign({}, batchUi, { [key]: false })); } }, '展开补传提示'));
          return h('div', { className: 'nnk-card', key: key, 'data-nnk-transfer': true },
            e('div', null, h('b', { className: 'nnk-ui-text' }, '📦 本批扩展补传')),
            e('div', 'nnk-hint', (q.role === 'host' ? '接收客机：' + (peerName || '当前客机') : '来源房主：' + (peerName || q.source || '当前房主')) + ' · ' + extensions.length + ' 个扩展 · ' + count + ' 个文件 · ' + total + ' 字节'),
            extensions.map(function (ext) { return e('div', 'nnk-break', ext.name + '（' + (Array.isArray(ext.files) ? ext.files.length : Number.isSafeInteger(ext.fileCount) ? ext.fileCount : 0) + ' 个文件）'); }),
            !current ? e('div', 'nnk-hint', '历史或旧协议记录，不能授权或恢复到当前会话。') : null,
            choice ? e('div', 'nnk-hint', '扩展包含可执行代码。请确认信任房主后再同意；仅授权所列完整批次，不授权后续请求。') : null,
            current && !finalFile && duration ? e('div', 'nnk-hint', '本批时限：' + duration + '（含确认等待）' + (deadline ? '；截止 ' + deadline : '') + '。到期停止，不自动续期。') : null,
            choice ? e('div', 'nnk-hint', '同意后自动接收、整批校验并更新所列扩展，成功后自动启用；完成后需要完全退出并重启无名杀。') : null,
            e('div', 'nnk-hint', file ? fileLabels[file.status] || file.status : labels[q.status] || '未知状态'),
            file && total > 0 && progress !== null ? h('div', {}, h('progress', { max: total, value: progress, 'aria-label': q.role === 'host' ? '本批已确认发送进度' : '本批接收进度', style: { width: '100%' } }), e('div', 'nnk-hint', progress + '/' + total + ' 字节')) : null,
            file && file.role === 'host' && progress === null && ['waiting_receiver', 'sending'].indexOf(file.status) >= 0 ? e('div', 'nnk-hint', '等待客机确认接收状态。') : null,
            current && !available && !finalFile ? e('div', 'nnk-hint', state.transferUnavailableReason || '补传当前不可用；请在插件房间中核对双方内核与连接。') : null,
            file && file.reason ? e('div', 'nnk-hint', file.reason) : null,
            file && file.role === 'host' && file.status === 'committed' ? e('div', 'nnk-hint', '客机本批扩展已自动启用。请提醒客机完全退出并重启无名杀后重新体检；房主无需因此重启。') : null,
            file && file.role === 'guest' && file.status === 'committed' ? e('div', 'nnk-hint', '本批扩展已自动启用。请完全退出并重启无名杀后重新体检；Ctrl+R 不能代替重启，无需重新下载。') : null,
            file && file.role === 'guest' && file.status === 'committed_activation_required' ? e('div', 'nnk-hint', '文件已整批提交，自动启用未能确认。请在无名杀扩展设置中检查并手动启用所列扩展，再完全退出并重启无名杀后重新体检；无需重新下载。') : null,
            file && file.status === 'unknown' ? e('div', 'nnk-hint', '请先核对客机的提交结果，结果明确前不要重新传输。') : null,
            retryable ? h('button', { className: 'nnk-copy', onClick: function () { setNote('正在重新体检并申请补传，等待客机重新确认'); sendCmd('batch_request', { peerId: q.peerId, scope: { carrierSessionId: q.scope.carrierSessionId, partyEpoch: q.scope.partyEpoch } }); } }, '重新传输（需客机再次同意）') : null,
            !finalFile && q.reason ? e('div', 'nnk-hint', q.reason) : null,
            choice ? h('button', { className: 'nnk-copy', disabled: !available, onClick: function () { sendCmd('batch_decision', Object.assign({}, binding, { yes: true })); } }, '同意本批并接收') : null,
            choice ? h('button', { className: 'nnk-copy', onClick: function () { sendCmd('batch_decision', Object.assign({}, binding, { yes: false })); } }, '拒绝本批') : null,
            h('button', { className: 'nnk-copy', onClick: function () { setBatchUi(Object.assign({}, batchUi, { [key]: true })); } }, '收起提示'),
            cancellable ? h('button', { className: 'nnk-copy', onClick: function () {
              var consequence = !file ? '将终止当前提议。再次申请会生成新请求，仍需客机重新同意。' : '将停止未提交的文件并恢复整批旧文件；已经持久提交的完整新版不能由取消恢复。';
              if (window.confirm(consequence + '\n确认终止本次补传吗？')) sendCmd('batch_cancel', binding);
            } }, '终止本次补传') : null);
        });
      }

      function renderManifestCard(evs, hostFlow, inRoom, showTransferLimit) {
        var roundState = bridge.state && bridge.state.round;
        var engineState = bridge.state && bridge.state.keepaliveDiagnostics && bridge.state.keepaliveDiagnostics.engine;
        var currentScope = bridge.state && bridge.state.manifestScope || engineState && engineState.current && engineState.current.scope || roundState && { sessionId: roundState.partySessionId, roundId: roundState.roundId };
        var current = onlineManifestCheck(evs, currentScope);
        var verified = current.verified && bridge.online !== false;
        var diffEv = verified ? current.diff : current.check ? null : current.reference;
        var reason = current.check && current.check.reason;
        var uncheckedText = currentScope && !currentScope.carrierSessionId ? '本局尚未核验' : '本次尚未核验';
        var checkHint = !verified ? e('div', 'nnk-hint', reason && reason.indexOf('本次尚未核验') >= 0 ? reason.replace('本次尚未核验', uncheckedText) : uncheckedText + (reason ? '：' + reason : '')) : null;
        var unavailable = bridge.state && bridge.state.manifestAvailable === false;
        var unavailableReason = bridge.state && bridge.state.manifestUnavailableReason;
        var checking = current.check && current.check.status === 'pending';
        var recheckBtn = h('button', { className: 'nnk-copy', disabled: bridge.online === false || unavailable || !!checking, title: unavailableReason || (bridge.online === false ? '内核离线' : ''), onClick: function () { sendCmd('manifest_recheck', {}); } }, checking ? '正在体检…' : '重新体检');
        var availabilityHint = unavailable && unavailableReason ? e('div', 'nnk-hint', unavailableReason) : null;
        var inventorySource = bridge.state && bridge.state.manifestInventorySource;
        var inventoryHint = typeof inventorySource === 'string' && inventorySource ? e('div', 'nnk-hint', inventorySource) : null;
        var transferReady = bridge.state && bridge.state.transferAvailable === true;
        var transferReason = !transferReady && bridge.state && typeof bridge.state.transferUnavailableReason === 'string' ? bridge.state.transferUnavailableReason : '';
        if (transferReason && /双方.*升级/.test(transferReason)) transferReason += '；正常联机和包体检仍可使用。';
        var transferHint = transferReady ? '缺包或同名文件差异会自动生成补传请求，客机逐批同意后开始接收。' : '补传当前不可用，双方仍可自行安装相同版本的扩展。';
        var manualTransfer = hostFlow && bridge.role !== 'guest' ? (function () {
          var state = bridge.state || {}, scope = state.transferScope || state.manifestScope;
          var validScope = scope && !Array.isArray(scope) && Object.keys(scope).length === 2 && typeof scope.carrierSessionId === 'string' && scope.carrierSessionId.length > 0 && scope.carrierSessionId.length <= 160 && !/[\x00-\x1f\x7f]/.test(scope.carrierSessionId) && Number.isSafeInteger(scope.partyEpoch) && scope.partyEpoch >= 0 && scope.partyEpoch <= 1000000000;
          var peers = Array.isArray(state.transferPeers) ? state.transferPeers.filter(function (peer, index, list) {
            return peer && typeof peer.peerId === 'string' && peer.peerId.length > 0 && peer.peerId.length <= 160 && !/[\x00-\x1f\x7f]/.test(peer.peerId) && list.findIndex(function (other) { return other && other.peerId === peer.peerId; }) === index;
          }).slice(0, 32) : [];
          var rows = (Array.isArray(state.batchProposals) ? state.batchProposals : []).concat(Array.isArray(state.fileBatches) ? state.fileBatches : []).filter(function (row) {
            return row && validScope && row.scope && row.scope.carrierSessionId === scope.carrierSessionId && row.scope.partyEpoch === scope.partyEpoch;
          });
          var completed = rows.filter(function (row) { return row.role === 'host' && row.fileCommitted === true && ['committed', 'committed_activation_required'].indexOf(row.status) >= 0; });
          var roundPhase = state.roundPhase || state.round && state.round.phase;
          var playing = state.playing === true || ['playing', 'settling', 'settled', 'loading', 'preparing', 'returning', 'seating', 'awaiting-bind', 'waiting'].indexOf(roundPhase) >= 0;
          function requestReason(peer) {
          var relevant = rows.filter(function (row) { return peer && row.peerId === peer.peerId || !completed.some(function (done) { return done.peerId === row.peerId && done.proposal === row.proposal && done.digest === row.digest; }); });
          var finalRow = relevant.find(function (row) { return row.fileCommitted || ['activation_pending', 'committed', 'committed_activation_required', 'unknown', 'recovery_required'].indexOf(row.status) >= 0; });
          var active = relevant.some(function (row) { return ['preparing', 'pending', 'accepting', 'rejecting', 'authorized_paused', 'starting', 'waiting_receiver', 'sending', 'receiving', 'committing'].indexOf(row.status) >= 0; });
          var reason = '';
          if (bridge.online !== true) reason = '内核离线，请先连接当前插件房间。';
          else if (bridge.role !== 'host' || !validScope) reason = '需要房主在当前插件房间中操作。';
          else if (playing) reason = '请先返回插件房间并关闭游戏窗口，再重新传输。';
          else if (finalRow) reason = finalRow.status === 'unknown' ? '提交结果待确认，请先核对客机结果，暂不能重新传输。' : finalRow.status === 'recovery_required' ? '文件事务需要先完成恢复，暂不能重新传输。' : '文件已提交，请按客机提示完全退出并重启无名杀，再重新体检；无需再次下载。';
          else if (state.transferRequestPending) reason = '正在重新体检并申请补传，请等待本次结果。';
          else if ((typeof state.transferRequestBusy === 'boolean' ? state.transferRequestBusy : state.transferBusy) || active) reason = '已有补传请求或文件正在处理，请先完成或终止当前批次。';
          else if (checking) reason = '包体检正在进行，请等待本次结果。';
          else if (!transferReady) reason = state.transferUnavailableReason || '当前补传不可用，请核对双方内核和连接。';
          else if (!peers.length) reason = state.transferUnavailableReason || '请先连接支持新版补传的客机。';
          return reason;
          }
          var reason = requestReason(peers.length === 1 ? peers[0] : null);
          return h('div', { 'data-nnk-manual-transfer': true, style: { marginTop: '8px' } },
            (peers.length ? peers : [null]).map(function (peer, index) {
              var name = peer && typeof peer.name === 'string' && peer.name.trim() ? peer.name.slice(0, 80) : peers.length > 1 ? '未命名' : '当前客机';
              var peerReason = requestReason(peer), disabled = !!peerReason || !peer;
              return h('div', { className: 'nnk-row', key: peer ? peer.peerId : 'unavailable', 'data-nnk-transfer-peer': peer ? peer.peerId : '', style: { marginTop: '6px', flexWrap: 'wrap' } },
                peer ? h('span', { className: 'nnk-break', style: { flex: '1 1 160px', minWidth: 0 } }, (peers.length > 1 ? '客机 ' + (index + 1) + '：' : '接收客机：') + name) : null,
                h('button', { className: 'nnk-copy', disabled: disabled, title: peerReason || '重新体检后申请新批次，仍需客机再次同意', 'aria-label': peers.length > 1 ? '重新传输给客机 ' + (index + 1) + '：' + name : '重新传输', onClick: function () {
                  if (disabled) return;
                  setNote('正在重新体检并申请补传，等待客机重新确认');
                  sendCmd('batch_request', { peerId: peer.peerId, scope: { carrierSessionId: scope.carrierSessionId, partyEpoch: scope.partyEpoch } });
                } }, '重新传输'),
                peerReason && peerReason !== reason ? e('div', 'nnk-hint', peerReason) : null);
            }),
            e('div', 'nnk-hint', reason || '重新体检后发起新批次；客机需再次同意，才会开始传输。'));
        })() : null;
        /* 重置按钮常驻:隔离名单持久化在游戏配置里,清它不能依赖会话内的事件记录 */
        var resetBtn = inRoom ? null : (function () {
          var qEv = onlinePickEvent(evs, 'ext_quarantined');
          return h('div', { style: { marginTop: '6px' } },
            qEv ? e('div', 'nnk-hint', '本页记录到自动隔离:' + ((qEv.data && qEv.data.ext) || '?') + '(0.3.5 起已不再自动隔离)。') : null,
            h('button', { className: 'nnk-copy', onClick: function () { setNote('↩️ 清空命令已发送(游戏在线时立即生效)'); sendCmd('clear_quarantine', {}); } }, '↩️ 重置隔离名单(清空历史拉黑,重启游戏生效)'));
        })();
        if (!diffEv || !diffEv.data) {
          return h('div', { className: 'nnk-card', 'data-nnk-manifest': true },
            e('div', null, h('b', { className: 'nnk-ui-text' }, '📦 包体检')),
            checkHint,
            current.check && current.check.identity && current.check.identity.name ? e('div', 'nnk-hint', '👤 对方(' + (hostFlow ? '客人' : '房主') + '):「' + current.check.identity.name + '」') : null,
            e('div', 'nnk-hint', '双方连接后在这里核对扩展清单与文件内容。' + transferHint),
            availabilityHint,
            inventoryHint,
            recheckBtn,
            manualTransfer,
            resetBtn,
            showTransferLimit === false ? null : renderTransferLimit());
        }
        var d = diffEv.data;
        var missing = Array.isArray(d.exts && d.exts.missing) ? d.exts.missing : [];
        var extra = Array.isArray(d.exts && d.exts.extra) ? d.exts.extra : [];
        var disabled = (d.exts && d.exts.disabled) || [], changed = (d.exts && d.exts.changed) || [], unverified = (d.exts && d.exts.unverified) || [];
        var missPacks = Array.isArray(d.packs && d.packs.missing) ? d.packs.missing : [];
        var missCards = Array.isArray(d.cards && d.cards.missing) ? d.cards.missing : [];
        /* P2P 连接识别 v1:身份随清单交换,主机看客人、客人看房主 */
        var peer = verified ? (hostFlow ? (d.guestIdentity || null) : (d.hostIdentity || null)) : (current.check && current.check.identity);
        /* 旧版成功事件不证明当前内容完整,不能据此隐藏体检中的缺包。 */
        var stillMissing = missing;
        var submittedNames = [];
        var checkScope = d.scope || d.manifestScope;
        if (verified && checkScope && currentScope && typeof checkScope.carrierSessionId === 'string' && Number.isSafeInteger(checkScope.partyEpoch) && checkScope.carrierSessionId === currentScope.carrierSessionId && checkScope.partyEpoch === currentScope.partyEpoch && typeof d.peerId === 'string') {
          (Array.isArray(bridge.state && bridge.state.fileBatches) ? bridge.state.fileBatches : []).forEach(function (file) {
            if (!file || file.fileCommitted !== true || ['activation_pending', 'committed', 'committed_activation_required'].indexOf(file.status) < 0 || file.role !== (hostFlow ? 'host' : 'guest') || file.peerId !== d.peerId || !file.scope || file.scope.carrierSessionId !== checkScope.carrierSessionId || file.scope.partyEpoch !== checkScope.partyEpoch) return;
            (Array.isArray(file.batch && file.batch.extensions) ? file.batch.extensions : []).forEach(function (ext) { if (ext && typeof ext.name === 'string' && submittedNames.indexOf(ext.name) < 0) submittedNames.push(ext.name); });
          });
        }
        var submittedMissing = missing.some(function (name) { return submittedNames.indexOf(name) >= 0; });
        var submittedChanged = changed.some(function (name) { return submittedNames.indexOf(name) >= 0; });
        var submittedHint = '文件已提交，请按补传结果核对启用状态，完全退出并重启无名杀后重新体检；本条仍为补传前的体检记录。';
        var txEv = null;
        for (var i = evs.length - 1; i >= 0; i--) {
          if (evs[i] && evs[i].type === 'transfer_failed') {
            txEv = evs[i];
            break;
          }
        }
        /* 版本差异作提示，补传以当前会话实际协商的能力为准。 */
        var peerKernel = verified ? (hostFlow ? (d.guestKernel || null) : (d.hostKernel || null)) : null;
        var mineKernel = (bridge && bridge.kernelVersion) || null;
        return h('div', { className: 'nnk-card', 'data-nnk-manifest': true },
          e('div', null, h('b', { className: 'nnk-ui-text' }, '📦 包体检')),
          checkHint,
          !verified ? e('div', 'nnk-hint', '以下仅为历史或参考记录，不代表本次检查结果。') : null,
          e('div', 'nnk-hint', (bridge.cfg && bridge.cfg.root === false)
            ? '⚠️ 本机无法定位游戏目录,扩展分类已跳过(全部扩展会参与联机加载)。'
            : '联机只加载带武将/卡牌的扩展。'),
          (peerKernel && mineKernel && peerKernel !== mineKernel)
            ? e('div', 'nnk-err', '⚠️ 对方内核 v' + peerKernel + ',与本机 v' + mineKernel + ' 不一致，请优先使用相同版本；补传能力以当前会话实际协商为准。')
            : null,
          peer && peer.name ? e('div', 'nnk-ok', '👤 对方(' + (hostFlow ? '客人' : '房主') + '):「' + peer.name + '」' + (peer.avatar ? '(头像:' + peer.avatar + ')' : '')) : null,
          stillMissing.length
            ? h('div', {},
              e('div', 'nnk-hint', !verified ? '参考记录中缺以下扩展，需重新核对:' : submittedMissing ? '补传前记录中缺少以下扩展；已提交的项目请按下方提示处理：' : hostFlow
                ? '客机缺以下扩展：' + (transferReady ? '请查看本批补传请求。' : '补传当前不可用，请双方自行安装相同版本。')
                : '你缺以下扩展：' + (transferReady ? '请查看本批补传请求。' : '补传当前不可用，请双方自行安装相同版本。')),
              stillMissing.map(function (name) {
                return h('div', { key: name, style: { marginTop: '6px' } },
                  h('span', null, name + ' '),
                  submittedNames.indexOf(name) >= 0 ? e('span', 'nnk-hint', submittedHint) : !transferReady ? e('span', 'nnk-hint', '请自行安装或待补传条件就绪') : null);
              }))
            : verified&&!missPacks.length&&!missCards.length&&!disabled.length&&!changed.length&&!unverified.length&&d.inventoryVerified!==false&&d.exts&&Array.isArray(d.exts.matching) ? e('div', 'nnk-ok', '✅ 已体检的启用扩展内容一致。') : null,
          disabled.length ? e('div','nnk-hint',verified ? '已安装但未启用，文件内容一致：'+disabled.join('、')+'。请客人在游戏扩展设置中自行启用并重启，再重新体检；无需下载。' : '参考记录中的未启用扩展：'+disabled.join('、')+'。请重新核对。') : null,
          changed.length ? h('div', { className: 'nnk-err' }, e('div', null, (verified ? submittedChanged ? '补传前记录中的同名扩展内容差异：' : '同名扩展文件内容不同：' : '参考记录中的同名扩展内容差异：')+changed.join('、')), changed.map(function (name) { return e('div', 'nnk-hint', name+'：'+(submittedNames.indexOf(name) >= 0 ? submittedHint : transferHint)); })) : null,
          verified&&(unverified.length || d.inventoryVerified === false) ? e('div','nnk-hint','本次尚未核验：扩展文件摘要未完整读取。') : null,
          unverified.length ? e('div','nnk-hint','内容尚未核验：'+unverified.join('、')+'。名称一致不能证明文件一致，请双方升级后重新体检。') : null,
          availabilityHint,
          transferReason ? e('div', 'nnk-hint', transferReason) : null,
          inventoryHint,
          recheckBtn,
          manualTransfer,
          missCards.length ? e('div', 'nnk-hint', '缺少的卡牌包(当前不会补传):' + missCards.join('、')) : null,
          missPacks.length ? e('div', 'nnk-hint', '缺少的武将包(当前不会补传):' + missPacks.join('、')) : null,
          extra.length ? e('div', 'nnk-hint', '对方多出的扩展(不影响联机):' + extra.join('、')) : null,
          !inRoom ? h('label', { style: { display: 'block', marginTop: '8px' } },
            h('input', { type: 'checkbox', checked: !!(bridge.cfg && bridge.cfg.unlockUIExtensions), onChange: function (ev2) { setNote('开关已发送,下次建房重载后生效'); sendCmd('set_config', { key: 'unlockUIExtensions', value: ev2.target.checked }); } }),
            ' 联机时也加载美化类扩展(皮肤/动效,可能不稳,默认只加载武将/卡牌扩展)') : null,
          resetBtn,
          txEv ? h('div', { className: 'nnk-break', style: { marginTop: '6px' } }, onlineEventText(txEv)) : null,
          showTransferLimit === false ? null : renderTransferLimit());
      }

      /* 解散或退出结束当前联机会话；界面等待内核状态确认后再关闭。 */
      function leaveRoom(asHost) {
        var b = roomBrief();
        if (b.list.length > 1 && !window.confirm(asHost
          ? '将结束当前联机会话，并关闭与所有客人的原连接。再次联机需要重新加入；进行中的对局不会强制关闭。继续吗？'
          : '将结束当前联机会话，并关闭与房主的原连接。再次联机需要重新加入；进行中的对局不会强制关闭。继续吗？')) {
          return;
        }
        sendCmd('cancel');
        setNote('正在退出，等待内核确认…');
      }

      /* 邀请码列表(一客一张):状态元数据走心跳(bridge.state.invites,随房间一起
       * 过期),码正文走事件流(invite_ready 带 id+code,不塞进 0.7 秒一轮的心跳)。
       * 注意:这是函数声明——组件体在 return 之后不再执行,var 赋值会变死语句 */
      function inviteRows() {
        /* 将心跳中的 invites 校验为数组后再 map，避免异常数据中断页面渲染。 */
        var raw = bridge.state && bridge.state.invites;
        var list = Array.isArray(raw) ? raw : [];
        var codes = {};
        evs.forEach(function (ev) {
          if (ev && ev.type === 'invite_ready' && ev.data && ev.data.id) { codes[ev.data.id] = ev.data.code; }
        });
        return list.map(function (it) {
          return { id: it.id, status: it.status, at: it.at, guest: it.guest || '', note: it.note || '', code: codeCache[it.id] || codes[it.id] || '' };
        });
      }
      function inviteRowById(id) {
        var rows = inviteRows();
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].id === id) return rows[i];
        }
        return null;
      }
      /* 码龄:候选地址跟着 NAT 端口映射活,几分钟就过期——超 3 分钟亮牌 */
      function inviteAgeText(at) {
        if (!at) return '';
        var sec = Math.max(0, Math.round((Date.now() - at) / 1000));
        if (sec < 60) return '刚生成';
        var min = Math.floor(sec / 60);
        return (sec >= 180 ? '⚠️ ' : '') + min + ' 分钟前';
      }
      function inviteStatusText(r) {
        if (r.status === 'pending') return '⏳ 等回执码 · ' + inviteAgeText(r.at);
        if (r.status === 'answering') return '🔗 正在打通直连…(最长 20 秒)';
        if (r.status === 'used') return '✅ 已使用' + (r.guest ? '—— 客人「' + r.guest + '」' : '');
        return '⚠️ 已失效' + (r.note ? '(' + r.note + ')' : '');
      }
      /* 每行的回执码输入各记各的(粘错不串行) */
      function setAnsText(id, text) {
        setAnsTexts(function (prev) {
          var nx = Object.assign({}, prev);
          nx[id] = text;
          return nx;
        });
      }

      /* 邀请码列表(主机侧,房间大厅里那块):一客一张、可同时挂多张。
       * 每行自带「复制码 / 粘回执码 / 作废」——回执码入口常驻,关弹窗不丢 */
      function renderInviteRow(r) {
        var open = openAns === r.id;
        var live = r.status === 'pending' || r.status === 'answering';
        return h('div', { key: r.id, className: 'nnk-inv-row' },
          h('div', { className: 'nnk-inv-head' },
            e('span', 'nnk-inv-id', '#' + r.id),
            h('span', { className: 'nnk-inv-state' }, (function () {
              var text = inviteStatusText(r), prefix = text.match(/^(?:⏳|🔗|✅|⚠️)/);
              if (r.status === 'pending') return e('span', 'nnk-ui-text', text);
              return prefix ? [e('span', 'nnk-ui-text', prefix[0]), text.slice(prefix[0].length)] : text;
            })()),
            r.code ? h('button', { className: 'nnk-smallbtn', onClick: function () { copyText(r.code) } }, '📋 复制码') : null,
            r.code && r.status === 'pending'
              ? h('button', { className: 'nnk-smallbtn', onClick: function () { setInvPop({ popped: r.id, dismissed: null }) } }, '🔎 再看')
              : null,
            live
              ? h('button', { className: 'nnk-smallbtn', onClick: function () { setOpenAns(open ? null : r.id) } }, open ? '收起粘贴框' : '📨 粘回执码')
              : null,
            live
              ? h('button', { className: 'nnk-smallbtn', onClick: function () { sendCmd('invite_refresh', { kind: 'cancel', id: r.id }) } }, '🗑 作废')
              : null),
          open
            ? h('div', { className: 'nnk-inv-ans' },
              e('div', 'nnk-label', '朋友回发的「回执码」贴到这一行(第 #' + r.id + ' 张码)'),
              h('textarea', { className: 'nnk-textarea nnk-code', value: ansTexts[r.id] || '', onChange: function (ev) { setAnsText(r.id, ev.target.value) }, placeholder: '粘贴这位朋友的回执码…' }),
              h('button', { className: 'nnk-copy', onClick: function () { sendCmd('accept_answer', { id: r.id, code: ansTexts[r.id] || '' }) } }, '🔗 连接'))
            : null);
      }
      function renderInviteCard() {
        var rows = inviteRows();
        var waiting = rows.filter(function (r) { return r.status === 'pending' || r.status === 'answering'; });
        return h('div', { className: 'nnk-inv-box' },
          e('div', 'nnk-label', '邀请码(一客一张,可同时挂多张)'),
          rows.length
            ? rows.map(function (r) { return renderInviteRow(r); })
            : e('div', 'nnk-hint', '还没有邀请码。朋友进不了房号门时,点下面「生成邀请码」发他一张,他进的是同一个房间。'),
          h('div', { className: 'nnk-row', style: { marginTop: '6px' } },
            h('button', { className: 'nnk-submit', style: { marginTop: '0' }, onClick: function () { sendCmd('invite_refresh', { kind: 'invite' }); setNote('📨 正在生成邀请码…生成后自动弹到屏幕中间'); } }, '📨 生成邀请码'),
            waiting.length ? e('span', 'nnk-hint', '有 ' + waiting.length + ' 张还没收尾') : null),
          e('div', 'nnk-hint', '把整段码发给朋友 → 他回发的「回执码」贴到对应那一行点「连接」。码放太久会失效(超 3 分钟会亮牌)。'));
      }

      /* 房间速览(主卡按钮与大厅弹窗共用同一套容量口径):成员表 + 当前容量 */
      function roomBrief() {
        var ev0 = onlinePickEvent(evs, 'room_members');
        var d = (ev0 && ev0.data) || {};
        /* list 恒为数组:主卡与弹窗都直接 .filter,形状坏了不该炸整页 */
        var list = Array.isArray(d.list) ? d.list : [];
        var caps = (d.caps && typeof d.caps === 'object') ? d.caps : MODE_MAX;
        /* 座位数:主机=当前选中模式的上限(点别的模式立刻变),选中的就是房间
         * 当前模式且内核报了真容量(如房间设置改了人数)时用真值;客人=房间真值 */
        var sel = isRoomHost ? roomMode : (d.mode || roomMode);
        var cap = (d.mode === sel && d.capacity) ? d.capacity : (caps[sel] || MODE_MAX[sel] || 8);
        return { data: d, list: list, caps: caps, cap: cap, has: !!ev0 };
      }

      /* 房间大厅按房号、座位和操作区排列，客人只读；头像按名字哈希取色。辅助方法使用函数声明，供前面的渲染调用。 */
      function seatColor(name) {
        var s = String(name || '?');
        var h2 = 0;
        for (var i = 0; i < s.length; i++) { h2 = (h2 * 31 + s.charCodeAt(i)) >>> 0; }
        return SEAT_COLORS[h2 % SEAT_COLORS.length];
      }
      function seatAvatar(name) {
        return h('div', { className: 'nnk-seat-avatar', style: { background: seatColor(name) } }, (name || '?').slice(0, 1));
      }
      function renderRoomModal() {
        var brief = roomBrief();
        var mData = brief.data;
        var cap = brief.cap;
        var capFor = function (m) { return brief.caps[m] || MODE_MAX[m] || 8; };
        /* 成员分席:排队的人不占容量席位,排在成员后面;空位=容量-已占席人数
         * (成员表走心跳透传,list 的形状防护在 roomBrief 里统一做) */
        var mList = brief.list;
        var sName = function (mm) { return (mm && mm.name) || '客人'; };
        var seated = mList.filter(function (mm) { return mm && !mm.queued; });
        var queuedList = mList.filter(function (mm) { return mm && mm.queued; });
        var empties = Math.max(0, cap - seated.length);
        var hostEntered = mList.some(function (mm) { return mm && mm.role === 'host' && mm.entered; });
        var seats = seated.map(function (mm, i) {
          var isHost = mm.role === 'host';
          return h('div', { key: 'm' + i, className: 'nnk-seat' + (isHost ? ' nnk-seat-host' : '') },
            seatAvatar(sName(mm)),
            h('div', { className: 'nnk-seat-name', title: sName(mm) }, isHost ? e('span', 'nnk-ui-text', '👑 ') : null, sName(mm)),
            e('div', 'nnk-seat-state', mm.entered ? '✅ 已进入' : '⏳ 等待载入'));
        }).concat(Array.apply(null, Array(empties)).map(function (_, i) {
          return h('div', { key: 'e' + i, className: 'nnk-seat nnk-seat-empty' },
            h('div', { className: 'nnk-seat-avatar nnk-ui-text' }, '🪑'),
            e('div', 'nnk-seat-state', '空位'));
        }));
        return h(ModalFrame, { title: 'NONAME-KIT 插件房间', returnFocusRef: roomOpenerRef, onClose: function () { setRoomPopupOpen(false) } },
            h('div', { className: 'nnk-rm-head' },
              e('div', 'nnk-modal-title', '🏛 NONAME-KIT 插件房间'),
              e('span', 'nnk-badge', !brief.has ? '同步中…' : (hostEntered ? '✅ 游戏房间已建好' : seated.length + '/' + cap + ' 人在房'))),
            /* 房号牌:大号等宽 + 一键复制 */
            h('div', { className: 'nnk-rm-code' },
              e('span', 'nnk-rm-codelabel', '房号'),
              e('span', 'nnk-rm-codeval', roomCode || (onlineRoom && onlineRoom.complete ? '原连接房间' : '…')),
              roomCode ? h('button', { className: 'nnk-copy', onClick: function () { copyText(roomCode) } }, '📋 复制') : null),
            /* 座位网格:成员 → 排队 → 空位;成员表还没到就显示同步中,
             * 不摆一排空位让人误以为房间是空的 */
            brief.has
              ? h('div', { className: 'nnk-rm-seats' }, seats)
              : e('div', 'nnk-hint', '正在同步房间信息…一秒内就位。'),
            queuedList.length ? h('div', {},
              e('div', 'nnk-label', '排队等待(' + queuedList.length + ' 人)'),
              h('div', { className: 'nnk-rm-queue' }, queuedList.map(function (mm, i) {
                return h('div', { key: 'q' + i, className: 'nnk-seat nnk-seat-queued' },
                  seatAvatar(sName(mm)),
                  h('div', { className: 'nnk-seat-name', title: sName(mm) }, sName(mm)),
                  e('div', 'nnk-seat-state', '🚏 排队中'));
              }))) : null,
            /* 操作区:主机换模式+载入;客人只读 */
            h('div', { className: 'nnk-rm-ops' },
              isRoomHost
                ? h('div', {},
                  e('div', 'nnk-label', '模式(应用到下一次载入)'),
                  h('div', { className: 'nnk-radios' },
                    ONLINE_MODES.map(function (m) {
                      return h('label', { key: m.id, className: 'nnk-radio' + (roomMode === m.id ? ' nnk-radio-on' : '') },
                        h('input', { type: 'radio', name: onlineScope + '-room-mode', checked: roomMode === m.id, onChange: function () { setRoomMode(m.id); sendCmd('set_mode', { mode: m.id }); } }),
                        m.name + '(最多 ' + capFor(m.id) + ' 人)');
                    })),
                  h('button', { className: 'nnk-submit', disabled: onlineRound && ['playing','settling','settled','returning','preparing','loading','seating'].indexOf(onlineRound.phase) >= 0 || onlineNext && onlineNext.retryAvailable, onClick: function () { sendCmd('restart_room', { mode: roomMode }); setNote('正在按所选模式载入游戏，原连接保持…'); } }, '🚀 载入到游戏(按所选模式)'),
                  onlineNext && onlineNext.retryAvailable ? h('button', { className: 'nnk-copy', onClick: function () { sendCmd('retry_round', {}); setNote('正在明确重试本次新局载入；原连接保持。'); } }, '明确重试本次载入(一次)') : null,
                  e('div', 'nnk-hint', '结算后点击“返回插件房间”。在这里调整模式，再点“载入到游戏”；客人自动跟随，原连接保持。'),
                  /* 邀请码列表常驻这里:码随时可复制、回执码随时可粘,不依赖弹窗 */
                  roomCode ? renderInviteCard() : null)
                : e('div', 'nnk-hint', '这里是客机的插件房间。先核对包体检；模式与载入由房主操作，他点「载入到游戏」后，你会自动跟着进房。')),
            renderManifestCard(evs, isRoomHost, true),
            renderBatchProposals(),
            e('div', 'nnk-hint', '解散或退出会结束当前联机会话并关闭原连接；下次联机需重新加入。'),
            note && (note.indexOf('正在退出') === 0 || note.indexOf('正在重新体检') === 0 || note.indexOf('❌') === 0) ? e('div', note.indexOf('❌') === 0 ? 'nnk-err' : 'nnk-hint', note) : null,
            h('div', { className: 'nnk-modal-actions' },
              h('button', { className: 'nnk-copy nnk-danger', onClick: function () { leaveRoom(isRoomHost) } }, isRoomHost ? '🗑 解散房间' : '🚪 退出房间'),
              h('button', { className: 'nnk-copy', onClick: function () { setRoomPopupOpen(false) } }, '收起(连接继续保持,可随时再打开)')));
      }

      function renderOnlinePanel() {
        return h('div', { className: 'nnk-dash nnk-online-dashboard' },
        h('div', { className: 'nnk-card nnk-dash-full nnk-online-notice' },
          h('b', { className: 'nnk-ui-text', style: { color: 'var(--dsw-alias-state-warning-primary, #b8860b)' } }, '⚠️ 联机功能仅适配官方版无名杀(无 UI 美化),第三方套壳尽力而为:'),
          h('a', { href: 'https://github.com/libnoname/noname', target: '_blank', rel: 'noopener', style: { color: 'var(--dsw-alias-brand-primary)', marginLeft: '6px' } }, 'github.com/libnoname/noname'),
          e('div', 'nnk-hint', '建议联机双方尽量使用相同版本的官方无名杀，以减少兼容性问题；不同小版本仍可尝试联机。')),
        h('div', { className: 'nnk-card nnk-dash-full nnk-online-status' },
          e('div', 'nnk-online-title', h('b', { className: 'nnk-ui-text' }, '🌐 联机助手')),
          status.batchRecovery && status.batchRecovery.status!=='none'
            ? h('div', {className:'nnk-err'},
                e('div', null, '补传批次尚未完成恢复，安装和普通扩展写入已暂停。离线恢复不需要连接房主或启动游戏。'),
                status.batchRecovery.error ? e('div', null, status.batchRecovery.error) : null,
                h('button', {className:'nnk-smallbtn', disabled:installBusy, onClick:recoverBatch}, '恢复完整批次'))
            : null,
          !status.active
            ? e('div', 'nnk-hint', status.savedDir
                ? '游戏目录已保存过,但本实例启动在先——重启 dsh 生效,或在「⚙ 设置」重新保存(立即生效)。'
                : '还没配置游戏目录——先到「⚙ 设置」页配好,再回来装内核。')
            : kernelBad
              ? h('div', {}, e('div', 'nnk-err', '❌ ' + ((kernel && kernel.error) || '内核状态未知')), h('button', { className: 'nnk-smallbtn', disabled: true, title: '请先确认游戏目录与内核状态' }, '绑定到此 DSH'))
              : h('div', { className: 'nnk-online-runtime' },
                kernel.state === 'missing' ? e('div', 'nnk-hint', '内核未安装,点下面按钮安装。')
                  : kernel.state === 'stale' ? e('div', 'nnk-hint', kernel.error || '插件更新过,内核也该升级了。')
                    : e('div', 'nnk-ok', '✅ 内核已安装' + (bridge.kernelVersion ? '(v' + bridge.kernelVersion + ')' : '')),
                bridge.state && bridge.state.transferAvailable === true
                  ? e('div', 'nnk-ok', '自动补传已就绪；客机逐批确认后接收并更新扩展，成功后自动启用，完整重启无名杀后生效。')
                  : status.runtimeStatus === 'restart_required'
                  ? e('div', 'nnk-err', '⚠️ 内核状态尚未确认：运行内核或磁盘内容不是当前版本，或旧版补传停用处理尚未就绪。请升级内核并完全重启游戏。')
                  : status.runtimeStatus === 'b0_active'
                    ? e('div', 'nnk-ok', '🛡 旧版补传已停用(运行标识:' + bridge.kernelBuild + ')')
                    : null,
                h('div', { className: 'nnk-row' },
                  kernel.state !== 'ok'
                    ? h('button', { className: 'nnk-submit', style: { marginTop: '0' }, disabled: installBusy || !!(status.batchRecovery && status.batchRecovery.status!=='none'), onClick: installKernel }, kernel.state === 'stale' ? '⬆️ 升级内核' : '📦 安装内核')
                    : h('button', { className: 'nnk-smallbtn', disabled: installBusy || !!(status.batchRecovery && status.batchRecovery.status!=='none'), onClick: installKernel }, '🔁 重装内核'),
                  h('button', { className: 'nnk-smallbtn', disabled: installBusy || kernel.state === 'missing' || kernel.state === 'unknown' || !!(status.batchRecovery && status.batchRecovery.status !== 'none'), onClick: bindKernelBridge }, '绑定到此 DSH')),
                h('div', { className: 'nnk-phaseline' },
                  bridgeOnline
                    ? e('span', 'nnk-ok', '🟢 内核在线(游戏运行中)')
                    : e('span', 'nnk-hint', onlineKernelOfflineHint(kernel, location))),
                (bridge.cfg && Array.isArray(bridge.cfg.virtualIps) && bridge.cfg.virtualIps.length)
                  ? e('div', 'nnk-ok', '🛰 直连地址已就绪:' + bridge.cfg.virtualIps.join('、') + '(虚拟网卡/公网 IPv6;自动随房号与邀请码带给对方,无需操作。IPv6 直的连不需要打洞——校园网两端都有公网 v6 时最有用)')
                  : null,
                /* 显示当前线路类型：relay 为中继，host 为局域网直连，srflx 与 prflx 为公网打洞。 */
                (function () {
                  var link = bridge.cfg && bridge.cfg.link;
                  if (!link || !link.kind) return null;
                  /* 内核离线后插件仍会保留最后一拍 cfg:别把上一场的线路当"当前" */
                  if (!bridgeOnline) return null;
                  var kindText = link.kind === 'relay' ? '中继'
                    : link.kind === 'direct' ? (link.injected ? '虚拟网卡/IPv6 直连地址' : '局域网直连')
                    : link.kind === 'p2p' ? '公网打洞直连' : link.kind;
                  var rtt = typeof link.rtt === 'number' ? link.rtt : null;
                  var slow = link.kind === 'relay' || (rtt !== null && rtt > 400);
                  return e('div', slow ? 'nnk-hint' : 'nnk-ok',
                    '🔗 当前线路:' + kindText + (rtt !== null ? ' · 往返 ' + rtt + 'ms' : '')
                    + (slow ? '(中继或延迟偏高——打洞没打穿,走的是虚拟网卡那条线。可试:两台机接同一个热点/路由器;或换国内可达的组网工具(蒲公英等,国内中继);Radmin 显示「中继」时就是走了它境外的服务器)' : ''));
                })(),
                phase !== 'idle'
                  ? e('div', 'nnk-hint', '当前状态:' + phaseText + (roomCode ? '(房号 ' + roomCode + ')' : ''))
                  : null)),
        status.active && kernel && kernel.state === 'ok'
          ? [
            /* 两栏分别使用纵向 flex 容器，使各自卡片独立紧密排列，不受另一栏展开高度影响。 */
            h('div', { key: 'col-host', className: 'nnk-col nnk-online-actions' },
            h('div', { className: 'nnk-card nnk-online-primary' },
              e('div', 'nnk-online-title', h('b', { className: 'nnk-ui-text' }, '🏠 我要当主机')),
              e('div', 'nnk-hint', '创建 P2P 房间 → 房间大厅里选模式、载入到游戏,大家自动进入(房号连不上的朋友用「📨 生成邀请码」)。开局/禁将在游戏里点。'),
              h('div', { className: 'nnk-row' },
                h('button', { className: 'nnk-submit', style: { marginTop: '0' }, disabled: !bridgeOnline || guestFlow || hostFlow || (bridge.role === 'host' && roomCode), onClick: function () { setOfferText(''); sendCmd('create_room', { mode: roomMode }); setRoomPopupOpen(true) } }, '🏛 创建 P2P 房间'),
                /* 邀请码 = 同一房间的第二道门,按需生成(一客一张、可同时挂多张)。
                 * 列表与回执码入口都在「房间大厅」里;这里只管"再来一张"和换房号。
                 * 只在主机侧显示——客人的 roomCode 是自己那个房间的 */
                roomCode && isRoomHost && phase !== 'host_booting'
                  ? h('button', { className: 'nnk-copy', style: { marginTop: '0' }, onClick: function () { sendCmd('invite_refresh', { kind: 'invite' }) } }, '📨 生成邀请码')
                  : null,
                roomCode && isRoomHost && (phase === 'room_open' || phase === 'mqtt_waiting' || phase === 'hosting')
                  ? h('button', { className: 'nnk-copy', style: { marginTop: '0' }, onClick: function () { sendCmd('invite_refresh') } }, '♻️ 换一个房号')
                  : null),
              !bridgeOnline ? e('div', 'nnk-hint', '内核离线(先启动游戏)') : null,
              (roomCode || onlineRoom && onlineRoom.complete) && isRoomHost && !roomPopupOpen
                ? h('div', { className: 'nnk-row', style: { marginTop: '8px' } },
                  h('button', { ref: roomOpenerRef, className: 'nnk-copy', style: { marginTop: '0' }, onClick: function () { setRoomPopupOpen(true) } }, (function () {
                    var b = roomBrief();
                    var seatedN = b.list.filter(function (mm) { return mm && !mm.queued; }).length;
                    return '🏛 插件房间(' + (roomCode ? '房号 ' + roomCode : '原连接') + ' · ' + seatedN + '/' + b.cap + ' 人)';
                  })()),
                  h('button', { className: 'nnk-copy nnk-danger', style: { marginTop: '0' }, onClick: function () { leaveRoom(true) } }, '🗑 解散'))
                : null,
              /* 邀请码:列表常驻在「房间大厅」里,这里给汇总入口——有码在等结果时
               * 一眼看到有几张,点它直接打开大厅并展开第一张的「粘回执码」 */
              roomCode && isRoomHost && (function () {
                var rows = inviteRows();
                var pend = rows.filter(function (r) { return r.status === 'pending'; });
                var answering = rows.filter(function (r) { return r.status === 'answering'; });
                if (!pend.length && !answering.length) return null;
                return h('button', { className: 'nnk-copy', style: { marginTop: '8px' }, onClick: function () {
                  if (pend.length) setOpenAns(pend[0].id);
                  setRoomPopupOpen(true);
                } }, '📨 ' + (pend.length ? pend.length + ' 张邀请码等回执码' + (answering.length ? '(另 ' + answering.length + ' 张在打通)' : '') : answering.length + ' 张邀请码正在打通') + ' → 去粘贴/复制');
              })()),
            h('div', { className: 'nnk-card nnk-online-primary' },
              e('div', 'nnk-online-title', h('b', { className: 'nnk-ui-text' }, '🔗 我要加入')),
              e('div', 'nnk-hint', '客机入口就在 DSH 的本页：先启动无名杀并启用联机助手，再在下方输入房主的 6 位房号。连接后进入插件房间，先核对包体检，再等房主载入；无需到游戏里另找加入按钮。'),
              h('input', { className: 'nnk-input', value: roomText, maxLength: 6, onChange: function (ev) { setRoomText(ev.target.value.toUpperCase()) }, placeholder: '输入 6 位房号,如 AB2C9X', style: { textTransform: 'uppercase', letterSpacing: '4px', fontSize: '16px' } }),
              h('button', { className: 'nnk-copy', disabled: !bridgeOnline || hostFlow || guestFlow, onClick: function () { sendCmd('join_room', { code: roomText }) } }, '🚪 加入房间'),
              guestFlow && !isRoomHost && (roomCode || onlineRoom && onlineRoom.complete)
                ? h('div', { className: 'nnk-row', style: { marginTop: '8px' } },
                  h('button', { ref: roomOpenerRef, className: 'nnk-copy', style: { marginTop: '0' }, onClick: function () { setRoomPopupOpen(true) } }, (function () {
                    var b = roomBrief();
                    var seatedN = b.list.filter(function (mm) { return mm && !mm.queued; }).length;
                    return '🏛 插件房间(' + (roomCode ? '房号 ' + roomCode : '原连接') + ' · ' + seatedN + '/' + b.cap + ' 人)';
                  })()),
                  h('button', { className: 'nnk-copy nnk-danger', style: { marginTop: '0' }, onClick: function () { leaveRoom(false) } }, '🚪 退出'))
                : null,
              showInviteFallback
                ? h('div', {},
                  e('div', 'nnk-label', '粘贴房主的邀请码'),
                  e('div', 'nnk-hint', '房号连不上时房主会给你这一段——进的是同一个房间,一样在大厅等房主载入。'),
                  h('textarea', { className: 'nnk-textarea nnk-code', value: offerText, onChange: function (ev) { setOfferText(ev.target.value) }, placeholder: '粘贴房主的邀请码…' }),
                  h('div', { className: 'nnk-row', style: { marginTop: '0' } },
                    h('button', { className: 'nnk-copy', disabled: !bridgeOnline || hostFlow || guestFlow, onClick: function () { sendCmd('join_invite', { code: offerText }) } }, '生成回执码'),
                    /* 重新来过:清掉当前这一轮的会话与输入,重新贴一张新码(房主换了码、
                     * 或自己贴错时不用等超时,也不用刷新页面)。已经进了游戏/正在进房
                     * 时不摆这个按钮——那时点它等于"退游戏重来",不该藏在弹窗化流程里 */
                    (phase === 'joining' || phase === 'answer_ready' || phase === 'lobby_waiting' || phase === 'queued')
                      ? h('button', { className: 'nnk-copy', disabled: !bridgeOnline, onClick: function () {
                        sendCmd('cancel');
                        setOfferText('');
                        setNote('↺ 已清空,重新粘贴房主的新邀请码即可');
                      } }, '↺ 重新来过')
                      : null,
                    (guestFlow && !roomCode)
                      ? h('button', { className: 'nnk-copy', disabled: !bridgeOnline, onClick: function () { leaveRoom(false) } }, '✖ 取消加入')
                      : null),
                  answerEv
                    ? h('div', { style: { marginTop: '10px' } },
                      e('div', 'nnk-label', '回执码(发回给房主)'),
                      /* 同上:e(带样式对象)会炸整页——内联样式必须用 h */
                      codeAgeText(answerEv.ts) ? h('div', { className: 'nnk-hint', style: { color: 'var(--dsw-alias-state-warning-primary, #b8860b)' } }, codeAgeText(answerEv.ts)) : null,
                      h('textarea', { className: 'nnk-textarea nnk-code', readOnly: true, value: (answerEv.data && answerEv.data.code) || '' }),
                      h('div', { className: 'nnk-row', style: { marginTop: '0' } },
                        h('button', { className: 'nnk-copy', onClick: function () { copyText((answerEv.data && answerEv.data.code) || '') } }, '📋 复制回执码'),
                        /* 弹窗误触收起后不必慌张:这里能把回执码窗口再弹回来 */
                        h('button', { className: 'nnk-copy', onClick: function () { setAnswerPopupDismissed('') } }, '🔎 再看一次')))
                    : null)
                : h('button', { className: 'nnk-copy', onClick: function () { setShowInviteFallback(true) } }, '📨 收到邀请码?从这里加入…')),
            /* 将主机、加入和配置折叠卡放入同一列，按本列内容高度紧密排列。 */
            renderFoldCard('identity', '👤 人物标识', function () { return renderIdentityCard() }),
            renderFoldCard('signaling', '📡 信令服务器', function () { return renderSignalingCard() })),
            h('div', { key: 'col-info', className: 'nnk-col nnk-online-diagnostics' },
            h('div', { className: 'nnk-card nnk-online-events' },
              e('div', 'nnk-online-title', h('b', { className: 'nnk-ui-text' }, '📡 动态')),
              h('div', { className: 'nnk-log' }, evs.some(function (ev2) { return ev2 && ev2.type !== 'room_members'; })
                ? evs.filter(function (ev2) { return ev2 && ev2.type !== 'room_members'; }).slice(-20).reverse().map(function (ev, i) {
                  return h('div', { key: i, className: 'nnk-break' }, new Date(ev.ts).toLocaleTimeString() + ' · ' + onlineEventText(ev, bridgeOnline ? evs : []));
                })
                : h('div', { className: 'nnk-hint' }, '暂无动态。'))),
            renderBatchProposals(),
            renderManifestCard(evs, hostFlow, false, !roomPopupOpen),
            renderFoldCard('help', '📖 怎么用', function () { return h('div', {},
              e('div', 'nnk-hint',
                '0.【官方版一次性】设置→通用→打开「自动导入扩展」→重载,否则扩展列表里没有「联机助手」。\n' +
                '1. 两边都装插件、配好目录;本页点「📦 安装内核」→ 游戏扩展菜单给「联机助手」点「启」→ 重载。\n' +
                '2. 主机:「创建 P2P 房间」→ 等客人加入并核对包体检 → 大厅选模式点「载入到游戏」；客人在 DSH 本页「我要加入」输入房号。房号连不上的朋友,主机点「📨 生成邀请码」发他一张——进的是同一个房间,一样等载入。结算后点“返回插件房间”，房主可换模式，再点“载入到游戏”，客人自动跟随，原连接保持。\n' +
                '3. 主机在游戏里点「开始游戏」。禁将/包/人数在等待房间右上角「房间设置」改,点「启」广播全房。'),
              e('div', 'nnk-hint', '连接信息经加密信令交换,游戏数据点对点直连。个别网络连不上房号门,就用邀请码从另一道门进(同一个房间)。')) }))]
          : null,
        note ? h('div', { className: 'nnk-dash-full ' + (note.indexOf('❌') === 0 ? 'nnk-err' : (note.indexOf('✅') === 0 ? 'nnk-ok' : '')) }, note) : null,
        roomPopupOpen && phase !== 'idle' && (roomCode || onlineRoom && onlineRoom.complete) ? renderRoomModal() : null,
        /* 新码弹窗(按行号):生成后自动弹一次;误触收起不影响——列表里随时能复制,
         * 那行的「🔎 再看」也能重开 */
        (function () {
          var row = invPop.popped && invPop.dismissed !== invPop.popped ? inviteRowById(invPop.popped) : null;
          return row && row.status === 'pending' && row.code ? renderInviteModal(row) : null;
        })(),
        phase === 'answer_ready' && answerEv && (answerEv.data && answerEv.data.code) && answerPopupDismissed !== answerEv.data.code
          ? renderAnswerModal(answerEv) : null
        );
      }
    }

    // ── 工坊页(五个子页签:任务 / 任务列表 / 历史 / 联机 / 设置) ───
    function WorkshopView(props) {
      var sessionId = props.sessionId;
      // Hooks 规则:所有 hook 必须在任何条件返回之前声明
      var ready = React.useState(null); // null=检测中, false=需初始化, true=正常
      var phase = ready[0], setPhase = ready[1];
      var viewId = React.useId();
      var tab = React.useState('new');
      var active = tab[0], setActive = tab[1];
      React.useEffect(function () {
        fetch('/noname-kit-api/status').then(function (r) { return r.json() }).then(function (status) {
          setPhase(Boolean(status.active));
        }, function () { setPhase(true) }); // 服务不可用时照常显示,工具会自行报错
      }, []);
      React.useEffect(function () {
        // 未配置游戏目录时默认落在「⚙ 设置」页:新用户第一眼就是配置入口
        if (phase === false) setActive('settings');
      }, [phase]);
      var presetFlip = React.useState(false);
      var presetFlipDone = presetFlip[0], setPresetFlipDone = presetFlip[1];
      React.useEffect(function () {
        if (presetFlipDone) return
        // 开发模式尚未安装时默认打开设置页，用户可从该页重装 preset。
        healthBus.refresh().then(function (body) {
          setPresetFlipDone(true)
          var preset = body && body.preset
          if (preset && preset.state === 'missing') setActive('settings')
        })
      }, [presetFlipDone]);
      var send = function (text) {
        var session = sessionId;
        return Promise.resolve(session).then(function (id) {
          // sessions 服务由插件 inject 提供;绑定当前会话并发送结构化消息。
          // 新版对未打开的会话 binding() 返回 undefined——判空让调用方走报错,而不是 TypeError
          var sessions = props.sessions;
          var binding = sessions.binding(id);
          if (!binding || !binding.session) throw new Error('目标会话未打开或已关闭');
          return binding.session.prompt([{ type: 'text', text: text }], 'queue');
        });
      };
      if (phase === null) return e('div', 'nnk-hint', '正在检查插件配置…');

      /* 在页面边界捕获异常并显示错误内容，防止子页面异常导致整个工坊空白。 */
      try {
        return h('div', { className: 'nnk-wrap' },
          h('div', { className: 'nnk-appearancebar' },
            e('span', 'nnk-identity nnk-modern-only', 'NONAME-KIT'), h(AppearanceSwitch)),
          h(WorkshopTabs, { active: active, setActive: setActive, id: viewId }),
          h(WorkshopPage, { active: active, id: viewId },
          phase === false && active === 'new' ? e('div', 'nnk-err', '⚠️ 还没配置游戏目录——到「⚙ 设置」页填一下就能自动写入;暂时不配也行,把写入方式设为「手动复制」。') : null,
          active === 'new' ? h(NewTaskForm, { send: send }) : null,
          active === 'tasklist' ? h(TaskListContent, { sessions: props.sessions, uiSession: props.uiSession }) : null,
          active === 'history' ? h(HistoryPanel) : null,
          active === 'online' ? h(OnlinePanel) : null,
          active === 'settings' ? h(SettingsPanel) : null
          )
        );
      } catch (viewErr) {
        console.error('[联机助手] 工坊页渲染出错(' + active + '):', viewErr);
        return e('div', 'nnk-err', '❌ 工坊页渲染出错(' + active + ' 页): ' + ((viewErr && viewErr.message) || viewErr) + ' —— 请截图本行文字发给开发者');
      }
    }

    // ── 工具结果卡片 ────────────────────────────────────────────
    /** 从 ToolCallBlock 提取参数与结果(兼容运行中/已结束两种形态)。 */
    function parseBlock(block) {
      block = block || {};
      var settled = Boolean(block.call);
      var argsRaw = (settled ? block.call.argsRaw : block.argsRaw) || '{}';
      var args = {};
      try { args = JSON.parse(argsRaw) } catch (e) { args = {} }
      var text = '';
      if (settled && Array.isArray(block.content)) {
        text = block.content.map(function (c) { return (c && typeof c.text === 'string') ? c.text : '' }).join('\n');
      }
      return { args: args, text: text, settled: settled, isError: settled && block.isError };
    }

    function ValidateCard(props) {
      var parsed = parseBlock(props.block);
      if (!parsed.settled) return e('div', 'nnk-hint', '⏳ 正在校验扩展代码…');
      if (parsed.isError) return e('div', 'nnk-err', '❌ 校验返回异常,详见文本结果。');
      // render 文本是工具结果的唯一载体(无结构化值通道),按文本前缀判定,正文全量展示
      var ok = (parsed.text || '').indexOf('校验通过') === 0;
      return h('div', { className: 'nnk-tool-result' },
        e('div', {}, h('b', null, '扩展代码校验')),
        ok ? e('div', 'nnk-ok', '✅ 校验通过') : e('div', 'nnk-err', '❌ 校验未通过(未写入)'),
        h('pre', { className: 'nnk-note', style: { whiteSpace: 'pre-wrap', maxHeight: '260px', overflow: 'auto' } }, parsed.text || '(无返回)')
      );
    }

    function WriteCard(props) {
      var parsed = parseBlock(props.block);
      if (!parsed.settled) return e('div', 'nnk-hint', '⏳ 正在校验并写入扩展…');
      if (parsed.isError) return e('div', 'nnk-err', '❌ 写入返回异常,详见文本结果。');
      var text = parsed.text || '';
      var head = text.split('\n')[0] || '';
      var title = head.indexOf('已写入') === 0 ? '✅ 扩展已写入'
        : head.indexOf('手动模式') === 0 ? '📋 代码已生成(手动复制模式)'
        : (head.indexOf('写入被拒') === 0 || head.indexOf('校验未通过') === 0) ? '❌ 未写入'
        : '写入结果';
      return h('div', { className: 'nnk-tool-result' },
        e('div', {}, h('b', { className: 'nnk-ui-text' }, title)),
        head.indexOf('手动模式') === 0 ? e('div', 'nnk-hint', '代码在 AI 的消息里,从对话中的代码块复制保存到目标文件即可。') : null,
        h('pre', { className: 'nnk-note', style: { whiteSpace: 'pre-wrap', maxHeight: '260px', overflow: 'auto' } }, text)
      );
    }

    function CompleteCard(props) {
      var parsed = parseBlock(props.block);
      if (!parsed.settled) return e('div', 'nnk-hint', '⏳ 正在标记技能…');
      if (parsed.isError) return e('div', 'nnk-err', '❌ 收口返回异常,详见文本结果。');
      var text = parsed.text || '';
      var ok = text.indexOf('已标记') === 0;
      return h('div', { className: 'nnk-tool-result' },
        e('div', {}, h('b', { className: 'nnk-ui-text' }, ok ? '🏁 技能已写入,待游戏测试' : '⚠️ 收口未完成')),
        h('div', { className: ok ? 'nnk-ok' : 'nnk-err', 'data-nnk-literal': true }, text),
        ok ? null : e('div', 'nnk-hint', '若任务列表状态未更新,可让 AI 重试收口;或直接在「📋 任务列表」里操作。')
      );
    }

    // ── 悬浮任务列表小窗(全局,shell.overlay + 侧栏按钮) ───────
    var panelBus = {
      open: false,
      subs: [],
      set: function (v) { this.open = v; this.subs.forEach(function (f) { f(v) }) },
      sub: function (f) { var self = this; this.subs.push(f); return function () { self.subs = self.subs.filter(function (x) { return x !== f }) } },
    };

    /**
     * 读「当前打开会话」的 id,兼容新旧两版 DSH(上游 0.1.6 起旧版字段被移除):
     * 1) uiSession.adapter.current.getSnapshot().key —— 两版都在的 UI 层读法,首选;
     * 2) sessions.list.getSnapshot().current —— 旧版专用,0.1.6 起读不到;
     * 3) sessions.list.getSnapshot().byId 里 retainedBy.mainView > 0 —— 新版官方姿势。
     * 任一步形状不对就跳下一步;全失败返回 null,调用方走「没有会话」提示。
     */
    function readCurrentSessionId(sessions, uiSession) {
      try {
        var current = uiSession && uiSession.adapter && uiSession.adapter.current;
        var bound = current && current.getSnapshot ? current.getSnapshot() : null;
        if (bound && bound.key) return bound.key;
      } catch (e) {}
      try {
        var snap = sessions && sessions.list && sessions.list.getSnapshot ? sessions.list.getSnapshot() : null;
        if (snap && snap.current) return snap.current;
        if (snap && snap.byId) {
          var ids = Object.keys(snap.byId);
          for (var i = 0; i < ids.length; i++) {
            var row = snap.byId[ids[i]];
            if (row && row.retainedBy && (row.retainedBy.mainView || 0) > 0) return row.id;
          }
        }
      } catch (e) {}
      return null;
    }

    /** 任务列表内容(浮窗与工坊子页共用):进行中/已完成分区、反馈、删除。 */
    function TaskListContent(props) {
      var sessions = props && props.sessions;
      var uiSession = props && props.uiSession;
      var data = React.useState({ list: [], loading: false, expanded: null, fbFor: null, issue: '', busy: false, err: '', msg: '' });
      var box = data[0], setBox = data[1];
      var setD = function (patch) { setBox(function (prev) { return Object.assign({}, prev, patch) }) };

      var load = function () {
        setD({ loading: true });
        fetch('/noname-kit-api/tasks').then(function (r) { return r.json() }).then(function (body) {
          setD({ loading: false, list: body.tasks || [] });
        }, function () { setD({ loading: false, err: '任务列表获取失败' }) });
      };
      React.useEffect(function () { load() }, []);

      var SKILL_BADGE = { open: ['nnk-status-open', '🟡待实现'], written: ['nnk-status-written', '🟠待测试'], confirmed: ['nnk-status-done', '✅已确认'] };

      var confirmSkill = function (task, skill) {
        fetch('/noname-kit-api/tasks/skill-status', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, skill: skill, status: 'confirmed' }),
        }).then(function (r) { return r.json() }).then(function (b) {
          if (!b.ok) { setD({ err: b.error || '操作失败' }); return }
          setD({ msg: b.autoCompleted ? '🎉 「' + task.id + '」全部技能确认且图片/配音就位,自动完成并归档!' : '' });
          load();
        }, function (error) { setD({ err: error && error.message || String(error) }) });
      };
      var addImage = function (task) {
        var p = window.prompt('图片本地路径(将复制进扩展包 image/ 目录):', '');
        if (!p || !p.trim()) return;
        var base = p.trim().split(/[\\/]/).pop() || '';
        var name = window.prompt('包内保存的文件名(武将立绘/卡面图建议用「内部ID.jpg」,AI 预留的路径以交付说明为准):', base);
        if (!name || !name.trim()) return;
        fetch('/noname-kit-api/tasks/image', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, folder: task.folder, source: p.trim(), fileName: name.trim() }),
        }).then(function (r) { return r.json() }).then(function (b) {
          if (!b.ok) { setD({ err: b.error || '补图失败' }); return }
          setD({ msg: '📷 「' + task.id + '」图片已复制进扩展包: ' + (b.copied || []).join(', ') + (b.autoCompleted ? ' —— 🎉 全部确认+图片配音就位,自动完成并归档!' : '') });
          load();
        }, function (error) { setD({ err: error && error.message || String(error) }) });
      };
      /** 补配音:源路径 → 目标(skill/…或die/…)→ 技能配音再问归属技能。
       * 与补图同语义:复制进包 + 登记任务一步到位,补齐触发自动完成。 */
      var addAudio = function (task) {
        var p = window.prompt('配音文件本地路径(mp3):', '');
        if (!p || !p.trim()) return;
        var t = window.prompt('存入包内的目标(相对 audio/ 目录):\n技能配音: skill/内部ID1.mp3(多句从 1 连号)\n阵亡语音: die/武将ID.mp3', 'skill/');
        if (!t || !t.trim()) return;
        t = t.trim().replace(/\\/g, '/');
        var skill = '';
        if (/^skill\//i.test(t)) {
          var names = (Array.isArray(task.skills) ? task.skills : []).map(function (s) { return s.name }).join('、');
          skill = window.prompt('这句配音属于哪个技能?(填任务里的技能显示名:\n' + names + ')', '');
          if (!skill || !skill.trim()) return;
          skill = skill.trim();
        }
        fetch('/noname-kit-api/tasks/audio', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, folder: task.folder, source: p.trim(), target: t, skill: skill }),
        }).then(function (r) { return r.json() }).then(function (b) {
          if (!b.ok) { setD({ err: b.error || '补配音失败' }); return }
          setD({ msg: '🔊 「' + task.id + '」配音已复制进扩展包: ' + (b.copied || []).join(', ') + (b.autoCompleted ? ' —— 🎉 全部确认+图片配音就位,自动完成并归档!' : '') });
          load();
        }, function (error) { setD({ err: error && error.message || String(error) }) });
      };
      var feedbackSubmit = function (task, skill) {
        if (!box.issue.trim()) { setD({ err: '问题描述不能为空' }); return }
        setD({ busy: true, err: '' });
        fetch('/noname-kit-api/tasks/feedback', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, skill: skill || '', issue: box.issue.trim() }),
        }).then(function (r) { return r.json() }).then(function (fb) {
          if (!fb.ok) throw new Error(fb.error || '记录失败');
          var sendErr = null;
          try {
            var sid = readCurrentSessionId(sessions, uiSession);
            if (sid) {
              var text = [
                '【无名杀工坊·问题反馈】',
                '任务ID: ' + task.id,
                '目标扩展文件夹: ' + task.folder,
                skill ? '问题技能: ' + skill : '',
                '当前轮次: 第 ' + fb.task.rounds + ' 轮',
                '── 问题描述/游戏内表现/报错 ──',
                box.issue.trim(),
                '── 执行要求 ──',
                '先 noname_read_extension 读取当前代码,定位问题并说明原因,修复后 noname_validate,校验通过后写入。修复后调用 noname_skills_written,原样带回任务ID ' + task.id + '。',
              ].filter(Boolean).join('\n');
              var binding = sessions.binding(sid);
              if (!binding || !binding.session) {
                sendErr = '反馈已记录,但目标会话已关闭——请打开会话后重试';
              } else {
                Promise.resolve(binding.session.prompt([{ type: 'text', text: text }], 'queue')).catch(function (e) {
                  setD(function (prev) { return Object.assign({}, prev, { err: '反馈已记录,但发送失败: ' + (e && e.message || e) }) });
                });
              }
            } else {
              sendErr = '已记录反馈,但当前没有打开的会话——请打开会话后重试,或把反馈粘贴到对话里';
            }
          } catch (e) { sendErr = '反馈已记录,但发送失败: ' + (e && e.message || e) }
          setD({ busy: false, issue: '', fbFor: null, err: sendErr || '' });
          load();
        }).catch(function (error) { setD({ busy: false, err: error && error.message || String(error) }) });
      };
      var markDone = function (task) {
        // 防呆:缺图或技能未全确认时,手动完成会绕过「缺图不自动完成」的保护——
        // 弹确认把状态亮出来,用户明确选择才放行(不剥夺自由度,只防手滑)
        var skills = Array.isArray(task.skills) ? task.skills : [];
        var confirmed = skills.filter(function (s) { return s.status === 'confirmed' }).length;
        var warn = [];
        if (!task.image && task.type !== 'mode' && !task.target) warn.push('未登记图片');   /* 编辑任务不涉及图片(与浮窗展示逻辑同口径) */
        if (skills.length && confirmed < skills.length) warn.push('技能确认 ' + confirmed + '/' + skills.length);
        if (audioNeed(task)) warn.push('有已登记未交付的配音');
        if (warn.length && !window.confirm('「' + task.id + '」' + warn.join('、') + '。\n确定仍要标记完成并归档吗?')) return;
        fetch('/noname-kit-api/tasks/complete', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          /* 任务完成时同时提交 notes，将技能写入过程中登记的引擎级注意点保存到 history.notes。 */
          body: JSON.stringify({ taskId: task.id, notes: task.notes || [], summary: task.summary || '手动标记完成' + (skills.length ? '(确认 ' + confirmed + '/' + skills.length + ')' : '') }),
        }).then(function (r) { return r.json() }).then(function (body) {
          if (!body.ok) { setD({ err: body.error || '完成失败' }); return }
          load();
        }, function (error) { setD({ err: error && error.message || String(error) }) });
      };
      var reopenTask = function (task) {
        fetch('/noname-kit-api/tasks/reopen', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: task.id }),
        }).then(function (r) { return r.json() }).then(function (body) {
          if (!body.ok) { setD({ err: body.error || '重开失败' }); return }
          setD({ msg: '🔁 「' + task.id + '」已重开——补图/补配音或重新确认后可再次收口' });
          load();
        }, function (error) { setD({ err: error && error.message || String(error) }) });
      };
      var removeTask = function (task) {
        var msg = '删除任务「' + task.id + '」?\n\n将清除:任务记录、轮次、反馈日志。\n不会删除:已写入的扩展代码、备份文件、历史归档。';
        if (!window.confirm(msg)) return;
        fetch('/noname-kit-api/tasks/delete', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: task.id }),
        }).then(function (r) { return r.json() }).then(function (body) {
          if (!body.ok) { setD({ err: body.error || '删除失败' }); return }
          load();
        }, function (error) { setD({ err: error && error.message || String(error) }) });
      };

      if (box.loading) return e('div', 'nnk-hint', '加载中…');
      var fmt = function (ts) { return new Date(ts).toLocaleString() };
      var open = box.list.filter(function (t) { return t.status === 'open' });
      var done = box.list.filter(function (t) { return t.status !== 'open' });

      /** 任务是否还有已登记未交付的配音(技能级或阵亡语音):决定「🔊 补配音」按钮与提示。 */
      var audioNeed = function (task) {
        var lack = (Array.isArray(task.skills) ? task.skills : []).some(function (s) {
          return s.audios && s.audios.length && (!s.audioFiles || s.audioFiles.length < s.audios.length);
        });
        var dieLack = task.dieAudios && task.dieAudios.length &&
          (!task.dieAudioFiles || task.dieAudioFiles.length < task.dieAudios.length);
        return lack || dieLack;
      };

      var renderRow = function (task, isDoneSection) {
        var expanded = box.expanded === task.id;
        var fbTarget = box.fbFor && box.fbFor.id === task.id ? box.fbFor : null;
        var skills = Array.isArray(task.skills) ? task.skills : [];
        var isModeTask = task.type === 'mode';
        return h('div', { key: task.id, className: 'nnk-taskrow' },
          h('div', { className: 'nnk-task-title' },
            h('span', { className: 'nnk-badge ' + (task.status === 'open' ? 'nnk-status-open' : 'nnk-status-done') },
              task.status === 'open' ? '🔵进行中' : '✅已完成'),
            h('b', null, task.id)
          ),
          h('div', { className: 'nnk-taskmeta' }, e('span', 'nnk-ui-text', '📂 '), task.folder + ' · 返工 ' + task.rounds + ' 轮 · ' + fmt(task.updatedAt)),
          skills.length
            ? e('div', 'nnk-taskmeta nnk-ui-text', (isModeTask ? '规则确认进度: ' : '技能确认进度: ') + skills.filter(function (s) { return s.status === 'confirmed' }).length + '/' + skills.length + (isModeTask ? ' · 模式任务:不涉及图片' : (!task.image && !task.target ? ' · 📷 缺图片(不登记图片不会自动完成)' : (!task.image && task.target ? ' · 编辑任务:不涉及图片' : ''))) + (audioNeed(task) ? ' · 🔊 缺配音(已登记的配音复制齐才会自动完成)' : ''))
            : null,
          h('div', { className: 'nnk-task-actions' },
            h('button', { className: 'nnk-smallbtn', onClick: function () { setD({ expanded: expanded ? null : task.id, fbFor: null, msg: '' }) } }, expanded ? '收起' : (skills.length ? '展开技能树' : '展开')),
            !isDoneSection ? h('button', { className: 'nnk-smallbtn', onClick: function () { setD({ expanded: task.id, fbFor: fbTarget && !fbTarget.skill ? null : { id: task.id, skill: '' }, issue: '', msg: '' }) } }, '🔁 反馈') : null,
            !isDoneSection && !task.image && !isModeTask ? h('button', { className: 'nnk-smallbtn', onClick: function () { addImage(task) } }, '📷 补图') : null,
            !isDoneSection && audioNeed(task) ? h('button', { className: 'nnk-smallbtn', onClick: function () { addAudio(task) } }, '🔊 补配音') : null,
            !isDoneSection ? h('button', { className: 'nnk-smallbtn', onClick: function () { markDone(task) } }, '✅ 标记完成') : null,
            isDoneSection ? h('button', { className: 'nnk-smallbtn', title: '回到进行中:可补图/补配音或重新确认后再次收口' , onClick: function () { reopenTask(task) } }, '🔁 重开') : null,
            h('button', { className: 'nnk-smallbtn nnk-danger', onClick: function () { removeTask(task) } }, '🗑 删除')
          ),
          expanded && skills.length ? h('div', { className: 'nnk-task-skills', role: 'list' }, skills.map(function (s, i) {
            var badge = SKILL_BADGE[s.status] || SKILL_BADGE.open;
            return h('div', { key: s.name + '-' + i, className: 'nnk-card nnk-task-skill', role: 'listitem', style: { padding: '8px', marginBottom: '4px' } },
              h('div', { className: 'nnk-task-skill-head', style: { display: 'flex', gap: '6px', alignItems: 'center' } },
                h('span', { className: 'nnk-badge ' + badge[0] }, badge[1]),
                h('b', { style: { fontSize: '12px' } }, (i + 1) + '. ' + (s.name || '(未命名)')),
                s.rounds ? e('span', 'nnk-hint', '返工 ' + s.rounds + ' 轮') : null,
                h('span', { style: { flex: '1' } }),
                !isDoneSection && s.status !== 'confirmed' ? h('button', { className: 'nnk-smallbtn', onClick: function () { confirmSkill(task, s.name) } }, '✅ 确认无误') : null,
                !isDoneSection ? h('button', { className: 'nnk-smallbtn', onClick: function () { setD({ expanded: task.id, fbFor: fbTarget && fbTarget.skill === s.name ? null : { id: task.id, skill: s.name }, issue: '', msg: '' }) } }, '🔁 反馈') : null
              ),
              s.desc ? h('div', { className: 'nnk-hint', 'data-nnk-literal': true }, s.desc.slice(0, 100) + (s.desc.length > 100 ? '…' : '')) : null,
              s.feedbacks && s.feedbacks.length ? s.feedbacks.map(function (f, j) {
                return e('div', 'nnk-fbrow', '第' + (j + 1) + '轮: ' + (f.issue || '').slice(0, 80));
              }) : null
            );
          })) : null,
          expanded && fbTarget && !isDoneSection ? h('div', { className: 'nnk-task-feedback' },
            e('div', 'nnk-hint', '向' + (fbTarget.skill ? '技能「' + fbTarget.skill + '」' : '任务「' + task.id + '」') + '反馈(记录后自动发给当前会话的 AI):'),
            h('textarea', {
              className: 'nnk-mini', value: box.issue,
              placeholder: '现象 / game.log 输出 / 报错',
              onChange: function (ev) { setD({ issue: ev.target.value }) },
            }),
            h('button', { className: 'nnk-smallbtn', disabled: box.busy, onClick: function () { feedbackSubmit(task, fbTarget.skill) } }, box.busy ? '提交中…' : '提交反馈')
          ) : null,
          expanded && task.feedbacks && task.feedbacks.length
            ? task.feedbacks.map(function (fb, i) {
                // 反馈按提交时间正序编号，第 1 轮对应首次提交的问题。
                return e('div', 'nnk-fbrow', '第' + (i + 1) + '轮反馈' + (fb.skill ? '(' + fb.skill + ')' : '') + ': ' + (fb.issue || '').slice(0, 80))
              })
            : null
        );
      };

      return h('div', { className: 'nnk-task-list' },
        box.err ? e('div', 'nnk-err', box.err) : null,
        box.msg ? e('div', 'nnk-ok', box.msg) : null,
        e('div', 'nnk-hint', '🔵 进行中 ' + open.length + ' 个 · ✅ 已完成 ' + done.length + ' 个'),
        open.length ? h('div', {}, open.map(function (task) { return renderRow(task, false) })) : e('div', 'nnk-hint', '没有进行中的任务。在工坊「🛠 任务」页创建一个吧。'),
        done.length ? [
          e('div', 'nnk-label', '已完成'),
          h('div', {}, done.map(function (task) { return renderRow(task, true) }))
        ] : null
      );
    }

    /** 按当前视口钳制 localStorage 中保存的浮窗位置；双击标题栏可复位。 */
    function usePanelViewport(active) {
      var updateViewport = React.useState(0)[1];
      React.useEffect(function () {
        if (!active) return;
        var onResize = function () { updateViewport(function (value) { return value + 1 }) };
        window.addEventListener('resize', onResize);
        return function () { window.removeEventListener('resize', onResize) };
      }, [active]);
    }

    function clampPanelPos(pos, width) {
      var vw = window.innerWidth || 1200;
      var vh = window.innerHeight || 800;
      return {
        x: Math.min(Math.max(8, Number(pos.x) || 8), Math.max(8, vw - width - 8)),
        y: Math.min(Math.max(8, Number(pos.y) || 8), Math.max(8, vh - 240))
      };
    }

    /** 悬浮窗框架:拖动/位置记忆/开关,内容复用 TaskListContent。 */
    function TaskPanelWindow(props) {
      var sessions = props && props.sessions;
      var uiSession = props && props.uiSession;
      var openState = React.useState(panelBus.open);
      var isOpen = openState[0], setIsOpen = openState[1];
      usePanelViewport(isOpen);
      var posState = React.useState(function () {
        try { return JSON.parse(localStorage.getItem('dsh-noname-kit.panelPos')) || { x: 90, y: 70 } } catch (e) { return { x: 90, y: 70 } }
      });
      var pos = posState[0], setPos = posState[1];
      var dragCleanup = React.useRef(null);
      React.useEffect(function () { return function () { if (dragCleanup.current) dragCleanup.current() } }, []);

      React.useEffect(function () { return panelBus.sub(function (v) { setIsOpen(v) }) }, []);

      // 拖动:标题栏 mousedown → document mousemove/mouseup
      var startDrag = function (ev) {
        if (dragCleanup.current) dragCleanup.current();
        var origin = clampPanelPos(pos, 380);
        var startX = ev.clientX - origin.x, startY = ev.clientY - origin.y;
        var latest = null;
        var move = function (e2) {
          var next = { x: Math.max(0, e2.clientX - startX), y: Math.max(0, e2.clientY - startY) };
          latest = next;
          setPos(next);
        };
        var clearDrag = function () {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          if (dragCleanup.current === clearDrag) dragCleanup.current = null;
        };
        var up = function () {
          clearDrag();
          // 闭包里的 pos 是拖动前的快照,必须存 move 里更新过的 latest
          try { localStorage.setItem('dsh-noname-kit.panelPos', JSON.stringify(latest || pos)) } catch (e) {}
        };
        dragCleanup.current = clearDrag;
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      };

      if (!isOpen) return null;
      var safePos = clampPanelPos(pos, 380);
      return h('div', { className: 'nnk-panel', style: { '--nnk-panel-y': safePos.y + 'px', '--nnk-panel-limit': '560px', left: safePos.x + 'px', top: safePos.y + 'px', maxHeight: 'min(560px, calc(100vh - 24px))' } },
        h('div', { className: 'nnk-panel-head', onMouseDown: startDrag, onDoubleClick: function () {
          var d = { x: 90, y: 70 };
          setPos(d);
          try { localStorage.setItem('dsh-noname-kit.panelPos', JSON.stringify(d)) } catch (e) {}
        }, title: '拖动移动 · 双击复位' },
        e('span', 'nnk-panel-title', '📋 无名杀任务列表'),
          h('button', { className: 'nnk-panel-close', onClick: function () { panelBus.set(false) } }, '✕')
        ),
        h('div', { className: 'nnk-panel-body' }, h(TaskListContent, { sessions: sessions, uiSession: uiSession }))
      );
    }

    /** 侧栏底部按钮:开关任务浮窗(wide=侧栏展开, false=56px 窄轨只显示图标)。 */
    function SidebarTaskButton(props) {
      var openState = React.useState(panelBus.open);
      var isOpen = openState[0], setIsOpen = openState[1];
      React.useEffect(function () { return panelBus.sub(function (v) { setIsOpen(v) }) }, []);
      var wide = props && props.wide !== false;
      return h('button', {
        className: 'nnk-smallbtn',
        style: wide ? {} : { fontSize: '16px', padding: '4px' },
        title: '无名杀任务列表',
        onClick: function () { panelBus.set(!panelBus.open) },
      }, wide ? (isOpen ? '📋 关闭任务列表' : '📋 任务列表') : '📋');
    }

    /** 工坊浮窗总线:输入条工坊入口按钮开关(hero 初始屏与任意会话可见)。 */
    var workshopBus = {
      open: false,
      subs: [],
      set: function (v) { this.open = v; this.subs.forEach(function (f) { f(v) }) },
      sub: function (f) { var self = this; this.subs.push(f); return function () { self.subs = self.subs.filter(function (x) { return x !== f }) } },
    };

    /** 版本/一致性状态:🛠 按钮的红点与 ⚙ 设置页共用一份,避免两处各查一次。
     *  GET /noname-kit-api/update 只做本地探测(读 profile 的 package.json + 算
     *  preset 哈希),版本信息取服务端进程内的 6 小时缓存,不发网络请求。 */
    var healthBus = {
      state: { loaded: false, failed: false, update: null, preset: null, updateCheck: true, installForm: null, installHint: null },
      subs: [],
      // 先将新状态保存到局部变量，再通知订阅者，避免回调中 this 的变化影响状态读取。
      set: function (next) {
        this.state = Object.assign({}, this.state, next);
        var snapshot = this.state;
        this.subs.forEach(function (f) { f(snapshot) });
      },
      sub: function (f) { var self = this; this.subs.push(f); return function () { self.subs = self.subs.filter(function (x) { return x !== f }) } },
      adopt: function (body) {
        this.set({
          loaded: true, failed: false,
          update: body.check || null,
          preset: body.preset || null,
          updateCheck: body.updateCheck !== false,
          installForm: body.installForm || null,
          installHint: body.installHint || null,
        });
        return body;
      },
      refresh: function () {
        var self = this;
        return fetch('/noname-kit-api/update').then(function (r) { return r.json() })
          .then(function (body) { return self.adopt(body) },
            function () { self.set({ loaded: true, failed: true }); return null });
      },
      attentionText: function () {
        var s = this.state;
        if (s.preset && s.preset.state === 'missing') return '「无名杀开发模式」preset 未安装'
        if (s.preset && s.preset.state === 'stale') return 'preset 与插件版本不一致'
        if (s.update && s.update.hasUpdate) return '插件有新版本 v' + s.update.latest
        return ''
      },
    };

    /** 输入条工坊入口:conversation.input.left 是 list 插槽,追加不替换官方件。 */
    function WorkshopChipButton(props) {
      var openState = React.useState(workshopBus.open);
      var isOpen = openState[0], setIsOpen = openState[1];
      var healthState = React.useState(healthBus.state);
      var health = healthState[0], setHealth = healthState[1];
      React.useEffect(function () { return workshopBus.sub(function (v) { setIsOpen(v) }) }, []);
      React.useEffect(function () {
        var off = healthBus.sub(setHealth);
        healthBus.refresh();
        return off;
      }, []);
      var attention = healthBus.attentionText();
      return h('button', {
        type: 'button',
        className: 'nnk-smallbtn',
        style: { margin: '0 6px', whiteSpace: 'nowrap' },
        title: '无名杀工坊:创建任务 / 任务列表 / 历史' + (attention ? '(⚠️ ' + attention + ')' : ''),
        onClick: function () { workshopBus.set(!workshopBus.open) },
      }, isOpen ? '🛠 关闭工坊' : '🛠 工坊', attention ? h('span', { className: 'nnk-dot' }) : null);
    }

    /** 工坊浮窗:初始屏/任意会话用浮层承载整个工坊页;任务发进当前会话。 */
    function WorkshopPanelWindow(props) {
      var sessions = props && props.sessions;
      var uiSession = props && props.uiSession;
      var openState = React.useState(workshopBus.open);
      var isOpen = openState[0], setIsOpen = openState[1];
      usePanelViewport(isOpen);
      var posState = React.useState(function () {
        try { return JSON.parse(localStorage.getItem('dsh-noname-kit.workshopPanelPos')) || { x: 620, y: 70 } } catch (e) { return { x: 620, y: 70 } }
      });
      var pos = posState[0], setPos = posState[1];
      var dragCleanup = React.useRef(null);
      React.useEffect(function () { return function () { if (dragCleanup.current) dragCleanup.current() } }, []);
      React.useEffect(function () { return workshopBus.sub(function (v) { setIsOpen(v) }) }, []);
      var startDrag = function (ev) {
        if (dragCleanup.current) dragCleanup.current();
        var origin = clampPanelPos(pos, 420);
        var startX = ev.clientX - origin.x, startY = ev.clientY - origin.y;
        var latest = null;
        var move = function (e2) { var next = { x: Math.max(0, e2.clientX - startX), y: Math.max(0, e2.clientY - startY) }; latest = next; setPos(next) };
        var clearDrag = function () {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          if (dragCleanup.current === clearDrag) dragCleanup.current = null;
        };
        var up = function () {
          clearDrag();
          try { localStorage.setItem('dsh-noname-kit.workshopPanelPos', JSON.stringify(latest || pos)) } catch (e) {}
        };
        dragCleanup.current = clearDrag;
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      };
      if (!isOpen) return null;
      var sid = readCurrentSessionId(sessions, uiSession);
      var safePos = clampPanelPos(pos, 420);
      return h('div', { className: 'nnk-panel', style: { '--nnk-panel-y': safePos.y + 'px', '--nnk-panel-limit': '640px', left: safePos.x + 'px', top: safePos.y + 'px', width: '420px', maxHeight: 'min(640px, calc(100vh - 24px))' } },
        h('div', { className: 'nnk-panel-head', onMouseDown: startDrag, onDoubleClick: function () {
          var d = { x: 620, y: 70 };
          setPos(d);
          try { localStorage.setItem('dsh-noname-kit.workshopPanelPos', JSON.stringify(d)) } catch (e) {}
        }, title: '拖动移动 · 双击复位' },
        e('span', 'nnk-panel-title', '🛠 无名杀工坊'),
          h('button', { className: 'nnk-panel-close', onClick: function () { workshopBus.set(false) } }, '✕')
        ),
        h('div', { className: 'nnk-panel-body' },
          sid
            ? h(WorkshopView, { sessionId: sid, sessions: sessions, uiSession: uiSession })
            : e('div', 'nnk-hint', '当前没有会话——先新建会话,再用工坊派任务。')
        )
      );
    }

    exports.apply = function (ctx) {
      ctx.effect(mountMotionLifecycle);
      var slots = ctx.get('slots');
      var sessions = ctx.get('sessions');
      // uiSession 容错取:不进 inject——某版缺这个服务时只降级「当前会话」读法,不拖垮插件
      var uiSession = null;
      try { uiSession = ctx.get('uiSession') || null } catch (e) {}

      // 顶部页签(与官方"轨迹"同一插槽,order 排在后面)
      slots.inject('conversation.view', function () {
        return slots.register({
          name: 'conversation.view',
          id: 'noname-workshop',
          order: 20,
          label: function () { return '无名杀工坊' },
          inject: function (sessionId) { return { sessionId: sessionId } },
        }, function (props) {
          props = props || {};
          // DSH 布局的侧栏拖宽手柄是透明覆盖层,侵入内容区约 40px(z=8):
          // 工坊内容贴左渲染时,左侧按钮的点击会被它吃掉(现象=点了没反应)。
          // 留出安全边距让内容避开手柄热区;手柄压在空白上,拖拽功能不受影响。
          return React.createElement(AppearanceScope, null,
            React.createElement('div', { className: 'nnk-host-frame', style: { paddingLeft: '48px' } },
              React.createElement(WorkshopView, Object.assign({}, props, { sessions: sessions, uiSession: uiSession }))));
        });
      });

      // 工具结果卡片(按工具名认领渲染)
      var card = function (key, component) {
        slots.inject('tool.call.toolview', function () {
          return slots.register({ name: 'tool.call.toolview', key: key }, function (props) {
            return React.createElement(AppearanceScope, null, React.createElement(component, props));
          });
        });
      };
      card('noname_validate', ValidateCard);
      card('noname_write_extension', WriteCard);
      card('noname_skills_written', CompleteCard);

      // 悬浮任务列表:侧栏按钮开关 + shell 浮层渲染(传 sessions 供浮窗反馈发消息)
      ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register({ name: 'sidebar.footer.action', id: 'noname-kit-tasks', order: 5 }, function (props) {
          return React.createElement(AppearanceScope, null, React.createElement(SidebarTaskButton, props));
        });
      });
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: 'noname-kit-tasks' }, function (props) {
          return React.createElement(AppearanceScope, null, React.createElement(TaskPanelWindow, Object.assign({}, props, { sessions: sessions, uiSession: uiSession })));
        });
      });

      // 工坊入口:输入条 list 插槽(hero 初始屏与任意会话都渲染)+ 独立工坊浮层。
      // 纯插件方案,不动 DSH 源码——发布自包含是硬约束。
      ctx.slots.inject('conversation.input.left', function () {
        return ctx.slots.register({ name: 'conversation.input.left', id: 'noname-workshop-chip', order: 90 }, function (props) {
          return React.createElement(AppearanceScope, null, React.createElement(WorkshopChipButton, props));
        });
      });
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: 'noname-kit-workshop' }, function (props) {
          return React.createElement(AppearanceScope, null, React.createElement(WorkshopPanelWindow, Object.assign({}, props, { sessions: sessions, uiSession: uiSession })));
        });
      });
    };

    exports.inject = ['slots', 'sessions'];
    return module.exports;
  }
});
