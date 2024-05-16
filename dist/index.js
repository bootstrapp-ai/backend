// indexeddb/utils.js
var promisifyRequest = (request) => {
  return new Promise((resolve, reject) => {
    request.oncomplete = request.onsuccess = () => resolve(request.result);
    request.onabort = request.onerror = () => reject(request.error);
  });
};
var executeRequest = (request) => new Promise((resolve, reject) => {
  request.oncomplete = request.onsuccess = () => resolve(request.result);
  request.onabort = request.onerror = () => reject(request.error);
});
var tableOperation = (table, mode, operation) => table(mode, (store) => executeRequest(operation(store)));
var iterateCursor = (request, process) => new Promise((resolve, reject) => {
  const items = [];
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) {
      process(items, cursor);
      cursor.continue();
    } else {
      resolve(items);
    }
  };
  request.onerror = () => reject(request.error);
});
var processKeys = (items, cursor) => items.push(cursor.key);
var processValues = (items, cursor) => items.push(cursor.value);
var processEntries = (items, cursor) => items.push([cursor.key, cursor.value]);
var entries = (table) => tableOperation(
  table,
  "readonly",
  (store) => store.getAll && store.getAllKeys ? Promise.all([
    executeRequest(store.getAllKeys()),
    executeRequest(store.getAll())
  ]).then(([keys2, values2]) => keys2.map((key, i) => [key, values2[i]])) : iterateCursor(store.openCursor(), processEntries)
);
var startsWith = (prefix, table, config = { index: true, keepKey: false }) => table("readonly", (store) => {
  const range = IDBKeyRange.bound(prefix, prefix + "\uFFFF");
  return iterateCursor(store.openCursor(range), (items, cursor) => {
    const id = config.keepKey ? cursor.key : cursor.key.split("_")[1];
    items.push(config.index ? id : { id, [prefix]: cursor.value });
  });
});
var getCount = (table) => tableOperation(table, "readonly", (store) => store.count());
var isEmpty = (table) => getCount(table).then((count) => count === 0);
var clear = (table) => tableOperation(table, "readwrite", (store) => store.clear());
var keys = (table) => tableOperation(
  table,
  "readonly",
  (store) => store.getAllKeys ? store.getAllKeys() : iterateCursor(store.openCursor(), processKeys)
);
var values = (table) => tableOperation(
  table,
  "readonly",
  (store) => store.getAll ? store.getAll() : iterateCursor(store.openCursor(), processValues)
);

// indexeddb/crud.js
var getItem = (key, table) => {
  return table("readonly", (store) => promisifyRequest(store.get(key)));
};
var get = (keys2, table) => {
  return table(
    "readonly",
    (store) => Promise.all(keys2.map((key) => promisifyRequest(store.get(key))))
  );
};
var set = (entries2, table) => {
  return table("readwrite", (store) => {
    entries2.forEach((entry) => store.put(entry[1], entry[0]));
    return promisifyRequest(store.transaction);
  });
};
var remove = (keys2, table) => {
  return table("readwrite", (store) => {
    keys2.forEach((key) => store.delete(key));
    return promisifyRequest(store.transaction);
  });
};
var update = (key, updater, db) => {
  return db(
    "readwrite",
    (store) => new Promise((resolve, reject) => {
      store.get(key).onsuccess = function() {
        try {
          store.put(updater(this.result), key);
          resolve(promisifyRequest(store.transaction));
        } catch (err) {
          reject(err);
        }
      };
    })
  );
};
var setLastOp = async (key, value, config) => {
  const { db, propKey } = config;
  const keys2 = await startsWith(propKey, db, { index: true, keepKey: true });
  await remove(keys2, db);
  set([key, value], db);
};

// indexeddb/index.js
var createStore = (dbName = "bootstrapp", storeName = "kv") => {
  const request = indexedDB.open(dbName);
  request.onupgradeneeded = () => request.result.createObjectStore(storeName);
  const dbp = promisifyRequest(request);
  return (txMode, callback) => dbp.then(
    (db) => callback(db.transaction(storeName, txMode).objectStore(storeName))
  );
};
var createDatabase = (dbName = "bootstrapp", storeNames = ["kv"], version = 1) => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      storeNames.forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      });
    };
    request.onerror = (event) => {
      console.log(event.target);
      reject(new Error(`IndexedDB error: ${event.target.error}`));
    };
    request.onsuccess = (event) => {
      const db = event.target.result;
      const stores = {};
      storeNames.forEach((storeName) => {
        stores[storeName] = (txMode, callback) => {
          return new Promise((resolve2, reject2) => {
            try {
              const transaction = db.transaction(storeName, txMode);
              const objectStore = transaction.objectStore(storeName);
              Promise.resolve(callback(objectStore)).then(resolve2).catch(reject2);
            } catch (error) {
              console.error({ storeName, error });
              reject2(new Error("Transaction failed", error));
            }
          });
        };
      });
      resolve(stores);
    };
  });
};
var idbAdapter = {
  clear,
  entries,
  values,
  getCount,
  startsWith,
  keys,
  isEmpty,
  createStore,
  createDatabase,
  get,
  getItem,
  remove,
  set,
  setLastOp,
  update
};
var indexeddb_default = idbAdapter;

// utils.js
var BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
var sequentialCounter = 0;
var getTimestamp = (id, appId) => {
  return Number.parseInt(fromBase62(appId)) + Number.parseInt(fromBase62(id));
};
var generateIdByTimestamp = (timestamp, padding) => {
  if (!timestamp) {
    throw new Error(
      "Reference timestamp not set. Ensure getAppId has been called first."
    );
  }
  const timeDifference = Date.now() - parseInt(timestamp, 10);
  let id = toBase62(timeDifference + sequentialCounter);
  sequentialCounter++;
  if (padding) {
    while (id.length < 6) {
      id = "0" + id;
    }
  }
  return id;
};
var generateId = (appId, userId) => {
  const referenceTimestamp = fromBase62(appId);
  let id = generateIdByTimestamp(referenceTimestamp, !!userId);
  return userId ? `${id}-${userId}` : id;
};
var fromBase62 = (str = "") => {
  let num = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const index = BASE62.indexOf(char);
    num = num * 62 + index;
  }
  return num;
};
var toBase62 = (num) => {
  if (num === 0)
    return BASE62[0];
  let arr = [];
  while (num) {
    arr.unshift(BASE62[num % 62]);
    num = Math.floor(num / 62);
  }
  return arr.join("");
};
var extractPathParams = (endpoint, requestPath, regex) => {
  const paramNames = [...endpoint.matchAll(/:([a-z]+)/gi)].map(
    (match) => match[1]
  );
  const paramValues = requestPath.match(regex).slice(1);
  return paramNames.reduce(
    (acc, name, index) => ({
      ...acc,
      [name]: paramValues[index]
    }),
    {}
  );
};

// reactive-record/relationship.js
var UpdateRelationship = {
  one: async function(params) {
    await updateOneRelationship(params);
  },
  many: async function(params) {
    await updateManyRelationship(params);
  }
};
async function updateOneRelationship({
  prevValue,
  value,
  relatedModel,
  id,
  targetForeignKey
}) {
  const targetType = relatedModel.properties[targetForeignKey]?.type;
  const isMany = targetType === "many";
  const [, prevId] = extractId(prevValue);
  const [position, newId] = value && extractId(value) || [];
  if (prevId) {
    await unsetRelation(relatedModel, id, prevId, targetForeignKey, isMany);
  }
  if (newId) {
    await setRelation(
      relatedModel,
      id,
      newId,
      targetForeignKey,
      isMany,
      position
    );
  }
}
async function updateManyRelationship({
  prevId,
  value,
  relatedModel,
  id,
  targetForeignKey
}) {
  const prevIds = ensureArray(prevId);
  const newIds = ensureArray(value);
  const addedIds = newIds.filter((v) => !prevIds.includes(v));
  const removedIds = prevIds.filter((v) => !newIds.includes(v));
  for (const relatedId of addedIds) {
    await setRelation(relatedModel, id, relatedId, targetForeignKey);
  }
  for (const relatedId of removedIds) {
    await unsetRelation(relatedModel, id, relatedId, targetForeignKey);
  }
}
function ensureArray(value) {
  return Array.isArray(value) ? value : [value];
}
function extractId(val) {
  return Array.isArray(val) ? val : [null, val];
}
async function unsetRelation(relatedModel, id, prevId, targetForeignKey, isMany = false) {
  if (!prevId)
    return;
  let keyToUpdate = `${targetForeignKey}_${prevId}`;
  if (isMany) {
    const prevTarget = await relatedModel.get(prevId, [targetForeignKey]);
    const oldIndex = prevTarget[targetForeignKey] || [];
    if (prevTarget) {
      await relatedModel._setProperty(
        keyToUpdate,
        oldIndex.filter((entry) => entry !== id)
      );
    }
  } else {
    if (keyToUpdate)
      await relatedModel._setProperty(keyToUpdate, null);
  }
}
async function setRelation(relatedModel, id, newId, targetForeignKey, isMany = false, position) {
  const target = await relatedModel.get(newId, {
    createIfNotFound: true,
    props: [targetForeignKey]
  });
  let newIndex = target[targetForeignKey] || [];
  if (isMany && Array.isArray(newIndex)) {
    if (typeof position === "number") {
      newIndex.splice(position, 0, id);
    } else if (!newIndex.includes(id)) {
      newIndex.push(id);
    }
  } else {
    newIndex = id;
  }
  if (newId && newIndex) {
    await relatedModel._setProperty(`${targetForeignKey}_${newId}`, newIndex);
  }
}

// reactive-record/crud.js
var CrudReactiveRecord = class {
  _generateEntries({ _userId, id: _id, ...value }) {
    let newId = _userId ? _id + "-" + _userId : _id;
    if (!_id)
      newId = generateId(this.appId, _userId || this.userId);
    this.lastId = newId;
    const properties = Object.keys(value);
    if (!properties[this.referenceKey]) {
      properties[this.referenceKey] = "";
    }
    return properties.map((prop) => [prop, newId, value[prop]]);
  }
  async _setProperty(key, value) {
    return this.adapter.set([[key, value]], this.store);
  }
  async _unsetMany(keys2) {
    for (const key of keys2) {
      this.logOp(key, "");
    }
    return this.adapter.remove(keys2, this.store);
  }
  /* 
  async getOps() {
    //sinceTimestamp = 0
    // This method fetches all operations after a given timestamp.
    // Can be optimized further based on how oplog is structured.
    const allOperations = await this.adapter.get([], this.oplog);
    return allOperations; // Filtering removed, as the flattened approach doesn't have timestamps. Can be re-added if needed.
  } */
  async _set(entries2) {
    const entriesToAdd = [];
    for (const [propKey, id, value] of entries2) {
      const key = `${propKey}_${id}`;
      const prop = this.properties[propKey];
      if (prop?.relationship && ["one", "many"].includes(prop.type)) {
        const relatedModel = this.models[prop.relationship];
        if (!relatedModel)
          throw "ERROR: couldn't find model " + prop.relationship;
        const { targetForeignKey, type } = prop;
        const prevValue = await this.get(id, {
          createIfNotFound: true,
          props: [propKey]
        });
        const relatedProp = relatedModel.properties[targetForeignKey];
        if (relatedProp?.targetForeignKey && prevValue)
          await UpdateRelationship[type]({
            prevValue: prevValue[propKey],
            id,
            value,
            relatedModel,
            targetForeignKey
          });
      }
      entriesToAdd.push([key, value]);
    }
    return this.adapter.set(entriesToAdd, this.store);
  }
  async remove(key) {
    const properties = Object.keys(this.properties);
    if (!properties)
      return;
    for (const propKey of properties) {
      const prop = this.properties[propKey];
      if (prop?.relationship) {
        const prevValue = await this.get(key, [propKey]);
        const relatedModel = this.models[prop.relationship];
        if (!relatedModel) {
          console.error(`ERROR: couldn't find model ${prop.relationship}`);
          continue;
        }
        const { targetForeignKey, type } = prop;
        const targetIsMany = relatedModel.properties[targetForeignKey] && relatedModel.properties[targetForeignKey].type === "many";
        if (type === "one" && prevValue[propKey]) {
          await unsetRelation(
            relatedModel,
            key,
            prevValue[propKey],
            targetForeignKey,
            targetIsMany
          );
        } else if (type === "many" && Array.isArray(prevValue[propKey])) {
          for (const relatedId of prevValue[propKey]) {
            await unsetRelation(
              relatedModel,
              relatedId,
              key,
              targetForeignKey,
              targetIsMany
            );
          }
        }
      }
    }
    const keysToDelete = properties.map((prop) => `${prop}_${key}`);
    await this._unsetMany(keysToDelete);
  }
  async removeMany(ids) {
    if (!ids || !ids.length)
      return;
    return Promise.all(ids.map(async (id) => await this.remove(id)));
  }
  async add(value) {
    const entries2 = this._generateEntries(value);
    await this._set(entries2);
    return await this.get(this.lastId);
  }
  async addMany(values2) {
    const allEntries = [];
    for (const value of values2) {
      const entries2 = this._generateEntries(value);
      allEntries.push(...entries2);
    }
    await this._set(allEntries);
  }
  async edit({ id, ...value }) {
    const entries2 = Object.keys(value).map((prop) => [prop, id, value[prop]]);
    await this._set(entries2);
    return { id, ...value };
  }
  async editMany(records) {
    if (!records || !records.length)
      return;
    const allEntries = [];
    for (const record of records) {
      const { id, ...value } = record;
      const entries2 = Object.keys(value).map((prop) => [prop, id, value[prop]]);
      allEntries.push(...entries2);
    }
    await this._set(allEntries);
  }
  async get(id, opts = {}) {
    if (!id)
      return;
    const { props, nested = false, createIfNotFound = false } = opts;
    const propNames = props || Object.keys(this.properties);
    const keys2 = propNames.map((prop) => `${prop}_${id}`);
    const values2 = await this.adapter.get(keys2, this.store);
    if ((!values2 || values2.every((value) => value == null)) && !createIfNotFound) {
      return null;
    }
    const obj = { id };
    const promises = propNames.map(async (propKey, idx) => {
      const prop = this.properties[propKey];
      if (!prop)
        return;
      let value = values2[idx];
      if (nested && prop.relationship) {
        const relatedModel = this.models[prop.relationship];
        if (!relatedModel)
          return;
        if (prop.type === "one") {
          const relatedId = values2[idx];
          if (relatedId) {
            value = await relatedModel.get(relatedId);
          }
        }
        if (prop.type === "many") {
          const ids = values2[idx] || [];
          if (Array.isArray(ids) && ids.length > 0) {
            value = await Promise.all(
              ids.map(async (id2) => await relatedModel.get(id2))
            );
          }
        }
      }
      if (prop.metadata && prop.referenceField) {
        const [timestamp, userId] = id.split("-");
        if (prop.metadata === "user" && this.models.users) {
          value = await this.models.users.get(userId);
        }
        if (prop.metadata === "timestamp") {
          value = getTimestamp(timestamp, this.appId);
        }
      }
      obj[propKey] = value || prop.defaultValue;
    });
    await Promise.all(promises);
    return obj;
  }
  async getMany(key, opts = {}) {
    const { startsWith: startsWith2, props, indexOnly = true, nested = false } = opts;
    console.log(this.referenceKey);
    const items = await this.adapter.startsWith(
      startsWith2 ? [this.referenceKey, startsWith2].join("_") : key || this.referenceKey,
      this.store,
      { index: indexOnly }
    );
    return indexOnly ? Promise.all(
      items.map(async (key2) => await this.get(key2, { props, nested }))
    ) : Promise.resolve(items);
  }
};

// reactive-record/index.js
var oplog;
var queue;
var ReactiveRecord = class extends CrudReactiveRecord {
  constructor({ _init, ...properties }, { name, appId, userId, logOperations, store, models: models2 }) {
    super();
    this.name = name;
    this.models = models2;
    this.adapter = indexeddb_default;
    this.properties = properties;
    this.referenceKey = Object.keys(properties)[0];
    this.appId = appId;
    this.userId = userId;
    this.store = store;
    if (logOperations) {
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
        propKey
      });
    }
  }
};

// appstate/events.js
var events = {
  INIT_BACKEND: async (data, { source }) => {
    console.log("DEBUG: INIT_BACKEND");
    const app = await initApp(data.appId, data.models, data.version);
    const { appId } = app;
    source.postMessage({
      type: "BACKEND_INITIALIZED",
      appId
    });
  },
  DEFINE_MODELS: async (data, { source }) => {
    const { models: models2, appId, userId, suffix, version = 1 } = data;
    if (models2)
      await defineModels({ models: models2, appId, userId, suffix, version });
    await getApiModel();
    source.postMessage({
      type: "MODELS_DEFINED"
    });
  },
  PAGE_BUILDER_UPDATE_PAGE: async (data, { P2P: P2P2 }) => {
    const { title, url } = data;
    await getApiModel();
    console.log({ models });
    const TabsModel = models.tabs;
    const tabs = await TabsModel.getMany();
    const updateTabs = tabs.filter((tab) => tab.title === title).map((tab) => ({ ...tab, url }));
    TabsModel.editMany(updateTabs);
    P2P2.execute((client) => {
      if (client.url.includes(url.split("#")[0])) {
        client.navigate(url);
      }
    });
  },
  SYNC_DATA: async (data, { requestUpdate: requestUpdate2 }) => {
    const { data: syncData } = data;
    for (let [modelName, entries2] of Object.entries(syncData)) {
      const model = models[modelName];
      if (model)
        model?.setMany(entries2);
    }
    requestUpdate2();
  },
  REQUEST_UPDATE: async (data, { requestUpdate: requestUpdate2 }) => {
    const { store } = data || {};
    requestUpdate2(store);
  },
  OPLOG_WRITE: async (data, { requestUpdate: requestUpdate2, P2P: P2P2 }) => {
    const { bridge, store, modelName, key, value } = data;
    const { models: models2 } = await getApiModel();
    const model = models2[modelName];
    if (model) {
      if (value) {
        await model.setItem(key, value);
      } else {
        await model.removeItem(key);
      }
      if (!bridge)
        P2P2.postMessage({ type: "OPLOG_WRITE", store, modelName, key, value });
      if (data.requestUpdate)
        requestUpdate2();
    }
  }
};

// appstate/utils.js
function decodePath(encodedSegment) {
  return encodedSegment.replace(/%2F/g, "/");
}
function getDefaultCRUDEndpoints(modelName, endpoints = {}) {
  return {
    [`GET /api/${modelName}`]: function(opts = {}) {
      return this.getMany(null, opts);
    },
    [`GET /api/${modelName}/:id`]: function({ id, ...opts }) {
      return this.get(decodePath(id), opts);
    },
    [`POST /api/${modelName}`]: function(payload) {
      return Array.isArray(payload) ? this.addMany(payload) : this.add(payload);
    },
    [`DELETE /api/${modelName}/:id`]: function({ id }) {
      return this.remove(decodePath(id));
    },
    [`PATCH /api/${modelName}/:id`]: function({ id, ...rest }) {
      return this.edit({ id: decodePath(id), ...rest });
    },
    ...endpoints
  };
}
var endpointToRegex = (endpoint) => {
  const [method, path] = endpoint.split(" ");
  const regexPath = path.split("/").map((part) => part.startsWith(":") ? "([^/]+)" : part).join("/");
  return new RegExp(`^${method} ${regexPath}/?$`);
};

// appstate/index.js
var api;
var workspaceModelName = "workspaces";
var workspaceModelDefinition = {
  appId: {
    type: "string",
    defaultValue: "",
    enum: [],
    primary: true
  },
  userId: {
    type: "string",
    defaultValue: "",
    enum: []
  },
  models: {
    type: "object"
  },
  controllers: {
    type: "object"
  },
  windows: {
    type: "many",
    relationship: "windows",
    targetForeignKey: "workspace"
  }
};
var defineModel = async (name, module, props) => {
  const { appId, userId, oplog: oplog2, models: models2, store } = props;
  const model = new ReactiveRecord(module, {
    name,
    appId,
    userId,
    oplog: oplog2,
    models: models2,
    store
  });
  model.definition = module;
  return model;
};
var defineModels = async (props) => {
  const { appId, suffix, userId, oplog: oplog2 = false, version = 1 } = props;
  const modelList = props.models;
  let dbName = props.dbName || appId;
  if (suffix)
    dbName = [dbName, suffix].join("_");
  const stores = await indexeddb_default.createDatabase(
    dbName,
    Object.keys(modelList),
    version
  );
  const initialData = [];
  for (const [name, module] of Object.entries(modelList)) {
    const model = await defineModel(name, module, {
      appId,
      userId,
      oplog: oplog2,
      models,
      store: stores[name]
    });
    models[name] = model;
    if (module._initialData)
      initialData.push([name, module._initialData]);
  }
  if (initialData.length > 0) {
    for (const [modelName, data] of initialData) {
      if (await models[modelName].isEmpty()) {
        await models[modelName].addMany(data);
      }
    }
  }
  return models;
};
var baseModels;
var models = {};
(async () => {
  const models2 = await defineModels({
    models: { [workspaceModelName]: workspaceModelDefinition },
    dbName: "_appstate"
  });
  baseModels = models2;
})();
var messageHandler = ({ requestUpdate: requestUpdate2, P2P: P2P2 }) => async (event) => {
  const handler = events[event.data.type];
  if (handler) {
    console.log("DEBUG - frontend event: ", {
      event
    });
    try {
      const messageHandlerContext = {
        source: event.source,
        requestUpdate: requestUpdate2,
        P2P: P2P2
      };
      await handler(event.data, messageHandlerContext);
    } catch (error) {
      console.error(`Error handling ${event.data.type}:`, error);
    }
  }
};
var requestUpdate = () => self.clients.matchAll().then(
  (clients) => clients.forEach((client) => client.postMessage("REQUEST_UPDATE"))
);
var initApp = async (appId, userModels, version) => {
  const app = await getApp({
    models: { [workspaceModelName]: workspaceModelDefinition, ...userModels },
    WorkspaceModel: baseModels[workspaceModelName]
  });
  await defineModels({
    models: userModels,
    appId: app.appId,
    userId: app.userId,
    version
  });
  await getApiModel();
  return app;
};
var getApp = async ({ models: models2, WorkspaceModel }) => {
  const defaultApp = await WorkspaceModel.get("default");
  if (!defaultApp) {
    const appId = toBase62(Date.now());
    await WorkspaceModel.add({ id: "default", appId, models: models2 });
    return await WorkspaceModel.add({ id: appId, appId, userId: "1" });
  } else {
    return await WorkspaceModel.get(defaultApp.appId);
  }
};
async function getApiModel() {
  if (!api && Object.keys(models).length === Object.keys(baseModels).length) {
    const defaultApp = await models[workspaceModelName].get("default");
    delete defaultApp.models[workspaceModelName];
    const userModels = await defineModels({
      models: defaultApp.models,
      appId: defaultApp.appId
    });
    models = { ...userModels, ...baseModels };
  }
  api = Object.entries(models).reduce((acc, [name, module]) => {
    const model = module.definition;
    const endpoints = getDefaultCRUDEndpoints(name, model.endpoints);
    Object.entries(endpoints).forEach(([endpoint, callback]) => {
      const regex = endpointToRegex(endpoint);
      if (!acc)
        acc = {};
      acc[endpoint] = {
        regex,
        model: models[name],
        callback
      };
    });
    return acc;
  }, {});
  return api;
}

// constants.js
var BOOL_TABLE = { false: false, true: true };

// index.js
var P2P = {
  _handleClients: (action) => {
    self.clients.matchAll().then((clients) => {
      if (clients && clients.length) {
        clients.forEach((client) => action(client));
      }
    });
  },
  postMessage: (payload) => {
    P2P._handleClients((client) => client.postMessage(payload));
  },
  execute: (func) => {
    P2P._handleClients((client) => func(client));
  }
};
var endpointNotFound = new Response(
  JSON.stringify({ error: "ERROR: endpoint not found" }),
  {
    status: 404,
    headers: {
      "Content-Type": "application/json"
    }
  }
);
var endpointsNotLoaded = new Response(
  JSON.stringify({ error: "ERROR: endpoints weren't loaded" }),
  {
    status: 500,
    headers: {
      "Content-Type": "application/json"
    }
  }
);
var handleFetch = async ({ event, url }) => {
  const endpoints = await getApiModel();
  if (!endpoints)
    return endpointsNotLoaded;
  const request = `${event.request.method} ${url.pathname}`;
  const matchedEndpointKey = Object.keys(endpoints).find((endpointKey) => {
    const { regex } = endpoints[endpointKey];
    return regex.test(request);
  });
  if (!matchedEndpointKey)
    return endpointNotFound;
  try {
    const {
      callback,
      model,
      models: models2 = {},
      regex: endpointRegex
    } = endpoints[matchedEndpointKey];
    const pathParams = extractPathParams(
      matchedEndpointKey,
      request,
      endpointRegex
    );
    const queryParams = [...url.searchParams.entries()].reduce(
      (acc, [key, value]) => ({
        ...acc,
        [key]: ["false", "true"].includes(value) ? BOOL_TABLE[value] : value
      }),
      {}
    );
    const bodyMethods = ["POST", "PATCH"];
    const bodyParams = bodyMethods.includes(event.request.method) ? await event.request.json().catch((err) => console.error("Failed to parse request body", err)) : {};
    const params = { ...pathParams, ...bodyParams, ...queryParams };
    const response = await callback.call(
      model,
      Array.isArray(bodyParams) ? bodyParams : params,
      {
        P2P,
        requestUpdate,
        models: models2
      }
    );
    if (["POST", "PATCH", "DELETE"].includes(event.request.method)) {
      requestUpdate();
    }
    return new Response(JSON.stringify(response), {
      headers: {
        "Content-Type": Array.isArray(response) ? "text/event-stream" : "application/json"
      }
    });
  } catch (error) {
    console.error({ error });
    throw error;
  }
};

// index.sw.js
self.messageHandler = messageHandler;
self.P2P = P2P;
self.requestUpdate = requestUpdate;
self.handleFetch = handleFetch;
//# sourceMappingURL=index.js.map
