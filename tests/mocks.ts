import { vi } from 'vitest'

/**
 * Mock for fs/promises - file system operations
 */
export function createFsMock(files: Record<string, string> = {}) {
  return {
    readFile: vi.fn((path: string) => {
      if (files[path]) {
        return Promise.resolve(files[path])
      }
      return Promise.reject(new Error(`ENOENT: no such file or directory, open '${path}'`))
    }),
    writeFile: vi.fn(() => Promise.resolve()),
  }
}

/**
 * Mock for fetch - HTTP requests
 */
export function createFetchMock(responses: Record<string, unknown> = {}) {
  return vi.fn((url: string) => {
    const response = responses[url]
    if (response) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(response),
      })
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.reject(new Error('Not found')),
    })
  })
}

/**
 * Mock for Docker client
 */
export function createDockerMock(options: {
  pingSuccess?: boolean
  containers?: Array<{ Names: string[]; Image: string }>
  networkExists?: boolean
  networkContainers?: Record<string, { Name: string; IPv4Address: string }>
} = {}) {
  const { pingSuccess = true, containers = [], networkExists = true, networkContainers = {} } = options

  return {
    ping: vi.fn(() => pingSuccess ? Promise.resolve() : Promise.reject(new Error('Docker not running'))),
    listContainers: vi.fn(() => Promise.resolve(containers)),
    getNetwork: vi.fn(() => ({
      inspect: vi.fn(() => {
        if (networkExists) {
          return Promise.resolve({ Containers: networkContainers })
        }
        return Promise.reject(new Error('Network not found'))
      }),
    })),
    getContainer: vi.fn((name: string) => ({
      logs: vi.fn(() => Promise.resolve(Buffer.from(`Logs for ${name}`))),
      restart: vi.fn(() => Promise.resolve()),
    })),
    createNetwork: vi.fn(() => Promise.resolve()),
  }
}

/**
 * Mock for execAsync (shell commands)
 */
export function createExecMock(results: Record<string, { stdout?: string; stderr?: string }> = {}) {
  return vi.fn((cmd: string) => {
    const result = results[cmd]
    if (result) {
      return Promise.resolve({ stdout: result.stdout || '', stderr: result.stderr || '' })
    }
    return Promise.resolve({ stdout: '', stderr: '' })
  })
}
