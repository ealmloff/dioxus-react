import type { WryRuntime } from "./runtime";

/**
 * RawKeyboard/RawMouse/RawTouchscreen for the wry webview. Playwright's
 * Keyboard/Mouse sit on top and produce these raw events; we turn them into
 * synthetic DOM events dispatched through the eval bridge. No OS-level input
 * is available inside a webview.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const BUTTON_CODES: Record<string, number> = { left: 0, middle: 1, right: 2, none: 0, back: 3, forward: 4 };
const BUTTON_MASKS: Record<string, number> = { left: 1, right: 2, middle: 4, back: 8, forward: 16 };

const btn = (b: string) => BUTTON_CODES[b] ?? 0;
const btns = (s: Set<string>) => { let m = 0; for (const b of s) m |= BUTTON_MASKS[b] ?? 0; return m; };
const mods = (s: Set<string>) => ({
  shiftKey: s.has("Shift"), ctrlKey: s.has("Control"), altKey: s.has("Alt"), metaKey: s.has("Meta"),
});

function dispatch(runtime: WryRuntime, payload: Record<string, unknown>, body: string): Promise<unknown> {
  return runtime.call("rawEvaluateJSON", `(function(p){${body};return null;})(${JSON.stringify(payload)})`);
}

const KEY_BODY = `
  var t=document.activeElement||document.body;
  var init={bubbles:true,cancelable:true,composed:true,view:window,key:p.key,code:p.code,location:p.location,repeat:p.repeat,keyCode:p.keyCode,which:p.keyCode,charCode:0,shiftKey:p.shiftKey,ctrlKey:p.ctrlKey,altKey:p.altKey,metaKey:p.metaKey};
  t.dispatchEvent(new KeyboardEvent(p.type,init));
  if(p.type==="keydown"&&p.text&&!(p.ctrlKey||p.metaKey||p.altKey)){
    if((t.tagName==="INPUT"||t.tagName==="TEXTAREA")&&!t.readOnly&&!t.disabled){
      var s=t.selectionStart??t.value.length,e=t.selectionEnd??t.value.length;
      var proto=t.tagName==="INPUT"?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;
      var setter=Object.getOwnPropertyDescriptor(proto,"value");
      var next=t.value.slice(0,s)+p.text+t.value.slice(e);
      if(setter&&setter.set)setter.set.call(t,next);else t.value=next;
      try{t.selectionStart=t.selectionEnd=s+p.text.length;}catch(_){}
      t.dispatchEvent(new InputEvent("input",{bubbles:true,composed:true,inputType:"insertText",data:p.text}));
    }else if(t.isContentEditable){document.execCommand&&document.execCommand("insertText",false,p.text);}
  }`;

const TEXT_BODY = `
  var t=document.activeElement||document.body;
  if((t.tagName==="INPUT"||t.tagName==="TEXTAREA")&&!t.readOnly&&!t.disabled){
    var s=t.selectionStart??t.value.length,e=t.selectionEnd??t.value.length;
    var proto=t.tagName==="INPUT"?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;
    var setter=Object.getOwnPropertyDescriptor(proto,"value");
    var next=t.value.slice(0,s)+p.text+t.value.slice(e);
    if(setter&&setter.set)setter.set.call(t,next);else t.value=next;
    try{t.selectionStart=t.selectionEnd=s+p.text.length;}catch(_){}
    t.dispatchEvent(new InputEvent("input",{bubbles:true,composed:true,inputType:"insertText",data:p.text}));
  }else if(t.isContentEditable){document.execCommand&&document.execCommand("insertText",false,p.text);}`;

const MOUSE_BODY = `
  var t=document.elementFromPoint(p.x,p.y)||document.body;
  var init={bubbles:true,cancelable:true,composed:true,view:window,clientX:p.x,clientY:p.y,screenX:p.x,screenY:p.y,button:p.button,buttons:p.buttons,detail:p.clickCount,shiftKey:p.shiftKey,ctrlKey:p.ctrlKey,altKey:p.altKey,metaKey:p.metaKey};
  t.dispatchEvent(new MouseEvent(p.type,init));
  var pt=p.type==="mousemove"?"pointermove":(p.type==="mousedown"?"pointerdown":"pointerup");
  t.dispatchEvent(new PointerEvent(pt,Object.assign({pointerId:1,pointerType:"mouse",isPrimary:true,width:1,height:1,pressure:p.type==="mousedown"?0.5:0},init)));
  if(p.type==="mouseup"&&p.clickCount>=1){
    t.dispatchEvent(new MouseEvent("click",init));
    if(p.clickCount===2)t.dispatchEvent(new MouseEvent("dblclick",init));
  }`;

const WHEEL_BODY = `
  var t=document.elementFromPoint(p.x,p.y)||document.body;
  t.dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,composed:true,view:window,clientX:p.x,clientY:p.y,deltaX:p.deltaX,deltaY:p.deltaY,deltaMode:0,buttons:p.buttons,shiftKey:p.shiftKey,ctrlKey:p.ctrlKey,altKey:p.altKey,metaKey:p.metaKey}));`;

const TAP_BODY = `
  var t=document.elementFromPoint(p.x,p.y)||document.body;
  var c={bubbles:true,cancelable:true,composed:true,view:window,clientX:p.x,clientY:p.y,shiftKey:p.shiftKey,ctrlKey:p.ctrlKey,altKey:p.altKey,metaKey:p.metaKey};
  t.dispatchEvent(new PointerEvent("pointerdown",Object.assign({pointerId:2,pointerType:"touch",isPrimary:true},c)));
  t.dispatchEvent(new PointerEvent("pointerup",Object.assign({pointerId:2,pointerType:"touch",isPrimary:true},c)));
  t.dispatchEvent(new MouseEvent("click",c));`;

type Desc = { code: string; key: string; location: number; keyCodeWithoutLocation: number; text: string };

export class WryRawKeyboard {
  constructor(private r: WryRuntime) {}
  keydown(_p: any, m: Set<string>, _n: string, d: Desc, repeat: boolean) {
    return dispatch(this.r, { type: "keydown", key: d.key, code: d.code, keyCode: d.keyCodeWithoutLocation, location: d.location, repeat, text: d.text, ...mods(m) }, KEY_BODY);
  }
  keyup(_p: any, m: Set<string>, _n: string, d: Desc) {
    return dispatch(this.r, { type: "keyup", key: d.key, code: d.code, keyCode: d.keyCodeWithoutLocation, location: d.location, repeat: false, text: "", ...mods(m) }, KEY_BODY);
  }
  sendText(_p: any, text: string) {
    return dispatch(this.r, { text }, TEXT_BODY);
  }
}

export class WryRawMouse {
  constructor(private r: WryRuntime) {}
  move(_p: any, x: number, y: number, b: string, bs: Set<string>, m: Set<string>) {
    return dispatch(this.r, { type: "mousemove", x, y, button: btn(b), buttons: btns(bs), clickCount: 0, ...mods(m) }, MOUSE_BODY);
  }
  down(_p: any, x: number, y: number, b: string, bs: Set<string>, m: Set<string>, clickCount: number) {
    return dispatch(this.r, { type: "mousedown", x, y, button: btn(b), buttons: btns(bs), clickCount, ...mods(m) }, MOUSE_BODY);
  }
  up(_p: any, x: number, y: number, b: string, bs: Set<string>, m: Set<string>, clickCount: number) {
    return dispatch(this.r, { type: "mouseup", x, y, button: btn(b), buttons: btns(bs), clickCount, ...mods(m) }, MOUSE_BODY);
  }
  wheel(_p: any, x: number, y: number, bs: Set<string>, m: Set<string>, deltaX: number, deltaY: number) {
    return dispatch(this.r, { x, y, buttons: btns(bs), deltaX, deltaY, ...mods(m) }, WHEEL_BODY);
  }
}

export class WryRawTouchscreen {
  constructor(private r: WryRuntime) {}
  tap(_p: any, x: number, y: number, m: Set<string>) {
    return dispatch(this.r, { x, y, ...mods(m) }, TAP_BODY);
  }
}
