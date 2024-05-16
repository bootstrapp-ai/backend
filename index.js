import {
  getApiModel,
  messageHandler,
  requestUpdate,
} from "./appstate/index.js";
import { BOOL_TABLE } from "./constants.js";
import idbAdapter from "./indexeddb/index.js";
import { extractPathParams } from "./utils.js";

export const fetchDataFromDB = async (appId, models) => {
  const dataPromises = models.map(async (model) => {
    const db = idbAdapter.createStore(`${appId}_${model}`);
    const entries = await idbAdapter.entries(db);
    return { model, entries };
  });

  const results = await Promise.all(dataPromises);
  const data = {};

  results.forEach(({ model, entries }) => {
    data[model] = entries;
  });

  return data;
};

export const postMessage = (payload) => {
  if (self && self.dispatchEvent) {
    console.log(
      "DEBUG: Send event to service worker queue from reactive-record",
      { payload },
    );
    const message = new MessageEvent("message", {
      data: payload,
    });
    self.dispatchEvent(message);
  }
};
const P2P = {
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
  },
};

const endpointNotFound = new Response(
  JSON.stringify({ error: "ERROR: endpoint not found" }),
  {
    status: 404,
    headers: {
      "Content-Type": "application/json",
    },
  },
);

const endpointsNotLoaded = new Response(
  JSON.stringify({ error: "ERROR: endpoints weren't loaded" }),
  {
    status: 500,
    headers: {
      "Content-Type": "application/json",
    },
  },
);

const handleFetch = async ({ event, url }) => {
  const endpoints = await getApiModel();
  if (!endpoints) return endpointsNotLoaded;

  const request = `${event.request.method} ${url.pathname}`;
  const matchedEndpointKey = Object.keys(endpoints).find((endpointKey) => {
    const { regex } = endpoints[endpointKey];
    return regex.test(request);
  });
  if (!matchedEndpointKey) return endpointNotFound;
  try {
    const {
      callback,
      model,
      models = {},
      regex: endpointRegex,
    } = endpoints[matchedEndpointKey];

    const pathParams = extractPathParams(
      matchedEndpointKey,
      request,
      endpointRegex,
    );
    const queryParams = [...url.searchParams.entries()].reduce(
      (acc, [key, value]) => ({
        ...acc,
        [key]: ["false", "true"].includes(value) ? BOOL_TABLE[value] : value,
      }),
      {},
    );

    const bodyMethods = ["POST", "PATCH"];
    const bodyParams = bodyMethods.includes(event.request.method)
      ? await event.request
        .json()
        .catch((err) => console.error("Failed to parse request body", err))
      : {};
    const params = { ...pathParams, ...bodyParams, ...queryParams };
    const response = await callback.call(
      model,
      Array.isArray(bodyParams) ? bodyParams : params,
      {
        P2P,
        requestUpdate,
        models,
      },
    );
    if (["POST", "PATCH", "DELETE"].includes(event.request.method)) {
      requestUpdate();
    }
    return new Response(JSON.stringify(response), {
      headers: {
        "Content-Type": Array.isArray(response)
          ? "text/event-stream"
          : "application/json",
      },
    });
  } catch (error) {
    console.error({ error });
    throw error;
  }
};

export {
  extractPathParams,
  getApiModel,
  handleFetch,
  messageHandler,
  P2P,
  requestUpdate,
};
