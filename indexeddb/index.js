import { get, getItem, remove, set, setLastOp, update } from "./crud.js";
import {
  clear,
  entries,
  getCount,
  isEmpty,
  keys,
  promisifyRequest,
  startsWith,
  values,
} from "./utils.js";

export const createStore = (dbName = "bootstrapp", storeName = "kv") => {
  const request = indexedDB.open(dbName);
  request.onupgradeneeded = () => request.result.createObjectStore(storeName);
  const dbp = promisifyRequest(request);
  return (txMode, callback) =>
    dbp.then((db) =>
      callback(db.transaction(storeName, txMode).objectStore(storeName)),
    );
};

export const createDatabase = (
  dbName = "bootstrapp",
  storeNames = ["kv"],
  version = 1,
) => {
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
          return new Promise((resolve, reject) => {
            try {
              const transaction = db.transaction(storeName, txMode);
              const objectStore = transaction.objectStore(storeName);
              Promise.resolve(callback(objectStore))
                .then(resolve)
                .catch(reject);
            } catch (error) {
              console.error({ storeName, error });
              reject(new Error("Transaction failed", error));
            }
          });
        };
      });

      resolve(stores);
    };
  });
};

const idbAdapter = {
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
  update,
};

export default idbAdapter;
