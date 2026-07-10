// Module de stockage des créneaux d'essais (casting présentiel).
// Autonome : ne dépend pas de _redis.js pour rester facile à déployer.
// Chaque créneau a une capacité (1 = solo, 2 = duo...) gérée par des "sièges" :
// un verrou Redis SET NX par siège garantit qu'aucune sur-réservation n'est possible.
const { createClient } = require("redis");

const PREFIX = "orage";
const SLOTS_KEY = `${PREFIX}:slots`;
const MAX_CAPACITY = 4;
// Le siège 1 garde l'ancien format de clé pour rester compatible
// avec les réservations déjà effectuées.
const seatKey = (slotId, n) => n <= 1 ? `${PREFIX}:slotlock:${slotId}` : `${PREFIX}:slotlock:${slotId}:${n}`;

function capacityOf(slot) {
  return Math.max(1, Math.min(MAX_CAPACITY, Number(slot.capacity) || 1));
}

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

async function readSeats(client, slotId, capacity) {
  const keys = [];
  for (let n = 1; n <= Math.max(capacity, 1); n++) keys.push(seatKey(slotId, n));
  const vals = await client.mGet(keys);
  return vals.filter(Boolean);
}

async function listSlots() {
  return withClient(async (client) => {
    const raw = await client.hGetAll(SLOTS_KEY);
    const slots = Object.entries(raw).map(([id, v]) => ({ id, ...JSON.parse(v) }));
    for (const s of slots) {
      s.capacity = capacityOf(s);
      s.bookedIds = await readSeats(client, s.id, s.capacity);
    }
    return slots.sort((a, b) => new Date(a.start) - new Date(b.start));
  });
}

async function getSlot(id) {
  return withClient(async (client) => {
    const raw = await client.hGet(SLOTS_KEY, id);
    if (!raw) return null;
    const slot = { id, ...JSON.parse(raw) };
    slot.capacity = capacityOf(slot);
    slot.bookedIds = await readSeats(client, id, slot.capacity);
    return slot;
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
        capacity: capacityOf(slot),
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
    for (let n = 1; n <= MAX_CAPACITY; n++) {
      await client.del(seatKey(id, n));
    }
  });
}

// Réservation atomique d'un siège : SET NX. Deux candidats ne peuvent
// jamais obtenir le même siège ; un créneau duo offre deux sièges.
async function tryBookSlot(slotId, submissionId) {
  return withClient(async (client) => {
    const raw = await client.hGet(SLOTS_KEY, slotId);
    if (!raw) return { ok: false, error: "Créneau introuvable" };
    const slot = JSON.parse(raw);
    if (slot.blocked) return { ok: false, error: "Ce créneau n'est pas disponible" };
    if (new Date(slot.start).getTime() < Date.now()) return { ok: false, error: "Ce créneau est déjà passé" };
    const capacity = capacityOf(slot);
    const current = await readSeats(client, slotId, capacity);
    if (current.includes(submissionId)) {
      return { ok: false, error: "Ce créneau est déjà le vôtre" };
    }
    for (let n = 1; n <= capacity; n++) {
      const got = await client.set(seatKey(slotId, n), submissionId, { NX: true });
      if (got === "OK") {
        return { ok: true, slot: { id: slotId, ...slot, capacity } };
      }
    }
    return { ok: false, error: "Ce créneau est complet" };
  });
}

// Libère un siège. Sans submissionId : libère tous les sièges (action admin)
// et renvoie la liste des candidats qui étaient réservés.
async function releaseSlot(slotId, submissionId) {
  return withClient(async (client) => {
    const released = [];
    for (let n = 1; n <= MAX_CAPACITY; n++) {
      const key = seatKey(slotId, n);
      const val = await client.get(key);
      if (!val) continue;
      if (!submissionId || val === submissionId) {
        await client.del(key);
        released.push(val);
        if (submissionId) break;
      }
    }
    return { ok: true, released };
  });
}

async function findSlotBySubmission(submissionId) {
  const slots = await listSlots();
  return slots.find(s => (s.bookedIds || []).includes(submissionId)) || null;
}

module.exports = {
  listSlots, getSlot, createSlots, patchSlot, deleteSlot,
  tryBookSlot, releaseSlot, findSlotBySubmission, MAX_CAPACITY
};
