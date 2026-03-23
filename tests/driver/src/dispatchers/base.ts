import { Dispatcher, SdkObject } from "../internals";

export class ProxyObject extends SdkObject {
  constructor(parent: any, prefix: string) {
    super(parent, prefix);
  }
}

export class DummyDispatcher extends Dispatcher {
  constructor(parent: any, object: any, type: string, initializer: any = {}) {
    super(parent, object, type, initializer);
    this._type_EventTarget = true;
  }

  async updateSubscription(): Promise<void> {}
}
