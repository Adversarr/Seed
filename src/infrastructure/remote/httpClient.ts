/**
 * Remote HTTP client — typed fetch wrapper for calling master server APIs.
 */

export class RemoteHttpClient {
  readonly #baseUrl: string
  readonly #token: string

  constructor(port: number, token: string, host = '127.0.0.1') {
    this.#baseUrl = `http://${host}:${port}`
    this.#token = token
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.#baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.#token}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
    }
    return res.json() as Promise<T>
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.#baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#token}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const respBody = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error((respBody as { error?: string }).error ?? `HTTP ${res.status}`)
    }
    return res.json() as Promise<T>
  }
}
