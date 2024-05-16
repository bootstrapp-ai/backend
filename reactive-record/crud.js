import { generateId, getTimestamp } from "../utils.js";
import { unsetRelation, UpdateRelationship } from "./relationship.js";
export class CrudReactiveRecord {
  _generateEntries({ _userId, id: _id, ...value }) {
    let newId = _userId ? _id + "-" + _userId : _id; // TODO: refactor this, big chances of bug
    if (!_id) newId = generateId(this.appId, _userId || this.userId);
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

  async _unsetMany(keys) {
    for (const key of keys) {
      this.logOp(key, "");
    }
    return this.adapter.remove(keys, this.store);
  }

  /* 
  async getOps() {
    //sinceTimestamp = 0
    // This method fetches all operations after a given timestamp.
    // Can be optimized further based on how oplog is structured.
    const allOperations = await this.adapter.get([], this.oplog);
    return allOperations; // Filtering removed, as the flattened approach doesn't have timestamps. Can be re-added if needed.
  } */

  async _set(entries) {
    const entriesToAdd = [];

    for (const [propKey, id, value] of entries) {
      const key = `${propKey}_${id}`;
      //this.logOp(key, value);
      const prop = this.properties[propKey];
      if (prop?.relationship && ["one", "many"].includes(prop.type)) {
        const relatedModel = this.models[prop.relationship];
        if (!relatedModel)
          throw "ERROR: couldn't find model " + prop.relationship;
        const { targetForeignKey, type } = prop;
        const prevValue = await this.get(id, {
          createIfNotFound: true,
          props: [propKey],
        });
        const relatedProp = relatedModel.properties[targetForeignKey];
        if (relatedProp?.targetForeignKey && prevValue)
          await UpdateRelationship[type]({
            prevValue: prevValue[propKey],
            id,
            value,
            relatedModel,
            targetForeignKey,
          });
      }
      /* 
      if (this.oplog)
        this.constructor.postMessage({
          type: "OPLOG_WRITE",
          store: [this.appId, this.name].join("_"),
          key,
          value,
        }); */
      entriesToAdd.push([key, value]);
    }

    return this.adapter.set(entriesToAdd, this.store);
  }

  async remove(key) {
    const properties = Object.keys(this.properties);
    if (!properties) return;
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
        const targetIsMany = relatedModel.properties[targetForeignKey] &&
          relatedModel.properties[targetForeignKey].type === "many";
        if (type === "one" && prevValue[propKey]) {
          await unsetRelation(
            relatedModel,
            key,
            prevValue[propKey],
            targetForeignKey,
            targetIsMany,
          );
        } else if (type === "many" && Array.isArray(prevValue[propKey])) {
          // TODO: you gotta test this
          for (const relatedId of prevValue[propKey]) {
            await unsetRelation(
              relatedModel,
              relatedId,
              key,
              targetForeignKey,
              targetIsMany,
            );
          }
        }
      }
    }

    // Delete the keys after relationships have been handled
    const keysToDelete = properties.map((prop) => `${prop}_${key}`);
    await this._unsetMany(keysToDelete);
  }

  async removeMany(ids) {
    if (!ids || !ids.length) return;
    return Promise.all(ids.map(async (id) => await this.remove(id)));
  }

  async add(value) {
    const entries = this._generateEntries(value);
    await this._set(entries);
    return await this.get(this.lastId);
  }

  async addMany(values) {
    const allEntries = [];
    for (const value of values) {
      const entries = this._generateEntries(value);
      allEntries.push(...entries);
    }
    await this._set(allEntries);
  }

  async edit({ id, ...value }) {
    const entries = Object.keys(value).map((prop) => [prop, id, value[prop]]);
    await this._set(entries);
    return { id, ...value };
  }

  async editMany(records) {
    if (!records || !records.length) return;
    const allEntries = [];
    for (const record of records) {
      const { id, ...value } = record;
      const entries = Object.keys(value).map((prop) => [prop, id, value[prop]]);
      allEntries.push(...entries);
    }
    await this._set(allEntries);
  }

  async get(id, opts = {}) {
    if (!id) return;
    const { props, nested = false, createIfNotFound = false } = opts;
    const propNames = props || Object.keys(this.properties);
    const keys = propNames.map((prop) => `${prop}_${id}`);
    const values = await this.adapter.get(keys, this.store);

    if (
      (!values || values.every((value) => value == null)) &&
      !createIfNotFound
    ) {
      return null;
    }

    const obj = { id };

    const promises = propNames.map(async (propKey, idx) => {
      const prop = this.properties[propKey];
      if (!prop) return;

      let value = values[idx];
      if (nested && prop.relationship) {
        const relatedModel = this.models[prop.relationship];
        if (!relatedModel) return;

        if (prop.type === "one") {
          const relatedId = values[idx];

          if (relatedId) {
            value = await relatedModel.get(relatedId);
          }
        }

        if (prop.type === "many") {
          const ids = values[idx] || [];
          if (Array.isArray(ids) && ids.length > 0) {
            value = await Promise.all(
              ids.map(async (id) => await relatedModel.get(id)),
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
    const { startsWith, props, indexOnly = true, nested = false } = opts;
    console.log(this.referenceKey);
    const items = await this.adapter.startsWith(
      startsWith
        ? [this.referenceKey, startsWith].join("_")
        : key || this.referenceKey,
      this.store,
      { index: indexOnly },
    );
    return indexOnly
      ? Promise.all(
        items.map(async (key) => await this.get(key, { props, nested })),
      )
      : Promise.resolve(items);
  }
}
