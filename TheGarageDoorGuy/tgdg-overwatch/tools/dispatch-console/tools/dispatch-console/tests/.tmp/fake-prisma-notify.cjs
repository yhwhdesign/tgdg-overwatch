
    const D = () => globalThis.__NDB;
    const dup = () => Object.assign(new Error("unique"), { code: "P2002" });
    const missing = () => Object.assign(new Error("missing"), { code: "P2025" });
    const withCount = (p) => ({ ...p, _count: { subscriptions: D().subs.filter((s) => s.recipientId === p.id).length } });
    module.exports.prisma = {
      notifyRecipient: {
        async findMany(a) { return D().people.map((p) => (a && a.include ? withCount(p) : { ...p })); },
        async findUnique(a) { const p = D().people.find((x) => (a.where.id ? x.id === a.where.id : x.topic === a.where.topic)); return p ? { ...p } : null; },
        async create(a) { const p = { id: "p" + (D().people.length + 1), createdAt: new Date(), enabled: true, ...a.data }; D().people.push(p); return { ...p }; },
        async update(a) { const p = D().people.find((x) => x.id === a.where.id); if (!p) throw missing(); Object.assign(p, a.data); return { ...p }; },
        async deleteMany(a) { const b = D().people.length; D().people = D().people.filter((x) => x.id !== a.where.id); D().subs = D().subs.filter((s) => D().people.some((p) => p.id === s.recipientId)); return { count: b - D().people.length }; },
      },
      pushSubscription: {
        async findMany(a) { let rows = D().subs.filter((s) => s.recipientId === a.where.recipientId); if (a.orderBy) rows = [...rows].sort((x, y) => y.createdAt - x.createdAt); return rows.map((r) => ({ ...r })); },
        async upsert(a) { const found = D().subs.find((s) => s.endpoint === a.where.endpoint); if (found) { Object.assign(found, a.update); return { ...found }; } const row = { id: "s" + (++D().seq), createdAt: D().seq, ...a.create }; D().subs.push(row); return { ...row }; },
        async deleteMany(a) { const w = a.where; const before = D().subs.length; D().subs = D().subs.filter((s) => !((w.endpoint === undefined || s.endpoint === w.endpoint) && (w.recipientId === undefined || s.recipientId === w.recipientId) && (!w.id || (w.id.in || []).includes(s.id)))); return { count: before - D().subs.length }; },
      },
      notifySent: {
        async create(a) { if (D().sent.has(a.data.key)) throw dup(); D().sent.set(a.data.key, a.data.sentAt); return a.data; },
        async deleteMany(a) { if (a.where.key) D().sent.delete(a.where.key); if (a.where.sentAt) for (const [k, t] of [...D().sent]) if (t < a.where.sentAt.lt) D().sent.delete(k); return { count: 0 }; },
      },
    };