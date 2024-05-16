import { defineModels, models } from "../appstate/index.js";
import { getApiModel, initApp } from "./index.js";

export const events = {
  INIT_BACKEND: async (data, { source }) => {
    //Controller = source;
    console.log("DEBUG: INIT_BACKEND");
    const app = await initApp(data.appId, data.models, data.version);
    const { appId } = app;
    source.postMessage({
      type: "BACKEND_INITIALIZED",
      appId,
    });
  },
  DEFINE_MODELS: async (data, { source }) => {
    //Controller = source;
    const { models, appId, userId, suffix, version = 1 } = data;
    if (models) await defineModels({ models, appId, userId, suffix, version });
    await getApiModel();
    source.postMessage({
      type: "MODELS_DEFINED",
    });
  },
  PAGE_BUILDER_UPDATE_PAGE: async (data, { P2P }) => {
    const { title, url } = data;
    await getApiModel();
    console.log({ models });
    const TabsModel = models.tabs;
    const tabs = await TabsModel.getMany();
    const updateTabs = tabs
      .filter((tab) => tab.title === title)
      .map((tab) => ({ ...tab, url }));
    TabsModel.editMany(updateTabs);
    P2P.execute((client) => {
      if (client.url.includes(url.split("#")[0])) {
        client.navigate(url);
      }
    });
  },
  SYNC_DATA: async (data, { requestUpdate }) => {
    const { data: syncData } = data;
    for (let [modelName, entries] of Object.entries(syncData)) {
      const model = models[modelName];
      if (model) model?.setMany(entries);
    }

    requestUpdate();
  },

  REQUEST_UPDATE: async (data, { requestUpdate }) => {
    const { store } = data || {};
    requestUpdate(store);
  },

  OPLOG_WRITE: async (data, { requestUpdate, P2P }) => {
    const { bridge, store, modelName, key, value } = data;
    const { models } = await getApiModel();
    const model = models[modelName];
    if (model) {
      if (value) {
        await model.setItem(key, value);
      } else {
        await model.removeItem(key);
      }

      // TODO: When sending the message to another user, we need to append the user id who sent it
      if (!bridge)
        P2P.postMessage({ type: "OPLOG_WRITE", store, modelName, key, value });

      if (data.requestUpdate) requestUpdate();
    }
  },
};
