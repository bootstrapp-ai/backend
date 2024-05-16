import idbAdapter from "../indexeddb/index.js";
import { ReactiveRecord } from "../reactive-record/index.js";
import { fromBase62, toBase62 } from "../utils.js";
import { events } from "./events.js";
import { endpointToRegex, getDefaultCRUDEndpoints } from "./utils.js";
export { events };
export let appId;
export let api;
const workspaceModelName = "workspaces";
export const workspaceModelDefinition = {
  appId: {
    type: "string",
    defaultValue: "",
    enum: [],
    primary: true,
  },
  userId: {
    type: "string",
    defaultValue: "",
    enum: [],
  },
  models: {
    type: "object",
  },
  controllers: {
    type: "object",
  },
  windows: {
    type: "many",
    relationship: "windows",
    targetForeignKey: "workspace",
  },
};

export const defineModel = async (name, module, props) => {
  const { appId, userId, oplog, models, store } = props;
  const model = new ReactiveRecord(module, {
    name,
    appId,
    userId,
    oplog,
    models,
    store,
  });
  model.definition = module;
  return model;
};

export const defineModels = async (props) => {
  const { appId, suffix, userId, oplog = false, version = 1 } = props;
  const modelList = props.models;
  let dbName = props.dbName || appId;
  if (suffix) dbName = [dbName, suffix].join("_");

  const stores = await idbAdapter.createDatabase(
    dbName,
    Object.keys(modelList),
    version,
  );

  const initialData = [];

  for (const [name, module] of Object.entries(modelList)) {
    const model = await defineModel(name, module, {
      appId,
      userId,
      oplog,
      models,
      store: stores[name],
    });
    models[name] = model;
    if (module._initialData) initialData.push([name, module._initialData]);
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

let baseModels;
export let models = {};

(async () => {
  const models = await defineModels({
    models: { [workspaceModelName]: workspaceModelDefinition },
    dbName: "_appstate",
  });
  baseModels = models;
})();

export const messageHandler =
  ({ requestUpdate, P2P }) =>
    async (event) => {
      const handler = events[event.data.type];
      if (handler) {
        console.log("DEBUG - frontend event: ", {
          event,
        });
        try {
          const messageHandlerContext = {
            source: event.source,
            requestUpdate,
            P2P,
          };
          await handler(event.data, messageHandlerContext);
        } catch (error) {
          console.error(`Error handling ${event.data.type}:`, error);
        }
      }
    };

export const requestUpdate = () =>
  self.clients
    .matchAll()
    .then((clients) =>
      clients.forEach((client) => client.postMessage("REQUEST_UPDATE")),
    );

export const initApp = async (appId, userModels, version) => {
  const app = await getApp({
    models: { [workspaceModelName]: workspaceModelDefinition, ...userModels },
    WorkspaceModel: baseModels[workspaceModelName],
  });
  await defineModels({
    models: userModels,
    appId: app.appId,
    userId: app.userId,
    version,
  });
  await getApiModel();
  return app;
};

export const getApp = async ({ models, WorkspaceModel }) => {
  const defaultApp = await WorkspaceModel.get("default");
  if (!defaultApp) {
    const appId = toBase62(Date.now());
    await WorkspaceModel.add({ id: "default", appId, models });
    return await WorkspaceModel.add({ id: appId, appId, userId: "1" });
  } else {
    return await WorkspaceModel.get(defaultApp.appId);
  }
};

let timestamp;
export const getBaseTimestamp = async () => {
  if (timestamp) return timestamp;
  if (models[workspaceModelName]) {
    const app = await models[workspaceModelName].get("default");
    timestamp = fromBase62(app.appId);
    return timestamp;
  }
};

export async function getApiModel() {
  if (!api && Object.keys(models).length === Object.keys(baseModels).length) {
    const defaultApp = await models[workspaceModelName].get("default");
    delete defaultApp.models[workspaceModelName];    
    const userModels = await defineModels({
      models: defaultApp.models,
      appId: defaultApp.appId,
    });
    models = { ...userModels, ...baseModels };    
  }
  api = Object.entries(models).reduce((acc, [name, module]) => {
    const model = module.definition;    
    const endpoints = getDefaultCRUDEndpoints(name, model.endpoints);
    Object.entries(endpoints).forEach(([endpoint, callback]) => {
      const regex = endpointToRegex(endpoint);
      if (!acc) acc = {};
      acc[endpoint] = {
        regex,
        model: models[name],
        callback,
      };
    });
    return acc;
  }, {});  
  return api;
}
