let token = localStorage.getItem('pc_token');
export const setToken = t => { token = t; t ? localStorage.setItem('pc_token', t) : localStorage.removeItem('pc_token'); };

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, { method, body: body && JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}
// Direct-to-S3 upload using a short-lived presigned POST
export async function upload(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Photo must be 5 MB or smaller');
  const { url, fields, key } = await api('/uploads/presign', { method: 'POST', body: { contentType: file.type } });
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  fd.append('file', file);
  const res = await fetch(url, { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Photo upload failed. Check your connection and try again.');
  return key;
}
