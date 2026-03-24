import { Dispatcher, SdkObject } from "../internals";

type DispatcherLike = InstanceType<typeof Dispatcher>;

export class ProxyObject extends SdkObject {
  [key: string]: unknown;

  constructor(parent: object, prefix: string) {
    super(parent, prefix);
  }
}

export class DummyDispatcher extends Dispatcher {
  constructor(
    parent: DispatcherLike,
    object: object,
    type: string,
    initializer: Record<string, unknown> = {}
  ) {
    super(parent, object, type, initializer);
    this._type_EventTarget = true;
  }

  async updateSubscription(): Promise<void> {}
}
