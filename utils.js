const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export let sequentialCounter = 0;

export const getTimestamp = (id, appId) => {
  return Number.parseInt(fromBase62(appId)) + Number.parseInt(fromBase62(id));
};

const generateIdByTimestamp = (timestamp, padding) => {
  if (!timestamp) {
    throw new Error(
      "Reference timestamp not set. Ensure getAppId has been called first.",
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

export const generateId = (appId, userId) => {
  const referenceTimestamp = fromBase62(appId);
  let id = generateIdByTimestamp(referenceTimestamp, !!userId);
  return userId ? `${id}-${userId}` : id;
};

export const fromBase62 = (str = "") => {
  let num = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const index = BASE62.indexOf(char);
    num = num * 62 + index;
  }
  return num;
};

export const toBase62 = (num) => {
  if (num === 0) return BASE62[0];
  let arr = [];
  while (num) {
    arr.unshift(BASE62[num % 62]);
    num = Math.floor(num / 62);
  }
  return arr.join("");
};

export const extractPathParams = (endpoint, requestPath, regex) => {
  const paramNames = [...endpoint.matchAll(/:([a-z]+)/gi)].map(
    (match) => match[1],
  );
  const paramValues = requestPath.match(regex).slice(1);
  return paramNames.reduce(
    (acc, name, index) => ({
      ...acc,
      [name]: paramValues[index],
    }),
    {},
  );
};
