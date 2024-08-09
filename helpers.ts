import net from 'node:net'
import * as agentApi from './agent-api'
import { Constants } from './constants'
import * as db from './db'
import type { Agent } from './schema'

export function checkPortAvailable(port: number, host = 'localhost'): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Port is currently in use
        resolve(false)
      } else {
        reject(err)
      }
    })

    server.once('listening', () => {
      // Port is available
      server.close()
      resolve(true)
    })

    server.listen(port, host)
  })
}

export async function getPort(agent: Agent): Promise<string | false> {
  const usedPorts = await db.getUsedPorts(agent.id)

  for (let port = 5040; port <= Constants.END_PORT; port++) {
    if (!usedPorts.includes(port.toString())) {
      const result = await agentApi.isPortAvailable(agent, port)
      if (result.success) {
        return port.toString()
      }
    }
  }

  return false
}
