// Module de stockage des créneaux d'essais (casting présentiel).
// Autonome : ne dépend pas de _redis.js pour rester facile à déployer.
const { createClient } = require("redis");

const PREFIX = "orage";
const SLOTS_KEY = `${PREFIX}:slots`;
const bookLockKey = (slotId) => `${PREFIX}:slotlock:${slotId}`;

async function withClient(fn) {
  if (!process.env.REDIS_URL) {
    const err = new Error("REDIS_URL manquant");
    err.code = "NO_REDIS_URL";
    throw err;
  }
  const client = createClient({ url: process.env.REDIS_URL });
  client.on("error", () => {});
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.quit();
  }
}

async function listSlots() {
  return withClient(async (client) => {
    const raw = await client.hGetAll(SLOTS_KEY);
    const slots = Object.entries(raw).map(([id, v]) => ({ id, ...JSON.parse(v) }));
    if (slots.length > 0) {
      const locks = await client.mGet(slots.map(s => bookLockKey(s.id)));
      slots.forEach((s, i) => { s.bookedBy = locks[i] || ""; });
    }
    return slots.sort((a, b) => new Date(a.start) - new Date(b.start));
  });
}

async function getSlot(id) {
  return withClient(async (client) => {
    const raw = await client.hGet(SLOTS_KEY, id);
    if (!raw) return null;
    const bookedBy = (await client.get(bookLockKey(id))) || "";
    return { id, ...JSON.parse(raw), bookedBy };
  });
}

async function createSlots(slotList) {
  return withClient(async (client) => {
    const created = [];
    for (const slot of slotList) {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const record = {
        start: slot.start,
        durationMin: Number(slot.durationMin) || 20,
        location: slot.location || "",
        blocked: false,
        createdAt: new Date().toISOString()
      };
      await client.hSet(SLOTS_KEY, id, JSON.stringify(record));
      created.push({ id, ...record });
    }
    return created;
  });
}

async function patchSlot(id, patch) {
  return withClient(async (client) => {
    const raw = await client.hGet(SLOTS_KEY, id);
    if (!raw) return false;
    const updated = { ...JSON.parse(raw), ...patch };
    await client.hSet(SLOTS_KEY, id, JSON.stringify(updated));
    return true;
  });
}

async function deleteSlot(id) {
  return withClient(async (client) => {
    await client.hDel(SLOTS_KEY, id);
    await client.del(bookLockKey(id));
  });
}

// Réservation atomique : SET NX sur une clé de verrou.
// Impossible que deux candidats obtiennent le même créneau.
async function tryBookSlot(slotId, submissionId) {
  return withClient(async (client) => {
    const raw = await client.hGet(SLOTS_KEY, slotId);
    if (!raw) return { ok: false, error: "Créneau introuvable" };
    const slot = JSON.parse(raw);
    if (slot.blocked) return { ok: false, error: "Ce créneau n'est pas disponible" };
    if (new Date(slot.start).getTime() < Date.now()) return { ok: false, error: "Ce créneau est déjà passé" };
    const got = await client.set(bookLockKey(slotId), submissionId, { NX: true });
    if (got !== "OK") return { ok: false, error: "Ce créneau vient d'être réservé par quelqu'un d'autre" };
    return { ok: true, slot: { id: slotId, ...slot, bookedBy: submissionId } };
  });
}

async function releaseSlot(slotId, submissionId) {
  return withClient(async (client) => {
    const current = await client.get(bookLockKey(slotId));
    if (!current) return { ok: true };
    if (submissionId && current !== submissionId) {
      return { ok: false, error: "Ce créneau est réservé par un autre candidat" };
    }
    await client.del(bookLockKey(slotId));
    return { ok: true };
  });
}

async function findSlotBySubmission(submissionId) {
  const slots = await listSlots();
  return slots.find(s => s.bookedBy === submissionId) || null;
}

module.exports = {
  listSlots, getSlot, createSlots, patchSlot, deleteSlot,
  tryBookSlot, releaseSlot, findSlotBySubmission
};
