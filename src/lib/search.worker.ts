const documents = new Map<string, string>();
self.onmessage = (event: MessageEvent) => {
  const { type, id, text, query, request } = event.data;
  if (type === 'upsert') documents.set(id, text.toLocaleLowerCase());
  if (type === 'remove') documents.delete(id);
  if (type === 'query') {
    const terms = String(query).toLocaleLowerCase().trim().split(/\s+/);
    const hits = [...documents]
      .filter(([, text]) => terms.every((t) => text.includes(t)))
      .map(([id]) => id);
    self.postMessage({ request, hits });
  }
};
