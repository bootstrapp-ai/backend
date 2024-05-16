import idbAdapter from "../indexeddb/index.js";
import { generateId } from "../utils.js";
import { CrudReactiveRecord } from "./crud.js";

let oplog;
let queue;
class ReactiveRecord extends CrudReactiveRecord {
  constructor(
    { _init, ...properties },
    { name, appId, userId, logOperations, store, models },
  ) {
    super();
    this.name = name;
    this.models = models;
    this.adapter = idbAdapter;
    this.properties = properties;    
    this.referenceKey = Object.keys(properties)[0];
    this.appId = appId;
    this.userId = userId;
    this.store = store;
    if (logOperations) {
      // TODO: create one store and reuse it globally
      oplog = this.adapter.createStore(`${this.appId}_oplog`, "kv");
      this.oplog = oplog;
      queue = this.adapter.createStore(`${this.appId}_queue`, "kv");
      this.queue = queue;
    }

    if (_init) {
      _init(this);
    }
  }
  async isEmpty() {
    return this.adapter.isEmpty(this.store);
  }

  async logOp(key, value = null) {
    if (oplog) {
      const operationId = generateId(this.appId, this.userId);
      const propKey = `${this.name}_${key}`;
      await this.adapter.set([[`${propKey}_${operationId}`, value]], oplog);
      await this.adapter.setLastOp(`${propKey}_${operationId}`, value, {
        db: queue,
        propKey,
      });
    }
  }
}

export { ReactiveRecord };
