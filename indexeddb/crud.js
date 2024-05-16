import { promisifyRequest, startsWith } from "./utils";

export const getItem = (key, table) => {
  return table("readonly", (store) => promisifyRequest(store.get(key)));
};

export const get = (keys, table) => {
  return table("readonly", (store) =>
    Promise.all(keys.map((key) => promisifyRequest(store.get(key)))),
  );
};

export const set = (entries, table) => {
  return table("readwrite", (store) => {
    entries.forEach((entry) => store.put(entry[1], entry[0]));
    return promisifyRequest(store.transaction);
  });
};

export const remove = (keys, table) => {
  return table("readwrite", (store) => {
    keys.forEach((key) => store.delete(key));
    return promisifyRequest(store.transaction);
  });
};

export const update = (key, updater, db) => {
  return db(
    "readwrite",
    (store) =>
      new Promise((resolve, reject) => {
        store.get(key).onsuccess = function () {
          try {
            store.put(updater(this.result), key);
            resolve(promisifyRequest(store.transaction));
          } catch (err) {
            reject(err);
          }
        };
      }),
  );
};

export const setLastOp = async (key, value, config) => {
  const { db, propKey } = config;
  const keys = await startsWith(propKey, db, { index: true, keepKey: true });
  await remove(keys, db);
  set([key, value], db);
};
