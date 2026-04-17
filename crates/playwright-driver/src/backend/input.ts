import type { WryRuntime } from "./runtime";

/**
 * RawKeyboard / RawMouse / RawTouchscreen implementations for the wry webview.
 *
 * Playwright's Keyboard/Mouse/Touchscreen classes sit on top of a "raw" driver
 * that normally issues CDP Input.dispatchKeyEvent / dispatchMouseEvent calls.
 * Inside a webview we have no OS-level input pipeline, so instead we dispatch
 * synthetic DOM events directly via the existing eval bridge.
 *
 * The signatures match input.Keyboard / input.Mouse / input.Touchscreen's
 * raw-delegate contract (see node_modules/playwright-core/lib/server/input.js
 * and chromium/crInput.js).
 */

interface KeyDescription {
  code: string;
  key: string;
  location: number;
  keyCodeWithoutLocation: number;
  text: string;
}

const BUTTON_CODES: Record<string, number> = {
  left: 0,
  middle: 1,
  right: 2,
  none: 0,
  back: 3,
  forward: 4,
};

const BUTTON_MASKS: Record<string, number> = {
  left: 1,
  right: 2,
  middle: 4,
  back: 8,
  forward: 16,
};

function buttonCode(button: string): number {
  return BUTTON_CODES[button] ?? 0;
}

function buttonsMask(buttons: Set<string>): number {
  let mask = 0;
  for (const b of buttons) mask |= BUTTON_MASKS[b] ?? 0;
  return mask;
}

function modifierFlags(modifiers: Set<string>): {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
} {
  return {
    shiftKey: modifiers.has("Shift"),
    ctrlKey: modifiers.has("Control"),
    altKey: modifiers.has("Alt"),
    metaKey: modifiers.has("Meta"),
  };
}

export class WryRawKeyboard {
  constructor(private readonly runtime: WryRuntime) {}

  async keydown(
    _progress: unknown,
    modifiers: Set<string>,
    _keyName: string,
    description: KeyDescription,
    autoRepeat: boolean,
  ): Promise<void> {
    const payload = {
      type: "keydown" as const,
      key: description.key,
      code: description.code,
      keyCode: description.keyCodeWithoutLocation,
      location: description.location,
      repeat: autoRepeat,
      text: description.text,
      ...modifierFlags(modifiers),
    };
    await this.runtime.call("rawEvaluateJSON", dispatchKeyboardScript(payload));
  }

  async keyup(
    _progress: unknown,
    modifiers: Set<string>,
    _keyName: string,
    description: KeyDescription,
  ): Promise<void> {
    const payload = {
      type: "keyup" as const,
      key: description.key,
      code: description.code,
      keyCode: description.keyCodeWithoutLocation,
      location: description.location,
      repeat: false,
      text: "",
      ...modifierFlags(modifiers),
    };
    await this.runtime.call("rawEvaluateJSON", dispatchKeyboardScript(payload));
  }

  async sendText(_progress: unknown, text: string): Promise<void> {
    await this.runtime.call("rawEvaluateJSON", insertTextScript(text));
  }
}

export class WryRawMouse {
  constructor(private readonly runtime: WryRuntime) {}

  async move(
    _progress: unknown,
    x: number,
    y: number,
    button: string,
    buttons: Set<string>,
    modifiers: Set<string>,
    _forClick?: boolean,
  ): Promise<void> {
    await this.runtime.call(
      "rawEvaluateJSON",
      dispatchMouseScript({
        type: "mousemove",
        x,
        y,
        button: buttonCode(button),
        buttons: buttonsMask(buttons),
        clickCount: 0,
        ...modifierFlags(modifiers),
      }),
    );
  }

  async down(
    _progress: unknown,
    x: number,
    y: number,
    button: string,
    buttons: Set<string>,
    modifiers: Set<string>,
    clickCount: number,
  ): Promise<void> {
    await this.runtime.call(
      "rawEvaluateJSON",
      dispatchMouseScript({
        type: "mousedown",
        x,
        y,
        button: buttonCode(button),
        buttons: buttonsMask(buttons),
        clickCount,
        ...modifierFlags(modifiers),
      }),
    );
  }

  async up(
    _progress: unknown,
    x: number,
    y: number,
    button: string,
    buttons: Set<string>,
    modifiers: Set<string>,
    clickCount: number,
  ): Promise<void> {
    await this.runtime.call(
      "rawEvaluateJSON",
      dispatchMouseScript({
        type: "mouseup",
        x,
        y,
        button: buttonCode(button),
        buttons: buttonsMask(buttons),
        clickCount,
        ...modifierFlags(modifiers),
      }),
    );
  }

  async wheel(
    _progress: unknown,
    x: number,
    y: number,
    buttons: Set<string>,
    modifiers: Set<string>,
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    await this.runtime.call(
      "rawEvaluateJSON",
      dispatchWheelScript({
        x,
        y,
        buttons: buttonsMask(buttons),
        deltaX,
        deltaY,
        ...modifierFlags(modifiers),
      }),
    );
  }
}

export class WryRawTouchscreen {
  constructor(private readonly runtime: WryRuntime) {}

  async tap(_progress: unknown, x: number, y: number, modifiers: Set<string>): Promise<void> {
    await this.runtime.call(
      "rawEvaluateJSON",
      dispatchTouchScript({ x, y, ...modifierFlags(modifiers) }),
    );
  }
}

// --- Inline JS builders ---
// These produce a single expression the runtime evaluates synchronously.
// Everything stays in one round trip to keep input fidelity close to CDP
// (which is also single-roundtrip per raw event).

interface KeyboardPayload {
  type: "keydown" | "keyup";
  key: string;
  code: string;
  keyCode: number;
  location: number;
  repeat: boolean;
  text: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

function dispatchKeyboardScript(payload: KeyboardPayload): string {
  return `(function(p){
    var target = document.activeElement || document.body;
    var init = {
      bubbles: true, cancelable: true, composed: true, view: window,
      key: p.key, code: p.code, location: p.location, repeat: p.repeat,
      keyCode: p.keyCode, which: p.keyCode, charCode: 0,
      shiftKey: p.shiftKey, ctrlKey: p.ctrlKey, altKey: p.altKey, metaKey: p.metaKey
    };
    target.dispatchEvent(new KeyboardEvent(p.type, init));
    if (p.type === "keydown" && p.text && !(p.ctrlKey || p.metaKey || p.altKey)) {
      if ((target.tagName === "INPUT" || target.tagName === "TEXTAREA") && !target.readOnly && !target.disabled) {
        var start = typeof target.selectionStart === "number" ? target.selectionStart : target.value.length;
        var end = typeof target.selectionEnd === "number" ? target.selectionEnd : target.value.length;
        var next = target.value.slice(0, start) + p.text + target.value.slice(end);
        var proto = target.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        var descriptor = Object.getOwnPropertyDescriptor(proto, "value");
        if (descriptor && descriptor.set) descriptor.set.call(target, next);
        else target.value = next;
        try { target.selectionStart = target.selectionEnd = start + p.text.length; } catch (e) {}
        target.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: p.text }));
      } else if (target.isContentEditable) {
        document.execCommand && document.execCommand("insertText", false, p.text);
      }
    }
    return null;
  })(${JSON.stringify(payload)})`;
}

function insertTextScript(text: string): string {
  return `(function(t){
    var target = document.activeElement || document.body;
    if ((target.tagName === "INPUT" || target.tagName === "TEXTAREA") && !target.readOnly && !target.disabled) {
      var start = typeof target.selectionStart === "number" ? target.selectionStart : target.value.length;
      var end = typeof target.selectionEnd === "number" ? target.selectionEnd : target.value.length;
      var next = target.value.slice(0, start) + t + target.value.slice(end);
      var proto = target.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      var descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && descriptor.set) descriptor.set.call(target, next);
      else target.value = next;
      try { target.selectionStart = target.selectionEnd = start + t.length; } catch (e) {}
      target.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: t }));
    } else if (target.isContentEditable) {
      document.execCommand && document.execCommand("insertText", false, t);
    }
    return null;
  })(${JSON.stringify(text)})`;
}

interface MousePayload {
  type: "mousemove" | "mousedown" | "mouseup";
  x: number;
  y: number;
  button: number;
  buttons: number;
  clickCount: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

function dispatchMouseScript(payload: MousePayload): string {
  return `(function(p){
    var target = document.elementFromPoint(p.x, p.y) || document.body;
    var init = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y,
      button: p.button, buttons: p.buttons, detail: p.clickCount,
      shiftKey: p.shiftKey, ctrlKey: p.ctrlKey, altKey: p.altKey, metaKey: p.metaKey
    };
    target.dispatchEvent(new MouseEvent(p.type, init));
    var pointerType = p.type === "mousemove" ? "pointermove" : (p.type === "mousedown" ? "pointerdown" : "pointerup");
    var pointerInit = Object.assign({ pointerId: 1, pointerType: "mouse", isPrimary: true, width: 1, height: 1, pressure: p.type === "mousedown" ? 0.5 : 0 }, init);
    target.dispatchEvent(new PointerEvent(pointerType, pointerInit));
    if (p.type === "mouseup" && p.clickCount >= 1) {
      target.dispatchEvent(new MouseEvent("click", init));
      if (p.clickCount === 2) target.dispatchEvent(new MouseEvent("dblclick", init));
    }
    return null;
  })(${JSON.stringify(payload)})`;
}

interface WheelPayload {
  x: number;
  y: number;
  buttons: number;
  deltaX: number;
  deltaY: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

function dispatchWheelScript(payload: WheelPayload): string {
  return `(function(p){
    var target = document.elementFromPoint(p.x, p.y) || document.body;
    target.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: p.x, clientY: p.y,
      deltaX: p.deltaX, deltaY: p.deltaY, deltaMode: 0,
      buttons: p.buttons,
      shiftKey: p.shiftKey, ctrlKey: p.ctrlKey, altKey: p.altKey, metaKey: p.metaKey
    }));
    return null;
  })(${JSON.stringify(payload)})`;
}

interface TouchPayload {
  x: number;
  y: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

function dispatchTouchScript(payload: TouchPayload): string {
  return `(function(p){
    var target = document.elementFromPoint(p.x, p.y) || document.body;
    var common = {
      bubbles: true, cancelable: true, composed: true, view: window,
      shiftKey: p.shiftKey, ctrlKey: p.ctrlKey, altKey: p.altKey, metaKey: p.metaKey,
      clientX: p.x, clientY: p.y
    };
    target.dispatchEvent(new PointerEvent("pointerdown", Object.assign({ pointerId: 2, pointerType: "touch", isPrimary: true }, common)));
    target.dispatchEvent(new PointerEvent("pointerup", Object.assign({ pointerId: 2, pointerType: "touch", isPrimary: true }, common)));
    target.dispatchEvent(new MouseEvent("click", common));
    return null;
  })(${JSON.stringify(payload)})`;
}
