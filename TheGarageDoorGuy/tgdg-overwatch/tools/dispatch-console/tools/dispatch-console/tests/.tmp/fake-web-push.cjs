
    const sendNotification = async (sub, payload, opts) => {
      globalThis.__PUSHES.push({ sub, payload: JSON.parse(payload), opts });
      const st = (globalThis.__PUSH_STATUS && globalThis.__PUSH_STATUS(sub.endpoint)) || 201;
      if (st >= 400) throw Object.assign(new Error("push error " + st), { statusCode: st });
      return { statusCode: st };
    };
    module.exports = { default: { sendNotification }, sendNotification };