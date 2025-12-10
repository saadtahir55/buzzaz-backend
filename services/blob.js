let putFn;

async function getPut() {
  if (putFn) return putFn;
  try {
    // Prefer CommonJS require when available
    ({ put: putFn } = require('@vercel/blob'));
  } catch (err) {
    // Fallback to ESM dynamic import (Node 20+/Vercel functions)
    const mod = await import('@vercel/blob');
    putFn = mod.put;
  }
  return putFn;
}

// Upload a buffer to Vercel Blob storage and return the public URL
async function uploadBufferToBlob(buffer, contentType, suggestedName = 'upload') {
  const safeName = suggestedName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `uploads/${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`;
  const put = await getPut();
  const result = await put(key, buffer, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
  });
  return { url: result.url, key: result.pathname || key };
}

module.exports = { uploadBufferToBlob };
