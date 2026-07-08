const { createClient } = require("redis");

const LEGACY_KEY = "orage:submissions";
const INDEX_KEY = "orage:submissions:index";
const subKey = (id) => `orage:submission:${id}`;
const photoKey = (id) => `orage:photo:${id}`;

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

async function kvGet(key) {
  return withClient(async (client) => {
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
  });
}

async function kvSet(key, value) {
  return withClient(async (client) => {
    await client.set(key, JSON.stringify(value));
  });
}

async function migrateLegacyIfNeeded(client) {
  const legacyRaw = await client.get(LEGACY_KEY);
  if (!legacyRaw) return;
  const legacy = JSON.parse(legacyRaw);
  for (const sub of legacy) {
    const { photo, ...rest } = sub;
    await client.set(subKey(sub.id), JSON.stringify(rest));
    if (photo) await client.set(photoKey(sub.id), photo);
    await client.sAdd(INDEX_KEY, sub.id);
  }
  await client.del(LEGACY_KEY);
}

async function listSubmissions() {
  return withClient(async (client) => {
    await migrateLegacyIfNeeded(client);
    const ids = await client.sMembers(INDEX_KEY);
    if (ids.length === 0) return [];
    const keys = ids.map(subKey);
    const raws = await client.mGet(keys);
    return raws.map((r, i) => (r ? { ...JSON.parse(r), id: ids[i] } : null)).filter(Boolean);
  });
}

async function getSubmission(id) {
  return withClient(async (client) => {
    const raw = await client.get(subKey(id));
    return raw ? { ...JSON.parse(raw), id } : null;
  });
}

async function createSubmission(sub) {
  const { photo, ...rest } = sub;
  return withClient(async (client) => {
    await client.set(subKey(sub.id), JSON.stringify(rest));
    if (photo) await client.set(photoKey(sub.id), photo);
    await client.sAdd(INDEX_KEY, sub.id);
  });
}

async function updateSubmission(id, patch) {
  return withClient(async (client) => {
    const raw = await client.get(subKey(id));
    if (!raw) return false;
    const current = JSON.parse(raw);
    const { photo, ...restPatch } = patch;
    const updated = { ...current, ...restPatch };
    await client.set(subKey(id), JSON.stringify(updated));
    if (photo !== undefined) await client.set(photoKey(id), photo);
    return true;
  });
}

async function deleteSubmission(id) {
  return withClient(async (client) => {
    await client.del(subKey(id));
    await client.del(photoKey(id));
    await client.sRem(INDEX_KEY, id);
  });
}

async function getPhoto(id) {
  return withClient(async (client) => {
    return await client.get(photoKey(id));
  });
}

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

async function checkRateLimit(key, limit, windowSeconds) {
  return withClient(async (client) => {
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, windowSeconds);
    }
    return count <= limit;
  });
}

async function resetRateLimit(key) {
  return withClient(async (client) => {
    await client.del(key);
  });
}

const CLOSED_ROLES_KEY = "orage:closed_roles";

async function getClosedRoles() {
  return withClient(async (client) => {
    return await client.sMembers(CLOSED_ROLES_KEY);
  });
}

async function setRoleClosed(role, closed) {
  return withClient(async (client) => {
    if (closed) {
      await client.sAdd(CLOSED_ROLES_KEY, role);
    } else {
      await client.sRem(CLOSED_ROLES_KEY, role);
    }
  });
}

module.exports = {
  kvGet, kvSet,
  listSubmissions, getSubmission, createSubmission, updateSubmission, deleteSubmission, getPhoto,
  getClientIp, checkRateLimit, resetRateLimit,
  getClosedRoles, setRoleClosed
};
