export const UpdateRelationship = {
  one: async function (params) {
    await updateOneRelationship(params);
  },
  many: async function (params) {
    await updateManyRelationship(params);
  },
};

async function updateOneRelationship({
  prevValue,
  value,
  relatedModel,
  id,
  targetForeignKey,
}) {
  const targetType = relatedModel.properties[targetForeignKey]?.type;
  const isMany = targetType === "many";
  const [, prevId] = extractId(prevValue);
  const [position, newId] = (value && extractId(value)) || [];

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
      position,
    );
  }
}

export async function updateManyRelationship({
  prevId,
  value,
  relatedModel,
  id,
  targetForeignKey,
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

export function ensureArray(value) {
  return Array.isArray(value) ? value : [value];
}

export function extractId(val) {
  return Array.isArray(val) ? val : [null, val];
}

export async function unsetRelation(
  relatedModel,
  id,
  prevId,
  targetForeignKey,
  isMany = false,
) {
  if (!prevId) return;
  let keyToUpdate = `${targetForeignKey}_${prevId}`;
  if (isMany) {
    const prevTarget = await relatedModel.get(prevId, [targetForeignKey]);
    const oldIndex = prevTarget[targetForeignKey] || [];
    if (prevTarget) {
      await relatedModel._setProperty(
        keyToUpdate,
        oldIndex.filter((entry) => entry !== id),
      );
    }
  } else {
    if (keyToUpdate) await relatedModel._setProperty(keyToUpdate, null);
  }
}

export async function setRelation(
  relatedModel,
  id,
  newId,
  targetForeignKey,
  isMany = false,
  position,
) {
  const target = await relatedModel.get(newId, {
    createIfNotFound: true,
    props: [targetForeignKey],
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
