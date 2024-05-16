function decodePath(encodedSegment) {
  return encodedSegment.replace(/%2F/g, "/");
}

export function getDefaultCRUDEndpoints(modelName, endpoints = {}) {
  return {
    [`GET /api/${modelName}`]: function (opts = {}) {
      return this.getMany(null, opts);
    },
    [`GET /api/${modelName}/:id`]: function ({ id, ...opts }) {
      return this.get(decodePath(id), opts);
    },
    [`POST /api/${modelName}`]: function (payload) {
      return Array.isArray(payload) ? this.addMany(payload) : this.add(payload);
    },
    [`DELETE /api/${modelName}/:id`]: function ({ id }) {
      return this.remove(decodePath(id));
    },
    [`PATCH /api/${modelName}/:id`]: function ({ id, ...rest }) {
      return this.edit({ id: decodePath(id), ...rest });
    },
    ...endpoints,
  };
}

export const endpointToRegex = (endpoint) => {
  const [method, path] = endpoint.split(" ");
  const regexPath = path
    .split("/")
    .map((part) => (part.startsWith(":") ? "([^/]+)" : part))
    .join("/");
  return new RegExp(`^${method} ${regexPath}/?$`);
};
