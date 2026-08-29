const BASE_URL = "https://us-central1-bikeshop-ab2f0.cloudfunctions.net";

export async function resolveLoginEmail(username: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/resolveLoginEmail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Error ${res.status}` }));
    throw new Error(err.error || `Error ${res.status}`);
  }
  const data = await res.json();
  return data.email;
}
