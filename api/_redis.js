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

const ROLES_KEY = "orage:roles";

const DEFAULT_ROLES = [
  { name: "ALEXANDRE DE CHASTENET", age: "60-65 ans", job: "Rôle principal · Chef étoilé", desc: "Chef étoilé de la soixantaine, charismatique et reconnu, moins hautain qu'Agnès sa femme. Il possède un charme naturel et un sens de l'humour bienveillant. Il entretient une relation secrète avec Stéphanie, la meilleure amie de sa femme. Il s'implique peu dans les projets immobiliers familiaux, préférant sa cuisine et ses restaurants." },
  { name: "AUGUSTIN DE CHASTENET", age: "25-30 ans", job: "Rôle principal", desc: "Fils cadet de la famille, insouciant, ironique et sans grande direction de vie. Il rêve de partir mixer en Australie pour devenir DJ et fuir la pression familiale. Il conduit la décapotable à l'arrivée à Guéthary, se bagarre avec Léandro, et lui achète de la drogue. Accusé de la mort de Léandro." },
  { name: "BIXENTE APARRA", age: "60-65 ans", job: "Rôle important", desc: "Père de Patxi, Léandro et Loréa, bel homme de 60 ans se déplaçant en fauteuil roulant. Il travaille dans la boutique de surf familiale. Bienveillant, chaleureux et discret, il est le pilier affectif de la famille Aparra, et s'inquiète discrètement pour son fils aîné." },
  { name: "LÉANDRO APARRA", age: "18-22 ans", job: "Rôle important", desc: "Frère jumeau de Loréa et jeune frère de Patxi, 20 ans, impulsif et imprévisible. Il s'introduit avec ses amis dans la piscine des de Chastenet pour une fête sauvage. Il a un casier judiciaire et deale lors de fêtes, mais reste attachant. Meurt à l'épisode 2 lors d'un accident en mer." },
  { name: "LORÉA APARRA", age: "18-22 ans", job: "Rôle important", desc: "Sœur jumelle de Léandro et petite sœur de Patxi, 20 ans, sportive et talentueuse en surf. Elle s'entraîne intensément pour une compétition sous la direction de Patxi. En couple avec Mathis, loyale envers sa famille, elle défend Léandro face aux accusations des de Chastenet." },
  { name: "VANESSA", age: "30-40 ans", job: "Rôle important", desc: "Tatouée, tatoueuse de métier, fille de Mikel le propriétaire du bar de plage. Petite amie de Patxi, avec qui elle entretient une relation affectueuse mais fragilisée par ses absences et ses secrets. Loyale jusqu'à mentir aux gendarmes pour lui fournir un alibi." },
  { name: "JO", age: "55-60 ans", job: "Rôle important · Capitaine de gendarmerie", desc: "Capitaine de gendarmerie à Guéthary, rigoureuse et professionnelle. Elle connaît personnellement la famille Aparra et gère avec impartialité les accusations croisées avec les de Chastenet. Porte le souvenir de l'enquête non résolue sur la mort du grand-père Chastenet 17 ans plus tôt. Mère d'Esteban." },
  { name: "STÉPHANIE CRÉMIEUX", age: "55-60 ans", job: "Rôle important", desc: "Belle femme de 60 ans installée au Pays Basque après une vie parisienne dans les affaires. Marraine de Garance et meilleure amie d'Agnès, elle tient une salle de yoga à Guéthary. Confidente et médiatrice entre Garance et sa mère, elle entretient une relation secrète avec Alexandre de Chastenet." },
  { name: "ROMÉO GARANO", age: "30-40 ans", job: "", desc: "Ami d'enfance de Patxi et Esteban, il tient plusieurs salles de sport à Anglet et opère en marge de la légalité. Provocateur et opportuniste, il propose à Patxi un cambriolage. Il se révèle être un traître, travaillant secrètement pour Agnès de Chastenet pour le piéger." },
  { name: "MIKEL BASAGOITI", age: "55-60 ans", job: "", desc: "Propriétaire du bar de plage « Chez Mikel », ancré dans la vie locale de Guéthary, taiseux, digne et honnête. Il a promis à Patxi de lui vendre son bar, mais les de Chastenet lui proposent le double du prix. Tiraillé entre sa parole donnée et ses besoins financiers. Père de Vanessa." },
  { name: "RÉMI", age: "40-45 ans", job: "", desc: "Brigadier de gendarmerie d'une quarantaine d'années, subordonné de Jo. Il effectue les relevés sur la scène de l'incendie à l'Etxea de Chastenet et rapporte les éléments sous scellés à sa supérieure. Exécutant professionnel en soutien de Jo." },
  { name: "ESTEBAN AUDIBERT", age: "30-40 ans", job: "", desc: "Maire de Guéthary et ami d'enfance de Patxi et Roméo, pragmatique et politiquement prudent. Il met en garde Patxi contre ses obsessions concernant les de Chastenet, et se moque gentiment de Roméo et ses méthodes douteuses. Fils de Jo." },
  { name: "MATHIS", age: "20-25 ans", job: "", desc: "Petit ami de Loréa Aparra, il travaille comme jardinier à l'Etxea de Chastenet. C'est lui qui photographie Mikel lors de sa visite chez les de Chastenet pour en informer Patxi — informateur involontaire ou délibéré." },
  { name: "ELIOTT BOVAL", age: "30-38 ans", job: "", desc: "Architecte parisien, fiancé de Garance de Chastenet. Séduisant et ambitieux, il est l'auteur du projet architectural de l'hôtel Aldea." }
];

async function seedDefaultRolesIfEmpty(client) {
  const existing = await client.hGetAll(ROLES_KEY);
  if (Object.keys(existing).length > 0) return;
  let order = 0;
  for (const role of DEFAULT_ROLES) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + order;
    await client.hSet(ROLES_KEY, id, JSON.stringify({ ...role, closed: false, processStatus: "recherche", order: order++ }));
  }
}

async function listRoles() {
  return withClient(async (client) => {
    await seedDefaultRolesIfEmpty(client);
    const raw = await client.hGetAll(ROLES_KEY);
    return Object.entries(raw)
      .map(([id, val]) => {
        const parsed = JSON.parse(val);
        const processStatus = parsed.processStatus || (parsed.closed ? "ferme" : "recherche");
        return { id, ...parsed, processStatus };
      })
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  });
}

async function createRole(role) {
  return withClient(async (client) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await client.hSet(ROLES_KEY, id, JSON.stringify(role));
    return id;
  });
}

async function updateRole(id, patch) {
  return withClient(async (client) => {
    const raw = await client.hGet(ROLES_KEY, id);
    if (!raw) return false;
    const current = JSON.parse(raw);
    const updated = { ...current, ...patch };
    await client.hSet(ROLES_KEY, id, JSON.stringify(updated));
    return true;
  });
}

async function deleteRole(id) {
  return withClient(async (client) => {
    await client.hDel(ROLES_KEY, id);
  });
}

module.exports = {
  kvGet, kvSet,
  listSubmissions, getSubmission, createSubmission, updateSubmission, deleteSubmission, getPhoto,
  getClientIp, checkRateLimit, resetRateLimit,
  getClosedRoles, setRoleClosed,
  listRoles, createRole, updateRole, deleteRole
};
