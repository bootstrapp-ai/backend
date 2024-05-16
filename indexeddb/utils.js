export const promisifyRequest = (request) => {
  return new Promise((resolve, reject) => {
    request.oncomplete = request.onsuccess = () => resolve(request.result);
    request.onabort = request.onerror = () => reject(request.error);
  });
};

const executeRequest = (request) =>
  new Promise((resolve, reject) => {
    request.oncomplete = request.onsuccess = () => resolve(request.result);
    request.onabort = request.onerror = () => reject(request.error);
  });

export const tableOperation = (table, mode, operation) =>
  table(mode, (store) => executeRequest(operation(store)));
const iterateCursor = (request, process) =>
  new Promise((resolve, reject) => {
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

const processKeys = (items, cursor) => items.push(cursor.key);
const processValues = (items, cursor) => items.push(cursor.value);
const processEntries = (items, cursor) =>
  items.push([cursor.key, cursor.value]);

export const entries = (table) =>
  tableOperation(table, "readonly", (store) =>
    store.getAll && store.getAllKeys
      ? Promise.all([
        executeRequest(store.getAllKeys()),
        executeRequest(store.getAll()),
      ]).then(([keys, values]) => keys.map((key, i) => [key, values[i]]))
      : iterateCursor(store.openCursor(), processEntries),
  );

export const startsWith = (
  prefix,
  table,
  config = { index: true, keepKey: false },
) =>
  table("readonly", (store) => {
    const range = IDBKeyRange.bound(prefix, prefix + "\uffff");
    return iterateCursor(store.openCursor(range), (items, cursor) => {
      const id = config.keepKey ? cursor.key : cursor.key.split("_")[1];
      items.push(config.index ? id : { id, [prefix]: cursor.value });
    });
  });

export const getCount = (table) =>
  tableOperation(table, "readonly", (store) => store.count());

export const isEmpty = (table) => getCount(table).then((count) => count === 0);

export const clear = (table) =>
  tableOperation(table, "readwrite", (store) => store.clear());

export const keys = (table) =>
  tableOperation(table, "readonly", (store) =>
    store.getAllKeys
      ? store.getAllKeys()
      : iterateCursor(store.openCursor(), processKeys),
  );

export const values = (table) =>
  tableOperation(table, "readonly", (store) =>
    store.getAll
      ? store.getAll()
      : iterateCursor(store.openCursor(), processValues),
  );
