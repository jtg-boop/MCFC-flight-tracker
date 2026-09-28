// Push notifications through ntfy (https://ntfy.sh). Install the ntfy app,
// subscribe to a hard-to-guess topic name, and set NTFY_TOPIC to the same name.

export async function sendAlert(config, { title, message, url }) {
  if (!config.ntfyTopic) return false;
  try {
    const res = await fetch(`${config.ntfyServer.replace(/\/$/, '')}/${encodeURIComponent(config.ntfyTopic)}`, {
      method: 'POST',
      headers: {
        Title: title,
        Tags: 'airplane,soccer',
        ...(url ? { Click: url } : {}),
      },
      body: message,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.warn(`[notify] ntfy alert failed: ${err.message}`);
    return false;
  }
}
