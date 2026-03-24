import type { ProxyAppController } from "../controller";
import { Dispatcher, serializeResult } from "../internals";
import { ProxyObject } from "./base";
import type { HandleMeta } from "../types";

export class ProxyHandleDispatcher extends Dispatcher {
  readonly handleId: number;
  private handleOwnerFrame: any;
  private controller: ProxyAppController;

  constructor(
    parent: any,
    controller: ProxyAppController,
    meta: HandleMeta,
    ownerFrame: any
  ) {
    const object = new ProxyObject(parent._object, "proxyHandle");
    super(parent, object, meta.type === "element" ? "ElementHandle" : "JSHandle", {
      preview: meta.preview,
    });
    this.controller = controller;
    this.handleId = meta.id;
    this.handleOwnerFrame = ownerFrame;
  }

  async evaluateExpression(params: any): Promise<{ value: unknown }> {
    return {
      value: serializeResult(
        await this.controller.evaluateOnHandle(
          this.handleId,
          params.expression,
          params.isFunction,
          params.arg
        )
      ),
    };
  }

  async evaluateExpressionHandle(params: any): Promise<{ handle: ProxyHandleDispatcher }> {
    const meta = await this.controller.evaluateHandleOnHandle(
      this.handleId,
      params.expression,
      params.isFunction,
      params.arg
    );
    return {
      handle: new ProxyHandleDispatcher(
        this.parentScope(),
        this.controller,
        meta,
        this.handleOwnerFrame
      ),
    };
  }

  async getProperty(params: any): Promise<{ handle: ProxyHandleDispatcher }> {
    const meta = await this.controller.getHandleProperty(this.handleId, params.name);
    return {
      handle: new ProxyHandleDispatcher(
        this.parentScope(),
        this.controller,
        meta,
        this.handleOwnerFrame
      ),
    };
  }

  async getPropertyList(): Promise<{
    properties: Array<{ name: string; value: ProxyHandleDispatcher }>;
  }> {
    const properties = await this.controller.getHandleProperties(this.handleId);
    return {
      properties: properties.map((entry) => ({
        name: entry.name,
        value: new ProxyHandleDispatcher(
          this.parentScope(),
          this.controller,
          entry.handle,
          this.handleOwnerFrame
        ),
      })),
    };
  }

  async ownerFrame(): Promise<{ frame: any }> {
    return { frame: this.handleOwnerFrame };
  }

  async contentFrame(): Promise<{ frame: null }> {
    return { frame: null };
  }

  async jsonValue(): Promise<{ value: unknown }> {
    return { value: serializeResult(await this.controller.handleJsonValue(this.handleId)) };
  }

  async dispose(): Promise<void> {
    await this.controller.disposeHandle(this.handleId);
    this._dispose();
  }

  async getAttribute(params: any): Promise<{ value?: string }> {
    const value = await this.controller.getAttribute(null, null, this.handleId, params.name);
    return value === null ? {} : { value };
  }

  async inputValue(): Promise<{ value: string }> {
    return { value: await this.controller.inputValue(null, null, this.handleId) };
  }

  async textContent(): Promise<{ value?: string }> {
    const value = await this.controller.textContent(null, null, this.handleId);
    return value === null ? {} : { value };
  }

  async innerText(): Promise<{ value: string }> {
    return { value: await this.controller.innerText(null, null, this.handleId) };
  }

  async innerHTML(): Promise<{ value: string }> {
    return { value: await this.controller.innerHTML(null, null, this.handleId) };
  }

  async isChecked(): Promise<{ value: boolean }> {
    return { value: await this.controller.boolState("isChecked", null, null, this.handleId) };
  }

  async isDisabled(): Promise<{ value: boolean }> {
    return { value: await this.controller.boolState("isDisabled", null, null, this.handleId) };
  }

  async isEditable(): Promise<{ value: boolean }> {
    return { value: await this.controller.boolState("isEditable", null, null, this.handleId) };
  }

  async isEnabled(): Promise<{ value: boolean }> {
    return { value: await this.controller.boolState("isEnabled", null, null, this.handleId) };
  }

  async isHidden(): Promise<{ value: boolean }> {
    return { value: await this.controller.boolState("isHidden", null, null, this.handleId) };
  }

  async isVisible(): Promise<{ value: boolean }> {
    return { value: await this.controller.boolState("isVisible", null, null, this.handleId) };
  }

  async dispatchEvent(params: any): Promise<void> {
    await this.controller.dispatchEvent(
      null,
      null,
      this.handleId,
      params.type,
      params.eventInit
    );
  }

  async scrollIntoViewIfNeeded(): Promise<void> {
    await this.controller.scrollIntoViewIfNeeded(this.handleId);
  }

  async hover(): Promise<void> {
    await this.controller.hover(null, null, this.handleId);
  }

  async click(): Promise<void> {
    await this.controller.click(null, null, this.handleId);
  }

  async dblclick(): Promise<void> {
    await this.controller.dblclick(null, null, this.handleId);
  }

  async tap(): Promise<void> {
    await this.click();
  }

  async selectOption(params: any): Promise<{ values: string[] }> {
    return {
      values: await this.controller.selectOption(
        null,
        null,
        this.handleId,
        params.options || [],
        params.elements || []
      ),
    };
  }

  async fill(params: any): Promise<void> {
    await this.controller.fill(null, null, this.handleId, params.value);
  }

  async focus(): Promise<void> {
    await this.controller.focus(null, null, this.handleId);
  }

  async type(params: any): Promise<void> {
    await this.controller.type(null, null, this.handleId, params.text);
  }

  async press(params: any): Promise<void> {
    await this.controller.press(null, null, this.handleId, params.key);
  }

  async check(params: any): Promise<void> {
    await this.controller.setChecked(null, null, this.handleId, true, params.trial);
  }

  async uncheck(params: any): Promise<void> {
    await this.controller.setChecked(null, null, this.handleId, false, params.trial);
  }

  async querySelector(params: any): Promise<{ element?: ProxyHandleDispatcher }> {
    const meta = await this.controller.querySelector(
      params.selector,
      this.handleId,
      params.strict
    );
    return {
      element: meta
        ? new ProxyHandleDispatcher(
            this.parentScope(),
            this.controller,
            meta,
            this.handleOwnerFrame
          )
        : undefined,
    };
  }

  async querySelectorAll(params: any): Promise<{ elements: ProxyHandleDispatcher[] }> {
    const elements = await this.controller.querySelectorAll(params.selector, this.handleId);
    return {
      elements: elements.map(
        (meta) =>
          new ProxyHandleDispatcher(
            this.parentScope(),
            this.controller,
            meta,
            this.handleOwnerFrame
          )
      ),
    };
  }

  async evalOnSelector(params: any): Promise<{ value: unknown }> {
    return {
      value: serializeResult(
        await this.controller.evalOnSelector(
          params.selector,
          this.handleId,
          params.expression,
          params.isFunction,
          params.arg,
          params.strict
        )
      ),
    };
  }

  async evalOnSelectorAll(params: any): Promise<{ value: unknown }> {
    return {
      value: serializeResult(
        await this.controller.evalOnSelectorAll(
          params.selector,
          this.handleId,
          params.expression,
          params.isFunction,
          params.arg
        )
      ),
    };
  }

  async waitForSelector(params: any): Promise<{ element?: ProxyHandleDispatcher }> {
    const meta = await this.controller.waitForSelector(
      params.selector,
      this.handleId,
      params.state,
      params.timeout,
      params.strict
    );
    return {
      element: meta
        ? new ProxyHandleDispatcher(this.parentScope(), this.controller, meta, this.handleOwnerFrame)
        : undefined,
    };
  }
}
